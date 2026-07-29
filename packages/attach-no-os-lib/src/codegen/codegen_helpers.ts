import type { Property } from "../ruleset_parser/types";
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
