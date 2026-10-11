// SPDX-License-Identifier: MIT
// keeBLEr — where the browser keeps each board's Wi-Fi token.
//
// A board guards its Wi-Fi settings with a 16-byte token it issues at first
// setup. The browser keeps one token per board. A board that refuses a token
// says nothing about any other board's token, so a refusal only ever changes
// that board's own entry.
//
// Before firmware 1.4.0 the app kept a single token for every board, under
// LEGACY_KEY. That key is read-only here: this module never writes or removes
// it, because it may belong to a Bluetooth board not seen yet.
//
// The wired serial link has no board identity, so it keeps one entry of its
// own, shared by every board used over the wire.
//
// A link with no entry of its own is offered, in order: the old token; then
// what the other kind of link holds. A Bluetooth board is offered the wired
// link's token, and the wired link is offered the only Bluetooth board's token
// when exactly one is stored. A board used over both links keeps working,
// whichever link set it up.
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

// The wired serial link has no board identity. It gets one entry of its own.
const SERIAL_ID = 'serial';

function ownKey(boardId) {
  return tokenKey(boardId || SERIAL_ID);
}

// The token of the only Bluetooth board this browser holds one for, or null
// when there is none or more than one.
function onlyBoardToken(storage) {
  let found = null;
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key || !key.startsWith('keebler_wifi_token_') || key === tokenKey(SERIAL_ID)) continue;
      const token = fromHex(storage.getItem(key));
      if (!token) continue;
      if (found) return null; // more than one board: cannot tell which
      found = token;
    }
  } catch {
    return null;
  }
  return found;
}

/**
 * The token to present to this board, or null when there is none (the caller
 * then sends 16 zero bytes, which asks a board with no token to issue one).
 * boardId is null for the wired serial link.
 */
export function loadToken(storage, boardId) {
  const own = read(storage, ownKey(boardId));
  if (own !== null) return fromHex(own); // its token, or the "none" marker

  // Nothing of its own yet. First the token the old app kept for every board.
  const old = fromHex(read(storage, LEGACY_KEY));
  if (old) return old;

  // Then what the other kind of link holds: one board may be used over both.
  return boardId ? fromHex(read(storage, tokenKey(SERIAL_ID))) : onlyBoardToken(storage);
}

/** The board (or, for a null boardId, the wired link) accepted or issued this token. Returns false if it could not be saved. */
export function saveToken(storage, boardId, token) {
  try {
    storage.setItem(ownKey(boardId), toHex(token));
    return true;
  } catch {
    return false;
  }
}

/**
 * This board (or the wired link) refused the token we presented, or was told
 * to forget its Wi-Fi settings: present no token next time. Other entries and
 * the old single token are left alone.
 */
export function dropToken(storage, boardId) {
  try {
    storage.setItem(ownKey(boardId), NO_TOKEN);
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
