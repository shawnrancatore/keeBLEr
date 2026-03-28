// SPDX-License-Identifier: MIT
// keeBLEr64 — entry point for the C64 tier (AV + C64 Ultimate integration)

import { initElements } from '../js/state.js';
import { connectBle, connectSerial, disconnect, testLoopback, scheduleAutoConnect } from '../js/connection.js';
import { setupKeyboardCapture, registerShortcuts } from '../js/keyboard.js';
import { setupMouseCapture } from '../js/mouse.js';
import { setupCaptureListeners, enumerateCaptures, toggleLargeMode, toggleFullscreen } from '../js/capture.js';
import { c64Init, c64UploadFiles } from '../js/c64.js';
import { wifiInit } from '../js/wifi.js';
import { registerServiceWorker, checkBrowserApis } from '../js/init.js';
import { log } from '../js/ui.js';

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

initElements('c64');

// Connection buttons
document.getElementById('btn-ble').addEventListener('click', connectBle);
document.getElementById('btn-serial').addEventListener('click', connectSerial);
document.getElementById('btn-disconnect').addEventListener('click', disconnect);
document.getElementById('btn-loopback').addEventListener('click', testLoopback);

// Capture + audio + video mode controls
setupCaptureListeners();

// C64 Ultimate integration
c64Init();

// WiFi BLE-to-HTTP proxy
wifiInit();

// Auto-expand the C64 file transfer panel
const c64Details = document.getElementById('c64-details');
if (c64Details) c64Details.open = true;

// Auto-connect C64 Ultimate if IP was previously saved
const savedIp = localStorage.getItem('keebler_c64_ip');
if (savedIp) {
  const btnC64Connect = document.getElementById('btn-c64-connect');
  if (btnC64Connect) btnC64Connect.click();
}

// Load File button — opens a file picker and uploads via C64 API
const btnQuickLoad = document.getElementById('btn-c64-quick-load');
if (btnQuickLoad) {
  btnQuickLoad.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.prg,.d64,.d71,.d81,.g64,.dnp,.sid,.crt,.mod,.xm,.s3m';
    input.addEventListener('change', () => {
      if (input.files.length > 0) c64UploadFiles(input.files);
    });
    input.click();
  });
}

// Keyboard shortcuts (active when not connected)
registerShortcuts({ l: toggleLargeMode, f: toggleFullscreen });

// Keyboard and mouse capture
setupKeyboardCapture();
setupMouseCapture();

// Enumerate capture devices
enumerateCaptures();

// Browser API checks and service worker
checkBrowserApis();
registerServiceWorker();

// Auto-connect BLE after a short delay
scheduleAutoConnect(1500);

log('info', 'keeBLEr64 tier loaded');
