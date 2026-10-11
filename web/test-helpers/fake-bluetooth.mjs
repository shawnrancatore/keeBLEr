// SPDX-License-Identifier: MIT
// A fake browser (DOM, localStorage, navigator.bluetooth) and fake boards, so
// the real js/connection.js runs under `node --test`.
//
// Like Chrome, a fake device fires 'gattserverdisconnected' synchronously
// inside gatt.disconnect().

export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function makeElement() {
  return {
    className: '', textContent: '', children: [], disabled: false,
    scrollTop: 0, scrollHeight: 0, innerHTML: '',
    appendChild(c) { this.children.push(c); },
    removeChild() {},
    get firstChild() { return this.children[0]; },
  };
}

/** Installs the globals connection.js needs. Call once, before importing it. */
export async function installFakeBrowser() {
  const store = new Map();
  globalThis.document = {
    createElement: () => makeElement(),
    createTextNode: (text) => ({ text }),
    querySelector: () => null,
  };
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };

  const { state, el } = await import('../js/state.js');
  for (const k of ['devVersion', 'devBoard', 'devTransport', 'devError', 'devHeartbeat',
    'keyList', 'btnBle', 'btnSerial', 'btnDisconnect', 'btnLoopback', 'statusDot']) {
    el[k] = makeElement();
  }
  const view = { statusText: '', logLines: [] };
  el.statusText = { set textContent(v) { view.statusText = v; }, get textContent() { return view.statusText; } };
  el.logPanel = {
    children: [], scrollTop: 0, scrollHeight: 0, removeChild() {},
    appendChild(entry) { view.logLines.push(entry.children[1].text); },
  };
  return { state, store, view };
}

export function setBluetooth(devices) {
  Object.defineProperty(globalThis, 'navigator', {
    value: {
      bluetooth: {
        getDevices: async () => devices,
        requestDevice: async () => devices[0],
      },
    },
    configurable: true,
  });
}

/**
 * A fake paired board. `board.onWrite(device, bytes)` sees every write the page
 * makes; use device.notify(bytes) to answer and device.boardDrop() to drop the link.
 */
export function makeDevice(name, id, board, proto) {
  const rxListeners = new Set();
  const dev = {
    name, id, connects: 0,
    addEventListener(type, fn) { if (type === 'gattserverdisconnected') rxListeners.add(fn); },
    fire() { for (const fn of [...rxListeners]) fn({ target: dev }); },
    notify(bytes) {
      if (!dev.gatt.connected) return;
      const dv = new DataView(Uint8Array.from(bytes).buffer);
      for (const fn of [...txListeners]) fn({ target: { value: dv } });
    },
    boardDrop() {
      if (!dev.gatt.connected) return;
      dev.gatt.connected = false;
      dev.fire();
    },
  };
  const txListeners = new Set();
  const tx = {
    startNotifications: async () => {},
    addEventListener: (t, fn) => txListeners.add(fn),
    removeEventListener: (t, fn) => txListeners.delete(fn),
  };
  const rx = {
    writeValueWithoutResponse: async (data) => {
      if (!dev.gatt.connected) throw new Error('GATT Server is disconnected');
      board.onWrite(dev, Array.from(data));
    },
  };
  const service = {
    getCharacteristic: async (uuid) => (uuid === proto.BLE_RX_CHAR_UUID ? rx : tx),
  };
  dev.gatt = {
    connected: false,
    connect: async () => {
      dev.connects++;
      await delay(5);
      dev.gatt.connected = true;
      return dev.gatt;
    },
    disconnect: () => {
      if (!dev.gatt.connected) return;
      dev.gatt.connected = false;
      dev.fire(); // synchronous, as the Web Bluetooth specification allows
    },
    getPrimaryService: async () => service,
  };
  return dev;
}
