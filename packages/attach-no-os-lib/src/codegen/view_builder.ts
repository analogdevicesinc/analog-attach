import path from "node:path";
import fs from "node:fs";
import Mustache from "mustache";
import { error, ok, Result } from "../ruleset_parser/result";
import { Property, RulesetStruct } from "../ruleset_parser/types";
import { Workfile } from "../workfile_handler/types";
import { CodegenInput, DeviceInfo, SourcePaths, StructView, Views } from "./types";
import { create_connections_graph } from "../validator/connection_graph";
import { get_schemas_path } from "../settings/settings";

// FIXME: I am really not sure where these should go to be good for the project
// Core no-OS utilities that most projects need
const CORE_UTIL_SRCS = [
	"util/no_os_util.c",
	"util/no_os_alloc.c",
	"util/no_os_mutex.c",
	"util/no_os_list.c",
];

const CORE_UTIL_INCS = [
	"no_os_util.h",
	"no_os_alloc.h",
	"no_os_mutex.h",
	"no_os_error.h",
	"no_os_delay.h",
	"no_os_print_log.h",
	"no_os_units.h",
	"no_os_init.h",
	"no_os_list.h",
	"no_os_lf256fifo.h",
];

export function build_views(input: CodegenInput): Result<Views> {
	const sources = collect_sources(input.workfile);
	const ordered_symbols = order_symbols(input.workfile);
	// Both structs and devices produce struct views (devices are also C structs)
	const struct_views = ordered_symbols.map(([name, ruleset]) => build_struct_view(name, ruleset));

	const devices = collect_devices(input.workfile);
	const device_includes = devices.map(d => d.header);

	// Collect all header includes for common_data.h
	const all_includes = new Set<string>();
	// Add device headers
	for (const h of device_includes) {
		all_includes.add(h);
	}
	// Add platform headers (basename only)
	for (const h of sources.platform.filter(f => f.endsWith(".h"))) {
		all_includes.add(path.basename(h));
	}
	// Add no-os headers from INCLUDE
	for (const h of sources.include.filter(f => f.endsWith(".h"))) {
		all_includes.add(h);
	}

	return ok({
		makefile: {
			project_name: input.project_name,
			platform_vendor: input.platform_vendor,
			platform_name: input.platform_name,
			noos_path: input.noos_path
		},
		src_mk: {
			drivers_srcs: sources.drivers.filter(file => file.endsWith(".c")),
			drivers_incs: sources.drivers.filter(file => file.endsWith(".h")),
			include_incs: [...new Set([...sources.include.filter(file => file.endsWith(".h")), ...CORE_UTIL_INCS])],
			util_srcs: CORE_UTIL_SRCS,
			platform_srcs: sources.platform.filter(file => file.endsWith(".c")),
			platform_incs: sources.platform.filter(file => file.endsWith(".h")),
			project_srcs: ["src/main.c", "src/common/common_data.c", "src/user_app.c"],
			project_incs: ["src/common/common_data.h", "src/user_app.h"],
		},
		common_data_h: {
			includes: [...all_includes],
			devices: devices,
			externs: ordered_symbols.map(([name, ruleset]) => ({
				type: ruleset.$symbol,
				name: name
			}))
		},
		common_data_c: {
			includes: ["common_data.h"],
			structs: struct_views
		},
		main_c: {
			devices: devices,
		},
		user_app_h: {},
		user_app_c: {}
	});
};

function map_noos_path(file_path: string): { variable: "DRIVERS" | "INCLUDE"; path: string } {
	if (file_path.startsWith("include/")) {
		return { variable: "INCLUDE", path: file_path.slice("include/".length) };
	}
	if (file_path.startsWith("drivers/")) {
		return { variable: "DRIVERS", path: file_path.slice("drivers/".length) };
	}
	// Fallback - shouldn't happen with well-formed schemas
	return { variable: "DRIVERS", path: file_path };
}

function collect_sources(workfile: Workfile): SourcePaths {
	const drivers = new Set<string>();
	const include = new Set<string>();
	const platform = new Set<string>();

	const all_rulesets = [
		...Object.values(workfile.platform_ops),
		...Object.values(workfile.symbols),
	];

	for (const ruleset of all_rulesets) {
		if (!ruleset.$sources) {
			continue;
		}

		for (const file of ruleset.$sources.noos ?? []) {
			const mapped = map_noos_path(file);
			if (mapped.variable === "INCLUDE") {
				include.add(mapped.path);
			} else {
				drivers.add(mapped.path);
			}
		}

		for (const file of ruleset.$sources.platform ?? []) {
			platform.add(file);
		}

		// Merge $header into appropriate set (for device schemas)
		if (ruleset._t === "RulesetStruct" && ruleset.$header) {
			const mapped = map_noos_path(ruleset.$header);
			if (mapped.variable === "INCLUDE") {
				include.add(mapped.path);
			} else {
				drivers.add(mapped.path);
			}
		}
	}

	return {
		drivers: [...drivers],
		include: [...include],
		platform: [...platform],
	};
}

