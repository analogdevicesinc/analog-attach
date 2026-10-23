import { ParsedBinding, ResolvedProperty, PatternPropertyRule, PropertyPatternRule } from "./ParsedBinding";
import { DtBindingSchema } from "./Schema";
import { AttachType, AttachEnumType, Cell, EnumOption, List } from "./StructuralTypes";
import { find_entry_in_object } from "./ObjectUtilities";
import { is_node_pattern } from "./PatternKind.js";
import { is_matrix_type } from "./PropertyTypes.js";
import { DT_TYPE } from "./RefResolver.js";

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

/** A schema number as a bigint; undefined when it isn't a whole number. */
function to_bigint(value: unknown): bigint | undefined {
    if (typeof value === "bigint") { return value; }
    return typeof value === "number" && Number.isInteger(value) ? BigInt(value) : undefined;
}

/** An enum option as the lib holds it: whole numbers as bigints, strings and string lists as they are. */
function to_option(value: unknown): EnumOption | undefined {
    if (typeof value === "string") { return value; }
    if (Array.isArray(value) && value.every(entry => typeof entry === "string")) { return value as string[]; }
    return to_bigint(value);
}

function to_options(values: unknown): EnumOption[] {
    return (Array.isArray(values) ? values : [values]).map(value => to_option(value)).filter((option): option is EnumOption => option !== undefined);
}

/** The single default a cell can carry; a list-valued default (`[]`, `["gpio"]`) is reduced to its only entry. */
function to_default(value: unknown): bigint | string | undefined {
    const single = Array.isArray(value) ? (value.length === 1 ? value[0] : undefined) : value;
    return typeof single === "string" ? single : to_bigint(single);
}

function enum_cell(options: unknown, default_value?: unknown): Cell {
    const entries = to_options(options);
    const default_option = to_default(default_value);
    return {
        _t: "enum",
        enum: entries,
        enum_type: get_enum_type(entries),
        ...(default_option === undefined ? {} : { default: default_option }),
    };
}

function number_cell(schema: any, default_value?: unknown): Cell {
    const minimum = to_bigint(schema.minimum);
    const maximum = to_bigint(schema.maximum);
    const default_number = to_bigint(default_value);
    return {
        _t: "number",
        ...(minimum === undefined ? {} : { minimum }),
        ...(maximum === undefined ? {} : { maximum }),
        ...(default_number === undefined ? {} : { default: default_number }),
    };
}

/** The bounds a schema gives, left out of the type when it doesn't. */
function bounds(schema: any): Pick<List, "minItems" | "maxItems"> {
    return {
        ...(schema.minItems === undefined ? {} : { minItems: schema.minItems }),
        ...(schema.maxItems === undefined ? {} : { maxItems: schema.maxItems }),
    };
}

function described<T extends object>(schema: any, type: T): T & { description?: string } {
    return schema.description === undefined ? type : { ...type, description: schema.description };
}

/**
 * A `oneOf` of lists that each hold exactly their `enum` / `const` entries (the values a `compatible` can take,
 * the fallback lists among them) is one list of one such value.
 */
function fixed_size_enum_list(object: any): AttachType | undefined {
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

    if (!only_fixed_size_arrays) { return undefined; }

    let enum_accumulator: unknown[] = [];

    for (const entry of oneOf) {
        if (entry.items.length === 1 && "enum" in entry.items[0]) {
            enum_accumulator = [...enum_accumulator, ...entry.items[0].enum];
            continue;
        }
        // TODO: https://github.com/analogdevicesinc/linux/blob/main/Documentation/devicetree/bindings/iio/imu/st%2Clsm6dsx.yaml
        enum_accumulator.push(entry.items.map((item: any) => item.const));
    }

    return described(object, {
        _t: "list" as const,
        item: enum_cell(enum_accumulator),
        minItems: 1,
        maxItems: 1,
    });
}

/**
 * A property of a matrix type (`reg`, `interrupts`, `clocks`: `<1 2>, <3 4>`): its rows are what its `items` describe
 * (`items` itself, or its first entry when it is a list), each row a list of cells.
 */
