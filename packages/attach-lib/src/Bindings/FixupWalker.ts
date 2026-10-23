import { DtBindingSchema } from "./Schema";
import { is_node_pattern } from "./PatternKind.js";

/** A property's schema; `true` / `false` are schemas too, and are left alone. */
export type PropertySchema = Record<string, unknown> | boolean;

export type FixupContext = {
    /** Where the schema is: `["properties", "reg"]`, then `["then", ...]` and so on down into conditionals. */
    path: string[];
    /** The property (or patternProperties pattern) the schema belongs to. */
    name: string;
};

/** A fixup of one property's schema, returning the schema to put in its place. */
export type PropertyFixup = (schema: PropertySchema, context: FixupContext) => PropertySchema;

/** A fixup of a node schema (one that has `properties`), changing it in place. */
export type NodeFixup = (schema: Record<string, unknown>, path: string[]) => void;

export type Fixups = {
    property: PropertyFixup[];
    node: NodeFixup[];
};

type Schema = Record<string, unknown>;

function is_schema(value: unknown): value is Schema {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Keys whose value is a schema of the same node. */
const SUB_SCHEMA_KEYS = ["select", "if", "then", "else", "not", "additionalProperties"];
const CONDITIONAL_KEYS = ["allOf", "anyOf", "oneOf"];
/** Keys whose values are schemas by name. */
const NAMED_SCHEMA_KEYS = ["properties", "patternProperties", "$defs", "definitions"];

/**
 * Applies the fixups to a node schema, in place: the node fixups to it, the property fixups to each of its
 * properties. Models dt-schema's `fixups.py:fixup_sub_schema`: recurse into the node's conditionals and into
 * every property's own `properties` / `patternProperties`, and hand each property to `walk_property`.
 */
export function walk_node_schema(schema: unknown, fixups: Fixups, path: string[] = []): void {
    if (!is_schema(schema)) { return; }

    for (const fixup of fixups.node) {
        fixup(schema, path);
    }

    for (const key of SUB_SCHEMA_KEYS) {
        walk_node_schema(schema[key], fixups, [...path, key]);
    }

    for (const key of CONDITIONAL_KEYS) {
        const branches = schema[key];
        if (Array.isArray(branches)) {
            for (const branch of branches) {
                walk_node_schema(branch, fixups, [...path, key]);
            }
        }
    }

    for (const key of NAMED_SCHEMA_KEYS) {
        const named = schema[key];
        if (!is_schema(named)) { continue; }

        for (const [name, sub] of Object.entries(named)) {
            const sub_path = [...path, key, name];
            // A pattern naming child nodes is a node schema; one naming properties is a property schema.
            named[name] = key === "patternProperties" && is_node_pattern(name, sub)
                ? sub
                : walk_property(sub as PropertySchema, fixups, sub_path, name);
            // A property can itself hold properties (an object) to fix up.
            walk_node_schema(named[name], fixups, sub_path);
        }
    }
}

/**
 * Applies the fixups to one property's schema and, first, to the schemas of its
 * conditionals. Models `fixups.py:walk_properties` and `fixup_vals`.
 */
export function walk_property(schema: PropertySchema, fixups: Fixups, path: string[], name: string): PropertySchema {
    // `true` is a schema that says nothing yet (`properties: { clocks: true }`); the fixups may give it a type
    if (schema === false || (!is_schema(schema) && schema !== true)) { return schema; }

    for (const key of is_schema(schema) ? CONDITIONAL_KEYS : []) {
        const branches = (schema as Schema)[key];
        if (Array.isArray(branches)) {
            (schema as Schema)[key] = branches.map(branch => walk_property(branch as PropertySchema, fixups, [...path, key], name));
        }
    }

    if (is_schema(schema) && "then" in schema) {
        // eslint-disable-next-line unicorn/no-thenable
        schema["then"] = walk_property(schema["then"] as PropertySchema, fixups, [...path, "then"], name);
    }

    let fixuped: PropertySchema = schema;
    for (const fixup of fixups.property) {
        fixuped = fixup(fixuped, { path, name });
    }
    return fixuped;
}

/** Runs the fixups over a whole binding, on a copy. */
export function apply_fixups(binding: DtBindingSchema, fixups: Fixups): DtBindingSchema {
    const copy = structuredClone(binding);
    walk_node_schema(copy, fixups);
    return copy;
}
