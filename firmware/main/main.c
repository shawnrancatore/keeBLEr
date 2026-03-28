// SPDX-License-Identifier: MIT
/*
 * Keebler Main Application
 *
 * Keyboard BLE Enabler -- bridges browser-to-HID via ESP32-S3.
 * Initializes USB HID, BLE transport, and UART serial transport,
 * then routes incoming packets to the appropriate handler.
 *
 * BOOT button (GPIO 0) toggles between HID modes:
 *   Mode 0 = Boot keyboard only (maximum compatibility)
 *   Mode 1 = Composite keyboard + mouse (full featured)
 * Mode is persisted in NVS and takes effect after reboot.
 */

#include <string.h>
#include "esp_log.h"
#include "esp_err.h"
#include "esp_system.h"
#include "nvs_flash.h"
#include "nvs.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "driver/gpio.h"

#include "board_config.h"
#include "protocol.h"
#include "hid_bridge.h"
#include "ble_transport.h"
#include "serial_transport.h"

static const char *TAG = "keebler";

/* NVS namespace and key for HID mode */
#define NVS_NAMESPACE   "keebler"
#define NVS_KEY_MODE    "hid_mode"

/* Last error code (reported in status responses) */
static uint8_t s_last_error = 0;

/* Current HID mode (read from NVS at startup) */
static uint8_t s_hid_mode = HID_MODE_BOOT_KB;

/* =========================================================================
 * Packet Queue -- decouples BLE/UART receive from USB HID send
 * Prevents blocking the NimBLE host task with HID mutex waits.
 * ========================================================================= */

typedef struct {
    kb_packet_t packet;
    uint8_t transport;
} queued_packet_t;

#define PACKET_QUEUE_SIZE 16
static QueueHandle_t s_packet_queue = NULL;

/* ========================================================================= */
/*  NVS Helpers                                                               */
/* ========================================================================= */

static uint8_t nvs_read_hid_mode(void)
{
    nvs_handle_t handle;
    uint8_t mode = HID_MODE_BOOT_KB; /* default */

    esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READONLY, &handle);
    if (err == ESP_OK) {
        err = nvs_get_u8(handle, NVS_KEY_MODE, &mode);
        if (err == ESP_ERR_NVS_NOT_FOUND) {
            mode = HID_MODE_BOOT_KB;
        } else if (err != ESP_OK) {
            ESP_LOGW(TAG, "NVS read error: %s, using default", esp_err_to_name(err));
            mode = HID_MODE_BOOT_KB;
        }
        nvs_close(handle);
    } else if (err == ESP_ERR_NVS_NOT_FOUND) {
        /* Namespace doesn't exist yet — first boot */
        mode = HID_MODE_BOOT_KB;
    } else {
        ESP_LOGW(TAG, "NVS open error: %s, using default", esp_err_to_name(err));
    }

    /* Clamp to valid range */
    if (mode > HID_MODE_COMPOSITE) {
        mode = HID_MODE_BOOT_KB;
    }

    return mode;
}

static void nvs_write_hid_mode(uint8_t mode)
{
    nvs_handle_t handle;
    esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READWRITE, &handle);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "NVS open for write failed: %s", esp_err_to_name(err));
        return;
    }
    err = nvs_set_u8(handle, NVS_KEY_MODE, mode);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "NVS set failed: %s", esp_err_to_name(err));
    }
    err = nvs_commit(handle);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "NVS commit failed: %s", esp_err_to_name(err));
    }
    nvs_close(handle);
}

/* ========================================================================= */
/*  Response Helpers                                                          */
/* ========================================================================= */

static void send_response(uint8_t type, const uint8_t *payload, uint8_t len, uint8_t transport)
{
    uint8_t frame[32]; /* Small buffer -- responses are always short */
    size_t frame_len = kb_pack_frame(frame, sizeof(frame), type, payload, len);
    if (frame_len == 0) return;

    if (transport == KB_TRANSPORT_BLE) {
        kb_ble_send(frame, frame_len);
    } else if (transport == KB_TRANSPORT_UART) {
        serial_transport_send(frame, frame_len);
    }
}

static void send_ack(uint8_t status, uint8_t transport)
{
    send_response(KB_PKT_ACK, &status, KB_ACK_LEN, transport);
}

static void send_status_response(uint8_t transport)
{
    kb_status_response_t resp = {
        .version    = KB_PROTOCOL_VERSION,
        .board_type = BOARD_TYPE,
        .transport  = transport,
        .last_error = s_last_error,
    };
    send_response(KB_PKT_STATUS_RESPONSE, (const uint8_t *)&resp,
                  KB_STATUS_RESPONSE_LEN, transport);
}

