#include "no_os_error.h"
#include "common/common_data.h"
#include "user_app.h"

int main(void)
{
	int ret;

	// Init devices and structures
	ret = no_os_uart_init(&desc.my_uart_desc, &my_uart);
	if (ret)
		return ret;

	ret = adxl355_init(&desc.my_adxl_desc, my_adxl);
	if (ret)
		return ret;

	user_app(&desc);

	adxl355_remove(desc.my_adxl_desc);
	no_os_uart_remove(desc.my_uart_desc);

	return 0;
}
