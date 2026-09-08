import type { Result } from "./result";
import { error, ok } from "./result";
import type {
	ArrayElement,
	ArrayProperty,
	BooleanProperty,
	EnumProperty,
	IncludeMatch,
	IncludeProperty,
	NumberProperty,
	PlatformExtraProperty,
	PlatformOpsProperty,
	Property,
	RawProperty,
	StringProperty,
	UnionProperty
} from "./types";
import {
	is_integer_symbol,
	is_primitive_symbols,
	ruleset_type_from_token
} from "./types";
import type {
	ParseContext} from "./validators";
import {
	asObject,
	at,
	boolean_,
	integer_,
	number_,
	optional,
	optionalWithDefault,
	required,
	string_,
	enumValueArray,
	stringOrNumber_,
	capabilityArray
} from "./validators";

export function parse_number_property(name: string, object: Record<string, unknown>, context: ParseContext): Result<NumberProperty> {
	const type_ = required(object, "type", context, string_);
	if (!type_.ok) {
		return type_;
	}

	if (!is_primitive_symbols(type_.value)) {
		return error(`Invalid number type '${type_.value}`, at(context, "type").path);
	}

	// Integer primitives reject fractional bounds and defaults; float/double accept them.
	const numeric = is_integer_symbol(type_.value) ? integer_ : number_;

	const description = optionalWithDefault(object, "description", context, "", string_);
	if (!description.ok) {
		return description;
	}

	const required_ = optionalWithDefault(object, "required", context, false,boolean_);
	if (!required_.ok) {
		return required_;
	}

	const default_ = optional(object, "default", context, numeric);
	if (!default_.ok) {
		return default_;
	}

	// TODO: maybe make this an optionalWithDefault and figure out the value
	const minimum = optional(object, "minimum", context, numeric);
	if (!minimum.ok) {
		return minimum;
	}

	const maximum = optional(object, "maximum", context, numeric);
	if (!maximum.ok) {
		return maximum;
	}

	const capability = optional(object, "capability", context, capabilityArray);
	if (!capability.ok) {
		return capability;
	}

	return ok({
		_t: "NumberProperty",
		name: name,
		description: description.value,
		required: required_.value,
		type: type_.value,
		default: default_.value,
		minimum: minimum.value,
		maximum: maximum.value,
		capability: capability.value,
	});
}

export function parse_bool_property(name: string, object: Record<string, unknown>, context: ParseContext): Result<BooleanProperty> {
	const description = optionalWithDefault(object, "description", context, "", string_);
	if (!description.ok) {
		return description;
	}

	const required_ = optionalWithDefault(object, "required", context, false, boolean_);
	if (!required_.ok) {
		return required_;
	}

	const default_ = optionalWithDefault(object, "default", context, false, boolean_);
	if (!default_.ok) {
		return default_;
	}

	const capability = optional(object, "capability", context, capabilityArray);
	if (!capability.ok) {
		return capability;
	}

	return ok({
		_t: "BooleanProperty",
		name,
		type: "bool",
		description: description.value,
		required: required_.value,
		default: default_.value,
		capability: capability.value,
	});
}

export function parse_string_property(name: string, object: Record<string, unknown>, context: ParseContext): Result<StringProperty> {
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

	const capability = optional(object, "capability", context, capabilityArray);
	if (!capability.ok) {
		return capability;
	}

	return ok({
		_t: "StringProperty",
		name,
		type: "string",
		description: description.value,
		required: required_.value,
		default: default_.value,
		capability: capability.value,
	});
}

export function parse_enum_property(name: string, object: Record<string, unknown>, context: ParseContext): Result<EnumProperty> {
	const values = required(object, "values", context, enumValueArray);
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

	const default_ = optional(object, "default", context, stringOrNumber_);
	if (!default_.ok) {
		return default_;
	}

	if (default_.value !== undefined && !values.value.includes(default_.value)) {
		return error(`Default value '${default_.value.toString()}' is not present in the 'values' field (${JSON.stringify(values.value)})`, at(context, "default").path);
	}

	const capability = optional(object, "capability", context, capabilityArray);
	if (!capability.ok) {
		return capability;
	}

	return ok({
		_t: "EnumProperty",
		name,
		description: description.value,
		required: required_.value,
		values: values.value,
		default: default_.value,
		capability: capability.value,
	});
}

