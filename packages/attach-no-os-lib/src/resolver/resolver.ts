import fs from "node:fs";
import path from "node:path";
import { error, ok, Result } from "../ruleset_parser/result";
import { parse_ruleset } from "../ruleset_parser/ruleset_parser";
import { EnumProperty, Property, Ruleset, RulesetDescriptor } from "../ruleset_parser/types";
import { get_schemas_path } from "../settings/settings";

function load_ruleset(ruleset_path: string): Result<Ruleset> {
	const schemas_path = get_schemas_path();
	if (!schemas_path.ok) {
		return schemas_path;
	}

	const full_path = path.join(schemas_path.value, ruleset_path);
	try {
		const content = fs.readFileSync(full_path, "utf8");
		return parse_ruleset(content);
	} catch {
		return error(`Failed to load ruleset: ${full_path}`, ruleset_path);
	}
}

function resolve_descriptor_ruleset(ruleset: RulesetDescriptor): Result<RulesetDescriptor> {
	// NOTE: We just validate that the path is right and the included ruleset is a struct
	const resolved_ruleset = load_ruleset(ruleset.properties[0].include);
	if (!resolved_ruleset.ok) {
		return resolved_ruleset;
	}

	if (resolved_ruleset.value._t !== "RulesetStruct") {
		return error(`Expected type "struct" to be included in the descriptor ruleset, got ${resolved_ruleset.value._t}`);
	}

	return ok(ruleset);
}

export function resolve_ruleset(ruleset: Ruleset): Result<Ruleset> {
	if (ruleset._t === "RulesetDescriptor") {
		return resolve_descriptor_ruleset(ruleset);
	}

	if (ruleset._t !== "RulesetStruct") {
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

	const included = load_ruleset(property.include);
	if (!included.ok) {
		return included;
	}

	if (included.value._t === "RulesetEnum") {
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

export function load_resolved_ruleset(ruleset_path: string): Result<Ruleset> {
	const parsed = load_ruleset(ruleset_path);
	if (!parsed.ok) {
		return parsed;
	}
	return resolve_ruleset(parsed.value);
}
