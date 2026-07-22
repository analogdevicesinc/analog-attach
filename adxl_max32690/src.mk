# Auto-generated src.mk
# Do not edit manually

# Sources
SRCS += $(NO-OS)/util/no_os_util.c
SRCS += $(NO-OS)/util/no_os_alloc.c
SRCS += $(NO-OS)/util/no_os_mutex.c
SRCS += $(NO-OS)/util/no_os_list.c
SRCS += $(NO-OS)/util/no_os_lf256fifo.c

SRCS += $(DRIVERS)/api/no_os_dma.c
SRCS += $(DRIVERS)/api/no_os_irq.c
SRCS += $(DRIVERS)/api/no_os_uart.c
SRCS += $(DRIVERS)/api/no_os_gpio.c
SRCS += $(DRIVERS)/accel/adxl355/adxl355.c
SRCS += $(DRIVERS)/api/no_os_i2c.c
SRCS += $(DRIVERS)/api/no_os_spi.c

SRCS += $(PLATFORM_DRIVERS)/maxim_spi.c
SRCS += $(PLATFORM_DRIVERS)/../common/maxim_dma.c
SRCS += $(PLATFORM_DRIVERS)/maxim_irq.c
SRCS += $(PLATFORM_DRIVERS)/maxim_delay.c
SRCS += $(PLATFORM_DRIVERS)/maxim_init.c
SRCS += $(PLATFORM_DRIVERS)/maxim_uart.c
SRCS += $(PLATFORM_DRIVERS)/maxim_uart_stdio.c
SRCS += $(PLATFORM_DRIVERS)/maxim_gpio_irq.c
SRCS += $(PLATFORM_DRIVERS)/maxim_i2c.c
SRCS += $(PLATFORM_DRIVERS)/maxim_gpio.c
SRCS += $(PLATFORM_DRIVERS)/maxim_pwm.c

SRCS += $(PROJECT)/src/main.c
SRCS += $(PROJECT)/src/common/common_data.c
SRCS += $(PROJECT)/src/user_app.c

# Includes
INCS += $(DRIVERS)/accel/adxl355/adxl355.h

INCS += $(INCLUDE)/no_os_dma.h
INCS += $(INCLUDE)/no_os_irq.h
INCS += $(INCLUDE)/no_os_uart.h
INCS += $(INCLUDE)/no_os_gpio.h
INCS += $(INCLUDE)/no_os_pwm.h
INCS += $(INCLUDE)/no_os_i2c.h
INCS += $(INCLUDE)/no_os_spi.h
INCS += $(INCLUDE)/no_os_util.h
INCS += $(INCLUDE)/no_os_alloc.h
INCS += $(INCLUDE)/no_os_mutex.h
INCS += $(INCLUDE)/no_os_error.h
INCS += $(INCLUDE)/no_os_delay.h
INCS += $(INCLUDE)/no_os_print_log.h
INCS += $(INCLUDE)/no_os_units.h
INCS += $(INCLUDE)/no_os_init.h
INCS += $(INCLUDE)/no_os_list.h
INCS += $(INCLUDE)/no_os_lf256fifo.h

INCS += $(PLATFORM_DRIVERS)/maxim_spi.h
INCS += $(PLATFORM_DRIVERS)/../common/maxim_dma.h
INCS += $(PLATFORM_DRIVERS)/maxim_irq.h
INCS += $(PLATFORM_DRIVERS)/maxim_uart.h
INCS += $(PLATFORM_DRIVERS)/maxim_uart_stdio.h
INCS += $(PLATFORM_DRIVERS)/maxim_gpio_irq.h
INCS += $(PLATFORM_DRIVERS)/maxim_i2c.h
INCS += $(PLATFORM_DRIVERS)/maxim_gpio.h
INCS += $(PLATFORM_DRIVERS)/maxim_pwm.h

INCS += $(PROJECT)/src/common/common_data.h
INCS += $(PROJECT)/src/user_app.h
