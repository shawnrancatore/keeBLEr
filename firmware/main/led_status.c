// SPDX-License-Identifier: MIT
/*
 * Keebler LED Status Indicator -- implementation
 *
 * A dedicated FreeRTOS task ticks at LED_TICK_MS and renders the LED based
 * on:
 *   - the current "base" colour (derived from set_link() flags),
 *   - any active transient indication (working spinner, double-blink),
 *   - the HID heartbeat overlay (brief magenta flash every 5 s).
 *
 * Each layer is rendered into a small (r,g,b) value at the end of the tick,
 * then dispatched to one of three backends (NONE/GPIO/WS2812) selected at
 * compile time via BOARD_LED_TYPE.
 */

#include "led_status.h"
#include "board_config.h"

#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#if BOARD_HAS_LED && BOARD_LED_TYPE == BOARD_LED_GPIO
#include "driver/gpio.h"
#endif

#if BOARD_HAS_LED && BOARD_LED_TYPE == BOARD_LED_WS2812
#include "led_strip.h"
#endif

static const char *TAG = "led_status";

/* Tick the renderer task at 50 ms (20 Hz). Smooth enough for the spinning
 * RGB working indicator and double-blink animations. */
#define LED_TICK_MS 50

/* Brightness ceiling for steady states; chosen empirically to be visible
 * but not blinding on a single 5050 WS2812 pixel. */
#define MAX_STEADY  32

/* Lower brightness for the working spinner so it reads as a soft pulse
 * rather than a strobe. */
#define MAX_WORKING 24

/* Brightness for double-blink result animations. */
#define MAX_BLINK   48

/* HID heartbeat overlay: full magenta for HEARTBEAT_FLASH_MS at the start
 * of every HEARTBEAT_PERIOD_MS window. */
#define HEARTBEAT_PERIOD_MS 5000
#define HEARTBEAT_FLASH_MS  80
#define HEARTBEAT_MAX       40

/* Idle blue blink: ON for IDLE_BLINK_ON_MS, OFF for IDLE_BLINK_OFF_MS,
 * repeating ~1 Hz. */
#define IDLE_BLINK_ON_MS   100
#define IDLE_BLINK_OFF_MS  900

/* AP-listening flash cadence: each cycle has cyan flash, then yellow flash
 * 500 ms later, repeating every 1 s. */
#define AP_FLASH_PERIOD_MS  1000
#define AP_FLASH_DURATION_MS 100

/* Working spinner: each colour segment lasts SPIN_SEGMENT_MS; full R→G→B→R
 * cycle takes SPIN_SEGMENT_MS * 3. Smoothly lerps between adjacent colours. */
#define SPIN_SEGMENT_MS  150

/* Double-blink timing: ON, OFF, ON, OFF gaps each DOUBLE_BLINK_STEP_MS. */
#define DOUBLE_BLINK_STEP_MS 100
#define DOUBLE_BLINK_TOTAL_MS (DOUBLE_BLINK_STEP_MS * 4)

/* Safety net: if a WORKING indication is left active for longer than this
 * (e.g. an esp_wifi_connect() that never produced an event), auto-trigger
 * a generic FAIL so the LED returns to reflecting real device state instead
 * of latching forever. Generous enough to cover slow scans / connects on
 * crowded networks. */
#define WORKING_WATCHDOG_MS 30000

/* ========================================================================= */
/*  Backend state                                                            */
/* ========================================================================= */

#if BOARD_HAS_LED && BOARD_LED_TYPE == BOARD_LED_WS2812
static led_strip_handle_t s_strip = NULL;
#endif

/* ========================================================================= */
/*  Public-facing state (single-writer-per-field, written from BLE/main      */
/*  contexts and read from the LED task; uint8_t/bool stores are atomic on   */
/*  Xtensa so no mutex required).                                            */
/* ========================================================================= */

typedef enum {
    BASE_FATAL,             /* fatal_error: red blink */
    BASE_IDLE,              /* nothing connected: blue blink */
    BASE_BLE,               /* BLE only: solid blue */
    BASE_BLE_AP_LISTENING,  /* BLE + AP, no client: blue + cyan/yellow flashes */
    BASE_BLE_AP_CONNECTED,  /* BLE + AP + client: solid cyan */
    BASE_AP_LISTENING,      /* AP only, no client: green base + cyan flash */
    BASE_AP_CONNECTED,      /* AP only + client: solid green */
    BASE_BLE_STA,           /* BLE + STA connected: solid cyan */
    BASE_STA,               /* STA only: solid green */
} led_base_t;

