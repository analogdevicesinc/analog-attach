import fs from "node:fs";
import { error, ok } from "../ruleset_parser/result";
import type { Result } from "../ruleset_parser/result";
import { parse_ruleset } from "../ruleset_parser/ruleset_parser";
import type { EnumProperty, Property, Ruleset, RulesetDescriptor } from "../ruleset_parser/types";
import { resolve_entry } from "../registry/registry";
import { find_board_extern } from "../registry/bsp";

/**
 * Load the ruleset a bare `$symbol` names.
 *
 * Parsed fresh every time, deliberately: `add_symbol` stores a ruleset by reference and
 * values are written onto its properties, so a shared instance would let one node's values
 * appear on another.
 */
function load_ruleset(symbol: string): Result<Ruleset> {
	const entry = resolve_entry(symbol);
	if (!entry.ok) {
		return entry;
	}

	let content: string;
	try {
		content = fs.readFileSync(entry.value.file, "utf8");
	} catch {
		return error(`Failed to read ruleset '${symbol}' at ${entry.value.file}`, symbol);
	}

	return parse_ruleset(content);
}

function resolve_descriptor_ruleset(ruleset: RulesetDescriptor): Result<RulesetDescriptor> {
	// NOTE: We just validate that the path is right and the included ruleset is a struct
	const init_parameter_symbol = ruleset.properties[0].include;
	if (init_parameter_symbol === undefined) {
		return error(`A descriptor's $init_param must name a struct with 'include'`);
	}

	const resolved_ruleset = load_ruleset(init_parameter_symbol);
	if (!resolved_ruleset.ok) {
		return resolved_ruleset;
	}

	if (resolved_ruleset.value._t !== "RulesetStruct") {
		return error(`Expected type "struct" to be included in the descriptor ruleset, got ${resolved_ruleset.value._t}`);
	}

	return ok(ruleset);
}

export function resolve_ruleset(ruleset: Ruleset): Result<Ruleset> {
	if (ruleset._t === "RulesetDescriptor") {
		return resolve_descriptor_ruleset(ruleset);
	}

	if (ruleset._t !== "RulesetStruct") {
		return ok(ruleset);
	}

	const resolved_properties: Property[] = [];
	for (const property of ruleset.properties) {
		const resolved = resolve_property(property);
		if (!resolved.ok) {
			return resolved;
		}
		resolved_properties.push(resolved.value);
	}

	return ok({
		...ruleset,
		properties: resolved_properties
	});
}

function resolve_property(property: Property): Result<Property> {
	if (property._t !== "IncludeProperty") {
		return ok(property);
	}

	// An `include_type` property names a kind, not a path, so there is nothing to load
	// and nothing to lower into an enum.
	if (property.include === undefined) {
		return ok(property);
	}

	const included = load_ruleset(property.include);
	if (!included.ok) {
		return included;
	}

	if (included.value._t === "RulesetEnum") {
		const enum_property: EnumProperty = {
			_t: "EnumProperty",
			name: property.name,
			description: property.description,
			required: property.required,
			values: included.value.values.map(v => v.name),
			default: included.value.default,
			value: property.value
		};

		return ok(enum_property);
	}

	return ok(property);
}

export function load_resolved_ruleset(symbol: string): Result<Ruleset> {
	const parsed = load_ruleset(symbol);
	if (!parsed.ok) {
		return parsed;
	}
	return resolve_ruleset(parsed.value);
}

/**
 * Resolve a symbol that may name one of the selected board's peripherals.
 *
 * Board peripherals are not in the global index, because their names are shared across
 * boards on purpose — `bsp_uart_cfg` exists on every capi-maxim board. So they resolve only
 * against the one board in play, and only the two paths that can actually meet one use this:
 * a workfile node's `$compatible`, and a type the user names when adding a node. Every other
 * resolution follows an `include:` written inside a ruleset file, which always names a
 * global symbol.
 *
 * The global index wins. A ruleset file and a board peripheral sharing a name would be a
 * genuine conflict, and silently preferring the board's would hide it.
 */
export function load_resolved_ruleset_for_board(symbol: string, board?: string): Result<Ruleset> {
	// Whether the global index HAS the symbol, not whether loading it succeeded. A ruleset
	// that exists but fails to parse must report why: falling through to the board on any
	// failure would turn every parse error in a shared ruleset into "no module defines it".
	if (resolve_entry(symbol).ok || board === undefined) {
		return load_resolved_ruleset(symbol);
	}

	const extern = find_board_extern(board, symbol);
	if (!extern.ok) {
		return extern;
	}
	if (extern.value === undefined) {
		return error(
			`Unknown ruleset '${symbol}': no configured module defines it, and board '${board}' declares no such peripheral`,
			symbol
		);
	}

	return ok(extern.value);
}
