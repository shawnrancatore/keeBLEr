// SPDX-License-Identifier: MIT
/*
 * Keebler Board Configuration
 *
 * Defines pin mappings and hardware capabilities per board variant.
 * Select a board at build time via -DKEEBLER_BOARD=<name> (see main/CMakeLists.txt).
 * Default: BOARD_DEVKITC1
 *
 * Pin assignments summary
 * ----------------------------------------------------------------------------------
 * Signal          | DevKitC-1 (GPIO) | XIAO ESP32S3 (GPIO) | Generic S3 (GPIO)
 * ----------------------------------------------------------------------------------
 * Status LED      | 48 (active-high) | 21 (active-low)     | (none)
 * UART TX         | 17               | 1  (D0/A0 pad)      | 17
 * UART RX         | 18               | 2  (D1/A1 pad)      | 18
 * BOOT button     | 0                | 0                    | 0
 * USB D+          | 20               | 20                   | 20
 * USB D-          | 19               | 19                   | 19
 * ----------------------------------------------------------------------------------
 */

#ifndef KEEBLER_BOARD_CONFIG_H
#define KEEBLER_BOARD_CONFIG_H

#include "protocol.h"

#ifdef __cplusplus
extern "C" {
#endif

/* ---------- Board selection ---------- */
/* Define one of:
 *   BOARD_DEVKITC1   - ESP32-S3-DevKitC-1 (development)
 *   BOARD_XIAO_S3    - Seeed XIAO ESP32S3 (production)
 *   BOARD_GENERIC_S3 - Generic ESP32-S3 devboard
 * Default to BOARD_DEVKITC1 if none is defined. */

#if !defined(BOARD_DEVKITC1) && !defined(BOARD_XIAO_S3) && !defined(BOARD_GENERIC_S3)
#define BOARD_DEVKITC1
#endif

/* ---------- DevKitC-1 configuration ---------- */

#ifdef BOARD_DEVKITC1

#define BOARD_NAME          "ESP32-S3-DevKitC-1"
#define BOARD_TYPE          KB_BOARD_DEVKITC1

/* Status LED - DevKitC-1 has an addressable LED on GPIO 48 (active high) */
#define BOARD_HAS_LED       1
#define BOARD_LED_PIN       48

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
#define BOARD_LED_PIN       21

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

/* ---------- Generic ESP32-S3 configuration ---------- */

#ifdef BOARD_GENERIC_S3

#define BOARD_NAME          "Generic ESP32-S3"
#define BOARD_TYPE          KB_BOARD_GENERIC_S3

/* No LED */
#define BOARD_HAS_LED       0

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
