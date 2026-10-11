// SPDX-License-Identifier: MIT
// keeBLEr — where the browser keeps each board's Wi-Fi token.
//
// A board guards its Wi-Fi settings with a 16-byte token it issues at first
// setup. The browser keeps one token per board. A board that refuses a token
// says nothing about any other board's token, so a refusal only ever changes
// that board's own entry.
//
// Before firmware 1.4.0 the app kept a single token for every board, under
// LEGACY_KEY. It is still read: a board this browser has no entry for is
// offered the old token once. It is never deleted here, because it may belong
// to a board that has not been seen yet.
//
// No DOM and no globals: storage is passed in, so this runs under `node --test`.

export const LEGACY_KEY = 'keebler_wifi_token';
export const TOKEN_LEN = 16;

// Stored in a board's own entry when that board refused what we had, or was
// told to forget: "send no token next time", and do not fall back to the old one.
const NO_TOKEN = 'none';

export function tokenKey(boardId) {
  return `keebler_wifi_token_${boardId}`;
}

function fromHex(hex) {
  if (typeof hex !== 'string' || !/^[0-9a-f]{32}$/i.test(hex)) return null;
  const bytes = new Uint8Array(TOKEN_LEN);
  for (let i = 0; i < TOKEN_LEN; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function toHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function read(storage, key) {
  try {
    return storage.getItem(key);
  } catch {
    return null; // storage unavailable: behave as a browser with nothing saved
  }
}

/**
 * The token to present to this board, or null when there is none (the caller
 * then sends 16 zero bytes, which asks a board with no token to issue one).
 * boardId is null when the board has no identity (the wired serial link).
 */
export function loadToken(storage, boardId) {
  if (boardId) {
    const own = read(storage, tokenKey(boardId));
    if (own !== null) return fromHex(own); // its token, or the "none" marker
  }
  return fromHex(read(storage, LEGACY_KEY));
}

/** The board accepted or issued this token: it is this board's. Returns false if it could not be saved. */
export function saveToken(storage, boardId, token) {
  try {
    storage.setItem(boardId ? tokenKey(boardId) : LEGACY_KEY, toHex(token));
    return true;
  } catch {
    return false;
  }
}

/**
 * This board refused the token we presented, or was told to forget its Wi-Fi
 * settings: present no token to it next time. Other boards' entries, and the
 * old single token, are left alone.
 */
export function dropToken(storage, boardId) {
  try {
    if (boardId) {
      storage.setItem(tokenKey(boardId), NO_TOKEN);
    } else {
      storage.removeItem(LEGACY_KEY);
    }
  } catch {
    // Nothing we can change; the next request is refused or accepted on its merits.
  }
}

/** True when this browser holds a Wi-Fi token for any board. For UI shown while nothing is connected. */
export function hasAnyToken(storage) {
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key === LEGACY_KEY || (key && key.startsWith('keebler_wifi_token_'))) {
        if (fromHex(storage.getItem(key))) return true;
      }
    }
  } catch {
    // fall through
  }
  return false;
}
