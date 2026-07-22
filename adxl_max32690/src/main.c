#include "no_os_error.h"
#include "common/common_data.h"
#include "user_app.h"

int main(void)
{
	int ret;

	// Init devices and structures
	ret = adxl355_init(&desc.adxl355_dev, adxl355_init_param);
	if (ret)
		return ret;

	user_app(&desc);

	adxl355_remove(desc.adxl355_dev);

	return 0;
}
