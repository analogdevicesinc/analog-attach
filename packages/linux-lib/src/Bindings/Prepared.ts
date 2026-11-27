import { create_context, SchemaPaths } from "./Context.js";
import type { PropertyType, PropertyTypes } from "./schema/PropertyTypes.js";
import { selected_definitions, type SelectedDefinitions } from "./stages/Selected.js";

/**
 * What every binding of a set of `SchemaPaths` is parsed with, the same for all of them: the property types (dt-schema's
 * own schemas', then the processed schema's) and the definitions of the `select: true` schemas, each dereferenced and
 * fixed up. A process builds them before its first binding, which is most of that binding's parse: a caller can save
 * them (`prepared_to_json`) and give them back in `SchemaPaths.prepared`, for a binding to give the same.
 */
export type PreparedSchemas = {
	property_types: PropertyTypes;
	selected: SelectedDefinitions;
};

/** The prepared schemas of `paths`, built (or the ones `paths.prepared` gives). */
export async function prepare_schemas(paths: SchemaPaths): Promise<PreparedSchemas> {
	const ctx = create_context(paths);
	return { property_types: ctx.property_types, selected: await selected_definitions(ctx) };
}

/**
 * Bumped when what `PreparedSchemas` holds, or what the pipeline makes of its schemas, changes shape, so a saved one
 * of another shape isn't read. (A caller's key still has to change with the lib: the fixups are in the definitions.)
 */
const FORMAT = 1;

/** `prepared` as JSON: the maps as lists of entries, the patterns as their source and flags. */
export function prepared_to_json(prepared: PreparedSchemas): string {
	const { names, patterns, counted } = prepared.property_types;
	return JSON.stringify({
		format: FORMAT,
		property_types: {
			names: [...names],
			patterns: patterns.map(({ pattern, type }) => [pattern.source, pattern.flags, type]),
			...(counted === undefined ? {} : { counted: [...counted] }),
		},
		selected: { properties: [...prepared.selected.properties], patterns: [...prepared.selected.patterns] },
	});
}

const is_record = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** `value` as a map of `[key, value]` entries, each value `is_value`; undefined when it isn't one. */
function entries_map<V>(value: unknown, is_value: (entry: unknown) => entry is V): Map<string, V> | undefined {
	if (!Array.isArray(value)) { return undefined; }
	const map = new Map<string, V>();
	for (const entry of value) {
		if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || !is_value(entry[1])) { return undefined; }
		map.set(entry[0], entry[1]);
	}
	return map;
}

const is_type = (value: unknown): value is PropertyType => typeof value === "string";
const is_definitions = (value: unknown): value is unknown[] => Array.isArray(value);

/** The prepared schemas `prepared_to_json` wrote; undefined for text that isn't them, or of another `FORMAT`. */
export function prepared_from_json(text: string): PreparedSchemas | undefined {
	let saved: unknown;
	try {
		saved = JSON.parse(text);
	} catch {
		return undefined;
	}
	if (!is_record(saved) || saved["format"] !== FORMAT || !is_record(saved["property_types"]) || !is_record(saved["selected"])) { return undefined; }

	const types = saved["property_types"];
	const names = entries_map(types["names"], is_type);
	const counted = types["counted"] === undefined ? undefined : entries_map(types["counted"], is_type);
	const properties = entries_map(saved["selected"]["properties"], is_definitions);
	const selected_patterns = entries_map(saved["selected"]["patterns"], is_definitions);
	if (names === undefined || (types["counted"] !== undefined && counted === undefined) || properties === undefined || selected_patterns === undefined) { return undefined; }

	if (!Array.isArray(types["patterns"])) { return undefined; }
	const patterns: PropertyTypes["patterns"] = [];
	for (const entry of types["patterns"] as unknown[]) {
		if (!Array.isArray(entry) || entry.length !== 3 || !entry.every(part => typeof part === "string")) { return undefined; }
		const [source, flags, type] = entry as [string, string, string];
		try {
			patterns.push({ pattern: new RegExp(source, flags), type });
		} catch {
			return undefined;
		}
	}

	return {
		property_types: { names, patterns, ...(counted === undefined ? {} : { counted }) },
		selected: { properties, patterns: selected_patterns },
	};
}
