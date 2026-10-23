import Ajv2019, { type ErrorObject, type KeywordDefinition, type ValidateFunction } from "ajv/dist/2019.js";
import type { DataValidateFunction } from "ajv/dist/types/index.js";

import { CANARY } from "../Bindings/CanaryInserter.js";
import { translate_JSONSchema } from "../Bindings/JSONSchemaTranslate.js";
import { deep_merge, delete_path, get_by_path } from "../Bindings/ObjectUtilities.js";
import { ParsedBinding } from "../Bindings/ParsedBinding.js";
import { DtBindingSchema } from "../Bindings/Schema.js";
import { BindingErrors } from "./Errors.js";

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

/**
 * An AJV instance that knows the `typeSize` keyword, mirroring dt-schema's
 * `validator.py:typeSize`: the instance's `size` (default 32) must equal the schema's.
 */
export function create_ajv(): Ajv2019 {
    const ajv = new Ajv2019({ allErrors: true, logger: false });
    ajv.addKeyword(TYPE_SIZE);
    return ajv;
}

/** Throws when AJV can't compile a schema. */
export function compile_targets(schema: DtBindingSchema): ValidationTargets {
    const root: ValidationTarget = {
        original: schema,
        current: schema,
        validator: create_ajv().compile(schema as object),
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
            validator: pattern_ajv.compile(structuredClone(pattern_schema) as object),
        });
    }

    return { root, patterns };
}

/**
 * Validates `data` (validator-input JSON) against the target and narrows the
 * target's schema to the `if/then` branches that now apply. Undefined when
 * `data` isn't JSON or AJV gave no errors to read.
 */
export function narrow(target: ValidationTarget, data: string): { binding: ParsedBinding, errors: BindingErrors[] } | undefined {
    let canary_data;

    try {
        canary_data = JSON.parse(data);
    }
    catch {
        return;
    }

    canary_data[CANARY] = true;

    if (target.validator(canary_data) === true) {
        return { binding: translate_JSONSchema(target.current), errors: [] };
    }

    const ajv_errors = target.validator.errors;

    if (ajv_errors === undefined || ajv_errors === null) {
        return;
    }

    let current = structuredClone(target.original);

    // A failing canary names the `then` branch whose `if` matched: merge it in.
    for (const error of ajv_errors) {
        if (!error.instancePath.includes(CANARY)) {
            continue;
        }

        const schema_path = decodeURIComponent(error.schemaPath).split('/').slice(1);
        const then_tag_index = schema_path.indexOf("then");
        const sub_schema_to_apply = schema_path.slice(0, then_tag_index + 1);

        const sub_schema = get_by_path(target.original, sub_schema_to_apply) as Record<string, unknown>;
        const strip_canaries = delete_path(sub_schema, [["properties", CANARY]]);

        current = deep_merge(current, strip_canaries);
    }

    target.current = current;

    return { binding: translate_JSONSchema(current), errors: translate_ajv_errors(ajv_errors) };
}

/** The AJV errors that are real validation failures, as typed `BindingErrors`. Canary errors are not. */
export function translate_ajv_errors(errors: readonly ErrorObject[]): BindingErrors[] {
    const translated: BindingErrors[] = [];

    for (const error of errors) {
        if (error.instancePath.includes(CANARY)) {
            continue;
        }

        if (error.keyword === "additionalProperties" && error.params["additionalProperty"] === CANARY) {
            // The injected canary marker itself tripped additionalProperties:false on a
            // schema with no allOf/then branch to narrow into (e.g. a patternProperties
            // sub-schema) — not a real validation error, so it is dropped.
        } else if (error.keyword === "required") {
            translated.push({
                _t: "missing_required",
                missing_property: error.params["missingProperty"] as string,
                instance: error.instancePath.split('/').slice(1),
                msg: error.message
            });
        } else if (["maximum", "minimum", "exclusiveMaximum", "exclusiveMinimum"].includes(error.keyword)) {
            translated.push({
                _t: "number_limit",
                failed_property: error.instancePath.split('/').slice(1),
                limit: error.params["limit"] as number,
                comparison: error.params["comparison"],
                msg: error.message
            });
        } else if (error.keyword === "dependencies") {
            translated.push({
                _t: "failed_dependency",
                dependent_property: error.params["property"] as string,
                missing_property: error.params["missingProperty"] as string,
            });
        } else if (error.keyword !== "if") {
            translated.push({
                _t: "generic",
                origin: decodeURIComponent(error.schemaPath),
                msg: error.message
            });
        }
    }

    return translated;
}
