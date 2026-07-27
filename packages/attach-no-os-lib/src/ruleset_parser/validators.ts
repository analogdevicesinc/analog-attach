import type { Result} from "./result";
import { ok, error } from "./result";
import type { RulesetStruct } from "./types";

interface ParseContext {
	path: string,
	document: Partial<RulesetStruct>
}

function at(context: ParseContext, key: string | number): ParseContext {
	const suffix = typeof key === "number" ? `[${key.toString()}]` : key;
	return {
		path: context.path ? `${context.path}.${suffix}` : suffix,
		document: context.document
	};
}

function asObject(value: unknown, context: ParseContext): Result<Record<string, unknown>> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return error(`Expected object, got ${Array.isArray(value) ? "array" : typeof value}`, context.path);
	}
	return ok(value as Record<string, unknown>);
}

function string_(value: unknown, context: ParseContext): Result<string> {
	if (typeof value !== "string") {
		return error(`Expected string, got ${typeof value}`, context.path);
	}
	return ok(value);
}

function number_(value: unknown, context: ParseContext): Result<number> {
	if (typeof value !== "number") {
		return error(`Expected number, got ${typeof value}`, context.path);
	}
	if (!Number.isFinite(value)) {
		return error(`Expected a finite number, got ${String(value)}`, context.path);
	}
	return ok(value);
}

// A number that must land on a whole value — used for the integer primitives,
// where a fractional bound or default would be silently truncated by the C
// compiler. Floats go through plain `number_`.
function integer_(value: unknown, context: ParseContext): Result<number> {
	const number_value = number_(value, context);
	if (!number_value.ok) {
		return number_value;
	}
	if (!Number.isInteger(number_value.value)) {
		return error(`Expected an integer, got ${String(number_value.value)}`, context.path);
	}
	return ok(number_value.value);
}

function boolean_(value: unknown, context: ParseContext): Result<boolean> {
	if (typeof value !== "boolean") {
		return error(`Expected boolean, got ${typeof value}`, context.path);
	}
	return ok(value);
}

function stringArray(value: unknown, context: ParseContext): Result<string[]> {
	if (!Array.isArray(value)) {
		return error(`Expected array, got ${typeof value}`, context.path);
	}
	for (const [index, element] of value.entries()) {
		const item = string_(element, at(context, index));
		if (!item.ok) {return item;}
	}
	return ok(value as string[]);
}

function enumValueArray(value: unknown, context: ParseContext): Result<(string | number)[]> {
	if (!Array.isArray(value)) {
		return error(`Expected array, got ${typeof value}`, context.path);
	}
	for (const [index, element] of value.entries()) {
		if (typeof element !== "string" && typeof element !== "number") {
			return error(`Expected string or number, got ${typeof element}`, at(context, index).path);
		}
	}
	return ok(value);
}

function stringOrNumber_(value: unknown, context: ParseContext): Result<string | number> {
	if (typeof value !== "string" && typeof value !== "number") {
		return error(`Expected string or number, got ${typeof value}`, context.path);
	}
	return ok(value);
}

function capabilityArray(value: unknown, context: ParseContext): Result<string[]> {
	// Accept either a single string or array of strings, normalize to array
	if (typeof value === "string") {
		return ok([value]);
	}
	if (!Array.isArray(value)) {
		return error(`Expected string or array of strings, got ${typeof value}`, context.path);
	}
	for (const [index, element] of value.entries()) {
		if (typeof element !== "string") {
			return error(`Expected string, got ${typeof element}`, at(context, index).path);
		}
	}
	return ok(value as string[]);
}

function required<T>(
	object: Record<string, unknown>,
	key: string,
	context: ParseContext,
	validate: (v: unknown, c: ParseContext) => Result<T>
): Result<T> {
	if (!(key in object)) {
		return error(`Missing required field '${key}'`, context.path);
	}
	return validate(object[key], at(context, key));
}

function optional<T>(
	object: Record<string, unknown>,
	key: string,
	context: ParseContext,
	validate: (v: unknown, c: ParseContext) => Result<T>
): Result<T | undefined> {
	if (!(key in object) || object[key] === undefined) {
		return ok();
	}
	return validate(object[key], at(context, key));
}

function optionalWithDefault<T>(
	object: Record<string, unknown>,
	key: string,
	context: ParseContext,
	defaultValue: T,
	validate: (v: unknown, c: ParseContext) => Result<T>
): Result<T> {
	if (!(key in object) || object[key] === undefined) {
		return ok(defaultValue);
	}
	return validate(object[key], at(context, key));
}

export { ParseContext, asObject, at, string_, number_, integer_, boolean_, stringArray, enumValueArray, stringOrNumber_, capabilityArray, required, optional, optionalWithDefault };
