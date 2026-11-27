/**
 * Rendering a number the way its field reads.
 *
 * Shared by codegen and the validator so a value appears the same in a generated
 * initializer and in the error that rejected it: being told `66 is not one of: 29, 83`
 * about a field the datasheet documents as 0x1D/0x53 is a needless translation step.
 */

import { is_integer_symbol } from "./types";
import type { NumberFormat, NumberProperty } from "./types";

/**
 * `value` in `format`'s radix.
 *
 * The sign goes outside the prefix: C reads `-0x10` as negation applied to a literal, and
 * `0x-10` is not a token at all. Hex digits are upper case, matching how addresses and
 * masks are written in datasheets.
 *
 * Anything that is not a finite integer falls back to the plain form rather than being
 * forced: a fractional or non-finite value in an integer field is the validator's to
 * report, and rendering it as hex would hide what is actually there.
 */
export function format_number_in(value: number, format: NumberFormat | undefined): string {
	if (format !== "hex" || !Number.isFinite(value) || !Number.isInteger(value)) {
		return String(value);
	}

	const magnitude = Math.abs(value).toString(16).toUpperCase();
	return `${value < 0 ? "-" : ""}0x${magnitude}`;
}

/** `value` as its own property reads it. Non-numeric input is passed through verbatim. */
export function format_number(value: unknown, property: NumberProperty): string {
	const numeric = typeof value === "number" ? value : Number(value);
	if (typeof value !== "number" && !Number.isFinite(numeric)) {
		return String(value);
	}

	// A float field has no radix to honour; only integers carry `format`.
	return is_integer_symbol(property.type)
		? format_number_in(numeric, property.format)
		: String(numeric);
}
