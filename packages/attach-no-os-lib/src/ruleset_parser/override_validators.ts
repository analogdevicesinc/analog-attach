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
function scope_to_node(scope: OverrideScope): "self" | "parent" {
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

// What a body lowers to: the effects that apply whenever the body does, plus rules for
// directives nested inside it (`$any_of`), which carry a condition of their own. The
// caller ANDs its condition onto those - see `conditioned`.
interface LoweredBody {
	effects: Effect[],
	nested: Rule[],
}

function and_predicates(outer: OverridePredicate, inner: OverridePredicate): OverridePredicate {
	if (outer._t === "PredicateAlways") { return inner; }
	if (inner._t === "PredicateAlways") { return outer; }
	const flatten = (predicate: OverridePredicate) => predicate._t === "PredicateAnd" ? predicate.predicates : [predicate];
	return { _t: "PredicateAnd", predicates: [...flatten(outer), ...flatten(inner)] };
}

// A body under a condition: one rule for its own effects, and each nested rule with the
// condition ANDed in front. So an `$any_of` inside a `$switch` case fires only in that case.
// A body holding nothing but nested directives contributes no empty rule of its own.
function conditioned(when: OverridePredicate, body: LoweredBody): Rule[] {
	const own = body.effects.length > 0 || body.nested.length === 0
		? [{ when, effects: body.effects }]
		: [];
	return [
		...own,
		...body.nested.map(rule => ({ when: and_predicates(when, rule.when), effects: rule.effects })),
	];
}

// Where an `$any_of`'s members live: on the node declaring it (or its parent), or on the
// node a union member points at. Only the first can be checked against this file.
interface MemberTarget {
	reference: (property: string) => OverrideReference,
	check: (property: string, context: ParseContext) => Result<unknown>,
}

function scope_target(scope: OverrideScope, context: ParseContext): MemberTarget {
	return {
		reference: property => ({ node: scope_to_node(scope), property }),
		check: (property) => require_property(context, property, scope),
	};
}

function describe_member(property: string, predicate: OverridePredicate): string {
	switch (predicate._t) {
		case "PredicateNoneOf": {
			return `${property} other than ${predicate.values.map(String).join(" or ")}`;
		}
		case "PredicateEquals": {
			return `${property} = ${String(predicate.value)}`;
		}
		default: {
			return property;
		}
	}
}

// `$any_of: [cs_gpio, {native_cs: {not: 0}}]` - at least one member must hold. A bare name
// holds when it has a value; a `{name: condition}` member holds when its condition does,
// which is what lets a bitmask's 0 count as "nothing selected".
//
// Lowers to ONE rule: when no member holds, every member becomes required, with a reason
// naming them all. A member that already has a value passes its required check, so the
// error lands on the ones still missing. Both holding is fine: this is a lower bound only.
function lower_any_of(value: unknown, context: ParseContext, target: MemberTarget): Result<Rule> {
	if (!Array.isArray(value)) {
		return error("$any_of must be an array of property names or {property: condition} entries", context.path);
	}

	const members: { property: string, holds: OverridePredicate }[] = [];
	for (const [index, item] of value.entries()) {
		const item_context = at(context, index);

		if (typeof item === "string") {
			const checked = target.check(item, context);
			if (!checked.ok) { return checked; }
			members.push({ property: item, holds: { _t: "PredicateHasValue", reference: target.reference(item) } });
			continue;
		}

		const object = asObject(item, item_context);
		if (!object.ok) { return object; }
		const [entry, ...extra] = Object.entries(object.value);
		if (entry === undefined || extra.length > 0) {
			return error("An $any_of entry must name exactly one property", item_context.path);
		}

		const [property, condition] = entry;
		const checked = target.check(property, context);
		if (!checked.ok) { return checked; }

		const condition_object = asObject(condition, at(item_context, property));
		if (!condition_object.ok) { return condition_object; }

		const holds = lower_condition(condition_object.value, target.reference(property), at(item_context, property));
		if (!holds.ok) { return holds; }
		members.push({ property, holds: holds.value });
	}

	if (members.length < 2) {
		return error("$any_of must have at least 2 entries", context.path);
	}

	const reason = `needs one of: ${members.map(member => describe_member(member.property, member.holds)).join(", ")}`;
	return ok({
		when: { _t: "PredicateAnd", predicates: members.map(member => ({ _t: "PredicateNot" as const, predicate: member.holds })) },
		effects: members.map(member => ({
			op: "setRequired" as const,
			reference: target.reference(member.property),
			value: true,
			reason,
		})),
	});
}

// A body is the shared shape of a $then block, a $switch case, and a static
// directive: an object whose keys are either $this/$parent scope selectors (which
// recurse with a new scope), nested directives (`$any_of`), or property names (which
// lower to effects). This is the single place target scope is decided for effects.
function lower_effects_body(
	object: Record<string, unknown>,
	context: ParseContext,
	scope: OverrideScope,
): Result<LoweredBody> {
	const effects: Effect[] = [];
	const nested: Rule[] = [];

	for (const [key, value] of Object.entries(object)) {
		if (key === "$this" || key === "$parent") {
			const scoped = asObject(value, at(context, key));
			if (!scoped.ok) { return scoped; }

			const lowered = lower_effects_body(scoped.value, at(context, key), key);
			if (!lowered.ok) { return lowered; }
			effects.push(...lowered.value.effects);
			nested.push(...lowered.value.nested);
			continue;
		}

		if (key === "$any_of") {
			const rule = lower_any_of(value, at(context, key), scope_target(scope, context));
			if (!rule.ok) { return rule; }
			nested.push(rule.value);
			continue;
		}

		if (key.includes(".")) {
			const lowered = lower_included_effects(key, value, context, scope);
			if (!lowered.ok) { return lowered; }
			effects.push(...lowered.value.effects);
			nested.push(...lowered.value.nested);
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

	return ok({ effects, nested });
}

// `comm_init.spi_dev: {...}` — constrain the NODE a union member points at, not the member
// itself. The fields inside belong to that node's own ruleset, which lives in another file
// and usually another repo, so they cannot be checked here; the engine resolves the path
// against the workfile and applies them to whatever is on the other end. That is the same
// deferral `$parent` already relies on, so `lower_effects` is called without a target
// property exactly as it is for a parent target.
//
// Deliberately limited to `<union property>.<member>`:
//
//   - `$parent` scope is refused, because the path is walked from the node declaring the
//     rule and a parent's properties are not described by this file.
//   - a plain `include` property has no unambiguous dotted spelling. `controller: {...}`
//     already means "constrain the reference" (required, allowed, ...), so there is no way
//     to write "constrain what it points at" without inventing a marker. A union needs the
//     member name regardless, which is what makes this form unambiguous.
function lower_included_effects(
	key: string,
	value: unknown,
	context: ParseContext,
	scope: OverrideScope,
): Result<LoweredBody> {
	const key_context = at(context, key);

	if (scope === "$parent") {
		return error(
			`'${key}' cannot be used under $parent: an included node is reached from the node that declares the rule`,
			key_context.path
		);
	}

	const via = key.split(".");
	const [property_name, member_name, ...rest] = via;
	if (property_name === undefined || member_name === undefined || rest.length > 0) {
		return error(
			`'${key}' must name a union property and one of its members, e.g. 'comm_init.spi_dev'`,
			key_context.path
		);
	}

	const target_property = require_property(context, property_name, scope);
	if (!target_property.ok) { return target_property; }

	if (target_property.value._t !== "UnionProperty") {
		return error(
			`Property '${property_name}' is a ${target_property.value._t}, not a union, so '${key}' has no member to reach through`,
			key_context.path
		);
	}

	if (!target_property.value.members.some(member => member.name === member_name)) {
		const known = target_property.value.members.map(member => member.name).join(", ");
		return error(`Union '${property_name}' has no member '${member_name}'. Known: ${known}`, key_context.path);
	}

	const body = asObject(value, key_context);
	if (!body.ok) { return body; }

	const effects: Effect[] = [];
	const nested: Rule[] = [];
	for (const [included_property, override_object] of Object.entries(body.value)) {
		const property_context = at(key_context, included_property);

		// `$any_of` here constrains the included node's own fields, which this file cannot
		// check - the same deferral as every other effect on an included node.
		if (included_property === "$any_of") {
			const rule = lower_any_of(override_object, property_context, {
				reference: property => ({ node: "include", via, property }),
				check: () => ok(),
			});
			if (!rule.ok) { return rule; }
			nested.push(rule.value);
			continue;
		}

		const override_body = asObject(override_object, property_context);
		if (!override_body.ok) { return override_body; }

		const reference: OverrideReference = { node: "include", via, property: included_property };
		const lowered = lower_effects(override_body.value, reference, property_context);
		if (!lowered.ok) { return lowered; }
		effects.push(...lowered.value);
	}

	return ok({ effects, nested });
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
	const body = lower_effects_body(object, context, scope);
	if (!body.ok) { return body; }
	return ok(conditioned({ _t: "PredicateAlways" }, body.value));
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

	const body = lower_effects_body(then_object.value, at(context, "$then"), scope);
	if (!body.ok) { return body; }

	return ok(conditioned(when.value, body.value));
}

function case_name_to_value(case_name: string): string | number {
	if (case_name.trim() === "") {
		return case_name;
	}
	const numeric = Number(case_name);
	return Number.isNaN(numeric) ? case_name : numeric;
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

	let default_body: LoweredBody | undefined;
	const case_values: unknown[] = [];

	for (const [case_name, case_body] of Object.entries($cases.value)) {
		const enum_values = scope === "$this" && on_property.value._t === "EnumProperty"
			? on_property.value.values
			: undefined;
		const case_value = enum_values?.includes(case_name) ? case_name : case_name_to_value(case_name);

		if (case_name !== "_" && enum_values && !enum_values.includes(case_value)) {
			return error(
				`Invalid case '${case_name}'. Valid values: ${enum_values.join(", ")}`,
				at(cases_context, case_name).path
			);
		}

		const case_object = asObject(case_body, at(cases_context, case_name));
		if (!case_object.ok) { return case_object; }

		const body = lower_effects_body(case_object.value, at(cases_context, case_name), scope);
		if (!body.ok) { return body; }

		if (case_name === "_") {
			default_body = body.value;
			continue;
		}

		case_values.push(case_value);
		rules.push(...conditioned({ _t: "PredicateEquals", reference: on_reference, value: case_value }, body.value));
	}

	if (default_body) {
		rules.push(...conditioned({ _t: "PredicateNoneOf", reference: on_reference, values: case_values }, default_body));
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
