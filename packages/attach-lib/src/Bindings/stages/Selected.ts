import { $RefParser } from "@apidevtools/json-schema-ref-parser";
import * as fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { Result } from "../../result.js";
import { SchemaContext } from "../Context.js";
import { apply_JSONSchema_fixups } from "../fixups/Fixups.js";
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
 * schema on its own. Their own `properties` and the patterns of properties: not `$nodename`, nor the patterns of nodes,
 * nor an `if` / `then`. A file that doesn't dereference gives nothing. Read once per set of search paths.
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
            add_definitions(definitions.patterns, schema.patternProperties, (_, definition) => is_object_schema(definition));
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

/** `definition` merged with the definitions of it in the `select: true` schemas, `everywhere`. */
function merge_property(definition: unknown, everywhere: unknown[] | undefined): unknown {
    // A child node of the name (a `clocks` container, `cpus`) is no property
    if (everywhere === undefined || is_object_schema(definition)) { return definition; }
    const type = is_schema(definition) ? definition[DT_TYPE] : undefined;
    return merge_definitions([definition, ...everywhere.map(other => without_alternatives(structuredClone(other), type))]);
}

/**
 * `binding` with each property a node names merged with the definitions of it in `selected` (`merge_definitions`, the
 * node's own the nearest), and each property pattern with those of the same key: dt-validate checks every node against
 * those schemas too, so iio.yaml gives `mount-matrix` its 9 items, and pinctrl-consumer.yaml makes the
 * `^pinctrl-[0-9]+$` of `fixup_node_properties` a phandle-array, but they add no property the node doesn't name, nor
 * another type to one it types (`without_alternatives`), nor anything to a child node of the name. Every node: the
 * binding's, its child nodes' and those of its `allOf` entries, not an `if` / `then`, which only adds to a property.
 */
export function merge_selected(binding: DtBindingSchema, selected: SelectedDefinitions): DtBindingSchema {
    const merge_node = (node: Schema): Schema => {
        const result: Schema = { ...node };

        if (is_schema(node["properties"])) {
            result["properties"] = Object.fromEntries(Object.entries(node["properties"]).map(([name, definition]) => {
                const merged = merge_property(definition, selected.properties.get(name));
                return [name, is_schema(merged) ? merge_node(merged) : merged];
            }));
        }
        if (is_schema(node["patternProperties"])) {
            // A pattern of the same key: what a binding names `^pinctrl-[0-9]+$` is a pinctrl-N, nothing else is
            result["patternProperties"] = Object.fromEntries(Object.entries(node["patternProperties"]).map(([pattern, child]) => {
                const merged = merge_property(child, selected.patterns.get(pattern));
                return [pattern, is_schema(merged) ? merge_node(merged) : merged];
            }));
        }
        if (Array.isArray(node["allOf"])) {
            result["allOf"] = node["allOf"].map(entry => is_schema(entry) && !("if" in entry) ? merge_node(entry) : entry);
        }
        return result;
    };

    return merge_node(binding as unknown as Schema) as unknown as DtBindingSchema;
}
