# C64 Ultimate How-To Index

> Source: https://1541u-documentation.readthedocs.io/en/latest/howto/index.html
> Fetched from: https://github.com/GideonZ/1541u-documentation/tree/master/howto

## Available How-To Guides

| File | Topic |
|------|-------|
| assembly.rst | Assembly-related documentation |
| cartridges.rst | Cartridge guides |
| dma.rst | DMA (Direct Memory Access) |
| file_systems.rst | File system documentation |
| file_types.rst | File type reference |
| firmware.rst | Firmware installation/updates |
| installing_310.rst | Installation guide for 3.10 |
| installing_310i.rst | Installation guide for 3.10i |
| mm_drive.rst | Multi-Media Drive documentation |
| modem.rst | Modem configuration |
| palette.rst | Palette settings |
| tape.rst | Tape-related guides |
| wifi.rst | WiFi setup instructions |

## Topics Relevant to Automation and Scripting

- **file_types.rst** -- Supported file types including .cfg configuration files and .prg program files
- **file_systems.rst** -- Supported file systems (FAT16/32, ISO9660, D64/D71/D81, T64)
- **wifi.rst** -- WiFi setup (ESP32-based, 2.4 GHz only, supports telnet/FTP/modem)
- **firmware.rst** -- Firmware update process
- **dma.rst** -- Direct Memory Access for loading programs

## Notes

The REST API (documented in [c64-api-calls.md](c64-api-calls.md)) provides the primary mechanism for automated/scripted interaction with the Ultimate device over the network. Key capabilities include:

- Loading and running programs (`/v1/runners:run_prg`)
- Mounting disk images (`/v1/drives/<drive>:mount`)
- Reading/writing C64 memory (`/v1/machine:readmem`, `/v1/machine:writemem`)
- Reading and modifying all configuration settings (`/v1/configs`)
- Machine control (reset, reboot, pause/resume)
