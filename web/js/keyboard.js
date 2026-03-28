// SPDX-License-Identifier: MIT
// keebler keyboard — key event handlers, shortcuts, blur/visibility

import { state, el } from './state.js';
import { HID_KEY_MAP, MODIFIER_BITS } from './keycodes.js';
import { sendKeyboardReport, sendFrame, setReleaseAllKeys } from './connection.js';
import { updateKeyDisplay, log } from './ui.js';
import { TYPE_KEYBOARD_REPORT } from './protocol.js';

// ---------------------------------------------------------------------------
// Shortcuts — registered by tier entry points (e.g., AV registers L/F)
// ---------------------------------------------------------------------------

let _shortcuts = {};

/**
 * Register shortcut handlers for when the user is not connected.
 * Keys are lowercase single characters, values are functions.
 * Example: registerShortcuts({ l: toggleLargeMode, f: toggleFullscreen })
 */
export function registerShortcuts(map) {
  _shortcuts = { ..._shortcuts, ...map };
}

// ---------------------------------------------------------------------------
// Key events
// ---------------------------------------------------------------------------

export function onKeyDown(event) {
  // Shortcuts work regardless of connection state (when not in an input)
  if (!state.transport && event.target.tagName !== 'INPUT' && event.target.tagName !== 'SELECT') {
    const key = event.key.toLowerCase();
    if (_shortcuts[key]) {
      _shortcuts[key]();
      return;
    }
  }

  if (!state.transport) return;

  // Don't capture if focused on an input element
  if (event.target.tagName === 'INPUT' || event.target.tagName === 'SELECT' || event.target.tagName === 'TEXTAREA') {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  const code = event.code;

  // Handle modifiers
  if (MODIFIER_BITS[code] !== undefined) {
    if (!state.pressedModifiers.has(code)) {
      state.pressedModifiers.add(code);
      state.modifiers |= MODIFIER_BITS[code];
      updateKeyDisplay();
      sendKeyboardReport();
    }
    return;
  }

  // Handle regular keys
  const hidCode = HID_KEY_MAP[code];
  if (hidCode !== undefined) {
    if (!state.pressedKeys.has(code)) {
      // Enforce 6-key rollover
      if (state.pressedKeys.size >= 6) {
        log('warn', '6-key rollover limit reached');
        return;
      }
      state.pressedKeys.set(code, hidCode);
      updateKeyDisplay();
      sendKeyboardReport();
    }
  }
}

export function onKeyUp(event) {
  if (!state.transport) return;

  if (event.target.tagName === 'INPUT' || event.target.tagName === 'SELECT' || event.target.tagName === 'TEXTAREA') {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  const code = event.code;

  // Handle modifiers
  if (MODIFIER_BITS[code] !== undefined) {
    if (state.pressedModifiers.has(code)) {
      state.pressedModifiers.delete(code);
      state.modifiers &= ~MODIFIER_BITS[code];
      updateKeyDisplay();
      sendKeyboardReport();
    }
    return;
  }

  // Handle regular keys
  if (state.pressedKeys.has(code)) {
    state.pressedKeys.delete(code);
    updateKeyDisplay();
    sendKeyboardReport();
  }
}

export function releaseAllKeys(sendReport = true) {
  const hadKeys = state.pressedKeys.size > 0 || state.pressedModifiers.size > 0;
  state.pressedKeys.clear();
  state.pressedModifiers.clear();
  state.modifiers = 0;
  updateKeyDisplay();

  // Send empty keyboard report if transport is live
  if (sendReport && state.transport) {
    sendFrame(TYPE_KEYBOARD_REPORT, new Uint8Array(8));
  }
}

// Register releaseAllKeys with connection.js so it can call it on disconnect
setReleaseAllKeys(releaseAllKeys);

// ---------------------------------------------------------------------------
// Keyboard capture setup
// ---------------------------------------------------------------------------

export function setupKeyboardCapture() {
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
}

// ---------------------------------------------------------------------------
// Window blur / visibility change
// ---------------------------------------------------------------------------

export function onWindowBlur() {
  releaseAllKeys();
  // Also release mouse buttons — import would be circular, so we just
  // release keys here. Mouse module handles its own blur via the same events.
}

export function onVisibilityChange() {
  if (document.hidden) {
    releaseAllKeys();
  }
}
