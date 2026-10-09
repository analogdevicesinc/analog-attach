import type { NumberProperty, Property } from "../ruleset_parser/types";
import { format_number_in } from "../ruleset_parser/number_format";
import { is_float_symbol } from "../ruleset_parser/types";
import type { Workfile } from "../workfile_handler/types";
import type { PostInitBlock } from "./types";
import { IIO_GROUP } from "../registry/drivers";
import { resolve_entry } from "../registry/registry";
import { make_string_environment } from "./eta_environment";
import { resolve_reference } from "../workfile_handler/workfile_handler";

// Typed, reusable property primitives injected into every template under `it.h`.
// These read a single Property with no target-specific (no-OS) knowledge, so they are
// the general vocabulary a template author reaches for. The no-OS-specific assembly
// (struct const-ness, source collection) stays in `_helpers.eta`, which calls these
// via the injected `it.h`.

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
