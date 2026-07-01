import { Workfile } from "../workfile_handler/types";

export type DeviceInfo = {
	symbol_name: string;       // init param name: "my_accel"
	descriptor_name: string;   // descriptor name: "my_accel_device"
	descriptor_type: string;   // descriptor type: "adxl355_dev"
	init_param_type: string;   // init param type: "adxl355_init_param"
	header: string;            // "adxl355.h"
	init_code: string;         // rendered init.mustache
	remove_code: string;       // rendered remove.mustache
};

export type SourcePaths = {
	drivers: string[];   // $(DRIVERS)/...
	include: string[];   // $(INCLUDE)/...
	platform: string[];  // $(PLATFORM_DRIVERS)/...
};

export type CodegenInput = {
	workfile: Workfile;
	platform_name: string;
	platform_vendor: string;
	project_name: string;
	output_path: string;
	noos_path: string;
};

export type CodegenResult = {
	files_created: string[];
};

export type StructView = {
  type: string;              // "no_os_spi_init_param"
  name: string;              // "no_os_spi_ip"
  fields: {
    name: string;            // "device_id"
    c_value: string;         // "1" or "&max_spi_ops" or "{ .spi_init = &no_os_spi_ip }"
  }[];
};

// All the variables exported for the templates
export type Views = {
	makefile: {
		project_name: string;
		platform_vendor: string;
		platform_name: string;
		noos_path: string;
	};
	src_mk: {
		drivers_srcs: string[];
		drivers_incs: string[];
		include_incs: string[];
		util_srcs: string[];
		platform_srcs: string[];
		platform_incs: string[];
		project_srcs: string[];
		project_incs: string[];
	};
	common_data_h: {
		includes: string[];
		devices: DeviceInfo[];
		externs: { type: string; name: string }[];
	};
	common_data_c: {
		includes: string[];
		structs: StructView[];
	};
	main_c: {
		devices: DeviceInfo[];
	};
	user_app_h: {};
	user_app_c: {};
};
