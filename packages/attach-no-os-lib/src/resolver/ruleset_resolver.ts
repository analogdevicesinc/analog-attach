import { join } from 'node:path';
import { error, ok, Result } from "../bindings_parser/result";
import { ArrayProperty, IncludeProperty, Property, ResolvedRulesetProperty, Ruleset, UnionProperty } from "../bindings_parser/types";
import { at, ParseContext } from "../bindings_parser/validators";
import { RULESET_BASE_DIRECTORY } from "../globals";
import { readFileSync } from "node:fs";
import { parse_binding } from "../bindings_parser/binding_parser";

function load_ruleset(include_path: string): Result<Ruleset> {
	const full_path = join(RULESET_BASE_DIRECTORY, include_path);
	let contents: string;
	try {
		contents = readFileSync(full_path, "utf8");
	} catch {
		return error(`Failed to read ruleset file: ${full_path}`, include_path);
	}

	return parse_binding(contents);
}

export function resolve_includes_from_ruleset(ruleset: Ruleset, context?: ParseContext): Result<Ruleset> {
	if (ruleset._t !== "BindingStuct") {
		return ok(ruleset); // Only BindingStruct has things to resolve
	}

	if (context === undefined) {
		context = {
			path: "",
			document: {}
		};
	}

	const resolved_properties: Property[] = [];

	for (const property of ruleset.properties) {
		const resolved = resolve_property(property, at(context, property.name));
		if (!resolved.ok) {
			return resolved;
		}
		resolved_properties.push(resolved.value);
	}

	return ok({
		...ruleset,
		properties: resolved_properties,
	});
}

export function resolve_property(property: Property, context: ParseContext): Result<Property> {
	switch (property._t) {
		case "IncludeProperty": {
			return resolve_include(property, context);
		}
		case "UnionProperty": {
			return resolve_union(property, context);
		}
		case "ArrayProperty": {
			return resolve_array(property, context);
		}
		default: {
			return ok(property);
		}
	}	
}

function resolve_include(property: IncludeProperty, context: ParseContext): Result<ResolvedRulesetProperty> {
    const loaded = load_ruleset(property.include);
    if (!loaded.ok) {
        return error(loaded.error.message, context.path);
    }

    // NOTE: Also resolve the includes of the expanded
    const resolved = resolve_includes_from_ruleset(loaded.value, context);
    if (!resolved.ok) {
        return resolved;
    }

    return ok({
        _t: "ResolvedRulesetProperty",
        name: property.name,
        description: property.description,
        required: property.required,
        disabled: property.disabled,
        capability: property.capability,
        pointer: property.pointer,
        resolved: resolved.value,
    });
}

function resolve_union(property: UnionProperty, context: ParseContext): Result<UnionProperty> {
    const resolved_members: ResolvedRulesetProperty[] = [];
    const members_context = at(context, "members");

    for (let index = 0; index < property.members.length; index++) {
		const member = property.members[index];

		if (member._t === "ResolvedRulesetProperty") {
			resolved_members.push(member);
			continue;
		}

        const resolved = resolve_include(member, at(members_context, index));
        if (!resolved.ok) {
            return resolved;
        }
        resolved_members.push(resolved.value);
    }

    return ok({
        ...property,
        members: resolved_members,
    });
}

function resolve_array(property: ArrayProperty, context: ParseContext): Result<ArrayProperty> {
    if (property.element._t !== "IncludeProperty") {
        return ok(property);
    }

    const resolved = resolve_include(property.element, at(context, "element"));
    if (!resolved.ok) {
        return resolved;
    }

    return ok({
        ...property,
        element: resolved.value,
    });
}
