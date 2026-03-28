// SPDX-License-Identifier: MIT
// keebler capture — video capture, audio routing, volume, display modes

import { state, el } from './state.js';
import { log } from './ui.js';

// ---------------------------------------------------------------------------
// Video modes to probe
// ---------------------------------------------------------------------------

export const PROBE_MODES = [
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

// ---------------------------------------------------------------------------
// Device enumeration
// ---------------------------------------------------------------------------

export async function enumerateCaptures() {
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

// ---------------------------------------------------------------------------
// Video mode probing
// ---------------------------------------------------------------------------

export async function populateVideoModes(deviceId) {
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

// ---------------------------------------------------------------------------
// Start / stop capture
// ---------------------------------------------------------------------------

export async function startCapture() {
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

// ---------------------------------------------------------------------------
// Audio routing
// ---------------------------------------------------------------------------

export function setupAudio(stream) {
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

export function teardownAudio() {
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

export function setVolume(value) {
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

export function toggleMute() {
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
// Display modes — large / fullscreen
// ---------------------------------------------------------------------------

export function toggleLargeMode() {
  el.videoSection.classList.toggle('large');
  el.btnLarge.classList.toggle('active');
}

export function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else {
    el.videoSection.requestFullscreen().catch(err => {
      log('warn', `Fullscreen failed: ${err.message}`);
    });
  }
}

export function stopCapture() {
  teardownAudio();
  if (state.captureStream) {
    state.captureStream.getTracks().forEach(t => t.stop());
    state.captureStream = null;
  }
  if (el.video) el.video.srcObject = null;
  if (el.videoOverlay) el.videoOverlay.classList.remove('hidden');
  if (el.btnStartCap) el.btnStartCap.disabled = false;
  if (el.btnStopCap) el.btnStopCap.disabled = true;
}

// ---------------------------------------------------------------------------
// Capture listeners setup
// ---------------------------------------------------------------------------

export function setupCaptureListeners() {
  el.btnStartCap.addEventListener('click', startCapture);
  el.btnStopCap.addEventListener('click', stopCapture);
  el.captureSelect.addEventListener('change', () => populateVideoModes(el.captureSelect.value));
  el.audioVolume.addEventListener('input', (e) => setVolume(e.target.value / 100));
  el.btnMute.addEventListener('click', toggleMute);
  el.btnLarge.addEventListener('click', toggleLargeMode);
  el.btnFullscreen.addEventListener('click', toggleFullscreen);

  // Sync button state when exiting fullscreen via Escape
  document.addEventListener('fullscreenchange', () => {
    el.btnFullscreen.classList.toggle('active', !!document.fullscreenElement);
  });

  // Re-enumerate when devices change
  if (navigator.mediaDevices) {
    navigator.mediaDevices.addEventListener('devicechange', enumerateCaptures);
  }

  // Show video overlay initially
  if (el.videoOverlay) el.videoOverlay.classList.remove('hidden');
}
