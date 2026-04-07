// SPDX-License-Identifier: MIT
/*
 * Keebler WiFi BLE-to-HTTP Proxy
 *
 * Provides WiFi STA management (scan, connect, disconnect) and an HTTP proxy
 * that executes requests received over BLE and streams responses back.
 *
 * WiFi stays OFF at boot.  Only starts on WIFI_CONNECT_REQ with a valid token.
 * Token security: 16-byte random token stored in NVS, expires after ~60 boots
 * without valid use.
 */

#ifndef KEEBLER_WIFI_PROXY_H
#define KEEBLER_WIFI_PROXY_H

#include <stdbool.h>
#include "esp_err.h"
#include "protocol.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Initialize the WiFi proxy subsystem.
 * Creates the command queue and worker task.
 * Does NOT start WiFi -- that happens on demand via WIFI_CONNECT_REQ.
 * Must be called after NVS is initialized.
 * @return ESP_OK on success.
 */
esp_err_t kb_wifi_init(void);

/**
 * Process an incoming WiFi or HTTP proxy packet.
 * Called from the BLE/UART packet callback context.
 * Handles packet types 0x40-0x58.
 * @param pkt       Pointer to the parsed packet.
 * @param transport KB_TRANSPORT_BLE or KB_TRANSPORT_UART.
 */
void kb_wifi_process_packet(const kb_packet_t *pkt, uint8_t transport);

/**
 * Check if WiFi STA is connected and has an IP address.
 * @return true if connected.
 */
bool kb_wifi_is_connected(void);

/**
 * Get the current WiFi state (KB_WIFI_STATE_* from protocol.h).
 * Useful for the LED status indicator to distinguish STA vs AP mode.
 */
uint8_t kb_wifi_get_state(void);

/**
 * Number of clients currently associated with the WiFi AP.
 * Returns 0 when AP mode is off or has no clients. Used by the LED status
 * layer to distinguish "AP listening" from "AP with client connected".
 */
uint8_t kb_wifi_get_ap_client_count(void);

#ifdef __cplusplus
}
#endif

#endif /* KEEBLER_WIFI_PROXY_H */
