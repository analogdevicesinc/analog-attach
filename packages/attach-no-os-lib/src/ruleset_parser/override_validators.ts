import { error, ok, Result } from "./result";
import {
	BooleanProperty,
	EnumProperty,
	IncludeProperty,
	NumberProperty,
	OverrideDirective,
	OverrideScope,
	PropertyBase,
	PropertyOverride,
	UnionProperty,
	TargetOverride,
	SwitchCase,
	Property
} from "./types";
import { required, asObject, at, boolean_, number_, ParseContext, string_, stringArray } from "./validators";

function is_number_property_override(
	object: Record<string, unknown>,
	context: ParseContext,
	property: NumberProperty
): Result<PropertyOverride<NumberProperty>> {
	const override: PropertyOverride<NumberProperty> = {};

	if ("minimum" in object) {
		const min = number_(object.minimum, at(context, "minimum"));
		if (!min.ok) {return min;}
		if (property.minimum !== undefined && min.value < property.minimum) {
			return error(
				`minimum ${min.value} below type minimum ${property.minimum}`,
				at(context, "minimum").path
			);
		}
		override.minimum = min.value;
	}

	if ("maximum" in object) {
		const max = number_(object.maximum, at(context, "maximum"));
		if (!max.ok) {return max;}
		if (property.maximum !== undefined && max.value > property.maximum) {
			return error(
				`maximum ${max.value} above type maximum ${property.maximum}`,
				at(context, "maximum").path
			);
		}
		override.maximum = max.value;
	}

	if ("default" in object) {
		const default_ = number_(object.default, at(context, "default"));
		if (!default_.ok) {return default_;}
		override.default = default_.value;
	}

	const common = parse_common_override_fields(object, context);
	if (!common.ok) {return common;}

	return ok({ ...override, ...common.value });
}

function is_enum_property_override(
	object: Record<string, unknown>,
	context: ParseContext,
	property: EnumProperty
): Result<PropertyOverride<EnumProperty>> {
	const override: PropertyOverride<EnumProperty> = {};

	if ("default" in object) {
		const default_ = string_(object.default, at(context, "default"));
		if (!default_.ok) {return default_;}
		if (!property.values.includes(default_.value)) {
			return error(
				`Invalid default '${default_.value}'. Valid: ${property.values.join(", ")}`,
				at(context, "default").path
			);
		}
		override.default = default_.value;
	}

	if ("values" in object) {
		const vals = stringArray(object.values, at(context, "values"));
		if (!vals.ok) {return vals;}
		override.values = vals.value;
	}

	const common = parse_common_override_fields(object, context);
	if (!common.ok) {return common;}

	return ok({ ...override, ...common.value });
}

function is_union_property_override(
	object: Record<string, unknown>,
	context: ParseContext,
	property: UnionProperty
): Result<PropertyOverride<UnionProperty>> {
	const override: PropertyOverride<UnionProperty> = {};

	if ("value" in object) {
		const value = string_(object.value, at(context, "value"));
		if (!value.ok) {return value;}
		const members = property.members.map(m => m.name);
		if (!members.includes(value.value)) {
			return error(
				`Invalid union member '${value.value}'. Valid: ${members.join(", ")}`,
				at(context, "value").path
			);
		}
		override.value = value.value;
	}

	const common = parse_common_override_fields(object, context);
	if (!common.ok) {return common;}

	return ok({ ...override, ...common.value });
}

function is_boolean_property_override(
	object: Record<string, unknown>,
	context: ParseContext,
	_property: BooleanProperty
): Result<PropertyOverride<BooleanProperty>> {
	const override: PropertyOverride<BooleanProperty> = {};

	if ("default" in object) {
		const default_ = boolean_(object.default, at(context, "default"));
		if (!default_.ok) {return default_;}
		override.default = default_.value;
	}

	const common = parse_common_override_fields(object, context);
	if (!common.ok) {return common;}

	return ok({ ...override, ...common.value });
}

function is_include_property_override(
	object: Record<string, unknown>,
	context: ParseContext,
	_property: IncludeProperty
): Result<PropertyOverride<IncludeProperty>> {
	const override: PropertyOverride<IncludeProperty> = {};

	if ("pointer" in object) {
		const ptr = boolean_(object.pointer, at(context, "pointer"));
		if (!ptr.ok) {return ptr;}
		override.pointer = ptr.value;
	}

	const common = parse_common_override_fields(object, context);
	if (!common.ok) {return common;}

	return ok({ ...override, ...common.value });
}

function parse_common_override_fields(
	object: Record<string, unknown>,
	context: ParseContext
): Result<Partial<Pick<PropertyBase, 'description' | 'required'>>> {
	const result: Partial<Pick<PropertyBase, 'description' | 'required'>> = {};

	if ("description" in object) {
		const desc = string_(object.description, at(context, "description"));
		if (!desc.ok) {return desc;}
		result.description = desc.value;
	}

	if ("required" in object) {
		const request = boolean_(object.required, at(context, "required"));
		if (!request.ok) {return request;}
		result.required = request.value;
	}

	return ok(result);
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

	// NOTE : $parent scope will be checked in validator
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

export function require_property(context: ParseContext, name: string, scope: OverrideScope): Result<Property> {
	if (scope === "$parent") {
		// NOTE: This is a local validation, cannot check the props of the parent
		// Assuming ok
		return ok();
	}

	const property = context.document.properties?.find(p => p.name === name);
	if (!property) {
		const known = context.document.properties?.map(p => p.name).join(", ") ?? "none";
		return error(`Unknown property '${name}'. Known: ${known}`, at(context, "$on").path);
	}
	return ok(property);
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

function is_override_if_then(value: Record<string, unknown>, context: ParseContext, scope: OverrideScope): Result<OverrideDirective> {
	const object = asObject(value["$if"], at(context, "$if"));
	if (!object.ok) {
		return object;
	}

	const if_context: ParseContext = {
		path: at(context, "$if").path,
		document: context.document
	};

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
		// TODO: This is temp, in theory, the condition value could also be a minimum, maximum, etc...
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

export {
	parse_common_override_fields,
	is_enum_property_override,
	is_union_property_override,
	is_number_property_override,
	is_boolean_property_override,
	is_include_property_override,
	is_override,
	is_override_array,
	is_override_directive,
};
