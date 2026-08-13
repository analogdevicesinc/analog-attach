import { $RefParser } from "@apidevtools/json-schema-ref-parser";
import { BindingErrors, ParsedBinding, ResolvedProperty } from './AttachTypes.js';
import { resolve_references } from '../Bindings/RefResolver.js';
import { resolve_properties } from '../Bindings/PropertyResolver.js';
import { merge_redefinitions } from '../Bindings/RedefinitionMerger.js';
import { insert_canaries } from '../Bindings/CanaryInserter.js';
import { apply_JSONSchema_fixups } from '../Bindings/JSONSchemaFixups.js';

import { DtBindingSchema } from "./DtBindingSchema.js";

import Ajv2019, { ValidateFunction, KeywordDefinition } from "ajv/dist/2019.js";
import { deep_merge, delete_path, getByPath } from "../Bindings/ObjectUtilities.js";
import { translate_JSONSchema } from "../Bindings/JSONSchemaTranslate.js";
import { DeviceTree, DTNode } from "../Devicetree/index.js";
import { query_devicetree } from "../Intelligence/query.js";
import { insert_known_structures } from "../Intelligence/known_properties.js";
import { dt_to_validator_input } from "./DTxBinding.js";

export class Attach {

    private original_binding: DtBindingSchema | undefined;
    private current_binding: DtBindingSchema | undefined;

    private validation_function: ValidateFunction | undefined;

    private pattern_validation_functions: Map<string, ValidateFunction> = new Map();
    private pattern_current_bindings: Map<string, DtBindingSchema> = new Map();

    private constructor() {
    }

    public static new(): Attach {
        return new Attach();
    }

    public async parse_binding(
        binding_path: string,
        linux_path: string,
        dt_schema_path: string
    ): Promise<{
        parsed_binding: ParsedBinding,
        patterns: string[]
    } | undefined> {

        const reference_parser = new $RefParser;

        const reference_resolved = await resolve_references(binding_path, reference_parser, linux_path, dt_schema_path);

        if (typeof reference_resolved === 'string') {
            //console.log(`ERROR: ${binding_path} with ${reference_resolved}`);
            return;
        }

        const property_resolved = await resolve_properties(reference_resolved, reference_parser, linux_path, dt_schema_path);

        if (typeof property_resolved === 'string') {
            //console.log(`ERROR: ${binding_path} with ${property_resolved}`);
            return;
        }

        const redefinition_merged = await merge_redefinitions(property_resolved, reference_resolved.refs, reference_parser, linux_path, dt_schema_path);

        const canary_binding = insert_canaries(redefinition_merged);

        const fixuped = apply_JSONSchema_fixups(canary_binding);

        const parsed_binding: ParsedBinding = translate_JSONSchema(fixuped);

        if (parsed_binding === undefined) {
            return undefined;
        }

        this.original_binding = fixuped;
        this.current_binding = fixuped;

        try {

            const ajv = new Ajv2019({ allErrors: true, logger: false });

            const typeSizeKeyword: KeywordDefinition = {
                keyword: "typeSize",
                schemaType: "number",
                errors: true,

                compile(expectedSize: number) {
                    return function validate(instance: unknown): boolean {
                        let size = 32;

                        if (
                            instance !== null &&
                            typeof instance === "object" &&
                            "size" in instance
                        ) {
                            const value = (instance as { size?: unknown }).size;
                            if (typeof value === "number") {
                                size = value;
                            }
                        }

                        const valid = expectedSize === size;

                        if (!valid) {
                            (validate as any).errors = [
                                {
                                    keyword: "typeSize",
                                    message: `size is ${size}, expected ${expectedSize}`,
                                    params: { size, expectedSize }
                                }
                            ];
                        }

                        return valid;
                    };
                }
            };

            ajv.addKeyword(typeSizeKeyword);

            this.validation_function = ajv.compile(this.original_binding as Object);

            const pattern_ajv = new Ajv2019({ allErrors: true, logger: false });
            pattern_ajv.addKeyword(typeSizeKeyword);

            for (const [pattern, schema] of Object.entries(this.original_binding!.patternProperties ?? {})) {
                const cast_schema = schema as DtBindingSchema;

                if (typeof cast_schema === 'boolean' || !("properties" in cast_schema)) {
                    continue;
                }

                this.pattern_validation_functions.set(pattern, pattern_ajv.compile(structuredClone(cast_schema) as Object));
                this.pattern_current_bindings.set(pattern, structuredClone(cast_schema));
            }
        } catch {
            //console.log(error instanceof Error ? error.message : "Failed to compile validation function");
            return undefined;
        }

        return {
            parsed_binding: parsed_binding,
            patterns: parsed_binding.pattern_properties === undefined ? [] : parsed_binding.pattern_properties.map(pattern => pattern.pattern)
        };
    }

    public static populate_properties(
        properties: ResolvedProperty[],
        devicetree: DeviceTree,
        data: string,
        parent_name?: string,
    ): ResolvedProperty[] {
        return insert_known_structures(query_devicetree(devicetree, properties, data, parent_name));
    }