/* ========================================================================= */
/*  Packet Callback -- enqueues packets (called from BLE/UART task context)  */
/* ========================================================================= */

typedef struct {
    uint8_t transport;
} transport_ctx_t;

static transport_ctx_t s_ble_ctx  = { .transport = KB_TRANSPORT_BLE };
static transport_ctx_t s_uart_ctx = { .transport = KB_TRANSPORT_UART };

static void on_packet_received(const kb_packet_t *pkt, void *user_ctx)
{
    transport_ctx_t *ctx = (transport_ctx_t *)user_ctx;

    /* Fast-path: status, heartbeat, echo are small and safe to handle inline */
    switch (pkt->type) {
    case KB_PKT_STATUS_REQUEST:
        send_status_response(ctx->transport);
        return;

    case KB_PKT_HEARTBEAT:
        if (pkt->length >= KB_HEARTBEAT_LEN) {
            send_response(KB_PKT_HEARTBEAT_ACK, pkt->payload, KB_HEARTBEAT_ACK_LEN, ctx->transport);
        }
        return;

    case KB_PKT_ECHO:
        send_response(KB_PKT_ECHO, pkt->payload, pkt->length, ctx->transport);
        return;

    case KB_PKT_KEYBOARD_REPORT:
    case KB_PKT_MOUSE_REPORT: {
        /* Enqueue HID reports for the processing task */
        queued_packet_t qp;
        memcpy(&qp.packet, pkt, sizeof(kb_packet_t));
        qp.transport = ctx->transport;
        if (xQueueSend(s_packet_queue, &qp, 0) != pdTRUE) {
            ESP_LOGW(TAG, "Packet queue full, dropping report");
            send_ack(KB_ACK_ERR_HID_FAIL, ctx->transport);
        }
        return;
    }

    default:
        ESP_LOGW(TAG, "Unknown packet type: 0x%02x", pkt->type);
        send_ack(KB_ACK_ERR_UNKNOWN_TYPE, ctx->transport);
        return;
    }
}

/* ========================================================================= */
/*  HID Processing Task -- dequeues and sends USB HID reports                */
/* ========================================================================= */

static void hid_process_task(void *param)
{
    (void)param;
    queued_packet_t qp;

    while (1) {
        if (xQueueReceive(s_packet_queue, &qp, portMAX_DELAY) == pdTRUE) {
            esp_err_t err = hid_bridge_process_packet(&qp.packet);
            if (err == ESP_OK) {
                send_ack(KB_ACK_OK, qp.transport);
            } else {
                s_last_error = KB_ACK_ERR_HID_FAIL;
                send_ack(KB_ACK_ERR_HID_FAIL, qp.transport);
            }
        }
    }
}

/* ========================================================================= */
/*  LED                                                                       */
/* ========================================================================= */

#if BOARD_HAS_LED
static void led_set(bool on)
{
#ifdef BOARD_XIAO_S3
    gpio_set_level(BOARD_LED_PIN, on ? 0 : 1); /* Active-low */
#else
    gpio_set_level(BOARD_LED_PIN, on ? 1 : 0);
#endif
}

