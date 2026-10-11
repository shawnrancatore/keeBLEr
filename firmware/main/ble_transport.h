// SPDX-License-Identifier: MIT
/*
 * Keebler BLE Transport
 *
 * Custom GATT service for bidirectional packet transport over BLE using NimBLE.
 *
 * Note: Functions use "kb_ble_" prefix to avoid namespace collision with
 * NimBLE's internal ble_transport_* symbols.
 */

#ifndef KEEBLER_BLE_TRANSPORT_H
#define KEEBLER_BLE_TRANSPORT_H

#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>
#include "esp_err.h"
#include "protocol.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Callback type for received packets from BLE.
 * Called from the BLE task context when a complete, valid frame is parsed.
 * @param pkt       Pointer to the parsed packet.
 * @param user_ctx  User context pointer set via kb_ble_set_rx_callback.
 */
typedef void (*kb_ble_rx_cb_t)(const kb_packet_t *pkt, void *user_ctx);

/**
 * Initialize NimBLE and register the keebler GATT service.
 * Must be called after NVS is initialized.
 */
esp_err_t kb_ble_init(void);

/**
 * Send raw data over BLE (TX characteristic notify).
 * Data should already be a packed protocol frame.
 * @param data  Pointer to frame data.
 * @param len   Length of frame data.
 * @return ESP_OK on success, ESP_ERR_INVALID_STATE if not connected.
 */
esp_err_t kb_ble_send(const uint8_t *data, size_t len);

/**
 * Send a packed protocol frame over BLE.
 * Convenience wrapper that packs and sends.
 * @param type     Packet type.
 * @param payload  Payload data (may be NULL if payload_len is 0).
 * @param payload_len  Length of payload.
 * @return ESP_OK on success.
 */
esp_err_t kb_ble_send_packet(uint8_t type, const uint8_t *payload, uint8_t payload_len);

/**
 * Set the callback for received packets.
 * @param cb       Callback function.
 * @param user_ctx User context passed to callback.
 */
void kb_ble_set_rx_callback(kb_ble_rx_cb_t cb, void *user_ctx);

/**
 * Check if a BLE client is connected.
 */
bool kb_ble_is_connected(void);

/**
 * Callback for link changes. Called with true when a central has connected,
 * and with false when it has gone. Runs in the NimBLE host task: do not block.
 */
typedef void (*kb_ble_conn_cb_t)(bool connected, void *user_ctx);

/** Set the link-change callback. Call before kb_ble_init. */
void kb_ble_set_conn_callback(kb_ble_conn_cb_t cb, void *user_ctx);

/**
 * Drop the current connection. Safe to call from any task.
 * @return ESP_OK if a disconnect was started (or is already under way),
 *         ESP_ERR_INVALID_STATE if nothing is connected.
 */
esp_err_t kb_ble_disconnect(void);

#ifdef __cplusplus
}
#endif

#endif /* KEEBLER_BLE_TRANSPORT_H */
