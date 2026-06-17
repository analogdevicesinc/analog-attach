import {
	BindingStruct,
	BindingSources,
	is_primitive_symbols,
	OverrideDirective,
	OverrideScope,
	Property,
	PropertyOverride,
	SwitchCase,
	TargetOverride,
    BindingEnum,
    BindingEnumValue,
    Binding
} from "./types";
import YAML from "yaml";
import { Result, ok, error } from "./result";
import { asObject, at, number_, optional, optionalWithDefault, ParseContext, required, string_, stringArray } from "./validators";
import { BindingType, BindingHeaderSources } from "./types";
import { parse_array_property, parse_bool_property, parse_callback_context_property, parse_callback_function_property, parse_enum_property, parse_include_property, parse_number_property, parse_platform_extra_property, parse_platform_ops_property, parse_string_property, parse_union_property } from "./property_parser";
import { is_boolean_property_override, is_enum_property_override, is_include_property_override, is_number_property_override, is_union_property_override } from "./override_validators";

export function unwrap<T>(result: Result<T>): T {
	if (!result.ok) {throw result.error;}
	return result.value;
}

function is_binding_type(value: unknown, context: ParseContext): Result<BindingType> {
	const s = string_(value, context);
	if (!s.ok) {
		return s;
	}

	switch (s.value) {
		case "struct": {
			return ok(BindingType.BT_STRUCT);
		}
		case "enum": {
			return ok(BindingType.BT_ENUM);
		}
		case "platform_ops": {
			return ok(BindingType.BT_PLATFORM_OPS);
		}
		default: {
			return error(`Invalid binding type '${s.value}'`, context.path);
		}
	}
}

function is_source_files(value: unknown, context: ParseContext): Result<BindingHeaderSources> {
	const object = asObject(value, context);
	if (!object.ok) {
		return object;
	}

	const headers = required(object.value, "headers", context, stringArray);
	if (!headers.ok) {
		return headers;
	}

	const sources = optional(object.value, "sources", context, stringArray);
	if (!sources.ok) {
		return sources;
	}

	return ok({
		headers: headers.value,
		sources: sources.value,
	});
}

function is_binding_sources(value: unknown, context: ParseContext): Result<BindingSources> {
	const object = asObject(value, context);
	if (!object.ok) {
		return object;
	}

	const headers = optional(object.value, "headers", context, stringArray);
	if (!headers.ok) {
		return headers;
	}

	const sources = optional(object.value, "sources", context, stringArray);
	if (!sources.ok) {
		return sources;
	}

	const sdk = optional(object.value, "sdk", context, is_source_files);
	if (!sdk.ok) {
		return sdk;
	}

	const platform = optional(object.value, "platform", context, is_source_files);
	if (!platform.ok) {
		return platform;
	}

	const $note = optional(object.value, "$note", context, string_);
	if (!$note.ok) {
		return $note;
	}

	return ok({
		headers: headers.value,
		sources: sources.value,
		platform: platform.value,
		sdk: sdk.value,
		$note: $note.value,
	});
}

export function parse_property(name: string, value: unknown, context: ParseContext): Result<Property> {
	const object = asObject(value, context);
	if (!object.ok) {
		return object;
	}

	if ("include" in object.value) {
		return parse_include_property(name, object.value, context);
	}

	const type_ = object.value["type"];
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

		if (type_ === "callback_func") {
			return parse_callback_function_property(name, object.value, context);
		}

		if (type_ === "callback_ctx") {
			return parse_callback_context_property(name, object.value, context);
		}

		return error(`Unknown property type '${type_}'`, at(context, type_).path);
	}

	return error("Cannot determine the property type", context.path);
}

function require_property(context: ParseContext, name: string, scope: OverrideScope): Result<Property> {
	if (scope === "$parent") {
		// NOTE: This is a local validation, cannot check the props of the parent
		// Assuming ok
		return ok(); // FIXME: Might want to print this somewhere?
	}

	const property = context.document.properties?.find(p => p.name === name);
	if (!property) {
		const known = context.document.properties?.map(p => p.name).join(", ") ?? "none";
		return error(`Unknown property '${name}'. Known: ${known}`, at(context, "$on").path);
	}
	return ok(property);
}

