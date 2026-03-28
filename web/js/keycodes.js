// SPDX-License-Identifier: MIT
// keebler keycodes — USB HID keycode map, modifier bits, display names

// ---------------------------------------------------------------------------
// USB HID keycode map (browser key -> HID usage ID)
// ---------------------------------------------------------------------------

export const HID_KEY_MAP = {
  // Letters
  'KeyA': 0x04, 'KeyB': 0x05, 'KeyC': 0x06, 'KeyD': 0x07,
  'KeyE': 0x08, 'KeyF': 0x09, 'KeyG': 0x0A, 'KeyH': 0x0B,
  'KeyI': 0x0C, 'KeyJ': 0x0D, 'KeyK': 0x0E, 'KeyL': 0x0F,
  'KeyM': 0x10, 'KeyN': 0x11, 'KeyO': 0x12, 'KeyP': 0x13,
  'KeyQ': 0x14, 'KeyR': 0x15, 'KeyS': 0x16, 'KeyT': 0x17,
  'KeyU': 0x18, 'KeyV': 0x19, 'KeyW': 0x1A, 'KeyX': 0x1B,
  'KeyY': 0x1C, 'KeyZ': 0x1D,

  // Numbers
  'Digit1': 0x1E, 'Digit2': 0x1F, 'Digit3': 0x20, 'Digit4': 0x21,
  'Digit5': 0x22, 'Digit6': 0x23, 'Digit7': 0x24, 'Digit8': 0x25,
  'Digit9': 0x26, 'Digit0': 0x27,

  // Control keys
  'Enter':      0x28,
  'Escape':     0x29,
  'Backspace':  0x2A,
  'Tab':        0x2B,
  'Space':      0x2C,

  // Punctuation
  'Minus':         0x2D,  // -
  'Equal':         0x2E,  // =
  'BracketLeft':   0x2F,  // [
  'BracketRight':  0x30,  // ]
  'Backslash':     0x31,  // backslash
  'Semicolon':     0x33,  // ;
  'Quote':         0x34,  // '
  'Backquote':     0x35,  // `
  'Comma':         0x36,  // ,
  'Period':        0x37,  // .
  'Slash':         0x38,  // /

  // Caps Lock
  'CapsLock':   0x39,

  // Function keys
  'F1':  0x3A, 'F2':  0x3B, 'F3':  0x3C, 'F4':  0x3D,
  'F5':  0x3E, 'F6':  0x3F, 'F7':  0x40, 'F8':  0x41,
  'F9':  0x42, 'F10': 0x43, 'F11': 0x44, 'F12': 0x45,

  // Print Screen, Scroll Lock, Pause
  'PrintScreen': 0x46,
  'ScrollLock':  0x47,
  'Pause':       0x48,

  // Navigation
  'Insert':    0x49,
  'Home':      0x4A,
  'PageUp':    0x4B,
  'Delete':    0x4C,
  'End':       0x4D,
  'PageDown':  0x4E,

  // Arrow keys
  'ArrowRight': 0x4F,
  'ArrowLeft':  0x50,
  'ArrowDown':  0x51,
  'ArrowUp':    0x52,

  // Numpad
  'NumLock':        0x53,
  'NumpadDivide':   0x54,
  'NumpadMultiply': 0x55,
  'NumpadSubtract': 0x56,
  'NumpadAdd':      0x57,
  'NumpadEnter':    0x58,
  'Numpad1':        0x59,
  'Numpad2':        0x5A,
  'Numpad3':        0x5B,
  'Numpad4':        0x5C,
  'Numpad5':        0x5D,
  'Numpad6':        0x5E,
  'Numpad7':        0x5F,
  'Numpad8':        0x60,
  'Numpad9':        0x61,
  'Numpad0':        0x62,
  'NumpadDecimal':  0x63,

  // Extra
  'IntlBackslash': 0x64,
  'ContextMenu':   0x65,
};

// ---------------------------------------------------------------------------
// Modifier bit masks (keyed by event.code)
// ---------------------------------------------------------------------------

export const MODIFIER_BITS = {
  'ControlLeft':  0x01,
  'ShiftLeft':    0x02,
  'AltLeft':      0x04,
  'MetaLeft':     0x08,
  'ControlRight': 0x10,
  'ShiftRight':   0x20,
  'AltRight':     0x40,
  'MetaRight':    0x80,
};

// ---------------------------------------------------------------------------
// Friendly names for display
// ---------------------------------------------------------------------------

export const KEY_DISPLAY_NAMES = {
  'ControlLeft':  'LCtrl',
  'ControlRight': 'RCtrl',
  'ShiftLeft':    'LShift',
  'ShiftRight':   'RShift',
  'AltLeft':      'LAlt',
  'AltRight':     'RAlt',
  'MetaLeft':     'LGui',
  'MetaRight':    'RGui',
  'Space':        'Space',
  'Enter':        'Enter',
  'Escape':       'Esc',
  'Backspace':    'Bksp',
  'Tab':          'Tab',
  'CapsLock':     'Caps',
  'ArrowUp':      'Up',
  'ArrowDown':    'Down',
  'ArrowLeft':    'Left',
  'ArrowRight':   'Right',
  'Delete':       'Del',
  'Insert':       'Ins',
  'Home':         'Home',
  'End':          'End',
  'PageUp':       'PgUp',
  'PageDown':     'PgDn',
  'PrintScreen':  'PrtSc',
  'ScrollLock':   'ScrLk',
  'Pause':        'Pause',
  'NumLock':      'NumLk',
  'ContextMenu':  'Menu',
};

export function keyDisplayName(code) {
  if (KEY_DISPLAY_NAMES[code]) return KEY_DISPLAY_NAMES[code];
  // Strip common prefixes for cleaner display
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num' + code.slice(6);
  if (code.startsWith('F') && /^F\d+$/.test(code)) return code;
  return code;
}
