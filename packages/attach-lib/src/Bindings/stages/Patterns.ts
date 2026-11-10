import { DtBindingSchema, is_schema, Schema } from "../schema/Schema.js";
import { merge_definitions, merge_table, TableMerge } from "./Redefinitions.js";

/**
 * The definitions of one pattern (nearest first) as one, as `merge_definitions` does, and the properties that more
 * than one of them defines merged the same way, at any depth: dt-validate holds a node to each.
 */
function merge_pattern_definitions(definitions: unknown[]): unknown {
    const merged = merge_definitions(definitions);
    if (!is_schema(merged) || !is_schema(merged["properties"])) { return merged; }

    const by_name = new Map<string, unknown[]>();
    for (const definition of definitions) {
        const properties = is_schema(definition) ? definition["properties"] : undefined;
        for (const [name, property] of Object.entries(is_schema(properties) ? properties : {})) {
            by_name.set(name, [...(by_name.get(name) ?? []), property]);
        }
    }
    const properties: Schema = { ...merged["properties"] };
    for (const [name, property_definitions] of by_name) {
        if (property_definitions.length > 1 && Object.hasOwn(properties, name)) {
            properties[name] = merge_pattern_definitions(property_definitions);
        }
    }
    return { ...merged, properties };
}

/**
 * Every pattern of an `allOf` entry moves up to the node's own `patternProperties`, merged with the others of its key
 * (`merge_pattern_definitions`): the binding reads only a node's own (regulator.yaml's `.*-supply$` under a regulator).
 */
const ENTRY_PATTERNS: TableMerge = {
    table: "patternProperties",
    moves: (key, definitions, own) => definitions.length > 1 || !Object.hasOwn(own, key),
    merge: merge_pattern_definitions,
};

/**
 * The patterns of every node of `binding` in its own `patternProperties`, out of its `allOf` entries (not an `if` /
 * `then` branch). After the fixups: dt-schema fixes each schema up on its own and holds a node to all of them, so each
 * definition is in its final form when they are merged (dw-apb-ssi's child `reg: {maximum: 3}` is one row by then,
 * merged with spi-controller.yaml's up to 256).
 */
export function merge_patterns(binding: DtBindingSchema): DtBindingSchema {
    return merge_table(binding as Schema, ENTRY_PATTERNS) as DtBindingSchema;
}
