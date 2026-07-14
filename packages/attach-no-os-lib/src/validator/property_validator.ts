import {
	ArrayProperty,
	BooleanProperty,
	EnumProperty,
	NumberProperty,
	PlatformExtraProperty,
	PlatformOpsProperty,
	Property,
	RulesetStruct,
	StringProperty,
	UnionProperty
} from "../ruleset_parser/types";
import { at, ParseContext } from "../ruleset_parser/validators";
import { Workfile } from "../workfile_handler/types";
import { find_symbol_by_descriptor, suggest_platform_extra } from "../workfile_handler/workfile_handler";
import { load_resolved_ruleset } from "../resolver/resolver";
import { apply_overrides } from "./override_resolver";
import { ChildOverride, ValidationError } from "./types";

export function validate_property(
	property: Property,
	child_overrides: ChildOverride[],
	parent_symbol: RulesetStruct,
	workfile: Workfile,
	context: ParseContext
): ValidationError[] {
	const property_context = at(context, property.name);

	const effective = apply_overrides(property, child_overrides, parent_symbol);

	// Check disabled AFTER applying overrides: a property may be disabled statically
	// (disabled: true in the ruleset) or dynamically (e.g. the unchosen member of a
	// mutex). Either way a disabled property is skipped, including its required check.
	if (effective.disabled) {
		return []; // NOTE: Disabled will not be taken into account
	}

	if (effective.value === undefined) {
		if (!effective.required) {
			return [];
		}

		// This might be an odd check, but if there is no "extra" struct for this platform, assume
		// it is okay and do not return error even if the "extra" property is required.
		if (effective._t === "PlatformExtraProperty") {
			const suggestions = suggest_platform_extra(workfile, effective, parent_symbol);
			if (!suggestions.ok || !suggestions.value.types || suggestions.value.types.length === 0) {
				return []; // no possible extra for this, assume there is none
			}
		}

		return [{
			path: property_context.path,
			message: "Required property has no value",
			severity: "error"
		}];
	}

	switch (effective._t) {
		case "NumberProperty": {
			return validate_number(effective, property_context);
		}
		case "BooleanProperty": {
			return validate_boolean(effective, property_context);
		}
		case "StringProperty": {
			return validate_string(effective, property_context);
		}
		case "IncludeProperty": {
			return validate_include(effective.value as string, effective.include, workfile, property_context);
		}
		case "IncludeDescriptorProperty": {
			return validate_include_descriptor(effective.value as string, effective.include_descriptor, workfile, property_context);
		}
		case "EnumProperty": {
			return validate_enum(effective, property_context);
		}
		case "UnionProperty": {
			return validate_union(effective, workfile, property_context);
		}
		case "ArrayProperty": {
			return validate_array(effective, workfile, property_context);
		}
		case "PlatformOpsProperty": {
			return validate_platform_ops(effective, workfile, parent_symbol, property_context);
		}
		case "PlatformExtraProperty": {
			return validate_platform_extra(effective, workfile, parent_symbol, property_context);
		}
		case "CallbackFunctionProperty": {
			return []; // NOTE: Nothing to validate
		}
		case "CallbackContextProperty": {
			return []; // NOTE: Nothing to validate
		}
		default: {
			// NOTE: No validation error as this case should have
			// been caught by the ruleset_parser validator
			return [];
		}
	}
}

