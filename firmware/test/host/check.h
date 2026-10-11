// SPDX-License-Identifier: MIT
/* A tiny test runner for host builds: no framework, no dependencies. */
#ifndef KEEBLER_TEST_CHECK_H
#define KEEBLER_TEST_CHECK_H

#include <stdio.h>

static int g_checks = 0;
static int g_failures = 0;

#define CHECK(cond) do { \
        g_checks++; \
        if (!(cond)) { \
            g_failures++; \
            printf("FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond); \
        } \
    } while (0)

#define CHECK_EQ(a, b) do { \
        long long _a = (long long)(a), _b = (long long)(b); \
        g_checks++; \
        if (_a != _b) { \
            g_failures++; \
            printf("FAIL %s:%d: %s == %s (%lld vs %lld)\n", \
                   __FILE__, __LINE__, #a, #b, _a, _b); \
        } \
    } while (0)

#define TEST_MAIN_END() do { \
        printf("%s: %d checks, %d failures\n", __FILE__, g_checks, g_failures); \
        return g_failures ? 1 : 0; \
    } while (0)

#endif
