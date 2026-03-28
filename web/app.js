// SPDX-License-Identifier: MIT
// keebler web app — keyboard BLE enabler

'use strict';

// ---------------------------------------------------------------------------
// Constants — BLE protocol
// ---------------------------------------------------------------------------

const BLE_SERVICE_UUID   = '4b454500-424c-4500-0000-000000000000';
const BLE_RX_CHAR_UUID   = '4b454500-424c-4500-0000-000000000001'; // write to device
const BLE_TX_CHAR_UUID   = '4b454500-424c-4500-0000-000000000002'; // notify from device
const BLE_DEVICE_NAME    = 'keebler';

const SERIAL_BAUD        = 115200;

// Frame constants
const FRAME_MAGIC        = 0x4B;

// Packet types
const TYPE_KEYBOARD_REPORT  = 0x01;
const TYPE_MOUSE_REPORT     = 0x02;
const TYPE_STATUS_REQUEST   = 0x10;
const TYPE_STATUS_RESPONSE  = 0x11;
const TYPE_HEARTBEAT        = 0x20;
const TYPE_HEARTBEAT_ACK    = 0x21;
const TYPE_ACK              = 0xFE;
const TYPE_ECHO             = 0xFF;

const TYPE_NAMES = {
  [TYPE_KEYBOARD_REPORT]: 'KEYBOARD_REPORT',
  [TYPE_MOUSE_REPORT]:    'MOUSE_REPORT',
  [TYPE_STATUS_REQUEST]:  'STATUS_REQUEST',
  [TYPE_STATUS_RESPONSE]: 'STATUS_RESPONSE',
  [TYPE_HEARTBEAT]:       'HEARTBEAT',
  [TYPE_HEARTBEAT_ACK]:   'HEARTBEAT_ACK',
  [TYPE_ACK]:             'ACK',
  [TYPE_ECHO]:            'ECHO',
};

// Board type names
const BOARD_NAMES = {
  0x00: 'Unknown',
  0x01: 'DevKitC-1',
  0x02: 'XIAO ESP32S3',
};

// Transport names
const TRANSPORT_NAMES = {
  0x00: 'None',
  0x01: 'BLE',
  0x02: 'Serial/UART',
};

// ---------------------------------------------------------------------------
// Protocol — CRC8 (polynomial 0x07, init 0x00)
// ---------------------------------------------------------------------------

const CRC8_TABLE = new Uint8Array(256);
(function initCrc8Table() {
  for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let bit = 0; bit < 8; bit++) {
      if (crc & 0x80) {
        crc = ((crc << 1) ^ 0x07) & 0xFF;
      } else {
        crc = (crc << 1) & 0xFF;
      }
    }
    CRC8_TABLE[i] = crc;
  }
})();

function crc8(data) {
  let crc = 0x00;
  for (let i = 0; i < data.length; i++) {
    crc = CRC8_TABLE[crc ^ data[i]];
  }
  return crc;
}

// ---------------------------------------------------------------------------
// Protocol — frame builder
// ---------------------------------------------------------------------------

function buildFrame(type, payload) {
  // payload can be Uint8Array or Array
  const p = payload instanceof Uint8Array ? payload : new Uint8Array(payload || []);
  // Frame: [MAGIC][LENGTH][TYPE][PAYLOAD...][CRC8]
  // LENGTH = payload byte count only (not including MAGIC, LENGTH, TYPE, CRC)
  const frame = new Uint8Array(4 + p.length); // magic(1) + length(1) + type(1) + payload + crc(1)
  frame[0] = FRAME_MAGIC;
  frame[1] = p.length;
  frame[2] = type;
  frame.set(p, 3);
  // CRC over type + payload
  const crcData = new Uint8Array(1 + p.length);
  crcData[0] = type;
  crcData.set(p, 1);
  frame[3 + p.length] = crc8(crcData);
  return frame;
}

// ---------------------------------------------------------------------------
// Protocol — frame parser
// ---------------------------------------------------------------------------

class FrameParser {
  constructor(onFrame) {
    this.onFrame = onFrame; // callback: (type, payload) => void
    this.state = 'WAIT_MAGIC'; // WAIT_MAGIC, WAIT_LENGTH, WAIT_TYPE, WAIT_PAYLOAD, WAIT_CRC
    this.payloadLength = 0;
    this.type = 0;
    this.payload = [];
  }

  reset() {
    this.state = 'WAIT_MAGIC';
    this.payloadLength = 0;
    this.type = 0;
    this.payload = [];
  }

  feed(data) {
    for (let i = 0; i < data.length; i++) {
      const byte = data[i];

      switch (this.state) {
        case 'WAIT_MAGIC':
          if (byte === FRAME_MAGIC) {
            this.state = 'WAIT_LENGTH';
          }
          break;

        case 'WAIT_LENGTH':
          if (byte > 128) {
            // Payload too large, reset
            this.state = 'WAIT_MAGIC';
          } else {
            this.payloadLength = byte;
            this.state = 'WAIT_TYPE';
          }
          break;

        case 'WAIT_TYPE':
          this.type = byte;
          this.payload = [];
          if (this.payloadLength === 0) {
            this.state = 'WAIT_CRC';
          } else {
            this.state = 'WAIT_PAYLOAD';
          }
          break;

        case 'WAIT_PAYLOAD':
          this.payload.push(byte);
          if (this.payload.length >= this.payloadLength) {
            this.state = 'WAIT_CRC';
          }
          break;

        case 'WAIT_CRC':
          this._verifyCrc(byte);
          this.state = 'WAIT_MAGIC';
          break;
      }
    }
  }

  _verifyCrc(receivedCrc) {
    const type = this.type;
    const payload = new Uint8Array(this.payload);

    // Verify CRC over type + payload
    const crcData = new Uint8Array(1 + payload.length);
    crcData[0] = type;
    crcData.set(payload, 1);
    const expectedCrc = crc8(crcData);

    if (receivedCrc !== expectedCrc) {
      log('warn', `CRC mismatch: got 0x${receivedCrc.toString(16)}, expected 0x${expectedCrc.toString(16)}`);
      return;
    }

    this.onFrame(type, payload);
  }
}

// ---------------------------------------------------------------------------
// Constants — USB HID keycode map (browser key -> HID usage ID)
// ---------------------------------------------------------------------------

