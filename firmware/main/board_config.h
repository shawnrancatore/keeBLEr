// SPDX-License-Identifier: MIT
/*
 * Keebler Board Configuration
 *
 * Defines pin mappings and hardware capabilities per board variant.
 * Select a board at build time via -DKEEBLER_BOARD=<name> (see main/CMakeLists.txt).
 * Default: BOARD_DEVKITC1
 *
 * Pin assignments summary
 * ------------------------------------------------------------------------------------------------------
 * Signal          | DevKitC-1   | XIAO S3      | QT Py S3      | SuperMini S3 | Generic S3
 * ------------------------------------------------------------------------------------------------------
 * Status LED      | 48 (WS2812) | 21 (gpio-lo) | 39 (NeoPixel) | 48 (WS2812)  | (none)
 * LED type        | gpio        | gpio         | gpio          | ws2812       | none
 * LED power gate  | (n/a)       | (n/a)        | 38            | (n/a)        | (n/a)
 * UART TX         | 17          | 1 (D0/A0)    | 5 (A3/SCK)    | 5            | 17
 * UART RX         | 18          | 2 (D1/A1)    | 16 (A2/MISO)  | 6            | 18
 * BOOT button     | 0           | 0            | 0             | 0            | 0
 * USB D+          | 20          | 20           | 20            | 20           | 20
 * USB D-          | 19          | 19           | 19            | 19           | 19
 * ------------------------------------------------------------------------------------------------------
 *
 * NOTE: DevKitC-1 actually has a WS2812 on GPIO 48 too, but the current
 * firmware drives it as a plain GPIO (which produces undefined output).
 * Switching DevKitC-1 to ws2812 LED type would also enable real RGB on it.
 * For now, only SuperMini uses the WS2812 path.
 */

#ifndef KEEBLER_BOARD_CONFIG_H
#define KEEBLER_BOARD_CONFIG_H

#include "protocol.h"

