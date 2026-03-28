# C64 Ultimate REST API Documentation

> Source: https://1541u-documentation.readthedocs.io/en/latest/api/api_calls.html
> Fetched from: https://github.com/GideonZ/1541u-documentation/blob/master/api/api_calls.rst

## Overview

Starting from Ultimate firmware 3.11, the application supports HTTP-based API calls for integrating remote control functionality in external applications following standard conventions.

### URL Format

```
/v1/<route>/<path>:<command>?<arguments>
```

### HTTP Verbs

| Verb | Meaning |
|------|---------|
| GET | Retrieves information without changing state |
| PUT | Sends information or performs an action using URL or file-referenced data |
| POST | Performs an action using request-attached information |

### Response Format

Most commands return valid JSON with `Content-Type: application/json`. All responses include an `errors` field containing a list of strings describing any issues encountered.

Example response:
```json
HTTP/1.1 200 OK
Connection: close
Content-Type: application/json
Content-Length: 22

{
  "errors": []
}
```

### Network Password Authentication

Starting from firmware 3.12, a "Network Password" can be configured. When set, API requests must include the custom header:

```
X-Password: <your-password>
```

Missing or incorrect passwords result in HTTP `403 Forbidden`. The header is optional when no password is configured.

---

## Routes

### About

| URL | Parameters | Action |
|-----|-----------|--------|
| `GET /v1/version` | -- | Returns REST API version |
| `GET /v1/info` | -- | Returns device information including product name, firmware version, FPGA version, hostname, and unique ID |

**Version Response Example:**
```json
{
  "version": "0.1",
  "errors": []
}
```

**Info Response Example:**
```json
{
  "product": "Ultimate 64",
  "firmware_version": "3.12",
  "fpga_version": "11F",
  "core_version": "143",
  "hostname": "Terakura",
  "unique_id": "8D927F",
  "errors": []
}
```

---

### Runners

| URL | Parameters | Action |
|-----|-----------|--------|
| `PUT /v1/runners:sidplay` | *file*, *[songnr]* | Plays SID file from filesystem; plays default song unless optional song number specified |
| `POST /v1/runners:sidplay` | *[songnr]* | Plays attached SID file; optional song lengths file can be attached |
| `PUT /v1/runners:modplay` | *file* | Plays Amiga MOD file from filesystem |
| `POST /v1/runners:modplay` | -- | Plays attached Amiga MOD file |
| `PUT /v1/runners:load_prg` | *file* | Loads program from filesystem into memory via DMA; does not auto-run |
| `POST /v1/runners:load_prg` | -- | Loads attached program into memory via DMA; does not auto-run |
| `PUT /v1/runners:run_prg` | *file* | Loads program from filesystem and automatically runs it |
| `POST /v1/runners:run_prg` | -- | Loads attached program and automatically runs it |
| `PUT /v1/runners:run_crt` | *file* | Starts cartridge file from filesystem; machine resets with cartridge active |
| `POST /v1/runners:run_crt` | -- | Starts attached cartridge file; machine resets with cartridge active |

---

### Configuration

| URL | Parameters | Action |
|-----|-----------|--------|
| `GET /v1/configs` | -- | Returns list of all configuration categories |
| `GET /v1/configs/<category>` | -- | Returns all configuration items in specified category; wildcards allowed |
| `GET /v1/configs/<category>/<item>` | -- | Returns detailed information about specific item(s); wildcards allowed |
| `PUT /v1/configs/<category>/<item>` | *value* | Sets configuration item to specified value; wildcards allowed |
| `POST /v1/configs` | -- | Bulk updates multiple configuration settings via JSON payload |
| `PUT /v1/configs:load_from_flash` | -- | Restores configuration from non-volatile memory |
| `PUT /v1/configs:save_to_flash` | -- | Writes current configuration to non-volatile memory |
| `PUT /v1/configs:reset_to_default` | -- | Resets settings to factory defaults; does not affect stored values |

**Example GET /v1/configs Response:**
```json
{
  "categories": [
    "Audio Mixer",
    "SID Sockets Configuration",
    "UltiSID Configuration",
    "Network settings",
    "Drive A Settings",
    "Drive B Settings"
  ],
  "errors": []
}
```

**Example Configuration Item Query:**
```
GET /v1/configs/drive%20a*/*bus*
```

**Example Configuration Item Response:**
```json
{
  "Drive A Settings": {
    "Drive Bus ID": {
      "current": 8,
      "min": 8,
      "max": 11,
      "format": "%d",
      "default": 8
    }
  },
  "errors": []
}
```

**Example Bulk Configuration Update:**
```
POST http://192.168.178.232/v1/configs
Content-Type: application/json

{
  "Drive A Settings": {
    "Drive": "Enabled",
    "Drive Type": "1581",
    "Drive Bus ID": 8
  },
  "Drive B Settings": {
    "Drive": "Disabled"
  }
}
```

