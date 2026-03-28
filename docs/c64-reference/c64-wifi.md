# Using WiFi on the Ultimate 64

> Source: https://1541u-documentation.readthedocs.io/en/latest/howto/wifi.html
> Fetched from: https://github.com/GideonZ/1541u-documentation/blob/master/howto/wifi.rst

## Initial Setup: Programming the ESP32

Before using the WiFi module, you must program it with a supplied ".esp" file containing ESP32 firmware. Without this, the Ultimate cannot communicate with the WiFi module.

To install the firmware:
1. Browse to the ".esp" file
2. Select "Flash into ESP32"
3. The Ultimate begins programming in the background
4. You can continue using the application during programming
5. After approximately two minutes, a popup confirms completion
6. The WiFi line in the main screen becomes operational

## Setting up a Connection

**Important:** The ESP32 only supports the 2.4 GHz WiFi band, so this band must be enabled on your access point.

When the WiFi line displays a MAC address, the module is recognized and ready to connect:

1. Select "Show APs.." from the context menu to view nearby access points
2. The list sorts by signal strength with strongest signals first
3. Select your desired network
4. Enter the network password when prompted
5. Press CRSR-LEFT to exit the access point list
6. The WiFi connects and displays an IP address

### Invisible SSIDs

For networks with hidden SSIDs, manually connect through the configuration menu:
- Press F2 to access configuration
- Navigate to "WiFi Settings"
- Enter the SSID and password manually
- Specify the authentication type (required for successful connection)

## Available Functionality

The WiFi module functions as a transparent network adapter, supporting telnet, FTP, modem emulation, and internet connectivity. Video and audio streaming require the LAN port instead.

## Privacy Note

When disabled in configuration, the WiFi module enters deep sleep with all radio circuitry off. Remove any foil covering your C64 board if WiFi signal is weak.
