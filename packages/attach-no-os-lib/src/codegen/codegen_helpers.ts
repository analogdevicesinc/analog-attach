import type { NumberProperty, Property } from "../ruleset_parser/types";
import { format_number_in } from "../ruleset_parser/number_format";
import { is_float_symbol } from "../ruleset_parser/types";
import type { Workfile } from "../workfile_handler/types";
import fs from "node:fs";
import type { ExampleBlock, PostInitBlock } from "./types";
import { IIO_GROUP } from "../registry/drivers";
import { resolve_entry } from "../registry/registry";
import type { ModuleInfo } from "../registry/types";
import { make_string_environment } from "./eta_environment";
import { resolve_reference } from "../workfile_handler/workfile_handler";

// Typed, reusable property primitives injected into every template under `it.h`.
// These read a single Property with no target-specific knowledge, so they are the general
// vocabulary a template author reaches for. The target-specific assembly (struct views,
// source collection) stays in the template set's `_helpers.eta`, which calls these via
// the injected `it.h`.

// A scalar property's declared default, or undefined for shapes that have none.
export function property_default(property: Property): unknown {
	switch (property._t) {
		case "NumberProperty":
		case "StringProperty":
		case "EnumProperty":
		case "BooleanProperty":
		case "RawProperty": {
			return property.default;
		}
		default: {
			return undefined;
		}
	}
}

// The value a property resolves to: its explicit value if set, otherwise its default.
export function effective_value(property: Property): unknown {
	if (property.value !== undefined && property.value !== null) {
		return property.value;
	}
	return property_default(property);
}

// The C literal for one numeric value, given the property that types it.
//
// Integers print as-is. Floats always carry a decimal point, so a whole value
// stays a floating-point token (`1.0`, not `1`) — this matters where the token is
// used in an expression, since `1 / 2` is integer division in C while `1.0 / 2`
// is not. `float` additionally takes the `f` suffix: an unsuffixed literal is a
// `double` in C, and assigning it to a `float` field costs an implicit narrowing
// conversion that -Wfloat-conversion flags.
//
// Exponent notation from JS (`1e+30`) is already a valid C literal; the `e` form
// counts as having a decimal point for our purposes, so it is left alone.
// Takes `unknown` because the callers hand over a raw property/array value: array
// elements in particular arrive as strings from the CLI, which stores them
// unparsed. Anything that is not a finite number is passed through verbatim rather
// than decorated — the validator is what reports it, codegen does not second-guess.
export function number_literal(value: unknown, property: NumberProperty): string {
	const numeric = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(numeric) || (typeof value === "string" && value.trim() === "")) {
		return String(value);
	}

	// Integers print in the radix the field declares: `.address = 0x1D` rather than 29.
	if (!is_float_symbol(property.type)) {
		return format_number_in(numeric, property.format);
	}

	let text = String(numeric);
	if (!text.includes(".") && !text.includes("e") && !text.includes("E")) {
		text += ".0";
	}

	return property.type === "float" ? `${text}f` : text;
}

// A pointer include with no value resolves to NULL rather than being omitted.
export function is_null_pointer(property: Property): boolean {
	return property._t === "IncludeProperty"
		&& property.pointer === true
		&& effective_value(property) === undefined;
}

// An include whose value is reached through a descriptor, either naming one outright
// ("irq_ctrl") or a member of one ("accel_iio.iio_dev"). Such properties are patched at
// runtime rather than emitted in a const initializer, because a descriptor does not exist
// until its init has run.
export function is_descriptor_reference(property: Property, workfile: Workfile): boolean {
	if (property._t !== "IncludeProperty" || typeof property.value !== "string") {
		return false;
	}

	return resolve_reference(workfile, property.value)?.runtime === true;
}

// The C expression a reference-valued property emits, with `&` added when the property
// declares a pointer but the thing referenced is a value. Descriptors are already pointers,
// so a whole-descriptor reference never takes an address.
export function reference_expression(property: Property, workfile: Workfile): string | undefined {
	if (property._t !== "IncludeProperty" || typeof property.value !== "string") {
		return undefined;
	}

	const target = resolve_reference(workfile, property.value);
	if (!target) {
		return undefined;
	}

	return property.pointer === true && !target.pointer ? `&${target.expr}` : target.expr;
}

/**
 * Every `$post_init` block to emit: for each field that declares one, rendered once per node
 * bound to it, with `it.target` (the node as an argument: `&pin`, or a handle as it is),
 * `it.node`, `it.owner` and `it.field`. The same block on the same node twice is one block.
 */
