# keeBLEr

**keeBLEr** = keyboard **BLE** enabler

<!-- bricoleur:intro -->
> Part of **[bricoleur.ai](https://bricoleur.ai)**: small, honest tools cobbled together from the AI-era parts at hand. Related: **[capurnion](https://github.com/bricoleur-ai/capurnion)**, another tool that works from the browser you already have open.
<!-- /bricoleur:intro -->

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

Open [`https://shawnrancatore.github.io/keeBLEr/`](https://shawnrancatore.github.io/keeBLEr/) in Chrome or Edge on your controlling computer. Click **Connect BLE**, select your keeBLEr device, and start typing. Do this within 60 seconds of plugging the board in: the first browser to connect in that time claims the board (see [Connect window and session pass](#connect-window-and-session-pass-protocol-2-firmware-140)). If you miss it, the LED shows two short blue blinks every 2 seconds: unplug the board, plug it back in, and connect again.

On later visits the web app reconnects on its own while the board has stayed powered. After the board has been unplugged, open the web app within 60 seconds of plugging it back in (it reconnects on its own), or click **Connect BLE** within that time.

A tab you leave open keeps trying on its own when the board goes away: it makes up to ten reconnect attempts, then checks for the paired board again every 5 seconds. The second step needs a browser that supports `getDevices` for Web Bluetooth; without it, click **Connect BLE** once the board is back. A tab that was refused ("Not authorised") stops trying until you click **Connect BLE**.

**The full guide**, from parts to protocol, is at [bricoleur.ai/projects/keebler](https://bricoleur.ai/projects/keebler).

## Features

- **Wireless keyboard and mouse** — BLE GATT, no line-of-sight needed, ~10m range
- **Universal compatibility** — boot protocol keyboard works in BIOS, UEFI, KVMs, retro computers
- **Two HID modes** — boot keyboard (max compatibility) or composite keyboard+mouse, toggled via BOOT button
- **Auto-reconnect** — reconnects automatically on page load, and an open tab retries by itself when the board comes back (after a restart, within the 60-second connect window)
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

Press the **BOOT button** (GPIO 0) to toggle. Mode persists across reboots. Changing the mode restarts the board, which ends the connection and opens a new 60-second connect window; an open web app reconnects on its own.

| Mode | Description | Compatibility |
|------|-------------|---------------|
| 0 — Boot Keyboard | Standard 8-byte, no report IDs | BIOS, KVMs, retro computers, everything |
| 1 — Composite | Keyboard + mouse with report IDs | Modern OSes (Windows, macOS, Linux) |

## Supported boards

| Board | Build flag | Notes |
|-------|------------|-------|
| ESP32-S3-DevKitC-1 | default | Dual USB for easy development |
| Seeed XIAO ESP32S3 | `-DKEEBLER_BOARD=xiao` | Tiny (21×17mm), [buy](https://www.seeedstudio.com/XIAO-ESP32S3-p-5627.html) |
| Adafruit QT Py ESP32-S3 | `-DKEEBLER_BOARD=qtpy` | Tiny with STEMMA QT, [buy](https://www.adafruit.com/product/5426) |
| ESP32-S3 SuperMini | `-DKEEBLER_BOARD=supermini` | Tiny (22.5×18mm) with WS2812 RGB status LED on GPIO 48, 4MB flash, 2MB PSRAM, external antenna option. See [espboards.dev](https://www.espboards.dev/esp32/esp32-s3-super-mini/) |
| Any ESP32-S3 with USB | `-DKEEBLER_BOARD=generic` | No LED/button assumptions |

The LED behaviour is documented in detail in [docs/led-status.md](docs/led-status.md). On RGB-equipped boards (SuperMini), the LED uses a layered colour scheme — blue for BLE, green for WiFi, cyan for both, magenta heartbeat for HID — plus a working spinner and double-blink result indicators for scan/connect operations.

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

A frame longer than the connection allows in one notification (the ATT MTU minus 3 bytes) is sent as several notifications. Treat notifications from the device as a byte stream and find each frame by its magic byte and LENGTH, not by notification boundaries.

| Type | Name | Payload |
|------|------|---------|
| `0x01` | KEYBOARD_REPORT | modifiers(1) + reserved(1) + keycodes(6) |
| `0x02` | MOUSE_REPORT | buttons(1) + dx(1) + dy(1) + wheel(1) + pan(1) |
| `0x10` | STATUS_REQUEST | *(empty)* |
| `0x11` | STATUS_RESPONSE | version(1) + board(1) + transport(1) + error(1) + flags(1) |
| `0x20` | HEARTBEAT | sequence(1) |
| `0x21` | HEARTBEAT_ACK | sequence(1) |
| `0x30` | AUTH | *(empty)*, or the 16-byte session pass |
| `0x31` | AUTH_RESULT | status(1), plus the 16-byte pass when the status is GRANTED |
| `0xFE` | ACK | status(1) |
| `0xFF` | ECHO | variable — loopback test |

### Connect window and session pass (protocol 2, firmware 1.4.0)

Plug the board in, then connect from your browser within a minute. That browser now owns the board until it is unplugged, and other browsers and devices are refused. To hand the board to a different browser, or when the LED shows two short blue blinks, unplug the board and plug it back in.

For 60 seconds after the board starts, the board gives the first browser that connects a session pass: 16 random bytes, kept in RAM only. From then until the board restarts, it serves only a connection that presents that pass. In more detail:

- The web app sends AUTH as its first packet: empty the first time, the stored pass afterwards. While the window is open and no pass has been issued, the board grants any AUTH that is empty or carries 16 bytes and ignores the bytes sent (an AUTH of any other length is refused), which is how a browser that still holds an old pass is granted a new one after a restart.
- AUTH_RESULT status: `0x00` OK (the pass matched), `0x01` GRANTED (a new pass follows), `0x02` DENIED (the board disconnects about 200 ms later).
- Before AUTH succeeds, the board accepts only STATUS_REQUEST, AUTH and HEARTBEAT. Anything else gets ACK `0x20` NOT_AUTHENTICATED.
- A connection that has not authenticated within 5 seconds is dropped.
- STATUS_RESPONSE flags: bit 0 the window is open and no browser has claimed the board yet, bit 1 a pass has been issued, bit 2 this connection is authenticated.
- The wired serial path is not gated: anything wired to the board's UART pins can type without a pass.
- Any restart of the board clears the pass and opens a new window: unplugging it, the BOOT-button mode switch, re-flashing, a crash, or the target computer cutting USB power (for example when it goes to sleep). If your target sleeps and cuts power to its USB ports, the board restarts when power returns, and the browser has 60 seconds to connect again.

**What this does not do.** It is not encryption and not pairing. The link is still unencrypted: someone with a Bluetooth sniffer nearby can read keystrokes, and can capture the pass during a connection. Whoever connects first within the 60 seconds gets the board; if someone else's browser gets there before yours, it holds the board until the board restarts. Anyone who can restart the board can claim it. A device without the pass cannot type and is disconnected within about 5 seconds, but the board takes one connection at a time, so a device that keeps reconnecting can get in the way of yours. What the window does stop is a stranger's phone or laptop connecting and typing.

## Project structure

```
keebler/
  firmware/main/             # ESP-IDF firmware (C)
    main.c                   #   App entry, mode switching, BOOT button
    hid_bridge.c/h           #   TinyUSB HID (boot KB + composite)
    ble_transport.c/h        #   NimBLE GATT peripheral
    serial_transport.c/h     #   UART fallback
    protocol.h               #   Packet protocol, CRC, frame parser
    auth.c/h                 #   Connect window and session pass rules (pure C)
    board_config.h           #   Board abstraction
    wifi_proxy.c/h           #   WiFi STA/AP + HTTP proxy (AV/64 tiers)
  firmware/test/host/        # Host-side tests for auth.c and protocol.h (make test)
  web/                       # Browser app (vanilla JS, ES modules)
    index.html               #   keeBLEr base tier
    av/                      #   keeBLEr AV tier
    64/                      #   keeBLEr64 tier
    js/                      #   Shared modules
    js/auth.js               #   Session pass storage and the AUTH step
    test/                    #   Web tests (cd web && npm test)
    flash.html               #   Browser-based firmware flasher
  docker/                    # HTTPS web server configs
  docs/                      # Extended tier docs + C64 reference
```

## Adding a new board

1. Add a section to `board_config.h` with pin definitions
2. Add a CMake option in `main/CMakeLists.txt`
3. Build with `-DKEEBLER_BOARD=your_board`

The generic target works on most ESP32-S3 boards out of the box.

## What it doesn't do

- It does not pair with the target over Bluetooth. The target only ever sees a USB keyboard (and, in composite mode, a mouse), so it needs a free USB port.
- Only the first browser to connect within 60 seconds of the board starting can type, and only until the board restarts. This is not encryption or pairing: the Bluetooth link is not encrypted, so someone nearby with a sniffer can read your keystrokes and capture the pass, and anyone who can restart the board can claim it. See [Connect window and session pass](#connect-window-and-session-pass-protocol-2-firmware-140).
- The board's Wi-Fi settings (keeBLEr64) are tied to the browser that set them up. See [WiFi security](docs/c64-mode.md#wifi-security).
- It needs a Chromium browser (Chrome, Edge or Brave) on the controlling computer.
- Boot keyboard mode has no mouse. That is the price of working everywhere.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `ACK error 0x03` | USB HID not mounted — wait ~10s for enumeration, check cable |
| BLE won't connect | Ensure HTTPS, use Chrome/Edge |
| XIAO shows as `303a:1001` after flash | Unplug and replug |
| The web app says "Not authorised", or the LED shows two short blue blinks every 2 seconds | Another browser claimed the board, this browser lost its saved pass (cleared site data, or a different browser or profile), nobody connected in the first 60 seconds, or the web app was opened from a different address than before (the public site versus a local or self-hosted copy: the browser saves the pass per site). Unplug the board, plug it back in, and connect within 60 seconds |
| The log shows `ACK with error status: 0x20` and the connection drops every 5 seconds | An old copy of the web app is talking to 1.4.0 firmware: a tab left open from before the update, or the copy the browser cached for offline use. Reload the page; the app serves its cached copy while it fetches the new one, so if the error is still there, reload once more (or hard-reload with Ctrl+Shift+R). Closing the other keeBLEr tabs first is not needed |
| Keys stuck after disconnect | Fixed in firmware — auto key-release on BLE disconnect |

## License

[MIT](LICENSE)

<!-- bricoleur:footer -->
---
Part of **[bricoleur.ai](https://bricoleur.ai)** · [Full guide](https://bricoleur.ai/projects/keebler) · MIT © 2026 Shawn Rancatore
<!-- /bricoleur:footer -->