#ifdef __cplusplus
extern "C" {
#endif

/* ---------- LED type enum ----------
 * Each board declares its LED type so main.c can dispatch to the right driver.
 *
 *   BOARD_LED_NONE    - no status LED
 *   BOARD_LED_GPIO    - simple digital GPIO LED (active-high or active-low)
 *   BOARD_LED_WS2812  - addressable RGB NeoPixel via led_strip / RMT
 */
#define BOARD_LED_NONE   0
#define BOARD_LED_GPIO   1
#define BOARD_LED_WS2812 2

/* ---------- Board selection ---------- */
/* Define one of:
 *   BOARD_DEVKITC1     - ESP32-S3-DevKitC-1 (development)
 *   BOARD_XIAO_S3      - Seeed XIAO ESP32S3 (production)
 *   BOARD_QTPY_S3      - Adafruit QT Py ESP32-S3
 *   BOARD_SUPERMINI_S3 - ESP32-S3 SuperMini (white-label product candidate)
 *   BOARD_GENERIC_S3   - Generic ESP32-S3 devboard
 * Default to BOARD_DEVKITC1 if none is defined. */

#if !defined(BOARD_DEVKITC1) && !defined(BOARD_XIAO_S3) && !defined(BOARD_QTPY_S3) && \
    !defined(BOARD_SUPERMINI_S3) && !defined(BOARD_GENERIC_S3)
#define BOARD_DEVKITC1
#endif

/* ---------- DevKitC-1 configuration ---------- */

#ifdef BOARD_DEVKITC1

#define BOARD_NAME          "ESP32-S3-DevKitC-1"
#define BOARD_TYPE          KB_BOARD_DEVKITC1

/* Status LED - DevKitC-1 actually has a WS2812 on GPIO 48, but we drive
 * it as plain GPIO here for backward compatibility. The SuperMini board
 * uses the WS2812 path properly. */
#define BOARD_HAS_LED       1
#define BOARD_LED_TYPE      BOARD_LED_GPIO
#define BOARD_LED_PIN       48
#define BOARD_LED_ACTIVE_LOW 0

/* UART transport pins.
 * On DevKitC-1, UART0 is used for console/flashing (GPIO 43=TX, 44=RX).
 * We use UART1 for the serial transport to avoid conflicts. */
#define BOARD_UART_NUM      UART_NUM_1
#define BOARD_UART_TX_PIN   17
#define BOARD_UART_RX_PIN   18

/* Boot button */
#define BOARD_BOOT_BTN_PIN  0

/* USB: DevKitC-1 uses the built-in USB-OTG on GPIO 19 (D-) / GPIO 20 (D+) */
#define BOARD_USB_DP_PIN    20
#define BOARD_USB_DM_PIN    19

#endif /* BOARD_DEVKITC1 */

/* ---------- XIAO ESP32S3 configuration ---------- */

#ifdef BOARD_XIAO_S3

#define BOARD_NAME          "XIAO ESP32S3"
#define BOARD_TYPE          KB_BOARD_XIAO_S3

/* Status LED - XIAO has a user LED on GPIO 21 (active low) */
#define BOARD_HAS_LED       1
#define BOARD_LED_TYPE      BOARD_LED_GPIO
#define BOARD_LED_PIN       21
#define BOARD_LED_ACTIVE_LOW 1

/* UART transport pins.
 * GPIO 43/44 are UART0 console pins — cannot reuse for UART1.
 * Use GPIO 1 (D0/A0) and GPIO 2 (D1/A1) which are exposed on XIAO pads.
 * Serial transport is secondary on XIAO since BLE is primary. */
#define BOARD_UART_NUM      UART_NUM_1
#define BOARD_UART_TX_PIN   1
#define BOARD_UART_RX_PIN   2

/* Boot button */
#define BOARD_BOOT_BTN_PIN  0

/* USB: XIAO uses the built-in USB-OTG */
#define BOARD_USB_DP_PIN    20
#define BOARD_USB_DM_PIN    19

#endif /* BOARD_XIAO_S3 */

/* ---------- Adafruit QT Py ESP32-S3 configuration ---------- */

#ifdef BOARD_QTPY_S3

#define BOARD_NAME          "QT Py ESP32-S3"
#define BOARD_TYPE          KB_BOARD_QTPY_S3

/* NeoPixel LED on GPIO 39, powered by gate on GPIO 38.
 * For simplicity, LED is disabled here. To enable, set BOARD_LED_TYPE to
 * BOARD_LED_WS2812 and ensure GPIO 38 is driven HIGH to power the NeoPixel. */
#define BOARD_HAS_LED       0
#define BOARD_LED_TYPE      BOARD_LED_NONE
#define BOARD_NEOPIXEL_PIN  39
#define BOARD_NEOPIXEL_PWR  38

/* UART transport pins.
 * QT Py exposes SPI pins that we repurpose for UART:
 * GPIO 5 (SCK/A3) for TX, GPIO 16 (MISO/A2) for RX.
 * These are on the header pads and accessible. */
#define BOARD_UART_NUM      UART_NUM_1
#define BOARD_UART_TX_PIN   5
#define BOARD_UART_RX_PIN   16

/* Boot button — GPIO 0, labeled "BOOT" on QT Py */
#define BOARD_BOOT_BTN_PIN  0

/* USB: built-in USB-OTG (same as all ESP32-S3) */
#define BOARD_USB_DP_PIN    20
#define BOARD_USB_DM_PIN    19

#endif /* BOARD_QTPY_S3 */

/* ---------- ESP32-S3 SuperMini configuration ----------
 *
 * Reference: https://www.espboards.dev/esp32/esp32-s3-super-mini/
 *
 * The "ESP32-S3 SuperMini" is a tiny (~22.5 x 18 mm) ESP32-S3 dev board
 * sold under various names on AliExpress and Amazon. It is the white-label
 * candidate for the keeBLEr hardware product (codename "ernie").
 *
 * Hardware highlights:
 *   - ESP32-S3FH4R2 (4 MB embedded flash, 2 MB embedded PSRAM)
 *   - Native USB-C, USB-Serial-JTAG works for both flashing and HID
 *   - WS2812 RGB NeoPixel on GPIO 48 (single LED, common-anode style)
 *   - BOOT button (GPIO 0) and RESET button on board
 *   - External antenna connector on some variants
 *
 * The RGB LED is the killer feature for keeBLEr: we use it to display
 * connection state at a glance via color (see led_status.c):
 *   - Idle:                dim white pulse
 *   - BLE advertising:     blue slow pulse
 *   - BLE connected:       solid blue
 *   - WiFi STA connected:  green tint added
 *   - WiFi AP active:      cyan tint added
 *   - Fully operational:   solid magenta
 *   - Error:               red blink
 */

#ifdef BOARD_SUPERMINI_S3

#define BOARD_NAME          "ESP32-S3 SuperMini"
#define BOARD_TYPE          KB_BOARD_SUPERMINI_S3

/* WS2812-compatible RGB LED on GPIO 48.
 * Note: the SuperMini's LED chip uses RGB byte order on the wire, NOT the
 * standard WS2812 GRB order. Without the override below, red and green show
 * up swapped. Verified empirically on real hardware. */
#define BOARD_HAS_LED       1
#define BOARD_LED_TYPE      BOARD_LED_WS2812
#define BOARD_LED_PIN       48
#define BOARD_LED_PIXEL_RGB 1

/* UART transport pins. The SuperMini exposes most GPIOs on its headers.
 * GPIO 5/6 are used here as they are commonly free on the SuperMini pinout. */
#define BOARD_UART_NUM      UART_NUM_1
#define BOARD_UART_TX_PIN   5
#define BOARD_UART_RX_PIN   6

/* BOOT button — GPIO 0 (standard) */
#define BOARD_BOOT_BTN_PIN  0

/* USB D+/D- — fixed on all ESP32-S3 */
#define BOARD_USB_DP_PIN    20
#define BOARD_USB_DM_PIN    19

#endif /* BOARD_SUPERMINI_S3 */

/* ---------- Generic ESP32-S3 configuration ---------- */

#ifdef BOARD_GENERIC_S3

#define BOARD_NAME          "Generic ESP32-S3"
#define BOARD_TYPE          KB_BOARD_GENERIC_S3

/* No LED */
#define BOARD_HAS_LED       0
#define BOARD_LED_TYPE      BOARD_LED_NONE

/* UART transport on commonly available pins.
 * GPIO 17 (TX) and GPIO 18 (RX) are typical on most ESP32-S3 devboards. */
#define BOARD_UART_NUM      UART_NUM_1
#define BOARD_UART_TX_PIN   17
#define BOARD_UART_RX_PIN   18

/* Boot button — GPIO 0 is standard boot strapping pin on virtually all boards */
#define BOARD_BOOT_BTN_PIN  0

/* USB D+/D- — fixed on all ESP32-S3 */
#define BOARD_USB_DP_PIN    20
#define BOARD_USB_DM_PIN    19

#endif /* BOARD_GENERIC_S3 */

/* ---------- Common USB configuration ---------- */

#define BOARD_USB_VID       0x1209  /* pid.codes test VID */
#define BOARD_USB_PID       0x4B42  /* "KB" for keebler */
#define BOARD_USB_BCD       0x0100

/* ---------- Common UART configuration ---------- */

#define BOARD_UART_BAUD     115200
#define BOARD_UART_BUF_SIZE 1024

#ifdef __cplusplus
}
#endif

#endif /* KEEBLER_BOARD_CONFIG_H */
