// SPDX-License-Identifier: MIT
#include <string.h>
#include "check.h"
#include "auth.h"

static const uint8_t FRESH_A[KB_AUTH_PASS_LEN] = {
    0xA0, 0xA1, 0xA2, 0xA3, 0xA4, 0xA5, 0xA6, 0xA7,
    0xA8, 0xA9, 0xAA, 0xAB, 0xAC, 0xAD, 0xAE, 0xAF };
static const uint8_t FRESH_B[KB_AUTH_PASS_LEN] = {
    0xB0, 0xB1, 0xB2, 0xB3, 0xB4, 0xB5, 0xB6, 0xB7,
    0xB8, 0xB9, 0xBA, 0xBB, 0xBC, 0xBD, 0xBE, 0xBF };

static void test_first_empty_auth_in_the_window_is_granted(void)
{
    kb_auth_t a;
    kb_auth_init(&a, 1000);
    kb_auth_on_connect(&a, 2000);
    CHECK(kb_auth_window_open(&a, 2000));
    CHECK(!kb_auth_packet_allowed(&a, KB_PKT_KEYBOARD_REPORT));
    CHECK_EQ(kb_auth_handle(&a, 2000, NULL, 0, FRESH_A), KB_AUTH_RESULT_GRANTED);
    CHECK(memcmp(a.pass, FRESH_A, KB_AUTH_PASS_LEN) == 0);
    CHECK(kb_auth_packet_allowed(&a, KB_PKT_KEYBOARD_REPORT));
    CHECK(!kb_auth_should_drop(&a, 2000 + 60 * 60 * 1000ULL));
}

static void test_only_the_first_claim_is_granted(void)
{
    kb_auth_t a;
    kb_auth_init(&a, 0);
    kb_auth_on_connect(&a, 100);
    CHECK_EQ(kb_auth_handle(&a, 100, NULL, 0, FRESH_A), KB_AUTH_RESULT_GRANTED);
    CHECK(!kb_auth_window_open(&a, 200)); /* a pass exists: no second grant */
    kb_auth_on_disconnect(&a);

    /* A second browser, still inside the 60 s. */
    kb_auth_on_connect(&a, 5000);
    CHECK_EQ(kb_auth_handle(&a, 5000, NULL, 0, FRESH_B), KB_AUTH_RESULT_DENIED);
    CHECK(memcmp(a.pass, FRESH_A, KB_AUTH_PASS_LEN) == 0); /* the pass is unchanged */
    CHECK(!kb_auth_packet_allowed(&a, KB_PKT_KEYBOARD_REPORT));
}

static void test_a_stale_pass_in_an_open_window_gets_a_new_grant(void)
{
    /* After a power cycle the owner's browser still sends its old pass. */
    kb_auth_t a;
    kb_auth_init(&a, 0);
    kb_auth_on_connect(&a, 1000);
    CHECK_EQ(kb_auth_handle(&a, 1000, FRESH_B, KB_AUTH_PASS_LEN, FRESH_A), KB_AUTH_RESULT_GRANTED);
    CHECK(memcmp(a.pass, FRESH_A, KB_AUTH_PASS_LEN) == 0); /* the new pass, not the stale one */
}

static void test_the_right_pass_is_ok_after_the_window(void)
{
    kb_auth_t a;
    kb_auth_init(&a, 0);
    kb_auth_on_connect(&a, 100);
    kb_auth_handle(&a, 100, NULL, 0, FRESH_A);
    kb_auth_on_disconnect(&a);

    kb_auth_on_connect(&a, 10 * 60 * 1000ULL);
    CHECK(!kb_auth_packet_allowed(&a, KB_PKT_MOUSE_REPORT));
    CHECK_EQ(kb_auth_handle(&a, 10 * 60 * 1000ULL, FRESH_A, KB_AUTH_PASS_LEN, FRESH_B), KB_AUTH_RESULT_OK);
    CHECK(kb_auth_packet_allowed(&a, KB_PKT_MOUSE_REPORT));
    CHECK(memcmp(a.pass, FRESH_A, KB_AUTH_PASS_LEN) == 0);
}

