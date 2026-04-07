// SPDX-License-Identifier: MIT
/*
 * Keebler Packet Protocol
 *
 * Frame format: [MAGIC][LENGTH][TYPE][PAYLOAD...][CRC8]
 *   MAGIC  = 0x4B
 *   LENGTH = total payload length (not including MAGIC, LENGTH, TYPE, CRC8)
 *   TYPE   = packet type
 *   CRC8   = CRC-8 (poly 0x07) over TYPE + PAYLOAD bytes
 */

#ifndef KEEBLER_PROTOCOL_H
#define KEEBLER_PROTOCOL_H

#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

/* ---------- Constants ---------- */

#define KB_MAGIC                0x4B
#define KB_PROTOCOL_VERSION     1

/* Firmware version — bump on every release */
#define KB_VERSION_MAJOR        1
#define KB_VERSION_MINOR        3
#define KB_VERSION_PATCH        0
#define KB_VERSION_STRING       "1.3.0"
#define KB_MAX_PAYLOAD          128
/* Frame overhead: MAGIC(1) + LENGTH(1) + TYPE(1) + CRC8(1) = 4 */
#define KB_FRAME_OVERHEAD       4
#define KB_MAX_FRAME_SIZE       (KB_MAX_PAYLOAD + KB_FRAME_OVERHEAD)

/* ---------- Packet types ---------- */

#define KB_PKT_KEYBOARD_REPORT  0x01
#define KB_PKT_MOUSE_REPORT     0x02
#define KB_PKT_STATUS_REQUEST   0x10
#define KB_PKT_STATUS_RESPONSE  0x11
#define KB_PKT_HEARTBEAT        0x20
#define KB_PKT_HEARTBEAT_ACK    0x21
/* WiFi management (0x40-0x48) */
#define KB_PKT_WIFI_SCAN_REQ       0x40
#define KB_PKT_WIFI_SCAN_RESULT    0x41
#define KB_PKT_WIFI_SCAN_DONE      0x42
#define KB_PKT_WIFI_CONNECT_REQ    0x43
#define KB_PKT_WIFI_STATUS         0x44
#define KB_PKT_WIFI_DISCONNECT_REQ 0x45
#define KB_PKT_WIFI_TOKEN_VALIDATE 0x46
#define KB_PKT_WIFI_TOKEN_RESPONSE 0x47
#define KB_PKT_WIFI_FORGET_REQ     0x48
#define KB_PKT_WIFI_AP_START       0x49  /* Start AP mode: token(16) ssid_len(1) ssid pass_len(1) pass */
#define KB_PKT_WIFI_AP_EVENT       0x4A  /* AP client event: event(1) mac(6) ip(4) */

/* HTTP proxy (0x50-0x58) */
#define KB_PKT_HTTP_REQUEST        0x50
#define KB_PKT_HTTP_REQUEST_HEADER 0x51
#define KB_PKT_HTTP_REQUEST_BODY   0x52
#define KB_PKT_HTTP_REQUEST_END    0x53
#define KB_PKT_HTTP_RESPONSE_STATUS 0x54
#define KB_PKT_HTTP_RESPONSE_BODY  0x55
#define KB_PKT_HTTP_RESPONSE_DONE  0x56
#define KB_PKT_HTTP_REQUEST_URL_CONT 0x57
#define KB_PKT_HTTP_ERROR          0x58

#define KB_PKT_ACK              0xFE
#define KB_PKT_ECHO             0xFF

/* ---------- Payload sizes ---------- */

#define KB_KEYBOARD_REPORT_LEN  8   /* modifiers(1) + reserved(1) + keycodes(6) */
#define KB_MOUSE_REPORT_LEN     5   /* buttons(1) + dx(1) + dy(1) + wheel(1) + pan(1) */
#define KB_STATUS_REQUEST_LEN   0
#define KB_STATUS_RESPONSE_LEN  4   /* version(1) + board_type(1) + transport(1) + last_error(1) */
#define KB_HEARTBEAT_LEN        1   /* sequence(1) */
#define KB_HEARTBEAT_ACK_LEN    1   /* sequence(1) */
#define KB_ACK_LEN              1   /* status(1) */

/* ---------- Board types ---------- */

#define KB_BOARD_DEVKITC1       1
#define KB_BOARD_XIAO_S3        2
#define KB_BOARD_GENERIC_S3     3
#define KB_BOARD_QTPY_S3        4
#define KB_BOARD_SUPERMINI_S3   5

/* ---------- Transport types ---------- */

#define KB_TRANSPORT_NONE       0
#define KB_TRANSPORT_BLE        1
#define KB_TRANSPORT_UART       2

/* ---------- ACK status codes ---------- */

