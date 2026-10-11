// SPDX-License-Identifier: MIT
#include <string.h>
#include "check.h"
#include "protocol.h"

/* Feed a buffer; return the last result that was not INCOMPLETE,
 * or INCOMPLETE if no frame finished. Counts OK frames in *ok. */
static kb_parse_result_t feed(kb_parser_t *p, const uint8_t *buf, size_t len, int *ok)
{
    kb_parse_result_t last = KB_PARSE_INCOMPLETE;
    for (size_t i = 0; i < len; i++) {
        kb_parse_result_t r = kb_parser_feed(p, buf[i]);
        if (r == KB_PARSE_OK && ok) (*ok)++;
        if (r != KB_PARSE_INCOMPLETE) last = r;
    }
    return last;
}

static void test_crc8_check_value(void)
{
    /* CRC-8, poly 0x07, init 0x00: the standard check value is 0xF4. */
    CHECK_EQ(kb_crc8((const uint8_t *)"123456789", 9), 0xF4);
    CHECK_EQ(kb_crc8(NULL, 0), 0x00);
}

static void test_pack_then_parse_keyboard(void)
{
    uint8_t payload[KB_KEYBOARD_REPORT_LEN] = {0x02, 0, 0x04, 0, 0, 0, 0, 0};
    uint8_t frame[KB_MAX_FRAME_SIZE];
    size_t n = kb_pack_frame(frame, sizeof(frame), KB_PKT_KEYBOARD_REPORT, payload, sizeof(payload));
    CHECK_EQ(n, sizeof(payload) + KB_FRAME_OVERHEAD);
    CHECK_EQ(frame[0], KB_MAGIC);
    CHECK_EQ(frame[1], sizeof(payload));
    CHECK_EQ(frame[2], KB_PKT_KEYBOARD_REPORT);

    kb_parser_t p;
    kb_parser_init(&p);
    int ok = 0;
    CHECK_EQ(feed(&p, frame, n, &ok), KB_PARSE_OK);
    CHECK_EQ(ok, 1);
    CHECK_EQ(p.packet.type, KB_PKT_KEYBOARD_REPORT);
    CHECK_EQ(p.packet.length, sizeof(payload));
    CHECK(memcmp(p.packet.payload, payload, sizeof(payload)) == 0);
}

static void test_empty_payload(void)
{
    uint8_t frame[KB_MAX_FRAME_SIZE];
    size_t n = kb_pack_frame(frame, sizeof(frame), KB_PKT_STATUS_REQUEST, NULL, 0);
    CHECK_EQ(n, KB_FRAME_OVERHEAD);
    kb_parser_t p;
    kb_parser_init(&p);
    int ok = 0;
    CHECK_EQ(feed(&p, frame, n, &ok), KB_PARSE_OK);
    CHECK_EQ(p.packet.length, 0);
}

static void test_bad_crc_is_dropped_and_parser_recovers(void)
{
    uint8_t payload[1] = {7};
    uint8_t frame[KB_MAX_FRAME_SIZE];
    size_t n = kb_pack_frame(frame, sizeof(frame), KB_PKT_HEARTBEAT, payload, 1);
    frame[n - 1] ^= 0xFF;
    kb_parser_t p;
    kb_parser_init(&p);
    int ok = 0;
    CHECK_EQ(feed(&p, frame, n, &ok), KB_PARSE_ERR_CRC);
    CHECK_EQ(ok, 0);
    frame[n - 1] ^= 0xFF; /* a good frame straight after is accepted */
    CHECK_EQ(feed(&p, frame, n, &ok), KB_PARSE_OK);
    CHECK_EQ(ok, 1);
}

static void test_oversize_length_is_rejected(void)
{
    const uint8_t bad[] = {KB_MAGIC, KB_MAX_PAYLOAD + 1};
    kb_parser_t p;
    kb_parser_init(&p);
    CHECK_EQ(feed(&p, bad, sizeof(bad), NULL), KB_PARSE_ERR_OVERFLOW);
}

static void test_garbage_then_two_frames(void)
{
    uint8_t a[KB_MAX_FRAME_SIZE], b[KB_MAX_FRAME_SIZE], buf[3 + 2 * KB_MAX_FRAME_SIZE];
    uint8_t one[1] = {1}, two[1] = {2};
    size_t na = kb_pack_frame(a, sizeof(a), KB_PKT_HEARTBEAT, one, 1);
    size_t nb = kb_pack_frame(b, sizeof(b), KB_PKT_HEARTBEAT, two, 1);
    buf[0] = 0x00; buf[1] = 0xFF; buf[2] = 0x13; /* noise with no magic byte */
    memcpy(buf + 3, a, na);
    memcpy(buf + 3 + na, b, nb);
    kb_parser_t p;
    kb_parser_init(&p);
    int ok = 0;
    CHECK_EQ(feed(&p, buf, 3 + na + nb, &ok), KB_PARSE_OK);
    CHECK_EQ(ok, 2);
    CHECK_EQ(p.packet.payload[0], 2);
}

static void test_pack_refuses_a_small_buffer(void)
{
    uint8_t payload[8] = {0};
    uint8_t small[8];
    CHECK_EQ(kb_pack_frame(small, sizeof(small), KB_PKT_KEYBOARD_REPORT, payload, 8), 0);
}

int main(void)
{
    test_crc8_check_value();
    test_pack_then_parse_keyboard();
    test_empty_payload();
    test_bad_crc_is_dropped_and_parser_recovers();
    test_oversize_length_is_rejected();
    test_garbage_then_two_frames();
    test_pack_refuses_a_small_buffer();
    TEST_MAIN_END();
}
