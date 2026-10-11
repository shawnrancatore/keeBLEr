// SPDX-License-Identifier: MIT
/*
 * keeBLEr connect window and session pass.
 *
 * Pure C: no ESP-IDF calls, no clock, no random source. The caller passes the
 * time in milliseconds and fresh random bytes, so the logic runs in host tests.
 *
 * Rules:
 *   - For 60 s after boot, while no pass exists, the first AUTH is GRANTED and
 *     a pass is issued. What that AUTH carried is ignored.
 *   - Once a pass exists, only an AUTH carrying it is OK. Anything else is
 *     DENIED, and the connection is dropped about 200 ms later.
 *   - A connection that has not authenticated within 5 s is dropped.
 *   - The pass lives in this struct only. A power cycle clears it.
 */

#ifndef KEEBLER_AUTH_H
#define KEEBLER_AUTH_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "protocol.h"

#ifdef __cplusplus
extern "C" {
#endif

#define KB_AUTH_WINDOW_MS      60000ULL
#define KB_AUTH_DEADLINE_MS    5000ULL
#define KB_AUTH_DENY_GRACE_MS  200ULL

typedef struct {
    uint64_t boot_ms;
    bool     has_pass;
    uint8_t  pass[KB_AUTH_PASS_LEN];
    bool     connected;
    bool     authenticated;
    uint64_t link_ms;       /* when the current connection was established */
    bool     drop_pending;  /* a DENIED connection waiting to be dropped */
    uint64_t drop_at_ms;
} kb_auth_t;

void    kb_auth_init(kb_auth_t *a, uint64_t boot_ms);
void    kb_auth_on_connect(kb_auth_t *a, uint64_t now_ms);
void    kb_auth_on_disconnect(kb_auth_t *a);
bool    kb_auth_window_open(const kb_auth_t *a, uint64_t now_ms);
uint8_t kb_auth_handle(kb_auth_t *a, uint64_t now_ms,
                       const uint8_t *payload, uint8_t len,
                       const uint8_t fresh_pass[KB_AUTH_PASS_LEN]);
bool    kb_auth_should_drop(const kb_auth_t *a, uint64_t now_ms);
bool    kb_auth_packet_allowed(const kb_auth_t *a, uint8_t type);
uint8_t kb_auth_flags(const kb_auth_t *a, uint64_t now_ms);

#ifdef __cplusplus
}
#endif

#endif /* KEEBLER_AUTH_H */