const HID_KEY_MAP = {
  // Letters
  'KeyA': 0x04, 'KeyB': 0x05, 'KeyC': 0x06, 'KeyD': 0x07,
  'KeyE': 0x08, 'KeyF': 0x09, 'KeyG': 0x0A, 'KeyH': 0x0B,
  'KeyI': 0x0C, 'KeyJ': 0x0D, 'KeyK': 0x0E, 'KeyL': 0x0F,
  'KeyM': 0x10, 'KeyN': 0x11, 'KeyO': 0x12, 'KeyP': 0x13,
  'KeyQ': 0x14, 'KeyR': 0x15, 'KeyS': 0x16, 'KeyT': 0x17,
  'KeyU': 0x18, 'KeyV': 0x19, 'KeyW': 0x1A, 'KeyX': 0x1B,
  'KeyY': 0x1C, 'KeyZ': 0x1D,

  // Numbers
  'Digit1': 0x1E, 'Digit2': 0x1F, 'Digit3': 0x20, 'Digit4': 0x21,
  'Digit5': 0x22, 'Digit6': 0x23, 'Digit7': 0x24, 'Digit8': 0x25,
  'Digit9': 0x26, 'Digit0': 0x27,

  // Control keys
  'Enter':      0x28,
  'Escape':     0x29,
  'Backspace':  0x2A,
  'Tab':        0x2B,
  'Space':      0x2C,

  // Punctuation
  'Minus':         0x2D,  // -
  'Equal':         0x2E,  // =
  'BracketLeft':   0x2F,  // [
  'BracketRight':  0x30,  // ]
  'Backslash':     0x31,  // backslash
  'Semicolon':     0x33,  // ;
  'Quote':         0x34,  // '
  'Backquote':     0x35,  // `
  'Comma':         0x36,  // ,
  'Period':        0x37,  // .
  'Slash':         0x38,  // /

  // Caps Lock
  'CapsLock':   0x39,

  // Function keys
  'F1':  0x3A, 'F2':  0x3B, 'F3':  0x3C, 'F4':  0x3D,
  'F5':  0x3E, 'F6':  0x3F, 'F7':  0x40, 'F8':  0x41,
  'F9':  0x42, 'F10': 0x43, 'F11': 0x44, 'F12': 0x45,

  // Print Screen, Scroll Lock, Pause
  'PrintScreen': 0x46,
  'ScrollLock':  0x47,
  'Pause':       0x48,

  // Navigation
  'Insert':    0x49,
  'Home':      0x4A,
  'PageUp':    0x4B,
  'Delete':    0x4C,
  'End':       0x4D,
  'PageDown':  0x4E,

  // Arrow keys
  'ArrowRight': 0x4F,
  'ArrowLeft':  0x50,
  'ArrowDown':  0x51,
  'ArrowUp':    0x52,

  // Numpad
  'NumLock':        0x53,
  'NumpadDivide':   0x54,
  'NumpadMultiply': 0x55,
  'NumpadSubtract': 0x56,
  'NumpadAdd':      0x57,
  'NumpadEnter':    0x58,
  'Numpad1':        0x59,
  'Numpad2':        0x5A,
  'Numpad3':        0x5B,
  'Numpad4':        0x5C,
  'Numpad5':        0x5D,
  'Numpad6':        0x5E,
  'Numpad7':        0x5F,
  'Numpad8':        0x60,
  'Numpad9':        0x61,
  'Numpad0':        0x62,
  'NumpadDecimal':  0x63,

  // Extra
  'IntlBackslash': 0x64,
  'ContextMenu':   0x65,
};

// Modifier bit masks (keyed by event.code)
const MODIFIER_BITS = {
  'ControlLeft':  0x01,
  'ShiftLeft':    0x02,
  'AltLeft':      0x04,
  'MetaLeft':     0x08,
  'ControlRight': 0x10,
  'ShiftRight':   0x20,
  'AltRight':     0x40,
  'MetaRight':    0x80,
};

// Friendly names for display
const KEY_DISPLAY_NAMES = {
  'ControlLeft':  'LCtrl',
  'ControlRight': 'RCtrl',
  'ShiftLeft':    'LShift',
  'ShiftRight':   'RShift',
  'AltLeft':      'LAlt',
  'AltRight':     'RAlt',
  'MetaLeft':     'LGui',
  'MetaRight':    'RGui',
  'Space':        'Space',
  'Enter':        'Enter',
  'Escape':       'Esc',
  'Backspace':    'Bksp',
  'Tab':          'Tab',
  'CapsLock':     'Caps',
  'ArrowUp':      'Up',
  'ArrowDown':    'Down',
  'ArrowLeft':    'Left',
  'ArrowRight':   'Right',
  'Delete':       'Del',
  'Insert':       'Ins',
  'Home':         'Home',
  'End':          'End',
  'PageUp':       'PgUp',
  'PageDown':     'PgDn',
  'PrintScreen':  'PrtSc',
  'ScrollLock':   'ScrLk',
  'Pause':        'Pause',
  'NumLock':      'NumLk',
  'ContextMenu':  'Menu',
};

