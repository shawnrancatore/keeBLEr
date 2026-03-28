// SPDX-License-Identifier: MIT
// keebler c64 — C64 Ultimate API, file browser, drag-and-drop upload

import { state, $ } from './state.js';
import { log } from './ui.js';
import { sendFrame } from './connection.js';
import { TYPE_KEYBOARD_REPORT } from './protocol.js';

// ---------------------------------------------------------------------------
// C64 state
// ---------------------------------------------------------------------------

export const c64 = {
  ip: null,
  password: '',
  connected: false,
  currentPath: '/SD',
  el: {},
};

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

export function c64Init() {
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
  if (savedIp && c64.el.ip) c64.el.ip.value = savedIp;

  if (c64.el.btnConnect) {
    c64.el.btnConnect.addEventListener('click', c64Connect);
  }
  if (c64.el.btnUp) {
    c64.el.btnUp.addEventListener('click', () => {
      const parent = c64.currentPath.replace(/\/[^/]+$/, '') || '/';
      c64Browse(parent);
    });
  }

  // Drag and drop
  const dz = c64.el.dropZone;
  if (dz) {
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
  }

  // Enter key on IP input
  if (c64.el.ip) {
    c64.el.ip.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') c64Connect();
    });
  }
}

// ---------------------------------------------------------------------------
// Proxy URL
// ---------------------------------------------------------------------------

// Returns true if the nginx CORS proxy is available (Docker/self-hosted).
// On GitHub Pages (*.github.io), there's no proxy — C64 API calls won't work.
export function c64HasProxy() {
  const h = window.location.hostname;
  return h === 'localhost' || h === '127.0.0.1' || /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/.test(h);
}

export function c64ProxyUrl(path) {
  if (c64HasProxy()) {
    return `/c64proxy/${c64.ip}${path}`;
  }
  // Direct — will likely fail due to CORS, but try anyway
  return `http://${c64.ip}${path}`;
}

// ---------------------------------------------------------------------------
// Connect
// ---------------------------------------------------------------------------

