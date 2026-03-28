# keeBLEr

**keeBLEr** = keyboard **BLE** enabler

A wireless browser-to-HID bridge. Control a remote computer's keyboard and mouse from a web app over Bluetooth Low Energy, with live HDMI capture for screen viewing.

```
[Browser] ──BLE──> [ESP32-S3] ──USB HID──> [Target Computer]
    │                                              │
    └──────── HDMI capture ◄───────────────────────┘
```

## Origin story

keeBLEr was built to solve a specific problem: using a [Commodore 64 Ultimate](https://ultimate64.com/) from a main PC without constantly swapping keyboards. By combining a cheap ESP32-S3 board, a USB HDMI capture dongle, and a browser-based controller, keeBLEr lets you see the C64's screen and type on it wirelessly — all from a browser tab on your daily driver.

It worked on the first try with the C64 Ultimate, including the Ultimate menu (triggered by Scroll Lock). The boot protocol keyboard mode ensures compatibility with devices that have minimal USB HID support, from retro computers to BIOS screens to KVM switches.

## Use cases

- **Retro computer control** — drive a C64 Ultimate, MiSTer, or other retro device from your main PC
- **Remote BIOS/UEFI access** — boot protocol keyboard works before any OS loads
- **Headless server management** — see the screen and type without a physical keyboard attached
- **KVM for home lab** — switch between machines from a browser tab
- **Embedded device debugging** — control a target system while keeping your hands on your main keyboard

## How it compares

| | keeBLEr | PiKVM | TinyPilot |
|---|---|---|---|
| **Cost** | ~$20 | ~$100+ | ~$200+ |
| **Wireless keyboard** | Yes (BLE) | No (network) | No (network) |
| **BIOS compatible** | Yes (boot protocol) | Yes | Yes |
| **Video capture** | USB HDMI dongle | CSI/USB | CSI/USB |
| **Setup** | Flash + open browser | SD card image | SD card image |
| **Form factor** | Tiny (XIAO: 21x17mm) | Pi-sized | Pi-sized |
| **Network required** | No (BLE direct) | Yes | Yes |
| **Virtual media** | No | Yes | Yes |
| **ATX power control** | No | Yes | No |

keeBLEr is not a full KVM replacement — it doesn't do virtual media or ATX power control. It excels at **wireless keyboard/mouse sharing with minimal hardware** and **universal HID compatibility**.

## Bill of materials

| Part | Price | Link |
|------|-------|------|
| Seeed Studio XIAO ESP32S3 | ~$8 | [seeedstudio.com](https://www.seeedstudio.com/XIAO-ESP32S3-p-5627.html) |
| USB HDMI capture dongle | ~$10 | [Amazon](https://www.amazon.com/dp/B092PX5XQ9) |
| USB-C cable | ~$3 | any data cable |
| **Total** | **~$21** | |

Alternative boards:
| Board | Price | Link | Build flag |
|-------|-------|------|------------|
| ESP32-S3-DevKitC-1 | ~$10 | [Adafruit](https://www.adafruit.com/product/5312) | default |
| XIAO ESP32S3 | ~$8 | [Seeed Studio](https://www.seeedstudio.com/XIAO-ESP32S3-p-5627.html) | `-DKEEBLER_BOARD=xiao` |
| Any ESP32-S3 with USB | varies | | `-DKEEBLER_BOARD=generic` |

## Features

- **Wireless keyboard/mouse** — BLE GATT transport, no USB cable to the controller
- **HDMI capture** — see the target screen in the browser via USB capture card
- **Audio passthrough** — hear the target's audio with volume control (AGC/noise suppression disabled for clean passthrough)
- **Two HID modes** — boot keyboard (max compatibility) or composite keyboard+mouse, toggled via BOOT button
- **Auto-reconnect** — aggressive BLE reconnection, auto-connects to paired devices on page load
- **Web Serial fallback** — UART transport for development and recovery
- **Browser-based flasher** — flash firmware from the browser, no toolchain needed
- **PWA** — installable as a progressive web app
- **Board portable** — DevKitC-1, XIAO ESP32S3, or any ESP32-S3 with native USB

## Quick start

### Option A: Flash from browser (easiest)

1. Plug your ESP32-S3 board into your computer via USB
2. Put it in bootloader mode (hold BOOT, tap RESET, release BOOT)
3. Open the [keeBLEr flasher page](web/flash.html) in Chrome/Edge
4. Select your board and click Install

### Option B: Build from source

Requires [ESP-IDF v5.4+](https://docs.espressif.com/projects/esp-idf/en/latest/esp32s3/get-started/).

```bash
cd firmware
source ~/esp/esp-idf/export.sh

# For DevKitC-1 (default)
idf.py set-target esp32s3 && idf.py build && idf.py flash

# For XIAO ESP32S3
idf.py -DKEEBLER_BOARD=xiao set-target esp32s3 && idf.py build && idf.py flash

# For any other ESP32-S3 board
idf.py -DKEEBLER_BOARD=generic set-target esp32s3 && idf.py build && idf.py flash
```

### Serve the web app

Web Bluetooth and getUserMedia require HTTPS.

**Option A: GitHub Pages (easiest — no server needed)**

The web app is deployed automatically to GitHub Pages on every push:

> **[https://shawnrancatore.github.io/keebler/](https://shawnrancatore.github.io/keebler/)**

Just open the link in Chrome or Edge. If you fork the repo, enable GitHub Pages in your fork's Settings > Pages > Source: GitHub Actions.

**Option B: Development (self-signed cert, LAN only)**

```bash
mkdir -p docker/certs
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout docker/certs/key.pem -out docker/certs/cert.pem \
  -subj "/CN=keebler" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:$(hostname -I | awk '{print $1}')"

cd docker && docker compose up -d
```

Open `https://<your-ip>:8443/` in Chrome or Edge. You'll need to accept the self-signed certificate warning on first visit.

**Option B: Production (Let's Encrypt, public domain)**

If you have a domain name pointing to your server, Caddy handles TLS certificates automatically:

```bash
cd docker
cp .env.example .env
# Edit .env — set KEEBLER_DOMAIN and KEEBLER_EMAIL
docker compose --profile production up -d
```

This gives you a trusted HTTPS certificate with zero browser warnings. No manual cert management — Caddy auto-renews via Let's Encrypt.

**Then:** Open the URL in Chrome or Edge. On first visit, click **Connect BLE** and pair your keeBLEr device. It auto-connects on subsequent visits.

## HID modes

Press the **BOOT button** (GPIO 0) to toggle between modes. The mode persists across reboots.

| Mode | USB descriptor | LED | Compatibility |
|------|---------------|-----|---------------|
| 0 — Boot Keyboard | Standard 8-byte, no report IDs | Single flash | BIOS, KVMs, retro computers, everything |
| 1 — Composite | Keyboard + mouse with report IDs | Double flash | Modern OSes (Windows, macOS, Linux) |

## BLE protocol

The device advertises as **"keebler \<version\>"** and exposes a custom GATT service:

| UUID | Role |
|------|------|
| `4b454500-424c-4500-0000-000000000000` | Service |
| `4b454500-424c-4500-0000-000000000001` | RX — write to device |
| `4b454500-424c-4500-0000-000000000002` | TX — notify from device |

### Packet format

```
[0x4B magic] [LENGTH] [TYPE] [PAYLOAD...] [CRC8]
```

| Type | Name | Payload |
|------|------|---------|
| `0x01` | KEYBOARD_REPORT | modifiers(1) + reserved(1) + keycodes(6) |
| `0x02` | MOUSE_REPORT | buttons(1) + dx(1) + dy(1) + wheel(1) + pan(1) |
| `0x10` | STATUS_REQUEST | *(empty)* |
| `0x11` | STATUS_RESPONSE | version(1) + board(1) + transport(1) + error(1) |
| `0x20` | HEARTBEAT | sequence(1) |
| `0x21` | HEARTBEAT_ACK | sequence(1) |
| `0xFE` | ACK | status(1) |
| `0xFF` | ECHO | variable — loopback test |

LENGTH = payload bytes only. CRC-8 polynomial 0x07 over TYPE + PAYLOAD.

## Project structure

```
keebler/
  firmware/
    main/
      main.c              # App entry, mode switching, BOOT button, LED
      hid_bridge.c/h      # TinyUSB HID — boot KB and composite descriptors
      ble_transport.c/h    # NimBLE GATT peripheral
      serial_transport.c/h # UART fallback transport
      protocol.h           # Packet protocol, CRC, frame parser
      board_config.h       # Pin/board abstraction (DevKitC-1, XIAO, generic)
    CMakeLists.txt
    sdkconfig.defaults
  web/
    index.html             # Main controller UI
    app.js                 # BLE, serial, capture, keyboard, mouse, protocol
    style.css              # Dark theme
    flash.html             # Browser-based firmware flasher
    firmware/              # Pre-built binaries for web flasher
    manifests/             # ESP Web Tools flash manifests
    manifest.webmanifest   # PWA manifest
    sw.js                  # Service worker
  docker/
    docker-compose.yml     # HTTPS web server
    nginx.conf
  docs/
    c64-ultimate-usb-research.md  # C64 Ultimate USB host analysis
```

## Adding a new board

1. Add a `#elif defined(BOARD_YOUR_BOARD)` section to `board_config.h`
2. Define pin assignments: LED (optional), UART TX/RX, boot button, USB
3. Add a CMake option in `main/CMakeLists.txt`
4. Build with `-DKEEBLER_BOARD=your_board`

The generic target works on most ESP32-S3 boards out of the box — custom boards are only needed if you want LED feedback or non-standard UART pins.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `ACK error 0x03` | USB HID not mounted — wait ~10s for enumeration, check cable |
| BLE won't connect | Ensure HTTPS (not HTTP), use Chrome/Edge, enable Web Bluetooth flags |
| No BLE after full flash erase | Reflash without `erase_flash`; NVS reformats on boot |
| XIAO shows as `303a:1001` | Unplug and replug — USB PHY needs a clean power cycle |
| Audio fades in/out | Check log for `AGC=off`; if ON, reload the page |
| Keys stuck after disconnect | Fixed in firmware — auto key-release on BLE disconnect |

## USB VID/PID

This project uses VID `0x1209` from [pid.codes](https://pid.codes/) (open-source USB ID registry) with PID `0x4B42`.

## License

[MIT](LICENSE)
