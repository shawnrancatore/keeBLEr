# keeBLEr64

**keeBLEr64** extends keeBLEr AV with C64 Ultimate integration and a Commodore-inspired theme.

## What it adds

- **Commodore 64 theme** — classic blue/purple color scheme, monospace uppercase text, blinking cursor
- **Quick action bar** — Ultimate, Reset, Pause, Resume, Reboot, Load File buttons directly below the video
- **WiFi BLE-to-HTTP proxy** — the keeBLEr device bridges API calls from the browser to the C64 over WiFi, eliminating the need for Docker or a CORS proxy
- **WiFi AP mode** — keeBLEr can create its own WiFi network for the C64 to join
- **File transfer** — drag-and-drop files to the C64 Ultimate with smart action routing
- **File browser** — browse the C64's filesystem (SD, USB, Flash)
- **Machine control** — reset, pause, resume, reboot the C64 via HTTP API
- **1541 disk drive progress bar** — C64-themed transfer indicator with flickering LED

## Accessing keeBLEr64

- **GitHub Pages:** [`https://shawnrancatore.github.io/keeBLEr/64/`](https://shawnrancatore.github.io/keeBLEr/64/)
- **Docker:** `https://your-ip:8443/64/`

## Connecting to the C64 Ultimate

There are three ways to reach the C64 Ultimate's HTTP API from the browser:

### Option 1: WiFi BLE proxy (recommended — works from GitHub Pages)

The keeBLEr device acts as a BLE-to-WiFi bridge. The browser sends HTTP requests over BLE, the ESP32-S3 executes them over WiFi, and streams responses back. No Docker, no CORS issues.

**Join mode** — keeBLEr joins your existing WiFi network:

1. Connect to your keeBLEr device via BLE
2. Expand the **WiFi Proxy** panel
3. Select **Join network**
4. Click **Scan Networks** — your local WiFi networks appear
5. Select your network, enter the password, click **Connect**
6. The keeBLEr device connects to WiFi and receives a token
7. Enter the C64 Ultimate's IP in the C64 panel and click **Connect**
8. API calls now flow: Browser → BLE → keeBLEr → WiFi → C64

**AP mode** — keeBLEr creates its own WiFi network:

1. Connect to your keeBLEr device via BLE
2. Expand the **WiFi Proxy** panel
3. Select **Create network (AP)**
4. Enter a network name (default: "keebler") and optional WPA2 password
5. Click **Start AP**
6. Configure the C64 Ultimate to connect to this WiFi network
7. Once the C64 joins, its MAC appears in the log
8. Enter the C64's IP (typically `192.168.4.2` on the keeBLEr AP) and connect

AP mode requires no existing WiFi infrastructure — useful for isolated setups, events, or locations without WiFi.

### Option 2: Docker CORS proxy (self-hosted)

When running keeBLEr from Docker, nginx reverse-proxies API requests through `/c64proxy/` to bypass CORS:

```bash
cd docker && docker compose up -d
```

Open `https://your-ip:8443/64/`, enter the C64 IP, and connect. No WiFi configuration needed — the proxy runs on the server.

### Option 3: Direct HTTP (limited)

If the C64 Ultimate's firmware is modified to send CORS headers, or if you use a browser extension that disables CORS, direct HTTP works. This is not recommended.

### WiFi security

- A 16-byte random token is generated on first WiFi configuration
- The token is stored in the browser (localStorage) and on the device (NVS)
- All WiFi and HTTP proxy commands require the token
- The token expires after approximately 60 device reboots without use (sliding expiration)
- **Forget** clears the token and stored WiFi credentials from both sides

## File transfer

### Drag and drop

Drop files onto the drop zone. keeBLEr64 routes each file to the correct API endpoint based on extension:

| Extension | Action | API endpoint |
|-----------|--------|--------------|
| `.prg` | Run immediately | `POST /v1/runners:run_prg` |
| `.d64`, `.d71`, `.d81`, `.g64`, `.dnp` | Mount as drive A | `POST /v1/drives:mount/a` |
| `.sid` | Play SID tune | `POST /v1/runners:sidplay` |
| `.crt` | Load cartridge | `POST /v1/runners:run_crt` |
| `.mod`, `.xm`, `.s3m` | Play tracker music | `POST /v1/runners:modplay` |

### Transfer speed

- **Docker proxy:** Full network speed (instant for typical C64 files)
- **WiFi BLE proxy:** ~10 KB/s (limited by BLE throughput). A 16KB .prg takes ~2 seconds. A 170KB .d64 takes ~17 seconds. The 1541 disk drive progress bar shows transfer status.

### File browser

The file browser shows the C64's filesystem. Click folders to navigate. The "Load File" button in the quick bar opens a file picker filtered to C64 file types.

### Persistent storage

The HTTP API uploads files to `/Temp/` only. For persistent storage to the SD card, use FTP (port 21 on the C64 Ultimate).

## Machine control

| Button | API | Description |
|--------|-----|-------------|
| **Ultimate** | `PUT /v1/machine:menu_button` | Toggle the Ultimate menu |
| **Reset** | `PUT /v1/machine:reset` | Reset the C64 |
| **Pause** | `PUT /v1/machine:pause` | Freeze the C64 CPU |
| **Resume** | `PUT /v1/machine:resume` | Resume the C64 CPU |
| **Reboot** | `PUT /v1/machine:reboot` | Reboot the Ultimate hardware |

If the HTTP API is not connected, the **Ultimate** button falls back to sending ScrollLock (HID keycode 0x47) over BLE.

## C64 Ultimate compatibility

- Firmware 3.x required (tested with 3.14)
- Boot protocol keyboard mode (mode 0) required — the C64 Ultimate only supports boot protocol HID
- Press the BOOT button on the keeBLEr device to toggle between boot keyboard (mode 0) and composite keyboard+mouse (mode 1)
- See [C64 Ultimate USB Research](c64-ultimate-usb-research.md) for deep technical details

## Authentication

The C64 Ultimate HTTP API supports optional password protection. If enabled on your device, enter the password in the keeBLEr64 panel. It's sent as an `X-Password` header on all API requests.