export function parse_include_property(name: string, object: Record<string, unknown>, context: ParseContext): Result<IncludeProperty> {
	const match = parse_include_match(object, context);
	if (!match.ok) {return match;}

	const description = optionalWithDefault(object, "description", context, "", string_);
	if (!description.ok) {return description;}

	const required_ = optionalWithDefault(object, "required", context, false, boolean_);
	if (!required_.ok) {return required_;}

	const pointer = optionalWithDefault(object, "pointer", context, false, boolean_);
	if (!pointer.ok) {return pointer;}

	const capability = optional(object, "capability", context, capabilityArray);
	if (!capability.ok) {return capability;}

	// The sibling field holding this pointer's element count (see IncludeProperty.count).
	// Only meaningful for a pointer: a by-value member is one element and needs no count.
	const count = optional(object, "count", context, string_);
	if (!count.ok) {return count;}
	if (count.value !== undefined && !pointer.value) {
		return error(`'count' names the length of a list, so it needs 'pointer: true'`, at(context, "count").path);
	}

	return ok({
		_t: "IncludeProperty",
		name,
		description: description.value,
		required: required_.value,
		pointer: pointer.value,
		count: count.value,
		capability: capability.value,
		...match.value,
	});
}

// `include` names one ruleset by $id, `include_type` names a whole ruleset type.
// Exactly one, so every consumer knows which question to ask.
function parse_include_match(object: Record<string, unknown>, context: ParseContext): Result<IncludeMatch> {
	const has_include = "include" in object;
	const has_include_type = "include_type" in object;

	if (has_include && has_include_type) {
		return error(`'include' and 'include_type' are mutually exclusive`, context.path);
	}

	if (has_include) {
		const include = required(object, "include", context, string_);
		if (!include.ok) {return include;}
		return ok({ include: include.value });
	}

	if (has_include_type) {
		const token = required(object, "include_type", context, string_);
		if (!token.ok) {return token;}

		const include_type = ruleset_type_from_token(token.value);
		if (include_type === undefined) {
			return error(`Invalid include_type '${token.value}'`, at(context, "include_type").path);
		}

		return ok({ include_type });
	}

	return error(`Missing required field 'include' (or 'include_type')`, context.path);
}

// `include_type` is only wired up for plain properties. Union members, array elements and
// a descriptor's $init_param all resolve their target's $id, so they need a concrete path;
// say so here instead of failing further down with a confusing message.
export function reject_include_type(property: IncludeProperty, context: ParseContext): Result<IncludeProperty> {
	if (property.include === undefined) {
		return error(`'include_type' is not supported here, use 'include'`, context.path);
	}

	return ok(property);
}

function parse_union_member(value: unknown, context: ParseContext): Result<IncludeProperty> {
	const object = asObject(value, context);
	if (!object.ok) {return object;}

	const keys = Object.keys(object.value);
	const name = keys[0];
	if (keys.length !== 1 || name === undefined) {
		return error(`Union member must have exactly one key`, context.path);
	}

	const inner = asObject(object.value[name], at(context, name));
	if (!inner.ok) {return inner;}

	// NOTE: For now, the union members being includes is enforced
	// for the lack of counter examples and to reduce complexity
	const member = parse_include_property(name, inner.value, at(context, name));
	if (!member.ok) {return member;}

	return reject_include_type(member.value, at(context, name));
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

	const capability = optional(object, "capability", context, capabilityArray);
	if (!capability.ok) {
		return capability;
	}

	return ok({
		_t: "UnionProperty",
		name: name,
		description: description.value,
		required: required_.value,
		members: members.value,
		capability: capability.value,
	});
}

