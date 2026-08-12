#!/bin/bash
# End-to-end test: ADT7420 temperature sensor over I2C on max32690.
#
# Exercises what the ADXL355 test does not:
#   - the I2C stack rather than SPI (max_i2c_init_param / no_os_i2c_init_param /
#     max_i2c_ops), so codegen emits a different platform_ops + extra pair
#   - a $switch override: active_device=ID_ADT7420 constrains the interface_init
#     union to its i2c_init member (ID_ADT7320 would force spi_init instead)

source "$(cd "$(dirname "$0")" && pwd)/e2e_common.sh"

PROJECT_NAME="e2e_test_adt7420"
TARGET_MCU="max32690"

configure_nodes() {
    $AA create node max_i2c_ip platforms/maxim/max32690/max_i2c_init_param.yaml
    $AA create node no_os_i2c_ip no-os/i2c/no_os_i2c_init_param.yaml
    $AA create node adt7420_ip devices/adt7420/adt7420_init_param.yaml
    $AA create node adt7420_device devices/adt7420/adt7420.yaml

    # Configure the Maxim I2C init_param
    $AA update max_i2c_ip vssel MXC_GPIO_VSSEL_VDDIOH

    # Configure the no-OS I2C init_param (references the Maxim ops + extra).
    # device_id is capped at 2 by the Maxim $override on the parent.
    $AA update no_os_i2c_ip device_id 1
    $AA update no_os_i2c_ip max_speed_hz 100000
    $AA update no_os_i2c_ip slave_address 72
    $AA update no_os_i2c_ip platform_ops max_i2c_ops
    $AA update no_os_i2c_ip extra max_i2c_ip

    # Configure the ADT7420 init_param. active_device drives the $switch that pins
    # interface_init to i2c_init; the union value is still set explicitly.
    $AA update adt7420_ip active_device ID_ADT7420
    $AA update adt7420_ip resolution_setting 1
    $AA update adt7420_ip interface_init i2c_init no_os_i2c_ip

    $AA update adt7420_device init_param adt7420_ip
}

run_e2e
