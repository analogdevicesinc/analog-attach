#ifndef COMMON_DATA_H
#define COMMON_DATA_H

/* Includes */
#include "adxl355.h"
#include "maxim_spi.h"
#include "maxim_dma.h"
#include "maxim_irq.h"
#include "maxim_uart.h"
#include "maxim_uart_stdio.h"
#include "maxim_gpio_irq.h"
#include "maxim_i2c.h"
#include "maxim_gpio.h"
#include "maxim_pwm.h"
#include "no_os_dma.h"
#include "no_os_irq.h"
#include "no_os_uart.h"
#include "no_os_gpio.h"
#include "no_os_pwm.h"
#include "no_os_i2c.h"
#include "no_os_spi.h"

/* Descriptors struct */
struct descriptors {
	struct adxl355_dev *adxl355_dev;
	struct no_os_spi_desc *noos_spi_init_desc;
};

extern struct descriptors desc;

/* Init param externs */
extern const struct max_spi_init_param max_spi_init_param;
extern const struct no_os_spi_init_param noos_spi_init;
extern const struct adxl355_init_param adxl355_init_param;

#endif /* COMMON_DATA_H */