function narrow_matrix(object: any, type: string): AttachType {
    const items = Array.isArray(object.items) ? object.items[0] : object.items;
    // The description of the first row says nothing of the others
    const { description: _description, ...row_schema } = typeof items === "object" && items !== null ? items : {} as Record<string, unknown>;

    return described(object, {
        _t: "matrix",
        // one phandle is one row of one cell
        ...bounds(type === "phandle" ? { minItems: 1, maxItems: 1, ...object } : object),
        rows: [{
            ...narrow_array_object({ ...row_schema, type: "array" }),
            ...(type === "phandle" ? { minItems: 1, maxItems: 1, ...bounds(row_schema) } : {}),
        }],
    });
}

// TODO: handle objects
function narrow_object(object: any): AttachType {

    if (typeof object === 'object' && object !== null && is_matrix_type(object[DT_TYPE])) {
        return narrow_matrix(object, object[DT_TYPE]);
    }

    if (typeof object === 'object' && "type" in object) {
        switch (object.type) {
            case "array":
                {
                    const row = matrix_row(object);

                    if (row !== undefined) {
                        return described(object, {
                            _t: "matrix",
                            ...bounds(object),
                            rows: [narrow_array_object(row)]
                        });
                    }

                    return narrow_array_object(object);
                }
            case "string": {
                const unique = find_entry_in_object(object, (_path: string[], key: string) => key === 'uniqueItems');
                const unique_items = unique.length > 0 && unique[0].value === true;

                return described(object, {
                    _t: "list",
                    item: { _t: "string" },
                    ...bounds(object),
                    ...(unique_items ? { unique: true } : {}),
                });
            }
            case "integer":
                {
                    const typeSize = object.typeSize;
                    const default_value = to_default(object.default);

                    return described(object, {
                        _t: "scalar",
                        cell: "enum" in object ? enum_cell(object.enum) : number_cell(object),
                        ...(typeSize === undefined ? {} : { typeSize }),
                        ...(default_value === undefined ? {} : { default: default_value }),
                    });
                }
            case "boolean": {
                return described(object, { _t: "flag" });
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
        return described(object, { _t: "flag" });
    }

    if (typeof object === 'object' && Array.isArray(object.oneOf)) {
        const enum_list = fixed_size_enum_list(object);
        if (enum_list !== undefined) { return enum_list; }
    }

    if (
        typeof object === 'object' &&
        "const" in object &&
        object.const !== undefined
    ) {
        const option = to_option(object.const);
        if (option !== undefined && !Array.isArray(option)) {
            return described(object, { _t: "scalar", cell: enum_cell([option]), default: option });
        }
    }

    if (
        typeof object === 'object' &&
        "type" in object &&
        object.type === "object"
    ) {
        return described(object, {
            _t: "node",
            properties: translate_JSONSchema(object).properties
        });
    }

    return described(object, { _t: "unknown" });
}

function get_enum_type(options: unknown): AttachEnumType.STRING | AttachEnumType.NUMBER {

    if (typeof options === 'string') {
        return AttachEnumType.STRING;
    }

    if (typeof options === 'number' || typeof options === 'bigint') {
        return AttachEnumType.NUMBER;
    }

    if (Array.isArray(options)) {
        if (options.every((entry) => typeof entry === 'string')) {
            return AttachEnumType.STRING;
        }

        if (options.every((entry) => typeof entry === 'number' || typeof entry === 'bigint')) {
            return AttachEnumType.NUMBER;
        }
    }

    // IF it's mixed we are are in a bad place anyways
    return AttachEnumType.STRING;
};

function narrow_array_object(object: any): AttachType & { _t: "list" } {

    const list = (item: Cell | Cell[], extra: Partial<List> = {}): AttachType & { _t: "list" } =>
        described(object, { _t: "list", item, ...bounds(object), ...extra });

    const items = object.items;
    const items_array = Array.isArray(items);

    // Ex. simple compatible definition
    if (items_array && items.length === 1 && "enum" in items[0]) {
        return list(enum_cell(items[0].enum));
    }

    // Ex. simple compatible definition with only one value
    if (items_array && items.length === 1 && "const" in items[0]) {
        return list(enum_cell([items[0].const], items[0].const));
    }

    if (items_array && items.length > 1) {

        const cells: Cell[] = [];

        for (const definition of items) {
            if ("enum" in definition) {
                cells.push(enum_cell(definition.enum));
            } else if ("const" in definition) {
                cells.push(enum_cell([definition.const], definition.const));
            } else {
                // FAILSAFE
                return list({ _t: "any" });
            }
        }

        return list(cells);
    }

    if ("items" in object && !items_array && "enum" in items) {
        return list(enum_cell(items.enum));
    }

    if ("items" in object && !items_array && "const" in items) {
        return list(enum_cell([items.const], items.const));
    }

    // object level enum with  $ref: /schemas/types.yaml#/definitions/string
    if ("enum" in object && "items" in object && "type" in items && items.type === "string") {
        return list(enum_cell(object.enum, object.default));
    }

    // Integer array with definition in items
    if ("items" in object && "type" in items && items.type === "integer") {
        return list(number_cell(items, object.default), items.typeSize === undefined ? {} : { typeSize: items.typeSize });
    }

    // Integer array with definition in items but items is an array
    if (items_array && items.length === 1 && "type" in items[0] && items[0].type === "integer") {
        return list(number_cell(items[0], object.default), items[0].typeSize === undefined ? {} : { typeSize: items[0].typeSize });
    }

    // Integer array with constraints outside items
    if (!("items" in object) && ("minimum" in object || "maximum" in object)) {
        return list(number_cell(object, object.default), object.typeSize === undefined ? {} : { typeSize: object.typeSize });
    }

    const unique = object.uniqueItems === true ? { unique: true } : {};

    // String array with type inside items object
    if ("items" in object && !items_array && "type" in items && items.type === "string") {
        return list({ _t: "string" }, unique);
    }

    // String array with type inside items array
    if (items_array && items.length === 1 && "type" in items[0] && items[0].type === "string") {
        return list({ _t: "string" }, unique);
    }

    // A `compatible` with a `pattern` is an array by now; its `oneOf` of fixed lists says more.
    if (Array.isArray(object.oneOf)) {
        const enum_list = fixed_size_enum_list(object);
        if (enum_list?._t === "list" && !Array.isArray(enum_list.item) && enum_list.item._t === "enum" && enum_list.item.enum.length > 0) { return enum_list; }
    }

    // Array of whatever
    return list({ _t: "any" });
}

if (import.meta.vitest) {

    const { test, expect } = import.meta.vitest;

    const translated = (properties: Record<string, unknown>) =>
        Object.fromEntries(translate_JSONSchema({ $id: "id", $schema: "s", title: "t", maintainers: [], properties } as DtBindingSchema).properties.map(({ key, value }) => [key, value]));

    test("a matrix type is a matrix, its rows what the items say", () => {
        const { clocks, reg, interrupts } = translated({
            clocks: { dtType: "phandle-array", minItems: 1, maxItems: 2, items: [{ description: "bus" }, { description: "core" }] },
            reg: { dtType: "address", minItems: 1, maxItems: 1, items: [{ items: [{ description: "base" }, { description: "size" }], type: "array", minItems: 2, maxItems: 2 }] },
            interrupts: { dtType: "uint32-matrix", maxItems: 1 },
        });
        expect(clocks).toStrictEqual({ _t: "matrix", minItems: 1, maxItems: 2, rows: [{ _t: "list", item: { _t: "any" } }] });
        expect(reg).toStrictEqual({ _t: "matrix", minItems: 1, maxItems: 1, rows: [{ _t: "list", item: { _t: "any" }, minItems: 2, maxItems: 2 }] });
        expect(interrupts).toStrictEqual({ _t: "matrix", maxItems: 1, rows: [{ _t: "list", item: { _t: "any" } }] });
    });

    test("one phandle is one row of one cell", () => {
        expect(translated({ "vref-supply": { dtType: "phandle" } })["vref-supply"]).toStrictEqual({
            _t: "matrix", minItems: 1, maxItems: 1, rows: [{ _t: "list", item: { _t: "any" }, minItems: 1, maxItems: 1 }],
        });
    });

    test("a list property keeps the default it gives for its number", () => {
        expect(translated({ "spi-cs-inactive-delay-ns": { type: "array", items: [{ minimum: 16_000, type: "integer" }], default: 16_000, minItems: 1, maxItems: 1 } })["spi-cs-inactive-delay-ns"])
            .toStrictEqual({ _t: "list", item: { _t: "number", minimum: 16_000n, default: 16_000n }, minItems: 1, maxItems: 1 });
    });
}
