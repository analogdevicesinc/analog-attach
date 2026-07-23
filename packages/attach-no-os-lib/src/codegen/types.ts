import type { Workfile } from "../workfile_handler/types";

export interface DeviceInfo {
	symbol_name: string;       // init param name: "my_accel"
	descriptor_name: string;   // descriptor name: "my_accel_device"
	descriptor_type: string;   // descriptor type: "adxl355_dev"
	init_param_type: string;   // init param type: "adxl355_init_param"
	header: string;            // "adxl355.h"
	init_code: string;         // rendered init.njk (full statement block)
	remove_code: string;       // rendered remove.njk (full statement block)
	capability?: string;       // $capability, e.g. "uart" / "irq"; used for init ordering
};

export interface DescriptorInfo {
	symbol_name: string;       // init param name: "my_spi_ip"
	descriptor_name: string;   // descriptor name: "my_spi"
	descriptor_type: string;   // descriptor type: "no_os_spi_desc"
};

export interface SourcePaths {
	drivers: string[];   // $(DRIVERS)/...
	include: string[];   // $(INCLUDE)/...
	platform: string[];  // $(PLATFORM_DRIVERS)/...
};

export interface CodegenInput {
	workfile: Workfile;
	platform_name: string;
	platform_vendor: string;
	project_name: string;
	output_path: string;
	noos_path: string;
};

export interface CodegenResult {
	files_created: string[];
};

// Runtime assignment for fields that can't be set at compile time
export interface RuntimeAssignment {
	struct_name: string;       // "my_spi_ip" or "adxl355_node"
	field_path: string;        // "parent" or "comm_init.spi_init"
	value: string;             // "desc.even_better_spi_desc" or "my_spi_ip"
};

export interface StructView {
	type: string;              // "no_os_spi_init_param"
	name: string;              // "no_os_spi_ip"
	is_const: boolean;         // false if needs runtime assignments (direct or transitive)
	fields: {
		name: string;            // "device_id"
		c_value: string;         // "1" or "&max_spi_ops"
	}[];
	runtime_assignments: RuntimeAssignment[];  // Fields set at runtime in main()
};

// All the variables exported for the templates
export interface Views {
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
		descriptors: DescriptorInfo[];
		externs: { type: string; name: string; is_const: boolean }[];
	};
	common_data_c: {
		includes: string[];
		structs: StructView[];
	};
	main_c: {
		devices: DeviceInfo[];              // teardown reversal done in-template via `| reverse`
		runtime_assignments: RuntimeAssignment[];
	};
	user_app_h: object;
	user_app_c: object;
};
