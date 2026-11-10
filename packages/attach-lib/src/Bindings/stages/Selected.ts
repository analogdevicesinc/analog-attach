import { $RefParser } from "@apidevtools/json-schema-ref-parser";
import * as fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { Result } from "../../result.js";
import { SchemaContext } from "../Context.js";
import { apply_JSONSchema_fixups } from "../fixups/Fixups.js";
import { defined_within, DefinedNames, in_branch, refines } from "../fixups/Walker.js";
import { is_object_schema } from "../schema/PatternKind.js";
import { merge_definitions } from "./Redefinitions.js";
import { dereference, DT_TYPE } from "./References.js";
import { DtBindingSchema, is_schema, Schema } from "../schema/Schema.js";

/**
 * The definitions in the schemas dt-validate applies to every node, in the order of their files: by property name, and
 * by property pattern (pinctrl-consumer.yaml's `^pinctrl-[0-9]+$`).
 */
export type SelectedDefinitions = { properties: Map<string, unknown[]>; patterns: Map<string, unknown[]> };

function add_definitions(definitions: Map<string, unknown[]>, table: unknown, skip: (key: string, definition: unknown) => boolean = () => false): void {
    if (!is_schema(table)) { return; }
    for (const [key, definition] of Object.entries(table)) {
        if (!is_schema(definition) || skip(key, definition)) { continue; }
        definitions.set(key, [...(definitions.get(key) ?? []), definition]);
    }
}

const SELECT_TRUE = /^select:\s*true\s*$/m;

function* schema_files(directory: string): Generator<string> {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
        return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        const entry_path = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            yield* schema_files(entry_path);
        } else if (entry.name.endsWith(".yaml")) {
            yield entry_path;
        }
    }
}

/** The files of `directory` that are a schema with `select: true`. */
function selected_files(directory: string): string[] {
    return [...schema_files(directory)].filter(file => {
        try {
            const text = fs.readFileSync(file, "utf8");
            return SELECT_TRUE.test(text) && (parse(text) as Schema | null)?.["select"] === true;
        } catch {
            return false;
        }
    });
}

const loaded = new Map<string, Promise<SelectedDefinitions>>();

/**
 * The properties of the schemas dt-validate applies to every node (`select: true`: dt-core.yaml, clock.yaml, iio.yaml,
 * nvmem-consumer.yaml, pinctrl-consumer.yaml), each dereferenced and fixed up in its file, as dt-schema processes every
 * schema on its own. Their own `properties` and the patterns of properties (of a pattern that is a node or a property,
 * the property: `property_patterns`): not `$nodename`, nor the patterns of nodes, nor an `if` / `then`. A file that
 * doesn't dereference gives nothing. Read once per set of search paths.
 */
export function selected_definitions(ctx: SchemaContext): Promise<SelectedDefinitions> {
    const key = ctx.search_paths.map(({ dir }) => dir).join("\n");
    const cached = loaded.get(key);
    if (cached !== undefined) { return cached; }

    const loading = (async () => {
        const definitions: SelectedDefinitions = { properties: new Map(), patterns: new Map() };
        // A parser of its own: the binding's keeps the files the binding read
        const own_ctx: SchemaContext = { ...ctx, parser: new $RefParser() };

        // Read by its `/schemas/...` URL, as a binding's `$ref` would: a relative `types.yaml#` then gets its `dtType`s
        const urls = ctx.search_paths.flatMap(({ prefix, dir }) => selected_files(dir).map(file => `${prefix}/${path.relative(dir, file)}`));
        for (const url of urls) {
            const dereferenced = await dereference(own_ctx, url);
            if (Result.is_err(dereferenced)) { continue; }

            const schema = apply_JSONSchema_fixups(dereferenced.value as DtBindingSchema, ctx.property_types);
            add_definitions(definitions.properties, schema.properties, name => name.startsWith("$"));
            add_definitions(definitions.patterns, property_patterns(schema.patternProperties));
        }
        return definitions;
    })();

    loaded.set(key, loading);
    return loading;
}

/**
 * `selected` without the `oneOf` / `anyOf` that only says which types the value can be, when `type` (the node's) is one
 * of them: clock.yaml's `clock-frequency` is a uint32 or a uint64, and a binding that types it a uint32 has chosen.
 */
function without_alternatives(selected: unknown, type: unknown): unknown {
    if (!is_schema(selected) || typeof type !== "string") { return selected; }

    const result: Schema = { ...selected };
    for (const key of ["oneOf", "anyOf"]) {
        const branches = selected[key];
        const types = Array.isArray(branches) ? branches.map(branch => is_schema(branch) ? branch[DT_TYPE] : undefined) : [];
        if (types.length > 0 && types.every(branch => typeof branch === "string") && types.includes(type)) { delete result[key]; }
    }
    return result;
}

/**
 * `selected` without the `oneOf` / `anyOf` branches that are a node: dt-core.yaml's `status` is a node or a string, and
 * a property the node names is not its child node. A single branch left takes the place of the `oneOf`.
 */
