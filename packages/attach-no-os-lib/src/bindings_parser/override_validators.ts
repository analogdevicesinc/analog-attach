import { error, ok, Result } from "./result";
import { BooleanProperty, EnumProperty, IncludeProperty, NumberProperty, PropertyBase, PropertyOverride, UnionProperty } from "./types";
import { at, boolean_, number_, ParseContext, string_, stringArray } from "./validators";

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
	property: BooleanProperty
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
	property: IncludeProperty
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

export {parse_common_override_fields, is_enum_property_override, is_union_property_override, is_number_property_override, is_boolean_property_override, is_include_property_override};
