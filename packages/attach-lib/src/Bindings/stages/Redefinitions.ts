import { JSONSchema } from "@apidevtools/json-schema-ref-parser/dist/lib/types";
import { deep_merge, DtBindingSchema, entries_of, is_schema, map_entries, Schema } from "../schema/Schema.js";
import { SchemaContext } from "../Context.js";
import { dereference } from "./References.js";
import { merge_schema } from "./ReferenceSiblings.js";
import { Result } from "../../result.js";

/** dt-validate checks every definition of a property, so the tighter of their bounds applies. */
const TIGHTER: Record<string, (...bounds: number[]) => number> = {
    minItems: Math.max,
    minimum: Math.max,
    maxItems: Math.min,
    maximum: Math.min,
};

/** The two tables of a node schema whose entries an `allOf` entry can define again. */
export type Table = "properties" | "patternProperties";

/**
 * The definitions of each entry of `node`'s `table`, nearest first: its own, then those of its `allOf` entries, then
 * those of an entry nested in one; entries as deep as each other in their order. Not those of an `if` / `then`
 * branch, which only add to a property, nor those of a child node.
 */
function definitions_by_key(node: Schema, table: Table): Map<string, unknown[]> {
    const tables: { depth: number, entries: Schema }[] = [];

    const collect = (schema: Schema, depth: number): void => {
        if (is_schema(schema[table])) { tables.push({ depth, entries: schema[table] }); }
        for (const entry of Array.isArray(schema["allOf"]) ? schema["allOf"] : []) {
            if (is_schema(entry)) { collect(entry, depth + 1); }
        }
    };
    collect(node, 0);

    const by_key = new Map<string, unknown[]>();
    for (const { entries } of tables.sort((a, b) => a.depth - b.depth)) {
        for (const [key, definition] of Object.entries(entries)) {
            by_key.set(key, [...(by_key.get(key) ?? []), definition]);
        }
    }
    return by_key;
}

/** The definitions of each property of `node`, nearest first (`definitions_by_key`). */
export function definitions_by_name(node: Schema): Map<string, unknown[]> {
    return definitions_by_key(node, "properties");
}

/**
 * The definitions of one property (nearest first) as one: the nearer one's keywords win (`merge_schema`), the bounds
 * are the tighter of all, and a `false` forbids it whatever the others say. A `true` says nothing next to another.
 */
export function merge_definitions(definitions: unknown[]): unknown {
    if (definitions.includes(false)) { return false; }

    const schemas = definitions.filter(definition => is_schema(definition));
    if (schemas.length === 0) { return definitions[0]; }

    // The farthest first, each nearer one on top
    let merged: Schema = {};
    for (let index = schemas.length - 1; index >= 0; index--) {
        merged = merge_schema(merged, schemas[index]) as Schema;
    }
    for (const [keyword, tighter] of Object.entries(TIGHTER)) {
        const bounds = schemas.map(schema => schema[keyword]).filter(bound => typeof bound === "number");
        if (bounds.length > 0) { merged[keyword] = tighter(...bounds); }
    }
    return merged;
}

/** `schema` and its `allOf` entries, at any depth, without the entries of its `table` named in `keys`. */
function without(schema: Schema, table: Table, keys: Set<string>): Schema {
    const result: Schema = { ...schema };

    const entries = schema[table];
    if (is_schema(entries)) {
        result[table] = Object.fromEntries(Object.entries(entries).filter(([key]) => !keys.has(key)));
    }
    if (Array.isArray(schema["allOf"])) {
        result["allOf"] = schema["allOf"].map(entry => is_schema(entry) ? without(entry, table, keys) : entry);
    }
    return result;
}

/** Which entries of a `table` `merge_table` moves into a node's own, and how it merges their definitions. */
export type TableMerge = {
    table: Table;
    /** Whether the entry `key`, which `own` (the node's own table) has or not, moves. */
    moves: (key: string, definitions: unknown[], own: Schema) => boolean;
    merge: (definitions: unknown[]) => unknown;
};

