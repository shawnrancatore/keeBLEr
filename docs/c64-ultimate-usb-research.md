# C64 Ultimate USB Host Behavior Research

Research conducted 2026-03-25 for the keebler project. Examines how the C64 Ultimate (Ultimate 64, 1541 Ultimate II+) handles USB host operations, particularly around menu activation and HID keyboard compatibility.

## Key Findings

### VBUS Power: NOT cut when entering the menu

The C64 Ultimate **does not power-cycle VBUS** when entering the Ultimate menu via ScrollLock or the cartridge button.

Source code evidence (`/software/io/usb/usb_base.cc` in [GideonZ/1541ultimate](https://github.com/GideonZ/1541ultimate)):
- The `power_off()` function is **entirely commented out** — it is a no-op
- No code in the USB driver responds to menu entry/exit events
- The USB task runs as an independent FreeRTOS task (`poll_usb2`) completely decoupled from the UI/menu state machine
- The keyboard processing module (`keyboard_usb.cc`) handles ScrollLock purely as a keycode passed to the UI layer — zero USB bus state management

VBUS control chain: Software writes `OTG_DRV_VBUS` (bit 5) to ULPI OTG Control Register (0x0A) -> nano CPU forwards to ULPI bus -> ULPI PHY drives CPEN pin -> external power switch enables 5V VBUS. This is only toggled during initial enumeration and disconnect events.

### USB Bus Reset: NOT triggered by menu activation

The `bus_reset()` function writes `NANO_DO_RESET = 1` to the FPGA nano controller, triggering SE0 signaling for ~900ms with speed negotiation. It is only called:
1. During initial device enumeration after a new device is connected
2. After a disconnect/reconnect event is detected

There is no call path from menu activation to any USB bus reset function.

### No user-accessible USB settings

The F2 configuration menu includes no USB host controller settings, USB power options, or USB bus management configuration. USB power management is handled entirely in firmware/FPGA with hardcoded parameters:
- Max power per port: 100 mA (`MAXPB = 0x32`)
- Power-on time: 100 ms (`PWRT = 0x32`)

### Freeze vs HDMI Overlay setting

This controls how the Ultimate's menu is rendered (freeze the C64 CPU vs overlay on HDMI output). Since the USB subsystem is completely independent of the UI layer, **neither mode affects USB behavior**.

## USB Host Controller Architecture

### Hardware layer (FPGA - VHDL)
- Located in `/fpga/io/usb2/vhdl_source/` (27 files for USB 2.0) and `/fpga/io/usb/vhdl_source/` (9 files for USB 1.x fallback)
- **ULPI PHY interface**: External ULPI transceiver (likely Microchip USB3300/USB3320) connected to Altera Cyclone IV FPGA
- **Embedded "nano" processor**: Small CPU in FPGA (`usb_host_nano.vhd`) for USB protocol operations (SOF, transaction scheduling, split transactions)
- Key modules: `ulpi_bus.vhd`, `ulpi_rx.vhd`/`ulpi_tx.vhd`, `host_sequencer.vhd`, `usb_cmd_nano.vhd`, `usb1_bus_reset.vhd`

### USB Hub layer
- Uses Microchip **USB2513** (I2C addr `0x58`) or **USB2503** (I2C addr `0x5A`) external hub chip, initialized over I2C at boot
- Hub provides physical USB ports; FPGA implements upstream host controller

### Software layer (C++ on RISC-V/Nios)
- Located in `/software/io/usb/` (24 source files)
- `usb_base.cc/h` — Main host controller driver, FreeRTOS task
- `usb_hid.cc/h` — HID class driver (keyboards, mice)
- `keyboard_usb.cc/h` — USB-to-C64 keymap translation
- `usb_hub.cc/h` — Hub driver with per-port power control and reset

## HID Keyboard Compatibility

**Critical: The C64 Ultimate only supports boot protocol keyboards (subclass=1, protocol=1).**

- Complex keyboards with multimedia features have higher failure rates
- The HID driver specifically requires boot protocol
- As of firmware 3.4: "No full HID support just yet" — improved in later versions but remains limited to boot protocol
- USB mouse adapters can conflict with keyboard functionality

### Implications for keebler
- **Boot keyboard mode (mode 0)** is required for C64 Ultimate compatibility
- Composite HID with report IDs (mode 1) will likely be rejected or cause enumeration issues
- The boot protocol keyboard descriptor must have: bInterfaceSubClass=1, bInterfaceProtocol=1, no report IDs, standard 8-byte reports

## Notable Firmware Fixes (USB-related)

| Version | Fix |
|---------|-----|
| v1.10 / v3.4 | "USB problems with low/full speed devices fixed; no more bus hang-ups" |
| v3.10a | "Fixed USB sticks not recognized" / "Allow copying bigger files without USB crash" |
| v3.14d | "Added support for USB (boot) mice into 1351 mouse emulation" |
| Various | USB keyboard key repeat, improved key mapping, overlay menu positioning |

The v1.10/v3.4 USB host stability fix was the most significant, resolving bus hang-ups with low/full speed devices.

## Sources

- [GideonZ/1541ultimate — Official firmware repository](https://github.com/GideonZ/1541ultimate)
- [1541 Ultimate Documentation](https://1541u-documentation.readthedocs.io/en/latest/)
- [Older USB header with ULPI/VBUS definitions (rkrajnc fork)](https://github.com/rkrajnc/gideonz_1541ultimate/blob/master/1541uII/software/io/usb/usb.h)
- [1541 Ultimate FAQ](https://1541u-documentation.readthedocs.io/en/latest/faq.html)
- [Ultimate64 Firmware page](https://ultimate64.com/Firmware)
- [USB Stick compatibility issue #239](https://github.com/GideonZ/1541ultimate/issues/239)
- [markusC64/1541ultimate2 — Community firmware fork](https://github.com/markusC64/1541ultimate2)
- [DrZingo Unofficial Manual](https://github.com/DrZingo/Ultimate64-manual-unofficial/blob/master/Ultimate64-manual.md)
- [Lemon64 — Ultimate 64 USB controllers discussion](https://www.lemon64.com/forum/viewtopic.php?t=77158)
- [Microchip USB3300 datasheet](https://ww1.microchip.com/downloads/en/DeviceDoc/00001783C.pdf)

---

## HTTP API File Upload Details (from source code analysis)

### Upload mechanism
- POST endpoints accept both `multipart/form-data` and raw `application/octet-stream`
- All uploads go to `/Temp/` directory — NOT to the user's target path
- Persistent file storage to SD/USB/Flash requires FTP (port 21)
- Auth: `X-Password` header on all requests (empty password = no auth)

### Key POST endpoints for file handling
- `POST /v1/runners:run_prg` — upload and run PRG immediately
- `POST /v1/runners:load_prg` — upload and load PRG (don't run)
- `POST /v1/runners:sidplay?songnr=` — upload and play SID
- `POST /v1/runners:run_crt` — upload and run CRT
- `POST /v1/runners:modplay` — upload and play MOD
- `POST /v1/drives:mount/{drive}?type=&mode=` — upload and mount disk image

### Machine control
- `PUT /v1/machine:reset` — reset C64
- `PUT /v1/machine:reboot` — reboot Ultimate
- `PUT /v1/machine:pause` / `resume` — pause/resume C64
- `PUT /v1/machine:menu_button` — push the Ultimate menu button

### File browsing
- `GET /v1/files:info/{path}` — get file info
- No HTTP directory listing endpoint — FTP `LIST` is needed for browsing
- `PUT /v1/files:create_d64/{path}?tracks=&diskname=` — create empty disk images
