#!/bin/bash
# End-to-end test: the same ADXL355 project as e2e_build.sh, but generated inside the
# no-OS checkout at <no-OS>/projects/<name>.
#
# Exercises what none of the device tests do: the other half of the generated
# CMakeLists.txt. Out-of-tree the project is the top-level CMake source and pulls
# no-OS in with add_subdirectory; in-tree that whole block is skipped and the no-OS
# root drives the build, descending into the project via PROJECT_DEFCONFIG. Only the
# layout differs here, so a failure points at the build files rather than the device.
#
# The device configuration itself is not repeated — this sets the layout and the
# project name, then sources the ADXL355 test.

export E2E_MODE="in-tree"
export PROJECT_NAME="e2e_test_adxl355_in_tree"

source "$(cd "$(dirname "$0")" && pwd)/e2e_build.sh"