function keyDisplayName(code) {
  if (KEY_DISPLAY_NAMES[code]) return KEY_DISPLAY_NAMES[code];
  // Strip common prefixes for cleaner display
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num' + code.slice(6);
  if (code.startsWith('F') && /^F\d+$/.test(code)) return code;
  return code;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const state = {
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
  pressedKeys: new Map(), // code → hidKeycode
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
};

// ---------------------------------------------------------------------------
// DOM elements
// ---------------------------------------------------------------------------

const $ = (sel) => document.querySelector(sel);
const el = {
  video:          $('#video'),
  videoOverlay:   $('#video-overlay'),
  captureSelect:  $('#capture-select'),
  modeSelect:     $('#mode-select'),
  btnStartCap:    $('#btn-start-capture'),
  btnStopCap:     $('#btn-stop-capture'),
  audioVolume:    $('#audio-volume'),
  audioVolLabel:  $('#audio-volume-label'),
  btnMute:        $('#btn-mute'),
  videoSection:   $('#video-section'),
  btnLarge:       $('#btn-large'),
  btnFullscreen:  $('#btn-fullscreen'),
  btnBle:         $('#btn-ble'),
  btnSerial:      $('#btn-serial'),
  btnDisconnect:  $('#btn-disconnect'),
  btnLoopback:    $('#btn-loopback'),
  statusDot:      $('#status-dot'),
  statusText:     $('#status-text'),
  devVersion:     $('#dev-version'),
  devBoard:       $('#dev-board'),
  devTransport:   $('#dev-transport'),
  devError:       $('#dev-error'),
  devHeartbeat:   $('#dev-heartbeat'),
  keyList:        $('#key-list'),
  mouseArea:      $('#mouse-area'),
  mouseLabel:     $('#mouse-area-label'),
  logPanel:       $('#log'),
};

// ---------------------------------------------------------------------------
// UI — logging
// ---------------------------------------------------------------------------

const MAX_LOG_ENTRIES = 500;

function log(level, message) {
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
// UI — connection status
// ---------------------------------------------------------------------------

function setConnectionStatus(status, text) {
  el.statusDot.className = `dot ${status}`;
  el.statusText.textContent = text;

  const connected = status === 'connected';
  el.btnBle.disabled = connected || status === 'connecting';
  el.btnSerial.disabled = connected || status === 'connecting';
  el.btnDisconnect.disabled = !connected;
  el.btnLoopback.disabled = !connected;
}

function updateDeviceStatus() {
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
// UI — key state display
// ---------------------------------------------------------------------------

function updateKeyDisplay() {
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

// ---------------------------------------------------------------------------
// BLE — write serialization & sending
// ---------------------------------------------------------------------------

// BLE write serializer — Chrome only allows one GATT write at a time.
// Without this, rapid key/mouse events cause "GATT operation already in progress"
// errors that crash the BLE connection.
let _bleWriteQueue = Promise.resolve();

function bleWriteSerialized(char, data) {
  // Chain writes so each waits for the previous to complete.
  _bleWriteQueue = _bleWriteQueue.then(async () => {
    await char.writeValueWithoutResponse(data);
  });
  return _bleWriteQueue;
}

async function sendFrame(type, payload) {
  const frame = buildFrame(type, payload);

  try {
    if (state.transport === 'ble' && state.bleRxChar) {
      await bleWriteSerialized(state.bleRxChar, frame);
    } else if (state.transport === 'serial' && state.serialWriter) {
      await state.serialWriter.write(frame);
    } else {
      return; // Not connected
    }
  } catch (err) {
    // Only log and handle disconnect if we're still supposedly connected
    if (state.transport) {
      log('error', `Send failed: ${err.message}`);
      if (state.transport === 'ble') {
        handleBleDisconnect();
      }
    }
  }
}

async function sendKeyboardReport() {
  const payload = new Uint8Array(8);
  payload[0] = state.modifiers;
  payload[1] = 0; // reserved

  // Fill keycodes (up to 6)
  const keycodes = Array.from(state.pressedKeys.values()).slice(0, 6);
  for (let i = 0; i < keycodes.length; i++) {
    payload[2 + i] = keycodes[i];
  }

  await sendFrame(TYPE_KEYBOARD_REPORT, payload);
}

async function sendMouseReport(buttons, dx, dy, wheel, pan) {
  const payload = new Uint8Array(5);
  payload[0] = buttons;
  payload[1] = clampInt8(dx);
  payload[2] = clampInt8(dy);
  payload[3] = clampInt8(wheel);
  payload[4] = clampInt8(pan);

  await sendFrame(TYPE_MOUSE_REPORT, payload);
}

function clampInt8(val) {
  val = Math.round(val);
  if (val > 127) val = 127;
  if (val < -128) val = -128;
  // Convert to unsigned byte
  return val & 0xFF;
}

// ---------------------------------------------------------------------------
// Protocol — incoming frame handler
// ---------------------------------------------------------------------------

function handleFrame(type, payload) {
  const typeName = TYPE_NAMES[type] || `0x${type.toString(16)}`;

  switch (type) {
    case TYPE_STATUS_RESPONSE:
      if (payload.length >= 4) {
        state.deviceVersion = payload[0];
        state.deviceBoard = payload[1];
        state.deviceTransport = payload[2];
        state.deviceError = payload[3];
        updateDeviceStatus();
        log('success', `Device status: v${payload[0]}, board=${BOARD_NAMES[payload[1]] || payload[1]}, transport=${TRANSPORT_NAMES[payload[2]] || payload[2]}, error=${payload[3]}`);
      } else {
        log('warn', `STATUS_RESPONSE too short: ${payload.length} bytes`);
      }
      break;

    case TYPE_HEARTBEAT_ACK:
      if (payload.length >= 1) {
        state.lastHeartbeatAck = payload[0];
        state.heartbeatMissed = 0;
        updateDeviceStatus();
      }
      break;

    case TYPE_ACK:
      if (payload.length >= 1) {
        const ackStatus = payload[0];
        if (ackStatus !== 0) {
          log('warn', `ACK with error status: 0x${ackStatus.toString(16)}`);
        }
      }
      break;

    case TYPE_ECHO:
      // Echo response for loopback test
      if (state.pendingEcho) {
        clearTimeout(state.echoTimeout);
        const expected = state.pendingEcho;
        state.pendingEcho = null;

        // Compare payloads
        let match = expected.length === payload.length;
        if (match) {
          for (let i = 0; i < expected.length; i++) {
            if (expected[i] !== payload[i]) {
              match = false;
              break;
            }
          }
        }

        if (match) {
          log('success', `Loopback test PASSED (${payload.length} bytes)`);
        } else {
          log('error', `Loopback test FAILED: payload mismatch`);
          log('error', `  Expected: [${Array.from(expected).map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`);
          log('error', `  Received: [${Array.from(payload).map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`);
        }
      } else {
        log('info', `Unexpected ECHO response (${payload.length} bytes)`);
      }
      break;

    default:
      log('info', `Received ${typeName} (${payload.length} bytes)`);
  }
}

// ---------------------------------------------------------------------------
// BLE — connection
// ---------------------------------------------------------------------------

// Shared GATT connection logic — used by both manual connect and auto-connect.
// Takes an already-obtained BluetoothDevice and establishes the full connection.
async function connectToDevice(device) {
  state.bleDevice = device;
  device.addEventListener('gattserverdisconnected', handleBleDisconnect);

  setConnectionStatus('connecting', `Connecting to "${device.name}"...`);
  log('info', `Connecting to "${device.name}"...`);

  const server = await device.gatt.connect();
  state.bleServer = server;

  const service = await server.getPrimaryService(BLE_SERVICE_UUID);
  state.bleService = service;

  const rxChar = await service.getCharacteristic(BLE_RX_CHAR_UUID);
  const txChar = await service.getCharacteristic(BLE_TX_CHAR_UUID);

  state.bleRxChar = rxChar;
  state.bleTxChar = txChar;

  await txChar.startNotifications();
  txChar.addEventListener('characteristicvaluechanged', onBleTxNotification);

  state.transport = 'ble';
  state.reconnecting = false;
  state.reconnectAttempts = 0;
  state.frameParser = new FrameParser(handleFrame);

  setConnectionStatus('connected', `Connected (BLE: ${device.name})`);
  log('success', `BLE connected to "${device.name}"`);

  // Send clean key release + status request
  await sendFrame(TYPE_KEYBOARD_REPORT, new Uint8Array(8));
  await sendFrame(TYPE_STATUS_REQUEST, []);
  startHeartbeat();
}

// Manual connect — opens the browser device picker for first-time pairing
async function connectBle() {
  cancelAutoConnect();
  if (!navigator.bluetooth) {
    log('error', 'Web Bluetooth API not available. Use Chrome/Edge with HTTPS.');
    return;
  }

  try {
    setConnectionStatus('connecting', 'Requesting BLE device...');
    log('info', 'Requesting BLE device...');

    const device = await navigator.bluetooth.requestDevice({
      filters: [
        { namePrefix: BLE_DEVICE_NAME },
        { services: [BLE_SERVICE_UUID] },
      ],
      optionalServices: [BLE_SERVICE_UUID],
    });

    await connectToDevice(device);

  } catch (err) {
    if (err.name === 'NotFoundError') {
      log('info', 'BLE device selection cancelled');
      setConnectionStatus('disconnected', 'Disconnected');
    } else {
      log('error', `BLE connection failed: ${err.message}`);
      setConnectionStatus('error', 'Connection failed');
    }
    cleanupBle();
  }
}

// Auto-connect — finds previously paired keebler devices and connects
// without user interaction. Retries persistently in the background.
let _autoConnectTimer = null;

async function autoConnectBle() {
  // Don't auto-connect if already connected or manually disconnected
  if (state.transport) return;
  if (!navigator.bluetooth || !navigator.bluetooth.getDevices) return;

  try {
    const devices = await navigator.bluetooth.getDevices();
    const keeblerDevices = devices.filter(d =>
      d.name && d.name.toLowerCase().startsWith(BLE_DEVICE_NAME)
    );

    if (keeblerDevices.length === 0) return;

    for (const device of keeblerDevices) {
      try {
        log('info', `Auto-connecting to paired device "${device.name}"...`);
        setConnectionStatus('connecting', `Auto-connecting to ${device.name}...`);

        // watchAdvertisements lets us know the device is in range
        // before attempting connection. But some browsers support
        // direct connect on previously paired devices.
        await connectToDevice(device);
        log('success', `Auto-connected to "${device.name}"`);
        return; // Success — stop trying
      } catch (err) {
        log('info', `Auto-connect to "${device.name}" failed: ${err.message}`);
      }
    }

    // All devices failed — retry in 5 seconds
    setConnectionStatus('disconnected', 'Disconnected (retrying...)');
    scheduleAutoConnect(5000);

  } catch (err) {
    // getDevices() not supported or failed — silent
    if (err.name !== 'TypeError') {
      log('info', `Auto-connect unavailable: ${err.message}`);
    }
  }
}

function scheduleAutoConnect(delay) {
  if (_autoConnectTimer) clearTimeout(_autoConnectTimer);
  _autoConnectTimer = setTimeout(() => {
    _autoConnectTimer = null;
    if (!state.transport) autoConnectBle();
  }, delay);
}

function cancelAutoConnect() {
  if (_autoConnectTimer) {
    clearTimeout(_autoConnectTimer);
    _autoConnectTimer = null;
  }
}

function onBleTxNotification(event) {
  const value = event.target.value;
  const data = new Uint8Array(value.buffer);
  if (state.frameParser) {
    state.frameParser.feed(data);
  }
}

function handleBleDisconnect() {
  const wasConnected = state.transport === 'ble';
  // Reset BLE write queue so stale promises don't block reconnect
  _bleWriteQueue = Promise.resolve();
  cleanupConnection();

  if (wasConnected && !state.reconnecting) {
    log('warn', 'BLE disconnected');
    setConnectionStatus('disconnected', 'Disconnected');
    attemptReconnect();
  }
}

function cleanupBle() {
  if (state.bleTxChar) {
    try {
      state.bleTxChar.removeEventListener('characteristicvaluechanged', onBleTxNotification);
    } catch (e) { /* ignore */ }
  }
  if (state.bleServer && state.bleServer.connected) {
    try {
      state.bleServer.disconnect();
    } catch (e) { /* ignore */ }
  }
  state.bleRxChar = null;
  state.bleTxChar = null;
  state.bleService = null;
  state.bleServer = null;
  // Keep bleDevice for reconnection
}

// ---------------------------------------------------------------------------
// BLE — reconnection
// ---------------------------------------------------------------------------

function attemptReconnect() {
  if (!state.bleDevice || state.reconnecting) return;
  if (state.reconnectAttempts >= state.maxReconnectAttempts) {
    log('warn', `Reconnect failed after ${state.maxReconnectAttempts} attempts, switching to auto-connect`);
    state.bleDevice = null;
    state.reconnecting = false;
    // Fall back to auto-connect which will persistently retry
    scheduleAutoConnect(3000);
    return;
  }

  state.reconnecting = true;
  state.reconnectAttempts++;

  const delay = state.reconnectAttempts === 1
    ? 3000
    : Math.min(state.reconnectBaseDelay * Math.pow(1.5, state.reconnectAttempts - 1), 10000);

  log('info', `Reconnecting in ${(delay / 1000).toFixed(1)}s (attempt ${state.reconnectAttempts}/${state.maxReconnectAttempts})...`);
  setConnectionStatus('connecting', `Reconnecting (${state.reconnectAttempts})...`);

  state.reconnectTimer = setTimeout(async () => {
    try {
      if (!state.bleDevice || !state.bleDevice.gatt) {
        throw new Error('Device no longer available');
      }

      // Re-use the existing device reference for fast reconnect
      cleanupBle();
      await connectToDevice(state.bleDevice);
      log('success', 'BLE reconnected');

    } catch (err) {
      log('warn', `Reconnect attempt ${state.reconnectAttempts} failed: ${err.message}`);
      state.reconnecting = false;
      attemptReconnect();
    }
  }, delay);
}

// ---------------------------------------------------------------------------
// Serial — connection (fallback transport)
// ---------------------------------------------------------------------------

async function connectSerial() {
  if (!navigator.serial) {
    log('error', 'Web Serial API not available. Use Chrome/Edge with HTTPS.');
    return;
  }

  try {
    setConnectionStatus('connecting', 'Requesting serial port...');
    log('info', 'Requesting serial port...');

    const port = await navigator.serial.requestPort();
    await port.open({ baudRate: SERIAL_BAUD });

    state.serialPort = port;
    state.transport = 'serial';

    // Set up writer
    state.serialWriter = port.writable.getWriter();

    // Set up frame parser
    state.frameParser = new FrameParser(handleFrame);

    // Start read loop
    state.serialReadLoopActive = true;
    serialReadLoop(port.readable);

    setConnectionStatus('connected', 'Connected (Serial)');
    log('success', 'Serial connected');

    // Request device status
    await sendFrame(TYPE_STATUS_REQUEST, []);
    log('info', 'Sent STATUS_REQUEST');

    // Start heartbeat
    startHeartbeat();

  } catch (err) {
    if (err.name === 'NotFoundError') {
      log('info', 'Serial port selection cancelled');
      setConnectionStatus('disconnected', 'Disconnected');
    } else {
      log('error', `Serial connection failed: ${err.message}`);
      setConnectionStatus('error', 'Connection failed');
    }
    cleanupSerial();
  }
}

async function serialReadLoop(readable) {
  try {
    const reader = readable.getReader();
    state.serialReader = reader;

    while (state.serialReadLoopActive) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value && state.frameParser) {
        state.frameParser.feed(value);
      }
    }

    reader.releaseLock();
  } catch (err) {
    if (state.serialReadLoopActive) {
      log('error', `Serial read error: ${err.message}`);
      disconnect();
    }
  }
}

function cleanupSerial() {
  state.serialReadLoopActive = false;

  if (state.serialReader) {
    try {
      state.serialReader.cancel();
    } catch (e) { /* ignore */ }
    state.serialReader = null;
  }

  if (state.serialWriter) {
    try {
      state.serialWriter.releaseLock();
    } catch (e) { /* ignore */ }
    state.serialWriter = null;
  }

  if (state.serialPort) {
    try {
      state.serialPort.close();
    } catch (e) { /* ignore */ }
    state.serialPort = null;
  }
}

// ---------------------------------------------------------------------------
// Connection — disconnect & cleanup
// ---------------------------------------------------------------------------

function cleanupConnection() {
  stopHeartbeat();
  // Clear local key/button state without sending (link may be dead)
  releaseAllKeys(false);
  releaseAllMouseButtons(false);

  if (state.transport === 'ble') {
    cleanupBle();
  } else if (state.transport === 'serial') {
    cleanupSerial();
  }

  state.transport = null;
  state.frameParser = null;
  state.deviceVersion = null;
  state.deviceBoard = null;
  state.deviceTransport = null;
  state.deviceError = null;
  updateDeviceStatus();
}

function disconnect() {
  // Cancel any pending reconnect and auto-connect
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }
  cancelAutoConnect();
  state.reconnecting = false;
  state.reconnectAttempts = 0;

  cleanupConnection();
  state.bleDevice = null;

  setConnectionStatus('disconnected', 'Disconnected');
  log('info', 'Disconnected (auto-connect paused — click Connect BLE to resume)');
}

// ---------------------------------------------------------------------------
// Connection — heartbeat
// ---------------------------------------------------------------------------

function startHeartbeat() {
  stopHeartbeat();
  state.heartbeatSeq = 0;
  state.lastHeartbeatAck = 0;
  state.heartbeatMissed = 0;

  state.heartbeatInterval = setInterval(async () => {
    if (!state.transport) {
      stopHeartbeat();
      return;
    }

    // Check for missed heartbeats
    if (state.heartbeatSeq > 0 && state.lastHeartbeatAck < state.heartbeatSeq) {
      state.heartbeatMissed++;
      updateDeviceStatus();

      if (state.heartbeatMissed >= state.maxHeartbeatMissed) {
        log('error', `Heartbeat timeout (${state.heartbeatMissed} missed)`);
        if (state.transport === 'ble') {
          handleBleDisconnect();
        } else {
          disconnect();
        }
        return;
      }
    }

    state.heartbeatSeq = (state.heartbeatSeq + 1) & 0xFF;
    await sendFrame(TYPE_HEARTBEAT, [state.heartbeatSeq]);
  }, 3000); // Every 3 seconds
}

function stopHeartbeat() {
  if (state.heartbeatInterval) {
    clearInterval(state.heartbeatInterval);
    state.heartbeatInterval = null;
  }
}

// ---------------------------------------------------------------------------
// Connection — loopback / echo test
// ---------------------------------------------------------------------------

async function testLoopback() {
  if (!state.transport) {
    log('warn', 'Not connected');
    return;
  }

  // Generate a known test payload
  const testPayload = new Uint8Array(16);
  for (let i = 0; i < testPayload.length; i++) {
    testPayload[i] = (i * 17 + 42) & 0xFF;
  }

  state.pendingEcho = testPayload;

  // Set timeout for response
  state.echoTimeout = setTimeout(() => {
    if (state.pendingEcho) {
      state.pendingEcho = null;
      log('error', 'Loopback test FAILED: timeout (no response in 3s)');
    }
  }, 3000);

  log('info', `Sending ECHO with ${testPayload.length} bytes...`);
  await sendFrame(TYPE_ECHO, testPayload);
}

// ---------------------------------------------------------------------------
// Keyboard — capture
// ---------------------------------------------------------------------------

function onKeyDown(event) {
  // Video display shortcuts work regardless of connection state
  if (!state.transport && event.target.tagName !== 'INPUT' && event.target.tagName !== 'SELECT') {
    if (event.key === 'l' || event.key === 'L') { toggleLargeMode(); return; }
    if (event.key === 'f' || event.key === 'F') { toggleFullscreen(); return; }
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

function onKeyUp(event) {
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

function releaseAllKeys(sendReport = true) {
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

// ---------------------------------------------------------------------------
// Mouse — capture (pointer lock)
// ---------------------------------------------------------------------------

function onMouseAreaClick() {
  if (!state.transport) {
    log('warn', 'Connect to a device before capturing mouse');
    return;
  }

  el.mouseArea.requestPointerLock();
}

function onPointerLockChange() {
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

// Accumulate mouse deltas and send at a throttled rate (~30Hz max)
// to avoid flooding BLE. Deltas are summed between sends.
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

function onMouseMove(event) {
  if (!state.pointerLocked || !state.transport) return;

  _mouseAccumDx += event.movementX;
  _mouseAccumDy += event.movementY;

  if (!_mouseSendPending) {
    _mouseSendPending = true;
    setTimeout(flushMouseAccum, 33); // ~30Hz
  }
}

function onMouseDown(event) {
  if (!state.pointerLocked || !state.transport) return;

  event.preventDefault();

  switch (event.button) {
    case 0: state.mouseButtons |= 0x01; break; // Left
    case 1: state.mouseButtons |= 0x04; break; // Middle
    case 2: state.mouseButtons |= 0x02; break; // Right
  }

  sendMouseReport(state.mouseButtons, 0, 0, 0, 0);
}

function onMouseUp(event) {
  if (!state.pointerLocked || !state.transport) return;

  event.preventDefault();

  switch (event.button) {
    case 0: state.mouseButtons &= ~0x01; break; // Left
    case 1: state.mouseButtons &= ~0x04; break; // Middle
    case 2: state.mouseButtons &= ~0x02; break; // Right
  }

  sendMouseReport(state.mouseButtons, 0, 0, 0, 0);
}

function onWheel(event) {
  if (!state.pointerLocked || !state.transport) return;

  event.preventDefault();

  // Normalize wheel delta to reasonable values
  const wheel = -Math.sign(event.deltaY) * Math.min(Math.abs(Math.round(event.deltaY / 120)), 5);
  const pan = Math.sign(event.deltaX) * Math.min(Math.abs(Math.round(event.deltaX / 120)), 5);

  if (wheel !== 0 || pan !== 0) {
    sendMouseReport(state.mouseButtons, 0, 0, wheel, pan);
  }
}

function releaseAllMouseButtons(sendReport = true) {
  state.mouseButtons = 0;
  if (sendReport && state.transport) {
    sendMouseReport(0, 0, 0, 0, 0);
  }
}

// ---------------------------------------------------------------------------
// Capture — video device (HDMI capture card)
// ---------------------------------------------------------------------------

// Video modes to probe — based on v4l2 inspection of MacroSilicon USB3.0 capture.
// We probe each one against the actual device to build the supported list.
const PROBE_MODES = [
  { width: 1920, height: 1080, fps: 60 },
  { width: 1920, height: 1080, fps: 30 },
  { width: 1600, height: 1200, fps: 60 },
  { width: 1360, height: 768,  fps: 60 },
  { width: 1280, height: 1024, fps: 60 },
  { width: 1280, height: 960,  fps: 60 },
  { width: 1280, height: 720,  fps: 60 },
  { width: 1280, height: 720,  fps: 30 },
  { width: 1024, height: 768,  fps: 60 },
  { width: 800,  height: 600,  fps: 60 },
  { width: 720,  height: 576,  fps: 60 },
  { width: 720,  height: 480,  fps: 60 },
  { width: 640,  height: 480,  fps: 60 },
  { width: 640,  height: 480,  fps: 30 },
];

async function enumerateCaptures() {
  try {
    // Request temporary access to trigger permission prompt and get labels
    let tempStream = null;
    try {
      tempStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch (e) {
      try {
        tempStream = await navigator.mediaDevices.getUserMedia({ video: true });
      } catch (e2) { /* User might deny */ }
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoInputs = devices.filter(d => d.kind === 'videoinput');

    el.captureSelect.innerHTML = '<option value="">-- Select capture device --</option>';

    let autoSelectId = null;

    for (const device of videoInputs) {
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.textContent = device.label || `Camera ${device.deviceId.slice(0, 8)}...`;
      el.captureSelect.appendChild(option);

      const label = (device.label || '').toLowerCase();
      if (label.includes('usb3') || label.includes('capture') || label.includes('macrosilicon')) {
        autoSelectId = device.deviceId;
      }
    }

    if (tempStream) {
      tempStream.getTracks().forEach(t => t.stop());
    }

    if (autoSelectId) {
      el.captureSelect.value = autoSelectId;
      log('success', 'Auto-detected capture device');
      populateVideoModes(autoSelectId);
    }

    if (videoInputs.length === 0) {
      log('warn', 'No video input devices found');
    } else {
      log('info', `Found ${videoInputs.length} video input(s)`);
    }

  } catch (err) {
    log('error', `Failed to enumerate devices: ${err.message}`);
  }
}

async function populateVideoModes(deviceId) {
  el.modeSelect.innerHTML = '<option value="">-- Auto (best) --</option>';

  if (!deviceId) return;

  log('info', 'Probing supported video modes...');

  // Probe each mode by attempting getUserMedia with exact constraints.
  // The browser negotiates with the device driver — if the mode isn't
  // natively supported, it will either fail or return a different resolution.
  let probeCount = 0;
  for (const mode of PROBE_MODES) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: { exact: deviceId },
          width: { exact: mode.width },
          height: { exact: mode.height },
          frameRate: { ideal: mode.fps, max: mode.fps },
        },
      });

      // Check what we actually got
      const track = stream.getVideoTracks()[0];
      const settings = track.getSettings();
      stream.getTracks().forEach(t => t.stop());

      // Only add if the device actually gave us the requested resolution
      if (settings.width === mode.width && settings.height === mode.height) {
        const actualFps = Math.round(settings.frameRate || mode.fps);
        const opt = document.createElement('option');
        opt.value = JSON.stringify({ width: mode.width, height: mode.height, fps: actualFps });
        opt.textContent = `${mode.width}x${mode.height} @${actualFps}fps`;
        el.modeSelect.appendChild(opt);
        probeCount++;
      }
    } catch (e) {
      // Mode not supported — skip
    }
  }

  log('info', `Found ${probeCount} supported video mode(s)`);
}

async function startCapture() {
  const deviceId = el.captureSelect.value;
  if (!deviceId) {
    log('warn', 'Please select a capture device first');
    return;
  }

  stopCapture();

  try {
    let stream = null;
    const modeStr = el.modeSelect.value;

    // Build video constraints
    const videoConstraints = { deviceId: { exact: deviceId } };

    if (modeStr) {
      // User selected a specific mode
      const mode = JSON.parse(modeStr);
      videoConstraints.width = { exact: mode.width };
      videoConstraints.height = { exact: mode.height };
      videoConstraints.frameRate = { ideal: mode.fps };
    } else {
      // Auto: try best modes in order
      const tryModes = [
        { width: 1920, height: 1080, fps: 60 },
        { width: 1280, height: 720, fps: 60 },
      ];

      for (const mode of tryModes) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              deviceId: { exact: deviceId },
              width: { ideal: mode.width },
              height: { ideal: mode.height },
              frameRate: { ideal: mode.fps },
            },
            audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
          });
          break;
        } catch (e) {
          // Try next
        }
      }
    }

    if (!stream) {
      // Use the specified or fallback constraints
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints,
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        });
      } catch (e) {
        // Try without audio
        stream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints,
          audio: false,
        });
        log('warn', 'Audio not available from capture device');
      }
    }

    state.captureStream = stream;
    el.video.srcObject = stream;
    el.videoOverlay.classList.add('hidden');
    el.btnStartCap.disabled = true;
    el.btnStopCap.disabled = false;

    // Set up audio routing with volume control
    setupAudio(stream);

    // Log actual resolution
    const vTrack = stream.getVideoTracks()[0];
    if (vTrack) {
      const s = vTrack.getSettings();
      log('info', `Capture: ${s.width}x${s.height}@${s.frameRate}fps`);
    }

    const aTrack = stream.getAudioTracks()[0];
    if (aTrack) {
      const as = aTrack.getSettings();
      const agc = as.autoGainControl ? 'ON' : 'off';
      const ec = as.echoCancellation ? 'ON' : 'off';
      const ns = as.noiseSuppression ? 'ON' : 'off';
      log('info', `Audio: ${aTrack.label || 'connected'}`);
      const processing = (as.autoGainControl || as.echoCancellation || as.noiseSuppression);
      if (processing) {
        log('warn', `Audio processing ACTIVE: AGC=${agc} EC=${ec} NS=${ns} (may cause fade in/out)`);
      } else {
        log('success', `Audio processing disabled: AGC=${agc} EC=${ec} NS=${ns}`);
      }
    }

  } catch (err) {
    log('error', `Capture failed: ${err.message}`);
  }
}

