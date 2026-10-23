import { ParsedBinding, ResolvedProperty, PatternPropertyRule, PropertyPatternRule } from "./ParsedBinding";
import { DtBindingSchema } from "./Schema";
import { AttachType, AttachEnumType, AttachArray, FixedIndex } from "./StructuralTypes";
import { find_entry_in_object } from "./ObjectUtilities";
import { is_node_pattern } from "./PatternKind.js";

export function translate_JSONSchema(fixuped: DtBindingSchema): ParsedBinding {

    const resolved_properties = order_properties(translate_node_schema(fixuped), fixuped.required);

    const pattern_properties: PatternPropertyRule[] = [];
    const property_patterns: PropertyPatternRule[] = [];

    for (const [pattern, schema] of Object.entries(fixuped.patternProperties ?? {})) {
        // false forbids names that match
        if (schema === false) {
            continue;
        }

        const node_schema = typeof schema === 'object' ? schema as DtBindingSchema : undefined;
        const description = node_schema?.description ?? "";

        if (!is_node_pattern(pattern, schema)) {
            property_patterns.push({
                pattern: pattern,
                description: description,
                value: narrow_object(schema)
            });
            continue;
        }

        pattern_properties.push({
            pattern: pattern,
            description: description,
            properties: translate_node_schema(node_schema),
            required: node_schema?.required ?? []
        });
    }

    return {
        title: fixuped.title,
        description: fixuped.description,
        required_properties: fixuped.required === undefined ? [] : fixuped.required,
        properties: resolved_properties,
        pattern_properties: pattern_properties.length === 0 ? undefined : pattern_properties,
        property_patterns: property_patterns.length === 0 ? undefined : property_patterns,
        examples: fixuped.examples ?? []
    };
}

/** The properties a node schema declares itself, followed by the ones its `allOf` entries bring. */
function translate_node_schema(schema: DtBindingSchema | undefined): ResolvedProperty[] {
    return [...collect_properties(schema?.properties), ...translate_JSONSchema_allOf(schema?.allOf)];
}

function collect_properties(properties: Record<string, unknown> | undefined): ResolvedProperty[] {
    const collected: ResolvedProperty[] = [];

    for (const [name, value] of Object.entries(properties ?? {})) {
        // Shouldn't be of concern to users
        if (name === "$nodename" || name === "label") {
            continue;
        }

        collected.push({ key: name, value: narrow_object(value) });
    }

    return collected;
}

/** Required properties first, then the clock and interrupt properties right after `clocks` and `interrupts`. */
function order_properties(properties: ResolvedProperty[], required: string[] | undefined): ResolvedProperty[] {
    const ordered = [...properties];

    // eslint-disable-next-line unicorn/no-array-reverse -- toReversed is past the lib target
    for (const name of [...(required ?? [])].reverse()) {
        const found = ordered.find((value) => value.key === name);

        if (found !== undefined) {
            const found_index = ordered.indexOf(found);
            ordered.unshift(found);
            ordered.splice(found_index + 1, 1);
        }
    }

    for (const to_sort of [{ property: "clocks", search_term: "clock" }, { property: "interrupts", search_term: "interrupt" }]) {

        const group_start = ordered.find((value) => value.key === to_sort.property);

        if (group_start !== undefined) {
            const group_start_index = ordered.indexOf(group_start);
            for (const property of ordered) {
                if (property.key !== to_sort.property && property.key.includes(to_sort.search_term)) {
                    const found_index = ordered.indexOf(property);
                    const element = structuredClone(property);
                    ordered.splice(found_index, 1);
                    ordered.splice(group_start_index + 1, 0, element);
                }
            }
        }
    }

    return ordered;
}

function translate_JSONSchema_allOf(allOf: any[] | undefined): ResolvedProperty[] {

    let properties: ResolvedProperty[] = [];

    for (const item of allOf ?? []) {
        if (!("$id" in item)) {
            continue;
        }

        if (item.properties === undefined) {
            continue;
        }

        properties = [...properties, ...collect_properties(item.properties), ...translate_JSONSchema_allOf(item.allOf)];
    }

    return properties;
}

/** The row schema of an array of one-cell arrays (`items: {type: array, items: [x]}`, the `items` itself or wrapped in a one-element array). */
function matrix_row(object: any): any {
    const row = Array.isArray(object.items) ? (object.items.length === 1 ? object.items[0] : undefined) : object.items;

    if (typeof row === 'object' && row !== null && row.type === "array" && Array.isArray(row.items) && row.items.length === 1) {
        return row;
    }

    return undefined;
}

// TODO: handle objects
function narrow_object(object: any): AttachType {

    if (typeof object === 'object' && "type" in object) {
        switch (object.type) {
            case "array":
                {
                    const row = matrix_row(object);

                    if (row !== undefined) {
                        return {
                            _t: "matrix",
                            minItems: object.minItems,
                            maxItems: object.maxItems,
                            description: object.description,
                            values: [narrow_array_object(row)]
                        };
                    }

                    return narrow_array_object(object);
                }
            case "string": {
                const minItems = object.minItems;
                const maxItems = object.maxItems;
                const description = object.description;

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
                    const minimum = object.minimum;
                    const maximum = object.maximum;
                    const typeSize = object.typeSize;
                    const description = object.description;
                    const default_value = object.default;

                    if ("enum" in object) {

                        return {
                            _t: 'enum_integer',
                            enum: (object.enum as number[]).map(BigInt),
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
                const description = object.description;
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
        const description = object.description;
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

            const description = object.description;

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
        const description = object.description;
        return { _t: "const", const: object.const, description: description };
    }

    if (
        typeof object === 'object' &&
        "type" in object &&
        object.type === "object"
    ) {
        const description = object.description;
        return {
            _t: "object",
            description: description,
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

    const minItems = object.minItems;
    const maxItems = object.maxItems;
    const description = object.description;


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
            description: description,
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
            enum: [object.items.const],
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
        const minimum = object.items.minimum;
        const maximum = object.items.maximum;
        const typeSize = object.items.typeSize;

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
        const minimum = object.items[0].minimum;
        const maximum = object.items[0].maximum;
        const typeSize = object.items[0].typeSize;

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
        const minimum = object.minimum;
        const maximum = object.maximum;
        const typeSize = object.typeSize;

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
