// SPDX-License-Identifier: MIT
// keebler mouse — pointer lock, mouse events, button/wheel handling

import { state, el } from './state.js';
import { sendMouseReport, setReleaseAllMouseButtons } from './connection.js';
import { log } from './ui.js';

// ---------------------------------------------------------------------------
// Mouse accumulator — throttle sends to ~30Hz
// ---------------------------------------------------------------------------

let _mouseAccumDx = 0;
let _mouseAccumDy = 0;
let _mouseSendPending = false;

function flushMouseAccum() {
  if (!state.pointerLocked || !state.transport) {
    _mouseAccumDx = 0;
    _mouseAccumDy = 0;
    _mouseSendPending = false;
    return;
  }
  const dx = _mouseAccumDx;
  const dy = _mouseAccumDy;
  _mouseAccumDx = 0;
  _mouseAccumDy = 0;
  _mouseSendPending = false;
  if (dx !== 0 || dy !== 0) {
    sendMouseReport(state.mouseButtons, dx, dy, 0, 0);
  }
}

// ---------------------------------------------------------------------------
// Mouse events
// ---------------------------------------------------------------------------

export function onMouseMove(event) {
  if (!state.pointerLocked || !state.transport) return;

  _mouseAccumDx += event.movementX;
  _mouseAccumDy += event.movementY;

  if (!_mouseSendPending) {
    _mouseSendPending = true;
    setTimeout(flushMouseAccum, 33); // ~30Hz
  }
}

export function onMouseDown(event) {
  if (!state.pointerLocked || !state.transport) return;

  event.preventDefault();

  switch (event.button) {
    case 0: state.mouseButtons |= 0x01; break; // Left
    case 1: state.mouseButtons |= 0x04; break; // Middle
    case 2: state.mouseButtons |= 0x02; break; // Right
  }

  sendMouseReport(state.mouseButtons, 0, 0, 0, 0);
}

export function onMouseUp(event) {
  if (!state.pointerLocked || !state.transport) return;

  event.preventDefault();

  switch (event.button) {
    case 0: state.mouseButtons &= ~0x01; break; // Left
    case 1: state.mouseButtons &= ~0x04; break; // Middle
    case 2: state.mouseButtons &= ~0x02; break; // Right
  }

  sendMouseReport(state.mouseButtons, 0, 0, 0, 0);
}

export function onWheel(event) {
  if (!state.pointerLocked || !state.transport) return;

  event.preventDefault();

  // Normalize wheel delta to reasonable values
  const wheel = -Math.sign(event.deltaY) * Math.min(Math.abs(Math.round(event.deltaY / 120)), 5);
  const pan = Math.sign(event.deltaX) * Math.min(Math.abs(Math.round(event.deltaX / 120)), 5);

  if (wheel !== 0 || pan !== 0) {
    sendMouseReport(state.mouseButtons, 0, 0, wheel, pan);
  }
}

// ---------------------------------------------------------------------------
// Mouse area / pointer lock
// ---------------------------------------------------------------------------

export function onMouseAreaClick() {
  if (!state.transport) {
    log('warn', 'Connect to a device before capturing mouse');
    return;
  }

  el.mouseArea.requestPointerLock();
}

export function onPointerLockChange() {
  state.pointerLocked = document.pointerLockElement === el.mouseArea;

  if (state.pointerLocked) {
    el.mouseLabel.textContent = 'Mouse captured (press Escape to release)';
    log('info', 'Mouse captured');
  } else {
    el.mouseLabel.textContent = 'Click here to capture mouse';
    releaseAllMouseButtons();
    log('info', 'Mouse released');
  }
}

export function releaseAllMouseButtons(sendReport = true) {
  state.mouseButtons = 0;
  if (sendReport && state.transport) {
    sendMouseReport(0, 0, 0, 0, 0);
  }
}

// Register releaseAllMouseButtons with connection.js so it can call it on disconnect
setReleaseAllMouseButtons(releaseAllMouseButtons);

// ---------------------------------------------------------------------------
// Context menu prevention
// ---------------------------------------------------------------------------

export function onContextMenu(event) {
  if (state.pointerLocked) {
    event.preventDefault();
  }
}

// ---------------------------------------------------------------------------
// Mouse capture setup
// ---------------------------------------------------------------------------

export function setupMouseCapture() {
  el.mouseArea.addEventListener('click', onMouseAreaClick);
  document.addEventListener('pointerlockchange', onPointerLockChange);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('wheel', onWheel, { passive: false });
  document.addEventListener('contextmenu', onContextMenu);
}