function setupAudio(stream) {
  // Clean up previous audio context
  teardownAudio();

  const audioTracks = stream.getAudioTracks();
  if (audioTracks.length === 0) return;

  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const source = ctx.createMediaStreamSource(stream);
    const gain = ctx.createGain();

    gain.gain.value = state.audioMuted ? 0 : state.audioVolume;

    source.connect(gain);
    gain.connect(ctx.destination);

    state.audioContext = ctx;
    state.audioSource = source;
    state.audioGain = gain;

    // Mute the video element itself — audio goes through Web Audio API
    el.video.muted = true;
  } catch (e) {
    log('warn', `Audio setup failed: ${e.message}`);
    // Fall back to video element audio
    el.video.muted = false;
    el.video.volume = state.audioVolume;
  }
}

function teardownAudio() {
  if (state.audioSource) {
    try { state.audioSource.disconnect(); } catch (e) {}
    state.audioSource = null;
  }
  if (state.audioGain) {
    try { state.audioGain.disconnect(); } catch (e) {}
    state.audioGain = null;
  }
  if (state.audioContext && state.audioContext.state !== 'closed') {
    try { state.audioContext.close(); } catch (e) {}
    state.audioContext = null;
  }
}

function setVolume(value) {
  state.audioVolume = value;
  if (state.audioGain) {
    state.audioGain.gain.value = state.audioMuted ? 0 : value;
  }
  // Fallback for when Web Audio isn't used
  if (!state.audioGain && el.video) {
    el.video.volume = state.audioMuted ? 0 : value;
  }
  el.audioVolLabel.textContent = `${Math.round(value * 100)}%`;
}