static void test_wrong_pass_and_bad_lengths_are_denied(void)
{
    kb_auth_t a;
    kb_auth_init(&a, 0);
    kb_auth_on_connect(&a, 100);
    kb_auth_handle(&a, 100, NULL, 0, FRESH_A);
    kb_auth_on_disconnect(&a);

    uint8_t almost[KB_AUTH_PASS_LEN];
    memcpy(almost, FRESH_A, KB_AUTH_PASS_LEN);
    almost[KB_AUTH_PASS_LEN - 1] ^= 0x01; /* differs in the last bit only */

    kb_auth_on_connect(&a, 200);
    CHECK_EQ(kb_auth_handle(&a, 200, almost, KB_AUTH_PASS_LEN, FRESH_B), KB_AUTH_RESULT_DENIED);
    kb_auth_on_disconnect(&a);

    const uint8_t lens[] = {1, 15, 17, 32, 128};
    for (size_t i = 0; i < sizeof(lens); i++) {
        uint8_t buf[128];
        memset(buf, 0xA0, sizeof(buf));
        kb_auth_on_connect(&a, 300);
        CHECK_EQ(kb_auth_handle(&a, 300, buf, lens[i], FRESH_B), KB_AUTH_RESULT_DENIED);
        kb_auth_on_disconnect(&a);
    }
    CHECK(memcmp(a.pass, FRESH_A, KB_AUTH_PASS_LEN) == 0);
}

static void test_bad_lengths_are_denied_even_in_the_window(void)
{
    kb_auth_t a;
    kb_auth_init(&a, 0);
    kb_auth_on_connect(&a, 100);
    uint8_t buf[17] = {0};
    CHECK_EQ(kb_auth_handle(&a, 100, buf, 17, FRESH_A), KB_AUTH_RESULT_DENIED);
    CHECK(!a.has_pass);
}

static void test_no_grant_after_the_window(void)
{
    kb_auth_t a;
    kb_auth_init(&a, 1000);
    CHECK(kb_auth_window_open(&a, 1000 + KB_AUTH_WINDOW_MS - 1));
    CHECK(!kb_auth_window_open(&a, 1000 + KB_AUTH_WINDOW_MS));
    kb_auth_on_connect(&a, 1000 + KB_AUTH_WINDOW_MS);
    CHECK_EQ(kb_auth_handle(&a, 1000 + KB_AUTH_WINDOW_MS, NULL, 0, FRESH_A), KB_AUTH_RESULT_DENIED);
    CHECK(!a.has_pass);
}

static void test_the_window_never_reopens(void)
{
    kb_auth_t a;
    kb_auth_init(&a, 0);
    /* 50 days of uptime: past the 32-bit millisecond wrap at 49.7 days. */
    const uint64_t fifty_days = 50ULL * 24 * 60 * 60 * 1000;
    CHECK(!kb_auth_window_open(&a, fifty_days));
    CHECK(!kb_auth_window_open(&a, 0xFFFFFFFFULL + 5));
    CHECK(!kb_auth_window_open(&a, UINT64_MAX));
}

static void test_denied_connection_is_dropped_after_the_grace(void)
{
    kb_auth_t a;
    kb_auth_init(&a, 0);
    kb_auth_on_connect(&a, 100000);
    CHECK_EQ(kb_auth_handle(&a, 100000, NULL, 0, FRESH_A), KB_AUTH_RESULT_DENIED);
    CHECK(!kb_auth_should_drop(&a, 100000 + KB_AUTH_DENY_GRACE_MS - 1));
    CHECK(kb_auth_should_drop(&a, 100000 + KB_AUTH_DENY_GRACE_MS));
}

static void test_silent_connection_is_dropped_at_the_deadline(void)
{
    kb_auth_t a;
    kb_auth_init(&a, 0);
    CHECK(!kb_auth_should_drop(&a, 999999)); /* nothing connected */
    kb_auth_on_connect(&a, 1000);
    CHECK(!kb_auth_should_drop(&a, 1000 + KB_AUTH_DEADLINE_MS - 1));
    CHECK(kb_auth_should_drop(&a, 1000 + KB_AUTH_DEADLINE_MS));
    kb_auth_on_disconnect(&a);
    CHECK(!kb_auth_should_drop(&a, 1000 + KB_AUTH_DEADLINE_MS));
}

