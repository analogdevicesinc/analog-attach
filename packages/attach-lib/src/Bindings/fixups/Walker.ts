import { DtBindingSchema, is_schema, Schema, PropertySchema } from "../schema/Schema.js";
import { is_node_pattern } from "../schema/PatternKind.js";
import { definitions_by_name } from "../stages/Redefinitions.js";

export type FixupContext = {
    /** Where the schema is: `["properties", "reg"]`, then `["then", ...]` and so on down into conditionals. */
    path: string[];
    /** The property (or patternProperties pattern) the schema belongs to. */
    name: string;
    /** Where the schema is in the binding, as the keys down to it: `path` with the index of each branch. The walk sets it. */
    pointer?: string[];
    /**
     * Whether the schema only refines a definition of the property elsewhere: a `then` / `else` copy of a property the
     * enclosing node defines (`refines`). The walk sets it; without it, every `then` / `else` copy refines.
     */
    refines?: boolean;
};

/**
 * The names a node schema's properties are next to, as the branch of a node sees them: those the enclosing node defines
 * (its own `properties`, its `allOf` entries', and those of the branches the schema is nested in), or `all` in a child
 * node a branch only refines.
 */
export type DefinedNames = ReadonlySet<string> | "all";

/** Keys of a branch of a node schema, which says more about a property the node defines or defines it itself. */
const BRANCH_KEYS = new Set(["then", "else"]);

/** Whether `path` goes through a `then` / `else`. */
export function in_branch(path: string[]): boolean {
    return path.some(key => BRANCH_KEYS.has(key));
}

/** What the sub-schemas of `schema` see as defined (`DefinedNames`): what it does, and what `outside` it is. */
export function defined_within(schema: Schema, outside: DefinedNames): DefinedNames {
    return outside === "all" ? "all" : new Set([...outside, ...definitions_by_name(schema).keys()]);
}

/**
 * Whether the property `name` of a node schema at `path` only refines a definition elsewhere: it is in a `then` /
 * `else` and `outside` defines it. A branch that names a property the node doesn't is its definition (rpmh's
 * `vdd-l2-l3-supply: true` in each compatible's `then`), as dt-schema types a name wherever it is.
 */
export function refines(path: string[], name: string, outside: DefinedNames): boolean {
    return in_branch(path) && (outside === "all" || outside.has(name));
}

/** A fixup of one property's schema, returning the schema to put in its place. */
export type PropertyFixup = (schema: PropertySchema, context: FixupContext) => PropertySchema;

/** A fixup of a node schema (one that has `properties`), changing it in place. `pointer` is as `FixupContext`'s. */
export type NodeFixup = (schema: Schema, path: string[], pointer?: string[]) => void;

export type Fixups = {
    property: PropertyFixup[];
    node: NodeFixup[];
};

/** Keys whose value is a schema of the same node. */
const SUB_SCHEMA_KEYS = ["select", "if", "then", "else", "not", "additionalProperties"];
const CONDITIONAL_KEYS = ["allOf", "anyOf", "oneOf"];
/** Keys whose values are schemas by name. */
const NAMED_SCHEMA_KEYS = ["properties", "patternProperties", "$defs", "definitions"];

/**
 * Applies the fixups to a node schema, in place: the node fixups to it, the property fixups to each of its
 * properties. Models dt-schema's `fixups.py:fixup_sub_schema`: recurse into the node's conditionals and into
 * every property's own `properties` / `patternProperties`, and hand each property to `walk_property`. `outside` is
 * what the node defines outside `schema` (`DefinedNames`), for the `refines` of each property.
 */
export function walk_node_schema(schema: unknown, fixups: Fixups, path: string[] = [], pointer: string[] = path, outside: DefinedNames = new Set()): void {
    if (!is_schema(schema)) { return; }

    for (const fixup of fixups.node) {
        fixup(schema, path, pointer);
    }

    const within = defined_within(schema, outside);
    for (const key of SUB_SCHEMA_KEYS) {
        walk_node_schema(schema[key], fixups, [...path, key], [...pointer, key], within);
    }

    for (const key of CONDITIONAL_KEYS) {
        const branches = schema[key];
        if (Array.isArray(branches)) {
            for (const [index, branch] of branches.entries()) {
                walk_node_schema(branch, fixups, [...path, key], [...pointer, key, String(index)], within);
            }
        }
    }

    for (const key of NAMED_SCHEMA_KEYS) {
        const named = schema[key];
        if (!is_schema(named)) { continue; }

        for (const [name, sub] of Object.entries(named)) {
            const sub_path = [...path, key, name];
            const sub_pointer = [...pointer, key, name];
            // Only a named property can be the definition a branch gives: a branch's pattern still refines
            const refining = key === "properties" ? refines(sub_path, name, outside) : in_branch(path);
            // A pattern naming child nodes is a node schema; one naming properties is a property schema.
            named[name] = key === "patternProperties" && is_node_pattern(name, sub)
                ? sub
                : walk_property(sub as PropertySchema, fixups, { path: sub_path, name, pointer: sub_pointer, refines: refining });
            // A property can itself hold properties (an object) to fix up: all of them refinements in a child node the
            // branch refines.
            walk_node_schema(named[name], fixups, sub_path, sub_pointer, refining ? "all" : new Set());
        }
    }
}

/**
 * Applies the fixups to one property's schema and, first, to the schemas of its
 * conditionals. Models `fixups.py:walk_properties` and `fixup_vals`.
 */
function walk_property(schema: PropertySchema, fixups: Fixups, context: Required<FixupContext>): PropertySchema {
    // `true` is a schema that says nothing yet (`properties: { clocks: true }`); the fixups may give it a type
    if (schema === false || (!is_schema(schema) && schema !== true)) { return schema; }

    const { path, pointer } = context;
    for (const key of is_schema(schema) ? CONDITIONAL_KEYS : []) {
        const branches = (schema as Schema)[key];
        if (Array.isArray(branches)) {
            (schema as Schema)[key] = branches.map((branch, index) =>
                walk_property(branch as PropertySchema, fixups, { ...context, path: [...path, key], pointer: [...pointer, key, String(index)] }));
        }
    }

    if (is_schema(schema) && "then" in schema) {
        // eslint-disable-next-line unicorn/no-thenable
        schema["then"] = walk_property(schema["then"] as PropertySchema, fixups, { ...context, path: [...path, "then"], pointer: [...pointer, "then"] });
    }

    let fixuped: PropertySchema = schema;
    for (const fixup of fixups.property) {
        fixuped = fixup(fixuped, context);
    }
    return fixuped;
}

/** Runs the fixups over a whole binding, on a copy. */
export function apply_fixups(binding: DtBindingSchema, fixups: Fixups): DtBindingSchema {
    const copy = structuredClone(binding);
    walk_node_schema(copy, fixups);
    return copy;
}
