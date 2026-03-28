// SPDX-License-Identifier: MIT
// keebler wifi — WiFi config, token management, BLE-to-HTTP proxy

import { state, $ } from './state.js';
import { sendFrame, registerWifiHandler } from './connection.js';
import { log } from './ui.js';
import {
  TYPE_WIFI_SCAN_REQ, TYPE_WIFI_SCAN_RESULT, TYPE_WIFI_SCAN_DONE,
  TYPE_WIFI_CONNECT_REQ, TYPE_WIFI_STATUS, TYPE_WIFI_DISCONNECT_REQ,
  TYPE_WIFI_TOKEN_VALIDATE, TYPE_WIFI_TOKEN_RESPONSE, TYPE_WIFI_FORGET_REQ,
  TYPE_WIFI_AP_START, TYPE_WIFI_AP_EVENT,
  TYPE_HTTP_REQUEST, TYPE_HTTP_REQUEST_HEADER, TYPE_HTTP_REQUEST_BODY,
  TYPE_HTTP_REQUEST_END, TYPE_HTTP_RESPONSE_STATUS, TYPE_HTTP_RESPONSE_BODY,
  TYPE_HTTP_RESPONSE_DONE, TYPE_HTTP_REQUEST_URL_CONT, TYPE_HTTP_ERROR,
  TYPE_NAMES,
} from './protocol.js';

// ---------------------------------------------------------------------------
// Token management
// ---------------------------------------------------------------------------

const TOKEN_KEY = 'keebler_wifi_token';

