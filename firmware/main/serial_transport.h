// SPDX-License-Identifier: MIT
/*
 * Keebler Serial Transport
 *
 * UART-based packet transport using the keebler protocol.
 */

#ifndef KEEBLER_SERIAL_TRANSPORT_H
#define KEEBLER_SERIAL_TRANSPORT_H

#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>
#include "esp_err.h"
#include "protocol.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Callback type for received packets from UART.
 * Called from the UART RX task context when a complete, valid frame is parsed.
 * @param pkt       Pointer to the parsed packet.
 * @param user_ctx  User context pointer set via serial_transport_set_rx_callback.
 */
typedef void (*serial_transport_rx_cb_t)(const kb_packet_t *pkt, void *user_ctx);

/**
 * Initialize UART driver and start the RX task.
 * Uses board-specific UART number and pins from board_config.h.
 */
esp_err_t serial_transport_init(void);

/**
 * Send raw data over UART.
 * Data should already be a packed protocol frame.
 * @param data  Pointer to frame data.
 * @param len   Length of frame data.
 * @return ESP_OK on success.
 */
esp_err_t serial_transport_send(const uint8_t *data, size_t len);

/**
 * Send a packed protocol frame over UART.
 * Convenience wrapper that packs and sends.
 * @param type        Packet type.
 * @param payload     Payload data (may be NULL if payload_len is 0).
 * @param payload_len Length of payload.
 * @return ESP_OK on success.
 */
esp_err_t serial_transport_send_packet(uint8_t type, const uint8_t *payload, uint8_t payload_len);

/**
 * Set the callback for received packets.
 * @param cb       Callback function.
 * @param user_ctx User context passed to callback.
 */
void serial_transport_set_rx_callback(serial_transport_rx_cb_t cb, void *user_ctx);

#ifdef __cplusplus
}
#endif

#endif /* KEEBLER_SERIAL_TRANSPORT_H */
