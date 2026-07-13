import path from "node:path";
import fs from "node:fs";
import Mustache from "mustache";
import { error, ok, Result } from "../ruleset_parser/result";
import { Property, RulesetStruct, UnionProperty } from "../ruleset_parser/types";
import { Workfile } from "../workfile_handler/types";
import { CodegenInput, DescriptorInfo, DeviceInfo, RuntimeAssignment, SourcePaths, StructView, Views } from "./types";
import { create_connections_graph, is_referenced_by_others } from "../validator/connection_graph";
import { ConnectionGraph } from "../validator/types";
import { get_schemas_path } from "../settings/settings";

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
	const ordered_symbols_result = order_symbols(input.workfile);
	if (!ordered_symbols_result.ok) {
		return ordered_symbols_result;
	}
	const ordered_symbols = ordered_symbols_result.value;
	const graph = create_connections_graph(input.workfile);

	// Build struct views - initially mark non-const only for direct descriptor refs
	const struct_views_map = new Map<string, StructView>();
	for (const [name, ruleset] of ordered_symbols) {
		struct_views_map.set(name, build_struct_view(name, ruleset));
	}

	// Propagate non-const through dependencies and collect runtime assignments
	propagate_non_const(struct_views_map, ordered_symbols, graph);

	// Convert to array in dependency order
	const struct_views = ordered_symbols.map(([name]) => struct_views_map.get(name)!);

	// Collect all descriptors (any symbol with $descriptor in schema)
	const descriptors = collect_descriptors(input.workfile);

	// Collect devices that need init/remove code (have templates AND are not referenced by others)
	const devices_result = collect_devices(input.workfile, graph);
	if (!devices_result.ok) {
		return devices_result;
	}
	const devices = devices_result.value;
	// Devices without a $header (e.g. no-OS core peripherals whose header comes in via
	// $sources) contribute an empty string — skip those to avoid emitting #include "".
	const device_includes = devices.map(d => d.header).filter(h => h.length > 0);

	// Collect all header includes for common_data.h
	const all_includes = new Set<string>();
	for (const h of device_includes) {
		all_includes.add(h);
	}
	for (const h of sources.platform.filter(f => f.endsWith(".h"))) {
		all_includes.add(path.basename(h));
	}
	for (const h of sources.include.filter(f => f.endsWith(".h"))) {
		all_includes.add(h);
	}

	// Flatten runtime assignments in dependency order
	const runtime_assignments = struct_views.flatMap(view => view.runtime_assignments);

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
			descriptors: descriptors,
			externs: struct_views.map(view => ({
				type: view.type,
				name: view.name,
				is_const: view.is_const
			}))
		},
		common_data_c: {
			includes: ["common_data.h"],
			structs: struct_views
		},
		main_c: {
			devices: devices,
			// Teardown in reverse init order (LIFO): last initialized is removed first,
			// so prioritized peripherals (e.g. UART) are torn down last.
			devices_reversed: [...devices].reverse(),
			has_runtime_assignments: runtime_assignments.length > 0,
			runtime_assignments: runtime_assignments,
		},
		user_app_h: {},
		user_app_c: {}
	});
};

// Propagate non-const through the dependency graph and update union fields
function propagate_non_const(
	views: Map<string, StructView>,
	ordered_symbols: [string, RulesetStruct][],
	graph: ConnectionGraph
): void {
	// First pass: identify which structs are non-const (have descriptor refs)
	const non_const_set = new Set<string>();
	for (const [name, view] of views) {
		if (!view.is_const) {
			non_const_set.add(name);
		}
	}

	// Propagate: if A references B (via union or include) and B is non-const, A must be non-const
	// We iterate until no changes (fixed point)
	let changed = true;
	while (changed) {
		changed = false;
		for (const [parent, children] of graph) {
			if (non_const_set.has(parent)) {
				continue; // Already non-const
			}
			for (const child of children) {
				if (non_const_set.has(child)) {
					non_const_set.add(parent);
					const view = views.get(parent);
					if (view) {
						view.is_const = false;
					}
					changed = true;
					break;
				}
			}
		}
	}

	// Second pass: for non-const structs, check union fields that reference other non-const structs
	// These unions need runtime assignment instead of compile-time initialization
	for (const [name, ruleset] of ordered_symbols) {
		const view = views.get(name);
		if (!view || view.is_const) {
			continue;
		}

		// Find union properties that reference non-const structs
		for (const property of ruleset.properties) {
			if (property._t !== "UnionProperty" || property.value === undefined) {
				continue;
			}

			const union_prop = property as UnionProperty;
			const value = union_prop.value as Record<string, string>;
			const [member_name, reference] = Object.entries(value)[0];

			// Check if the referenced struct is non-const
			if (non_const_set.has(reference)) {
				// Remove from static fields
				view.fields = view.fields.filter(f => f.name !== property.name);

				// Find the union member to check if it's a pointer
				const member = union_prop.members.find(m => m.name === member_name);
				const is_pointer = member?.pointer ?? false;

				// Add runtime assignment
				view.runtime_assignments.push({
					struct_name: name,
					field_path: `${property.name}.${member_name}`,
					value: is_pointer ? `&${reference}` : reference,
				});
			}
		}
	}
}