function order_symbols(workfile: Workfile): [string, RulesetStruct][] {
	// NOTE: graph: parent -> children it references
	// For topological sort, we need: if A references B, B comes first
	// So in_degree counts how many symbols references this one
	// This is just to reuse some logic
	const graph = create_connections_graph(workfile);

	const in_degree = new Map<string, number>();

	for (const name of graph.keys()) {
		in_degree.set(name, 0);
	}

	for (const [parent, children] of graph) {
		in_degree.set(parent, children.length);
	}

	// Kahn's algorithm - start with nodes nobody depends on (leaves)
	const queue: string[] = [];
	for (const [name, degree] of in_degree) {
		if (degree === 0) {
			queue.push(name);
		}
	}

	const sorted: string[] = [];

	while (queue.length > 0) {
		// NOTE: Added ! at the end because if we get to this point, queue is
		// obviously not empty (q.len > 0) so the return value | undefined is
		// actually just value
		const name = queue.shift()!;
		sorted.push(name);

		for (const [parent, children] of graph) {
			if (children.includes(name)) {
				const new_degree = (in_degree.get(parent) ?? 1) - 1;
				in_degree.set(parent, new_degree);
				if (new_degree === 0) {
					queue.push(parent);
				}
			}
		}
	}

	const result: [string, RulesetStruct][] = [];
	for (const name of sorted) {
		const ruleset = workfile.symbols[name];
		if (ruleset._t === "RulesetStruct") {
			result.push([name, ruleset]);
		}
	}

	return result;
}

function build_struct_view(name: string, ruleset: RulesetStruct): StructView {
	return {
		type: ruleset.$symbol,
		name: name,
		fields: ruleset.properties
			.filter(property => property.value !== undefined && property.value !== null)
			.map(property => ({
				name: property.name,
				c_value: format_c_value(property),
		})),
	};
}

function format_c_value(property: Property): string {
	switch (property._t) {
		case "NumberProperty": {
			return String(property.value);
		}

		case "BooleanProperty": {
			return property.value ? "true" : "false";
		}

		case "EnumProperty": {
			return String(property.value);
		}

		case "StringProperty": {
			return `"${property.value}"`;
		}

		case "IncludeProperty": {
			return property.pointer ? `&${property.value}` : String(property.value);
		}

		case "PlatformOpsProperty": {
			return `&${property.value}`;
		}

		case "PlatformExtraProperty": {
			return `&${property.value}`;
		}

		case "UnionProperty": {
			// value: { spi_init: "no_os_spi_ip" }
			const value = property.value as Record<string, string>;
			const [member_name, reference] = Object.entries(value)[0];
			// Find the union member to check if it's a pointer
			const member = property.members.find(member => member.name === member_name);
			const is_pointer = member?.pointer ?? false;
			return is_pointer
				? `{ .${member_name} = &${reference} }`
				: `{ .${member_name} = ${reference} }`;
		}

		case "ArrayProperty": {
			if (!Array.isArray(property.value) || property.value.length === 0) {
				return "{ 0 }";
			}

			const element_type = property.element._t;
			const formatted = property.value.map(value => {
				switch (element_type) {
					case "NumberProperty": {
						return String(value);
					}
					case "BooleanProperty": {
						return value ? "true" : "false";
					}
					case "EnumProperty": {
						return String(value);
					}
					case "IncludeProperty": {
						return property.element.pointer ? `&${value}` : String(value);
					}
					default: {
						return String(value);
					}
				}
			});

			return `{ ${formatted.join(", ")} }`;
		}

		case "CallbackFunctionProperty": {
			return property.value ? String(property.value) : "NULL";
		}

		case "CallbackContextProperty": {
			return property.value ? String(property.value) : "NULL";
		}

		default: {
			return "/* unknown */";
		}
	}
}

function is_device(schema_id: string): boolean {
	const schemas_path = get_schemas_path();
	if (!schemas_path.ok) {
		return false;
	}
	const directory = path.dirname(schema_id);
	const init_path = path.join(schemas_path.value, directory, "init.mustache");
	return fs.existsSync(init_path);
}

function load_device_templates(schema_id: string): Result<{ init: string; remove: string }> {
	const schemas_path = get_schemas_path();
	if (!schemas_path.ok) {
		return schemas_path;
	}
	const directory = path.dirname(schema_id);
	const init_path = path.join(schemas_path.value, directory, "init.mustache");
	const remove_path = path.join(schemas_path.value, directory, "remove.mustache");

	if (!fs.existsSync(init_path) || !fs.existsSync(remove_path)) {
		return error(`Missing templates for id: ${schema_id}`);
	}

	return ok({
		init: fs.readFileSync(init_path, "utf8"),
		remove: fs.readFileSync(remove_path, "utf8"),
	});
}

function extract_device_info(symbol_name: string, ruleset: RulesetStruct): Result<DeviceInfo> {
	if (!is_device(ruleset.$id)) {
		return error(`Symbol ${symbol_name} is not a device. (missing init templates)`);
	}

	const templates = load_device_templates(ruleset.$id);
	if (!templates.ok) {
		return templates;
	}

	const descriptor_name = `${symbol_name}_device`;
	const view = { symbol_name, descriptor_name };
	const init_code = Mustache.render(templates.value.init, view).trim();
	const remove_code = Mustache.render(templates.value.remove, view).trim();

	return ok({
		symbol_name,
		descriptor_name,
		descriptor_type: ruleset.$descriptor ?? "",
		init_param_type: ruleset.$symbol,
		header: ruleset.$header ? path.basename(ruleset.$header) : "",
		init_code,
		remove_code,
	});
}

function collect_devices(workfile: Workfile): DeviceInfo[] {
	const rulesets = Object.entries(workfile.symbols);
	let result: DeviceInfo[] = [];
	for (const [name, symbol] of rulesets) {
		if (symbol._t !== "RulesetStruct") {
			continue;
		}

		const device_info = extract_device_info(name, symbol);
		if (!device_info.ok) {
			// FIXME: For now just continue on fail, maybe an error or warning would be nice
			continue;
		}

		result.push(device_info.value);
	}

	return result;
}
