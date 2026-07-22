import { error, ok, Result } from "./result";
import {
	ArrayElement,
	ArrayProperty,
	BooleanProperty,
	CallbackContextProperty,
	CallbackFunctionProperty,
	EnumProperty,
	IncludeProperty,
	is_primitive_symbols,
	NumberProperty,
	PlatformExtraProperty,
	PlatformOpsProperty,
	StringProperty,
	UnionProperty
} from "./types";
import {
	asObject,
	at,
	boolean_,
	number_,
	optional,
	optionalWithDefault,
	ParseContext,
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

	// TODO: maybe make this an optionalWithDefault and figure out the value
	const minimum = optional(object, "minimum", context, number_);
	if (!minimum.ok) {
		return minimum;
	}

	const maximum = optional(object, "maximum", context, number_);
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
		return error(`Default value '${default_.value}' is not present in the 'values' field (${JSON.stringify(values.value)})`, at(context, "default").path);
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
	const include = required(object, "include", context, string_);
	if (!include.ok) {return include;}

	const description = optionalWithDefault(object, "description", context, "", string_);
	if (!description.ok) {return description;}

	const required_ = optionalWithDefault(object, "required", context, false, boolean_);
	if (!required_.ok) {return required_;}

	const pointer = optionalWithDefault(object, "pointer", context, false, boolean_);
	if (!pointer.ok) {return pointer;}

	const capability = optional(object, "capability", context, capabilityArray);
	if (!capability.ok) {return capability;}

	return ok({
		_t: "IncludeProperty",
		name,
		description: description.value,
		required: required_.value,
		include: include.value,
		pointer: pointer.value,
		capability: capability.value,
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
	const size = required(object, "size", context, number_);
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

	if ("include" in element_object.value) {
		const include = parse_include_property("element", element_object.value, element_context);
		if (!include.ok) {
			return include;
		}
		element = include.value;
	} else if ("type" in element_object.value) {
		const type_ = element_object.value["type"];

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
		} else if (is_primitive_symbols(type_ as string)) {
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

export function parse_callback_function_property(name: string, object: Record<string, unknown>, context: ParseContext): Result<CallbackFunctionProperty> {
    const description = optionalWithDefault(object, "description", context, "", string_);
    if (!description.ok) {
        return description;
    }

    const required_ = optionalWithDefault(object, "required", context, false, boolean_);
    if (!required_.ok) {
        return required_;
    }

    const signature = required(object, "signature", context, string_);
    if (!signature.ok) {
        return signature;
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
        _t: "CallbackFunctionProperty",
        name,
        type: "callback_func",
        description: description.value,
        required: required_.value,
        signature: signature.value,
        default: default_.value,
        capability: capability.value,
    });
}

export function parse_callback_context_property(name: string, object: Record<string, unknown>, context: ParseContext): Result<CallbackContextProperty> {
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
        _t: "CallbackContextProperty",
        name,
        type: "callback_ctx",
        description: description.value,
        required: required_.value,
        default: default_.value,
        capability: capability.value,
    });
}
