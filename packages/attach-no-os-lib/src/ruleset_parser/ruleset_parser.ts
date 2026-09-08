import type {
	RulesetSources,
	Property,
	RulesetEnumValue,
	Ruleset
} from "./types";
import {
	is_integer_symbol,
	is_primitive_symbols,
	ruleset_type_from_token
} from "./types";
import YAML from "yaml";
import type { Result} from "./result";
import { ok, error } from "./result";
import type { ParseContext} from "./validators";
import { asObject, at, boolean_, number_, optional, optionalWithDefault, required, string_, stringArray } from "./validators";
import { RulesetType } from "./types";
import {
	parse_array_property,
	parse_bool_property,
	parse_enum_property,
	parse_include_property,
	parse_number_property,
	parse_platform_extra_property,
	parse_platform_ops_property,
	parse_raw_property,
	parse_string_property,
	parse_union_property,
	parse_readonly,
	reject_include_type
} from "./property_parser";
import {
	is_override,
} from "./override_validators";
import { resolve_ruleset } from "../resolver/resolver";

export function unwrap<T>(result: Result<T>): T {
	if (!result.ok) {
		throw new Error(JSON.stringify(result.error));
	}
	return result.value;
}

function is_ruleset_type(value: unknown, context: ParseContext): Result<RulesetType> {
	const s = string_(value, context);
	if (!s.ok) {
		return s;
	}

	const type_ = ruleset_type_from_token(s.value);
	if (type_ === undefined) {
		return error(`Invalid ruleset type '${s.value}'`, context.path);
	}

	return ok(type_);
}

function is_ruleset_sources(value: unknown, context: ParseContext): Result<RulesetSources> {
	const object = asObject(value, context);
	if (!object.ok) {
		return object;
	}

	const noos = optional(object.value, "noos", context, stringArray);
	if (!noos.ok) {
		return noos;
	}

	const platform = optional(object.value, "platform", context, stringArray);
	if (!platform.ok) {
		return platform;
	}

	const project = optional(object.value, "project", context, stringArray);
	if (!project.ok) {
		return project;
	}

	const sdk = optional(object.value, "sdk", context, stringArray);
	if (!sdk.ok) {
		return sdk;
	}

	const $note = optional(object.value, "$note", context, string_);
	if (!$note.ok) {
		return $note;
	}

	return ok({
		noos: noos.value,
		platform: platform.value,
		project: project.value,
		sdk: sdk.value,
		$note: $note.value,
	});
}

export function parse_property(name: string, value: unknown, context: ParseContext): Result<Property> {
	const object = asObject(value, context);
	if (!object.ok) {
		return object;
	}

	if ("include" in object.value || "include_type" in object.value) {
		return parse_include_property(name, object.value, context);
	}

	const type_ = object.value.type;
	if (typeof type_ === "string") {
		if (type_ === "enum") {
			return parse_enum_property(name, object.value, context);
		}

		if (type_ === "union") {
			return parse_union_property(name, object.value, context);
		}

		if (type_ === "bool") {
			return parse_bool_property(name, object.value, context);
		}

		if (is_primitive_symbols(type_)) {
			return parse_number_property(name, object.value, context);
		}

		if (type_ === "array") {
			return parse_array_property(name, object.value, context);
		}

		if (type_ === "string") {
			return parse_string_property(name, object.value, context);
		}

		if (type_ === "platform_ops") {
			return parse_platform_ops_property(name, object.value, context);
		}

		if (type_ === "platform_extra") {
			return parse_platform_extra_property(name, object.value, context);
		}

		if (type_ === "raw") {
			return parse_raw_property(name, object.value, context);
		}

		return error(`Unknown property type '${type_}'`, at(context, type_).path);
	}

	return error(`Cannot determine the property type for '${context.path}'. Expected 'type' or 'include'.`, context.path);
}

function is_enum_property(value: unknown, context: ParseContext): Result<RulesetEnumValue[]> {
	if (Array.isArray(value)) {
		const values: RulesetEnumValue[] = [];
		for (const [index, item] of value.entries()) {
			if (typeof item === "string" || typeof item === "number") {
				values.push({ name: item, description: undefined });
			} else {
				return error(`Expected string or number at index ${index.toString()}`, at(context, index).path);
			}
		}
		return ok(values);
	}

	const object = asObject(value, context);
	if (!object.ok) {
		return object;
	}

	const values: RulesetEnumValue[] = [];
	for (const [name, value] of Object.entries(object.value)) {
		if (typeof value === "string") {
			values.push({
				name: name,
				description: value
			});
		} else if (typeof value === "object" && value !== null) {
			const description = (value as Record<string, unknown>).description;
			values.push({
				name: name,
				description: typeof description === "string" ? description : undefined
			});
		} else {
			return error(`Invalid enum value format for '${name}'`, at(context, name).path);
		}
	}

	return ok(values);
}

