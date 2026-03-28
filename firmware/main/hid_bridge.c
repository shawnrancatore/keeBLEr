// SPDX-License-Identifier: MIT
/*
 * Keebler USB HID Bridge Implementation
 *
 * Supports two modes selected at init:
 *   Mode 0 (HID_MODE_BOOT_KB):   Boot protocol keyboard only.
 *                                  No report IDs, bInterfaceSubClass=1,
 *                                  bInterfaceProtocol=1.  Maximum compatibility.
 *   Mode 1 (HID_MODE_COMPOSITE): Composite keyboard + mouse in one interface.
 *                                  Report ID 1 = keyboard, Report ID 2 = mouse.
 */

#include "hid_bridge.h"
#include "board_config.h"

#include <string.h>
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"
#include "tinyusb.h"
#include "class/hid/hid_device.h"

static const char *TAG = "hid_bridge";

/* Mutex for serialising HID report sends */
static SemaphoreHandle_t s_hid_mutex = NULL;

/* Active mode (set once in hid_bridge_init) */
static uint8_t s_hid_mode = HID_MODE_BOOT_KB;

/* Track whether mouse-not-supported warning has been logged */
static bool s_mouse_warn_logged = false;

/* ========================================================================= */
/*  USB Descriptors — Mode 0: Boot Keyboard                                  */
/* ========================================================================= */

/* Boot protocol keyboard only — no report ID */
static const uint8_t s_boot_kb_report_descriptor[] = {
    TUD_HID_REPORT_DESC_KEYBOARD()
};

#define BOOT_KB_CONFIG_TOTAL_LEN  (TUD_CONFIG_DESC_LEN + TUD_HID_DESC_LEN)

static const uint8_t s_boot_kb_configuration_descriptor[] = {
    /* Config: config_num, interface_count, string_idx, total_len, attribute, power_mA */
    TUD_CONFIG_DESCRIPTOR(1, 1, 0, BOOT_KB_CONFIG_TOTAL_LEN, 0, 100),

    /* HID interface: boot protocol keyboard (subclass=1, protocol=1)
     * itf_num, string_idx, boot_protocol, report_desc_len, ep_in, ep_size, poll_interval_ms */
    TUD_HID_DESCRIPTOR(0, 4, HID_ITF_PROTOCOL_KEYBOARD,
                       sizeof(s_boot_kb_report_descriptor), 0x81, 8, 10),
};

/* ========================================================================= */
/*  USB Descriptors — Mode 1: Composite Keyboard + Mouse                     */
/* ========================================================================= */

/* Keyboard with report ID 1 + Mouse with report ID 2, single interface */
static const uint8_t s_composite_report_descriptor[] = {
    TUD_HID_REPORT_DESC_KEYBOARD(HID_REPORT_ID(1)),
    TUD_HID_REPORT_DESC_MOUSE(HID_REPORT_ID(2)),
};

#define COMPOSITE_CONFIG_TOTAL_LEN  (TUD_CONFIG_DESC_LEN + TUD_HID_DESC_LEN)

static const uint8_t s_composite_configuration_descriptor[] = {
    /* Config: config_num, interface_count, string_idx, total_len, attribute, power_mA */
    TUD_CONFIG_DESCRIPTOR(1, 1, 0, COMPOSITE_CONFIG_TOTAL_LEN, 0, 100),

    /* HID interface: NOT boot protocol (subclass=0, protocol=0)
     * itf_num, string_idx, boot_protocol, report_desc_len, ep_in, ep_size, poll_interval_ms */
    TUD_HID_DESCRIPTOR(0, 4, HID_ITF_PROTOCOL_NONE,
                       sizeof(s_composite_report_descriptor), 0x81, 16, 10),
};

/* ========================================================================= */
/*  Pointers to active descriptor set (selected at init)                     */
/* ========================================================================= */

static const uint8_t *s_active_report_desc = NULL;
static const uint8_t *s_active_config_desc = NULL;

/* ========================================================================= */
/*  Common device descriptor                                                 */
/* ========================================================================= */