/** Returns stored token as Uint8Array(16), or null if not present. */
export function getStoredToken() {
  const hex = localStorage.getItem(TOKEN_KEY);
  if (!hex || hex.length !== 32) return null;
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

/** Save a Uint8Array(16) token as hex string in localStorage. */
export function storeToken(token) {
  const hex = Array.from(token).map(b => b.toString(16).padStart(2, '0')).join('');
  localStorage.setItem(TOKEN_KEY, hex);
}

/** Remove stored token from localStorage. */
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

/** Returns current token or 16 zero bytes for first-time config. */
export function tokenBytes() {
  return getStoredToken() || new Uint8Array(16);
}

// ---------------------------------------------------------------------------
// Pending operation tracking
// ---------------------------------------------------------------------------

let _pendingScan = null;     // { resolve, reject, results: [], timeout }
let _pendingConnect = null;  // { resolve, reject, timeout }
let _pendingResponse = null; // { resolve, reject, status, contentLength, chunks, timeout }
let _onProgress = null;

// ---------------------------------------------------------------------------
// WiFi config functions
// ---------------------------------------------------------------------------

/**
 * Scan for WiFi networks. Returns Promise resolving with array of
 * { ssid: string, rssi: number, auth: number }.
 */
export async function wifiScanNetworks() {
  if (!state.transport) throw new Error('Not connected to device');

  return new Promise((resolve, reject) => {
    if (_pendingScan) {
      _pendingScan.reject(new Error('Scan superseded'));
      clearTimeout(_pendingScan.timeout);
    }
    _pendingScan = {
      resolve, reject,
      results: [],
      timeout: setTimeout(() => {
        _pendingScan = null;
        reject(new Error('WiFi scan timeout'));
      }, 15000),
    };

    sendFrame(TYPE_WIFI_SCAN_REQ, tokenBytes()).catch(err => {
      clearTimeout(_pendingScan.timeout);
      _pendingScan = null;
      reject(err);
    });
  });
}

/**
 * Connect to a WiFi network. Returns Promise resolving on WIFI_STATUS(connected).
 */
export async function wifiConnect(ssid, password) {
  if (!state.transport) throw new Error('Not connected to device');

  const ssidBytes = new TextEncoder().encode(ssid);
  const passBytes = new TextEncoder().encode(password || '');
  const token = tokenBytes();
  const payload = new Uint8Array(16 + 1 + ssidBytes.length + 1 + passBytes.length);
  payload.set(token, 0);
  payload[16] = ssidBytes.length;
  payload.set(ssidBytes, 17);
  payload[17 + ssidBytes.length] = passBytes.length;
  payload.set(passBytes, 18 + ssidBytes.length);

  return new Promise((resolve, reject) => {
    if (_pendingConnect) {
      _pendingConnect.reject(new Error('Connect superseded'));
      clearTimeout(_pendingConnect.timeout);
    }
    _pendingConnect = {
      resolve, reject,
      timeout: setTimeout(() => {
        _pendingConnect = null;
        reject(new Error('WiFi connect timeout'));
      }, 20000),
    };

    sendFrame(TYPE_WIFI_CONNECT_REQ, payload).catch(err => {
      clearTimeout(_pendingConnect.timeout);
      _pendingConnect = null;
      reject(err);
    });
  });
}

/**
 * Start WiFi AP mode — the keeBLEr device creates its own network.
 * Other devices (like C64 Ultimate) connect to this network.
 * @param {string} ssid  The network name to create
 * @param {string} password  WPA2 password (empty = open network)
 */
export async function wifiStartAP(ssid, password) {
  if (!state.transport) return;

  const token = tokenBytes();
  const ssidBytes = new TextEncoder().encode(ssid);
  const passBytes = new TextEncoder().encode(password || '');
  const payload = new Uint8Array(16 + 1 + ssidBytes.length + 1 + passBytes.length);
  payload.set(token, 0);
  payload[16] = ssidBytes.length;
  payload.set(ssidBytes, 17);
  payload[17 + ssidBytes.length] = passBytes.length;
  if (passBytes.length > 0) {
    payload.set(passBytes, 18 + ssidBytes.length);
  }

  log('info', `Starting AP: ${ssid}`);

  return new Promise((resolve, reject) => {
    if (_pendingConnect) {
      _pendingConnect.reject(new Error('Connect superseded'));
      clearTimeout(_pendingConnect.timeout);
    }
    _pendingConnect = {
      resolve, reject,
      timeout: setTimeout(() => {
        _pendingConnect = null;
        reject(new Error('WiFi AP start timeout'));
      }, 15000),
    };
    sendFrame(TYPE_WIFI_AP_START, payload).catch(err => {
      clearTimeout(_pendingConnect.timeout);
      _pendingConnect = null;
      reject(err);
    });
  });
}

/** Send WiFi disconnect request. */
export async function wifiDisconnect() {
  if (!state.transport) return;
  await sendFrame(TYPE_WIFI_DISCONNECT_REQ, tokenBytes());
}

/** Send WiFi status request. */
export async function wifiStatus() {
  if (!state.transport) return;
  // Re-use token validate which also returns status info
  await sendFrame(TYPE_WIFI_TOKEN_VALIDATE, tokenBytes());
}

/** Send WiFi forget request, clear localStorage token. */
export async function wifiForget() {
  if (!state.transport) return;
  await sendFrame(TYPE_WIFI_FORGET_REQ, tokenBytes());
  clearToken();
  state.wifiConnected = false;
  state.wifiSSID = null;
  state.wifiIP = null;
  _updateWifiUI();
}

/** Validate stored token with device. Sends WIFI_TOKEN_VALIDATE. */
let _pendingValidate = null;

export async function wifiValidateToken() {
  if (!state.transport) return false;
  const token = getStoredToken() || new Uint8Array(16); // zeros if no stored token

  return new Promise((resolve) => {
    _pendingValidate = { resolve };
    sendFrame(TYPE_WIFI_TOKEN_VALIDATE, token).catch(() => {
      _pendingValidate = null;
      resolve(false);
    });
    // Timeout after 3 seconds
    setTimeout(() => {
      if (_pendingValidate) {
        _pendingValidate = null;
        resolve(false);
      }
    }, 3000);
  });
}

/** Returns true if BLE connected AND WiFi connected on device. */
export function wifiProxyAvailable() {
  return state.transport === 'ble' && state.wifiConnected;
}

// ---------------------------------------------------------------------------
// Progress callback
// ---------------------------------------------------------------------------

/**
 * Set a progress callback for file transfers.
 * Called with (bytesTransferred, totalBytes, direction='upload'|'download').
 */
export function setProgressCallback(fn) {
  _onProgress = fn;
}

// ---------------------------------------------------------------------------
// BLE HTTP proxy — bleProxyFetch()
// ---------------------------------------------------------------------------

const HTTP_METHODS = { GET: 0, POST: 1, PUT: 2, DELETE: 3, OPTIONS: 4 };

/**
 * Send an HTTP request over BLE to the device WiFi proxy.
 * Returns a fetch()-compatible response object with .ok, .status, .json(), .text().
 */
export async function bleProxyFetch(url, options = {}) {
  if (!state.transport) throw new Error('Not connected to device');
  if (!state.wifiConnected) throw new Error('Device WiFi not connected');

  const method = HTTP_METHODS[options.method || 'GET'] || 0;
  const token = tokenBytes();
  const urlBytes = new TextEncoder().encode(url);

  // Build HTTP_REQUEST packet: token(16) + method(1) + url_len(2,LE) + url(up to 109)
  const firstChunk = Math.min(urlBytes.length, 109);
  const reqPayload = new Uint8Array(16 + 1 + 2 + firstChunk);
  reqPayload.set(token, 0);
  reqPayload[16] = method;
  reqPayload[17] = urlBytes.length & 0xFF;
  reqPayload[18] = (urlBytes.length >> 8) & 0xFF;
  reqPayload.set(urlBytes.subarray(0, firstChunk), 19);
  await sendFrame(TYPE_HTTP_REQUEST, reqPayload);

  // URL continuation if needed
  for (let off = firstChunk; off < urlBytes.length; off += 128) {
    await sendFrame(TYPE_HTTP_REQUEST_URL_CONT, urlBytes.subarray(off, off + 128));
  }

  // Headers (e.g., Content-Type, X-Password)
  if (options.headers) {
    const entries = options.headers instanceof Headers
      ? Array.from(options.headers.entries())
      : Object.entries(options.headers);
    for (const [key, val] of entries) {
      const keyBytes = new TextEncoder().encode(key);
      const valBytes = new TextEncoder().encode(val);
      const hdrPayload = new Uint8Array(1 + keyBytes.length + 1 + valBytes.length);
      hdrPayload[0] = keyBytes.length;
      hdrPayload.set(keyBytes, 1);
      hdrPayload[1 + keyBytes.length] = valBytes.length;
      hdrPayload.set(valBytes, 2 + keyBytes.length);
      await sendFrame(TYPE_HTTP_REQUEST_HEADER, hdrPayload);
    }
  }

  // Body chunks
  if (options.body) {
    const bodyBytes = options.body instanceof Uint8Array ? options.body
      : options.body instanceof ArrayBuffer ? new Uint8Array(options.body)
      : new TextEncoder().encode(options.body);
    for (let off = 0; off < bodyBytes.length; off += 128) {
      await sendFrame(TYPE_HTTP_REQUEST_BODY, bodyBytes.subarray(off, off + 128));
      if (_onProgress) _onProgress(Math.min(off + 128, bodyBytes.length), bodyBytes.length, 'upload');
    }
  }

  // Signal end of request
  await sendFrame(TYPE_HTTP_REQUEST_END, new Uint8Array(0));

  // Wait for response
  return new Promise((resolve, reject) => {
    if (_pendingResponse) {
      _pendingResponse.reject(new Error('Request superseded'));
      clearTimeout(_pendingResponse.timeout);
    }
    _pendingResponse = {
      resolve, reject,
      status: 0,
      contentLength: 0,
      chunks: [],
      bytesReceived: 0,
      timeout: setTimeout(() => {
        _pendingResponse = null;
        reject(new Error('HTTP proxy timeout'));
      }, 30000),
    };
  });
}

// ---------------------------------------------------------------------------
// Frame handler — called by connection.js for types 0x40-0x5F
// ---------------------------------------------------------------------------

export function handleWifiFrame(type, payload) {
  const typeName = TYPE_NAMES[type] || `0x${type.toString(16)}`;

  switch (type) {
    case TYPE_WIFI_SCAN_RESULT:
      _handleScanResult(payload);
      break;

    case TYPE_WIFI_SCAN_DONE:
      _handleScanDone(payload);
      break;

    case TYPE_WIFI_STATUS:
      _handleWifiStatus(payload);
      break;

    case TYPE_WIFI_TOKEN_RESPONSE:
      _handleTokenResponse(payload);
      break;

    case TYPE_HTTP_RESPONSE_STATUS:
      _handleResponseStatus(payload);
      break;

    case TYPE_HTTP_RESPONSE_BODY:
      _handleResponseBody(payload);
      break;

    case TYPE_HTTP_RESPONSE_DONE:
      _handleResponseDone(payload);
      break;

    case TYPE_HTTP_ERROR:
      _handleHttpError(payload);
      break;

    case TYPE_WIFI_AP_EVENT:
      _handleApEvent(payload);
      break;

    default:
      log('info', `WiFi frame ${typeName} (${payload.length} bytes)`);
  }
}

// --- Scan handlers ---

function _handleApEvent(payload) {
  if (payload.length < 7) return;
  const event = payload[0];
  const mac = Array.from(payload.subarray(1, 7)).map(b => b.toString(16).padStart(2, '0')).join(':');
  if (event === 1) {
    log('success', `AP: client connected (${mac})`);
  } else if (event === 2) {
    log('info', `AP: client disconnected (${mac})`);
  }
}

function _handleScanResult(payload) {
  if (!_pendingScan || payload.length < 3) return;
  const rssi = payload[0] > 127 ? payload[0] - 256 : payload[0]; // signed
  const auth = payload[1];
  const ssidLen = payload[2];
  const ssid = new TextDecoder().decode(payload.subarray(3, 3 + ssidLen));
  _pendingScan.results.push({ ssid, rssi, auth });
}

function _handleScanDone(payload) {
  if (!_pendingScan) return;
  clearTimeout(_pendingScan.timeout);
  const results = _pendingScan.results;
  _pendingScan.resolve(results);
  _pendingScan = null;
  log('info', `WiFi scan complete: ${results.length} network(s)`);
}

// --- WiFi status handler ---

function _handleWifiStatus(payload) {
  if (payload.length < 6) return;
  const wifiState = payload[0]; // 0=disconnected, 1=connecting, 2=connected
  const ip = `${payload[1]}.${payload[2]}.${payload[3]}.${payload[4]}`;
  const ssidLen = payload[5];
  const ssid = ssidLen > 0 ? new TextDecoder().decode(payload.subarray(6, 6 + ssidLen)) : '';

  state.wifiConnected = wifiState === 2;
  state.wifiSSID = ssid || null;
  state.wifiIP = (wifiState === 2 && ip !== '0.0.0.0') ? ip : null;

  if (wifiState === 2) {
    log('success', `WiFi connected: ${ssid} (${ip})`);
  } else if (wifiState === 1) {
    log('info', 'WiFi connecting...');
  } else {
    log('info', 'WiFi disconnected');
  }

  _updateWifiUI();

  // Resolve pending connect promise
  if (_pendingConnect && wifiState === 2) {
    clearTimeout(_pendingConnect.timeout);
    _pendingConnect.resolve();
    _pendingConnect = null;
  }
}

// --- Token response handler ---

function _handleTokenResponse(payload) {
  if (payload.length < 18) return;
  const valid = payload[0];
  const token = payload.subarray(1, 17);
  const hasCreds = payload[17];

  if (valid) {
    storeToken(token);
    log('info', `WiFi token ${hasCreds ? 'valid (credentials stored)' : 'valid'}`);
  } else {
    const allZero = token.every(b => b === 0);
    if (!allZero) {
      // Device generated a token for us (first time or reissued)
      storeToken(token);
      log('info', 'WiFi token received from device');
    } else {
      clearToken();
      log('info', 'No WiFi token on device — configure WiFi to generate one');
    }
  }

  // Resolve pending validate
  if (_pendingValidate) {
    _pendingValidate.resolve(valid || !token.every(b => b === 0));
    _pendingValidate = null;
  }

  // Resolve pending connect (token response comes during connect too)
  if (_pendingConnect && valid) {
    // Don't resolve connect here — wait for WIFI_STATUS
  }
}

// --- HTTP response handlers ---

function _handleResponseStatus(payload) {
  if (!_pendingResponse || payload.length < 6) return;
  _pendingResponse.status = payload[0] | (payload[1] << 8);
  _pendingResponse.contentLength = payload[2] | (payload[3] << 8) | (payload[4] << 16) | (payload[5] << 24);
}

function _handleResponseBody(payload) {
  if (!_pendingResponse) return;
  _pendingResponse.chunks.push(new Uint8Array(payload));
  _pendingResponse.bytesReceived += payload.length;
  if (_onProgress) {
    _onProgress(
      _pendingResponse.bytesReceived,
      _pendingResponse.contentLength || _pendingResponse.bytesReceived,
      'download'
    );
  }
}

function _handleResponseDone(_payload) {
  if (!_pendingResponse) return;
  clearTimeout(_pendingResponse.timeout);

  const status = _pendingResponse.status;
  const chunks = _pendingResponse.chunks;

  // Assemble body
  const totalLen = chunks.reduce((sum, c) => sum + c.length, 0);
  const body = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }

  // Build fetch()-compatible response object
  const response = {
    ok: status >= 200 && status < 300,
    status,
    _body: body,
    async text() { return new TextDecoder().decode(this._body); },
    async json() { return JSON.parse(new TextDecoder().decode(this._body)); },
    async arrayBuffer() { return this._body.buffer; },
  };

  _pendingResponse.resolve(response);
  _pendingResponse = null;
}