static void test_reauth_and_wrong_reauth_on_a_live_link(void)
{
    kb_auth_t a;
    kb_auth_init(&a, 0);
    kb_auth_on_connect(&a, 100);
    kb_auth_handle(&a, 100, NULL, 0, FRESH_A);
    CHECK_EQ(kb_auth_handle(&a, 200, FRESH_A, KB_AUTH_PASS_LEN, FRESH_B), KB_AUTH_RESULT_OK);
    CHECK(kb_auth_packet_allowed(&a, KB_PKT_KEYBOARD_REPORT));
    /* A wrong pass on an authenticated link ends it. */
    CHECK_EQ(kb_auth_handle(&a, 300, FRESH_B, KB_AUTH_PASS_LEN, FRESH_B), KB_AUTH_RESULT_DENIED);
    CHECK(!kb_auth_packet_allowed(&a, KB_PKT_KEYBOARD_REPORT));
    CHECK(kb_auth_should_drop(&a, 300 + KB_AUTH_DENY_GRACE_MS));
}

static void test_the_gate_allows_exactly_three_types_before_auth(void)
{
    kb_auth_t a;
    kb_auth_init(&a, 0);
    kb_auth_on_connect(&a, 100);
    for (int type = 0; type <= 0xFF; type++) {
        bool expect = type == KB_PKT_STATUS_REQUEST || type == KB_PKT_AUTH ||
                      type == KB_PKT_HEARTBEAT;
        CHECK_EQ(kb_auth_packet_allowed(&a, (uint8_t)type), expect);
    }
    kb_auth_handle(&a, 100, NULL, 0, FRESH_A);
    CHECK(kb_auth_packet_allowed(&a, KB_PKT_WIFI_SCAN_REQ));
    CHECK(kb_auth_packet_allowed(&a, KB_PKT_HTTP_REQUEST));
    CHECK(kb_auth_packet_allowed(&a, KB_PKT_ECHO));
}

static void test_flags(void)
{
    kb_auth_t a;
    kb_auth_init(&a, 0);
    CHECK_EQ(kb_auth_flags(&a, 10), KB_STATUS_FLAG_WINDOW_OPEN);
    kb_auth_on_connect(&a, 100);
    kb_auth_handle(&a, 100, NULL, 0, FRESH_A);
    CHECK_EQ(kb_auth_flags(&a, 100), KB_STATUS_FLAG_PASS_ISSUED | KB_STATUS_FLAG_AUTHENTICATED);
    kb_auth_on_disconnect(&a);
    CHECK_EQ(kb_auth_flags(&a, 200), KB_STATUS_FLAG_PASS_ISSUED);

    kb_auth_t locked;
    kb_auth_init(&locked, 0);
    CHECK_EQ(kb_auth_flags(&locked, KB_AUTH_WINDOW_MS), 0); /* closed, nothing issued */
}

static void test_init_clears_everything(void)
{
    kb_auth_t a;
    kb_auth_init(&a, 0);
    kb_auth_on_connect(&a, 100);
    kb_auth_handle(&a, 100, NULL, 0, FRESH_A);
    kb_auth_init(&a, 500000); /* a power-up */
    CHECK(!a.has_pass);
    CHECK(!a.connected);
    CHECK(kb_auth_window_open(&a, 500000));
    uint8_t zero[KB_AUTH_PASS_LEN] = {0};
    CHECK(memcmp(a.pass, zero, KB_AUTH_PASS_LEN) == 0);
}

/* ---- edge cases: pass bits, stale drops, clock, bad lengths ---- */

static void test_every_bit_of_the_pass_matters(void)
{
    kb_auth_t a;
    kb_auth_init(&a, 0);
    kb_auth_on_connect(&a, 100);
    kb_auth_handle(&a, 100, NULL, 0, FRESH_A);
    kb_auth_on_disconnect(&a);

    for (int i = 0; i < KB_AUTH_PASS_LEN; i++) {
        for (int bit = 0; bit < 8; bit++) {
            uint8_t guess[KB_AUTH_PASS_LEN];
            memcpy(guess, FRESH_A, KB_AUTH_PASS_LEN);
            guess[i] ^= (uint8_t)(1u << bit);
            kb_auth_on_connect(&a, 200);
            CHECK_EQ(kb_auth_handle(&a, 200, guess, KB_AUTH_PASS_LEN, FRESH_B), KB_AUTH_RESULT_DENIED);
            kb_auth_on_disconnect(&a);
        }
    }
    CHECK(memcmp(a.pass, FRESH_A, KB_AUTH_PASS_LEN) == 0);
}

