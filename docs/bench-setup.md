# keebler Hardware Details

This document is a bench-reference for the hardware used during development of **keebler**.

keebler = keyboard BLE enabler

## Purpose

keebler is being developed first on the **ESP32-S3-DevKitC-1** for fast bring-up, flashing, debugging, and USB HID testing, then retargeted to the **Seeed Studio XIAO ESP32S3** as the smaller final hardware.

The software should remain portable across ESP32-S3 devices where practical, but the intended final target for this project is:

- **Seeed Studio XIAO ESP32S3**

---

## Boards in use

### 1. ESP32-S3-DevKitC-1
Used as the main development and debugging board.

Relevant board facts:
- ESP32-S3 based development board
- separate **USB-to-UART** port for flashing / serial console
- separate native **ESP32-S3 USB** port for USB device / OTG work
- both ports may be connected for development bring-up and testing

Reference notes:
- the **USB-to-UART Port** is a Micro-USB connection used for power, flashing, and communication through the onboard USB-to-UART bridge
- the **ESP32-S3 USB Port** is the native full-speed USB OTG interface
- Espressif documents that the board may be powered from the **USB-to-UART port**, the **ESP32-S3 USB port**, or **either one or both** simultaneously

### 2. Seeed Studio XIAO ESP32S3
Used as the intended final compact hardware target.

Relevant board facts:
- ESP32-S3 based compact board
- Wi-Fi + BLE capable
- connected by **USB Type-C**
- should eventually run the same keebler firmware architecture once board-specific setup is isolated

---

## Current development machine connections

The **programmer / development computer** currently has all of the following attached at the same time:

### ESP32-S3-DevKitC-1
Both USB connectors on the DevKitC-1 are plugged into the programmer computer:

1. **UART** port on the DevKitC-1 → programmer computer (`/dev/ttyUSB0`, CP2102N)
2. **USB** port on the DevKitC-1 → programmer computer (`/dev/ttyACM2`, Espressif JTAG/serial)

This is a development / bring-up arrangement.

### XIAO ESP32S3
A **XIAO ESP32S3** is also plugged into the programmer computer by USB.

### Bus Pirate 5
A **Bus Pirate 5** is also plugged into the programmer computer (`/dev/ttyACM0`, `/dev/ttyACM1`).

### MacroSilicon USB3.0 Capture Card
A **USB3.0 HDMI capture card** (MacroSilicon 534d:2109) is plugged in at `/dev/video0`.

Supported modes (MJPG):
- 1920x1080 @ 60/30/25/20/10 fps
- 1600x1200 @ 60/30/25/20/10 fps
- 1280x720 @ 60/50/30/20/10 fps
- 1024x768, 800x600, 720x576, 720x480, 640x480

Supported modes (YUYV): lower frame rates, up to 640x480@30fps

---

## Bus Pirate 5 wiring to the DevKitC-1

Current Bus Pirate 5 wiring to the ESP32-S3-DevKitC-1:

- **Bus Pirate GND** → **DevKitC-1 GND**
- **Bus Pirate IO0** → **DevKitC-1 3.3V**
- **Bus Pirate IO1** → **DevKitC-1 RST** (reset line)

This wiring is recorded here exactly as currently connected on the bench.

## Important caution

Because Bus Pirate **IO0** is connected to the DevKitC-1 **3.3V rail**, treat that Bus Pirate pin carefully in software and scripts. It should not be driven in a way that conflicts with the board power rail.

Likewise, because **IO1** is tied to the DevKitC-1 reset line, any script or terminal action that toggles that Bus Pirate pin may reset the DevKitC-1.

---

## Role of each attached device during development

### DevKitC-1
Primary development target for:
- ESP-IDF firmware bring-up
- USB HID keyboard/mouse testing
- BLE transport development
- serial logging and recovery

### XIAO ESP32S3
Secondary / target hardware for:
- portability checks
- future final deployment target
- verifying that board-specific assumptions are isolated cleanly

### Bus Pirate 5
Bench utility for:
- reset-line control
- simple scripted bring-up support
- observing or forcing development states as needed

### MacroSilicon USB3.0 Capture Card
HDMI capture for:
- displaying remote screen in keebler web app via getUserMedia()
- default resolution: 1920x1080 MJPG @ 30fps (or 1280x720 for lower bandwidth)

---

## Software assumptions this hardware setup implies

The codebase should assume:

- **DevKitC-1 first**, because it is easier to debug
- **XIAO ESP32S3 second**, as the compact production target
- board-specific setup belongs behind a board abstraction layer such as:
  - `board_config.h`
  - board init helpers
  - transport/USB config wrappers where needed

The code should avoid baking in assumptions that only make sense on the DevKitC-1 development setup.