/**
 * `node` with each entry of its `table` that `rule` moves merged (`rule.merge`) into the node's own table, and taken
 * out of its `allOf` entries. Then the same for its child nodes, and those its `allOf` entries describe.
 */
export function merge_table(node: Schema, rule: TableMerge): Schema {
    const by_key = definitions_by_key(node, rule.table);
    const table = node[rule.table];
    const own = is_schema(table) ? table : {};
    const moved = new Set([...by_key].filter(([key, definitions]) => rule.moves(key, definitions, own)).map(([key]) => key));

    let result = node;
    if (moved.size > 0) {
        result = without(node, rule.table, moved);
        const merged: Schema = { ...own };
        for (const key of moved) {
            merged[key] = rule.merge(by_key.get(key) ?? []);
        }
        result[rule.table] = merged;
    }
    return merge_children(result, rule);
}

/** `schema` with each of its child nodes merged (`merge_table`), and those its `allOf` entries describe. */
function merge_children(schema: Schema, rule: TableMerge): Schema {
    const result: Schema = { ...schema };

    for (const key of ["properties", "patternProperties"]) {
        const entries = schema[key];
        if (is_schema(entries)) {
            result[key] = Object.fromEntries(Object.entries(entries).map(([name, child]) => [name, is_schema(child) ? merge_table(child, rule) : child]));
        }
    }
    if (Array.isArray(schema["allOf"])) {
        result["allOf"] = schema["allOf"].map(entry => is_schema(entry) ? merge_children(entry, rule) : entry);
    }
    return result;
}

/**
 * A node whose properties are each defined once: a property that the node and its `allOf` entries define more than
 * once (the binding, a schema it references and one that references, all of them `backlight`) is merged into one
 * (`merge_definitions`) in the node's own `properties`, and taken out of the entries. Then the same for its child nodes.
 */
const REDEFINED_PROPERTIES: TableMerge = {
    table: "properties",
    moves: (_key, definitions) => definitions.length > 1,
    merge: merge_definitions,
};

/** Whether the entry at `path` is a child-node pattern that is a whole schema of another file, by its `$id`. */
function is_inherited_pattern(entry: unknown, path: string[]): entry is Schema & { $id: string } {
    return path.at(-2) === "patternProperties" && is_schema(entry) && typeof entry["$id"] === "string";
}

/**
 * `pattern` with each of its properties that `parent` (the schema it is, dereferenced again) defines too merged over
 * the parent's: `deep_merge(parent's, pattern's)`, so the pattern's wins where both say something.
 */
function extend_properties(pattern: Schema, parent: Schema): Schema {
    const own = pattern["properties"];
    const inherited = parent["properties"];
    if (!is_schema(own) || !is_schema(inherited)) { return pattern; }

    const properties: Schema = { ...own };
    for (const [name, definition] of Object.entries(inherited)) {
        if (Object.hasOwn(own, name)) { properties[name] = deep_merge(definition, own[name]); }
    }
    return { ...pattern, properties };
}

export async function merge_redefinitions(
    binding: DtBindingSchema,
    references: DtBindingSchema[],
    ctx: SchemaContext,
): Promise<DtBindingSchema> {
    const merged = merge_table(binding as Schema, REDEFINED_PROPERTIES) as DtBindingSchema;

    const parents = new Map<string, Schema>();
    for (const [entry, path] of entries_of(merged)) {
        if (!is_inherited_pattern(entry, path) || parents.has(entry.$id)) { continue; }

        const parent = references.find(schema => schema.$id === entry.$id);
        const dereferenced = parent === undefined ? undefined : await dereference(ctx, parent as JSONSchema);
        if (dereferenced !== undefined && Result.is_ok(dereferenced) && is_schema(dereferenced.value)) {
            parents.set(entry.$id, dereferenced.value);
        }
    }

    return map_entries(merged, (entry, path) => {
        const parent = is_inherited_pattern(entry, path) ? parents.get(entry.$id) : undefined;
        return parent === undefined ? entry : extend_properties(entry as Schema, parent);
    });
}