function is_property_override(
	value: unknown,
	context: ParseContext,
	scope: OverrideScope,
	property?: Property
): Result<PropertyOverride> {
	const object = asObject(value, context);
	if (!object.ok) {
		return object;
	}

	// FIXME: Another issue is that idk a way to validate unknown properties
	// or mistyped ones since the type gets removed at build. will investigate later

	// TODO : treat $parent scope this is placeholder
	if (scope === "$parent" || !property) {
		return ok(object.value as PropertyOverride);
	}

	switch (property?._t) {
		case "NumberProperty": {
			return is_number_property_override(object.value, context, property);
		}
		case "BooleanProperty": {
			return is_boolean_property_override(object.value, context, property);
		}
		case "IncludeProperty": {
			return is_include_property_override(object.value, context, property);
		}
		case "EnumProperty": {
			return is_enum_property_override(object.value, context, property);
		}
		case "UnionProperty": {
			return is_union_property_override(object.value, context, property);
		}
		default: {
			return error("Unknown property type", context.path);
		}
	}
}

function parse_targeted_override(
	target_name: string,
	value: unknown,
	context: ParseContext,
	scope: OverrideScope
): Result<TargetOverride> {
	const target_property = require_property(context, target_name, scope);
	if (!target_property.ok) {
		return target_property;
	}

	const override_context: ParseContext = {
		path: at(context, target_name).path,
		document: context.document
	};

	const override = is_property_override(value, override_context, scope, target_property.value);
	if (!override.ok) {
		return override;
	}

	return ok({
		_t: "TargetOverride",
		scope,
		target: target_name,
		override: override.value
	});
}

function parse_case_body(
	object: Record<string, unknown>,
	context: ParseContext,
	default_scope: OverrideScope
): Result<TargetOverride[]> {
	const overrides: TargetOverride[] = [];

	for (const [key, value] of Object.entries(object)) {
		// Scope selector, parse nested overrides with that scope
		if (key === "$parent" || key === "$this") {
			const scope = key as OverrideScope;
			const nested_object = asObject(value, at(context, key));
			if (!nested_object.ok) {
				return nested_object;
			}

			const nested_context: ParseContext = {
				path: at(context, key).path,
				document: context.document
			};

			for (const [target_name, override_value] of Object.entries(nested_object.value)) {
				const targeted = parse_targeted_override(
					target_name,
					override_value,
					nested_context,
					scope
				);
				if (!targeted.ok) {
					return targeted;
				}
				overrides.push(targeted.value);
			}
		} else {
			// Direct override - use default scope
			const targeted = parse_targeted_override(
				key,
				value,
				context,
				default_scope
			);
			if (!targeted.ok) {
				return targeted;
			}
			overrides.push(targeted.value);
		}
	}

	return ok(overrides);
}

function is_override_mutex(value: Record<string, unknown>, context: ParseContext, scope: OverrideScope): Result<OverrideDirective> {
	const $mutex = value["$mutex"];
	
	if (!Array.isArray($mutex)) {
		return error("$mutex must be an array of property names", at(context, "$mutex").path);
	}

	const mutex_context: ParseContext = {
		path: at(context, "$mutex").path,
		document: context.document
	};

	const properties: string[] = [];

	for (const [index, item] of $mutex.entries()) {
		if (typeof item !== "string") {
			return error(`Expected string, got ${typeof item}`, at(mutex_context, index).path);
		}

		const property = require_property(context, item, scope);
		if (!property.ok) {
			return property;
		}

		properties.push(item);
	}

	if (properties.length < 2) {
		return error("$mutex must have at least 2 properties", mutex_context.path);
	}

	return ok({
		_t: "OverrideMutex",
		scope: scope,
		properties: properties
	});
}

function is_override_static(value: Record<string, unknown>, context: ParseContext, scope: OverrideScope): Result<OverrideDirective> {
	const keys = Object.keys(value);
	if (keys.length !== 1) {
		return error("Static override must have exactly one property key", context.path);
	}

	const target_name = keys[0];
	const override_value = value[target_name];

	const target_property = require_property(context, target_name, scope);
	if (!target_property.ok) {
		return target_property;
	}

	const override_context: ParseContext = {
		path: at(context, target_name).path,
		document: context.document,
	};

	const override = is_property_override(override_value, override_context, scope, target_property.value);
	if (!override.ok) {
		return override;
	}

	return ok({
		_t: "OverrideStatic",
		scope: scope,
		target: target_name,
		override: override.value
	});
}

