import type { NumberProperty, Property } from "../ruleset_parser/types";
import { is_float_symbol } from "../ruleset_parser/types";
import type { Workfile } from "../workfile_handler/types";

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

	if (!is_float_symbol(property.type)) {
		return String(numeric);
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

// An include whose value names a descriptor symbol. Such properties are patched at
// runtime (`desc.x`) rather than emitted in a const initializer.
export function is_descriptor_reference(property: Property, workfile: Workfile): boolean {
	return property._t === "IncludeProperty"
		&& typeof property.value === "string"
		&& workfile.symbols[property.value]?._t === "RulesetDescriptor";
}