static const tusb_desc_device_t s_device_descriptor = {
    .bLength            = sizeof(tusb_desc_device_t),
    .bDescriptorType    = TUSB_DESC_DEVICE,
    .bcdUSB             = 0x0200,
    .bDeviceClass       = 0x00,      /* Defined at interface level */
    .bDeviceSubClass    = 0x00,
    .bDeviceProtocol    = 0x00,
    .bMaxPacketSize0    = CFG_TUD_ENDPOINT0_SIZE,
    .idVendor           = BOARD_USB_VID,
    .idProduct          = BOARD_USB_PID,
    .bcdDevice          = BOARD_USB_BCD,
    .iManufacturer      = 0x01,
    .iProduct           = 0x02,
    .iSerialNumber      = 0x03,
    .bNumConfigurations = 0x01,
};

/* String descriptors */
static const char *s_hid_string_descriptor[] = {
    (const char[]){0x09, 0x04},   /* 0: Language (English) */
    "Keebler",                     /* 1: Manufacturer */
    "Keebler HID Bridge",          /* 2: Product */
    "000001",                      /* 3: Serial Number */
    "Keebler KB+Mouse",            /* 4: HID Interface */
};

/* ========================================================================= */
/*  TinyUSB Callbacks                                                        */
/* ========================================================================= */

/* Invoked when GET HID REPORT DESCRIPTOR is received */
uint8_t const *tud_hid_descriptor_report_cb(uint8_t instance)
{
    (void)instance;
    return s_active_report_desc;
}

/* Invoked when GET_REPORT control request is received */
uint16_t tud_hid_get_report_cb(uint8_t instance, uint8_t report_id,
                                hid_report_type_t report_type,
                                uint8_t *buffer, uint16_t reqlen)
{
    (void)instance;
    (void)report_id;
    (void)report_type;
    (void)buffer;
    (void)reqlen;
    return 0;
}

/* Invoked when SET_REPORT control request is received or data on OUT endpoint */
void tud_hid_set_report_cb(uint8_t instance, uint8_t report_id,
                            hid_report_type_t report_type,
                            uint8_t const *buffer, uint16_t bufsize)
{
    (void)instance;
    (void)report_id;
    (void)report_type;
    (void)buffer;
    (void)bufsize;
    /* Could handle LED status (caps lock, num lock, etc.) here */
}

/* ========================================================================= */
/*  Public API                                                               */
/* ========================================================================= */

esp_err_t hid_bridge_init(uint8_t mode)
{
    ESP_LOGI(TAG, "Initializing USB HID bridge, mode=%d (%s)",
             mode, mode == HID_MODE_BOOT_KB ? "boot keyboard" : "composite");

    s_hid_mode = mode;
    s_mouse_warn_logged = false;

    /* Select descriptor set based on mode */
    if (mode == HID_MODE_COMPOSITE) {
        s_active_report_desc = s_composite_report_descriptor;
        s_active_config_desc = s_composite_configuration_descriptor;
    } else {
        s_active_report_desc = s_boot_kb_report_descriptor;
        s_active_config_desc = s_boot_kb_configuration_descriptor;
    }

    s_hid_mutex = xSemaphoreCreateMutex();
    if (s_hid_mutex == NULL) {
        ESP_LOGE(TAG, "Failed to create HID mutex");
        return ESP_ERR_NO_MEM;
    }

    const tinyusb_config_t tusb_cfg = {
        .device_descriptor = &s_device_descriptor,
        .string_descriptor = s_hid_string_descriptor,
        .string_descriptor_count = sizeof(s_hid_string_descriptor) / sizeof(s_hid_string_descriptor[0]),
        .external_phy = false,
#if (TUD_OPT_HIGH_SPEED)
        .fs_configuration_descriptor = s_active_config_desc,
        .hs_configuration_descriptor = s_active_config_desc,
        .qualifier_descriptor = NULL,
#else
        .configuration_descriptor = s_active_config_desc,
#endif
    };

    esp_err_t ret = tinyusb_driver_install(&tusb_cfg);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "TinyUSB driver install failed: %s", esp_err_to_name(ret));
        return ret;
    }

    ESP_LOGI(TAG, "USB HID bridge initialized (mode %d)", s_hid_mode);
    return ESP_OK;
}

uint8_t hid_bridge_get_mode(void)
{
    return s_hid_mode;
}

bool hid_bridge_is_ready(void)
{
    return tud_mounted();
}

