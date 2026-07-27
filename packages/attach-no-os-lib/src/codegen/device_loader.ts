import path from "node:path";
import fs from "node:fs";

import type { RulesetDescriptor, RulesetStruct } from "../ruleset_parser/types";
import type { Workfile } from "../workfile_handler/types";
import type { DeviceInfo } from "./types";

import { get_schemas_path } from "../settings/settings";
import { make_string_environment } from "./eta_environment";

// Device init/remove code generation — the one genuinely impure part of codegen.
//
// Every project template is fed the whole workfile and derives what it needs via
// the PURE `_helpers.eta` partial (no filesystem, no resolver). The exception is
// each device's init/remove statement block, whose `.eta` snippets live in the
// EXTERNAL schemas repo and must be read off disk and sub-rendered. That I/O lives
// here in TypeScript and is injected into templates as `it.h.devices(wf)`; the pure
// partial never reaches it.

// The init_param node a descriptor references via its single init_param include.
// Throws (templates have no Result type) on a mis-linked descriptor.
function resolve_init_parameter(
	descriptor: RulesetDescriptor,
	workfile: Workfile,
): { name: string; ruleset: RulesetStruct } {
	const init_parameter = descriptor.properties[0];
	const target_name = init_parameter.value;
	if (typeof target_name !== "string") {
		throw new TypeError(`Descriptor '${descriptor.$id}' has no init_param assigned`);
	}
	if (!(target_name in workfile.symbols)) {
		throw new Error(`Descriptor init_param '${target_name}' not found in workfile`);
	}
	const target = workfile.symbols[target_name];
	if (target?._t !== "RulesetStruct") {
		throw new Error(`Descriptor init_param '${target_name}' is not a struct`);
	}
	return { name: target_name, ruleset: target };
}

// Read a descriptor's init/remove templates from the external schemas repo.
function load_device_templates(descriptor: RulesetDescriptor): { init: string; remove: string } {
	const schemas_path = get_schemas_path();
	if (!schemas_path.ok) {
		throw new Error(schemas_path.error.message);
	}
	// Template filenames are declared on the descriptor and resolved relative to its
	// own schema directory (same dir-adjacency convention as before).
	const directory = path.dirname(descriptor.$id);
	const init_path = path.join(schemas_path.value, directory, descriptor.$init_template);
	const remove_path = path.join(schemas_path.value, directory, descriptor.$remove_template);

	if (!fs.existsSync(init_path) || !fs.existsSync(remove_path)) {
		throw new Error(`Missing templates for descriptor: ${descriptor.$id}`);
	}

	return {
		init: fs.readFileSync(init_path, "utf8"),
		remove: fs.readFileSync(remove_path, "utf8"),
	};
}

// Build the DeviceInfo for one descriptor node: resolve its init_param, read the
// schemas-repo templates, and sub-render them to full statement blocks.
function extract_device_info(
	descriptor_name: string,
	descriptor: RulesetDescriptor,
	workfile: Workfile,
): DeviceInfo {
	const templates = load_device_templates(descriptor);
	const init_parameter = resolve_init_parameter(descriptor, workfile);
	const symbol_name = init_parameter.name;
	const init_parameter_ruleset = init_parameter.ruleset;

	// Device templates receive the descriptor instance name and the init_param
	// instance name (reached in-template as `it.descriptor_name` / `it.symbol_name`).
	// They emit full statement blocks, rendered with the same Eta options as the
	// project-level templates.
	const view = { symbol_name, descriptor_name };
	const environment = make_string_environment();
	const init_code = environment.renderString(templates.init, view).trim();
	const remove_code = environment.renderString(templates.remove, view).trim();

	return {
		symbol_name,
		descriptor_name,
		descriptor_type: descriptor.$symbol,
		init_param_type: init_parameter_ruleset.$symbol,
		header: init_parameter_ruleset.$header ? path.basename(init_parameter_ruleset.$header) : "",
		init_code,
		remove_code,
		capability: init_parameter_ruleset.$capability,
	};
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

// Every descriptor node is a device that is initialized at top level. Returns them
// in init order (prioritized capabilities first). Throws on a half-configured device
// (e.g. an init template with no matching remove template) so it surfaces loudly.
export function load_devices(workfile: Workfile): DeviceInfo[] {
	const result: DeviceInfo[] = [];
	for (const [name, symbol] of Object.entries(workfile.symbols)) {
		if (symbol._t !== "RulesetDescriptor") {
			continue;
		}
		result.push(extract_device_info(name, symbol, workfile));
	}
	return prioritize_devices(result);
}
