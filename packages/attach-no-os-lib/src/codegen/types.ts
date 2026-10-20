import type { BoardInfo } from "../registry/types";
import type { Workfile } from "../workfile_handler/types";

export interface DeviceInfo {
	symbol_name: string;       // init param name: "my_accel"
	descriptor_name: string;   // descriptor name: "my_accel_device"
	descriptor_type: string;   // descriptor ruleset symbol: "capi_spi_controller"
	handle_type: string;       // C struct of the handle: "capi_spi_controller_handle"
	init_param_type: string;   // init param type: "adxl355_init_param"
	header: string;            // "adxl355.h"
	init_function: string;     // $init_function, e.g. "capi_spi_init"
	remove_function: string;   // $remove_function, e.g. "capi_spi_deinit"
	// Rendered $init_template / $remove_template (full statement blocks), when the
	// descriptor carries them. A descriptor whose bring-up is the ordinary
	// `init(&handle, &config)` / `deinit(handle)` shape declares no templates, and the
	// target renders the call from the two function names instead.
	init_code?: string;
	remove_code?: string;
};

export interface CodegenInput {
	workfile: Workfile;
	platform_name: string;
	platform_vendor: string;
	// The board the project builds for, resolved from a platform module's declared board
	// list. Required here even though `Workfile.board` is optional: resolution (explicit
	// choice, or the single board matching the chip) happens before codegen, so templates
	// never have to handle a missing board.
	board: BoardInfo;
	project_name: string;
	// The project's own directory: the files are written straight into it.
	project_path: string;
	capi_path: string;
	// Which template set (folder under codegen/templates, or a path to an
	// out-of-tree folder) renders the project. Omitted: the `template_set`
	// setting, falling back to the bundled default.
	template_set?: string;
	// Whether main.c runs the parts' examples (the default) or the user's app_main().
	example?: boolean;
};

/** One handle's example code, rendered for it: `setup` once, `loop` on every pass. */
export interface ExampleBlock {
	/** The handle node it reads, e.g. adxl355. */
	handle: string,
	/** The driver whose example it is. */
	driver: string,
	setup?: string,
	/** Empty for a setup-only block. */
	loop: string,
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
	// The base set, for a template the set carries itself: what its partials fall back to
	// (`include("./_helpers")` from a variant main.c reaches the base set's helpers).
	fallback?: string;
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
/** A rendered `$post_init` block, for one node bound to the field that declares it. */
export interface PostInitBlock {
	/** The bound node: the block runs once it is ready. */
	node: string;
	/** Complete C statements. */
	code: string;
}

export interface PatchSchedule {
	before: RuntimeAssignment[];
	after: Map<string, RuntimeAssignment[]>;
	/** Post-init blocks, by the same slots: after that slot's patches. */
	post_init_before: PostInitBlock[];
	post_init_after: Map<string, PostInitBlock[]>;
}