function validate_platform_ops(
	property: PlatformOpsProperty,
	workfile: Workfile,
	parent_struct: RulesetStruct,
	context: ParseContext
): ValidationError[] {
	const symbol_name = property.value as string;

	const ops = workfile.platform_ops[symbol_name];
	if (!ops) {
		return [{
			path: context.path,
			message: `Platform ops '${symbol_name}' not found`,
			severity: "error"
		}];
	}

	if (ops._t !== "RulesetPlatformOps") {
		return [{
			path: context.path,
			message: `Expected type platform_ops, got ${ops._t}`,
			severity: "error"
		}];
	}

	if (property.allowed) {
		if (!property.allowed.includes(ops.$id)) {
			return [{
				path: context.path,
				message: `Platform ops '${symbol_name}' ($id: ${ops.$id}) is not in the allowed list: ${property.allowed.join(", ")}`,
				severity: "error"
			}];
		}

		if (parent_struct.$capability && ops.$capability !== parent_struct.$capability) {
			return [{
				path: context.path,
				message: `Capability mismatch: ops is '${ops.$capability}', expected ${parent_struct.$capability} (allowed by override)`,
				severity: "warning"
			}];
		}

		return [];
	}

	if (parent_struct.$capability && ops.$capability !== parent_struct.$capability) {
		return [{
			path: context.path,
			message: `Capability mismatch: ops is '${ops.$capability}', expected '${parent_struct.$capability}'`,
			severity: "error"
		}];
	}

	return [];
}

function validate_platform_extra(
	property: PlatformExtraProperty,
	workfile: Workfile,
	parent_struct: RulesetStruct,
	context: ParseContext
): ValidationError[] {
	const symbol_name = property.value as string;

	const extra = workfile.symbols[symbol_name];
	if (!extra) {
		return [{
			path: context.path,
			message: `Platform extra '${symbol_name}' not found`,
			severity: "error"
		}];
	}

	if (extra._t !== "RulesetStruct") {
		return [{
			path: context.path,
			message: `Expected type struct or device, got ${extra._t}`,
			severity: "error"
		}];
	}

	if (property.allowed) {
		if (!property.allowed.includes(extra.$id)) {
			return [{
				path: context.path,
				message: `Platform extra '${symbol_name}' ($id: ${extra.$id}) is not in the allowed list: ${property.allowed.join(", ")}`,
				severity: "error"
			}];
		}

		if (parent_struct.$capability && extra.$capability !== parent_struct.$capability) {
			return [{
				path: context.path,
				message: `Capability mismatch: extra is '${extra.$capability}', expected ${parent_struct.$capability} (allowed by override)`,
				severity: "warning"
			}];
		}

		return [];
	}
	
	if (parent_struct.$capability && extra.$capability !== parent_struct.$capability) {
		return [{
			path: context.path,
			message: `Capability mismatch: extra is '${extra.$capability}', expected '${parent_struct.$capability}'`,
			severity: "error"
		}];
	}

	return [];
}

function validate_number(property: NumberProperty, context: ParseContext): ValidationError[] {
	const errors: ValidationError[] = [];
	const value = property.value;
	
	if (typeof value !== "number") {
		errors.push({
			path: context.path,
			message: `Expected number, got ${typeof value}`,
			severity: "error"
		});
		return errors; // No reason to continue
	}

	if (property.minimum !== undefined && value < property.minimum) {
		errors.push({
			path: context.path,
			message: `Value ${value} is below the minimum ${property.minimum}`,
			severity: "error"
		});
	}

	if (property.maximum !== undefined && value > property.maximum) {
		errors.push({
			path: context.path,
			message: `Value ${value} is above the maximum ${property.maximum}`,
			severity: "error"
		});
	}

	return errors;
}

function validate_boolean(property: BooleanProperty, context: ParseContext): ValidationError[] {
	if (typeof property.value !== "boolean") {
		return [{
			path: context.path,
			message: `Expected boolean, got ${typeof property.value}`,
			severity: "error"
		}];
	}

	return [];
}

function validate_string(property: StringProperty, context: ParseContext): ValidationError[] {
	if (typeof property.value !== "string") {
		return [{
			path: context.path,
			message: `Expected string, got ${typeof property.value}`,
			severity: "error"
		}];
	}

	return [];
}

function validate_enum(property: EnumProperty, context: ParseContext): ValidationError[] {
    const value = property.value;

    if (!property.values.includes(value)) {
        return [{
            path: context.path,
            message: `Invalid value '${value}'. Expected one of: ${property.values.join(", ")}`,
            severity: "error"
        }];
    }
    return [];
}

