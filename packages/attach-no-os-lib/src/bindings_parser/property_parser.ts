import { error, ok, Result } from "./result";
import { EnumProperty, IncludeProperty, is_primitive_symbols, NumberProperty, UnionProperty } from "./types";
import { asObject, at, boolean_, number_, optional, optionalWithDefault, ParseContext, required, string_, stringArray } from "./validators";

export function parse_number_property(name: string, object: Record<string, unknown>, context: ParseContext): Result<NumberProperty> {
	const type_ = required(object, "type", context, string_);
	if (!type_.ok) {
		return type_;
	}

	if (!is_primitive_symbols(type_.value)) {
		return error(`Invalid number type '${type_.value}`, at(context, "type").path);
	}

	const description = optionalWithDefault(object, "description", context, "", string_);
	if (!description.ok) {
		return description;
	}

	const required_ = optionalWithDefault(object, "required", context, false,boolean_);
	if (!required_.ok) {
		return required_;
	}

	const default_ = optional(object, "default", context, number_);
	if (!default_.ok) {
		return default_;
	}

	// TODO: maybe make this an optionalWithDefault and subtract the value
	const minimum = optional(object, "minimum", context, number_);
	if (!minimum.ok) {
		return minimum;
	}

	const maximum = optional(object, "maximum", context, number_);
	if (!maximum.ok) {
		return maximum;
	}

	return ok({
		_t: "NumberProperty",
		name: name,
		description: description.value,
		required: required_.value,
		type: type_.value,
		default: default_.value,
		minimum: minimum.value,
		maximum: maximum.value
	});
}

export function parse_enum_property(name: string, object: Record<string, unknown>, context: ParseContext): Result<EnumProperty> {
	const values = required(object, "values", context, stringArray);
	if (!values.ok) {
		return values;
	}

	const description = optionalWithDefault(object, "description", context, "", string_);
	if (!description.ok) {
		return description;
	}

	const required_ = optionalWithDefault(object, "required", context, false, boolean_);
	if (!required_.ok) {
		return required_;
	}

	const default_ = optional(object, "default", context, string_);
	if (!default_.ok) {
		return default_;
	}
	if (default_.value !== undefined && !values.value.includes(default_.value)) {
		return error(`Default value '${default_.value}' is not present in the 'values' field (${JSON.stringify(values.value)})`, at(context, "default").path);
	}

	return ok({
		_t: "EnumProperty",
		name,
		description: description.value,
		required: required_.value,
		values: values.value,
		default: default_.value,
	});
}

export function parse_include_property(name: string, object: Record<string, unknown>, context: ParseContext): Result<IncludeProperty> {
	const include = required(object, "include", context, string_);
	if (!include.ok) {return include;}

	const description = optionalWithDefault(object, "description", context, "", string_);
	if (!description.ok) {return description;}

	const required_ = optionalWithDefault(object, "required", context, false, boolean_);
	if (!required_.ok) {return required_;}

	const pointer = optionalWithDefault(object, "pointer", context, false, boolean_);
	if (!pointer.ok) {return pointer;}

	return ok({
		_t: "IncludeProperty",
		name,
		description: description.value,
		required: required_.value,
		include: include.value,
		pointer: pointer.value,
	});
}

function parse_union_member(value: unknown, context: ParseContext): Result<IncludeProperty> {
	const object = asObject(value, context);
	if (!object.ok) {return object;}

	const keys = Object.keys(object.value);
	if (keys.length !== 1) {
		return error(`Union member must have exactly one key`, context.path);
	}

	const name = keys[0]!;
	const inner = asObject(object.value[name], at(context, name));
	if (!inner.ok) {return inner;}

	// NOTE: For now, the union members being includes is enforced
	// for the lack of counter examples and to reduce complexity
	return parse_include_property(name, inner.value, at(context, name));
}

export function parse_union_property(name: string, object: Record<string, unknown>, context: ParseContext): Result<UnionProperty> {
	const members = required(object, "members", context, (v, c) => {
		if (!Array.isArray(v)) {
			return error(`Expected array`, c.path);
		}

		const result: IncludeProperty[] = [];
		for (const [index, element] of v.entries()) {
			const member = parse_union_member(element, at(c, index));
			if (!member.ok) {
				return member;
			}
			result.push(member.value);
		}
		return ok(result);
	});
	if (!members.ok) {
		return members;
	}

	const description = optionalWithDefault(object, "description", context, "", string_);
	if (!description.ok) {
		return description;
	}

	const required_ = optionalWithDefault(object, "required", context, false, boolean_);
	if (!required_.ok) {
		return required_;
	}

	return ok({
		_t: "UnionProperty",
		name: name,
		description: description.value,
		required: required_.value,
		members: members.value,
	});
}
