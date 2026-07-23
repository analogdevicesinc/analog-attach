import type { Result } from "./result";
import { error, ok } from "./result";
import type {
	Effect,
	OverridePredicate,
	OverrideReference,
	OverrideScope,
	Property,
	Rule,
} from "./types";
import { lower_condition, lower_effects } from "./override_model";
import type { ParseContext} from "./validators";
import { asObject, at, required, string_ } from "./validators";

// $this refers to the declaring symbol's own property (self); $parent refers to
// a symbol that includes the declaring symbol. The YAML $this/$parent tokens are
// the authoring surface; once lowered, every reference is a plain {node, property}
// relative pointer that the engine resolves to concrete symbols exactly once.
function scope_to_node(scope: OverrideScope): OverrideReference["node"] {
	return scope === "$parent" ? "parent" : "self";
}

// Resolve a property name against the declaring document. $this targets must name
// a real local property; $parent targets cannot be resolved here (the parent is
// whatever device includes this symbol later), so they return ok(undefined) and
// their type-relative checks are deferred to the engine.
function require_property(context: ParseContext, name: string, scope: OverrideScope): Result<Property> {
	if (scope === "$parent") {
		return ok();
	}

	const property = context.document.properties?.find(p => p.name === name);
	if (!property) {
		const known = context.document.properties?.map(p => p.name).join(", ") ?? "none";
		return error(`Unknown property '${name}'. Known: ${known}`, at(context, name).path);
	}
	return ok(property);
}

// A body is the shared shape of a $then block, a $switch case, and a static
// directive: an object whose keys are either $this/$parent scope selectors (which
// recurse with a new scope) or property names (which lower to effects). This is
// the single place target scope is decided for effects.
function lower_effects_body(
	object: Record<string, unknown>,
	context: ParseContext,
	scope: OverrideScope,
): Result<Effect[]> {
	const effects: Effect[] = [];

	for (const [key, value] of Object.entries(object)) {
		if (key === "$this" || key === "$parent") {
			const nested = asObject(value, at(context, key));
			if (!nested.ok) { return nested; }

			const nested_effects = lower_effects_body(nested.value, at(context, key), key);
			if (!nested_effects.ok) { return nested_effects; }
			effects.push(...nested_effects.value);
			continue;
		}

		const target_property = require_property(context, key, scope);
		if (!target_property.ok) { return target_property; }

		const override_object = asObject(value, at(context, key));
		if (!override_object.ok) { return override_object; }

		const reference: OverrideReference = { node: scope_to_node(scope), property: key };
		const lowered = lower_effects(override_object.value, reference, at(context, key), target_property.value);
		if (!lowered.ok) { return lowered; }
		effects.push(...lowered.value);
	}

	return ok(effects);
}

// Symmetric to lower_effects_body, but for the condition side of a $if. Multiple
// property tests AND together (P1: PredicateAnd); condition scope is independent
// of effect scope, and both inherit the enclosing directive scope by default.
function lower_condition_body(
	object: Record<string, unknown>,
	context: ParseContext,
	scope: OverrideScope,
): Result<OverridePredicate> {
	const predicates: OverridePredicate[] = [];

	for (const [key, value] of Object.entries(object)) {
		if (key === "$this" || key === "$parent") {
			const nested = asObject(value, at(context, key));
			if (!nested.ok) { return nested; }

			const nested_predicate = lower_condition_body(nested.value, at(context, key), key);
			if (!nested_predicate.ok) { return nested_predicate; }
			predicates.push(nested_predicate.value);
			continue;
		}

		const target_property = require_property(context, key, scope);
		if (!target_property.ok) { return target_property; }

		const operator_object = asObject(value, at(context, key));
		if (!operator_object.ok) { return operator_object; }

		const reference: OverrideReference = { node: scope_to_node(scope), property: key };
		const predicate = lower_condition(operator_object.value, reference, at(context, key));
		if (!predicate.ok) { return predicate; }
		predicates.push(predicate.value);
	}

	if (predicates.length === 0) {
		return error("Condition must specify at least one property", context.path);
	}
	if (predicates.length === 1) {
		return ok(predicates[0]);
	}
	return ok({ _t: "PredicateAnd", predicates });
}

// Static directive: no condition, always applies.
function lower_static(object: Record<string, unknown>, context: ParseContext, scope: OverrideScope): Result<Rule[]> {
	const effects = lower_effects_body(object, context, scope);
	if (!effects.ok) { return effects; }
	return ok([{ when: { _t: "PredicateAlways" }, effects: effects.value }]);
}

// $if/$then: one rule whose `when` is the lowered condition and whose effects are
// the lowered $then body. Condition and effect scopes are independent.
function lower_if_then(object: Record<string, unknown>, context: ParseContext, scope: OverrideScope): Result<Rule[]> {
	const if_object = asObject(object.$if, at(context, "$if"));
	if (!if_object.ok) { return if_object; }

	const when = lower_condition_body(if_object.value, at(context, "$if"), scope);
	if (!when.ok) { return when; }

	const then_object = asObject(object.$then, at(context, "$then"));
	if (!then_object.ok) { return then_object; }

	const effects = lower_effects_body(then_object.value, at(context, "$then"), scope);
	if (!effects.ok) { return effects; }

	return ok([{ when: when.value, effects: effects.value }]);
}