function validate_include(
    value: string,
    include_path: string,
    workfile: Workfile,
    context: ParseContext
): ValidationError[] {
    const resolved = load_resolved_ruleset(include_path);

    if (resolved.ok && resolved.value._t === "RulesetEnum") {
        const valid_values = resolved.value.values.map(v => v.name);
        if (!valid_values.includes(value)) {
            return [{
                path: context.path,
                message: `Invalid value '${value}'. Expected one of: ${valid_values.join(", ")}`,
                severity: "error"
            }];
        }
        return [];
    }

    const target = workfile.symbols[value];

    if (!target) {
        return [{
            path: context.path,
            message: `Target symbol '${value}' not found`,
            severity: "error"
        }];
    }

    if (target.$id !== include_path) {
        return [{
            path: context.path,
            message: `Type mismatch: '${value}' is '${target.$id}', expected '${include_path}'`,
            severity: "error"
        }];
    }

    return [];
}

function validate_include_descriptor(
    descriptor_name: string,
    include_descriptor_path: string,
    workfile: Workfile,
    context: ParseContext
): ValidationError[] {
    // Find the symbol that has this descriptor name
    const symbol_name = find_symbol_by_descriptor(workfile, descriptor_name);

    if (!symbol_name) {
        return [{
            path: context.path,
            message: `Descriptor '${descriptor_name}' not found. No symbol declares this descriptor name.`,
            severity: "error"
        }];
    }

    const symbol = workfile.symbols[symbol_name];
    if (!symbol || symbol._t !== "RulesetStruct") {
        return [{
            path: context.path,
            message: `Symbol '${symbol_name}' for descriptor '${descriptor_name}' is not a struct`,
            severity: "error"
        }];
    }

    // Check that the symbol's schema matches the expected include_descriptor path
    if (symbol.$id !== include_descriptor_path) {
        return [{
            path: context.path,
            message: `Type mismatch: descriptor '${descriptor_name}' belongs to '${symbol.$id}', expected '${include_descriptor_path}'`,
            severity: "error"
        }];
    }

    return [];
}

function validate_union(
    property: UnionProperty,
    workfile: Workfile,
    context: ParseContext
): ValidationError[] {
    const value = property.value as Record<string, string>;

    const keys = Object.keys(value);
    if (keys.length !== 1) {
        return [{
            path: context.path,
            message: `Union value must have exactly one key`,
            severity: "error"
        }];
    }

    const selected_member_name = keys[0];
    const target_symbol_name = value[selected_member_name];

    const member = property.members.find(m => m.name === selected_member_name);
    if (!member) {
        return [{
            path: at(context, selected_member_name).path,
            message: `Unknown union member '${selected_member_name}'`,
            severity: "error"
        }];
    }

    const target = workfile.symbols[target_symbol_name];
    if (!target) {
        return [{
            path: at(context, selected_member_name).path,
            message: `Target symbol '${target_symbol_name}' not found`,
            severity: "error"
        }];
    }

    if (target.$id !== member.include) {
        return [{
            path: at(context, selected_member_name).path,
            message: `Type mismatch: '${target_symbol_name}' is '${target.$id}', expected '${member.include}'`,
            severity: "error"
        }];
    }

    return [];
}

function validate_array(
    property: ArrayProperty,
    workfile: Workfile,
    context: ParseContext
): ValidationError[] {
    const errors: ValidationError[] = [];
    const value = property.value as string[] | undefined;

    if (!value) {
        return [];
    }

    if (!Array.isArray(value)) {
        return [{
            path: context.path,
            message: `Expected array, got ${typeof value}`,
            severity: "error"
        }];
    }

    if (value.length === 0) {
        return [];
    }

    if (value.length > property.size) {
        return [{
            path: context.path,
            message: `Array exceeds maximum size of ${property.size}, got ${value.length}`,
            severity: "error"
        }];
    }

    if (property.element._t === "IncludeProperty") {
        for (const [index, element_value] of value.entries()) {
            const element_errors = validate_include(
                element_value,
                property.element.include,
                workfile,
                at(context, index)
            );
            errors.push(...element_errors);
        }
    }

    return errors;
}

