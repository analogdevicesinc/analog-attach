import type { Board, Workfile } from "../workfile_handler/types";

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
	// The board the project builds for, resolved from a no-OS CMake preset. Required
	// here even though `Workfile.board` is optional: resolution (explicit choice, or
	// the single board matching the chip) happens before codegen, so templates never
	// have to handle a missing board.
	board: Board;
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
//
// `directory` is the template set the template was actually found in, which is the
// set itself unless it declared `extends` and does not carry that template. It is
// also the Eta views root the file renders with, so a borrowed template resolves
// `include("./_helpers")` inside the set that owns it rather than the one that
// borrowed it.
export interface FileSpec {
	template: string;
	output: string;
	protect: boolean;
	directory: string;
}

// One `<struct_name>.<field_path> = <value>;` line main() emits, because the value is
// only known at runtime and so cannot sit in a file-scope initializer.
//
// `source` is the symbol the value is READ from - `desc.parent_spi` reads `parent_spi`,
// `&spi_extra` reads `spi_extra` - and is what decides where the line may go. A template
// builds these; `schedule_patches` places them.
export interface RuntimeAssignment {
	struct_name: string;
	field_path: string;
	value: string;
	source: string;
}

// Where each patch goes: `before` runs ahead of every init, and `after` maps a
// descriptor name to the patches that must follow that descriptor's init.
export interface PatchSchedule {
	before: RuntimeAssignment[];
	after: Map<string, RuntimeAssignment[]>;
}
