# keeBLEr64

**keeBLEr64** extends keeBLEr AV with C64 Ultimate integration and a Commodore-inspired theme.

## What it adds

- **Commodore 64 theme** — classic blue/purple color scheme, monospace uppercase text, blinking cursor
- **Quick action bar** — Reset, Pause, Resume, Reboot, Load File buttons directly below the video
- **Ultimate menu button** — toggles the Ultimate menu via HTTP API (or ScrollLock over BLE as fallback)
- **File transfer** — drag-and-drop files to the C64 Ultimate with smart action routing
- **File browser** — browse the C64's filesystem (SD, USB, Flash)
- **Machine control** — reset, pause, resume, reboot the C64 via HTTP API

## Setup

### Accessing keeBLEr64

- **GitHub Pages:** `https://shawnrancatore.github.io/keeBLEr/64/`
- **Docker:** `https://your-ip:8443/64/`

### Connecting to the C64 Ultimate

1. Expand the "C64 Ultimate File Transfer" panel
2. Enter the C64 Ultimate's IP address (e.g., `192.168.50.193`)
3. Enter the password if your Ultimate is password-protected (optional)
4. Click **Connect**

The IP is saved in localStorage and auto-connects on subsequent visits.

### CORS proxy

The C64 Ultimate's HTTP API doesn't send CORS headers. When using the Docker setup, nginx reverse-proxies API requests through `/c64proxy/` to solve this. On GitHub Pages (no proxy), direct API calls may fail depending on the browser. The Docker setup is recommended for full C64 integration.

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

### File browser

The file browser shows the C64's filesystem via FTP directory listings. Click folders to navigate. The "Load File" button in the quick bar opens a file picker filtered to C64 file types.

### Persistent storage

The HTTP API uploads files to `/Temp/` only. For persistent storage to the SD card, use FTP (port 21 on the C64 Ultimate). The file browser reads directory listings but file uploads go through the HTTP API for immediate execution.

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
- See [C64 Ultimate USB Research](c64-ultimate-usb-research.md) for deep technical details

## Authentication

The C64 Ultimate HTTP API supports optional password protection. If enabled on your device, enter the password in the keeBLEr64 panel. It's sent as an `X-Password` header on all API requests.
