// SPDX-License-Identifier: MIT
/*
 * Keebler USB HID Bridge
 *
 * USB HID device supporting two modes:
 *   Mode 0 (HID_MODE_BOOT_KB):   Boot protocol keyboard only, no report IDs.
 *   Mode 1 (HID_MODE_COMPOSITE): Composite keyboard + mouse with report IDs.
 */

#ifndef KEEBLER_HID_BRIDGE_H
#define KEEBLER_HID_BRIDGE_H

#include <stdbool.h>
#include <stdint.h>
#include "esp_err.h"
#include "protocol.h"

#ifdef __cplusplus
extern "C" {
#endif

/* Single HID interface */
#define HID_ITF_NUM         0

/* Report IDs (used in composite mode only) */
#define REPORT_ID_KEYBOARD  1
#define REPORT_ID_MOUSE     2

/* HID mode constants */
#define HID_MODE_BOOT_KB    0
#define HID_MODE_COMPOSITE  1

/**
 * Initialize TinyUSB with the given HID mode.
 * @param mode  HID_MODE_BOOT_KB or HID_MODE_COMPOSITE
 * @return ESP_OK on success.
 */
esp_err_t hid_bridge_init(uint8_t mode);

/**
 * Get the current HID mode.
 * @return HID_MODE_BOOT_KB or HID_MODE_COMPOSITE
 */
uint8_t hid_bridge_get_mode(void);

/**
 * Send a keyboard HID report.
 * @param report  Pointer to keyboard report structure.
 * @return ESP_OK on success.
 */
esp_err_t hid_bridge_send_keyboard_report(const kb_keyboard_report_t *report);

/**
 * Send a mouse HID report.
 * In boot keyboard mode (mode 0), returns ESP_ERR_NOT_SUPPORTED.
 * @param report  Pointer to mouse report structure.
 * @return ESP_OK on success.
 */
esp_err_t hid_bridge_send_mouse_report(const kb_mouse_report_t *report);

/**
 * Process an incoming protocol packet and dispatch to the appropriate HID report.
 * Handles KB_PKT_KEYBOARD_REPORT and KB_PKT_MOUSE_REPORT.
 * @param pkt  Pointer to the parsed packet.
 * @return ESP_OK on success, ESP_ERR_INVALID_ARG for unknown types.
 */
esp_err_t hid_bridge_process_packet(const kb_packet_t *pkt);

/**
 * Check if the USB device is mounted and ready to send reports.
 */
bool hid_bridge_is_ready(void);

#ifdef __cplusplus
}
#endif

#endif /* KEEBLER_HID_BRIDGE_H */
