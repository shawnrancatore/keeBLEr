// SPDX-License-Identifier: MIT
#include <string.h>
#include "auth.h"

/* Compare without an early exit, so timing does not reveal where a guess went wrong. */
static bool ct_equal(const uint8_t *x, const uint8_t *y, size_t n)
{
    uint8_t diff = 0;
    for (size_t i = 0; i < n; i++) {
        diff |= (uint8_t)(x[i] ^ y[i]);
    }
    return diff == 0;
}

static uint8_t deny(kb_auth_t *a, uint64_t now_ms)
{
    a->authenticated = false;
    if (!a->drop_pending) {
        a->drop_pending = true;
        a->drop_at_ms = now_ms + KB_AUTH_DENY_GRACE_MS;
    }
    return KB_AUTH_RESULT_DENIED;
}

void kb_auth_init(kb_auth_t *a, uint64_t boot_ms)
{
    memset(a, 0, sizeof(*a));
    a->boot_ms = boot_ms;
}

void kb_auth_on_connect(kb_auth_t *a, uint64_t now_ms)
{
    a->connected = true;
    a->authenticated = false;
    a->link_ms = now_ms;
    a->drop_pending = false;
}

void kb_auth_on_disconnect(kb_auth_t *a)
{
    a->connected = false;
    a->authenticated = false;
    a->drop_pending = false;
}

bool kb_auth_window_open(const kb_auth_t *a, uint64_t now_ms)
{
    if (a->has_pass || now_ms < a->boot_ms) {
        return false;
    }
    return (now_ms - a->boot_ms) < KB_AUTH_WINDOW_MS;
}

uint8_t kb_auth_handle(kb_auth_t *a, uint64_t now_ms,
                       const uint8_t *payload, uint8_t len,
                       const uint8_t fresh_pass[KB_AUTH_PASS_LEN])
{
    if (!a->connected) {
        return KB_AUTH_RESULT_DENIED;
    }

    bool well_formed = (len == 0) || (len == KB_AUTH_PASS_LEN && payload != NULL);
    if (!well_formed) {
        return deny(a, now_ms);
    }

    if (!a->has_pass) {
        /* Nobody holds a pass yet. Inside the window the first AUTH claims the
         * board, whatever it carried: after a power cycle the owner's browser
         * still sends its old pass. */
        if (!kb_auth_window_open(a, now_ms)) {
            return deny(a, now_ms);
        }
        memcpy(a->pass, fresh_pass, KB_AUTH_PASS_LEN);
        a->has_pass = true;
        a->authenticated = true;
        a->drop_pending = false;
        return KB_AUTH_RESULT_GRANTED;
    }

    if (len == KB_AUTH_PASS_LEN && ct_equal(a->pass, payload, KB_AUTH_PASS_LEN)) {
        a->authenticated = true;
        a->drop_pending = false;
        return KB_AUTH_RESULT_OK;
    }
    return deny(a, now_ms);
}

bool kb_auth_should_drop(const kb_auth_t *a, uint64_t now_ms)
{
    if (!a->connected) {
        return false;
    }
    if (a->drop_pending) {
        /* A refused link gets its grace, even near the deadline, so the
         * DENIED reply can leave before the link drops. */
        return now_ms >= a->drop_at_ms;
    }
    if (a->authenticated || now_ms < a->link_ms) {
        return false;
    }
    return (now_ms - a->link_ms) >= KB_AUTH_DEADLINE_MS;
}

bool kb_auth_packet_allowed(const kb_auth_t *a, uint8_t type)
{
    if (a->authenticated) {
        return true;
    }
    return type == KB_PKT_STATUS_REQUEST || type == KB_PKT_AUTH || type == KB_PKT_HEARTBEAT;
}

uint8_t kb_auth_flags(const kb_auth_t *a, uint64_t now_ms)
{
    uint8_t flags = 0;
    if (kb_auth_window_open(a, now_ms)) flags |= KB_STATUS_FLAG_WINDOW_OPEN;
    if (a->has_pass)                    flags |= KB_STATUS_FLAG_PASS_ISSUED;
    if (a->authenticated)               flags |= KB_STATUS_FLAG_AUTHENTICATED;
    return flags;
}