function is_override_if_then(value: Record<string, unknown>, context: ParseContext, scope: OverrideScope): Result<OverrideDirective> {
	const object = asObject(value["$if"], at(context, "$if"));
	if (!object.ok) {
		return object;
	}

	const if_context: ParseContext = {
		path: at(context, "$if").path,
		document: context.document
	};

	// FIXME: Recheck this part, i am not sure if it's good
	let condition_scope = scope;
	let condition_container = object.value;
	if ("$this" in object.value) {
		condition_scope = "$this";
		const inner = asObject(object.value["$this"], at(if_context, "$this"));
		if (!inner.ok) {
			return inner;
		}
		condition_container = inner.value;
	} else if ("$parent" in object.value) {
		condition_scope = "$parent";
		const inner = asObject(object.value["$parent"], at(if_context, "$parent"));
		if (!inner.ok) {
			return inner;
		}
		condition_container = inner.value;
	}

	const if_keys = Object.keys(condition_container);
	if (if_keys.length !== 1) {
		return error("$if must have exactly one property condition", if_context.path);
	}

	const condition_target = if_keys[0];
	const condition_value = condition_container[condition_target];

	const condition_property = require_property(context, condition_target, condition_scope);
	if (!condition_property.ok) {
		return condition_property;
	}

	const condition_object = asObject(condition_value, at(if_context, condition_target));
	if (!condition_object.ok) {
		return condition_object;
	}

	const then = asObject(value["$then"], at(context, "$then"));
	if (!then.ok) {
		return then;
	}

	const expected_value = condition_object.value["value"];
	if (expected_value === undefined) {
		// FIXME: This is temp, in theory, the condition value could also be a minimum, maximum, etc...
		return error("Condition myst have a 'value' field",at(if_context, condition_target).path);
	}

	const then_context: ParseContext = {
		path: at(context, "$then").path,
		document: context.document
	};

	const then_overrides = parse_case_body(then.value, then_context, scope);
	if (!then_overrides.ok) {
		return then_overrides;
	}

	return ok({
		_t: "OverrideIfThen",
		scope: scope,
		condition: {
			scope: condition_scope,
			target: condition_target,
			value: expected_value
		},
		overrides: then_overrides.value
	});
}

function is_override_switch(value: Record<string, unknown>, context: ParseContext, scope: OverrideScope): Result<OverrideDirective> {
	const object = asObject(value["$switch"], at(context, "$switch"));
	if (!object.ok) {
		return object;
	}

	const switch_context: ParseContext = {
		path: at(context, "$switch").path,
		document: context.document
	};

	const $on = required(object.value, "$on", switch_context, string_);
	if (!$on.ok) {
		return $on;
	}

	const switch_property = require_property(context, $on.value, scope);
	if (!switch_property.ok) {
		return switch_property;
	}

	// Parse cases
	const $cases = required(object.value, "$cases", switch_context, asObject);
	if (!$cases.ok) {
		return $cases;
	}

	const cases_context: ParseContext = {
		path: at(switch_context, "$cases").path,
		document: switch_context.document
	};

	const parsed_cases: SwitchCase[] = [];

	for (const [case_name, case_value] of Object.entries($cases.value)) {
		// Validate case name against enum values (only for $this scope with EnumProperty)
		if (scope === "$this" && switch_property.value?._t === "EnumProperty" && !switch_property.value.values.includes(case_name)) {
				return error(
					`Invalid case '${case_name}'. Valid values: ${switch_property.value.values.join(", ")}`,
					at(cases_context, case_name).path
				);
			}

		const case_object = asObject(case_value, at(cases_context, case_name));
		if (!case_object.ok) {
			return case_object;
		}

		const case_context: ParseContext = {
			path: at(cases_context, case_name).path,
			document: context.document
		};

		// Parse case body - handles $parent/$this scope selectors
		const overrides = parse_case_body(case_object.value, case_context, scope);
		if (!overrides.ok) {
			return overrides;
		}

		parsed_cases.push({
			_t: "SwitchCase",
			condition: case_name,
			overrides: overrides.value
		});
	}

	return ok({
		_t: "OverrideSwitch",
		scope,
		$on: $on.value,
		$cases: parsed_cases
	});
}

function is_override_directive(value: unknown, context: ParseContext, scope: OverrideScope): Result<OverrideDirective> {
	const object = asObject(value, context);
	if (!object.ok) {
		return object;
	}

	if ("$parent" in object.value) {
		// Override the current scope
		return is_override_directive(
			object.value.$parent,
			{ path: at(context, "$parent").path, document: context.document },
			"$parent"
		);
	}

	if ("$this" in object.value) {
		// Override the current scope
		return is_override_directive(
			object.value.$parent,
			{ path: at(context, "$this").path, document: context.document },
			"$this"
		);
	}

	if ("$switch" in object.value) {
		return is_override_switch(object.value, context, scope);
	}

	if ("$if" in object.value) {
		return is_override_if_then(object.value, context, scope);
	}

	if ("$mutex" in object.value) {
		return is_override_mutex(object.value, context, scope);
	}

	return is_override_static(object.value, context, scope);
}