static void led_init(void)
{
    gpio_config_t io_conf = {
        .pin_bit_mask = (1ULL << BOARD_LED_PIN),
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    gpio_config(&io_conf);
    led_set(false); /* Start with LED off, respecting polarity */
}
#endif

/* ========================================================================= */
/*  BOOT Button (GPIO 0)                                                      */
/* ========================================================================= */

static void boot_btn_init(void)
{
    gpio_config_t io_conf = {
        .pin_bit_mask = (1ULL << BOARD_BOOT_BTN_PIN),
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    gpio_config(&io_conf);
}

static bool boot_btn_is_pressed(void)
{
    /* BOOT button is active low */
    return gpio_get_level(BOARD_BOOT_BTN_PIN) == 0;
}

/* ========================================================================= */
/*  Application Entry Point                                                   */
/* ========================================================================= */

void app_main(void)
{
    ESP_LOGI(TAG, "=== Keebler v%s ===", KB_VERSION_STRING);
    ESP_LOGI(TAG, "Board: %s", BOARD_NAME);
    ESP_LOGI(TAG, "Protocol: %d, Firmware: %s", KB_PROTOCOL_VERSION, KB_VERSION_STRING);

    /* Initialize NVS */
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);

    /* Read HID mode from NVS */
    s_hid_mode = nvs_read_hid_mode();
    ESP_LOGI(TAG, "HID mode: %d (%s)",
             s_hid_mode,
             s_hid_mode == HID_MODE_BOOT_KB ? "boot keyboard" : "composite");

    /* Initialize LED */
#if BOARD_HAS_LED
    led_init();
    ESP_LOGI(TAG, "Status LED on GPIO %d", BOARD_LED_PIN);
#endif

    /* Initialize BOOT button */
    boot_btn_init();
    ESP_LOGI(TAG, "BOOT button on GPIO %d", BOARD_BOOT_BTN_PIN);

    /* Create packet queue */
    s_packet_queue = xQueueCreate(PACKET_QUEUE_SIZE, sizeof(queued_packet_t));
    configASSERT(s_packet_queue);

    /* Start HID processing task */
    xTaskCreate(hid_process_task, "hid_proc", 4096, NULL, 5, NULL);

    /* Initialize USB HID bridge with current mode */
    ret = hid_bridge_init(s_hid_mode);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "HID bridge init failed: %s", esp_err_to_name(ret));
        s_last_error = KB_ACK_ERR_HID_FAIL;
    } else {
        ESP_LOGI(TAG, "HID bridge ready");
    }

    /* Set BLE callback BEFORE init to avoid race with early connections */
    kb_ble_set_rx_callback(on_packet_received, &s_ble_ctx);

    /* Initialize BLE transport */
    ret = kb_ble_init();
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "BLE transport init failed: %s", esp_err_to_name(ret));
    } else {
        ESP_LOGI(TAG, "BLE transport ready");
    }

    /* Initialize serial transport */
    serial_transport_set_rx_callback(on_packet_received, &s_uart_ctx);
    ret = serial_transport_init();
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Serial transport init failed: %s", esp_err_to_name(ret));
    } else {
        ESP_LOGI(TAG, "Serial transport ready");
    }

    ESP_LOGI(TAG, "Keebler initialized, entering main loop");

    /* Main loop: LED status indication + BOOT button polling */
    uint32_t loop_count = 0;
    bool btn_prev = false;  /* previous debounced state */
    bool btn_raw_prev = false; /* previous raw read (for 2-sample debounce) */

    while (1) {
        /* ---- BOOT button polling (debounce: two consecutive pressed reads) ---- */
        bool btn_raw = boot_btn_is_pressed();
        if (btn_raw && btn_raw_prev && !btn_prev) {
            /* Button just confirmed pressed (debounced falling edge) */
            btn_prev = true;

            uint8_t new_mode = (s_hid_mode == HID_MODE_BOOT_KB)
                               ? HID_MODE_COMPOSITE : HID_MODE_BOOT_KB;

            ESP_LOGI(TAG, "BOOT button pressed! Switching HID mode %d -> %d (%s)",
                     s_hid_mode, new_mode,
                     new_mode == HID_MODE_BOOT_KB ? "boot keyboard" : "composite");

            nvs_write_hid_mode(new_mode);

            /* Brief delay to let log flush */
            vTaskDelay(pdMS_TO_TICKS(200));

            esp_restart();
        }
        if (!btn_raw) {
            btn_prev = false;
        }
        btn_raw_prev = btn_raw;

        /* ---- LED patterns ---- */
#if BOARD_HAS_LED
        bool ble_connected = kb_ble_is_connected();
        bool usb_ready = hid_bridge_is_ready();

        if (usb_ready && ble_connected) {
            /* Fully operational: solid ON */
            led_set(true);
        } else if (ble_connected) {
            /* BLE connected, no USB: fast blink ~4Hz (toggle every 50ms,
             * but our loop runs every 200ms so toggle each iteration) */
            led_set((loop_count % 2) == 0);
        } else {
            /* Idle: mode indication pattern (2-second period = 10 ticks at 200ms)
             * Mode 0 (boot KB): single short flash every 2 seconds
             * Mode 1 (composite): double flash every 2 seconds */
            uint32_t phase = loop_count % 10;
            if (s_hid_mode == HID_MODE_BOOT_KB) {
                /* Single flash at phase 0 */
                led_set(phase == 0);
            } else {
                /* Double flash at phase 0 and phase 2 */
                led_set(phase == 0 || phase == 2);
            }
        }
#endif

        /* ---- Periodic status log ---- */
        if (loop_count % 150 == 0) {
            ESP_LOGI(TAG, "Status: USB=%s BLE=%s Mode=%d(%s)",
                     hid_bridge_is_ready() ? "mounted" : "not mounted",
                     kb_ble_is_connected() ? "connected" : "disconnected",
                     s_hid_mode,
                     s_hid_mode == HID_MODE_BOOT_KB ? "boot_kb" : "composite");
        }

        loop_count++;
        vTaskDelay(pdMS_TO_TICKS(200));
    }
}
