// SPDX-License-Identifier: MIT
// keebler connection — BLE, Serial, reconnect, heartbeat, frame handling

import { state } from './state.js';
import {
  BLE_SERVICE_UUID, BLE_RX_CHAR_UUID, BLE_TX_CHAR_UUID, BLE_DEVICE_NAME,
  SERIAL_BAUD, TYPE_KEYBOARD_REPORT, TYPE_MOUSE_REPORT, TYPE_STATUS_REQUEST,
  TYPE_STATUS_RESPONSE, TYPE_HEARTBEAT, TYPE_HEARTBEAT_ACK, TYPE_ACK, TYPE_ECHO,
  TYPE_NAMES, BOARD_NAMES, TRANSPORT_NAMES,
  buildFrame, FrameParser,
} from './protocol.js';
import { log, setConnectionStatus, updateDeviceStatus } from './ui.js';

// ---------------------------------------------------------------------------
// Forward-declared callbacks — set by keyboard.js and mouse.js via setters
// ---------------------------------------------------------------------------

let _releaseAllKeys = () => {};
let _releaseAllMouseButtons = () => {};

export function setReleaseAllKeys(fn) { _releaseAllKeys = fn; }
export function setReleaseAllMouseButtons(fn) { _releaseAllMouseButtons = fn; }

// ---------------------------------------------------------------------------
// WiFi frame handler registration — wifi.js registers at init time
// ---------------------------------------------------------------------------

let _wifiFrameHandler = null;

export function registerWifiHandler(handler) { _wifiFrameHandler = handler; }

// ---------------------------------------------------------------------------
// BLE write serialization
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

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

export async function sendFrame(type, payload) {
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

function clampInt8(val) {
  val = Math.round(val);
  if (val > 127) val = 127;
  if (val < -128) val = -128;
  // Convert to unsigned byte
  return val & 0xFF;
}

export async function sendKeyboardReport() {
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

export async function sendMouseReport(buttons, dx, dy, wheel, pan) {
  const payload = new Uint8Array(5);
  payload[0] = buttons;
  payload[1] = clampInt8(dx);
  payload[2] = clampInt8(dy);
  payload[3] = clampInt8(wheel);
  payload[4] = clampInt8(pan);

  await sendFrame(TYPE_MOUSE_REPORT, payload);
}

// ---------------------------------------------------------------------------
// Incoming frame handler
// ---------------------------------------------------------------------------

export function handleFrame(type, payload) {
  // Route WiFi/HTTP packets (0x40-0x5F) to registered handler
  if (type >= 0x40 && type <= 0x5F && _wifiFrameHandler) {
    _wifiFrameHandler(type, payload);
    return;
  }

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
export async function connectToDevice(device) {
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
export async function connectBle() {
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

// ---------------------------------------------------------------------------
// BLE — auto-connect
// ---------------------------------------------------------------------------

// Auto-connect — finds previously paired keebler devices and connects
// without user interaction. Retries persistently in the background.
let _autoConnectTimer = null;

export async function autoConnectBle() {
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

export function scheduleAutoConnect(delay) {
  if (_autoConnectTimer) clearTimeout(_autoConnectTimer);
  _autoConnectTimer = setTimeout(() => {
    _autoConnectTimer = null;
    if (!state.transport) autoConnectBle();
  }, delay);
}

export function cancelAutoConnect() {
  if (_autoConnectTimer) {
    clearTimeout(_autoConnectTimer);
    _autoConnectTimer = null;
  }
}

// ---------------------------------------------------------------------------
// BLE — notifications
// ---------------------------------------------------------------------------

function onBleTxNotification(event) {
  const value = event.target.value;
  const data = new Uint8Array(value.buffer);
  if (state.frameParser) {
    state.frameParser.feed(data);
  }
}

// ---------------------------------------------------------------------------
// BLE — disconnect handling
// ---------------------------------------------------------------------------

export function handleBleDisconnect() {
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

export function cleanupBle() {
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

export function attemptReconnect() {
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

export async function connectSerial() {
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

export function cleanupSerial() {
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

export function cleanupConnection() {
  stopHeartbeat();
  // Clear local key/button state without sending (link may be dead)
  _releaseAllKeys(false);
  _releaseAllMouseButtons(false);

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

export function disconnect() {
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
// Heartbeat
// ---------------------------------------------------------------------------

export function startHeartbeat() {
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

export function stopHeartbeat() {
  if (state.heartbeatInterval) {
    clearInterval(state.heartbeatInterval);
    state.heartbeatInterval = null;
  }
}

// ---------------------------------------------------------------------------
// Loopback / echo test
// ---------------------------------------------------------------------------

export async function testLoopback() {
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
