# Supported File Types

> Source: https://1541u-documentation.readthedocs.io/en/latest/howto/file_types.html
> Fetched from: https://github.com/GideonZ/1541u-documentation/blob/master/howto/file_types.rst

The Ultimate application supports the following file types:

| Extension | Use |
|-----------|-----|
| .prg | C64 program files that load directly into memory via DMA and start on demand. Works whether files are on the filesystem or within container formats like .D64, .T64, or others. |
| .d64 / .d71 / .d81 | Disk images. .D64 files are for the 1541 and can be mounted onto the virtual floppy drives. .d71 and .d81 function only as containers without mounting support due to lack of 1571/1581 emulation. |
| .g64 | Low-level floppy data format for the 1541. These files mount on virtual floppy drives but cannot be read as container format due to raw binary structure. |
| .t64 | Tape Archives functioning as containers for C64 program files, unrelated to actual tape loading. |
| .tap | Tape Files storing magnetic flux changes as digital signal representation. These files can be attached to the tape emulation for loading originals. Requires extension cable for U2/U2+ tape port routing; unnecessary for U64. |
| .crt | Cartridge Files containing definitions for cartridge port cartridges. Support varies across the multitude of cartridge types available. |
| .bin / .rom | Binary files recognized as ROM files when correctly sized, enabling flash programming. |
| .cfg | Configuration Files storing internal settings in text format similar to .ini files. May accompany software requiring specific cartridge settings. |
| .reu | RAM Expansion Files loadable into RAM Expansion Unit memory, sometimes required by specific titles. |
| .sid | SID Tune invoking the built-in SID player by Wilfred Bos. |
| .mus | MUS Tune invoking the built-in MUS player by Wilfred Bos. |
| .mod | Amiga Module invoking the built-in MOD player (Freshness/Diego). Requires Ultimate Audio module in FPGA; automatically enables module mapping and REU. |
| .u64 / .u2p / .u2u | Update Files for firmware distribution. These are embedded Ultimate applications that flash new firmware versions. |
| .iso | ISO 9660 Container providing read-only access to CD/DVD ROM images without separate file copying. |
| .fat | FAT File System Container enabling access to complete FAT file systems, useful for diskette images and memory device images. |

## File Systems

The following file systems are supported:

- FAT16/FAT32 file system on any storage device
- ISO9660/Joliet on CD/DVD ROM drives, or ISO files
- D64 files
- D71 files
- D81 files (no partitions)
- T64 files

*Applies to: 1541 Ultimate-II, Ultimate-II+, Ultimate 64*
