# SPDX-License-Identifier: MIT
# Host tests: plain cc, no ESP-IDF. Run: make -C firmware/test/host test
CC ?= cc
CFLAGS ?= -std=c11 -Wall -Wextra -Werror -O1 -g -I../../main
MAIN := ../../main
TESTS := test_protocol test_auth

.PHONY: test clean
test: $(TESTS)
	@for t in $(TESTS); do ./$$t || exit 1; done

test_protocol: test_protocol.c check.h $(MAIN)/protocol.h
	$(CC) $(CFLAGS) -o $@ test_protocol.c

test_auth: test_auth.c check.h $(MAIN)/auth.c $(MAIN)/auth.h $(MAIN)/protocol.h
	$(CC) $(CFLAGS) -o $@ test_auth.c $(MAIN)/auth.c

clean:
	rm -f $(TESTS)