function toggleMute() {
  state.audioMuted = !state.audioMuted;
  el.btnMute.textContent = state.audioMuted ? 'Unmute' : 'Mute';

  if (state.audioGain) {
    state.audioGain.gain.value = state.audioMuted ? 0 : state.audioVolume;
  }
  if (!state.audioGain && el.video) {
    el.video.muted = state.audioMuted;
  }
}

// ---------------------------------------------------------------------------
// Capture — video display modes (large / fullscreen)
// ---------------------------------------------------------------------------

function toggleLargeMode() {
  el.videoSection.classList.toggle('large');
  el.btnLarge.classList.toggle('active');
}

function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else {
    el.videoSection.requestFullscreen().catch(err => {
      log('warn', `Fullscreen failed: ${err.message}`);
    });
  }
}

// Sync button state when exiting fullscreen via Escape
document.addEventListener('fullscreenchange', () => {
  el.btnFullscreen.classList.toggle('active', !!document.fullscreenElement);
});

function stopCapture() {
  teardownAudio();
  if (state.captureStream) {
    state.captureStream.getTracks().forEach(t => t.stop());
    state.captureStream = null;
  }
  el.video.srcObject = null;
  el.videoOverlay.classList.remove('hidden');
  el.btnStartCap.disabled = false;
  el.btnStopCap.disabled = true;
}