static void test_a_pending_drop_does_not_carry_to_the_next_link(void)
{
    kb_auth_t a;
    kb_auth_init(&a, 0);
    kb_auth_on_connect(&a, 100);
    kb_auth_handle(&a, 100, NULL, 0, FRESH_A);
    kb_auth_on_disconnect(&a);

    const uint64_t t = 2000;
    kb_auth_on_connect(&a, t);
    CHECK_EQ(kb_auth_handle(&a, t, FRESH_B, KB_AUTH_PASS_LEN, FRESH_B), KB_AUTH_RESULT_DENIED);
    kb_auth_on_disconnect(&a);

    kb_auth_on_connect(&a, t + 50);
    CHECK(!kb_auth_should_drop(&a, t + 50 + KB_AUTH_DENY_GRACE_MS));
    CHECK_EQ(kb_auth_handle(&a, t + 50 + KB_AUTH_DENY_GRACE_MS, FRESH_A, KB_AUTH_PASS_LEN, FRESH_B),
             KB_AUTH_RESULT_OK);
    CHECK(!kb_auth_should_drop(&a, t + 50 + 60 * 60 * 1000ULL));
}

static void test_on_connect_alone_resets_the_link_state(void)
{
    kb_auth_t a;
    kb_auth_init(&a, 0);
    kb_auth_on_connect(&a, 100);
    kb_auth_handle(&a, 100, NULL, 0, FRESH_A);
    CHECK(kb_auth_packet_allowed(&a, KB_PKT_KEYBOARD_REPORT));

    /* A new link without a disconnect in between. */
    kb_auth_on_connect(&a, 10000);
    CHECK(!kb_auth_packet_allowed(&a, KB_PKT_KEYBOARD_REPORT));

    kb_auth_on_connect(&a, 20000);
    CHECK_EQ(kb_auth_handle(&a, 20000, FRESH_B, KB_AUTH_PASS_LEN, FRESH_B), KB_AUTH_RESULT_DENIED);
    kb_auth_on_connect(&a, 20100);
    CHECK(!kb_auth_should_drop(&a, 20100 + KB_AUTH_DEADLINE_MS - 1));
}

static void test_the_right_pass_after_a_wrong_one_clears_the_drop(void)
{
    kb_auth_t a;
    kb_auth_init(&a, 0);
    kb_auth_on_connect(&a, 100);
    kb_auth_handle(&a, 100, NULL, 0, FRESH_A);
    kb_auth_on_disconnect(&a);

    kb_auth_on_connect(&a, 200);
    CHECK_EQ(kb_auth_handle(&a, 200, FRESH_B, KB_AUTH_PASS_LEN, FRESH_B), KB_AUTH_RESULT_DENIED);
    CHECK_EQ(kb_auth_handle(&a, 210, FRESH_A, KB_AUTH_PASS_LEN, FRESH_B), KB_AUTH_RESULT_OK);
    CHECK(kb_auth_packet_allowed(&a, KB_PKT_KEYBOARD_REPORT));
    CHECK(!kb_auth_should_drop(&a, 210 + KB_AUTH_DENY_GRACE_MS));
    CHECK(!kb_auth_should_drop(&a, 210 + 60 * 60 * 1000ULL));
}

static void test_a_null_payload_of_pass_length_is_denied(void)
{
    kb_auth_t a;
    kb_auth_init(&a, 0);
    kb_auth_on_connect(&a, 100);
    CHECK_EQ(kb_auth_handle(&a, 100, NULL, KB_AUTH_PASS_LEN, FRESH_A), KB_AUTH_RESULT_DENIED);
    CHECK(!a.has_pass);
    kb_auth_on_disconnect(&a);

    kb_auth_on_connect(&a, 200);
    CHECK_EQ(kb_auth_handle(&a, 200, NULL, 0, FRESH_A), KB_AUTH_RESULT_GRANTED);
    kb_auth_on_disconnect(&a);

    kb_auth_on_connect(&a, 300);
    CHECK_EQ(kb_auth_handle(&a, 300, NULL, KB_AUTH_PASS_LEN, FRESH_B), KB_AUTH_RESULT_DENIED);
    CHECK(memcmp(a.pass, FRESH_A, KB_AUTH_PASS_LEN) == 0);
}