function _handleHttpError(payload) {
  if (!_pendingResponse) {
    // Log orphan errors
    if (payload.length >= 2) {
      const code = payload[0];
      const msgLen = payload[1];
      const msg = new TextDecoder().decode(payload.subarray(2, 2 + msgLen));
      log('error', `HTTP proxy error (${code}): ${msg}`);
    }
    return;
  }

  clearTimeout(_pendingResponse.timeout);
  const code = payload.length >= 1 ? payload[0] : 0;
  const msgLen = payload.length >= 2 ? payload[1] : 0;
  const msg = msgLen > 0 ? new TextDecoder().decode(payload.subarray(2, 2 + msgLen)) : 'Unknown error';
  _pendingResponse.reject(new Error(`HTTP proxy error (${code}): ${msg}`));
  _pendingResponse = null;
}

// ---------------------------------------------------------------------------
// WiFi UI — DOM elements and event wiring
// ---------------------------------------------------------------------------

const wifiEl = {};

function _updateWifiUI() {
  if (!wifiEl.statusText) return;

  if (state.wifiConnected) {
    wifiEl.statusText.textContent = `Connected: ${state.wifiSSID || '?'} (${state.wifiIP || '?'})`;
    wifiEl.statusText.style.color = 'var(--success)';
    if (wifiEl.btnConnect) wifiEl.btnConnect.classList.add('hidden');
    if (wifiEl.ssidSelect) wifiEl.ssidSelect.classList.add('hidden');
    if (wifiEl.password) wifiEl.password.classList.add('hidden');
    if (wifiEl.btnDisconnect) wifiEl.btnDisconnect.classList.remove('hidden');
    if (wifiEl.btnForget) wifiEl.btnForget.classList.remove('hidden');
  } else {
    wifiEl.statusText.textContent = getStoredToken() ? 'Configured (not connected)' : 'Not configured';
    wifiEl.statusText.style.color = 'var(--text-secondary)';
    if (wifiEl.btnDisconnect) wifiEl.btnDisconnect.classList.add('hidden');
    if (wifiEl.btnForget) wifiEl.btnForget.classList.toggle('hidden', !getStoredToken());
  }
}

