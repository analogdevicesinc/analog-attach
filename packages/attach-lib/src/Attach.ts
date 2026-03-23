import { $RefParser } from "@apidevtools/json-schema-ref-parser";
import { BindingErrors, ParsedBinding, ResolvedProperty } from './AttachTypes.js';
import { resolve_references } from './binding-processor/RefResolver.js';
import { resolve_properties } from './binding-processor/PropertyResolver.js';
import { merge_redefinitions } from './binding-processor/RedefinitionMerger.js';
import { insert_canaries } from './binding-processor/CanaryInserter.js';
import { apply_JSONSchema_fixups } from './binding-processor/JSONSchemaFixups.js';

import { DtBindingSchema } from "./DtBindingSchema.js";
import { AttachArray, AttachType, AttachEnumType, FixedIndex } from "./StructuralTypes.js";
import { PatternPropertyRule } from "./AttachTypes.js";

import Ajv2019, { ValidateFunction, KeywordDefinition } from "ajv/dist/2019.js";
import { deep_merge, delete_path, find_entry_in_object, getByPath } from "./binding-processor/ObjectUtilities.js";

export class Attach {

    private original_binding: DtBindingSchema | undefined;
    private current_binding: DtBindingSchema | undefined;

    private validation_function: ValidateFunction | undefined;

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
        } catch {
            //console.log(error instanceof Error ? error.message : "Failed to compile validation function");
            return undefined;
        }

        return {
            parsed_binding: parsed_binding,
            patterns: parsed_binding.pattern_properties === undefined ? [] : parsed_binding.pattern_properties.map(pattern => pattern.pattern)
        };
    }

    public update_binding_by_changes(data: string): { binding: ParsedBinding, errors: BindingErrors[] } | undefined {

        if (this.original_binding === undefined || this.current_binding === undefined || this.validation_function === undefined) {
            return;
        }

        let canary_data;

        try {
            canary_data = JSON.parse(data);
        }
        catch {
            return;
        }

        canary_data["__canary__"] = true;

        if (this.validation_function(canary_data) === true) {
            const binding = translate_JSONSchema(this.current_binding);
            return { binding, errors: [] };
        }

        if (this.validation_function.errors === undefined || this.validation_function.errors === null) {
            return;
        }

        this.current_binding = structuredClone(this.original_binding);

        let error_accumulator: BindingErrors[] = [];

        for (const error of this.validation_function.errors) {

            const decoded_error_schema_path = decodeURIComponent(error.schemaPath);

            if (error.instancePath.includes("__canary__")) {
                const schema_path = decoded_error_schema_path.split('/').slice(1);
                const then_tag_index = schema_path.indexOf("then");
                const sub_schema_to_apply = schema_path.slice(0, then_tag_index + 1);

                const sub_schema = getByPath(this.original_binding, sub_schema_to_apply) as Record<string, any>;
                const strip_canaries = delete_path(sub_schema, [["properties", "__canary__"]]);

                this.current_binding = deep_merge(this.current_binding, strip_canaries);
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

        const binding = translate_JSONSchema(this.current_binding);

        return { binding: binding, errors: error_accumulator };
    }
}

function translate_JSONSchema(fixuped: DtBindingSchema): ParsedBinding {

    let resolved_properties: ResolvedProperty[] = [];

    if (fixuped.properties !== undefined) {

        for (const [name, value] of Object.entries(fixuped.properties)) {

            // Shouldn't be of concern to users
            if (name === "$nodename" || name === "label") {
                continue;
            }

            resolved_properties.push({
                key: name,
                value: narrow_object(value)
            });
        }
    }

    resolved_properties = [...resolved_properties, ...translate_JSONSchema_allOf(fixuped.allOf)];

    const pattern_properties: PatternPropertyRule[] = [];

    if (fixuped.patternProperties !== undefined) {

        for (const [pattern, schema] of Object.entries(fixuped.patternProperties)) {
            const cast_schema = schema as DtBindingSchema;
            const description = cast_schema.description ?? "";
            const required = cast_schema.required ?? [];

            let resolved_properties_pattern: ResolvedProperty[] = [];

            if (typeof cast_schema === 'boolean' || !("properties" in cast_schema)) {
                // TODO: add non object pattern props support
                continue;
            }

            for (const [name, value] of Object.entries(cast_schema.properties)) {
                // Shouldn't be of concern to users
                if (name === "$nodename" || name === "label") {
                    continue;
                }

                resolved_properties_pattern.push({
                    key: name,
                    value: narrow_object(value)
                });
            }

            resolved_properties_pattern = [...resolved_properties_pattern, ...translate_JSONSchema_allOf(cast_schema.allOf)];

            pattern_properties.push({
                pattern: pattern,
                description: description,
                properties: resolved_properties_pattern,
                required: required
            });

        }
    }

    if (fixuped.required !== undefined) {
        // eslint-disable-next-line unicorn/no-array-reverse
        const reverse_required = structuredClone(fixuped.required).reverse();
        for (const property of reverse_required) {
            const found = resolved_properties.find((value) => value.key === property);

            if (found !== undefined) {
                const found_index = resolved_properties.indexOf(found);
                resolved_properties.unshift(found);
                resolved_properties.splice(found_index + 1, 1);
            }

        }
    }

    for (const to_sort of [{ property: "clocks", search_term: "clock" }, { property: "interrupts", search_term: "interrupt" }]) {

        const group_start = resolved_properties.find((value) => value.key === to_sort.property);

        if (group_start !== undefined) {
            const group_start_index = resolved_properties.indexOf(group_start);
            for (const property of resolved_properties) {
                if (property.key !== to_sort.property && property.key.includes(to_sort.search_term)) {
                    const found_index = resolved_properties.indexOf(property);
                    const element = structuredClone(property);
                    resolved_properties.splice(found_index, 1);
                    resolved_properties.splice(group_start_index + 1, 0, element);
                }
            }
        }
    }

    return {
        required_properties: fixuped.required === undefined ? [] : fixuped.required,
        properties: resolved_properties,
        pattern_properties: pattern_properties.length === 0 ? undefined : pattern_properties,
        examples: fixuped.examples ?? []
    };
}

function translate_JSONSchema_allOf(allOf: any[] | undefined): ResolvedProperty[] {

    let properties: ResolvedProperty[] = [];

    if (allOf === undefined) {
        return properties;
    }

    for (const item of allOf) {
        if (!("$id" in item)) {
            continue;
        }

        if (item.properties === undefined) {
            continue;
        }

        for (const [name, value] of Object.entries(item.properties)) {
            // Shouldn't be of concern to users
            if (name === "$nodename" || name === "label") {
                continue;
            }

            properties.push({
                key: name,
                value: narrow_object(value)
            });
        }

        properties = [...properties, ...translate_JSONSchema_allOf(item.allOf)];
    }

    return properties;
}

// TODO: handle objects
function narrow_object(object: any): AttachType {

    if (typeof object === 'object' && "type" in object) {
        switch (object.type) {
            case "array":
                {
                    if (
                        "items" in object &&
                        !Array.isArray(object.items) &&
                        "type" in object.items &&
                        object.items.type === "array" &&
                        "items" in object.items &&
                        Array.isArray(object.items.items) &&
                        object.items.items.length === 1
                    ) {
                        const minItems = "minItems" in object ? object.minItems : undefined;
                        const maxItems = "maxItems" in object ? object.maxItems : undefined;
                        const description = "description" in object ? object.description : undefined;

                        return {
                            _t: "matrix",
                            minItems: minItems,
                            maxItems: maxItems,
                            description: description,
                            values: [narrow_array_object(object.items)]
                        };
                    }

                    if (
                        "items" in object &&
                        Array.isArray(object.items) &&
                        object.items.length === 1 &&
                        "type" in object.items[0] &&
                        object.items[0].type === "array" &&
                        "items" in object.items[0] &&
                        Array.isArray(object.items[0].items) &&
                        object.items[0].items.length === 1
                    ) {
                        const minItems = "minItems" in object ? object.minItems : undefined;
                        const maxItems = "maxItems" in object ? object.maxItems : undefined;
                        const description = "description" in object ? object.description : undefined;

                        return {
                            _t: "matrix",
                            minItems: minItems,
                            maxItems: maxItems,
                            description: description,
                            values: [narrow_array_object(object.items[0])]
                        };
                    }

                    return narrow_array_object(object);
                }
            case "string": {
                const minItems = "minItems" in object ? object.minItems : undefined;
                const maxItems = "maxItems" in object ? object.maxItems : undefined;
                const description = "description" in object ? object.description : undefined;

                const unique = find_entry_in_object(
                    object,
                    (_path: string[], key: string, _value: unknown) => {
                        if (key === 'uniqueItems') {
                            return true;
                        };

                        return false;
                    }
                );

                const unique_items = unique.length === 0 ? false : (typeof unique[0].value === "boolean" ? unique[0].value : false);

                return {
                    _t: "string_array",
                    minItems: minItems,
                    maxItems: maxItems,
                    description: description,
                    unique_items: unique_items
                };
            }
            case "integer":
                {
                    const minimum = "minimum" in object ? object.minimum : undefined;
                    const maximum = "maximum" in object ? object.maximum : undefined;
                    const typeSize = "typeSize" in object ? object.typeSize : undefined;
                    const description = "description" in object ? object.description : undefined;
                    const default_value = "default" in object ? object.default : undefined;

                    if ("enum" in object) {

                        return {
                            _t: 'enum_integer',
                            enum: object.enum,
                            typeSize: typeSize,
                            description: description,
                            default: default_value
                        };
                    }

                    return {
                        _t: 'integer',
                        minimum: minimum,
                        maximum: maximum,
                        typeSize: typeSize,
                        description: description,
                        default: default_value
                    };
                }
            case "boolean": {
                const description = "description" in object ? object.description : undefined;
                return { _t: "boolean", description: description };
            }
        }
    }

    if (
        typeof object === 'object' &&
        "oneOf" in object &&
        Array.isArray(object.oneOf) &&
        object.oneOf.length === 2 &&
        object.oneOf[0].type === "boolean" &&
        object.oneOf[0].const === true &&
        object.oneOf[1].type === 'null'
    ) {
        const description = "description" in object ? object.description : undefined;
        return { _t: "boolean", description: description };
    }

    if (
        typeof object === 'object' &&
        "oneOf" in object &&
        Array.isArray(object.oneOf)
    ) {
        const oneOf: any[] = object.oneOf;

        const only_fixed_size_arrays = oneOf.every((value) => {
            if (!("items" in value)) { return false; }
            if (!("type" in value)) { return false; }
            if (value.type !== "array") { return false; }
            if (!("minItems" in value)) { return false; }
            if (!("maxItems" in value)) { return false; }
            if (value.minItems !== value.maxItems) { return false; }

            if (!Array.isArray(value.items)) {
                return false;
            }

            for (const element of value.items) {
                if (!Object.entries(element).some((value) => value[0] === "enum" || value[0] === "const")) {
                    return false;
                }
            }

            return true;
        });

        if (only_fixed_size_arrays === true) {
            let enum_accumulator: any[] = [];

            for (const entry of oneOf) {
                if (entry.items.length === 1 && "enum" in entry.items[0]) {
                    enum_accumulator = [...enum_accumulator, ...entry.items[0].enum];
                    continue;
                }
                // TODO: https://github.com/analogdevicesinc/linux/blob/main/Documentation/devicetree/bindings/iio/imu/st%2Clsm6dsx.yaml
                let composed_enum: string[] = [];

                for (const item of entry.items) {
                    composed_enum.push(item.const);
                }

                enum_accumulator.push(composed_enum);
            }

            const description = "description" in object ? object.description : undefined;

            return {
                _t: "enum_array",
                minItems: 1,
                maxItems: 1,
                enum: enum_accumulator,
                description: description,
                enum_type: get_enum_type(enum_accumulator)
            };

        }
    }

    if (
        typeof object === 'object' &&
        "const" in object &&
        object.const !== undefined
    ) {
        return { _t: "const", const: object.const };
    }

    if (
        typeof object === 'object' &&
        "type" in object &&
        object.type === "object"
    ) {
        return {
            _t: "object",
            properties: translate_JSONSchema(object).properties
        };
    }

    return { _t: "generic", description: object.description };
}

function get_enum_type(object: any): AttachEnumType.STRING | AttachEnumType.NUMBER {

    if (typeof object === 'string') {
        return AttachEnumType.STRING;
    }

    if (typeof object === 'number') {
        return AttachEnumType.NUMBER;
    }

    if (Array.isArray(object)) {
        if (object.every((entry) => typeof entry === 'string')) {
            return AttachEnumType.STRING;
        }

        if (object.every((entry) => typeof entry === 'number')) {
            return AttachEnumType.NUMBER;
        }
    }

    // IF it's mixed we are are in a bad place anyways
    return AttachEnumType.STRING;
};

function narrow_array_object(object: any): AttachArray {

    const minItems = "minItems" in object ? object.minItems : undefined;
    const maxItems = "maxItems" in object ? object.maxItems : undefined;
    const description = "description" in object ? object.description : undefined;


    // Ex. simple compatible definition
    if (
        "items" in object &&
        Array.isArray(object.items) &&
        object.items.length === 1 &&
        "enum" in object.items[0]
    ) {
        return {
            _t: 'enum_array',
            minItems: minItems,
            maxItems: maxItems,
            enum: object.items[0].enum,
            description: description,
            enum_type: get_enum_type(object.items[0].enum)
        };
    }

    // Ex. simple compatible definition with only one value
    if (
        "items" in object &&
        Array.isArray(object.items) &&
        object.items.length === 1 &&
        "const" in object.items[0]
    ) {
        return {
            _t: 'enum_array',
            minItems: minItems,
            maxItems: maxItems,
            enum: [object.items[0].const],
            description: description,
            default: object.items[0].const,
            enum_type: get_enum_type(object.items[0].const)
        };
    }

    if (
        "items" in object &&
        Array.isArray(object.items) &&
        object.items.length > 1
    ) {

        let prefix_items: FixedIndex[] = [];

        for (const definition of object.items) {
            if ("enum" in definition) {
                prefix_items.push(
                    {
                        _t: "enum",
                        enum: definition.enum,
                        enum_type: get_enum_type(definition.enum)
                    }
                );
            } else if ("const" in definition) {
                prefix_items.push(
                    {
                        _t: "enum",
                        enum: definition.const,
                        default: definition.const,
                        enum_type: get_enum_type(definition.const),
                    }
                );
            } else {
                // FAILSAFE
                return {
                    _t: 'array',
                    minItems: minItems,
                    maxItems: maxItems,
                    description: description,
                };
            }
        }

        return {
            _t: 'fixed_index',
            minItems: minItems,
            maxItems: maxItems,
            prefixItems: prefix_items
        };
    }

    if (
        "items" in object &&
        !Array.isArray(object.items) &&
        "enum" in object.items
    ) {
        return {
            _t: 'enum_array',
            minItems: minItems,
            maxItems: maxItems,
            enum: object.items.enum,
            description: description,
            enum_type: get_enum_type(object.items.enum)
        };
    }

    if (
        "items" in object &&
        !Array.isArray(object.items) &&
        "const" in object.items
    ) {
        return {
            _t: 'enum_array',
            minItems: minItems,
            maxItems: maxItems,
            enum: object.items.const,
            default: object.items.const,
            description: description,
            enum_type: get_enum_type(object.items.const)
        };
    }

    // object level enum with  $ref: /schemas/types.yaml#/definitions/string
    if (
        "enum" in object &&
        "items" in object &&
        "type" in object.items &&
        object.items.type === "string"
    ) {
        const default_value = "default" in object ? object.default : [];

        return {
            _t: 'enum_array',
            minItems: minItems,
            maxItems: maxItems,
            enum: object.enum,
            description: description,
            default: default_value,
            enum_type: get_enum_type(object.enum)
        };
    }

    // Integer array with definition in items
    if (
        "items" in object &&
        "type" in object.items &&
        object.items.type === "integer"
    ) {
        const minimum = "minimum" in object.items ? object.items.minimum : undefined;
        const maximum = "maximum" in object.items ? object.items.maximum : undefined;
        const typeSize = "typeSize" in object.items ? object.items.typeSize : undefined;

        return {
            _t: 'number_array',
            minItems: minItems,
            maxItems: maxItems,
            minimum: minimum,
            maximum: maximum,
            typeSize: typeSize,
            description: description,
        };
    }

    // Integer array with definition in items but items is an array
    if (
        "items" in object &&
        Array.isArray(object["items"]) &&
        object["items"].length === 1 &&
        "type" in object.items[0] &&
        object.items[0].type === "integer"
    ) {
        const minimum = "minimum" in object.items[0] ? object.items[0].minimum : undefined;
        const maximum = "maximum" in object.items[0] ? object.items[0].maximum : undefined;
        const typeSize = "typeSize" in object.items[0] ? object.items[0].typeSize : undefined;

        return {
            _t: 'number_array',
            minItems: minItems,
            maxItems: maxItems,
            minimum: minimum,
            maximum: maximum,
            typeSize: typeSize,
            description: description,
        };
    }

    // Integer array with constraints outside items
    if (
        !("items" in object) &&
        ("minimum" in object || "maximum" in object)
    ) {
        const minimum = "minimum" in object ? object.minimum : undefined;
        const maximum = "maximum" in object ? object.maximum : undefined;
        const typeSize = "typeSize" in object ? object.typeSize : undefined;

        return {
            _t: 'number_array',
            minItems: minItems,
            maxItems: maxItems,
            minimum: minimum,
            maximum: maximum,
            typeSize: typeSize,
            description: description,
        };
    }

    const unique_items = "uniqueItems" in object ? object.uniqueItems : false;

    // String array with type inside items object
    if (
        "items" in object &&
        !Array.isArray(object.items) &&
        "type" in object.items &&
        object.items.type === "string"
    ) {
        return {
            _t: "string_array",
            minItems: minItems,
            maxItems: maxItems,
            description: description,
            unique_items: unique_items
        };
    }

    // String array with type inside items array
    if (
        "items" in object &&
        Array.isArray(object.items) &&
        object.items.length === 1 &&
        "type" in object.items[0] &&
        object.items[0].type === "string"
    ) {
        return {
            _t: "string_array",
            minItems: minItems,
            maxItems: maxItems,
            description: description,
            unique_items: unique_items
        };
    }

    // Array of whatever
    return {
        _t: 'array',
        minItems: minItems,
        maxItems: maxItems,
        description: description,
    };
}