// $switch fans out to N equals-rules sharing the $on reference (P2): each case
// becomes Rule{ when: equals(<on>, caseName), effects: <case body> }. No switch
// construct survives lowering.
function lower_switch(object: Record<string, unknown>, context: ParseContext, scope: OverrideScope): Result<Rule[]> {
	const switch_object = asObject(object.$switch, at(context, "$switch"));
	if (!switch_object.ok) { return switch_object; }

	const $on = required(switch_object.value, "$on", at(context, "$switch"), string_);
	if (!$on.ok) { return $on; }

	const on_property = require_property(context, $on.value, scope);
	if (!on_property.ok) { return on_property; }

	const $cases = required(switch_object.value, "$cases", at(context, "$switch"), asObject);
	if (!$cases.ok) { return $cases; }

	const cases_context = at(at(context, "$switch"), "$cases");
	const on_reference: OverrideReference = { node: scope_to_node(scope), property: $on.value };
	const rules: Rule[] = [];

	for (const [case_name, case_value] of Object.entries($cases.value)) {
		if (
			scope === "$this" &&
			on_property.value._t === "EnumProperty" &&
			!on_property.value.values.includes(case_name)
		) {
			return error(
				`Invalid case '${case_name}'. Valid values: ${on_property.value.values.join(", ")}`,
				at(cases_context, case_name).path
			);
		}

		const case_object = asObject(case_value, at(cases_context, case_name));
		if (!case_object.ok) { return case_object; }

		const effects = lower_effects_body(case_object.value, at(cases_context, case_name), scope);
		if (!effects.ok) { return effects; }

		rules.push({
			when: { _t: "PredicateEquals", reference: on_reference, value: case_name },
			effects: effects.value,
		});
	}

	return ok(rules);
}

// $mutex lowers to plain rules, not a special case (D2): for each member x,
// `when hasValue(x) -> disable every sibling, reason "mutually exclusive with x"`.
// A separate general check (disabled-but-set -> error(reason)) reports the both-set
// case using that reason, so no mutex-specific evaluator is needed.
function lower_mutex(object: Record<string, unknown>, context: ParseContext, scope: OverrideScope): Result<Rule[]> {
	const $mutex = object.$mutex;
	if (!Array.isArray($mutex)) {
		return error("$mutex must be an array of property names", at(context, "$mutex").path);
	}

	const mutex_context = at(context, "$mutex");
	const names: string[] = [];
	for (const [index, item] of $mutex.entries()) {
		if (typeof item !== "string") {
			return error(`Expected string, got ${typeof item}`, at(mutex_context, index).path);
		}
		const property = require_property(context, item, scope);
		if (!property.ok) { return property; }
		names.push(item);
	}

	if (names.length < 2) {
		return error("$mutex must have at least 2 properties", mutex_context.path);
	}

	const node = scope_to_node(scope);
	const rules: Rule[] = names.map(x => ({
		when: { _t: "PredicateHasValue", reference: { node, property: x } },
		effects: names
			.filter(other => other !== x)
			.map(other => ({
				op: "setDisabled" as const,
				reference: { node, property: other },
				value: true,
				reason: `mutually exclusive with ${x}`,
			})),
	}));

	return ok(rules);
}

// One array element -> one or more rules. A leading $this/$parent wrapper only
// changes the directive scope, then recurses.
function lower_directive(value: unknown, context: ParseContext, scope: OverrideScope): Result<Rule[]> {
	const object = asObject(value, context);
	if (!object.ok) { return object; }

	if ("$parent" in object.value) {
		return lower_directive(object.value.$parent, at(context, "$parent"), "$parent");
	}
	if ("$this" in object.value) {
		return lower_directive(object.value.$this, at(context, "$this"), "$this");
	}

	if ("$switch" in object.value) {
		return lower_switch(object.value, context, scope);
	}
	if ("$if" in object.value) {
		return lower_if_then(object.value, context, scope);
	}
	if ("$mutex" in object.value) {
		return lower_mutex(object.value, context, scope);
	}

	return lower_static(object.value, context, scope);
}

function lower_override_array(value: unknown, context: ParseContext, scope: OverrideScope): Result<Rule[]> {
	if (!Array.isArray(value)) {
		return error("Expected array", context.path);
	}

	const rules: Rule[] = [];
	for (const [index, element] of value.entries()) {
		const lowered = lower_directive(element, at(context, index), scope);
		if (!lowered.ok) { return lowered; }
		rules.push(...lowered.value);
	}

	return ok(rules);
}

// Entry point consumed by parse_ruleset. $override is either a bare array
// (implicit $this) or an object with a $this/$parent selector wrapping the array.
export function is_override(value: unknown, context: ParseContext): Result<Rule[]> {
	if (Array.isArray(value)) {
		return lower_override_array(value, context, "$this");
	}

	const object = asObject(value, context);
	if (!object.ok) { return object; }

	if ("$parent" in object.value) {
		return lower_override_array(object.value.$parent, at(context, "$parent"), "$parent");
	}
	if ("$this" in object.value) {
		return lower_override_array(object.value.$this, at(context, "$this"), "$this");
	}

	return error("$override must be an array or object with $this/$parent", context.path);
}
