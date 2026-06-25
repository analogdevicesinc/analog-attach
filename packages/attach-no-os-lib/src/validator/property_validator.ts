import {
	ArrayProperty,
	BooleanProperty,
	EnumProperty,
	IncludeProperty,
	NumberProperty,
	PlatformExtraProperty,
	PlatformOpsProperty,
	Property,
	RulesetStruct,
	StringProperty,
	UnionProperty
} from "../bindings_parser/types";
import { at, ParseContext } from "../bindings_parser/validators";
import { Workfile } from "../workfile_handler/types";
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

	if (property.disabled) {
		return []; // NOTE: Disabled will not be taken into account
	}

	const effective = apply_overrides(property, child_overrides, parent_symbol);

	if (effective.value === undefined) {
		if (!effective.required) {
			return [];
		}

		// FIXME: This might not be supposed to be checked here, might move elsewhere
		// Skip required check for platform_extra if no valid extras exist (excluding self)
		if (effective._t === "PlatformExtraProperty" &&
			!Object.values(workfile.symbols).some(s =>
				s !== parent_symbol && s._t === "BindingStuct" && s.$capability === parent_symbol.$capability)) {
			return [];
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
			return validate_include(effective, workfile, property_context);
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

	if (ops._t !== "BindingPlatformOps") {
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

	if (extra._t !== "BindingStuct") {
		return [{
			path: context.path,
			message: `Expected type strucy, got ${extra._t}`,
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
    property: IncludeProperty,
    workfile: Workfile,
    context: ParseContext
): ValidationError[] {
    const target_symbol_name = property.value as string;
    const target = workfile.symbols[target_symbol_name];

    if (!target) {
        return [{
            path: context.path,
            message: `Target symbol '${target_symbol_name}' not found`,
            severity: "error"
        }];
    }

    if (target.$id !== property.include) {
        return [{
            path: context.path,
            message: `Type mismatch: '${target_symbol_name}' is '${target.$id}', expected '${property.include}'`,
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
    const value = property.value as string[];

    if (property.element._t !== "IncludeProperty") {
        // Array of primitives - no symbol validation needed
        // Could add per-element type validation here later
        return [];
    }

    if (value.length !== property.size) {
        return [{
            path: context.path,
            message: `Array must have ${property.size} elements, got ${value.length}`,
            severity: "error"
        }];
    }

    const element = property.element;
    for (const [index, target_symbol_name] of value.entries()) {
        const target = workfile.symbols[target_symbol_name];

        if (!target) {
            errors.push({
                path: at(context, index).path,
                message: `Target symbol '${target_symbol_name}' not found`,
                severity: "error"
            });
            continue;
        }

        if (target.$id !== element.include) {
            errors.push({
                path: at(context, index).path,
                message: `Type mismatch: '${target_symbol_name}' is '${target.$id}', expected '${element.include}'`,
                severity: "error"
            });
        }
    }

    return errors;
}

