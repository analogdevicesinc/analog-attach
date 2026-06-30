import {
	OverrideCondition,
	OverrideMutex,
	Property,
	PropertyOverride,
	RulesetDevice,
	RulesetStruct
} from "../ruleset_parser/types";
import { ParseContext } from "../ruleset_parser/validators";
import { ChildOverride, ValidationError } from "./types";

export function apply_overrides(
	property: Property,
	child_overrides: ChildOverride[],
	parent_symbol: RulesetStruct | RulesetDevice,
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
				// NOTE: This case is handled separately in validation as it is simple
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
	symbol: RulesetStruct | RulesetDevice
): boolean {
	const property = symbol.properties.find(p => p.name === condition.target);
	if (!property) {
		return false;
	}

	return property.value === condition.value;
}

export function validate_mutex(
	mutex: OverrideMutex,
	symbol: RulesetStruct | RulesetDevice,
	context: ParseContext
): ValidationError[] {
	if (mutex.scope !== "$parent") {
		return []; // $this is handled when validating the child
	}

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
