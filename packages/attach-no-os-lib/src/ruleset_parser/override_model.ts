import type { Effect, EnumValue, OverrideReference, OverridePredicate, Property } from "./types";
import type { ParseContext} from "./validators";
import { boolean_, string_, number_, at, stringArray } from "./validators";
import type { Result} from "./result";
import { error, ok } from "./result";

export function lower_effects(
	object: Record<string, unknown>,
	reference: OverrideReference,
	context: ParseContext,
	property?: Property
): Result<Effect[]> {
	// NOTE: This is a necessary fix to avoid misspells, not sure if it is the best way
	// to check runtime types
	const known = new Set([
		"default","required","description","disabled",
		"minimum","maximum","pointer","allowed","values","value"
	]);
	for (const key of Object.keys(object)) {
		if (!known.has(key)) {
			return error(`Unknown override field '${key}'`, at(context, key).path);
		}
	}

	const effects: Effect[] = [];

	if ("default" in object) {
		// A default is only a UI hint (P3), but when the target type is known (self
		// scope) an out-of-set enum default is almost certainly an authoring mistake,
		// so reject it at parse like the old engine did. $parent targets (property
		// undefined) can't be checked here and pass through.
		if (property?._t === "EnumProperty" && !property.values.includes(object.default as EnumValue)) {
			return error(
				`Invalid default '${String(object.default)}'. Valid: ${property.values.join(", ")}`,
				at(context, "default").path
			);
		}
		effects.push({ op: "setDefault", reference, value: object.default });
	}

	if ("required" in object) {
		const required = boolean_(object.required, at(context, "required"));
		if (!required.ok) {
			return required;
		}

		effects.push({ op: "setRequired", reference, value: required.value });
	}

	if ("description" in object) {
		const description = string_(object.description, at(context, "description"));
		if (!description.ok) {
			return description;
		}
		effects.push({ op: "setDescription", reference, value: description.value });
	}

	if ("disabled" in object) {
		const disabled = boolean_(object.disabled, at(context, "disabled"));
		if (!disabled.ok) {
			return disabled;
		}
		effects.push({ op: "setDisabled", reference, value: disabled.value });
	}

	if ("minimum" in object) {
		const minimum = number_(object.minimum, at(context, "minimum"));
		if (!minimum.ok) {
			return minimum;
		}

		if (property?._t === "NumberProperty" && property.minimum !== undefined && minimum.value < property.minimum) {
			return error(`minimum ${String(minimum.value)} below type minimum ${String(property.minimum)}`, at(context, "minimum").path);
		}

		effects.push({ op: "setMin", reference, value: minimum.value });
	}

	if ("maximum" in object) {
		const maximum = number_(object.maximum, at(context, "maximum"));
		if (!maximum.ok) {
			return maximum;
		}

		if (property?._t === "NumberProperty" && property.maximum !== undefined && maximum.value > property.maximum) {
			return error(`maximum ${String(maximum.value)} above type maximum ${String(property.maximum)}`, at(context, "maximum").path);
		}

		effects.push({ op: "setMax", reference, value: maximum.value });
	}

	if ("pointer" in object) {
		const pointer = boolean_(object.pointer, at(context, "pointer"));
		if (!pointer.ok) {
			return pointer;
		}

		effects.push({ op: "setPointer", reference, value: pointer.value });
	}

	if ("allowed" in object) {
		const allowed = stringArray(object.allowed, at(context, "allowed"));
		if (!allowed.ok) {
			return allowed;
		}

		effects.push({ op: "restrictAllowed", reference, ids: allowed.value });
	}

	if ("values" in object) {
		// NOTE: This is an enum
		const values = stringArray(object.values, at(context, "values"));
		if (!values.ok) {
			return values;
		}

		effects.push({ op: 'restrictValues', reference, values: values.value });
	}

	if ("value" in object) {
		const lowered = lower_value_effect(object.value, reference, context, property);
		if (!lowered.ok) {
			return lowered;
		}

		effects.push(lowered.value);
	}

	return ok(effects);
}

function lower_value_effect(
	raw: unknown,
	reference: OverrideReference,
	context: ParseContext,
	property?: Property
): Result<Effect> {
	const value_context = at(context, "value");

	switch (property?._t) {
		case "UnionProperty": {
			// union: `value: memberName` names a SELECTOR. Validate the member
			// exists; the engine checks it against the user's binding (don't mutate).
			const member = string_(raw, value_context);
			if (!member.ok) { return member; }
			const names = property.members.map(m => m.name);
			if (!names.includes(member.value)) {
				return error(
					`Invalid union member '${member.value}'. Valid: ${names.join(", ")}`,
					value_context.path
				);
			}
			return ok({ op: "selectMember", reference, member: member.value });
		}

		case "EnumProperty": {
			// C1: enums cannot be force-set with `value:` — that ambiguity is
			// exactly what the redesign removes. Author must use `values:`.
			return error(
				`Cannot use 'value:' on enum '${reference.property}'. Use 'values:' to restrict the selectable set.`,
				value_context.path
			);
		}

		case undefined: {
			// $parent scope: type unknown locally (seam decision). Emit setValue by
			// shape; the engine reports a type mismatch if the resolved target isn't scalar.
			return ok({ op: "setValue", reference, value: raw });
		}

		default: {
			// NumberProperty / Boolean / String / raw scalar → exact force.
			return ok({ op: "setValue", reference, value: raw });
		}
	}
}

export function lower_condition(
	condition_object: Record<string, unknown>, // inside of $if, scope already stripped
		reference: OverrideReference,          // condition target; I resolve scope & pass in
	context: ParseContext,
): Result<OverridePredicate> {
	const keys = Object.keys(condition_object);

	if (keys.length === 0) {
		return error("Condition must specify at least one operator", context.path);
	}

	const predicates: OverridePredicate[] = [];

	for (const key of keys) {
		const operand_context = at(context, key);

		switch (key) {
			case "value": {
				// P3: tests the EXPLICIT value only. Operand is compared strict === by
				// the engine. We don't coerce it, an enum name, number, or bool is valid.
				predicates.push({
					_t: "PredicateEquals",
					reference,
					value: condition_object.value,
				});
				break;
			}
			case "$any": {
				predicates.push({ _t: "PredicateHasValue", reference });
				break;
			}
			default: {
				return error(
					`Unknown condition operator '${key}'. Expected 'value' or '$any'.`,
					operand_context.path
				);
			}
		}
	}

	if (predicates.length === 1) {
		return ok(predicates[0]);
	}

	return ok({ _t: "PredicateAnd", predicates });
}
