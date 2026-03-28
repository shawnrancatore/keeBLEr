# C64 Ultimate Configuration

> Source: https://1541u-documentation.readthedocs.io/en/latest/config/config.html
> Fetched from: https://github.com/GideonZ/1541u-documentation/blob/master/config/

## Configuration Menu

The U64 settings can be tailored through the configuration menu (F2).

### Available Configuration Sections

- Audio Mixer
- SID Sockets Configuration
- UltiSID Configuration
- SID Addressing
- U64 Specific Settings
- C64 and Cartridge Settings
- Clock Settings
- Software IEC Settings
- LED Strip Settings
- Data Streams
- Modem Settings
- User Interface Settings
- Tape Settings
- 1541 Drive A Settings
- 1541 Drive B Settings
- Network Settings
- Turbo Mode
- RealTime Clock (RTC)
- Setting up 4 and 8 UltiSIDs

## User Interface Settings

| Setting | Description | Available Options |
|---------|-------------|-------------------|
| Interface Type * | Determines how the interface displays | **Freeze** (default), Overlay on HDMI |
| Background color | Adjusts the UI background appearance | **Black** (default), Various colors |
| Border color | Controls the UI border appearance | **Black** (default), Various colors |
| Foreground color | Sets the main UI text/element color | **Mid Grey** (default), Various colors |
| Selected item color | Colors highlighted menu items | **White** (default), Various colors |
| Selected Backgr (Overlay) * | Adjusts overlay selection highlighting | **Blue** (default), Various colors |
| Home Directory | Specifies startup directory path (e.g., `/Usb1/games`) | Text input field |
| Enter Home on Startup | Automatically navigates to home directory at boot | **Disabled** (default), Enabled |

### Interface Type Details

#### Freeze Mode
Standard interface display mode with full visual customization.

#### Overlay on HDMI
This interface is **ONLY** visible on HDMI output. Functions as an on-screen display overlay for connected monitors.

## Configuration via REST API

Configuration can be read and modified programmatically via the REST API (firmware 3.11+). See [c64-api-calls.md](c64-api-calls.md) for full details.

### Key API Endpoints

- `GET /v1/configs` -- list all configuration categories
- `GET /v1/configs/<category>` -- list items in a category (wildcards allowed)
- `GET /v1/configs/<category>/<item>` -- get item details
- `PUT /v1/configs/<category>/<item>?value=<val>` -- set a config item
- `POST /v1/configs` -- bulk update via JSON body
- `PUT /v1/configs:save_to_flash` -- persist to non-volatile memory
- `PUT /v1/configs:load_from_flash` -- restore from non-volatile memory
- `PUT /v1/configs:reset_to_default` -- factory reset (in-memory only)

### .cfg Files

Configuration files (.cfg) store internal settings in text format similar to .ini files. These may accompany software that requires specific cartridge settings.

*Applies to: 1541 Ultimate-II, Ultimate-II+, Ultimate 64*

\* Settings marked with asterisk are available exclusively on Ultimate 64 with firmware version 1.06 or later.