function map_noos_path(file_path: string): { variable: "DRIVERS" | "INCLUDE"; path: string } {
	if (file_path.startsWith("include/")) {
		return { variable: "INCLUDE", path: file_path.slice("include/".length) };
	}
	if (file_path.startsWith("drivers/")) {
		return { variable: "DRIVERS", path: file_path.slice("drivers/".length) };
	}
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

function order_symbols(workfile: Workfile): Result<[string, RulesetStruct][]> {
	const graph = create_connections_graph(workfile);
	const in_degree = new Map<string, number>();

	for (const name of graph.keys()) {
		in_degree.set(name, 0);
	}

	for (const [parent, children] of graph) {
		in_degree.set(parent, children.length);
	}

	const queue: string[] = [];
	for (const [name, degree] of in_degree) {
		if (degree === 0) {
			queue.push(name);
		}
	}

	const sorted: string[] = [];

	while (queue.length > 0) {
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

	// Any node not emitted is part of a dependency cycle. Fail loudly instead of
	// silently dropping it (and everything downstream) from the generated project.
	if (sorted.length !== graph.size) {
		const in_cycle = [...graph.keys()].filter(name => !sorted.includes(name));
		return error(`Dependency cycle detected among symbols: ${in_cycle.join(", ")}`);
	}

	const result: [string, RulesetStruct][] = [];
	for (const name of sorted) {
		const ruleset = workfile.symbols[name];
		if (ruleset._t === "RulesetStruct") {
			result.push([name, ruleset]);
		}
	}

	return ok(result);
}

function build_struct_view(name: string, ruleset: RulesetStruct): StructView {
	const runtime_assignments: RuntimeAssignment[] = [];

	const defined_properties = ruleset.properties
		.filter(property => property.value !== undefined && property.value !== null);

	// Descriptor refs need runtime assignment
	const descriptor_properties = defined_properties
		.filter(property => property._t === "IncludeDescriptorProperty");

	for (const property of descriptor_properties) {
		runtime_assignments.push({
			struct_name: name,
			field_path: property.name,
			value: `desc.${property.value}`,
		});
	}

	// Static fields: everything except descriptor refs
	// (Union fields referencing non-const structs will be removed later in propagate_non_const)
	const static_properties = defined_properties
		.filter(property => property._t !== "IncludeDescriptorProperty");

	const has_descriptor_refs = descriptor_properties.length > 0;

	return {
		type: ruleset.$symbol,
		name: name,
		is_const: !has_descriptor_refs,
		fields: static_properties.map(property => ({
			name: property.name,
			c_value: format_c_value(property),
		})),
		runtime_assignments: runtime_assignments,
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

		case "IncludeDescriptorProperty": {
			// This shouldn't be called for descriptor properties (they go to runtime)
			// but keep it for safety
			return `desc.${property.value}`;
		}

		case "PlatformOpsProperty": {
			return `&${property.value}`;
		}

		case "PlatformExtraProperty": {
			return `&${property.value}`;
		}

		case "UnionProperty": {
			const value = property.value as Record<string, string>;
			const [member_name, reference] = Object.entries(value)[0];
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
	const templates = load_device_templates(ruleset.$id);
	if (!templates.ok) {
		return templates;
	}

	const descriptor_name = ruleset.$descriptor_name ?? `${symbol_name}_device`;
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
		capability: ruleset.$capability,
	});
}

function collect_descriptors(workfile: Workfile): DescriptorInfo[] {
	const result: DescriptorInfo[] = [];
	for (const [name, symbol] of Object.entries(workfile.symbols)) {
		if (symbol._t !== "RulesetStruct") {
			continue;
		}
		if (!symbol.$descriptor) {
			continue;
		}
		result.push({
			symbol_name: name,
			descriptor_name: symbol.$descriptor_name ?? `${name}_desc`,
			descriptor_type: symbol.$descriptor,
		});
	}
	return result;
}

function collect_devices(workfile: Workfile, graph: ConnectionGraph): Result<DeviceInfo[]> {
	const rulesets = Object.entries(workfile.symbols);
	const result: DeviceInfo[] = [];
	for (const [name, symbol] of rulesets) {
		if (symbol._t !== "RulesetStruct") {
			continue;
		}

		if (is_referenced_by_others(name, graph)) {
			continue;
		}

		// Not a device (no init template) — normal, skip quietly.
		if (!is_device(symbol.$id)) {
			continue;
		}

		// It IS a device: any failure here is a real error, not a silent skip.
		const device_info = extract_device_info(name, symbol);
		if (!device_info.ok) {
			return device_info;
		}

		result.push(device_info.value);
	}

	return ok(prioritize_devices(result));
}

// Capabilities that must (or should) be initialized before everything else, in order.
// IRQ controller first: any driver registering an interrupt handler (async UART, timers,
// data-ready lines) needs it up. UART next: so logging works during the rest of init.
// Devices without a listed capability keep their original relative order.
const INIT_PRIORITY: string[] = ["irq", "uart"];

function prioritize_devices(devices: DeviceInfo[]): DeviceInfo[] {
	const priority_of = (device: DeviceInfo): number => {
		const index = device.capability ? INIT_PRIORITY.indexOf(device.capability) : -1;
		return index === -1 ? INIT_PRIORITY.length : index;
	};

	// Stable sort: prioritized capabilities float to the front in INIT_PRIORITY order,
	// everything else stays in its existing (workfile) order.
	return devices
		.map((device, index) => ({ device, index }))
		.sort((a, b) => priority_of(a.device) - priority_of(b.device) || a.index - b.index)
		.map(entry => entry.device);
}
