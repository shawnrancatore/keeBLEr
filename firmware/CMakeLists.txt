# SPDX-License-Identifier: MIT
# Keebler Firmware — top-level CMake project file for ESP-IDF.

cmake_minimum_required(VERSION 3.16)

set(COMPONENTS main)
include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(keebler)
