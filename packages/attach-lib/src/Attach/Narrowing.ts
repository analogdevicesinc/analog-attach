import Ajv2019, { type KeywordDefinition, type ValidateFunction } from "ajv/dist/2019.js";
import type { DataValidateFunction } from "ajv/dist/types/index.js";

import { CANARY, deep_merge, DT_TYPE, DtBindingSchema, is_schema, Schema, value_at } from "../Bindings/index.js";

/** A schema, the AJV function compiled from it and the schema narrowed so far by the data it saw. */
export type NarrowingTarget = {
    original: DtBindingSchema;
    current: DtBindingSchema;
    compiled: ValidateFunction;
};

export type NarrowingTargets = {
    root: NarrowingTarget;
    /** Child-node pattern schemas that declare properties, by pattern. */
    patterns: Map<string, NarrowingTarget>;
};

const validate_type_size = (expected_size: number): DataValidateFunction => {
    const validate: DataValidateFunction = (instance) => {
        const value = instance !== null && typeof instance === "object" ? (instance as { size?: unknown }).size : undefined;
        const size = typeof value === "number" ? value : 32;

        const valid = expected_size === size;

        if (!valid) {
            validate.errors = [{
                keyword: "typeSize",
                message: `size is ${size}, expected ${expected_size}`,
                params: { size, expectedSize: expected_size },
            }];
        }

        return valid;
    };

    return validate;
};

const TYPE_SIZE: KeywordDefinition = {
    keyword: "typeSize",
    schemaType: "number",
    errors: true,
    compile: validate_type_size,
};

/** `dtType` (see `Bindings/stages/References.ts`) only annotates: it says what the schema was before dereferencing. */
const DT_TYPE_KEYWORD: KeywordDefinition = { keyword: DT_TYPE, schemaType: "string" };

/**
 * The patterns of a binding as JavaScript reads them. They are Python's (dt-schema's `re`): a JavaScript `RegExp`
 * without the `u` flag takes the escapes Python does (`^data\-only@`), and `{,2}` (exynos-ppmu's
 * `^ppmu-event[0-9]+(-[a-z0-9]+){,2}$`) is `{0,2}`.
 */
const PYTHON_REGEXP = Object.assign(
    (pattern: string): RegExp => new RegExp(pattern.replaceAll(/(?<!\\)\{,(\d+)\}/g, "{0,$1}")),
    { code: "python_regexp" },
);

/**
 * An AJV instance that knows the `typeSize` keyword, mirroring dt-schema's
 * `validator.py:typeSize`: the instance's `size` (default 32) must equal the schema's.
 *
 * Without AJV's checks of the schema: it only narrows the `if/then` branches here, so it takes what dt-schema's
 * validator takes. A name that a pattern matches too (graph.yaml's `endpoint`), an `additionalItems` beside one
 * `items` schema and an unknown keyword are valid JSON Schema, which strict mode refuses to compile, and a
 * `description:` left empty (emc2305's `emcs205,max-state`) is no string, which the meta-schema refuses.
 */
export function create_ajv(): Ajv2019 {
    const ajv = new Ajv2019({
        allErrors: true, logger: false, strictSchema: false, validateSchema: false,
        unicodeRegExp: false, code: { regExp: PYTHON_REGEXP },
    });
    ajv.addKeyword(TYPE_SIZE);
    ajv.addKeyword(DT_TYPE_KEYWORD);
    return ajv;
}

/**
 * A copy of `schema` without the `$id` of the schemas inlined into it. Dereferencing copies a
 * referenced schema, `$id` included, to every place that points at it, and AJV rejects an `$id`
 * that appears twice in one schema. (the translation still reads those `$id`s, so the
 * schema itself keeps them.)
 */
function without_nested_ids<T extends object>(schema: T): T {
    const strip = (node: unknown, is_root: boolean): void => {
        if (Array.isArray(node)) {
            for (const item of node) { strip(item, false); }
        } else if (typeof node === "object" && node !== null) {
            const record = node as Record<string, unknown>;
            if (!is_root && typeof record.$id === "string") { delete record.$id; }
            for (const value of Object.values(record)) { strip(value, false); }
        }
    };
    const copy = structuredClone(schema);
    strip(copy, true);
    return copy;
}