static volatile led_base_t s_base = BASE_IDLE;
static volatile bool s_hid_mounted = false;
static volatile kb_led_indication_t s_indication = KB_LED_IND_NONE;
static volatile uint32_t s_indication_started_ms = 0;

/* Free-running animation phase, advanced by the task on every tick. Used for
 * blink/breath cycles whose phase needs to persist across base changes. */
static uint32_t s_phase_ms = 0;

/* ========================================================================= */
/*  Color helpers                                                            */
/* ========================================================================= */

typedef struct { uint8_t r, g, b; } rgb_t;

static const rgb_t COLOR_BLACK   = {0, 0, 0};
#define MK(r,g,b) ((rgb_t){(r),(g),(b)})

static rgb_t rgb_scale(rgb_t c, uint8_t max)
{
    /* Scale a 0..255 colour vector down to 0..max while preserving hue. */
    return MK((uint8_t)(c.r * max / 255),
              (uint8_t)(c.g * max / 255),
              (uint8_t)(c.b * max / 255));
}

static rgb_t rgb_lerp(rgb_t a, rgb_t b, uint8_t t)
{
    /* t in 0..255: t=0 → a, t=255 → b */
    uint16_t inv = 255 - t;
    return MK((uint8_t)((a.r * inv + b.r * t) / 255),
              (uint8_t)((a.g * inv + b.g * t) / 255),
              (uint8_t)((a.b * inv + b.b * t) / 255));
}

/* ========================================================================= */
/*  Base layer rendering                                                     */
/* ========================================================================= */

static rgb_t render_base(led_base_t base, uint32_t phase_ms)
{
    switch (base) {
    case BASE_FATAL: {
        /* Red blink, ~2 Hz. */
        bool on = ((phase_ms / 250) & 1) == 0;
        return on ? rgb_scale(MK(255, 0, 0), MAX_STEADY) : COLOR_BLACK;
    }

    case BASE_IDLE: {
        /* Blue blink, ON for 100 ms every second. */
        uint32_t p = phase_ms % (IDLE_BLINK_ON_MS + IDLE_BLINK_OFF_MS);
        return (p < IDLE_BLINK_ON_MS)
                   ? rgb_scale(MK(0, 0, 255), MAX_STEADY)
                   : COLOR_BLACK;
    }

    case BASE_BLE:
        return rgb_scale(MK(0, 0, 255), MAX_STEADY);

    case BASE_BLE_AP_LISTENING: {
        /* Solid blue base, with a cyan flash at t=0 and a yellow flash at
         * t=500 ms within each 1 s cycle. */
        uint32_t p = phase_ms % AP_FLASH_PERIOD_MS;
        if (p < AP_FLASH_DURATION_MS) {
            return rgb_scale(MK(0, 255, 255), MAX_STEADY); /* cyan flash */
        }
        if (p >= AP_FLASH_PERIOD_MS / 2 &&
            p <  AP_FLASH_PERIOD_MS / 2 + AP_FLASH_DURATION_MS) {
            return rgb_scale(MK(255, 255, 0), MAX_STEADY); /* yellow flash */
        }
        return rgb_scale(MK(0, 0, 255), MAX_STEADY);       /* blue base */
    }

    case BASE_BLE_AP_CONNECTED:
    case BASE_BLE_STA:
        return rgb_scale(MK(0, 255, 255), MAX_STEADY); /* solid cyan */

    case BASE_AP_LISTENING: {
        /* Solid green base with a cyan flash at the start of each second. */
        uint32_t p = phase_ms % AP_FLASH_PERIOD_MS;
        if (p < AP_FLASH_DURATION_MS) {
            return rgb_scale(MK(0, 255, 255), MAX_STEADY);
        }
        return rgb_scale(MK(0, 255, 0), MAX_STEADY);
    }

    case BASE_AP_CONNECTED:
    case BASE_STA:
        return rgb_scale(MK(0, 255, 0), MAX_STEADY); /* solid green */
    }
    return COLOR_BLACK;
}

/* ========================================================================= */
/*  Indication layer rendering                                               */
/* ========================================================================= */

/* Render the spinning R→G→B working indicator. Returns a soft, low-intensity
 * colour that smoothly cycles through red, green, blue. */
