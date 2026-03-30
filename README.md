# keeBLEr

**keeBLEr** = keyboard **BLE** enabler

A wireless keyboard bridge. Plug a tiny ESP32-S3 board into any computer's USB port, open a browser on your other computer, and type — wirelessly, over Bluetooth Low Energy. No drivers, no pairing menus, no apps to install.

```
[Your Browser] ──BLE──> [ESP32-S3] ──USB HID──> [Target Computer]
```

## Why

You have two computers on your desk. You want one keyboard for both. keeBLEr turns a $8 microcontroller into a wireless USB keyboard that any computer thinks is a regular keyboard plugged in. You control it from a browser tab.

It works with everything: Windows, macOS, Linux, BIOS screens, KVM switches, retro computers — anything that accepts a USB keyboard.

## What you need

| Part | Price | Link |
|------|-------|------|
| Any ESP32-S3 board with USB | ~$8 | [XIAO ESP32S3](https://www.seeedstudio.com/XIAO-ESP32S3-p-5627.html), [DevKitC-1](https://www.adafruit.com/product/5312), or similar |
| USB cable | ~$3 | USB-C or micro-USB depending on board |
| **Total** | **~$11** | |

That's it. Flash the firmware, plug it into the target computer, open the web app in Chrome on your other computer, connect via BLE, and type.

## Quick start

### 1. Flash the firmware

**From browser (easiest):** Open the [keeBLEr flasher](https://shawnrancatore.github.io/keeBLEr/flash.html) in Chrome, plug in your board in bootloader mode, select your board, click Install.

**From source:**
```bash
cd firmware
source ~/esp/esp-idf/export.sh
idf.py set-target esp32s3 && idf.py build && idf.py flash
```

### 2. Plug into the target computer

The ESP32-S3's USB port plugs into the computer you want to control. It shows up as a standard USB keyboard.

### 3. Open the web app

Open [`https://shawnrancatore.github.io/keeBLEr/`](https://shawnrancatore.github.io/keeBLEr/) in Chrome or Edge on your controlling computer. Click **Connect BLE**, select your keeBLEr device, and start typing.

On subsequent visits, it auto-connects to your paired device.

## Features

- **Wireless keyboard and mouse** — BLE GATT, no line-of-sight needed, ~10m range
- **Universal compatibility** — boot protocol keyboard works in BIOS, UEFI, KVMs, retro computers
- **Two HID modes** — boot keyboard (max compatibility) or composite keyboard+mouse, toggled via BOOT button
- **Auto-reconnect** — reconnects automatically on page load, survives device reboots
- **No install** — runs in any Chromium browser (Chrome, Edge, Brave) over HTTPS
- **Web Serial fallback** — UART transport for development and recovery
- **Browser-based flasher** — flash firmware without installing a toolchain
- **Tiny** — XIAO ESP32S3 is 21×17mm
- **Board portable** — DevKitC-1, XIAO ESP32S3, or any ESP32-S3 with native USB

## Extended tiers

keeBLEr has two extended tiers that add capabilities on top of the base:

| Tier | URL | What it adds | Extra hardware |
|------|-----|-------------|----------------|
| **keeBLEr AV** | [`/av/`](https://shawnrancatore.github.io/keeBLEr/av/) | HDMI capture, audio passthrough, video modes | USB HDMI capture dongle (~$10) |
| **keeBLEr64** | [`/64/`](https://shawnrancatore.github.io/keeBLEr/64/) | C64 Ultimate integration, file transfer, Commodore theme, WiFi proxy | USB HDMI capture dongle (~$10) |

All three tiers share the same firmware and ES module codebase. See [keeBLEr AV docs](docs/av-mode.md) and [keeBLEr64 docs](docs/c64-mode.md) for details.

### Origin story
<img width="650" height="413" alt="keebler64_screen" src="https://github.com/user-attachments/assets/6a39208b-75e7-4f94-9280-5f4de6fd5fa8" />

keeBLEr was built to solve a specific problem: controlling a [Commodore 64 Ultimate](https://ultimate64.com/) from a main PC without swapping keyboards. The [keeBLEr64](docs/c64-mode.md) tier adds HDMI capture to see the C64 screen, a WiFi BLE-to-HTTP proxy to control the C64 Ultimate's API without Docker, file drag-and-drop, and a Commodore-inspired theme. It worked on the first try — boot protocol keyboard mode ensures compatibility with the C64 Ultimate's minimal 
USB HID stack.
## HID modes

Press the **BOOT button** (GPIO 0) to toggle. Mode persists across reboots.

| Mode | Description | Compatibility |
|------|-------------|---------------|
| 0 — Boot Keyboard | Standard 8-byte, no report IDs | BIOS, KVMs, retro computers, everything |
| 1 — Composite | Keyboard + mouse with report IDs | Modern OSes (Windows, macOS, Linux) |

## Supported boards

| Board | Build flag | Notes |
|-------|------------|-------|
| ESP32-S3-DevKitC-1 | default | Dual USB for easy development |
| XIAO ESP32S3 | `-DKEEBLER_BOARD=xiao` | Tiny production target |
| Any ESP32-S3 with USB | `-DKEEBLER_BOARD=generic` | No LED/button assumptions |

## Serve the web app yourself

The hosted GitHub Pages version works for most people. For self-hosting:

**Docker (self-signed cert, LAN):**
```bash
mkdir -p docker/certs
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout docker/certs/key.pem -out docker/certs/cert.pem \
  -subj "/CN=keebler" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:$(hostname -I | awk '{print $1}')"
cd docker && docker compose up -d
```

**Docker (Let's Encrypt, public domain):**
```bash
cd docker && cp .env.example .env
# Set KEEBLER_DOMAIN and KEEBLER_EMAIL
docker compose --profile production up -d
```

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

LENGTH = payload bytes only. CRC-8 polynomial 0x07 over TYPE + PAYLOAD.

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

## Project structure

```
keebler/
  firmware/main/             # ESP-IDF firmware (C)
    main.c                   #   App entry, mode switching, BOOT button
    hid_bridge.c/h           #   TinyUSB HID (boot KB + composite)
    ble_transport.c/h        #   NimBLE GATT peripheral
    serial_transport.c/h     #   UART fallback
    protocol.h               #   Packet protocol, CRC, frame parser
    board_config.h           #   Board abstraction
    wifi_proxy.c/h           #   WiFi STA/AP + HTTP proxy (AV/64 tiers)
  web/                       # Browser app (vanilla JS, ES modules)
    index.html               #   keeBLEr base tier
    av/                      #   keeBLEr AV tier
    64/                      #   keeBLEr64 tier
    js/                      #   Shared modules
    flash.html               #   Browser-based firmware flasher
  docker/                    # HTTPS web server configs
  docs/                      # Extended tier docs + C64 reference
```

## Adding a new board

1. Add a section to `board_config.h` with pin definitions
2. Add a CMake option in `main/CMakeLists.txt`
3. Build with `-DKEEBLER_BOARD=your_board`

The generic target works on most ESP32-S3 boards out of the box.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `ACK error 0x03` | USB HID not mounted — wait ~10s for enumeration, check cable |
| BLE won't connect | Ensure HTTPS, use Chrome/Edge |
| XIAO shows as `303a:1001` after flash | Unplug and replug |
| Keys stuck after disconnect | Fixed in firmware — auto key-release on BLE disconnect |

## License

[MIT](LICENSE)
