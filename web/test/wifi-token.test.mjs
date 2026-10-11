// SPDX-License-Identifier: MIT
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LEGACY_KEY, tokenKey, loadToken, saveToken, dropToken, hasAnyToken,
} from '../js/wifi-token.js';

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    get length() { return map.size; },
    key: (i) => Array.from(map.keys())[i] ?? null,
    has: (k) => map.has(k),
    raw: (k) => map.get(k),
  };
}

const throwing = () => { throw new Error('storage unavailable'); };
const brokenStorage = {
  getItem: throwing, setItem: throwing, removeItem: throwing,
  get length() { throw new Error('storage unavailable'); },
  key: throwing,
};

const bytes = (b) => new Uint8Array(16).fill(b);
const hex = (b) => b.toString(16).padStart(2, '0').repeat(16);
const TA = bytes(0xa1);
const TB = bytes(0xb2);
const L = bytes(0xc3);

test('nothing stored: no token', () => {
  assert.equal(loadToken(memoryStorage(), 'a'), null);
});

test('a saved token comes back for its own board only', () => {
  const s = memoryStorage();
  saveToken(s, 'a', TA);
  assert.deepEqual(loadToken(s, 'a'), TA);
  assert.equal(loadToken(s, 'b'), null);
  assert.equal(tokenKey('a'), 'keebler_wifi_token_a');
  assert.match(s.raw('keebler_wifi_token_a'), /^[0-9a-f]{32}$/);
});

test("one board's refusal leaves the other board's token alone", () => {
  const s = memoryStorage();
  saveToken(s, 'a', TA);
  saveToken(s, 'b', TB);
  dropToken(s, 'b');
  assert.deepEqual(loadToken(s, 'a'), TA);
  assert.equal(loadToken(s, 'b'), null);
});

test('the old single token is offered to a board not seen before', () => {
  const s = memoryStorage({ [LEGACY_KEY]: hex(0xc3) });
  assert.deepEqual(loadToken(s, 'a'), L);
});

test('a board that accepts the old token keeps it as its own', () => {
  const s = memoryStorage({ [LEGACY_KEY]: hex(0xc3) });
  assert.deepEqual(loadToken(s, 'a'), L);
  saveToken(s, 'a', L);
  assert.deepEqual(loadToken(s, 'a'), L);
  assert.ok(s.has(LEGACY_KEY));
});

test('a board that refuses the old token is not offered it again', () => {
  const s = memoryStorage({ [LEGACY_KEY]: hex(0xc3) });
  assert.deepEqual(loadToken(s, 'b'), L);
  dropToken(s, 'b');
  assert.equal(loadToken(s, 'b'), null);
  assert.ok(s.has(LEGACY_KEY));
  assert.deepEqual(loadToken(s, 'a'), L);
});

test('after a refusal a board can be given a new token', () => {
  const s = memoryStorage({ [LEGACY_KEY]: hex(0xc3) });
  dropToken(s, 'b');
  saveToken(s, 'b', TB);
  assert.deepEqual(loadToken(s, 'b'), TB);
});

test('no board identity: the old single slot, as before', () => {
  const s = memoryStorage();
  saveToken(s, null, TA);
  assert.ok(s.has(LEGACY_KEY));
  assert.deepEqual(loadToken(s, null), TA);
  dropToken(s, null);
  assert.ok(!s.has(LEGACY_KEY));
  assert.equal(loadToken(s, null), null);
});

test('a damaged value reads as no token', () => {
  for (const bad of ['zz', 'a1'.repeat(15) + 'a', 'a1'.repeat(16) + 'a']) {
    const s = memoryStorage({ [tokenKey('a')]: bad });
    assert.equal(loadToken(s, 'a'), null);
    s.setItem(LEGACY_KEY, hex(0xc3));
    assert.equal(loadToken(s, 'a'), null);
  }
});

test('storage that throws never throws out', () => {
  assert.equal(loadToken(brokenStorage, 'a'), null);
  assert.equal(saveToken(brokenStorage, 'a', TA), false);
  assert.doesNotThrow(() => dropToken(brokenStorage, 'a'));
  assert.doesNotThrow(() => dropToken(brokenStorage, null));
  assert.equal(saveToken(memoryStorage(), 'a', TA), true);
});

test('hasAnyToken', () => {
  assert.equal(hasAnyToken(memoryStorage()), false);
  assert.equal(hasAnyToken(memoryStorage({ [LEGACY_KEY]: hex(0xc3) })), true);
  assert.equal(hasAnyToken(memoryStorage({ [tokenKey('a')]: hex(0xa1) })), true);
  assert.equal(hasAnyToken(memoryStorage({ [tokenKey('a')]: 'none' })), false);
  assert.equal(hasAnyToken(brokenStorage), false);
});
