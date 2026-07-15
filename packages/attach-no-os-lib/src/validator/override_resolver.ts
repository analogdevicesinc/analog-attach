import {
	Effect,
	OverridePredicate,
	OverrideReference,
	Property,
} from "../ruleset_parser/types";
import { Workfile } from "../workfile_handler/types";
import { CollectedRule, ValidationError } from "./types";

export type OverrideResult = {
	effective: Property,
	errors: ValidationError[],
};

// Map a rule-relative ref node to the concrete symbol name it was resolved to at
// collection time. This is THE single place scope is decided — both predicate
// reads and effect targeting go through it, so a "self" target can never again be
// silently dropped by a branch that assumed "parent".
function resolve_node(node: OverrideReference["node"], collected: CollectedRule): string | undefined {
	return node === "self" ? collected.self_symbol : collected.parent_symbol;
}

// Read the current (explicit) value of a referenced property from the workfile.
// P3: only a user-set `value` counts — a `default` is a UI hint and is never read
// here, so equals/hasValue see undefined until the user actually sets the field.
function read_reference(reference: OverrideReference, collected: CollectedRule, workfile: Workfile): unknown {
	const symbol_name = resolve_node(reference.node, collected);
	if (!symbol_name) {
		return undefined;
	}
	const symbol = workfile.symbols[symbol_name];
	if (!symbol || symbol._t !== "RulesetStruct") {
		return undefined;
	}
	return symbol.properties.find(p => p.name === reference.property)?.value;
}

function evaluate_predicate(predicate: OverridePredicate, collected: CollectedRule, workfile: Workfile): boolean {
	switch (predicate._t) {
		case "PredicateAlways": {
			return true;
		}
		case "PredicateEquals": {
			return read_reference(predicate.reference, collected, workfile) === predicate.value;
		}
		case "PredicateHasValue": {
			return read_reference(predicate.reference, collected, workfile) !== undefined;
		}
		case "PredicateAnd": {
			return predicate.predicates.every(p => evaluate_predicate(p, collected, workfile));
		}
	}
}

// Fold one effect onto the effective property. Merge effects write a field;
// selectMember is the sole validate effect (decision #5: never overwrite the
// user's binding, only error if the fired selector contradicts it).
function apply_effect(
	effective: Property,
	effect: Effect,
	symbol_name: string,
	errors: ValidationError[],
): string | undefined {
	switch (effect.op) {
		case "setDefault": {
			(effective as { default?: unknown }).default = effect.value;
			break;
		}
		case "setMin": {
			(effective as { minimum?: number }).minimum = effect.value;
			break;
		}
		case "setMax": {
			(effective as { maximum?: number }).maximum = effect.value;
			break;
		}
		case "setValue": {
			effective.value = effect.value;
			break;
		}
		case "setRequired": {
			effective.required = effect.value;
			break;
		}
		case "setDescription": {
			effective.description = effect.value;
			break;
		}
		case "setPointer": {
			(effective as { pointer?: boolean }).pointer = effect.value;
			break;
		}
		case "setDisabled": {
			effective.disabled = effect.value;
			// Return the reason so the caller's disabled-but-set check can explain WHY —
			// this is what makes a lowered $mutex produce a good error. The reason is
			// transient (it only lives across this fold), so it never touches the property.
			return effect.value ? effect.reason : undefined;
		}
		case "restrictValues": {
			// Narrows the selectable set. Lands on `.values` regardless of the target's
			// static _t (an include-to-enum pin is still IncludeProperty here); whether
			// validate_include honors it is a decision-#3 reconciliation item.
			(effective as { values?: unknown[] }).values = effect.values;
			break;
		}
		case "restrictAllowed": {
			(effective as { allowed?: string[] }).allowed = effect.ids;
			break;
		}
		case "selectMember": {
			// Union: validate, don't mutate. The stored value is {member: binding};
			// if the user bound a different member than the rule selects, that is an error.
			const value = effective.value as Record<string, unknown> | undefined;
			if (value && typeof value === "object") {
				const chosen = Object.keys(value)[0];
				if (chosen !== effect.member) {
					errors.push({
						path: `${symbol_name}.${effect.reference.property}`,
						message: `Union member '${chosen}' contradicts the required member '${effect.member}'`,
						severity: "error",
					});
				}
			}
			break;
		}
	}
}

// Compute the effective property for `property` (which belongs to `symbol_name`)
// by folding every collected rule whose condition holds. Refs are already resolved
// to concrete symbols (collection time); here we only read/write through them.
export function apply_overrides(
	property: Property,
	collected_rules: CollectedRule[],
	symbol_name: string,
	workfile: Workfile,
): OverrideResult {
	const effective = structuredClone(property);
	const errors: ValidationError[] = [];

	// Why this property ended up disabled, if it did (e.g. "mutually exclusive with
	// spi_init"). Transient to this fold — used only for the disabled-but-set error.
	let disable_reason: string | undefined;

	for (const collected of collected_rules) {
		if (!evaluate_predicate(collected.rule.when, collected, workfile)) {
			continue;
		}

		for (const effect of collected.rule.effects) {
			const target_symbol = resolve_node(effect.reference.node, collected);
			if (target_symbol !== symbol_name || effect.reference.property !== property.name) {
				continue;
			}
			const reason = apply_effect(effective, effect, symbol_name, errors);
			if (effect.op === "setDisabled") {
				disable_reason = reason;
			}
		}
	}

	// General disabled-but-set check (subsumes the old mutex special case): a
	// disabled property that still carries an explicit value is an error, explained
	// by whichever disable effect fired. A disabled-and-unset property is fine — it
	// just skips its required check downstream.
	if (effective.disabled && effective.value !== undefined) {
		errors.push({
			path: `${symbol_name}.${property.name}`,
			message: disable_reason ?? `Property '${property.name}' is disabled but has a value`,
			severity: "error",
		});
	}

	return { effective, errors };
}