#define KB_ACK_OK               0x00
#define KB_ACK_ERR_UNKNOWN_TYPE 0x01
#define KB_ACK_ERR_BAD_LENGTH   0x02
#define KB_ACK_ERR_HID_FAIL     0x03
#define KB_ACK_ERR_BAD_TOKEN    0x10
#define KB_ACK_ERR_WIFI_FAIL    0x11
#define KB_ACK_ERR_WIFI_NO_CREDS 0x12
#define KB_ACK_ERR_HTTP_IN_PROGRESS 0x13
#define KB_ACK_ERR_HTTP_TOO_LARGE 0x14

/* ---------- WiFi state ---------- */

#define KB_WIFI_STATE_OFF           0
#define KB_WIFI_STATE_CONNECTING    1
#define KB_WIFI_STATE_CONNECTED     2  /* STA mode, connected to network */
#define KB_WIFI_STATE_DISCONNECTED  3
#define KB_WIFI_STATE_ERROR         4
#define KB_WIFI_STATE_AP_ACTIVE     5  /* AP mode, hosting network */

/* WiFi AP event types */
#define KB_WIFI_AP_CLIENT_CONNECTED    1
#define KB_WIFI_AP_CLIENT_DISCONNECTED 2

/* ---------- HTTP methods ---------- */

#define KB_HTTP_METHOD_GET          0
#define KB_HTTP_METHOD_POST         1
#define KB_HTTP_METHOD_PUT          2
#define KB_HTTP_METHOD_DELETE       3
#define KB_HTTP_METHOD_PATCH        4

/* ---------- HTTP error codes ---------- */

#define KB_HTTP_ERR_TIMEOUT         1
#define KB_HTTP_ERR_DNS             2
#define KB_HTTP_ERR_CONNECT         3
#define KB_HTTP_ERR_INTERNAL        4

/* ---------- WiFi proxy limits ---------- */

#define KB_WIFI_TOKEN_LEN           16
#define KB_WIFI_MAX_URL_LEN         512
#define KB_WIFI_MAX_BODY_LEN        (64 * 1024)
#define KB_WIFI_BOOT_EXPIRE         60

/* ---------- Payload structures ---------- */

typedef struct {
    uint8_t modifiers;
    uint8_t reserved;
    uint8_t keycodes[6];
} __attribute__((packed)) kb_keyboard_report_t;

typedef struct {
    uint8_t buttons;
    int8_t  dx;
    int8_t  dy;
    int8_t  wheel;
    int8_t  pan;
} __attribute__((packed)) kb_mouse_report_t;

typedef struct {
    uint8_t version;
    uint8_t board_type;
    uint8_t transport;
    uint8_t last_error;
} __attribute__((packed)) kb_status_response_t;

/* ---------- Generic packet ---------- */

typedef struct {
    uint8_t type;
    uint8_t length;
    uint8_t payload[KB_MAX_PAYLOAD];
} kb_packet_t;

/* ---------- CRC-8 (polynomial 0x07, init 0x00) ---------- */

static inline uint8_t kb_crc8(const uint8_t *data, size_t len)
{
    uint8_t crc = 0x00;
    for (size_t i = 0; i < len; i++) {
        crc ^= data[i];
        for (int j = 0; j < 8; j++) {
            if (crc & 0x80) {
                crc = (uint8_t)((crc << 1) ^ 0x07);
            } else {
                crc <<= 1;
            }
        }
    }
    return crc;
}

/* ---------- Pack a frame into a buffer ---------- */
/* Returns total frame length, or 0 on error.
 * buf must be at least KB_MAX_FRAME_SIZE bytes. */

static inline size_t kb_pack_frame(uint8_t *buf, size_t buf_size,
                                   uint8_t type, const uint8_t *payload, uint8_t payload_len)
{
    size_t frame_len = (size_t)payload_len + KB_FRAME_OVERHEAD;
    if (frame_len > buf_size || payload_len > KB_MAX_PAYLOAD) {
        return 0;
    }
    buf[0] = KB_MAGIC;
    buf[1] = payload_len;
    buf[2] = type;
    if (payload_len > 0 && payload != NULL) {
        memcpy(&buf[3], payload, payload_len);
    }
    /* CRC over type + payload */
    uint8_t crc_buf[1 + KB_MAX_PAYLOAD];
    crc_buf[0] = type;
    if (payload_len > 0 && payload != NULL) {
        memcpy(&crc_buf[1], payload, payload_len);
    }
    buf[3 + payload_len] = kb_crc8(crc_buf, 1 + payload_len);
    return frame_len;
}

/* ---------- Unpack helpers ---------- */