---

### Machine

| URL | Parameters | Action |
|-----|-----------|--------|
| `PUT /v1/machine:reset` | -- | Sends reset to machine; configuration unchanged |
| `PUT /v1/machine:reboot` | -- | Restarts machine, reinitializes cartridge, sends reset |
| `PUT /v1/machine:pause` | -- | Pauses machine by pulling DMA line low; stops CPU but not timers |
| `PUT /v1/machine:resume` | -- | Resumes machine from paused state |
| `PUT /v1/machine:poweroff` | -- | Powers off machine (U64 only); response may not be received |
| `PUT /v1/machine:menu_button` | -- | Simulates pressing Menu button; toggles Ultimate menu system |
| `PUT /v1/machine:writemem` | *address*, *data* | Writes data to C64 memory via DMA; max 128 bytes; address and data in hexadecimal |
| `POST /v1/machine:writemem` | *address* | Writes binary attachment to C64 memory starting at specified address |
| `GET /v1/machine:readmem` | *address*, *[length]* | Performs DMA read and returns binary result; default 256 bytes |
| `GET /v1/machine:debugreg` | -- | Reads debug register ($D7FF); returns value in hexadecimal (U64 only) |
| `PUT /v1/machine:debugreg` | *value* | Writes value to debug register ($D7FF) and reads it back (U64 only) |

**Example Memory Write:**
```
PUT /v1/machine:writemem?address=D020&data=0504
```

This writes `05` to $D020 and `04` to $D021, turning border green and main screen purple.

---

### Floppy Drives

| URL | Parameters | Action |
|-----|-----------|--------|
| `GET /v1/drives` | -- | Returns information about all internal IEC bus drives including mount status and image paths |
| `PUT /v1/drives/<drive>:mount` | *image*, *[type]*, *[mode]* | Mounts existing image onto specified drive; type options: d64, g64, d71, g71, d81; mode: readwrite, readonly, unlinked |
| `POST /v1/drives/<drive>:mount` | *[type]*, *[mode]* | Mounts attached disk image onto specified drive |
| `PUT /v1/drives/<drive>:reset` | -- | Resets selected drive |
| `PUT /v1/drives/<drive>:remove` | -- | Removes mounted disk from drive |
| `PUT /v1/drives/<drive>:on` | -- | Turns on selected drive; resets if already on |
| `PUT /v1/drives/<drive>:off` | -- | Turns off selected drive; no longer accessible on serial bus |
| `PUT /v1/drives/<drive>:load_rom` | *file* | Loads new drive ROM from filesystem; temporary action reverted by drive type change or reboot |
| `POST /v1/drives/<drive>:load_rom` | -- | Loads attached drive ROM file; size must be 16K or 32K depending on type |
| `PUT /v1/drives/<drive>:set_mode` | *mode* | Changes drive mode; options: 1541, 1571, 1581; also loads drive ROM |

**Example GET /v1/drives Response:**
```json
{
  "drives": [
    {
      "a": {
        "enabled": true,
        "bus_id": 8,
        "type": "1581",
        "rom": "1581.rom",
        "image_file": "",
        "image_path": ""
      }
    },
    {
      "b": {
        "enabled": false,
        "bus_id": 9,
        "type": "1541",
        "rom": "1541.rom",
        "image_file": "",
        "image_path": ""
      }
    }
  ],
  "errors": []
}
```

---

### Data Streams (U64 Only)

The U64 supports streaming video and audio over LAN.

| URL | Parameters | Action |
|-----|-----------|--------|
| `PUT /v1/streams/<stream name>:start` | *ip* | Starts data stream (video, audio, or debug); IP parameter required; default ports: 11000 (video), 11001 (audio), 11002 (debug); custom port specified with colon separator (e.g., 192.168.178.224:6789); video stream auto-disables debug stream |
| `PUT /v1/streams/<stream name>:stop` | -- | Stops data stream |

---

### File Manipulation

| URL | Parameters | Action |
|-----|-----------|--------|
| `GET /v1/files/<path>:info` | -- | Returns file information like size and extension; supports wildcards (unfinished) |
| `PUT /v1/files/<path>:create_d64` | *[tracks]*, *[diskname]* | Creates .d64 file; default 35 tracks, optionally 40; optional diskname parameter |
| `PUT /v1/files/<path>:create_d71` | *[diskname]* | Creates .d71 file; 70 tracks fixed; optional diskname parameter |
| `PUT /v1/files/<path>:create_d81` | *[diskname]* | Creates .d81 file; 160 tracks (80 per side) fixed; optional diskname parameter |
| `PUT /v1/files/<path>:create_dnp` | *tracks*, *[diskname]* | Creates .dnp file; tracks required parameter; 256 sectors per track; max 255 tracks (~16 MB); optional diskname parameter |