esp_err_t hid_bridge_send_keyboard_report(const kb_keyboard_report_t *report)
{
    if (report == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    if (!tud_mounted()) {
        ESP_LOGW(TAG, "USB not mounted, dropping keyboard report");
        return ESP_ERR_INVALID_STATE;
    }

    if (xSemaphoreTake(s_hid_mutex, pdMS_TO_TICKS(100)) != pdTRUE) {
        ESP_LOGW(TAG, "HID mutex timeout");
        return ESP_ERR_TIMEOUT;
    }

    /* Wait for previous report to finish */
    int retries = 10;
    while (!tud_hid_ready() && retries > 0) {
        vTaskDelay(pdMS_TO_TICKS(1));
        retries--;
    }

    if (!tud_hid_ready()) {
        xSemaphoreGive(s_hid_mutex);
        ESP_LOGW(TAG, "HID not ready for keyboard report");
        return ESP_ERR_INVALID_STATE;
    }

    bool ok;
    if (s_hid_mode == HID_MODE_COMPOSITE) {
        /* Composite mode: keyboard report ID = 1 */
        ok = tud_hid_keyboard_report(REPORT_ID_KEYBOARD, report->modifiers, report->keycodes);
    } else {
        /* Boot keyboard mode: no report ID prefix */
        ok = tud_hid_keyboard_report(0, report->modifiers, report->keycodes);
    }

    xSemaphoreGive(s_hid_mutex);

    if (!ok) {
        ESP_LOGE(TAG, "Failed to send keyboard report");
        return ESP_FAIL;
    }

    ESP_LOGD(TAG, "Keyboard report sent (mod=0x%02x, mode=%d)", report->modifiers, s_hid_mode);
    return ESP_OK;
}

esp_err_t hid_bridge_send_mouse_report(const kb_mouse_report_t *report)
{
    if (report == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    /* Mode 0: mouse not supported */
    if (s_hid_mode == HID_MODE_BOOT_KB) {
        if (!s_mouse_warn_logged) {
            ESP_LOGW(TAG, "Mouse reports not supported in boot keyboard mode");
            s_mouse_warn_logged = true;
        }
        return ESP_ERR_NOT_SUPPORTED;
    }

    if (!tud_mounted()) {
        ESP_LOGW(TAG, "USB not mounted, dropping mouse report");
        return ESP_ERR_INVALID_STATE;
    }

    if (xSemaphoreTake(s_hid_mutex, pdMS_TO_TICKS(100)) != pdTRUE) {
        ESP_LOGW(TAG, "HID mutex timeout");
        return ESP_ERR_TIMEOUT;
    }

    int retries = 10;
    while (!tud_hid_ready() && retries > 0) {
        vTaskDelay(pdMS_TO_TICKS(1));
        retries--;
    }

    if (!tud_hid_ready()) {
        xSemaphoreGive(s_hid_mutex);
        ESP_LOGW(TAG, "HID not ready for mouse report");
        return ESP_ERR_INVALID_STATE;
    }

    /* Composite mode: mouse report ID = 2 */
    bool ok = tud_hid_mouse_report(REPORT_ID_MOUSE,
                                    report->buttons,
                                    report->dx,
                                    report->dy,
                                    report->wheel,
                                    report->pan);

    xSemaphoreGive(s_hid_mutex);

    if (!ok) {
        ESP_LOGE(TAG, "Failed to send mouse report");
        return ESP_FAIL;
    }

    ESP_LOGD(TAG, "Mouse report sent (btn=0x%02x dx=%d dy=%d)",
             report->buttons, report->dx, report->dy);
    return ESP_OK;
}

esp_err_t hid_bridge_process_packet(const kb_packet_t *pkt)
{
    if (pkt == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    switch (pkt->type) {
    case KB_PKT_KEYBOARD_REPORT: {
        kb_keyboard_report_t report;
        if (!kb_unpack_keyboard_report(pkt, &report)) {
            ESP_LOGW(TAG, "Invalid keyboard report length: %d", pkt->length);
            return ESP_ERR_INVALID_SIZE;
        }
        return hid_bridge_send_keyboard_report(&report);
    }

    case KB_PKT_MOUSE_REPORT: {
        kb_mouse_report_t report;
        if (!kb_unpack_mouse_report(pkt, &report)) {
            ESP_LOGW(TAG, "Invalid mouse report length: %d", pkt->length);
            return ESP_ERR_INVALID_SIZE;
        }
        return hid_bridge_send_mouse_report(&report);
    }

    default:
        ESP_LOGW(TAG, "HID bridge: unhandled packet type 0x%02x", pkt->type);
        return ESP_ERR_INVALID_ARG;
    }
}
