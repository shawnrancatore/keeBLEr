// SPDX-License-Identifier: MIT
// keebler init — service worker registration, browser API checks

import { el } from './state.js';
import { log } from './ui.js';

// ---------------------------------------------------------------------------
// Service worker registration
// ---------------------------------------------------------------------------

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  // Service workers require a trusted cert on non-localhost origins.
  // Skip registration silently when using a self-signed cert over LAN —
  // the app works fine without it, SW is just for offline/PWA caching.
  if (location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
    log('info', 'Skipping service worker on non-localhost (self-signed cert)');
    return;
  }

  try {
    // Compute SW path relative to the HTML page, not the module.
    // import.meta.url points to js/init.js — the SW lives one level up.
    const moduleUrl = new URL(import.meta.url);
    const swUrl = new URL('../sw.js', moduleUrl).pathname;
    const reg = await navigator.serviceWorker.register(swUrl);
    log('info', `Service worker registered (scope: ${reg.scope})`);
  } catch (err) {
    log('warn', `Service worker registration failed: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Browser API checks
// ---------------------------------------------------------------------------

export function checkBrowserApis() {
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
    if (el.btnStartCap) el.btnStartCap.disabled = true;
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
