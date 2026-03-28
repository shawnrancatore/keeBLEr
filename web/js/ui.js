// SPDX-License-Identifier: MIT
// keebler ui — logging, connection status, device status, key display

import { state, el } from './state.js';
import { BOARD_NAMES, TRANSPORT_NAMES } from './protocol.js';
import { keyDisplayName } from './keycodes.js';

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

const MAX_LOG_ENTRIES = 500;

export function log(level, message) {
  const now = new Date();
  const ts = now.toLocaleTimeString('en-US', { hour12: false }) +
             '.' + String(now.getMilliseconds()).padStart(3, '0');

  const entry = document.createElement('div');
  entry.className = `log-entry log-${level}`;

  const tsSpan = document.createElement('span');
  tsSpan.className = 'ts';
  tsSpan.textContent = ts;

  entry.appendChild(tsSpan);
  entry.appendChild(document.createTextNode(message));

  el.logPanel.appendChild(entry);

  // Trim old entries
  while (el.logPanel.children.length > MAX_LOG_ENTRIES) {
    el.logPanel.removeChild(el.logPanel.firstChild);
  }

  // Auto-scroll
  el.logPanel.scrollTop = el.logPanel.scrollHeight;
}

// ---------------------------------------------------------------------------
// Connection status
// ---------------------------------------------------------------------------

export function setConnectionStatus(status, text) {
  el.statusDot.className = `dot ${status}`;
  el.statusText.textContent = text;

  const connected = status === 'connected';
  el.btnBle.disabled = connected || status === 'connecting';
  el.btnSerial.disabled = connected || status === 'connecting';
  el.btnDisconnect.disabled = !connected;
  el.btnLoopback.disabled = !connected;
}

// ---------------------------------------------------------------------------
// Device status
// ---------------------------------------------------------------------------

export function updateDeviceStatus() {
  el.devVersion.textContent = state.deviceVersion != null ? `v${state.deviceVersion}` : '--';
  el.devBoard.textContent = state.deviceBoard != null
    ? (BOARD_NAMES[state.deviceBoard] || `0x${state.deviceBoard.toString(16)}`)
    : '--';
  el.devTransport.textContent = state.deviceTransport != null
    ? (TRANSPORT_NAMES[state.deviceTransport] || `0x${state.deviceTransport.toString(16)}`)
    : '--';
  el.devError.textContent = state.deviceError != null
    ? (state.deviceError === 0 ? 'None' : `0x${state.deviceError.toString(16)}`)
    : '--';
  el.devHeartbeat.textContent = state.heartbeatMissed === 0
    ? (state.lastHeartbeatAck > 0 ? 'OK' : '--')
    : `Missed: ${state.heartbeatMissed}`;
}

// ---------------------------------------------------------------------------
// Key state display
// ---------------------------------------------------------------------------

export function updateKeyDisplay() {
  el.keyList.innerHTML = '';

  // Show modifiers first
  for (const code of state.pressedModifiers) {
    const badge = document.createElement('span');
    badge.className = 'key-badge';
    badge.textContent = keyDisplayName(code);
    el.keyList.appendChild(badge);
  }

  // Then regular keys
  for (const [code] of state.pressedKeys) {
    const badge = document.createElement('span');
    badge.className = 'key-badge';
    badge.textContent = keyDisplayName(code);
    el.keyList.appendChild(badge);
  }
}