// Every non-`$` key of a ruleset body, as a property decorated with `readonly`.
//
// Structs and descriptors share this surface: a `$`-prefixed key is metadata, and every
// other key is a field of the C struct, because a schema describes its struct 1:1. Either
// kind can have a field that something other than the user fills in — an init function for
// a descriptor member, the target template for a derived struct field — so `readonly` is
// read here rather than in one branch.
function parse_members(object: Record<string, unknown>, context: ParseContext): Result<Property[]> {
	const members: Property[] = [];

	for (const key of Object.keys(object)) {
		if (key.startsWith("$")) {
			continue;
		}

		const property = parse_property(key, object[key], at(context, key));
		if (!property.ok) {
			return property;
		}

		const member_object = asObject(object[key], at(context, key));
		if (!member_object.ok) {
			return member_object;
		}

		const member = parse_readonly(property.value, member_object.value, at(context, key));
		if (!member.ok) {
			return member;
		}

		members.push(member.value);
	}

	// A `count` has to name a real sibling that can hold a length, and has to agree with the
	// pointer about who fills it in: a derived list whose count the user could still set
	// would just have that value overwritten.
	for (const member of members) {
		if (member._t !== "IncludeProperty" || member.count === undefined) {
			continue;
		}

		const path = at(context, member.name).path;
		const counter = members.find(m => m.name === member.count);
		if (counter === undefined) {
			return error(`Property '${member.name}' declares count '${member.count}', which is not a field of this struct`, path);
		}
		if (counter._t !== "NumberProperty" || !is_integer_symbol(counter.type)) {
			return error(`Property '${member.name}' declares count '${member.count}', which must be an integer field`, path);
		}
		if ((member.readonly === true) !== (counter.readonly === true)) {
			return error(`Property '${member.name}' and its count '${member.count}' must both be readonly or neither`, path);
		}
	}

	return ok(members);
}