    public static populate_parsed_binding(
        parsed_binding: ParsedBinding,
        devicetree: DeviceTree,
        data: string | DTNode,
        parent_name?: string,
    ): ParsedBinding {
        const data_string = typeof data === 'string'
            ? data
            : JSON.stringify(
                Object.fromEntries(dt_to_validator_input(data, parsed_binding)),
                (_key, value) => typeof value === 'bigint' ? Number(value) : value
            );

        return {
            ...parsed_binding,
            properties: Attach.populate_properties(parsed_binding.properties, devicetree, data_string, parent_name),
            pattern_properties: parsed_binding.pattern_properties?.map(pattern => ({
                ...pattern,
                properties: Attach.populate_properties(pattern.properties, devicetree, data_string, parent_name),
            })),
        };
    }

    public static async new_populated_binding(
        binding_path: string,
        linux_path: string,
        dt_schema_path: string,
        devicetree: DeviceTree,
        data: string | DTNode,
        parent_name?: string,
    ): Promise<{ attach: Attach, parsed_binding: ParsedBinding, patterns: string[] } | undefined> {
        const attach = Attach.new();
        const result = await attach.parse_binding(binding_path, linux_path, dt_schema_path);

        if (result === undefined) {
            return undefined;
        }

        return {
            attach,
            parsed_binding: Attach.populate_parsed_binding(result.parsed_binding, devicetree, data, parent_name),
            patterns: result.patterns,
        };
    }

    public update_binding_by_changes(data: string): { binding: ParsedBinding, errors: BindingErrors[] } | undefined {

        if (this.original_binding === undefined || this.current_binding === undefined || this.validation_function === undefined) {
            return;
        }

        const result = this.run_validation(this.original_binding, this.current_binding, this.validation_function, data);

        if (result === undefined) {
            return;
        }

        this.current_binding = result.current_binding;

        return { binding: result.binding, errors: result.errors };
    }

    public update_pattern_binding_by_changes(pattern: string, data: string): { binding: ParsedBinding, errors: BindingErrors[] } | undefined {

        const original = this.original_binding?.patternProperties?.[pattern] as DtBindingSchema | undefined;
        const current = this.pattern_current_bindings.get(pattern);
        const validator = this.pattern_validation_functions.get(pattern);

        if (original === undefined || current === undefined || validator === undefined) {
            return;
        }

        const result = this.run_validation(original, current, validator, data);

        if (result === undefined) {
            return;
        }

        this.pattern_current_bindings.set(pattern, result.current_binding);

        return { binding: result.binding, errors: result.errors };
    }

    private run_validation(
        original: DtBindingSchema,
        current: DtBindingSchema,
        validator: ValidateFunction,
        data: string
    ): { current_binding: DtBindingSchema, binding: ParsedBinding, errors: BindingErrors[] } | undefined {

        let canary_data;

        try {
            canary_data = JSON.parse(data);
        }
        catch {
            return;
        }

        canary_data["__canary__"] = true;

        if (validator(canary_data) === true) {
            const binding = translate_JSONSchema(current);
            return { current_binding: current, binding, errors: [] };
        }

        if (validator.errors === undefined || validator.errors === null) {
            return;
        }

        let current_binding = structuredClone(original);

        let error_accumulator: BindingErrors[] = [];

        for (const error of validator.errors) {

            const decoded_error_schema_path = decodeURIComponent(error.schemaPath);

            if (error.instancePath.includes("__canary__")) {
                const schema_path = decoded_error_schema_path.split('/').slice(1);
                const then_tag_index = schema_path.indexOf("then");
                const sub_schema_to_apply = schema_path.slice(0, then_tag_index + 1);

                const sub_schema = getByPath(original, sub_schema_to_apply) as Record<string, any>;
                const strip_canaries = delete_path(sub_schema, [["properties", "__canary__"]]);

                current_binding = deep_merge(current_binding, strip_canaries);
            } else if (error.keyword === "additionalProperties" && error.params["additionalProperty"] === "__canary__") {
                // The injected canary marker itself tripped additionalProperties:false on a
                // schema with no allOf/then branch to narrow into (e.g. a patternProperties
                // sub-schema) — not a real validation error, so it is dropped.
            } else if (error.keyword === "required") {

                const instance = error.instancePath.split('/').slice(1);

                error_accumulator.push(
                    {
                        _t: "missing_required",
                        missing_property: error.params["missingProperty"] as string,
                        instance: instance,
                        msg: error.message
                    }
                );

            } else if (["maximum", "minimum", "exclusiveMaximum", "exclusiveMinimum"].includes(error.keyword)) {

                const failed_property = error.instancePath.split('/').slice(1);

                error_accumulator.push(
                    {
                        _t: "number_limit",
                        failed_property: failed_property,
                        limit: error.params["limit"] as number,
                        comparison: error.params["comparison"],
                        msg: error.message
                    });
            } else if (error.keyword === "dependencies") {
                error_accumulator.push(
                    {
                        _t: "failed_dependency",
                        dependent_property: error.params["property"] as string,
                        missing_property: error.params["missingProperty"] as string,
                    }
                );
            }
            else if (error.keyword !== "if") {
                error_accumulator.push(
                    {
                        _t: "generic",
                        origin: decoded_error_schema_path,
                        msg: error.message
                    });
            }

        }

        const binding = translate_JSONSchema(current_binding);

        return { current_binding, binding, errors: error_accumulator };
    }
}