export async function c64Connect() {
  const ip = c64.el.ip ? c64.el.ip.value.trim() : '';
  if (!ip) {
    log('warn', 'Enter the C64 Ultimate IP address');
    return;
  }

  c64.ip = ip;
  c64.password = c64.el.password ? c64.el.password.value.trim() : '';
  localStorage.setItem('keebler_c64_ip', ip);

  if (!c64HasProxy()) {
    log('warn', 'C64 API requires the Docker/self-hosted setup for the CORS proxy. ' +
        'GitHub Pages cannot proxy to your LAN. Run keeBLEr64 from Docker: docker compose up -d');
    if (c64.el.statusText) {
      c64.el.statusText.textContent = 'Needs CORS proxy (use Docker)';
      c64.el.statusText.style.color = 'var(--warning)';
    }
    // Still try — maybe the user set up their own proxy or the C64 firmware was modded
  }

  if (c64.el.statusText && !c64.el.statusText.textContent.includes('proxy')) {
    c64.el.statusText.textContent = 'Connecting...';
  }

  try {
    const resp = await fetch(c64ProxyUrl('/v1/info'), { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const info = await resp.json();

    c64.connected = true;
    if (c64.el.statusText) {
      c64.el.statusText.textContent = `${info.product || 'C64 Ultimate'} v${info.firmware_version || '?'}`;
      c64.el.statusText.style.color = 'var(--success)';
    }
    if (c64.el.browser) c64.el.browser.classList.remove('hidden');
    log('success', `C64 Ultimate connected: ${info.product} firmware ${info.firmware_version}`);

    c64Browse('/SD');
  } catch (err) {
    c64.connected = false;
    if (c64.el.statusText) {
      c64.el.statusText.textContent = `Failed: ${err.message}`;
      c64.el.statusText.style.color = 'var(--error)';
    }
    if (c64.el.browser) c64.el.browser.classList.add('hidden');
    log('error', `C64 connection failed: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// File browser
// ---------------------------------------------------------------------------

export async function c64Browse(path) {
  if (!c64.connected) return;

  c64.currentPath = path;
  if (c64.el.pathBar) c64.el.pathBar.textContent = path;
  if (c64.el.fileList) {
    c64.el.fileList.innerHTML = '<div style="padding:0.5rem;color:var(--text-secondary)">Loading...</div>';
  }

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

    if (c64.el.fileList) {
      c64.el.fileList.innerHTML = '<div style="padding:0.5rem;color:var(--error)">Could not list directory</div>';
    }
  } catch (err) {
    if (c64.el.fileList) {
      c64.el.fileList.innerHTML = `<div style="padding:0.5rem;color:var(--error)">${err.message}</div>`;
    }
  }
}

export function c64RenderFileList(data) {
  const list = c64.el.fileList;
  if (!list) return;
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

    const row = document.createElement('div');
    row.className = 'c64-file-entry' + (isDir ? ' dir' : '');
    row.innerHTML = `<span>${isDir ? '/' : ''}${name}</span><span class="size">${size}</span>`;

    if (isDir) {
      row.addEventListener('click', () => c64Browse(`${c64.currentPath}/${name}`));
    }

    list.appendChild(row);
  }
}

export function c64RenderFtpListing(text) {
  const list = c64.el.fileList;
  if (!list) return;
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

    const row = document.createElement('div');
    row.className = 'c64-file-entry' + (isDir ? ' dir' : '');
    row.innerHTML = `<span>${isDir ? '/' : ''}${name}</span><span class="size">${isDir ? '' : formatSize(size)}</span>`;

    if (isDir) {
      row.addEventListener('click', () => c64Browse(`${c64.currentPath}/${name}`));
    }

    list.appendChild(row);
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// File upload
// ---------------------------------------------------------------------------

export function c64OnDrop(e) {
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
export function c64ActionForFile(filename) {
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

export async function c64UploadFiles(files) {
  const pw = c64.password || '';
  const headers = { 'Content-Type': 'application/octet-stream' };
  if (pw) headers['X-Password'] = pw;

  for (const file of files) {
    const action = c64ActionForFile(file.name);
    if (c64.el.uploadStatus) {
      c64.el.uploadStatus.textContent = `${action.label}: ${file.name}...`;
      c64.el.uploadStatus.style.color = 'var(--text-secondary)';
    }

    try {
      const resp = await fetch(c64ProxyUrl(action.endpoint), {
        method: 'POST',
        body: file,
        headers,
        signal: AbortSignal.timeout(30000),
      });

      if (resp.ok) {
        if (c64.el.uploadStatus) {
          c64.el.uploadStatus.textContent = `${action.label}: ${file.name} OK`;
          c64.el.uploadStatus.style.color = 'var(--success)';
        }
        log('success', `C64: ${action.label} ${file.name}`);
      } else if (resp.status === 401 || resp.status === 403) {
        throw new Error('Auth required — set password in C64 Ultimate settings');
      } else {
        throw new Error(`HTTP ${resp.status}`);
      }
    } catch (err) {
      if (c64.el.uploadStatus) {
        c64.el.uploadStatus.textContent = `Failed: ${file.name} — ${err.message}`;
        c64.el.uploadStatus.style.color = 'var(--error)';
      }
      log('error', `C64 ${action.label} failed: ${err.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Machine control
// ---------------------------------------------------------------------------

// Toggle the Ultimate menu — tries the HTTP API first (more reliable,
// doesn't go through USB HID), falls back to sending ScrollLock over BLE.
export async function c64ToggleUltimateMenu() {
  if (c64.connected) {
    await c64MachineCmd('menu_button');
  } else if (state.transport) {
    // No API connection — send ScrollLock (0x47) as HID keypress
    log('info', 'Sending ScrollLock via BLE (no C64 API connection)');
    await sendFrame(TYPE_KEYBOARD_REPORT, new Uint8Array([0, 0, 0x47, 0, 0, 0, 0, 0]));
    await new Promise(r => setTimeout(r, 100));
    await sendFrame(TYPE_KEYBOARD_REPORT, new Uint8Array(8)); // release
  } else {
    log('warn', 'Connect BLE or C64 API first');
  }
}

// Machine control — send PUT commands to C64 Ultimate
export async function c64MachineCmd(command) {
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

// Expose on window so inline onclick= attributes in HTML work
window.c64ToggleUltimateMenu = c64ToggleUltimateMenu;
window.c64MachineCmd = c64MachineCmd;