static rgb_t render_working(uint32_t since_start_ms)
{
    uint32_t cycle = SPIN_SEGMENT_MS * 3;
    uint32_t p = since_start_ms % cycle;
    uint32_t seg = p / SPIN_SEGMENT_MS;
    uint8_t  t   = (uint8_t)((p % SPIN_SEGMENT_MS) * 255 / SPIN_SEGMENT_MS);

    rgb_t r = MK(255, 0, 0);
    rgb_t g = MK(0, 255, 0);
    rgb_t b = MK(0, 0, 255);

    rgb_t c;
    switch (seg) {
    case 0:  c = rgb_lerp(r, g, t); break;  /* red → green */
    case 1:  c = rgb_lerp(g, b, t); break;  /* green → blue */
    default: c = rgb_lerp(b, r, t); break;  /* blue → red */
    }
    return rgb_scale(c, MAX_WORKING);
}

/* Render a double-blink animation in the given colour. Returns the colour
 * to display at this offset, or BLACK after the animation has finished
 * (DOUBLE_BLINK_TOTAL_MS). */
static rgb_t render_double_blink(rgb_t color, uint32_t since_start_ms)
{
    if (since_start_ms >= DOUBLE_BLINK_TOTAL_MS) {
        return COLOR_BLACK; /* sentinel: animation done */
    }
    uint32_t step = since_start_ms / DOUBLE_BLINK_STEP_MS;
    /* Steps: 0=ON 1=OFF 2=ON 3=OFF */
    bool on = (step == 0 || step == 2);
    return on ? rgb_scale(color, MAX_BLINK) : COLOR_BLACK;
}

/* ========================================================================= */
/*  Compose the final colour for this tick                                   */
/* ========================================================================= */

static rgb_t compose(uint32_t now_ms)
{
    /* Start with the base layer. */
    rgb_t out = render_base(s_base, now_ms);

    /* Indication layer: replaces base if active. One-shots auto-clear, and
     * WORKING has a watchdog so it can never latch forever even if the
     * caller forgets to clear it (or the underlying op never completes). */
    kb_led_indication_t ind = s_indication;
    if (ind != KB_LED_IND_NONE) {
        uint32_t since = now_ms - s_indication_started_ms;
        switch (ind) {
        case KB_LED_IND_WORKING:
            if (since >= WORKING_WATCHDOG_MS) {
                /* Watchdog: nothing has cleared us. Treat as a failure
                 * and let the base layer take over after the blink. */
                s_indication = KB_LED_IND_FAIL;
                s_indication_started_ms = now_ms;
                /* Fall through to FAIL rendering on the next tick;
                 * for this tick just keep the spinner one more frame. */
            }
            out = render_working(since);
            break;
        case KB_LED_IND_SUCCESS: {
            rgb_t c = render_double_blink(MK(255, 255, 255), since);
            if (since >= DOUBLE_BLINK_TOTAL_MS) {
                s_indication = KB_LED_IND_NONE; /* one-shot complete */
            } else {
                out = c;
            }
            break;
        }
        case KB_LED_IND_FAIL_AUTH: {
            rgb_t c = render_double_blink(MK(255, 255, 0), since);
            if (since >= DOUBLE_BLINK_TOTAL_MS) {
                s_indication = KB_LED_IND_NONE;
            } else {
                out = c;
            }
            break;
        }
        case KB_LED_IND_FAIL: {
            rgb_t c = render_double_blink(MK(255, 0, 0), since);
            if (since >= DOUBLE_BLINK_TOTAL_MS) {
                s_indication = KB_LED_IND_NONE;
            } else {
                out = c;
            }
            break;
        }
        case KB_LED_IND_NONE:
            break;
        }
    }

    /* HID heartbeat overlay: brief magenta flash every 5 s when mounted.
     * Layered on top of everything else so the user always knows the host
     * is consuming HID reports. */
    if (s_hid_mounted) {
        uint32_t hp = now_ms % HEARTBEAT_PERIOD_MS;
        if (hp < HEARTBEAT_FLASH_MS) {
            out = rgb_scale(MK(255, 0, 255), HEARTBEAT_MAX);
        }
    }

    return out;
}

/* ========================================================================= */
/*  Backend dispatch -- write the composed colour to the actual hardware     */
/* ========================================================================= */

static void backend_write(rgb_t c)
{
#if !BOARD_HAS_LED
    (void)c;

#elif BOARD_LED_TYPE == BOARD_LED_GPIO
    bool on = (c.r | c.g | c.b) != 0;
#if BOARD_LED_ACTIVE_LOW
    gpio_set_level(BOARD_LED_PIN, on ? 0 : 1);
#else
    gpio_set_level(BOARD_LED_PIN, on ? 1 : 0);
#endif

#elif BOARD_LED_TYPE == BOARD_LED_WS2812
    if (s_strip) {
#if defined(BOARD_LED_PIXEL_RGB) && BOARD_LED_PIXEL_RGB
        /* Some clones (SuperMini) wire an RGB-order LED but the led_strip
         * driver only supports GRB on the wire, so swap r and g here so the
         * visible colour matches what the renderer asked for. */
        led_strip_set_pixel(s_strip, 0, c.g, c.r, c.b);
#else
        led_strip_set_pixel(s_strip, 0, c.r, c.g, c.b);
#endif
        led_strip_refresh(s_strip);
    }
#endif
}

