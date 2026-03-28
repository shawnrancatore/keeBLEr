// SPDX-License-Identifier: MIT
// keebler protocol — constants, CRC8, frame builder, frame parser

// ---------------------------------------------------------------------------
// Constants — BLE protocol
// ---------------------------------------------------------------------------

export const BLE_SERVICE_UUID   = '4b454500-424c-4500-0000-000000000000';
export const BLE_RX_CHAR_UUID   = '4b454500-424c-4500-0000-000000000001'; // write to device
export const BLE_TX_CHAR_UUID   = '4b454500-424c-4500-0000-000000000002'; // notify from device
export const BLE_DEVICE_NAME    = 'keebler';

export const SERIAL_BAUD        = 115200;

// Frame constants
export const FRAME_MAGIC        = 0x4B;

// Packet types
export const TYPE_KEYBOARD_REPORT  = 0x01;
export const TYPE_MOUSE_REPORT     = 0x02;
export const TYPE_STATUS_REQUEST   = 0x10;
export const TYPE_STATUS_RESPONSE  = 0x11;
export const TYPE_HEARTBEAT        = 0x20;
export const TYPE_HEARTBEAT_ACK    = 0x21;
export const TYPE_ACK              = 0xFE;
export const TYPE_ECHO             = 0xFF;

export const TYPE_NAMES = {
  [TYPE_KEYBOARD_REPORT]: 'KEYBOARD_REPORT',
  [TYPE_MOUSE_REPORT]:    'MOUSE_REPORT',
  [TYPE_STATUS_REQUEST]:  'STATUS_REQUEST',
  [TYPE_STATUS_RESPONSE]: 'STATUS_RESPONSE',
  [TYPE_HEARTBEAT]:       'HEARTBEAT',
  [TYPE_HEARTBEAT_ACK]:   'HEARTBEAT_ACK',
  [TYPE_ACK]:             'ACK',
  [TYPE_ECHO]:            'ECHO',
};

// Board type names
export const BOARD_NAMES = {
  0x00: 'Unknown',
  0x01: 'DevKitC-1',
  0x02: 'XIAO ESP32S3',
};

// Transport names
export const TRANSPORT_NAMES = {
  0x00: 'None',
  0x01: 'BLE',
  0x02: 'Serial/UART',
};

// ---------------------------------------------------------------------------
// CRC8 (polynomial 0x07, init 0x00)
// ---------------------------------------------------------------------------

export const CRC8_TABLE = new Uint8Array(256);
(function initCrc8Table() {
  for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let bit = 0; bit < 8; bit++) {
      if (crc & 0x80) {
        crc = ((crc << 1) ^ 0x07) & 0xFF;
      } else {
        crc = (crc << 1) & 0xFF;
      }
    }
    CRC8_TABLE[i] = crc;
  }
})();

export function crc8(data) {
  let crc = 0x00;
  for (let i = 0; i < data.length; i++) {
    crc = CRC8_TABLE[crc ^ data[i]];
  }
  return crc;
}

// ---------------------------------------------------------------------------
// Frame builder
// ---------------------------------------------------------------------------

export function buildFrame(type, payload) {
  // payload can be Uint8Array or Array
  const p = payload instanceof Uint8Array ? payload : new Uint8Array(payload || []);
  // Frame: [MAGIC][LENGTH][TYPE][PAYLOAD...][CRC8]
  // LENGTH = payload byte count only (not including MAGIC, LENGTH, TYPE, CRC)
  const frame = new Uint8Array(4 + p.length); // magic(1) + length(1) + type(1) + payload + crc(1)
  frame[0] = FRAME_MAGIC;
  frame[1] = p.length;
  frame[2] = type;
  frame.set(p, 3);
  // CRC over type + payload
  const crcData = new Uint8Array(1 + p.length);
  crcData[0] = type;
  crcData.set(p, 1);
  frame[3 + p.length] = crc8(crcData);
  return frame;
}

// ---------------------------------------------------------------------------
// Frame parser
// ---------------------------------------------------------------------------

export class FrameParser {
  constructor(onFrame) {
    this.onFrame = onFrame; // callback: (type, payload) => void
    this.state = 'WAIT_MAGIC'; // WAIT_MAGIC, WAIT_LENGTH, WAIT_TYPE, WAIT_PAYLOAD, WAIT_CRC
    this.payloadLength = 0;
    this.type = 0;
    this.payload = [];
  }

  reset() {
    this.state = 'WAIT_MAGIC';
    this.payloadLength = 0;
    this.type = 0;
    this.payload = [];
  }

  feed(data) {
    for (let i = 0; i < data.length; i++) {
      const byte = data[i];

      switch (this.state) {
        case 'WAIT_MAGIC':
          if (byte === FRAME_MAGIC) {
            this.state = 'WAIT_LENGTH';
          }
          break;

        case 'WAIT_LENGTH':
          if (byte > 128) {
            // Payload too large, reset
            this.state = 'WAIT_MAGIC';
          } else {
            this.payloadLength = byte;
            this.state = 'WAIT_TYPE';
          }
          break;

        case 'WAIT_TYPE':
          this.type = byte;
          this.payload = [];
          if (this.payloadLength === 0) {
            this.state = 'WAIT_CRC';
          } else {
            this.state = 'WAIT_PAYLOAD';
          }
          break;

        case 'WAIT_PAYLOAD':
          this.payload.push(byte);
          if (this.payload.length >= this.payloadLength) {
            this.state = 'WAIT_CRC';
          }
          break;

        case 'WAIT_CRC':
          this._verifyCrc(byte);
          this.state = 'WAIT_MAGIC';
          break;
      }
    }
  }

  _verifyCrc(receivedCrc) {
    const type = this.type;
    const payload = new Uint8Array(this.payload);

    // Verify CRC over type + payload
    const crcData = new Uint8Array(1 + payload.length);
    crcData[0] = type;
    crcData.set(payload, 1);
    const expectedCrc = crc8(crcData);

    if (receivedCrc !== expectedCrc) {
      // Log via console since we don't import ui.js (no circular deps)
      console.warn(`CRC mismatch: got 0x${receivedCrc.toString(16)}, expected 0x${expectedCrc.toString(16)}`);
      return;
    }

    this.onFrame(type, payload);
  }
}