export function parse_array_property(name: string, object: Record<string, unknown>, context: ParseContext): Result<ArrayProperty> {
	const size = required(object, "size", context, integer_);
	if (!size.ok) {
		return size;
	}

	const description = optionalWithDefault(object, "description", context, "", string_);
	if (!description.ok) {
		return description;
	}

	const required_ = optionalWithDefault(object, "required", context, false, boolean_);
	if (!required_.ok) {
		return required_;
	}

	const disabled = optionalWithDefault(object, "disabled", context, false, boolean_);
	if (!disabled.ok) {
		return disabled;
	}

	const element_object = required(object, "element", context, (v, c) => asObject(v, c));
	if (!element_object.ok) {
		return element_object;
	}

	const element_context = at(context, "element");
	let element: ArrayElement;

	if ("include" in element_object.value || "include_type" in element_object.value) {
		const include = parse_include_property("element", element_object.value, element_context);
		if (!include.ok) {
			return include;
		}

		const concrete = reject_include_type(include.value, element_context);
		if (!concrete.ok) {
			return concrete;
		}
		element = concrete.value;
	} else if ("type" in element_object.value) {
		const type_ = element_object.value.type;

		if (typeof type_ !== "string") {
			return error("Type of 'type' should be string", at(element_context, "type").path);
		}

		if (type_ === "bool") {
			const bool_ = parse_bool_property("element", element_object.value, element_context);
			if (!bool_.ok) {
				return bool_;
			}
			element = bool_.value;
		} else if (type_ === "enum") {
			const enum_ = parse_enum_property("element", element_object.value, element_context);
			if (!enum_.ok) {
				return enum_;
			}
			element = enum_.value;
		} else if (is_primitive_symbols(type_)) {
			const number_property = parse_number_property("element", element_object.value, element_context);
			if (!number_property.ok) {
				return number_property;
			}
			element = number_property.value;
		} else {
			return error(`Invalid element type '${type_}'`, at(element_context, "type").path);
		}
	} else {
		return error(`Element must have either 'type' or 'include'`, element_context.path);
	}

	const capability = optional(object, "capability", context, capabilityArray);
	if (!capability.ok) {
		return capability;
	}

	return ok({
		_t: "ArrayProperty",
		name: name,
		description: description.value,
		required: required_.value,
		disabled: disabled.value,
		size: size.value,
		element: element,
		capability: capability.value,
	});
}

export function parse_platform_ops_property(name: string, object: Record<string, unknown>, context: ParseContext): Result<PlatformOpsProperty> {
    const description = optionalWithDefault(object, "description", context, "", string_);
    if (!description.ok) {
        return description;
    }

    const required_ = optionalWithDefault(object, "required", context, false, boolean_);
    if (!required_.ok) {
        return required_;
    }

    const capability = optional(object, "capability", context, capabilityArray);
    if (!capability.ok) {
        return capability;
    }

    return ok({
        _t: "PlatformOpsProperty",
        name,
        type: "platform_ops",
        description: description.value,
        required: required_.value,
        capability: capability.value,
    });
}

export function parse_platform_extra_property(name: string, object: Record<string, unknown>, context: ParseContext): Result<PlatformExtraProperty> {
    const description = optionalWithDefault(object, "description", context, "", string_);
    if (!description.ok) {
        return description;
    }

    const required_ = optionalWithDefault(object, "required", context, false, boolean_);
    if (!required_.ok) {
        return required_;
    }

    const capability = optional(object, "capability", context, capabilityArray);
    if (!capability.ok) {
        return capability;
    }

    return ok({
        _t: "PlatformExtraProperty",
        name,
        type: "platform_extra",
        description: description.value,
        required: required_.value,
        capability: capability.value,
    });
}

export function parse_raw_property(name: string, object: Record<string, unknown>, context: ParseContext): Result<RawProperty> {
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

    const capability = optional(object, "capability", context, capabilityArray);
    if (!capability.ok) {
        return capability;
    }

    return ok({
        _t: "RawProperty",
        name,
        type: "raw",
        description: description.value,
        required: required_.value,
        default: default_.value,
        capability: capability.value,
    });
}

// `readonly` marks a member the init function fills in: referenceable, never settable, and
// never emitted. Read here as a decoration rather than in each parse_*_property, because
// only a descriptor's members can be readonly and every property kind can be one.
export function parse_readonly(property: Property, object: Record<string, unknown>, context: ParseContext): Result<Property> {
	const readonly_ = optionalWithDefault(object, "readonly", context, false, boolean_);
	if (!readonly_.ok) {
		return readonly_;
	}

	return ok({ ...property, readonly: readonly_.value });
}