static inline bool kb_unpack_keyboard_report(const kb_packet_t *pkt, kb_keyboard_report_t *report)
{
    if (pkt->type != KB_PKT_KEYBOARD_REPORT || pkt->length != KB_KEYBOARD_REPORT_LEN) {
        return false;
    }
    memcpy(report, pkt->payload, KB_KEYBOARD_REPORT_LEN);
    return true;
}

static inline bool kb_unpack_mouse_report(const kb_packet_t *pkt, kb_mouse_report_t *report)
{
    if (pkt->type != KB_PKT_MOUSE_REPORT || pkt->length != KB_MOUSE_REPORT_LEN) {
        return false;
    }
    memcpy(report, pkt->payload, KB_MOUSE_REPORT_LEN);
    return true;
}

static inline bool kb_unpack_status_response(const kb_packet_t *pkt, kb_status_response_t *resp)
{
    if (pkt->type != KB_PKT_STATUS_RESPONSE || pkt->length != KB_STATUS_RESPONSE_LEN) {
        return false;
    }
    memcpy(resp, pkt->payload, KB_STATUS_RESPONSE_LEN);
    return true;
}

/* ---------- Frame parser state machine ---------- */

typedef enum {
    KB_PARSE_WAIT_MAGIC,
    KB_PARSE_WAIT_LENGTH,
    KB_PARSE_WAIT_TYPE,
    KB_PARSE_WAIT_PAYLOAD,
    KB_PARSE_WAIT_CRC,
} kb_parse_state_t;

typedef struct {
    kb_parse_state_t state;
    uint8_t  expected_len;
    uint8_t  payload_idx;
    kb_packet_t packet;
} kb_parser_t;

/* Result codes from the parser feed function */
typedef enum {
    KB_PARSE_INCOMPLETE,    /* Need more bytes */
    KB_PARSE_OK,            /* Complete valid packet in parser->packet */
    KB_PARSE_ERR_CRC,       /* CRC mismatch; packet dropped */
    KB_PARSE_ERR_OVERFLOW,  /* Payload too large; reset */
} kb_parse_result_t;

static inline void kb_parser_init(kb_parser_t *parser)
{
    parser->state = KB_PARSE_WAIT_MAGIC;
    parser->expected_len = 0;
    parser->payload_idx = 0;
    memset(&parser->packet, 0, sizeof(parser->packet));
}

/* Feed one byte at a time. Returns KB_PARSE_OK when a complete valid packet
 * is available in parser->packet. After reading the packet, the caller should
 * continue feeding bytes (the parser auto-resets to WAIT_MAGIC). */

static inline kb_parse_result_t kb_parser_feed(kb_parser_t *parser, uint8_t byte)
{
    switch (parser->state) {
    case KB_PARSE_WAIT_MAGIC:
        if (byte == KB_MAGIC) {
            parser->state = KB_PARSE_WAIT_LENGTH;
            parser->payload_idx = 0;
        }
        return KB_PARSE_INCOMPLETE;

    case KB_PARSE_WAIT_LENGTH:
        if (byte > KB_MAX_PAYLOAD) {
            parser->state = KB_PARSE_WAIT_MAGIC;
            return KB_PARSE_ERR_OVERFLOW;
        }
        parser->expected_len = byte;
        parser->packet.length = byte;
        parser->state = KB_PARSE_WAIT_TYPE;
        return KB_PARSE_INCOMPLETE;

    case KB_PARSE_WAIT_TYPE:
        parser->packet.type = byte;
        if (parser->expected_len == 0) {
            parser->state = KB_PARSE_WAIT_CRC;
        } else {
            parser->state = KB_PARSE_WAIT_PAYLOAD;
        }
        return KB_PARSE_INCOMPLETE;

    case KB_PARSE_WAIT_PAYLOAD:
        parser->packet.payload[parser->payload_idx++] = byte;
        if (parser->payload_idx >= parser->expected_len) {
            parser->state = KB_PARSE_WAIT_CRC;
        }
        return KB_PARSE_INCOMPLETE;

    case KB_PARSE_WAIT_CRC: {
        /* Compute expected CRC over type + payload */
        uint8_t crc_data[1 + KB_MAX_PAYLOAD];
        crc_data[0] = parser->packet.type;
        if (parser->expected_len > 0) {
            memcpy(&crc_data[1], parser->packet.payload, parser->expected_len);
        }
        uint8_t expected_crc = kb_crc8(crc_data, 1 + parser->expected_len);
        parser->state = KB_PARSE_WAIT_MAGIC;
        if (byte == expected_crc) {
            return KB_PARSE_OK;
        } else {
            return KB_PARSE_ERR_CRC;
        }
    }

    default:
        parser->state = KB_PARSE_WAIT_MAGIC;
        return KB_PARSE_INCOMPLETE;
    }
}

#ifdef __cplusplus
}
#endif

#endif /* KEEBLER_PROTOCOL_H */
