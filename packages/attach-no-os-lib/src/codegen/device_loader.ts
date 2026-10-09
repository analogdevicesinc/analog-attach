import path from "node:path";
import fs from "node:fs";

import type { RulesetDescriptor } from "../ruleset_parser/types";
import type { ConnectionGraph } from "../validator/types";
import { child_names, create_connections_graph } from "../validator/connection_graph";
import type { Workfile } from "../workfile_handler/types";
import type { DeviceInfo } from "./types";

import { resolve_entry } from "../registry/registry";
import { make_string_environment } from "./eta_environment";

// Device init/remove code generation — the one genuinely impure part of codegen.
//
// Every project template is fed the whole workfile and derives what it needs via
// the PURE `_helpers.eta` partial (no filesystem, no resolver). The exception is
// each device's init/remove statement block, whose `.eta` snippets live in the
// EXTERNAL schemas repo and must be read off disk and sub-rendered. That I/O lives
// here in TypeScript and is injected into templates as `it.h.devices(wf)`; the pure
// partial never reaches it.

// The init_param node a descriptor references via its $init_param include.
// Throws (templates have no Result type) on a mis-linked descriptor.
/**
 * The node a descriptor is brought up from: a config struct in the workfile, or - for a
 * board peripheral's handle - the board extern itself (`capi_spi_init(&ctrl, &bsp_spi1_cfg)`).
 * `type` is the C type either way: the struct's own symbol, or what the extern provides.
 */
function resolve_init_parameter(
	descriptor: RulesetDescriptor,
	workfile: Workfile,
): { name: string; type: string; header?: string } {
	const init_parameter = descriptor.properties[0];
	const target_name = init_parameter.value;
	if (typeof target_name !== "string") {
		throw new TypeError(`Descriptor '${descriptor.$symbol}' has no $init_param assigned`);
	}
	const target = workfile.symbols[target_name];
	if (target === undefined) {
		throw new Error(`Descriptor $init_param '${target_name}' not found in workfile`);
	}
	switch (target._t) {
		case "RulesetStruct": {
			return { name: target_name, type: target.$symbol, ...(target.$header === undefined ? {} : { header: target.$header }) };
		}
		case "RulesetExtern": {
			return { name: target_name, type: target.$provides, ...(target.$header === undefined ? {} : { header: target.$header }) };
		}
		default: {
			throw new Error(`Descriptor $init_param '${target_name}' is neither a struct nor a board/driver extern`);
		}
	}
}

function load_device_templates(descriptor: RulesetDescriptor): { init: string; remove: string } | undefined {
	if (descriptor.$init_template === undefined && descriptor.$remove_template === undefined) {
		return undefined;
	}
	if (descriptor.$init_template === undefined || descriptor.$remove_template === undefined) {
		throw new Error(`Descriptor '${descriptor.$symbol}' declares one of $init_template/$remove_template without the other`);
	}

	// Template filenames are relative to the ruleset file that declared them, which the
	// registry knows: a ruleset is reached by symbol, so nothing else here can say where
	// on disk it came from.
	const entry = resolve_entry(descriptor.$symbol);
	if (!entry.ok) {
		throw new Error(entry.error.message);
	}

	const directory = path.dirname(entry.value.file);
	const init_path = path.join(directory, descriptor.$init_template);
	const remove_path = path.join(directory, descriptor.$remove_template);

	if (!fs.existsSync(init_path) || !fs.existsSync(remove_path)) {
		throw new Error(`Missing templates for descriptor: ${descriptor.$symbol}`);
	}

	return {
		init: fs.readFileSync(init_path, "utf8"),
		remove: fs.readFileSync(remove_path, "utf8"),
	};
}

// Build the DeviceInfo for one descriptor node: resolve its $init_param, read the
// schemas-repo templates, and sub-render them to full statement blocks.
function extract_device_info(
	descriptor_name: string,
	descriptor: RulesetDescriptor,
	workfile: Workfile,
): DeviceInfo {
	const templates = load_device_templates(descriptor);
	const init_parameter = resolve_init_parameter(descriptor, workfile);
	const symbol_name = init_parameter.name;

	// Device templates receive the descriptor instance name and the init_param
	// instance name (reached in-template as `it.descriptor_name` / `it.symbol_name`).
	// They emit full statement blocks, rendered with the same Eta options as the
	// project-level templates.
	const view = { symbol_name, descriptor_name };
	const environment = templates === undefined ? undefined : make_string_environment();

	return {
		symbol_name,
		descriptor_name,
		descriptor_type: descriptor.$symbol,
		handle_type: descriptor.$handle ?? `${descriptor.$symbol}_handle`,
		init_param_type: init_parameter.type,
		header: init_parameter.header === undefined ? "" : path.basename(init_parameter.header),
		init_function: descriptor.$init_function,
		remove_function: descriptor.$remove_function,
		init_code: environment && templates ? environment.renderString(templates.init, view).trim() : undefined,
		remove_code: environment && templates ? environment.renderString(templates.remove, view).trim() : undefined,
	};
}

// Capabilities that must (or should) be initialized before everything else, in order.
// IRQ controller first: any driver registering an interrupt handler (async UART, timers,
// data-ready lines) needs it up. UART next: so logging works during the rest of init.
// Devices without a listed capability keep their original relative order.
/** Every descriptor `name` reaches through its references, of any kind, in any number of steps. */
function reached_descriptors(name: string, graph: ConnectionGraph, workfile: Workfile): Set<string> {
	const reached = new Set<string>();
	const seen = new Set<string>([name]);
	const pending = [...child_names(graph, name)];
	for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
		if (seen.has(next)) {
			continue;
		}
		seen.add(next);
		if (workfile.symbols[next]?._t === "RulesetDescriptor") {
			reached.add(next);
		}
		pending.push(...child_names(graph, next));
	}
	return reached;
}

/**
 * Init order: a device after every handle it reaches. The ADXL355's handle reaches, through
 * its config, init_param and SPI device, the SPI controller and the chip-select's GPIO port,
 * so those come first. Otherwise workfile order is kept, so the order is stable.
 */
function order_devices(devices: DeviceInfo[], workfile: Workfile): DeviceInfo[] {
	const graph = create_connections_graph(workfile);
	const names = new Set(devices.map(device => device.descriptor_name));
	const needs = new Map(devices.map(device => [
		device.descriptor_name,
		[...reached_descriptors(device.descriptor_name, graph, workfile)].filter(name => names.has(name)),
	]));

	const ordered: DeviceInfo[] = [];
	const placed = new Set<string>();
	while (ordered.length < devices.length) {
		const next = devices.find(device => !placed.has(device.descriptor_name)
			&& (needs.get(device.descriptor_name) ?? []).every(name => placed.has(name)));
		if (next === undefined) {
			const stuck = devices.filter(device => !placed.has(device.descriptor_name)).map(device => device.descriptor_name);
			throw new Error(`Devices reach each other in a loop, so none can be brought up first: ${stuck.join(", ")}`);
		}
		ordered.push(next);
		placed.add(next.descriptor_name);
	}
	return ordered;
}

export function load_devices(workfile: Workfile): DeviceInfo[] {
	const result: DeviceInfo[] = [];
	for (const [name, symbol] of Object.entries(workfile.symbols)) {
		if (symbol._t !== "RulesetDescriptor") {
			continue;
		}
		result.push(extract_device_info(name, symbol, workfile));
	}
	return order_devices(result, workfile);
}