/* ========================================================================= */
/*  Animation task                                                           */
/* ========================================================================= */

static void led_task(void *arg)
{
    (void)arg;
    TickType_t last_wake = xTaskGetTickCount();
    while (1) {
        s_phase_ms += LED_TICK_MS;
        rgb_t c = compose(s_phase_ms);
        backend_write(c);
        vTaskDelayUntil(&last_wake, pdMS_TO_TICKS(LED_TICK_MS));
    }
}

/* ========================================================================= */
/*  Public API                                                               */
/* ========================================================================= */

esp_err_t led_status_init(void)
{
#if !BOARD_HAS_LED
    ESP_LOGI(TAG, "No LED on this board");
    return ESP_OK;

#elif BOARD_LED_TYPE == BOARD_LED_GPIO
    gpio_config_t io_conf = {
        .pin_bit_mask = (1ULL << BOARD_LED_PIN),
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    gpio_config(&io_conf);
#if BOARD_LED_ACTIVE_LOW
    gpio_set_level(BOARD_LED_PIN, 1);
#else
    gpio_set_level(BOARD_LED_PIN, 0);
#endif
    ESP_LOGI(TAG, "GPIO LED initialized on pin %d", BOARD_LED_PIN);

#elif BOARD_LED_TYPE == BOARD_LED_WS2812
    led_strip_config_t strip_cfg = {
        .strip_gpio_num = BOARD_LED_PIN,
        .max_leds = 1,
        /* Driver only exposes GRB/GRBW on the wire. RGB-order clone LEDs are
         * handled by swapping r↔g in backend_write() instead. */
        .led_pixel_format = LED_PIXEL_FORMAT_GRB,
        .led_model = LED_MODEL_WS2812,
        .flags = { .invert_out = 0 },
    };
    led_strip_rmt_config_t rmt_cfg = {
        .clk_src = RMT_CLK_SRC_DEFAULT,
        .resolution_hz = 10 * 1000 * 1000,
        .mem_block_symbols = 0,
        .flags = { .with_dma = 0 },
    };
    esp_err_t err = led_strip_new_rmt_device(&strip_cfg, &rmt_cfg, &s_strip);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "led_strip init failed: %s", esp_err_to_name(err));
        return err;
    }
    led_strip_clear(s_strip);
    ESP_LOGI(TAG, "WS2812 LED initialized on GPIO %d", BOARD_LED_PIN);
#endif

#if BOARD_HAS_LED
    BaseType_t ok = xTaskCreate(led_task, "led_status", 2048, NULL, 3, NULL);
    if (ok != pdPASS) {
        ESP_LOGE(TAG, "Failed to spawn LED animation task");
        return ESP_ERR_NO_MEM;
    }
#endif
    return ESP_OK;
}

void led_status_set_link(bool ble_connected,
                         bool wifi_sta_connected,
                         bool wifi_ap_active,
                         bool wifi_ap_has_client,
                         bool fatal_error)
{
    led_base_t b;
    if (fatal_error) {
        b = BASE_FATAL;
    } else if (ble_connected && wifi_sta_connected) {
        b = BASE_BLE_STA;
    } else if (ble_connected && wifi_ap_active && wifi_ap_has_client) {
        b = BASE_BLE_AP_CONNECTED;
    } else if (ble_connected && wifi_ap_active) {
        b = BASE_BLE_AP_LISTENING;
    } else if (ble_connected) {
        b = BASE_BLE;
    } else if (wifi_sta_connected) {
        b = BASE_STA;
    } else if (wifi_ap_active && wifi_ap_has_client) {
        b = BASE_AP_CONNECTED;
    } else if (wifi_ap_active) {
        b = BASE_AP_LISTENING;
    } else {
        b = BASE_IDLE;
    }
    s_base = b;
}

void led_status_set_hid_mounted(bool mounted)
{
    s_hid_mounted = mounted;
}

void led_status_indicate(kb_led_indication_t kind)
{
    s_indication = kind;
    s_indication_started_ms = s_phase_ms;
}