async function _onScanClick() {
  if (!state.transport) {
    log('warn', 'Connect BLE first');
    return;
  }

  wifiEl.btnScan.disabled = true;
  wifiEl.btnScan.textContent = 'Validating...';

  // Ensure we have a valid token before scanning
  if (!getStoredToken()) {
    await wifiValidateToken();
  }

  wifiEl.btnScan.textContent = 'Scanning...';

  try {
    const results = await wifiScanNetworks();

    if (wifiEl.ssidSelect) {
      wifiEl.ssidSelect.innerHTML = '<option value="">-- Select network --</option>';
      // Sort by signal strength (strongest first)
      results.sort((a, b) => b.rssi - a.rssi);
      for (const net of results) {
        const opt = document.createElement('option');
        opt.value = net.ssid;
        opt.textContent = `${net.ssid} (${net.rssi} dBm)`;
        wifiEl.ssidSelect.appendChild(opt);
      }
      wifiEl.ssidSelect.classList.remove('hidden');
    }
  } catch (err) {
    log('error', `WiFi scan failed: ${err.message}`);
  } finally {
    wifiEl.btnScan.disabled = false;
    wifiEl.btnScan.textContent = 'Scan Networks';
  }
}

function _onSsidSelect() {
  const ssid = wifiEl.ssidSelect.value;
  if (ssid) {
    if (wifiEl.password) wifiEl.password.classList.remove('hidden');
    if (wifiEl.btnConnect) wifiEl.btnConnect.classList.remove('hidden');
  } else {
    if (wifiEl.password) wifiEl.password.classList.add('hidden');
    if (wifiEl.btnConnect) wifiEl.btnConnect.classList.add('hidden');
  }
}

