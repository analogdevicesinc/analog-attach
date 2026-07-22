#include "common_data.h"

struct descriptors desc = { 0 };

const struct max_spi_init_param max_spi_init_param = {
	.num_slaves = 1,
	.polarity = SPI_SS_POL_LOW,
	.vssel = MXC_GPIO_VSSEL_VDDIOH,
};

const struct no_os_spi_init_param noos_spi_init = {
	.device_id = 4,
	.chip_select = 0,
	.platform_ops = &max_spi_ops,
	.extra = &max_spi_init_param,
};

const struct adxl355_init_param adxl355_init_param = {
	.comm_type = ADXL355_SPI_COMM,
	.dev_type = ID_ADXL355,
	.comm_init = { .spi_init = noos_spi_init },
};