/** Throws when AJV can't compile a schema. */
export function compile_targets(schema: DtBindingSchema): NarrowingTargets {
    const root: NarrowingTarget = {
        original: schema,
        current: schema,
        compiled: create_ajv().compile(without_nested_ids(schema) as object),
    };

    // Each on an instance of its own: a pattern schema keeps its `$id`, the root's or another pattern's (s2mpu02's
    // `^LDO..$` and `^BUCK[1-7]$` are both regulator.yaml), and an instance takes an `$id` once.
    const patterns = new Map<string, NarrowingTarget>();

    for (const [pattern, pattern_schema] of Object.entries((schema.patternProperties ?? {}) as Record<string, DtBindingSchema | boolean>)) {
        if (typeof pattern_schema === "boolean" || !("properties" in pattern_schema)) {
            continue;
        }

        patterns.set(pattern, {
            original: pattern_schema as DtBindingSchema,
            current: structuredClone(pattern_schema) as DtBindingSchema,
            compiled: create_ajv().compile(without_nested_ids(pattern_schema) as object),
        });
    }

    return { root, patterns };
}

/**
 * `branch` merged into `schema`. What a branch requires adds to what the binding requires
 * (dt-schema validates both), where `deep_merge` would replace the list.
 */
function merge_branch(schema: DtBindingSchema, branch: Schema): DtBindingSchema {
    const merged = deep_merge(schema, branch) as DtBindingSchema;
    const required = [...new Set([...(schema.required ?? []), ...(Array.isArray(branch.required) ? branch.required as string[] : [])])];
    return required.length === 0 ? merged : { ...merged, required };
}

/** A branch the canary inserter tagged, without its `CANARY`. */
function without_canary(branch: unknown): Schema {
    if (!is_schema(branch)) { return {}; }
    const properties = branch["properties"];
    if (!is_schema(properties) || !(CANARY in properties)) { return branch; }
    const { [CANARY]: _canary, ...others } = properties;
    return { ...branch, properties: others };
}

/**
 * Runs `data` (`node_data_json`) through the target's compiled schema and narrows the
 * target's schema to the `if/then` branches that now apply, returning it. Only the canary
 * errors are read: dt-validate, not AJV, checks the devicetree. Undefined when
 * `data` isn't JSON or AJV gave no errors to read.
 */
export function narrow(target: NarrowingTarget, data: string): DtBindingSchema | undefined {
    let canary_data;

    try {
        canary_data = JSON.parse(data);
    }
    catch {
        return;
    }

    canary_data[CANARY] = true;

    if (target.compiled(canary_data) === true) {
        return target.current;
    }

    const ajv_errors = target.compiled.errors;

    if (ajv_errors === undefined || ajv_errors === null) {
        return;
    }

    let current = structuredClone(target.original);

    // A failing canary names the `then` or `else` branch whose `if` matched: merge it in.
    for (const error of ajv_errors) {
        if (!error.instancePath.includes(CANARY)) {
            continue;
        }

        const schema_path = decodeURIComponent(error.schemaPath).split('/').slice(1);
        // The canary inserter only tags branches of an `allOf` entry: `allOf/<n>/then`.
        const branch_index = schema_path.findIndex((key, index) => (key === "then" || key === "else") && schema_path[index - 2] === "allOf");
        if (branch_index === -1) {
            continue;
        }
        const sub_schema_to_apply = schema_path.slice(0, branch_index + 1);

        current = merge_branch(current, without_canary(value_at(target.original, sub_schema_to_apply)));
    }

    target.current = current;

    return current;
}

if (import.meta.vitest) {

    const { test, expect } = import.meta.vitest;

    test("a schema that AJV's strict mode refuses but dt-schema takes compiles", () => {
        const schema = {
            properties: {
                endpoint: { type: "object" },
                cells: { type: "array", items: { type: "integer" }, additionalItems: false, $title: "a typo of a binding's" },
            },
            patternProperties: { "^endpoint(@[0-9a-f]+)?$": { type: "object" } },
        } as unknown as DtBindingSchema;

        expect(compile_targets(schema).root.compiled({ endpoint: 1 })).toBe(false);
    });
}