async function _onConnectClick() {
  const ssid = wifiEl.ssidSelect ? wifiEl.ssidSelect.value : '';
  const password = wifiEl.password ? wifiEl.password.value : '';
  if (!ssid) {
    log('warn', 'Select a WiFi network');
    return;
  }

  wifiEl.btnConnect.disabled = true;
  wifiEl.btnConnect.textContent = 'Connecting...';
  if (wifiEl.statusText) {
    wifiEl.statusText.textContent = `Connecting to ${ssid}...`;
    wifiEl.statusText.style.color = 'var(--warning)';
  }

  // Ensure token is current before connecting
  if (!getStoredToken()) {
    await wifiValidateToken();
  }

  try {
    await wifiConnect(ssid, password);
    log('success', `WiFi connected to ${ssid}`);
  } catch (err) {
    log('error', `WiFi connect failed: ${err.message}`);
    if (wifiEl.statusText) {
      wifiEl.statusText.textContent = `Failed: ${err.message}`;
      wifiEl.statusText.style.color = 'var(--error)';
    }
  } finally {
    wifiEl.btnConnect.disabled = false;
    wifiEl.btnConnect.textContent = 'Connect';
  }
}

async function _onDisconnectClick() {
  try {
    await wifiDisconnect();
    state.wifiConnected = false;
    state.wifiSSID = null;
    state.wifiIP = null;
    _updateWifiUI();
    log('info', 'WiFi disconnected');
  } catch (err) {
    log('error', `WiFi disconnect failed: ${err.message}`);
  }
}

