// SPDX-License-Identifier: MIT
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TYPE_AUTH, TYPE_AUTH_RESULT, ACK_UNKNOWN_TYPE, ACK_NOT_AUTHENTICATED,
  buildFrame, FrameParser,
} from '../js/protocol.js';

test('the AUTH constants match the firmware', () => {
  assert.equal(TYPE_AUTH, 0x30);
  assert.equal(TYPE_AUTH_RESULT, 0x31);
  assert.equal(ACK_UNKNOWN_TYPE, 0x01);
  assert.equal(ACK_NOT_AUTHENTICATED, 0x20);
});

test('an AUTH frame with a 16-byte pass is 20 bytes, the largest write at the smallest MTU', () => {
  assert.equal(buildFrame(TYPE_AUTH, new Uint8Array(16)).length, 20);
});

const GRANTED = Uint8Array.from({ length: 17 }, (_, i) => (i === 0 ? 1 : 0xA0 + i));

function collect() {
  const frames = [];
  const parser = new FrameParser((type, payload) => frames.push({ type, payload }));
  return { frames, parser };
}

function assertGranted(frame) {
  assert.equal(frame.type, 0x31);
  assert.equal(frame.payload.length, 17);
  assert.deepEqual(Array.from(frame.payload), Array.from(GRANTED));
}

test('a GRANTED frame arrives as 20 bytes plus 1', () => {
  const wire = buildFrame(TYPE_AUTH_RESULT, GRANTED);
  assert.equal(wire.length, 21);
  const { frames, parser } = collect();
  parser.feed(wire.slice(0, 20));
  assert.equal(frames.length, 0);
  parser.feed(wire.slice(20));
  assert.equal(frames.length, 1);
  assertGranted(frames[0]);
});

test('a GRANTED frame arrives one byte at a time', () => {
  const wire = buildFrame(TYPE_AUTH_RESULT, GRANTED);
  const { frames, parser } = collect();
  for (const byte of wire) parser.feed(Uint8Array.of(byte));
  assert.equal(frames.length, 1);
  assertGranted(frames[0]);
});

test('two frames in one chunk are both delivered', () => {
  const first = buildFrame(TYPE_AUTH_RESULT, GRANTED);
  const second = buildFrame(TYPE_AUTH_RESULT, GRANTED);
  const both = new Uint8Array(first.length + second.length);
  both.set(first, 0);
  both.set(second, first.length);
  const { frames, parser } = collect();
  parser.feed(both);
  assert.equal(frames.length, 2);
  assertGranted(frames[0]);
  assertGranted(frames[1]);
});