// FIXME: Move these in another file?
function is_override_array(value: unknown, context: ParseContext, scope: OverrideScope): Result<OverrideDirective[]> {
	if (!Array.isArray(value)) {
		return error("Expected array", context.path);
	}

	const directives: OverrideDirective[] = [];
	for (const [index, element] of value.entries()) {
		const directive = is_override_directive(
			element,
			{ path: at(context, index).path, document: context.document },
			scope
		);
		if (!directive.ok) {
			return directive;
		}
		directives.push(directive.value);
	}

	return ok(directives);
}

function is_override(value: unknown, context: ParseContext): Result<OverrideDirective[]> {
	if (Array.isArray(value)) {
		// Implicit selector $this
		return is_override_array(value, context, "$this");
	}

	const object = asObject(value, context);
	if (!object.ok) {
		return object;
	}

	if ("$parent" in object.value) {
		return is_override_array(
			object.value["$parent"],
			{ path: at(context, "$parent").path, document: context.document },
			"$parent"
		);
	}

	if ("$this" in object.value) {
		return is_override_array(
			object.value["$this"],
			{ path: at(context, "$this").path, document: context.document },
			"$this"
		);
	}

	return error("$override must be an array or object with $this/$parent", context.path);
}

function is_enum_property(value: unknown, context: ParseContext): Result<BindingEnumValue[]> {
	if (Array.isArray(value)) {
        const values: BindingEnumValue[] = [];
        for (const [index, item] of value.entries()) {
            if (typeof item === "string") {
                values.push({ name: item, description: undefined });
            } else {
                return error(`Expected string at index ${index}`, at(context, index).path);
            }
        }
        return ok(values);
    }

	const object = asObject(value, context);
	if (!object.ok) {
		return object;
	}

	const values: BindingEnumValue[] = [];
	for (const [name, value] of Object.entries(object.value)) {
		if (typeof value === "string") {
			values.push({
				name: name,
				description: value
			});
		} else if (typeof value === "object" && value !== null) {
			const description = (value as Record<string, unknown>)["description"];
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

function parse_binding_from_object(object: Record<string, unknown>, context: ParseContext): Result<Binding> {
	const $id = required(object, "$id", context, string_);
	if (!$id.ok) {
		return $id;
	}

	const $type = required(object, "$type", context, is_binding_type);
	if (!$type.ok) {
		return $type;
	}

	const $name = required(object, "$name", context, string_);
	if (!$name.ok) {
		return $name;
	}

	const $description = optionalWithDefault(object, "$description", context, "no-OS binding", string_);
	if (!$description.ok) {
		return $description;
	}

	const $sources = required(object, "$sources", context, is_binding_sources);
	if (!$sources.ok) {
		return $sources;
	}

	const $ranking = required(object, "$ranking", context, number_);	
	if (!$ranking.ok) {
		return $ranking;
	}
	if ($ranking.value < 0 || $ranking.value > 4) {
		return error(`Ranking value is invalid (0-4)`, at(context, "$ranking").path);
	}

	switch ($type.value) {
		case BindingType.BT_STRUCT: {
			context.document.properties = [];
			for (const key of Object.keys(object)) {
				if (key.startsWith("$")) {
					continue;
				}

				const property = parse_property(key, object[key], at(context, key));
				if (!property.ok) {
					return property;
				}
				context.document.properties.push(property.value);
			}

			const $override = optional(object, "$override", context, is_override);
			if (!$override.ok) {
				return $override;
			}

			return ok({
				_t: "BindingStuct",
				$id: $id.value,
				$type: $type.value,
				$name: $name.value,
				$description: $description.value,
				$ranking: $ranking.value,
				$sources: $sources.value,
				properties: context.document.properties,
				$override: $override.value,
			});
		}
		case BindingType.BT_ENUM: {
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
				_t: "BindingEnum",
				$id: $id.value,
				$type: $type.value,
				$name: $name.value,
				$description: $description.value,
				$ranking: $ranking.value,
				$sources: $sources.value,
				values: values.value,
				default: default_.value,
			});
		}
		case BindingType.BT_PLATFORM_OPS: {
			return ok({
				_t:	"BindingPlatformOps",
				$id: $id.value,
				$type: $type.value,
				$name: $name.value,
				$description: $description.value,
				$ranking: $ranking.value,
				$sources: $sources.value,
			});
		}
	}
}

export function parse_binding(contents: string): Result<Binding> {
	let parsed: unknown;
	try {
		parsed = YAML.parse(contents);
	} catch (_error) {
		return error(`YAML parse error at: ${_error}`, "");
	}

	return parse_binding_from_object(parsed as Record<string, unknown>, { path: "", document: {} });
}