function without_nodes(selected: unknown): unknown {
    if (!is_schema(selected)) { return selected; }

    const result: Schema = { ...selected };
    for (const key of ["oneOf", "anyOf"]) {
        const branches = selected[key];
        if (!Array.isArray(branches) || !branches.some(branch => is_object_schema(branch))) { continue; }
        const kept = branches.filter(branch => !is_object_schema(branch));
        delete result[key];
        if (kept.length === 1 && is_schema(kept[0])) { Object.assign(result, kept[0]); }
        else if (kept.length > 0) { result[key] = kept; }
    }
    return result;
}

/**
 * The patterns of `table` that name properties, each without its node branches: dt-core.yaml's `.*-supply$` is a node
 * or a phandle, so the phandle. A pattern of nodes only (`^__.*__$`, a `oneOf` of nodes) is left out.
 */
function property_patterns(table: unknown): Schema | undefined {
    if (!is_schema(table)) { return undefined; }

    const node_branches_only = (definition: Schema) => ["oneOf", "anyOf"].some(key => {
        const branches = definition[key];
        return Array.isArray(branches) && branches.length > 0 && branches.every(branch => is_object_schema(branch));
    });
    return Object.fromEntries(Object.entries(table).flatMap(([pattern, definition]) => {
        const kept = without_nodes(definition);
        return (is_schema(definition) && node_branches_only(definition)) || is_object_schema(kept) ? [] : [[pattern, kept]];
    }));
}

/** `definition` merged with the definitions of it in the `select: true` schemas, `everywhere`. */
function merge_property(definition: unknown, everywhere: unknown[] | undefined): unknown {
    // A child node of the name (a `clocks` container, `cpus`) is no property
    if (everywhere === undefined || is_object_schema(definition)) { return definition; }
    const type = is_schema(definition) ? definition[DT_TYPE] : undefined;
    return merge_definitions([definition, ...everywhere.map(other => without_alternatives(without_nodes(structuredClone(other)), type))]);
}

/**
 * `binding` with each property a node names merged with the definitions of it in `selected` (`merge_definitions`, the
 * node's own the nearest), and each property pattern with those of the same key: dt-validate checks every node against
 * those schemas too, so iio.yaml gives `mount-matrix` its 9 items, and pinctrl-consumer.yaml makes the
 * `^pinctrl-[0-9]+$` of `fixup_node_properties` a phandle-array, but they add no property the node doesn't name, nor
 * another type to one it types (`without_alternatives`), nor anything to a child node of the name. Every node: the
 * binding's, its child nodes' and those of its `allOf` entries. In a `then` / `else` only a property the node doesn't
 * define (`refines`): the branch is its definition there, and only refines one the node has elsewhere.
 */
export function merge_selected(binding: DtBindingSchema, selected: SelectedDefinitions): DtBindingSchema {
    const merge_node = (node: Schema, path: string[], outside: DefinedNames): Schema => {
        const result: Schema = { ...node };

        if (is_schema(node["properties"])) {
            result["properties"] = Object.fromEntries(Object.entries(node["properties"]).map(([name, definition]) => {
                if (refines([...path, "properties", name], name, outside)) { return [name, definition]; }
                const merged = merge_property(definition, selected.properties.get(name));
                return [name, is_schema(merged) ? merge_node(merged, [...path, "properties", name], new Set()) : merged];
            }));
        }
        if (is_schema(node["patternProperties"]) && !in_branch(path)) {
            // A pattern of the same key: what a binding names `^pinctrl-[0-9]+$` is a pinctrl-N, nothing else is
            result["patternProperties"] = Object.fromEntries(Object.entries(node["patternProperties"]).map(([pattern, child]) => {
                const merged = merge_property(child, selected.patterns.get(pattern));
                return [pattern, is_schema(merged) ? merge_node(merged, [...path, "patternProperties", pattern], new Set()) : merged];
            }));
        }
        const within = defined_within(node, outside);
        if (Array.isArray(node["allOf"])) {
            result["allOf"] = node["allOf"].map(entry => is_schema(entry) ? merge_node(entry, [...path, "allOf"], within) : entry);
        }
        for (const key of ["then", "else"]) {
            const branch = node[key];
            if (is_schema(branch)) { result[key] = merge_node(branch, [...path, key], within); }
        }
        return result;
    };

    return merge_node(binding as unknown as Schema, [], new Set()) as unknown as DtBindingSchema;
}

if (import.meta.vitest) {

    const { test, expect } = import.meta.vitest;

    const selected = (properties: Record<string, unknown[]>): SelectedDefinitions =>
        ({ properties: new Map(Object.entries(properties)), patterns: new Map() });

    test("a property takes the branches of a selected definition that aren't a node: dt-core's status is a string", () => {
        const status = { oneOf: [{ type: "object" }, { $ref: "types.yaml#/definitions/string", enum: ["okay", "disabled"] }] };
        const merged = merge_selected({ properties: { status: true } } as unknown as DtBindingSchema, selected({ status: [status] }));
        expect((merged as unknown as Schema)["properties"]).toStrictEqual({
            status: { $ref: "types.yaml#/definitions/string", enum: ["okay", "disabled"] },
        });
    });

    test("a selected definition without node branches keeps its alternatives", () => {
        const frequency = { oneOf: [{ $ref: "types.yaml#/definitions/uint32" }, { $ref: "types.yaml#/definitions/uint64" }] };
        expect(without_nodes(frequency)).toStrictEqual(frequency);
    });
}
