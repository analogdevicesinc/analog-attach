import Ajv2019, { type KeywordDefinition, type ValidateFunction } from "ajv/dist/2019.js";
import type { DataValidateFunction } from "ajv/dist/types/index.js";

import { CANARY } from "../Bindings/CanaryInserter.js";
import { DT_TYPE } from "../Bindings/RefResolver.js";
import { translate_JSONSchema } from "../Bindings/JSONSchemaTranslate.js";
import { deep_merge, delete_path, get_by_path } from "../Bindings/ObjectUtilities.js";
import { ParsedBinding } from "../Bindings/ParsedBinding.js";
import { DtBindingSchema } from "../Bindings/Schema.js";

/** A schema, the validator compiled from it and the schema narrowed so far by the data it saw. */
export type ValidationTarget = {
    original: DtBindingSchema;
    current: DtBindingSchema;
    validator: ValidateFunction;
};

export type ValidationTargets = {
    root: ValidationTarget;
    /** Child-node pattern schemas that declare properties, by pattern. */
    patterns: Map<string, ValidationTarget>;
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

/** `dtType` (see `RefResolver.ts`) only annotates: it says what the schema was before dereferencing. */
const DT_TYPE_KEYWORD: KeywordDefinition = { keyword: DT_TYPE, schemaType: "string" };

/**
 * An AJV instance that knows the `typeSize` keyword, mirroring dt-schema's
 * `validator.py:typeSize`: the instance's `size` (default 32) must equal the schema's.
 *
 * Without AJV's strict schema checks: it only narrows the `if/then` branches here, so it takes what dt-schema's
 * validator takes. A name that a pattern matches too (graph.yaml's `endpoint`), an `additionalItems` beside one
 * `items` schema and an unknown keyword are valid JSON Schema, which strict mode refuses to compile.
 */
export function create_ajv(): Ajv2019 {
    const ajv = new Ajv2019({ allErrors: true, logger: false, strictSchema: false });
    ajv.addKeyword(TYPE_SIZE);
    ajv.addKeyword(DT_TYPE_KEYWORD);
    return ajv;
}

/**
 * A copy of `schema` without the `$id` of the schemas inlined into it. Dereferencing copies a
 * referenced schema, `$id` included, to every place that points at it, and AJV rejects an `$id`
 * that appears twice in one schema. (`translate_JSONSchema` still reads those `$id`s, so the
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
export function compile_targets(schema: DtBindingSchema): ValidationTargets {
    const root: ValidationTarget = {
        original: schema,
        current: schema,
        validator: create_ajv().compile(without_nested_ids(schema) as object),
    };

    // Kept apart from the root's instance, as a pattern schema may reuse its ids.
    const pattern_ajv = create_ajv();
    const patterns = new Map<string, ValidationTarget>();

    for (const [pattern, pattern_schema] of Object.entries((schema.patternProperties ?? {}) as Record<string, DtBindingSchema | boolean>)) {
        if (typeof pattern_schema === "boolean" || !("properties" in pattern_schema)) {
            continue;
        }

        patterns.set(pattern, {
            original: pattern_schema as DtBindingSchema,
            current: structuredClone(pattern_schema) as DtBindingSchema,
            validator: pattern_ajv.compile(without_nested_ids(pattern_schema) as object),
        });
    }

    return { root, patterns };
}

/**
 * `branch` merged into `schema`. What a branch requires adds to what the binding requires
 * (dt-schema validates both), where `deep_merge` would replace the list.
 */
function merge_branch(schema: DtBindingSchema, branch: Record<string, unknown>): DtBindingSchema {
    const merged = deep_merge(schema, branch);
    const required = [...new Set([...(schema.required ?? []), ...(Array.isArray(branch.required) ? branch.required as string[] : [])])];
    return required.length === 0 ? merged : { ...merged, required };
}

/**
 * Validates `data` (validator-input JSON) against the target and narrows the
 * target's schema to the `if/then` branches that now apply. Only the canary
 * errors are read: dt-validate, not AJV, checks the devicetree. Undefined when
 * `data` isn't JSON or AJV gave no errors to read.
 */
export function narrow(target: ValidationTarget, data: string): ParsedBinding | undefined {
    let canary_data;

    try {
        canary_data = JSON.parse(data);
    }
    catch {
        return;
    }

    canary_data[CANARY] = true;

    if (target.validator(canary_data) === true) {
        return translate_JSONSchema(target.current);
    }

    const ajv_errors = target.validator.errors;

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

        const sub_schema = get_by_path(target.original, sub_schema_to_apply) as Record<string, unknown>;
        const strip_canaries = delete_path(sub_schema, [["properties", CANARY]]);

        current = merge_branch(current, strip_canaries);
    }

    target.current = current;

    return translate_JSONSchema(current);
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

        expect(compile_targets(schema).root.validator({ endpoint: 1 })).toBe(false);
    });
}
