// SPDX-License-Identifier: MIT
// keebler connect window — the browser's half. No DOM, no globals: everything
// it needs is passed in, so it runs under `node --test`.

export const AUTH_OK      = 0x00;
export const AUTH_GRANTED = 0x01;
export const AUTH_DENIED  = 0x02;
export const PASS_LEN     = 16;

export const DENIED_MESSAGE =
  'This keeBLEr is already paired with another browser, or its connect window has closed. ' +
  'Unplug it, plug it back in, and connect within 60 seconds.';

export class AuthDeniedError extends Error {
  constructor() {
    super(DENIED_MESSAGE);
    this.name = 'AuthDeniedError';
  }
}

// --- Pass storage: one pass per Bluetooth device id, as 32 hex characters ---

export function passKey(deviceId) {
  return `keebler_pass_${deviceId}`;
}

export function loadPass(storage, deviceId) {
  const hex = storage.getItem(passKey(deviceId));
  if (!hex || !/^[0-9a-f]{32}$/i.test(hex)) return null;
  const bytes = new Uint8Array(PASS_LEN);
  for (let i = 0; i < PASS_LEN; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function savePass(storage, deviceId, pass) {
  const hex = Array.from(pass).map((b) => b.toString(16).padStart(2, '0')).join('');
  storage.setItem(passKey(deviceId), hex);
}

export function clearPass(storage, deviceId) {
  storage.removeItem(passKey(deviceId));
}

// --- AUTH_RESULT: status(1), plus pass(16) when granted ---

export function parseAuthResult(payload) {
  if (!payload || payload.length < 1) return null;
  const status = payload[0];
  if (status === AUTH_GRANTED) {
    if (payload.length < 1 + PASS_LEN) return null;
    return { status, pass: payload.slice(1, 1 + PASS_LEN) };
  }
  if (status === AUTH_OK || status === AUTH_DENIED) return { status, pass: null };
  return null;
}

/**
 * Authorise this connection. Call it straight after notifications start, and
 * before any other packet.
 *
 * send(payload)        sends an AUTH packet with that payload.
 * waitReply(timeoutMs) resolves to { kind: 'result', payload },
 *                      { kind: 'legacy' } (firmware 1.3: "unknown type"),
 *                      or null when nothing came in time.
 *
 * Returns 'granted', 'ok' or 'legacy'. Throws AuthDeniedError when the board
 * refuses, and a plain Error when it gives no usable answer.
 */
export async function runAuth({ send, waitReply, storage, deviceId, timeoutMs = 3000 }) {
  const stored = loadPass(storage, deviceId);
  const replyPromise = waitReply(timeoutMs); // listen first, then speak
  await send(stored || new Uint8Array(0));
  const reply = await replyPromise;

  if (!reply) throw new Error('No answer to the connect request');
  if (reply.kind === 'legacy') return 'legacy';

  const result = parseAuthResult(reply.payload);
  if (!result) throw new Error('The board sent a malformed AUTH_RESULT');

  if (result.status === AUTH_GRANTED) {
    savePass(storage, deviceId, result.pass);
    return 'granted';
  }
  if (result.status === AUTH_OK) return 'ok';

  clearPass(storage, deviceId);
  throw new AuthDeniedError();
}

// --- After a refusal: no retries for that device until the user asks ---

export function createDeniedSet() {
  const ids = new Set();
  return {
    deny: (id) => { ids.add(id); },
    isDenied: (id) => ids.has(id),
    clear: () => { ids.clear(); },
  };
}

export function shouldRetry(err) {
  return !(err && err.name === 'AuthDeniedError');
}
