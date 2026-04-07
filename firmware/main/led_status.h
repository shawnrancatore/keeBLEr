// SPDX-License-Identifier: MIT
/*
 * Keebler LED Status Indicator
 *
 * Three-layer status model:
 *
 *   1. BASE COLOR (long-running, derived from BLE/WiFi link state)
 *      - Idle (no BLE, no WiFi):              blue blink ~1 Hz
 *      - BLE only:                            solid blue
 *      - BLE + AP listening (no client):      blue base + cyan/yellow flashes
 *      - BLE + AP with client connected:      solid cyan
 *      - AP listening, no BLE:                green base + cyan flash
 *      - AP with client, no BLE:              solid green
 *      - BLE + WiFi STA connected:            solid cyan
 *      - WiFi STA connected, no BLE:          solid green
 *      - Fatal error (init failure):          red blink
 *
 *   2. TRANSIENT INDICATION (one-shot or continuous overlay on the base)
 *      - WORKING:    spinning R→G→B at low intensity (loops until cleared)
 *      - SUCCESS:    double white blink, then revert to base
 *      - FAIL_AUTH:  double yellow blink, then revert to base
 *      - FAIL:       double red blink, then revert to base
 *
 *   3. HID HEARTBEAT OVERLAY
 *      - When the host has the USB HID composite mounted, a brief magenta
 *        flash every 5 seconds is layered on top of whatever else is showing.
 *
 * The colour semantics are deliberate: the BLUE channel reflects BLE state,
 * the GREEN channel reflects WiFi state, and CYAN naturally results when
 * both are active. The magenta heartbeat tells you the host is actually
 * consuming HID reports.
 *
 * On boards with a simple GPIO LED (XIAO, DevKitC-1) the renderer collapses
 * to on/off based on whether any colour channel is non-zero, so the same
 * code path works everywhere.
 */

#ifndef KEEBLER_LED_STATUS_H
#define KEEBLER_LED_STATUS_H

#include <stdint.h>
#include <stdbool.h>
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

/* Transient indications -- triggered at the start, end, or duration of work
 * the firmware is doing. Most are one-shot (play, then revert to base color).
 * WORKING is the only looping indication, used while the firmware is busy
 * with something it has not yet reported a result for. */
typedef enum {
    KB_LED_IND_NONE,        /* clear any active indication */
    KB_LED_IND_WORKING,     /* spinning RGB; loops until cleared or replaced */
    KB_LED_IND_SUCCESS,     /* double white blink, then revert */
    KB_LED_IND_FAIL_AUTH,   /* double yellow blink, then revert (bad creds) */
    KB_LED_IND_FAIL,        /* double red blink, then revert (other failure) */
} kb_led_indication_t;

/**
 * Initialize the LED hardware and start the background animation task.
 * Safe to call when BOARD_HAS_LED is 0 -- becomes a no-op.
 */
esp_err_t led_status_init(void);

/**
 * Update the link-layer flags that determine the base colour.
 * Call this from the main loop every iteration. Cheap; only re-renders if
 * the resulting base actually changed.
 *
 * @param ble_connected      A BLE central is currently connected.
 * @param wifi_sta_connected WiFi station mode is associated with an AP.
 * @param wifi_ap_active     The device is hosting an AP.
 * @param wifi_ap_has_client At least one client is associated with the AP.
 * @param fatal_error        Set if the firmware hit a non-recoverable error
 *                           (e.g. hid_bridge_init failed). Forces red blink
 *                           regardless of the other flags.
 */
void led_status_set_link(bool ble_connected,
                         bool wifi_sta_connected,
                         bool wifi_ap_active,
                         bool wifi_ap_has_client,
                         bool fatal_error);

/**
 * Notify the LED layer about USB HID mount state. When mounted, a brief
 * magenta heartbeat is overlaid every 5 seconds to indicate that the host
 * is actually consuming HID reports.
 */
void led_status_set_hid_mounted(bool mounted);

/**
 * Trigger a transient indication. The new indication replaces any
 * currently-active one. Pass KB_LED_IND_NONE to clear (reverting to base).
 *
 * Typical use:
 *   - on a long-running operation start: indicate(WORKING)
 *   - on success:                        indicate(SUCCESS)
 *   - on bad-auth failure:               indicate(FAIL_AUTH)
 *   - on any other failure:              indicate(FAIL)
 */
void led_status_indicate(kb_led_indication_t kind);

#ifdef __cplusplus
}
#endif

#endif /* KEEBLER_LED_STATUS_H */
