// SPDX-License-Identifier: MIT
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTH_OK, AUTH_GRANTED, AUTH_DENIED, PASS_LEN, DENIED_MESSAGE,
  passKey, loadPass, savePass, clearPass, parseAuthResult,
  AuthDeniedError, runAuth, createDeniedSet, shouldRetry,
} from '../js/auth.js';

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    dump: () => Object.fromEntries(map),
  };
}

const PASS = Uint8Array.from({ length: PASS_LEN }, (_, i) => 0xA0 + i);
const PASS_HEX = 'a0a1a2a3a4a5a6a7a8a9aaabacadaeaf';
const OTHER = Uint8Array.from({ length: PASS_LEN }, (_, i) => 0x10 + i);

function result(status, pass) {
  const p = new Uint8Array(pass ? 1 + PASS_LEN : 1);
  p[0] = status;
  if (pass) p.set(pass, 1);
  return { kind: 'result', payload: p };
}

/** A fake link: records what was sent, and replies as told. */
function link(reply) {
  const sent = [];
  let resolveReply = null;
  let waiting = false;
  return {
    sent,
    wasWaitingAtSend: null,
    send: async function (payload) {
      this.wasWaitingAtSend = waiting;
      sent.push(Array.from(payload));
      if (resolveReply && reply !== 'timeout') {
        resolveReply(typeof reply === 'function' ? reply(payload) : reply);
      }
    },
    waitReply: (timeoutMs) => {
      waiting = true;
      return new Promise((res) => {
        resolveReply = res;
        if (reply === 'timeout') setTimeout(() => res(null), Math.min(timeoutMs, 5));
      });
    },
  };
}

test('the storage key and the hex round trip', () => {
  assert.equal(passKey('dev-1'), 'keebler_pass_dev-1');
  const s = fakeStorage();
  savePass(s, 'dev-1', PASS);
  assert.deepEqual(s.dump(), { 'keebler_pass_dev-1': PASS_HEX });
  assert.deepEqual(Array.from(loadPass(s, 'dev-1')), Array.from(PASS));
  clearPass(s, 'dev-1');
  assert.equal(loadPass(s, 'dev-1'), null);
});

test('a damaged stored value reads as no pass', () => {
  for (const bad of ['', 'a0a1', 'z'.repeat(32), PASS_HEX + '00']) {
    assert.equal(loadPass(fakeStorage({ 'keebler_pass_d': bad }), 'd'), null);
  }
});

test('parseAuthResult accepts only well-formed payloads', () => {
  assert.deepEqual(parseAuthResult(Uint8Array.of(AUTH_OK)), { status: AUTH_OK, pass: null });
  assert.deepEqual(parseAuthResult(Uint8Array.of(AUTH_DENIED)), { status: AUTH_DENIED, pass: null });
  const granted = parseAuthResult(result(AUTH_GRANTED, PASS).payload);
  assert.equal(granted.status, AUTH_GRANTED);
  assert.deepEqual(Array.from(granted.pass), Array.from(PASS));
  assert.equal(parseAuthResult(new Uint8Array(0)), null);
  assert.equal(parseAuthResult(Uint8Array.of(AUTH_GRANTED)), null); // granted without a pass
  assert.equal(parseAuthResult(Uint8Array.of(0x7F)), null);         // unknown status
});

test('first connect: sends an empty AUTH, stores the granted pass', async () => {
  const s = fakeStorage();
  const l = link(result(AUTH_GRANTED, PASS));
  assert.equal(await runAuth({ send: l.send.bind(l), waitReply: l.waitReply, storage: s, deviceId: 'd' }), 'granted');
  assert.deepEqual(l.sent, [[]]);
  assert.equal(l.wasWaitingAtSend, true, 'the reply waiter must exist before AUTH is sent');
  assert.equal(s.getItem('keebler_pass_d'), PASS_HEX);
});

test('reconnect: sends the stored pass, OK changes nothing', async () => {
  const s = fakeStorage({ 'keebler_pass_d': PASS_HEX });
  const l = link(result(AUTH_OK));
  assert.equal(await runAuth({ send: l.send.bind(l), waitReply: l.waitReply, storage: s, deviceId: 'd' }), 'ok');
  assert.deepEqual(l.sent, [Array.from(PASS)]);
  assert.equal(s.getItem('keebler_pass_d'), PASS_HEX);
});

test('after a power cycle: a stale pass is replaced by the new grant', async () => {
  const s = fakeStorage({ 'keebler_pass_d': PASS_HEX });
  const l = link(result(AUTH_GRANTED, OTHER));
  assert.equal(await runAuth({ send: l.send.bind(l), waitReply: l.waitReply, storage: s, deviceId: 'd' }), 'granted');
  assert.deepEqual(Array.from(loadPass(s, 'd')), Array.from(OTHER));
});

test('denied: the stored pass is cleared and AuthDeniedError carries the message', async () => {
  const s = fakeStorage({ 'keebler_pass_d': PASS_HEX });
  const l = link(result(AUTH_DENIED));
  await assert.rejects(
    runAuth({ send: l.send.bind(l), waitReply: l.waitReply, storage: s, deviceId: 'd' }),
    (err) => err instanceof AuthDeniedError && err.name === 'AuthDeniedError' && err.message === DENIED_MESSAGE,
  );
  assert.equal(s.getItem('keebler_pass_d'), null);
  assert.equal(DENIED_MESSAGE,
    'This keeBLEr is already paired with another browser, or its connect window has closed. ' +
    'Unplug it, plug it back in, and connect within 60 seconds.');
});

test('firmware 1.3 answers AUTH with "unknown type": legacy, nothing stored', async () => {
  const s = fakeStorage();
  const l = link({ kind: 'legacy' });
  assert.equal(await runAuth({ send: l.send.bind(l), waitReply: l.waitReply, storage: s, deviceId: 'd' }), 'legacy');
  assert.deepEqual(s.dump(), {});
});

test('no answer: an ordinary error, and the stored pass is kept', async () => {
  const s = fakeStorage({ 'keebler_pass_d': PASS_HEX });
  const l = link('timeout');
  await assert.rejects(
    runAuth({ send: l.send.bind(l), waitReply: l.waitReply, storage: s, deviceId: 'd', timeoutMs: 5 }),
    (err) => !(err instanceof AuthDeniedError) && /no answer/i.test(err.message),
  );
  assert.equal(s.getItem('keebler_pass_d'), PASS_HEX);
});

test('a malformed AUTH_RESULT is an ordinary error', async () => {
  const l = link({ kind: 'result', payload: Uint8Array.of(AUTH_GRANTED) });
  await assert.rejects(
    runAuth({ send: l.send.bind(l), waitReply: l.waitReply, storage: fakeStorage(), deviceId: 'd' }),
    (err) => !(err instanceof AuthDeniedError),
  );
});

test('a refused device is not retried until the set is cleared', () => {
  const denied = createDeniedSet();
  assert.equal(denied.isDenied('d'), false);
  denied.deny('d');
  assert.equal(denied.isDenied('d'), true);
  assert.equal(denied.isDenied('other'), false);
  denied.clear();
  assert.equal(denied.isDenied('d'), false);
});

test('shouldRetry: never after a refusal, yes after other failures', () => {
  assert.equal(shouldRetry(new AuthDeniedError()), false);
  assert.equal(shouldRetry(new Error('GATT Server is disconnected')), true);
  assert.equal(shouldRetry(null), true);
});