function parse_ruleset_from_object(object: Record<string, unknown>, context: ParseContext): Result<Ruleset> {
	const $id = required(object, "$id", context, string_);
	if (!$id.ok) {
		return $id;
	}

	const $type = required(object, "$type", context, is_ruleset_type);
	if (!$type.ok) {
		return $type;
	}

	const $symbol = required(object, "$symbol", context, string_);
	if (!$symbol.ok) {
		return $symbol;
	}

	const $description = optionalWithDefault(object, "$description", context, "no-OS ruleset", string_);
	if (!$description.ok) {
		return $description;
	}

	// Descriptor rulesets carry no sources (the $init_param they reference does) and an
	// extern names a symbol the library already compiles, so $sources is optional for both
	// and defaults to empty; every other type requires it.
	const $sources = $type.value === RulesetType.RT_DESCRIPTOR || $type.value === RulesetType.RT_EXTERN
		? optionalWithDefault(object, "$sources", context, {}, is_ruleset_sources)
		: required(object, "$sources", context, is_ruleset_sources);
	if (!$sources.ok) {
		return $sources;
	}

	// Kconfig symbols owned by this ruleset. Optional while the schemas migrate off
	// $sources; it becomes required for non-descriptors once every file carries it.
	const $config = optional(object, "$config", context, stringArray);
	if (!$config.ok) {
		return $config;
	}

	const $ranking = required(object, "$ranking", context, number_);
	if (!$ranking.ok) {
		return $ranking;
	}
	if ($ranking.value < 0 || $ranking.value > 4) {
		return error(`Ranking value is invalid (0-4)`, at(context, "$ranking").path);
	}

	switch ($type.value) {
		case RulesetType.RT_STRUCT: {
			const properties = parse_members(object, context);
			if (!properties.ok) {
				return properties;
			}
			// eslint-disable-next-line no-param-reassign -- context.document is the parse accumulator being built up
			context.document.properties = properties.value;

			const rules = optional(object, "$override", context, is_override);
			if (!rules.ok) {
				return rules;
			}

			const $capability = optional(object, "$capability", context, string_);
			if (!$capability.ok) {
				return $capability;
			}

			const $header = optional(object, "$header", context, string_);
			if (!$header.ok) {
				return $header;
			}

			const $exposes = optional(object, "$exposes", context, stringArray);
			if (!$exposes.ok) {
				return $exposes;
			}

			// Collect all capabilities from properties into $requires
			const capabilities = new Set<string>();
			for (const property of context.document.properties) {
				if (property.capability) {
					for (const cap of property.capability) {
						capabilities.add(cap);
					}
				}
			}
			const $requires = capabilities.size > 0 ? [...capabilities] : undefined;

			return ok({
				_t: "RulesetStruct",
				$id: $id.value,
				$type: $type.value,
				$symbol: $symbol.value,
				$description: $description.value,
				$ranking: $ranking.value,
				$sources: $sources.value,
				$config: $config.value,
				properties: context.document.properties,
				rules: rules.value,
				$requires: $requires,
				$capability: $capability.value,
				$header: $header.value,
				$exposes: $exposes.value,
			});
		}
		case RulesetType.RT_ENUM: {
			const values = required(object, "values", context, is_enum_property);
			if (!values.ok) {
				return values;
			}

			const default_ = optional(object, "default", context, string_);
			if (!default_.ok) {
				return default_;
			}

			if (default_.value !== undefined) {
				const value_names = values.value.map(v => v.name);
				if (!value_names.includes(default_.value)) {
					return error(`Default value '${default_.value}' is not a valid enum value. Valid: ${value_names.join(", ")}`, at(context, "default").path);
				}
			}

			return ok({
				_t: "RulesetEnum",
				$id: $id.value,
				$type: $type.value,
				$symbol: $symbol.value,
				$description: $description.value,
				$ranking: $ranking.value,
				$sources: $sources.value,
				$config: $config.value,
				values: values.value,
				default: default_.value,
			});
		}
		case RulesetType.RT_PLATFORM_OPS: {
			const $capability = optional(object, "$capability", context, string_);
			if (!$capability.ok) {
				return $capability;
			}

			return ok({
				_t:	"RulesetPlatformOps",
				$id: $id.value,
				$type: $type.value,
				$symbol: $symbol.value,
				$description: $description.value,
				$ranking: $ranking.value,
				$sources: $sources.value,
				$config: $config.value,
				$capability: $capability.value,
			});
		}
		case RulesetType.RT_EXTERN: {
			// No property loop: an extern has nothing to configure. `$provides` is the
			// only key that carries meaning, since it is what an `include` matches.
			const $provides = required(object, "$provides", context, string_);
			if (!$provides.ok) {
				return $provides;
			}

			const $header = optional(object, "$header", context, string_);
			if (!$header.ok) {
				return $header;
			}

			const $array = optionalWithDefault(object, "$array", context, false, boolean_);
			if (!$array.ok) {
				return $array;
			}

			return ok({
				_t: "RulesetExtern",
				$id: $id.value,
				$type: $type.value,
				$symbol: $symbol.value,
				$description: $description.value,
				$ranking: $ranking.value,
				$sources: $sources.value,
				$config: $config.value,
				$provides: $provides.value,
				$header: $header.value,
				$array: $array.value,
			});
		}
		case RulesetType.RT_DESCRIPTOR: {
			const $init_template = required(object, "$init_template", context, string_);
			if (!$init_template.ok) {
				return $init_template;
			}

			const $remove_template = required(object, "$remove_template", context, string_);
			if (!$remove_template.ok) {
				return $remove_template;
			}

			// `$`-prefixed, like the rest of a descriptor's metadata: it says which struct
			// configures this device, not what the C struct contains. That also keeps it out
			// of the member loop below for free.
			const init_parameter_object = required(object, "$init_param", context, asObject);
			if (!init_parameter_object.ok) {
				return init_parameter_object;
			}

			const init_parameter_property = parse_include_property("$init_param", init_parameter_object.value, at(context, "$init_param"));
			if (!init_parameter_property.ok) {
				return init_parameter_property;
			}

			const init_parameter = reject_include_type(init_parameter_property.value, at(context, "$init_param"));
			if (!init_parameter.ok) {
				return init_parameter;
			}

			// The descriptor's own members, so the C struct is described 1:1. Most of them
			// are `readonly`, since an init function fills the struct in. A descriptor emits
			// no initializer, so these are declarations for referencing, never printed.
			const members = parse_members(object, context);
			if (!members.ok) {
				return members;
			}

			return ok({
				_t: "RulesetDescriptor",
				$type: RulesetType.RT_DESCRIPTOR,
				$id: $id.value,
				$ranking: $ranking.value,
				$sources: $sources.value,
				$config: $config.value,
				$description: $description.value,
				$symbol: $symbol.value,
				$init_template: $init_template.value,
				$remove_template: $remove_template.value,
				properties: [init_parameter.value, ...members.value],
			});
		}
	}
}

export function parse_ruleset(contents: string): Result<Ruleset> {
	let parsed: unknown;
	try {
		parsed = YAML.parse(contents);
	} catch (_error) {
		return error(`YAML parse error at: ${String(_error)}`, "");
	}

	return parse_ruleset_from_object(parsed as Record<string, unknown>, { path: "", document: {} });
}

export function load_resolved_ruleset(content: string): Result<Ruleset> {
	const parsed = parse_ruleset(content);
	if (!parsed.ok) {
		return parsed;
	}

	return resolve_ruleset(parsed.value);
}
