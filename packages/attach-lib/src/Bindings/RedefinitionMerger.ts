import { JSONSchema } from "@apidevtools/json-schema-ref-parser/dist/lib/types";
import { deep_merge, DtBindingSchema, entries_of, is_schema, map_entries, Schema } from "./Schema.js";
import { SchemaContext } from "./Context.js";
import { dereference } from "./RefResolver.js";
import { merge_schema } from "./ReferenceSiblings.js";
import { Result } from "../result.js";

/** dt-validate checks every definition of a property, so the tighter of their bounds applies. */
const TIGHTER: Record<string, (...bounds: number[]) => number> = {
    minItems: Math.max,
    minimum: Math.max,
    maxItems: Math.min,
    maximum: Math.min,
};

/**
 * The definitions of each property of `node`, nearest first: its own `properties`, then those of its `allOf` entries,
 * then those of an entry nested in one; entries as deep as each other in their order. Not the properties of an
 * `if` / `then` branch, which only add to a property, nor those of a child node.
 */
export function definitions_by_name(node: Schema): Map<string, unknown[]> {
    const tables: { depth: number, properties: Schema }[] = [];

    const collect = (schema: Schema, depth: number): void => {
        if (is_schema(schema["properties"])) { tables.push({ depth, properties: schema["properties"] }); }
        for (const entry of Array.isArray(schema["allOf"]) ? schema["allOf"] : []) {
            if (is_schema(entry)) { collect(entry, depth + 1); }
        }
    };
    collect(node, 0);

    const by_name = new Map<string, unknown[]>();
    for (const { properties } of tables.sort((a, b) => a.depth - b.depth)) {
        for (const [name, definition] of Object.entries(properties)) {
            by_name.set(name, [...(by_name.get(name) ?? []), definition]);
        }
    }
    return by_name;
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

/** `schema` and its `allOf` entries, at any depth, without the properties named in `names`. */
function without(schema: Schema, names: Set<string>): Schema {
    const result: Schema = { ...schema };

    if (is_schema(schema["properties"])) {
        result["properties"] = Object.fromEntries(Object.entries(schema["properties"]).filter(([name]) => !names.has(name)));
    }
    if (Array.isArray(schema["allOf"])) {
        result["allOf"] = schema["allOf"].map(entry => is_schema(entry) ? without(entry, names) : entry);
    }
    return result;
}

/** `schema` with each of its child nodes merged (`merge_node`), and those its `allOf` entries describe. */
function merge_children(schema: Schema): Schema {
    const result: Schema = { ...schema };

    for (const key of ["properties", "patternProperties"]) {
        const table = schema[key];
        if (is_schema(table)) {
            result[key] = Object.fromEntries(Object.entries(table).map(([name, child]) => [name, is_schema(child) ? merge_node(child) : child]));
        }
    }
    if (Array.isArray(schema["allOf"])) {
        result["allOf"] = schema["allOf"].map(entry => is_schema(entry) ? merge_children(entry) : entry);
    }
    return result;
}

/**
 * A node whose properties are each defined once: a property that the node and its `allOf` entries define more than
 * once (the binding, a schema it references and one that references, all of them `backlight`) is merged into one
 * (`merge_definitions`) in the node's own `properties`, and taken out of the entries. Then the same for its child nodes.
 */
function merge_node(node: Schema): Schema {
    const by_name = definitions_by_name(node);
    const redefined = new Set([...by_name].filter(([, definitions]) => definitions.length > 1).map(([name]) => name));

    if (redefined.size === 0) {
        return merge_children(node);
    }

    const result = without(node, redefined);
    const own: Schema = { ...(is_schema(node["properties"]) ? node["properties"] : {}) };
    for (const name of redefined) {
        own[name] = merge_definitions(by_name.get(name) ?? []);
    }
    result["properties"] = own;

    return merge_children(result);
}

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
    const merged = merge_node(binding as Schema) as DtBindingSchema;

    // TODO: special case needs to be handled (a pattern that is a boolean)
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