// ---------------------------------------------------------------------------
// UI — window blur handler
// ---------------------------------------------------------------------------

function onWindowBlur() {
  releaseAllKeys();
  releaseAllMouseButtons();
}

function onVisibilityChange() {
  if (document.hidden) {
    releaseAllKeys();
    releaseAllMouseButtons();
  }
}

// ---------------------------------------------------------------------------
// Init — service worker registration
// ---------------------------------------------------------------------------

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  // Service workers require a trusted cert on non-localhost origins.
  // Skip registration silently when using a self-signed cert over LAN —
  // the app works fine without it, SW is just for offline/PWA caching.
  if (location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
    log('info', 'Skipping service worker on non-localhost (self-signed cert)');
    return;
  }

  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    log('info', `Service worker registered (scope: ${reg.scope})`);
  } catch (err) {
    log('warn', `Service worker registration failed: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Init — browser API checks
// ---------------------------------------------------------------------------

function checkBrowserApis() {
  let allGood = true;

  if (!navigator.bluetooth) {
    log('warn', 'Web Bluetooth not available - BLE connection disabled');
    el.btnBle.disabled = true;
    el.btnBle.title = 'Web Bluetooth not available';
    allGood = false;
  }

  if (!navigator.serial) {
    log('warn', 'Web Serial not available - Serial connection disabled');
    el.btnSerial.disabled = true;
    el.btnSerial.title = 'Web Serial not available';
    allGood = false;
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    log('warn', 'getUserMedia not available - video capture disabled');
    el.btnStartCap.disabled = true;
    allGood = false;
  }

  if (!window.isSecureContext) {
    log('error', 'Page not served in a secure context (HTTPS required). BLE, Serial, and getUserMedia will not work.');
    allGood = false;
  }

  if (allGood) {
    log('success', 'All browser APIs available');
  }
}

// ---------------------------------------------------------------------------
// UI — context menu prevention (while mouse is captured)
// ---------------------------------------------------------------------------

function onContextMenu(event) {
  if (state.pointerLocked) {
    event.preventDefault();
  }
}

// ---------------------------------------------------------------------------
// Init — entry point
// ---------------------------------------------------------------------------

function init() {
  log('info', 'keebler web app starting...');

  // Check browser APIs
  checkBrowserApis();

  // Enumerate capture devices
  enumerateCaptures();

  // Register service worker
  registerServiceWorker();

  // Button handlers
  el.btnBle.addEventListener('click', connectBle);
  el.btnSerial.addEventListener('click', connectSerial);
  el.btnDisconnect.addEventListener('click', disconnect);
  el.btnLoopback.addEventListener('click', testLoopback);
  el.btnStartCap.addEventListener('click', startCapture);
  el.btnStopCap.addEventListener('click', stopCapture);
  el.captureSelect.addEventListener('change', () => populateVideoModes(el.captureSelect.value));
  el.audioVolume.addEventListener('input', (e) => setVolume(e.target.value / 100));
  el.btnMute.addEventListener('click', toggleMute);
  el.btnLarge.addEventListener('click', toggleLargeMode);
  el.btnFullscreen.addEventListener('click', toggleFullscreen);

  // Keyboard capture
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);

  // Mouse capture
  el.mouseArea.addEventListener('click', onMouseAreaClick);
  document.addEventListener('pointerlockchange', onPointerLockChange);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('wheel', onWheel, { passive: false });
  document.addEventListener('contextmenu', onContextMenu);

  // Release keys on blur
  window.addEventListener('blur', onWindowBlur);
  document.addEventListener('visibilitychange', onVisibilityChange);

  // Re-enumerate when devices change
  if (navigator.mediaDevices) {
    navigator.mediaDevices.addEventListener('devicechange', enumerateCaptures);
  }

  // Show video overlay initially
  el.videoOverlay.classList.remove('hidden');

  // C64 Ultimate file transfer
  c64Init();

  // Mode detection — ?mode=c64 activates Commodore theme
  const urlParams = new URLSearchParams(window.location.search);
  const appMode = urlParams.get('mode');
  const modeLink = document.getElementById('mode-link');
  if (appMode === 'c64') {
    document.body.classList.add('c64-mode');
    // Auto-expand C64 panel
    const details = document.getElementById('c64-details');
    if (details) details.open = true;
    // Auto-connect if IP is saved
    if (c64.el.ip.value) {
      setTimeout(c64Connect, 500);
    }
    // Toggle link points back to normal mode
    if (modeLink) {
      modeLink.href = window.location.pathname;
      modeLink.textContent = 'Standard Mode';
    }
    // Wire up quick bar load button
    const qbLoad = document.getElementById('btn-c64-quick-load');
    if (qbLoad) {
      qbLoad.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.prg,.d64,.d71,.d81,.g64,.dnp,.sid,.crt,.mod,.xm,.s3m';
        input.multiple = true;
        input.addEventListener('change', () => {
          if (input.files.length > 0) {
            const statusEl = document.getElementById('c64-quick-status');
            if (statusEl) statusEl.textContent = '';
            c64UploadFiles(input.files).then(() => {
              if (statusEl) statusEl.textContent = 'Done';
              setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 3000);
            });
          }
        });
        input.click();
      });
    }
    log('info', 'C64 mode active');
  }

  log('success', 'Ready');

  // Auto-connect to previously paired keebler devices
  scheduleAutoConnect(1500);
}

// ---------------------------------------------------------------------------
// C64 Ultimate -- file browser and drag-and-drop upload
// ---------------------------------------------------------------------------

const c64 = {
  ip: null,
  password: '',
  connected: false,
  currentPath: '/SD',
  el: {},
};

function c64Init() {
  c64.el = {
    ip:           $('#c64-ip'),
    password:     $('#c64-password'),
    btnConnect:   $('#btn-c64-connect'),
    statusText:   $('#c64-status-text'),
    browser:      $('#c64-browser'),
    pathBar:      $('#c64-current-path'),
    fileList:     $('#c64-file-list'),
    dropZone:     $('#c64-drop-zone'),
    uploadStatus: $('#c64-upload-status'),
    btnUp:        $('#btn-c64-up'),
  };

  // Restore saved IP
  const savedIp = localStorage.getItem('keebler_c64_ip');
  if (savedIp) c64.el.ip.value = savedIp;

  c64.el.btnConnect.addEventListener('click', c64Connect);
  c64.el.btnUp.addEventListener('click', () => {
    const parent = c64.currentPath.replace(/\/[^/]+$/, '') || '/';
    c64Browse(parent);
  });

  // Drag and drop
  const dz = c64.el.dropZone;
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('dragover'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
  dz.addEventListener('drop', c64OnDrop);

  // Also support click-to-select
  dz.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.addEventListener('change', () => {
      if (input.files.length > 0) c64UploadFiles(input.files);
    });
    input.click();
  });

  // Enter key on IP input
  c64.el.ip.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') c64Connect();
  });
}

function c64ProxyUrl(path) {
  // Use nginx reverse proxy to avoid CORS issues.
  // Falls back to direct URL if running on GitHub Pages (no proxy available).
  const base = window.location.hostname === 'localhost' ||
               window.location.hostname.match(/^[0-9.]+$/)
    ? `/c64proxy/${c64.ip}`
    : `http://${c64.ip}`;
  return `${base}${path}`;
}

async function c64Connect() {
  const ip = c64.el.ip.value.trim();
  if (!ip) {
    log('warn', 'Enter the C64 Ultimate IP address');
    return;
  }

  c64.ip = ip;
  c64.password = c64.el.password.value.trim() || '';
  localStorage.setItem('keebler_c64_ip', ip);
  c64.el.statusText.textContent = 'Connecting...';

  try {
    const resp = await fetch(c64ProxyUrl('/v1/info'), { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const info = await resp.json();

    c64.connected = true;
    c64.el.statusText.textContent = `${info.product || 'C64 Ultimate'} v${info.firmware_version || '?'}`;
    c64.el.statusText.style.color = 'var(--success)';
    c64.el.browser.classList.remove('hidden');
    log('success', `C64 Ultimate connected: ${info.product} firmware ${info.firmware_version}`);

    c64Browse('/SD');
  } catch (err) {
    c64.connected = false;
    c64.el.statusText.textContent = `Failed: ${err.message}`;
    c64.el.statusText.style.color = 'var(--error)';
    c64.el.browser.classList.add('hidden');
    log('error', `C64 connection failed: ${err.message}`);
  }
}

async function c64Browse(path) {
  if (!c64.connected) return;

  c64.currentPath = path;
  c64.el.pathBar.textContent = path;
  c64.el.fileList.innerHTML = '<div style="padding:0.5rem;color:var(--text-secondary)">Loading...</div>';

  try {
    // The C64 Ultimate serves directory listings via FTP-style at the root
    // and via its web interface. Try the REST API first.
    const resp = await fetch(c64ProxyUrl(`/v1/files?path=${encodeURIComponent(path)}`),
      { signal: AbortSignal.timeout(5000) });

    if (resp.ok) {
      const data = await resp.json();
      c64RenderFileList(data);
      return;
    }

    // Fallback: try FTP listing via proxy
    const ftpResp = await fetch(c64ProxyUrl(path), { signal: AbortSignal.timeout(5000) });
    if (ftpResp.ok) {
      const text = await ftpResp.text();
      c64RenderFtpListing(text);
      return;
    }

    c64.el.fileList.innerHTML = '<div style="padding:0.5rem;color:var(--error)">Could not list directory</div>';
  } catch (err) {
    c64.el.fileList.innerHTML = `<div style="padding:0.5rem;color:var(--error)">${err.message}</div>`;
  }
}

function c64RenderFileList(data) {
  const list = c64.el.fileList;
  list.innerHTML = '';

  // Handle JSON array or object with entries
  const entries = Array.isArray(data) ? data : (data.files || data.entries || []);

  if (entries.length === 0) {
    list.innerHTML = '<div style="padding:0.5rem;color:var(--text-secondary)">(empty)</div>';
    return;
  }

  for (const entry of entries) {
    const name = entry.name || entry;
    const isDir = entry.is_dir || entry.type === 'dir' || (typeof entry === 'string' && !entry.includes('.'));
    const size = entry.size != null ? formatSize(entry.size) : '';

    const el = document.createElement('div');
    el.className = 'c64-file-entry' + (isDir ? ' dir' : '');
    el.innerHTML = `<span>${isDir ? '/' : ''}${name}</span><span class="size">${size}</span>`;

    if (isDir) {
      el.addEventListener('click', () => c64Browse(`${c64.currentPath}/${name}`));
    }

    list.appendChild(el);
  }
}

function c64RenderFtpListing(text) {
  const list = c64.el.fileList;
  list.innerHTML = '';

  // Parse FTP-style listing lines
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length === 0) {
    list.innerHTML = '<div style="padding:0.5rem;color:var(--text-secondary)">(empty)</div>';
    return;
  }

  for (const line of lines) {
    // Format: "drw-rw-rw-   1 user     ftp            0 Jan 01  1980 SD"
    // or:     "-rw-rw-rw-   1 user     ftp        16384 Jan 01  1980 file.prg"
    const match = line.match(/^([d-])\S+\s+\d+\s+\S+\s+\S+\s+(\d+)\s+\S+\s+\d+\s+\S+\s+(.+)$/);
    if (!match) continue;

    const isDir = match[1] === 'd';
    const size = parseInt(match[2]);
    const name = match[3].trim();

    const el = document.createElement('div');
    el.className = 'c64-file-entry' + (isDir ? ' dir' : '');
    el.innerHTML = `<span>${isDir ? '/' : ''}${name}</span><span class="size">${isDir ? '' : formatSize(size)}</span>`;

    if (isDir) {
      el.addEventListener('click', () => c64Browse(`${c64.currentPath}/${name}`));
    }

    list.appendChild(el);
  }
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function c64OnDrop(e) {
  e.preventDefault();
  c64.el.dropZone.classList.remove('dragover');
  if (!c64.connected) {
    log('warn', 'Connect to C64 Ultimate first');
    return;
  }
  const files = e.dataTransfer.files;
  if (files.length > 0) c64UploadFiles(files);
}

// Map file extension to the best C64 Ultimate API action.
// The HTTP API can't save files to SD — it uploads to /Temp/ and runs them.
// For persistent storage, FTP is needed (handled separately).
function c64ActionForFile(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  switch (ext) {
    case 'prg': return { endpoint: '/v1/runners:run_prg', label: 'Run PRG' };
    case 'sid': return { endpoint: '/v1/runners:sidplay', label: 'Play SID' };
    case 'crt': return { endpoint: '/v1/runners:run_crt', label: 'Run CRT' };
    case 'mod':
    case 'xm':
    case 's3m': return { endpoint: '/v1/runners:modplay', label: 'Play MOD' };
    case 'd64':
    case 'd71':
    case 'd81':
    case 'g64':
    case 'dnp': return { endpoint: '/v1/drives:mount/a', label: 'Mount disk' };
    default:    return { endpoint: '/v1/runners:run_prg', label: 'Upload & run' };
  }
}

async function c64UploadFiles(files) {
  const pw = c64.password || '';
  const headers = { 'Content-Type': 'application/octet-stream' };
  if (pw) headers['X-Password'] = pw;

  for (const file of files) {
    const action = c64ActionForFile(file.name);
    c64.el.uploadStatus.textContent = `${action.label}: ${file.name}...`;
    c64.el.uploadStatus.style.color = 'var(--text-secondary)';

    try {
      const resp = await fetch(c64ProxyUrl(action.endpoint), {
        method: 'POST',
        body: file,
        headers,
        signal: AbortSignal.timeout(30000),
      });

      if (resp.ok) {
        c64.el.uploadStatus.textContent = `${action.label}: ${file.name} OK`;
        c64.el.uploadStatus.style.color = 'var(--success)';
        log('success', `C64: ${action.label} ${file.name}`);
      } else if (resp.status === 401 || resp.status === 403) {
        throw new Error('Auth required — set password in C64 Ultimate settings');
      } else {
        throw new Error(`HTTP ${resp.status}`);
      }
    } catch (err) {
      c64.el.uploadStatus.textContent = `Failed: ${file.name} — ${err.message}`;
      c64.el.uploadStatus.style.color = 'var(--error)';
      log('error', `C64 ${action.label} failed: ${err.message}`);
    }
  }
}

// Machine control — send PUT commands to C64 Ultimate
async function c64MachineCmd(command) {
  if (!c64.connected) return;
  const headers = {};
  if (c64.password) headers['X-Password'] = c64.password;
  try {
    const resp = await fetch(c64ProxyUrl(`/v1/machine:${command}`), {
      method: 'PUT', headers, signal: AbortSignal.timeout(5000),
    });
    if (resp.ok) {
      log('info', `C64: ${command}`);
    } else {
      log('warn', `C64 ${command}: HTTP ${resp.status}`);
    }
  } catch (err) {
    log('error', `C64 ${command}: ${err.message}`);
  }
}

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
