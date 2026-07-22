#include "common_data.h"

struct descriptors desc = { 0 };

const struct max_spi_init_param max_spi = {
	.polarity = SPI_SS_POL_LOW,
	.vssel = MXC_GPIO_VSSEL_VDDIOH,
};

const struct max_uart_init_param max_uart = {
	.vssel = MXC_GPIO_VSSEL_VDDIOH,
};

const struct no_os_spi_init_param adxl_spi = {
	.device_id = 4,
	.max_speed_hz = 1000000,
	.chip_select = 0,
	.mode = NO_OS_SPI_MODE_0,
	.platform_ops = &max_spi_ops,
	.extra = &max_spi,
};

const struct no_os_uart_init_param my_uart = {
	.device_id = 0,
	.baud_rate = 115200,
	.platform_ops = &max_uart_ops,
	.extra = &max_uart,
};

const struct adxl355_init_param my_adxl = {
	.comm_type = ADXL355_SPI_COMM,
	.dev_type = ID_ADXL355,
	.comm_init = { .spi_init = adxl_spi },
};