async function _onForgetClick() {
  try {
    await wifiForget();
    log('info', 'WiFi credentials forgotten');
  } catch (err) {
    log('error', `WiFi forget failed: ${err.message}`);
  }
}

async function _onApStartClick() {
  const ssid = wifiEl.apSsid ? wifiEl.apSsid.value.trim() : '';
  const pass = wifiEl.apPassword ? wifiEl.apPassword.value : '';
  if (!ssid) {
    log('warn', 'Enter a network name for the AP');
    return;
  }
  if (pass.length > 0 && pass.length < 8) {
    log('warn', 'AP password must be at least 8 characters (or empty for open)');
    return;
  }
  try {
    if (wifiEl.statusText) wifiEl.statusText.textContent = 'Starting AP...';
    await wifiStartAP(ssid, pass);
    log('success', `AP started: ${ssid} — configure C64 Ultimate to connect to this network`);
  } catch (err) {
    log('error', `AP start failed: ${err.message}`);
  }
  _updateWifiUI();
}

// ---------------------------------------------------------------------------
// Init — called by c64-app.js
// ---------------------------------------------------------------------------

export function wifiInit() {
  // Cache DOM elements
  wifiEl.statusText    = $('#wifi-status-text');
  wifiEl.btnScan       = $('#btn-wifi-scan');
  wifiEl.ssidSelect    = $('#wifi-ssid-select');
  wifiEl.password      = $('#wifi-password');
  wifiEl.btnConnect    = $('#btn-wifi-connect');
  wifiEl.btnDisconnect = $('#btn-wifi-disconnect');
  wifiEl.btnForget     = $('#btn-wifi-forget');

  // AP mode elements
  wifiEl.staControls   = $('#wifi-sta-controls');
  wifiEl.apControls    = $('#wifi-ap-controls');
  wifiEl.apSsid        = $('#wifi-ap-ssid');
  wifiEl.apPassword    = $('#wifi-ap-password');
  wifiEl.btnApStart    = $('#btn-wifi-ap-start');

  // Wire up button events
  if (wifiEl.btnScan) wifiEl.btnScan.addEventListener('click', _onScanClick);
  if (wifiEl.ssidSelect) wifiEl.ssidSelect.addEventListener('change', _onSsidSelect);
  if (wifiEl.btnConnect) wifiEl.btnConnect.addEventListener('click', _onConnectClick);
  if (wifiEl.btnDisconnect) wifiEl.btnDisconnect.addEventListener('click', _onDisconnectClick);
  if (wifiEl.btnForget) wifiEl.btnForget.addEventListener('click', _onForgetClick);
  if (wifiEl.btnApStart) wifiEl.btnApStart.addEventListener('click', _onApStartClick);

  // WiFi mode toggle (STA vs AP)
  const modeRadios = document.querySelectorAll('input[name="wifi-mode"]');
  modeRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      const isAp = radio.value === 'ap' && radio.checked;
      if (wifiEl.staControls) wifiEl.staControls.classList.toggle('hidden', isAp);
      if (wifiEl.apControls) wifiEl.apControls.classList.toggle('hidden', !isAp);
    });
  });

  // Register frame handler with connection.js
  registerWifiHandler(handleWifiFrame);

  // Restore state from localStorage
  _updateWifiUI();

  // Validate token once BLE is connected — check periodically
  const _checkBle = setInterval(() => {
    if (state.transport === 'ble') {
      clearInterval(_checkBle);
      wifiValidateToken();
    }
  }, 1000);
  // Stop checking after 60s if never connected
  setTimeout(() => clearInterval(_checkBle), 60000);

  log('info', 'WiFi proxy module loaded');
}