export function post_init_blocks(workfile: Workfile): PostInitBlock[] {
	const environment = make_string_environment();
	const blocks: PostInitBlock[] = [];

	for (const [owner, node] of Object.entries(workfile.symbols)) {
		if (node._t !== "RulesetStruct" && node._t !== "RulesetDescriptor") {
			continue;
		}
		for (const property of node.properties) {
			if (property.post_init === undefined || property._t !== "IncludeProperty") {
				continue;
			}
			const bound = Array.isArray(property.value) ? property.value : [property.value];
			for (const target of bound) {
				if (typeof target !== "string") {
					continue;
				}
				const expression = reference_expression({ ...property, value: target }, workfile) ?? `&${target}`;
				const code = environment.renderString(property.post_init, { target: expression, node: target, owner, field: property.name }).trim();
				if (!blocks.some(block => block.node === target && block.code === code)) {
					blocks.push({ node: target, code });
				}
			}
		}
	}

	return blocks;
}

/**
 * The example code of every handle a driver with an `example:` backs, in workfile order. A
 * handle belongs to the driver whose struct or ops table its config names, so a channel
 * handle gets its chip's example too; `it.symbol` (capi_adc, capi_adc_chan) tells them
 * apart. An IIO handle is served by the IIO app instead, so it has none. A `loop` that
 * renders empty leaves a setup-only block (set a DAC output once).
 */
export function example_blocks(workfile: Workfile): ExampleBlock[] {
	const environment = make_string_environment();
	const sources = new Map<string, string>();
	const read = (file: string): string => {
		let source = sources.get(file);
		if (source === undefined) {
			source = fs.readFileSync(file, "utf8");
			sources.set(file, source);
		}
		return source;
	};

	const blocks: ExampleBlock[] = [];
	for (const [handle, node] of Object.entries(workfile.symbols)) {
		if (node._t !== "RulesetDescriptor") {
			continue;
		}
		const own = resolve_entry(node.$symbol);
		if (own.ok && own.value.group === IIO_GROUP) {
			continue;
		}
		const driver = backing_driver(workfile, node.properties[0].value);
		if (driver?.example === undefined) {
			continue;
		}
		// A template renders nothing for a handle it has nothing to show on (ad74413r: the
		// chip handles, where only its channels read anything), and that handle is skipped.
		const view = { handle, symbol: node.$symbol };
		const setup = driver.example.setup === undefined ? "" : environment.renderString(read(driver.example.setup), view).trim();
		const loop = environment.renderString(read(driver.example.loop), view).trim();
		if (setup === "" && loop === "") {
			continue;
		}
		blocks.push({ handle, driver: driver.name, ...(setup === "" ? {} : { setup }), loop });
	}
	return blocks;
}

/** The driver module a handle's config names through its driver-backed fields. */
function backing_driver(workfile: Workfile, config_name: unknown): ModuleInfo | undefined {
	const config = typeof config_name === "string" ? workfile.symbols[config_name] : undefined;
	if (config?._t !== "RulesetStruct") {
		return undefined;
	}
	for (const property of config.properties) {
		if ((property._t !== "DriverInitParameterProperty" && property._t !== "DriverOpsProperty") || typeof property.value !== "string") {
			continue;
		}
		const target = workfile.symbols[property.value];
		const entry = target === undefined ? undefined : resolve_entry(target.$symbol);
		if (entry?.ok === true && entry.value.module.type === "driver") {
			return entry.value.module;
		}
	}
	return undefined;
}

/** An IIO device the app serves: its handle, and the handle member holding its device table. */
export interface IioDevice {
	/** The handle node; also the name the device is served under. */
	name: string,
	/** The readonly member that points at a capi_iio_device (`iio_dev`). */
	table: string,
}

/** The C type every IIO handle points its device table at. */
const IIO_DEVICE_TABLE = "capi_iio_device";

/**
 * Every handle from a driver's `iio` group, in workfile order. The device table member is
 * found by what it points at, so no member name is assumed.
 */
export function iio_devices(workfile: Workfile): IioDevice[] {
	return Object.entries(workfile.symbols).flatMap(([name, node]) => {
		if (node._t !== "RulesetDescriptor") {
			return [];
		}
		const entry = resolve_entry(node.$symbol);
		if (!entry.ok || entry.value.group !== IIO_GROUP) {
			return [];
		}
		const table = node.properties.find(property => property._t === "IncludeProperty"
			&& property.readonly === true && property.include === IIO_DEVICE_TABLE);
		return table === undefined ? [] : [{ name, table: table.name }];
	});
}
