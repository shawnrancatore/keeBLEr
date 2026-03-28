// SPDX-License-Identifier: MIT
// keeBLEr AV — entry point for the AV tier (capture + audio + video modes)

import { initElements } from '../js/state.js';
import { connectBle, connectSerial, disconnect, testLoopback, scheduleAutoConnect } from '../js/connection.js';
import { setupKeyboardCapture, registerShortcuts } from '../js/keyboard.js';
import { setupMouseCapture } from '../js/mouse.js';
import { setupCaptureListeners, enumerateCaptures, toggleLargeMode, toggleFullscreen } from '../js/capture.js';
import { registerServiceWorker, checkBrowserApis } from '../js/init.js';
import { log } from '../js/ui.js';

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

initElements('av');

// Connection buttons
document.getElementById('btn-ble').addEventListener('click', connectBle);
document.getElementById('btn-serial').addEventListener('click', connectSerial);
document.getElementById('btn-disconnect').addEventListener('click', disconnect);
document.getElementById('btn-loopback').addEventListener('click', testLoopback);

// Capture + audio + video mode controls
setupCaptureListeners();

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

log('info', 'keeBLEr AV tier loaded');