static void test_bad_auth_on_an_authenticated_link_is_denied(void)
{
    kb_auth_t a;
    kb_auth_init(&a, 0);
    kb_auth_on_connect(&a, 100);
    kb_auth_handle(&a, 100, NULL, 0, FRESH_A);
    CHECK_EQ(kb_auth_handle(&a, 110, NULL, 0, FRESH_B), KB_AUTH_RESULT_DENIED);
    CHECK(!kb_auth_packet_allowed(&a, KB_PKT_KEYBOARD_REPORT));
    kb_auth_on_disconnect(&a);

    const uint8_t lens[] = {1, 15, 17};
    for (size_t i = 0; i < sizeof(lens); i++) {
        uint8_t buf[17];
        memset(buf, 0xA0, sizeof(buf));
        kb_auth_on_connect(&a, 1000);
        CHECK_EQ(kb_auth_handle(&a, 1000, FRESH_A, KB_AUTH_PASS_LEN, FRESH_B), KB_AUTH_RESULT_OK);
        CHECK(kb_auth_packet_allowed(&a, KB_PKT_KEYBOARD_REPORT));
        CHECK_EQ(kb_auth_handle(&a, 1000, buf, lens[i], FRESH_B), KB_AUTH_RESULT_DENIED);
        CHECK(!kb_auth_packet_allowed(&a, KB_PKT_KEYBOARD_REPORT));
        kb_auth_on_disconnect(&a);
    }
}

static void test_a_clock_that_went_backwards_is_closed(void)
{
    kb_auth_t a;
    kb_auth_init(&a, UINT64_MAX - 1000);
    CHECK(!kb_auth_window_open(&a, 5));
    CHECK(kb_auth_window_open(&a, UINT64_MAX - 500));
}

static void test_should_drop_before_link_time_is_false(void)
{
    kb_auth_t a;
    kb_auth_init(&a, 0);
    kb_auth_on_connect(&a, 5000);
    CHECK(!kb_auth_should_drop(&a, 4999));
}

static void test_repeated_denied_keeps_the_first_drop_time(void)
{
    kb_auth_t a;
    kb_auth_init(&a, 0);
    kb_auth_on_connect(&a, 100);
    kb_auth_handle(&a, 100, NULL, 0, FRESH_A);
    kb_auth_on_disconnect(&a);

    const uint64_t t = 1000;
    kb_auth_on_connect(&a, t);
    CHECK_EQ(kb_auth_handle(&a, t, FRESH_B, KB_AUTH_PASS_LEN, FRESH_B), KB_AUTH_RESULT_DENIED);
    CHECK_EQ(kb_auth_handle(&a, t + 100, FRESH_B, KB_AUTH_PASS_LEN, FRESH_B), KB_AUTH_RESULT_DENIED);
    CHECK(!kb_auth_should_drop(&a, t + KB_AUTH_DENY_GRACE_MS - 1));
    CHECK(kb_auth_should_drop(&a, t + KB_AUTH_DENY_GRACE_MS));
}

static void test_the_grace_is_honoured_near_the_deadline(void)
{
    kb_auth_t a;
    kb_auth_init(&a, 0);
    kb_auth_on_connect(&a, 100);
    kb_auth_handle(&a, 100, NULL, 0, FRESH_A);
    kb_auth_on_disconnect(&a);

    const uint64_t t = 1000;
    kb_auth_on_connect(&a, t);
    CHECK_EQ(kb_auth_handle(&a, t + 4900, FRESH_B, KB_AUTH_PASS_LEN, FRESH_B), KB_AUTH_RESULT_DENIED);
    CHECK(!kb_auth_should_drop(&a, t + KB_AUTH_DEADLINE_MS));
    CHECK(!kb_auth_should_drop(&a, t + 5099));
    CHECK(kb_auth_should_drop(&a, t + 5100));
}

static void test_a_wrong_pass_on_an_old_authenticated_link_gets_its_grace(void)
{
    kb_auth_t a;
    kb_auth_init(&a, 0);
    kb_auth_on_connect(&a, 100);
    kb_auth_handle(&a, 100, NULL, 0, FRESH_A);
    kb_auth_on_disconnect(&a);

    const uint64_t t = 1000;
    kb_auth_on_connect(&a, t);
    CHECK_EQ(kb_auth_handle(&a, t, FRESH_A, KB_AUTH_PASS_LEN, FRESH_B), KB_AUTH_RESULT_OK);
    CHECK_EQ(kb_auth_handle(&a, t + 60000, FRESH_B, KB_AUTH_PASS_LEN, FRESH_B), KB_AUTH_RESULT_DENIED);
    CHECK(!kb_auth_should_drop(&a, t + 60000 + KB_AUTH_DENY_GRACE_MS - 1));
    CHECK(kb_auth_should_drop(&a, t + 60000 + KB_AUTH_DENY_GRACE_MS));
}

