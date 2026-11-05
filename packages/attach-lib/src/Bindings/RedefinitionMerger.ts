import { JSONSchema } from "@apidevtools/json-schema-ref-parser/dist/lib/types";
import { DtBindingSchema } from "./Schema";
import { SchemaContext } from "./Context.js";
import { dereference } from "./RefResolver.js";
import { deep_merge, find_entry_in_object, is_plain_object, overwrite_object_with_path_value } from "./ObjectUtilities.js";
import { merge_schema } from "./ReferenceSiblings.js";
import { PathEntry, PathValue, PlainObject } from "./UtilityTypes.js";
import { Result } from "../result.js";

/** The entries of the schema's own `properties`. */
function top_level_properties(schema: unknown): PathEntry[] {
    return find_entry_in_object(schema, (path) => path.length === 1 && path[0] === "properties");
}

type Schema = Record<string, unknown>;

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
        if (is_plain_object(schema["properties"])) { tables.push({ depth, properties: schema["properties"] }); }
        for (const entry of Array.isArray(schema["allOf"]) ? schema["allOf"] : []) {
            if (is_plain_object(entry)) { collect(entry, depth + 1); }
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

    const schemas = definitions.filter(definition => is_plain_object(definition));
    if (schemas.length === 0) { return definitions[0]; }

    // The farthest first, each nearer one on top
    let merged: PlainObject = {};
    for (let index = schemas.length - 1; index >= 0; index--) {
        merged = merge_schema(merged, schemas[index]) as PlainObject;
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

    if (is_plain_object(schema["properties"])) {
        result["properties"] = Object.fromEntries(Object.entries(schema["properties"]).filter(([name]) => !names.has(name)));
    }
    if (Array.isArray(schema["allOf"])) {
        result["allOf"] = schema["allOf"].map(entry => is_plain_object(entry) ? without(entry, names) : entry);
    }
    return result;
}

/** `schema` with each of its child nodes merged (`merge_node`), and those its `allOf` entries describe. */
function merge_children(schema: Schema): Schema {
    const result: Schema = { ...schema };

    for (const key of ["properties", "patternProperties"]) {
        const table = schema[key];
        if (is_plain_object(table)) {
            result[key] = Object.fromEntries(Object.entries(table).map(([name, child]) => [name, is_plain_object(child) ? merge_node(child) : child]));
        }
    }
    if (Array.isArray(schema["allOf"])) {
        result["allOf"] = schema["allOf"].map(entry => is_plain_object(entry) ? merge_children(entry) : entry);
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
    const own: Schema = { ...(is_plain_object(node["properties"]) ? node["properties"] : {}) };
    for (const name of redefined) {
        own[name] = merge_definitions(by_name.get(name) ?? []);
    }
    result["properties"] = own;

    return merge_children(result);
}

/**
 * The properties of `base` that `extensions` define again, each merged over its
 * extension: `deep_merge(extension, base)`, so `base` wins where both say something.
 */
function merge_redefined(base: PathEntry[], extensions: PathEntry[]): PathValue[] {
    const base_keys = new Set(base.map(entry => entry.key));
    const merged: PathValue[] = [];

    for (const { key } of extensions) {
        if (!base_keys.has(key)) {
            continue;
        }

        const base_entry = base.find(entry => entry.key === key)!;
        const extension = extensions.find(entry => entry.key === key)!;

        merged.push({
            path: ["properties", key],
            value: deep_merge(extension.value as PlainObject, base_entry.value as PlainObject),
        });
    }

    return merged;
}

export async function merge_redefinitions(
    binding: DtBindingSchema,
    references: DtBindingSchema[],
    ctx: SchemaContext,
): Promise<DtBindingSchema> {
    const merged = merge_node(binding as Schema) as DtBindingSchema;

    const inherited_pattern_properties = find_entry_in_object(
        merged,
        (path) => path.at(-1) === "patternProperties"
    ).filter(
        // TODO: special case needs to be handled
        (pattern) => typeof pattern.value !== "boolean" && "$id" in (pattern.value as object)
    );

    let extended_pattern_properties = merged;

    for (const inherited_pattern_property of inherited_pattern_properties) {
        const parent = references.find((schema) => schema.$id === (inherited_pattern_property.value as JSONSchema).$id);

        if (parent === undefined) {
            continue;
        }

        const reference_resolved_parent = await dereference(ctx, parent as JSONSchema);

        if (Result.is_err(reference_resolved_parent)) {
            continue;
        }

        const parent_extended_definitions = merge_redefined(
            top_level_properties(inherited_pattern_property.value),
            top_level_properties(reference_resolved_parent.value),
        );

        const extended_pattern_properties_binding = overwrite_object_with_path_value(
            inherited_pattern_property.value as object,
            parent_extended_definitions
        );

        extended_pattern_properties = overwrite_object_with_path_value(extended_pattern_properties, [
            {
                path: [...inherited_pattern_property.path, inherited_pattern_property.key],
                value: extended_pattern_properties_binding,
            },
        ]);
    }

    return extended_pattern_properties;
}
