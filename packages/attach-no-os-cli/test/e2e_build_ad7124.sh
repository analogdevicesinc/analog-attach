#!/bin/bash
# End-to-end test: AD7124 24-bit sigma-delta ADC over SPI on max32690.
#
# Exercises what the other two tests do not:
#   - a POINTER init_param: the descriptor takes `&ad7124_ip`, and ad7124_ip itself
#     holds spi_init as a pointer include, so codegen emits `&` on both edges
#   - ARRAY properties left empty (setups[8], chan_map[16]) -> `{ 0 }` initializers
#   - two enum includes (mode, power_mode) alongside an inline enum (active_device)

source "$(cd "$(dirname "$0")" && pwd)/e2e_common.sh"

PROJECT_NAME="e2e_test_ad7124"
TARGET_MCU="max32690"

configure_nodes() {
    $AA create node max_spi_ip platforms/maxim/max32690/max_spi_init_param.yaml
    $AA create node no_os_spi_ip no-os/spi/no_os_spi_init_param.yaml
    $AA create node ad7124_ip devices/ad7124/ad7124_init_param.yaml
    $AA create node ad7124_device devices/ad7124/ad7124.yaml

    # Configure the Maxim SPI init_param
    $AA update max_spi_ip vssel MXC_GPIO_VSSEL_VDDIOH
    $AA update max_spi_ip polarity SPI_SS_POL_LOW

    # Configure the no-OS SPI init_param (references the Maxim ops + extra)
    $AA update no_os_spi_ip device_id 1
    $AA update no_os_spi_ip max_speed_hz 1000000
    $AA update no_os_spi_ip chip_select 0
    $AA update no_os_spi_ip platform_ops max_spi_ops
    $AA update no_os_spi_ip extra max_spi_ip

    # Configure the AD7124 init_param. spi_init is a pointer include, so this is a
    # plain reference and codegen decides the `&`.
    $AA update ad7124_ip spi_init no_os_spi_ip
    $AA update ad7124_ip active_device ID_AD7124_4
    $AA update ad7124_ip mode AD7124_CONTINUOUS
    $AA update ad7124_ip power_mode AD7124_HIGH_POWER
    $AA update ad7124_ip ref_en true
    $AA update ad7124_ip use_crc 0
    $AA update ad7124_ip check_ready 1

    $AA update ad7124_device init_param ad7124_ip
}

run_e2e