static void test_auth_with_no_link_is_refused(void)
{
    kb_auth_t a;
    kb_auth_init(&a, 0);
    CHECK_EQ(kb_auth_handle(&a, 100, NULL, 0, FRESH_A), KB_AUTH_RESULT_DENIED);
    CHECK(!a.has_pass);
    CHECK(!kb_auth_should_drop(&a, 100 + KB_AUTH_DENY_GRACE_MS));

    kb_auth_on_connect(&a, 200);
    CHECK_EQ(kb_auth_handle(&a, 200, NULL, 0, FRESH_A), KB_AUTH_RESULT_GRANTED);
}

static void test_spec_values_are_pinned(void)
{
    CHECK_EQ(KB_AUTH_WINDOW_MS, 60000);
    CHECK_EQ(KB_AUTH_DEADLINE_MS, 5000);
    CHECK_EQ(KB_AUTH_DENY_GRACE_MS, 200);
    CHECK_EQ(KB_AUTH_PASS_LEN, 16);
    CHECK_EQ(KB_PKT_AUTH, 0x30);
    CHECK_EQ(KB_PKT_AUTH_RESULT, 0x31);
    CHECK_EQ(KB_ACK_ERR_NOT_AUTHENTICATED, 0x20);
    CHECK_EQ(KB_AUTH_RESULT_OK, 0);
    CHECK_EQ(KB_AUTH_RESULT_GRANTED, 1);
    CHECK_EQ(KB_AUTH_RESULT_DENIED, 2);
    CHECK_EQ(KB_STATUS_FLAG_WINDOW_OPEN, 1);
    CHECK_EQ(KB_STATUS_FLAG_PASS_ISSUED, 2);
    CHECK_EQ(KB_STATUS_FLAG_AUTHENTICATED, 4);
    CHECK_EQ(KB_PROTOCOL_VERSION, 2);
    CHECK_EQ(KB_STATUS_RESPONSE_LEN, 5);
}

static void test_a_grant_clears_a_pending_drop(void)
{
    kb_auth_t a;
    kb_auth_init(&a, 0);
    kb_auth_on_connect(&a, 100);
    static const uint8_t three[3] = { 1, 2, 3 };
    CHECK_EQ(kb_auth_handle(&a, 100, three, 3, FRESH_A), KB_AUTH_RESULT_DENIED);
    CHECK_EQ(kb_auth_handle(&a, 150, NULL, 0, FRESH_A), KB_AUTH_RESULT_GRANTED);
    CHECK(!kb_auth_should_drop(&a, 150 + KB_AUTH_DENY_GRACE_MS));
    CHECK(!kb_auth_should_drop(&a, 150 + 60 * 60 * 1000ULL));
}

int main(void)
{
    test_first_empty_auth_in_the_window_is_granted();
    test_only_the_first_claim_is_granted();
    test_a_stale_pass_in_an_open_window_gets_a_new_grant();
    test_the_right_pass_is_ok_after_the_window();
    test_wrong_pass_and_bad_lengths_are_denied();
    test_bad_lengths_are_denied_even_in_the_window();
    test_no_grant_after_the_window();
    test_the_window_never_reopens();
    test_denied_connection_is_dropped_after_the_grace();
    test_silent_connection_is_dropped_at_the_deadline();
    test_reauth_and_wrong_reauth_on_a_live_link();
    test_the_gate_allows_exactly_three_types_before_auth();
    test_flags();
    test_init_clears_everything();
    test_every_bit_of_the_pass_matters();
    test_a_pending_drop_does_not_carry_to_the_next_link();
    test_on_connect_alone_resets_the_link_state();
    test_the_right_pass_after_a_wrong_one_clears_the_drop();
    test_a_null_payload_of_pass_length_is_denied();
    test_bad_auth_on_an_authenticated_link_is_denied();
    test_a_clock_that_went_backwards_is_closed();
    test_should_drop_before_link_time_is_false();
    test_repeated_denied_keeps_the_first_drop_time();
    test_the_grace_is_honoured_near_the_deadline();
    test_a_wrong_pass_on_an_old_authenticated_link_gets_its_grace();
    test_auth_with_no_link_is_refused();
    test_spec_values_are_pinned();
    test_a_grant_clears_a_pending_drop();
    TEST_MAIN_END();
}
