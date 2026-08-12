#!/bin/bash
# End-to-end test: ADXL355 3-axis accelerometer over SPI on max32690.
#
# Exercises: the SPI stack (platform extra -> no-OS init_param -> device) and a
# UNION property (comm_init, set as "<member> <value>").

source "$(cd "$(dirname "$0")" && pwd)/e2e_common.sh"

PROJECT_NAME="e2e_test_adxl355"
TARGET_MCU="max32690"

configure_nodes() {
    # A device is a descriptor node (adxl355_device) paired with its init_param struct
    # (adxl355_ip); the init_param references the no-OS SPI init_param, which in turn
    # references the platform (Maxim) SPI init_param.
    $AA create node max_spi_ip platforms/maxim/max32690/max_spi_init_param.yaml
    $AA create node no_os_spi_ip no-os/spi/no_os_spi_init_param.yaml
    $AA create node adxl355_ip devices/adxl355/adxl355_init_param.yaml
    $AA create node adxl355_device devices/adxl355/adxl355.yaml

    # Configure the Maxim SPI init_param
    $AA update max_spi_ip vssel MXC_GPIO_VSSEL_VDDIOH
    $AA update max_spi_ip polarity SPI_SS_POL_LOW

    # Configure the no-OS SPI init_param (references the Maxim ops + extra)
    $AA update no_os_spi_ip device_id 1
    $AA update no_os_spi_ip max_speed_hz 1000000
    $AA update no_os_spi_ip chip_select 0
    $AA update no_os_spi_ip platform_ops max_spi_ops
    $AA update no_os_spi_ip extra max_spi_ip

    # Configure the ADXL355 init_param (comm_init is a union: <member> <value>)
    $AA update adxl355_ip comm_type ADXL355_SPI_COMM
    $AA update adxl355_ip dev_type ID_ADXL355
    $AA update adxl355_ip comm_init spi_init no_os_spi_ip

    # Point the descriptor at its init_param
    $AA update adxl355_device init_param adxl355_ip
}

run_e2e
