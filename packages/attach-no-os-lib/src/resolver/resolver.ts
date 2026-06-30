import fs from "node:fs";
import path from "node:path";
import { error, ok, Result } from "../bindings_parser/result";
import { parse_binding } from "../bindings_parser/binding_parser";
import { EnumProperty, Property, Ruleset } from "../bindings_parser/types";
import { get_schemas_path } from "../settings/settings";

function load_binding(binding_path: string): Result<Ruleset> {
	const schemas_path = get_schemas_path();
	if (!schemas_path) {
		return error("Schemas path not configured. Call set_schemas_path() first.", "schemas_path");
	}

	const full_path = path.join(schemas_path, binding_path);
	try {
		const content = fs.readFileSync(full_path, "utf8");
		return parse_binding(content);
	} catch {
		return error(`Failed to load binding: ${full_path}`, binding_path);
	}
}

export function resolve_ruleset(ruleset: Ruleset): Result<Ruleset> {
	if (ruleset._t !== "BindingStuct" && ruleset._t !== "BindingDevice") {
		return ok(ruleset);
	}

	const resolved_properties: Property[] = [];
	for (const property of ruleset.properties) {
		const resolved = resolve_property(property);
		if (!resolved.ok) {
			return resolved;
		}
		resolved_properties.push(resolved.value);
	}

	return ok({
		...ruleset,
		properties: resolved_properties
	});
}

function resolve_property(property: Property): Result<Property> {
	if (property._t !== "IncludeProperty") {
		return ok(property);
	}

	const included = load_binding(property.include);
	if (!included.ok) {
		return included;
	}

	if (included.value._t === "BindingEnum") {
		const enum_property: EnumProperty = {
			_t: "EnumProperty",
			name: property.name,
			description: property.description,
			required: property.required,
			values: included.value.values.map(v => v.name),
			default: included.value.default,
			value: property.value
		};

		return ok(enum_property);
	}

	return ok(property);
}

export function load_resolved_binding(binding_path: string): Result<Ruleset> {
	const parsed = load_binding(binding_path);
	if (!parsed.ok) {
		return parsed;
	}
	return resolve_ruleset(parsed.value);
}
