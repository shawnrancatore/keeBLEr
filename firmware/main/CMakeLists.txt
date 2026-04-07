# SPDX-License-Identifier: MIT
# Keebler main component — source files, dependencies, and board selection.

idf_component_register(
    SRCS "main.c"
         "hid_bridge.c"
         "ble_transport.c"
         "serial_transport.c"
         "wifi_proxy.c"
         "led_status.c"
    INCLUDE_DIRS "."
    PRIV_REQUIRES
        nvs_flash
        esp_driver_gpio
        esp_driver_uart
        esp_driver_rmt
        bt
        esp_tinyusb
        esp_wifi
        esp_netif
        esp_http_client
        esp_timer
)

# Board selection: pass -DKEEBLER_BOARD=devkitc1 or -DKEEBLER_BOARD=xiao
# Default: devkitc1
if(NOT DEFINED KEEBLER_BOARD)
    set(KEEBLER_BOARD "devkitc1")
endif()

if(KEEBLER_BOARD STREQUAL "xiao")
    target_compile_definitions(${COMPONENT_LIB} PUBLIC BOARD_XIAO_S3)
    message(STATUS "Keebler board: XIAO ESP32S3")
elseif(KEEBLER_BOARD STREQUAL "qtpy")
    target_compile_definitions(${COMPONENT_LIB} PUBLIC BOARD_QTPY_S3)
    message(STATUS "Keebler board: Adafruit QT Py ESP32-S3")
elseif(KEEBLER_BOARD STREQUAL "supermini")
    target_compile_definitions(${COMPONENT_LIB} PUBLIC BOARD_SUPERMINI_S3)
    message(STATUS "Keebler board: ESP32-S3 SuperMini")
elseif(KEEBLER_BOARD STREQUAL "generic")
    target_compile_definitions(${COMPONENT_LIB} PUBLIC BOARD_GENERIC_S3)
    message(STATUS "Keebler board: Generic ESP32-S3")
elseif(KEEBLER_BOARD STREQUAL "devkitc1")
    target_compile_definitions(${COMPONENT_LIB} PUBLIC BOARD_DEVKITC1)
    message(STATUS "Keebler board: DevKitC-1")
endif()
