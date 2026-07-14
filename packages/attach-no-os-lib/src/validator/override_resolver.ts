import {
	OverrideCondition,
	OverrideMutex,
	Property,
	PropertyOverride,
	RulesetStruct
} from "../ruleset_parser/types";
import { ParseContext } from "../ruleset_parser/validators";
import { ChildOverride, ValidationError } from "./types";

export function apply_overrides(
	property: Property,
	child_overrides: ChildOverride[],
	parent_symbol: RulesetStruct,
): Property {
	const effective = structuredClone(property);

	for (const { directive, child } of child_overrides) {
		switch (directive._t) {
			case "OverrideStatic": {
				if (directive.scope !== "$parent") {
					break;
				}
				if (directive.target === property.name) {
					merge_override(effective, directive.override);
				}
				break;
			}
			case "OverrideSwitch": {
				const on_symbol = directive.scope === "$parent" ? parent_symbol : child;
				const on_property = on_symbol.properties.find(property => property.name === directive.$on);
				if (!on_property) {
					break;
				}

				const matching_case = directive.$cases.find(_case => _case.condition === on_property.value);
				if (!matching_case) {
					break;
				}

				for (const target_override of matching_case.overrides) {
					if (target_override.target === property.name && target_override.scope === "$parent") {
						merge_override(effective, target_override.override);
					}
				}
				break;
			}
			case "OverrideIfThen": {
				const cond_symbol = directive.condition.scope === "$parent" ? parent_symbol : child;
				if (!evaluate_condition(directive.condition, cond_symbol)) {
					break;
				}

				for (const target_override of directive.overrides) {
					if (target_override.scope === "$parent" && target_override.target === property.name) {
						merge_override(effective, target_override.override);
					}
				}

				break;
			}
			case "OverrideMutex": {
				// The both-set-is-an-error case is reported by validate_mutex. Here we
				// resolve the other half of the mutex: if this property belongs to the
				// group, has no value of its own, but a sibling member does have a
				// value, then this property is disabled — the user picked the sibling,
				// so a `required` flag on this one must not fire. Only apply in the
				// scope that actually constrains this symbol.
				const is_self = child === parent_symbol;
				const applies = directive.scope === "$this" ? is_self : !is_self;
				if (!applies || !directive.properties.includes(property.name)) {
					break;
				}

				// Values are read from the symbol being validated (parent_symbol in
				// both enforced scopes: it is either the mutex's own struct or the parent).
				const self_has_value = parent_symbol.properties
					.find(p => p.name === property.name)?.value !== undefined;
				const sibling_has_value = directive.properties.some(name =>
					name !== property.name &&
					parent_symbol.properties.find(p => p.name === name)?.value !== undefined
				);

				if (!self_has_value && sibling_has_value) {
					effective.disabled = true;
				}
				break;
			}
		}
	}

	return effective;
}

function merge_override(property: Property, override: PropertyOverride): void {
	Object.assign(property, override);
}

function evaluate_condition(
	condition: OverrideCondition,
	symbol: RulesetStruct
): boolean {
	const property = symbol.properties.find(p => p.name === condition.target);
	if (!property) {
		return false;
	}

	return property.value === condition.value;
}

export function validate_mutex(
	mutex: OverrideMutex,
	symbol: RulesetStruct,
	declaring_child: RulesetStruct,
	context: ParseContext
): ValidationError[] {
	// A directive is "self-declared" when the symbol that declared it is the same
	// one currently being validated. A $this mutex only constrains its own symbol;
	// a $parent mutex only constrains the parent that includes the declaring child.
	const is_self = declaring_child === symbol;
	if (mutex.scope === "$this" && !is_self) {
		return []; // $this mutex enforced only while validating its own symbol
	}
	if (mutex.scope === "$parent" && is_self) {
		return []; // $parent mutex enforced only while validating the parent
	}

	// In both enforced cases the constrained properties live on `symbol` (the
	// symbol being validated is either the mutex's own struct or the parent).
	const properties_with_values = mutex.properties.filter(property_name => {
		const property = symbol.properties.find(p => p.name === property_name);
		return property?.value !== undefined;
	});

	if (properties_with_values.length > 1) {
		return [{
			path: context.path,
			message: `Mutex failed: only one of [${mutex.properties.join(", ")}] can have a value. Found values in: ${properties_with_values.join(", ")}`,
			severity: "error"
		}];
	}

	return [];
}
