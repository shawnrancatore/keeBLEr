// SPDX-License-Identifier: MIT
// Drives the real js/connection.js against fake boards.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeBrowser, setBluetooth, makeDevice, delay } from '../test-helpers/fake-bluetooth.mjs';

const { state, store, view } = await installFakeBrowser();
const proto = await import('../js/protocol.js');
const conn = await import('../js/connection.js');

const { TYPE_AUTH, TYPE_AUTH_RESULT } = proto;
const PASS = Array.from({ length: 16 }, (_, i) => i + 1);

function reply(dev, type, payload) {
  setTimeout(() => dev.notify(Array.from(proto.buildFrame(type, payload))), 2);
}

/** Answers AUTH with DENIED, then drops the link 200 ms later. */
function refusingBoard() {
  return {
    onWrite(dev, bytes) {
      if (bytes[2] !== TYPE_AUTH) return;
      reply(dev, TYPE_AUTH_RESULT, [2]);
      setTimeout(() => dev.boardDrop(), 200);
    },
  };
}

/** Answers AUTH with GRANTED and records every frame type it receives. */
function grantingBoard(seen) {
  let answered = false;
  return {
    onWrite(dev, bytes) {
      seen.push({ type: bytes[2], afterAnswer: answered });
      if (bytes[2] === TYPE_AUTH) {
        answered = true;
        reply(dev, TYPE_AUTH_RESULT, [1, ...PASS]);
      }
    },
  };
}

afterEach(() => {
  conn.disconnect(); // stops the heartbeat and every pending timer
  store.clear();
  view.logLines.length = 0;
});

test('a refusal leaves nothing armed', async () => {
  const dev = makeDevice('keebler 1.4.0', 'refused-1', refusingBoard(), proto);
  setBluetooth([dev]);

  await conn.connectBle();
  await delay(300); // the board drops the link 200 ms after refusing

  assert.equal(dev.connects, 1);
  assert.equal(state.reconnecting, false);
  assert.equal(state.reconnectAttempts, 0);
  assert.equal(state.reconnectTimer, null);
  assert.equal(view.logLines.some((l) => /Reconnecting/.test(l)), false);
  assert.equal(view.statusText, 'Not authorised');
});

test('a refusal with two paired boards: the second is tried once and wins', async () => {
  const seen = [];
  const refused = makeDevice('keebler 1.4.0', 'refused-2', refusingBoard(), proto);
  const accepting = makeDevice('keebler 1.4.0', 'accepting-2', grantingBoard(seen), proto);
  setBluetooth([refused, accepting]);

  await conn.autoConnectBle();
  await delay(300);

  assert.equal(refused.connects, 1);
  assert.equal(accepting.connects, 1);
  assert.equal(state.transport, 'ble');
  assert.equal(state.bleDevice, accepting);
  assert.equal(state.reconnectTimer, null);
});

test('a connect sends AUTH first and nothing else until the board answers', async () => {
  const seen = [];
  const dev = makeDevice('keebler 1.4.0', 'granted-3', grantingBoard(seen), proto);
  setBluetooth([dev]);

  await conn.connectBle();

  assert.ok(seen.length >= 1);
  assert.equal(seen[0].type, TYPE_AUTH);
  assert.equal(seen[0].afterAnswer, false);
  assert.deepEqual(seen.filter((f) => !f.afterAnswer).map((f) => f.type), [TYPE_AUTH]);
  assert.equal(state.transport, 'ble');
});
