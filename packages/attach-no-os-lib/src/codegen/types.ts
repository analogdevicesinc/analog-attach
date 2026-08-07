import type { Workfile } from "../workfile_handler/types";

export interface DeviceInfo {
	symbol_name: string;       // init param name: "my_accel"
	descriptor_name: string;   // descriptor name: "my_accel_device"
	descriptor_type: string;   // descriptor type: "adxl355_dev"
	init_param_type: string;   // init param type: "adxl355_init_param"
	header: string;            // "adxl355.h"
	init_code: string;         // rendered init.eta (full statement block)
	remove_code: string;       // rendered remove.eta (full statement block)
	capability?: string;       // $capability, e.g. "uart" / "irq"; used for init ordering
};

export interface DescriptorInfo {
	symbol_name: string;       // init param name: "my_spi_ip"
	descriptor_name: string;   // descriptor name: "my_spi"
	descriptor_type: string;   // descriptor type: "no_os_spi_desc"
};

export interface CodegenInput {
	workfile: Workfile;
	platform_name: string;
	platform_vendor: string;
	project_name: string;
	output_path: string;
	noos_path: string;
	// Which template set (folder under codegen/templates, or a path to an
	// out-of-tree folder) renders the project. Omitted: the `template_set`
	// setting, falling back to the bundled default.
	template_set?: string;
};

export interface CodegenResult {
	files_created: string[];
};

// One generated file: which template renders it, where it lands in the project,
// and whether an existing copy is preserved. Every template now receives the same
// whole-workfile context, so there is no per-file view key.
export interface FileSpec {
	template: string;
	output: string;
	protect: boolean;
}
