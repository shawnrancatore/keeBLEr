// SPDX-License-Identifier: MIT
// keebler state — shared state object, DOM element helpers

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export const state = {
  // Connection
  transport: null,       // 'ble' | 'serial' | null
  bleDevice: null,
  bleServer: null,
  bleService: null,
  bleRxChar: null,
  bleTxChar: null,
  serialPort: null,
  serialReader: null,
  serialWriter: null,
  serialReadLoopActive: false,

  // Reconnect
  reconnecting: false,
  reconnectTimer: null,
  reconnectAttempts: 0,
  maxReconnectAttempts: 10,
  reconnectBaseDelay: 1000,

  // Status
  deviceVersion: null,
  deviceBoard: null,
  deviceTransport: null,
  deviceError: null,

  // Heartbeat
  heartbeatInterval: null,
  heartbeatSeq: 0,
  lastHeartbeatAck: 0,
  heartbeatMissed: 0,
  maxHeartbeatMissed: 3,

  // Keyboard
  modifiers: 0,
  pressedKeys: new Map(), // code -> hidKeycode
  pressedModifiers: new Set(),

  // Mouse
  pointerLocked: false,
  mouseButtons: 0,

  // Capture
  captureStream: null,
  audioContext: null,
  audioGain: null,
  audioSource: null,
  audioMuted: false,
  audioVolume: 0.75,

  // Parser
  frameParser: null,

  // Echo/Loopback
  pendingEcho: null,
  echoTimeout: null,

  // WiFi
  wifiConnected: false,
  wifiSSID: null,
  wifiIP: null,
};

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

export const $ = (sel) => document.querySelector(sel);

export const el = {};

/**
 * Populate the `el` object with DOM element references based on which tier
 * is running. Missing elements (e.g., video elements in base tier) will be
 * null rather than causing errors.
 *
 * @param {'base'|'av'|'c64'} tier - Which product tier is active
 */
export function initElements(tier) {
  // Core elements — present in all tiers
  el.btnBle        = $('#btn-ble');
  el.btnSerial     = $('#btn-serial');
  el.btnDisconnect = $('#btn-disconnect');
  el.btnLoopback   = $('#btn-loopback');
  el.statusDot     = $('#status-dot');
  el.statusText    = $('#status-text');
  el.devVersion    = $('#dev-version');
  el.devBoard      = $('#dev-board');
  el.devTransport  = $('#dev-transport');
  el.devError      = $('#dev-error');
  el.devHeartbeat  = $('#dev-heartbeat');
  el.keyList       = $('#key-list');
  el.mouseArea     = $('#mouse-area');
  el.mouseLabel    = $('#mouse-area-label');
  el.logPanel      = $('#log');

  // AV elements — present in 'av' and 'c64' tiers
  if (tier === 'av' || tier === 'c64') {
    el.video         = $('#video');
    el.videoOverlay  = $('#video-overlay');
    el.captureSelect = $('#capture-select');
    el.modeSelect    = $('#mode-select');
    el.btnStartCap   = $('#btn-start-capture');
    el.btnStopCap    = $('#btn-stop-capture');
    el.audioVolume   = $('#audio-volume');
    el.audioVolLabel = $('#audio-volume-label');
    el.btnMute       = $('#btn-mute');
    el.videoSection  = $('#video-section');
    el.btnLarge      = $('#btn-large');
    el.btnFullscreen = $('#btn-fullscreen');
  }
}
