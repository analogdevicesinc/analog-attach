import { ParsedBinding, ResolvedProperty, PatternPropertyRule, PropertyPatternRule } from "./ParsedBinding";
import { DtBindingSchema } from "./Schema";
import { AttachType, AttachEnumType, Cell, EnumOption, List } from "./StructuralTypes";
import { find_entry_in_object } from "./ObjectUtilities";
import { is_node_pattern } from "./PatternKind.js";
import { cell_range, is_matrix_type } from "./PropertyTypes.js";
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

/**
 * The properties a node schema declares itself, followed by the ones its `allOf` entries bring, each name once. The
 * redefinitions are merged into the node's own (`RedefinitionMerger.ts`); what is left twice is what the fixups add to
 * every schema alike (`interrupt-parent` next to `interrupts`).
 */
function translate_node_schema(schema: DtBindingSchema | undefined): ResolvedProperty[] {
    const properties = [...collect_properties(schema?.properties), ...translate_JSONSchema_allOf(schema?.allOf)];
    return properties.filter((property, index) => properties.findIndex(other => other.key === property.key) === index);
}

function collect_properties(properties: Record<string, unknown> | undefined): ResolvedProperty[] {
    const collected: ResolvedProperty[] = [];

    for (const [name, value] of Object.entries(properties ?? {})) {
        // Shouldn't be of concern to users
        if (name === "$nodename" || name === "label") {
            continue;
        }

        // `name: false` forbids the property: it isn't one to offer (as with a `false` pattern).
        if (value === false) {
            continue;
        }

        collected.push({ key: name, value: narrow_object(value, name) });
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
            // Over a copy: the loop moves the properties it finds within `ordered`.
            const before = [...ordered];
            for (const property of before) {
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

/**
 * The single default a cell can carry; a list-valued default (`[]`, `["gpio"]`) is reduced to its only entry, a
 * matrix's (`[[4096000]]`) to its only cell.
 */
function to_default(value: unknown): bigint | string | undefined {
    if (Array.isArray(value)) { return value.length === 1 ? to_default(value[0]) : undefined; }
    return typeof value === "string" ? value : to_bigint(value);
}

/** An enum cell, with the default when it is one of the options (a branch can narrow the enum past it). */
function enum_cell(options: unknown, default_value?: unknown): Cell {
    const entries = to_options(options);
    const fallback = to_default(default_value);
    const default_option = entries.includes(fallback as EnumOption) ? fallback : undefined;
    return {
        _t: "enum",
        enum: entries,
        enum_type: get_enum_type(entries),
        ...(default_option === undefined ? {} : { default: default_option }),
    };
}

/** The numbers a cell of `typeSize` bits can take, signed when its minimum is below zero (`int64`). */
function size_range(schema: any): { minimum: bigint, maximum: bigint } | undefined {
    if (![8, 16, 32, 64].includes(schema.typeSize)) { return undefined; }
    const signed = (to_bigint(schema.minimum) ?? 0n) < 0n;
    return cell_range(`${signed ? "" : "u"}int${String(schema.typeSize)}`);
}

/** A schema number a double can't hold exactly, past 2^53. */
const rounded = (bound: unknown): boolean => typeof bound === "number" && !Number.isSafeInteger(bound);

/**
 * A number cell. A bound a double can't hold exactly is held to the range of its type (`range`, else its
 * `typeSize`'s): a YAML number is one, and `uint64`'s `maximum: 0xffffffffffffffff` reads as 2^64, `int64`'s
 * 2^63 - 1 as 2^63. Other bounds are the binding's, past its type or not (ad8460's `-microamp` from -1000000).
 */
function number_cell(schema: any, default_value?: unknown, range = size_range(schema)): Cell {
    let minimum = to_bigint(schema.minimum);
    let maximum = to_bigint(schema.maximum);
    if (range !== undefined && rounded(schema.minimum) && minimum !== undefined && minimum < range.minimum) { minimum = range.minimum; }
    if (range !== undefined && rounded(schema.maximum) && maximum !== undefined && maximum > range.maximum) { maximum = range.maximum; }
    const default_number = to_bigint(default_value);
    return {
        _t: "number",
        ...(minimum === undefined ? {} : { minimum }),
        ...(maximum === undefined ? {} : { maximum }),
        ...(default_number === undefined ? {} : { default: default_number }),
    };
}

/** A schema of a number: an integer, or bounded (`mark_integers` types them, a unit property's cells come after it). */
function is_number_schema(schema: any): boolean {
    return typeof schema === "object" && schema !== null && !("enum" in schema || "const" in schema) &&
        (schema.type === "integer" || "minimum" in schema || "maximum" in schema);
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

/** The most options of a `compatible` we list; a larger product is left to what `dtType` says. */
const MAX_ENUM_OPTIONS = 512;

/** A bound of `schema` (`minItems` / `maxItems`), or `fallback` when it gives none. */
const bound_of = (schema: any, keyword: "minItems" | "maxItems", fallback: number): number =>
    typeof schema[keyword] === "number" ? schema[keyword] : fallback;

/**
 * A `oneOf` of lists whose entries are each an `enum` / `const` (the values a `compatible` can take, the fallback
 * lists among them; `clock-names: [clkin1, s_axi_aclk]` or `[clkin1, clkin2, s_axi_aclk]`) is one list of one such
 * value, each option a whole list. Each list a branch admits is an option, from its `minItems` up to all of its
 * entries, that the property's own bounds allow too: `interconnect-names: {maxItems: 2}` beside `[mdp0-mem, mdp1-mem,
 * cpu-cfg]` with `minItems: 2` is `[mdp0-mem, mdp1-mem]`. Not for a `compatible` (`whole_lists`), whose shorter lists
 * drop the fallbacks it is written with: only the whole list of a branch is one, as the option is what to suggest.
 * An `enum` position gives one option per value (the first position varies slowest). Undefined when a position is
 * neither an `enum` nor a `const` (a `pattern`), when no list fits, or when there are more than `MAX_ENUM_OPTIONS`
 * options: a partial list would mislead the suggestions.
 */
function fixed_size_enum_list(object: any, whole_lists: boolean): AttachType | undefined {
    const oneOf: any[] = object.oneOf;

    // The values each position of each branch can take, and the lengths of the lists it admits, longest first
    const branches: { positions: unknown[][], lengths: number[] }[] = [];

    for (const value of oneOf) {
        if (!("items" in value)) { return undefined; }
        if (value.type !== "array") { return undefined; }
        if (!Array.isArray(value.items)) { return undefined; }

        const positions: unknown[][] = [];
        for (const element of value.items) {
            if (typeof element !== "object" || element === null) {
                return undefined;
            } else if ("const" in element) {
                positions.push([element.const]);
            } else if (Array.isArray(element.enum)) {
                positions.push(element.enum);
            } else {
                return undefined;
            }
        }

        const lengths: number[] = [];
        if (whole_lists) {
            lengths.push(positions.length);
        } else {
            const shortest = Math.max(bound_of(value, "minItems", positions.length), bound_of(object, "minItems", 1));
            const longest = Math.min(positions.length, bound_of(value, "maxItems", positions.length), bound_of(object, "maxItems", positions.length));
            for (let length = longest; length >= shortest; length--) { lengths.push(length); }
        }
        branches.push({ positions, lengths });
    }

    const options = new Map<string, unknown>();

    for (const { positions, lengths } of branches) {
        for (const length of lengths) {
            // Count before expanding, a few positions of a dozen values are already a large product
            let count = 1;
            for (const values of positions.slice(0, length)) { count *= values.length; }
            if (count > MAX_ENUM_OPTIONS) { return undefined; }

            let lists: unknown[][] = [[]];
            for (const values of positions.slice(0, length)) {
                lists = lists.flatMap(prefix => values.map(entry => [...prefix, entry]));
            }

            for (const list of lists) {
                // One entry is one string, not a list of one
                const option = list.length === 1 ? list[0] : list;
                options.set(JSON.stringify(option), option);
            }
            if (options.size > MAX_ENUM_OPTIONS) { return undefined; }
        }
    }

    if (options.size === 0) { return undefined; }

    return described(object, {
        _t: "list" as const,
        item: enum_cell([...options.values()]),
        minItems: 1,
        maxItems: 1,
    });
}

/**
 * A property of a matrix type (`reg`, `interrupts`, `clocks`: `<1 2>, <3 4>`): its rows are what its `items` describe
 * (`items` itself, or its first entry when it is a list), each row a list of cells.
 */
/**
 * The positions of a matrix row, one that only has the range of the matrix's type (`uint32-matrix`'s, which the `items`
 * merge gives a position the binding only describes) left `any`: a row holds phandles and macros too (`msi-map`'s
 * `<rid-base &msi msi-base length>`, `fsl,pins`). The positions the binding bounds (`maximum: 19`) are numbers. A row
 * of one kind of cell is left as it is.
 */
function row_cells(row: List, type: string): List {
    const range = cell_range(type);
    const only_typed = (cell: Cell): boolean =>
        cell._t === "number" && range !== undefined && cell.minimum === range.minimum && cell.maximum === range.maximum && cell.default === undefined;
    const any: Cell = { _t: "any" };

    if (!Array.isArray(row.item)) {
        return row;
    }

    const cells = row.item.map(cell => only_typed(cell) ? any : cell);
    if (cells.every(cell => cell._t === "any")) {
        const { typeSize: _type_size, ...untyped } = row;
        return { ...untyped, item: any };
    }
    return { ...row, item: cells };
}

function narrow_matrix(object: any, type: string): AttachType {
    const items = Array.isArray(object.items) ? object.items[0] : object.items;
    // The description of the first row says nothing of the others, nor does the row's type (see `row_cells`)
    const { description: _description, [DT_TYPE]: _row_type, ...row_schema } = typeof items === "object" && items !== null ? items : {} as Record<string, unknown>;
    // The default of a matrix of one cell (`-microvolt`'s `default: 4096000`) is that cell's
    const one_cell = object.maxItems === 1 && row_schema.maxItems === 1 && "default" in object;
    const row = narrow_array_object({ ...row_schema, type: "array", ...(one_cell ? { default: object.default } : {}) });

    return described(object, {
        _t: "matrix",
        // one phandle is one row of one cell
        ...bounds(type === "phandle" ? { minItems: 1, maxItems: 1, ...object } : object),
        rows: [{
            ...row_cells(row, type),
            ...(type === "phandle" ? { minItems: 1, maxItems: 1, ...bounds(row_schema) } : {}),
        }],
    });
}

/** The values of a `oneOf` whose branches are all open lists of an `enum` (`items: {enum}`), undefined for any other. */
function open_enum_union(object: any): unknown[] | undefined {
    if (!Array.isArray(object.oneOf) || object.oneOf.length === 0) { return undefined; }

    const union = new Set<unknown>();
    for (const branch of object.oneOf) {
        if (branch.type !== "array" || typeof branch.items !== "object" || branch.items === null || !Array.isArray(branch.items.enum)) {
            return undefined;
        }
        for (const value of branch.items.enum) { union.add(value); }
    }
    return [...union];
}

const STRING_TYPES = new Set(["string", "string-array", "non-unique-string-array"]);

/** `uint32-array`, `int8-array`: the size of its numbers, undefined for any other type. */
function integer_array_size(dt_type: unknown): number | undefined {
    if (typeof dt_type !== "string") { return undefined; }
    const found = /^u?int(8|16|32|64)-array$/.exec(dt_type);
    return found === null ? undefined : Number(found[1]);
}

/** The values of `branches` when each is a `const` or an `enum` (`oneOf: [{description, const: dbi}, …]`). */
function const_union(branches: unknown): unknown[] | undefined {
    if (!Array.isArray(branches) || branches.length === 0) { return undefined; }

    const union: unknown[] = [];
    for (const branch of branches) {
        if (typeof branch !== "object" || branch === null) { return undefined; }
        if ("const" in branch) { union.push(branch.const); }
        else if (Array.isArray(branch.enum)) { union.push(...branch.enum); }
        else { return undefined; }
    }
    return [...new Set(union)];
}

/** A number of the range of `dt_type` (`uint32-array`'s 0..0xFFFFFFFF), narrowed by what `schema` bounds it to. */
function typed_number_cell(schema: any, dt_type: string, default_value?: unknown): Cell {
    const range = cell_range(dt_type);
    return number_cell(range === undefined ? schema : { minimum: range.minimum, maximum: range.maximum, ...schema }, default_value, range ?? size_range(schema));
}

/**
 * The cell of one position of an `items` list: what it allows (an `enum`, a `const`, a number schema), else what the
 * property's `dtType` says it holds (a string of a `pattern`, a number of a `{description}`). Undefined when neither.
 */
function position_cell(definition: any, dt_type: unknown): Cell | undefined {
    if (typeof definition !== "object" || definition === null) { return undefined; }
    if ("enum" in definition) { return enum_cell(definition.enum); }
    if ("const" in definition) { return enum_cell([definition.const], definition.const); }

    if (typeof dt_type === "string" && integer_array_size(dt_type) !== undefined) {
        return typed_number_cell(definition, dt_type);
    }
    if (is_number_schema(definition)) { return number_cell(definition); }
    if (typeof dt_type === "string" && STRING_TYPES.has(dt_type)) { return { _t: "string" }; }

    return undefined;
}

/**
 * A property dt-schema types as strings (`dtType`, tagged by the `dt_type` fixup) whose schema says nothing we can
 * read is still a list of strings: the validator input must keep a lone `compatible = "x"` an array, or an `if` of
 * `contains` never matches. Branches that are all open `enum` lists give the union of the enums as its options; any
 * other the strings alone.
 */
function narrow_string_array(object: any): AttachType | undefined {
    if (typeof object !== "object" || object === null) { return undefined; }

    const dt_type = object[DT_TYPE];

    if (dt_type === "string") {
        return described(object, { _t: "list" as const, item: { _t: "string" as const }, ...bounds(object), maxItems: 1 });
    }

    if (dt_type !== "string-array" && dt_type !== "non-unique-string-array") { return undefined; }

    const options = open_enum_union(object);
    return described(object, {
        _t: "list" as const,
        item: options === undefined ? { _t: "string" as const } : enum_cell(options),
        ...bounds(object),
    });
}

/**
 * A property whose schema says nothing but the type dt-schema gives its name (`dtType`, tagged by the `dt_type` fixup:
 * a binding's `adi,loop-filter-inverting: {description}` is a `flag` because another one says so, `#io-channel-cells`
 * a `uint32` as every `#*-cells`) is what the type says: a flag, or a number of the type's range, or of its `enum`. A
 * schema with anything else to say (`oneOf`, `items`) is left to the readers of those.
 */
function narrow_dt_scalar(object: any): AttachType | undefined {
    if (typeof object !== "object" || object === null) { return undefined; }

    const dt_type = object[DT_TYPE];
    if (typeof dt_type !== "string") { return undefined; }

    if (dt_type === "flag") {
        return described(object, { _t: "flag" as const });
    }

    const found = /^u?int(8|16|32|64)$/.exec(dt_type);
    const range = cell_range(dt_type);
    // A `oneOf` of values `oneof_to_enum` leaves alone (one of them `deprecated`) is an enum all the same
    const options = const_union(object.oneOf);
    const says_more = ["anyOf", "allOf", "const", "items", "type", ...(options === undefined ? ["oneOf"] : [])];
    if (found === null || range === undefined || says_more.some(key => key in object)) {
        return undefined;
    }

    let cell: Cell = { _t: "number" as const, minimum: range.minimum, maximum: range.maximum };
    if ("enum" in object) { cell = enum_cell(object.enum); }
    else if (options !== undefined) { cell = enum_cell(options); }

    return described(object, {
        _t: "scalar" as const,
        cell,
        typeSize: Number(found[1]),
    });
}

/**
 * A property whose schema says nothing but its integer array type (`dtType: uint32-array`, `protected-clocks`) and
 * maybe its count: a list of numbers of the type's range.
 */
function narrow_dt_array(object: any): AttachType | undefined {
    if (typeof object !== "object" || object === null) { return undefined; }

    const dt_type = object[DT_TYPE];
    const size = integer_array_size(dt_type);
    if (size === undefined || ["oneOf", "anyOf", "allOf", "const", "enum", "items"].some(key => key in object)) {
        return undefined;
    }

    return described(object, { _t: "list" as const, item: typed_number_cell({}, dt_type), ...bounds(object), typeSize: size });
}

// TODO: handle objects
/** `name`: the property's, when the schema is one's (a `compatible` reads its `oneOf` of lists apart). */
function narrow_object(object: any, name?: string): AttachType {

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

                    return narrow_array_object(object, name);
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
                    // A const next to the $ref (`$ref: uint32` + `const: 28`) is the one value, so also the default.
                    const constant = "const" in object ? to_option(object.const) : undefined;
                    const single = constant === undefined || Array.isArray(constant) ? undefined : constant;
                    const default_value = single ?? to_default(object.default);

                    let cell: Cell = number_cell(object);
                    if ("enum" in object) { cell = enum_cell(object.enum); }
                    else if (single !== undefined) { cell = enum_cell([single]); }

                    return described(object, {
                        _t: "scalar",
                        cell,
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
        const enum_list = fixed_size_enum_list(object, name === "compatible");
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

    // dt-schema's `_extract_prop_type`: a `type: object`, or one of these keys (a `$ref` to a node schema without
    // `type`, once dereferenced, has them), makes the property a node
    if (
        typeof object === 'object' &&
        object !== null &&
        (("type" in object && object.type === "object") ||
            ["properties", "patternProperties", "additionalProperties"].some((key) => key in object))
    ) {
        return described(object, {
            _t: "node",
            properties: translate_JSONSchema(object).properties
        });
    }

    return narrow_string_array(object) ?? narrow_dt_scalar(object) ?? narrow_dt_array(object) ?? described(object, { _t: "unknown" });
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

function narrow_array_object(object: any, name?: string): AttachType & { _t: "list" } {

    const list = (item: Cell | Cell[], extra: Partial<List> = {}): AttachType & { _t: "list" } =>
        described(object, { _t: "list", item, ...bounds(object), ...extra });

    const items = object.items;
    const items_array = Array.isArray(items);

    // Ex. simple compatible definition
    if (items_array && items.length === 1 && "enum" in items[0]) {
        return list(enum_cell(items[0].enum, object.default));
    }

    // Ex. simple compatible definition with only one value
    if (items_array && items.length === 1 && "const" in items[0]) {
        return list(enum_cell([items[0].const], items[0].const));
    }

    if (items_array && items.length > 1) {

        const cells: Cell[] = [];

        for (const definition of items) {
            const cell = position_cell(definition, object[DT_TYPE]);
            if (cell === undefined) {
                // FAILSAFE
                return list({ _t: "any" });
            }
            cells.push(cell);
        }

        const size = integer_array_size(object[DT_TYPE]);
        return list(cells, size === undefined ? {} : { typeSize: size });
    }

    if ("items" in object && !items_array && "enum" in items) {
        return list(enum_cell(items.enum, object.default));
    }

    if ("items" in object && !items_array && "const" in items) {
        return list(enum_cell([items.const], items.const));
    }

    // object level enum with  $ref: /schemas/types.yaml#/definitions/string
    if ("enum" in object && "items" in object && "type" in items && items.type === "string") {
        return list(enum_cell(object.enum, object.default));
    }

    // Integer array with definition in items
    if ("items" in object && is_number_schema(items)) {
        return list(number_cell(items, object.default), items.typeSize === undefined ? {} : { typeSize: items.typeSize });
    }

    // Integer array with definition in items but items is an array
    if (items_array && items.length === 1 && is_number_schema(items[0])) {
        return list(number_cell(items[0], object.default), items[0].typeSize === undefined ? {} : { typeSize: items[0].typeSize });
    }

    // Integer array with constraints outside items
    if (!("items" in object) && ("minimum" in object || "maximum" in object)) {
        return list(number_cell(object, object.default), object.typeSize === undefined ? {} : { typeSize: object.typeSize });
    }

    const unique = object.uniqueItems === true ? { unique: true } : {};

    // A `oneOf` of fixed lists of values says more than the string `items` of the type beside it: a `compatible` with a
    // `pattern`, `clock-names: {$ref: string-array, oneOf: [{items: [a, b]}, {items: [a, c, b]}]}`
    if (Array.isArray(object.oneOf)) {
        const enum_list = fixed_size_enum_list(object, name === "compatible");
        if (enum_list?._t === "list" && !Array.isArray(enum_list.item) && enum_list.item._t === "enum" && enum_list.item.enum.length > 0) { return enum_list; }
    }

    // String array with type inside items object
    if ("items" in object && !items_array && "type" in items && items.type === "string") {
        return list({ _t: "string" }, unique);
    }

    // String array with type inside items array
    if (items_array && items.length === 1 && "type" in items[0] && items[0].type === "string") {
        return list({ _t: "string" }, unique);
    }

    // What the `dtType` says the entries are, when the schema says nothing we read of them (`items: {pattern}`,
    // `contains`, a bare `$ref: uint32-array` with a count). An `items` `oneOf` of values gives the options.
    const dt_type = object[DT_TYPE];
    if (typeof dt_type === "string" && STRING_TYPES.has(dt_type)) {
        const options = items_array ? undefined : const_union(items?.oneOf);
        return list(options === undefined ? { _t: "string" } : enum_cell(options), unique);
    }
    const size = integer_array_size(dt_type);
    if (size !== undefined) {
        const item_schema = !items_array && typeof items === "object" && items !== null ? items : {};
        return list(typed_number_cell(item_schema, dt_type, object.default), { typeSize: size });
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

    test("a 64-bit cell's bounds are its type's, not the double YAML reads them as", () => {
        // types.yaml's `uint64` and `int64`, dereferenced: 0xffffffffffffffff reads as 2^64, 2^63 - 1 as 2^63
        const uint64 = { type: "integer", typeSize: 64, minimum: 0, maximum: 2 ** 64 };
        const int64 = { type: "integer", typeSize: 64, minimum: -(2 ** 63), maximum: 2 ** 63 };
        const { sizes, offsets, "stacked-memories": stacked } = translated({
            sizes: { dtType: "uint64-array", type: "array", minItems: 1, items: uint64 },
            offsets: { dtType: "int64-array", type: "array", minItems: 1, items: int64 },
            "stacked-memories": { dtType: "uint64-matrix", type: "array", minItems: 1, maxItems: 1, items: [{ type: "array", minItems: 2, maxItems: 4, items: uint64 }] },
        });
        expect(sizes).toStrictEqual({ _t: "list", item: { _t: "number", minimum: 0n, maximum: 0xFF_FF_FF_FF_FF_FF_FF_FFn }, minItems: 1, typeSize: 64 });
        expect(offsets).toStrictEqual({ _t: "list", item: { _t: "number", minimum: -(2n ** 63n), maximum: 2n ** 63n - 1n }, minItems: 1, typeSize: 64 });
        expect(stacked).toStrictEqual({ _t: "matrix", minItems: 1, maxItems: 1, rows: [
            { _t: "list", item: { _t: "number", minimum: 0n, maximum: 0xFF_FF_FF_FF_FF_FF_FF_FFn }, minItems: 2, maxItems: 4, typeSize: 64 },
        ] });
    });

    test("a list property keeps the default it gives for its number", () => {
        expect(translated({ "spi-cs-inactive-delay-ns": { type: "array", items: [{ minimum: 16_000, type: "integer" }], default: 16_000, minItems: 1, maxItems: 1 } })["spi-cs-inactive-delay-ns"])
            .toStrictEqual({ _t: "list", item: { _t: "number", minimum: 16_000n, default: 16_000n }, minItems: 1, maxItems: 1 });
    });

    // A one-value string property, after string_to_array (ad7173's `adi,reference-select`)
    const enum_of = (items: unknown, default_value: unknown) =>
        ({ type: "array", dtType: "string", minItems: 1, maxItems: 1, items, default: default_value });
    // A one-cell `-microvolt` property, after unit_suffix (ad7949's `adi,internal-ref-microvolt`), and its cell
    const microvolt = (default_value: unknown, cells = 1) => ({
        dtType: "int32-matrix", type: "array", minItems: 1, maxItems: 1, default: default_value,
        items: [{ type: "array", minItems: 1, maxItems: cells, items: [{ enum: [2_500_000, 4_096_000] }] }],
    });
    const microvolt_cell = (default_value?: bigint) => ({ _t: "enum", enum: [2_500_000n, 4_096_000n], enum_type: "number", ...(default_value === undefined ? {} : { default: default_value }) });

    test("a string enum keeps its default, which string_to_array leaves beside the items it moves the enum to", () => {
        const { listed, single, narrowed } = translated({
            listed: enum_of([{ enum: ["vref", "refout-avss"] }], "refout-avss"),
            single: enum_of({ enum: ["vref", "refout-avss"] }, "refout-avss"),
            // a branch that narrows the enum past the default (ad7172-4 has no refout-avss)
            narrowed: enum_of([{ enum: ["vref", "avdd"] }], "refout-avss"),
        });
        const cell = { _t: "enum", enum: ["vref", "refout-avss"], enum_type: "string", default: "refout-avss" };
        expect(listed).toStrictEqual({ _t: "list", item: cell, minItems: 1, maxItems: 1 });
        expect(single).toStrictEqual({ _t: "list", item: cell, minItems: 1, maxItems: 1 });
        expect(narrowed).toStrictEqual({ _t: "list", item: { _t: "enum", enum: ["vref", "avdd"], enum_type: "string" }, minItems: 1, maxItems: 1 });
    });

    test("a matrix of one cell gives that cell the default, which unit_suffix leaves beside the rows", () => {
        const { bare, rows, wide } = translated({ bare: microvolt(4_096_000), rows: microvolt([[4_096_000]]), wide: microvolt(4_096_000, 2) });
        expect(bare).toStrictEqual({ _t: "matrix", minItems: 1, maxItems: 1, rows: [{ _t: "list", item: microvolt_cell(4_096_000n), minItems: 1, maxItems: 1 }] });
        expect(rows).toStrictEqual(bare);
        // a row of several cells has no one cell the default is
        expect(wide).toStrictEqual({ _t: "matrix", minItems: 1, maxItems: 1, rows: [{ _t: "list", item: microvolt_cell(), minItems: 1, maxItems: 2 }] });
    });

    const compatible_options = (schema: Record<string, unknown>) => {
        const type = translated({ compatible: schema }).compatible;
        if (type._t !== "list" || Array.isArray(type.item) || type.item._t !== "enum") { throw new Error(`not a list of enum: ${JSON.stringify(type, (_, v) => typeof v === "bigint" ? Number(v) : v)}`); }
        return { options: type.item.enum, minItems: type.minItems, maxItems: type.maxItems };
    };

    const not_enumerated = (schema: Record<string, unknown>) => {
        const type = translated({ compatible: schema }).compatible;
        return !(type._t === "list" && !Array.isArray(type.item) && type.item._t === "enum");
    };

    test("a compatible oneOf of lists is a list of whole-value options, shorter lists included", () => {
        expect(compatible_options({
            oneOf: [
                { type: "array", items: [{ const: "arm,psci" }], minItems: 1, maxItems: 1 },
                { type: "array", items: [{ const: "arm,psci-0.2" }, { const: "arm,psci" }], minItems: 1, maxItems: 2 },
                { type: "array", items: [{ const: "arm,psci-1.0" }, { const: "arm,psci-0.2" }, { const: "arm,psci" }], minItems: 1, maxItems: 3 },
            ],
        })).toStrictEqual({
            options: ["arm,psci", ["arm,psci-0.2", "arm,psci"], ["arm,psci-1.0", "arm,psci-0.2", "arm,psci"]],
            minItems: 1,
            maxItems: 1,
        });
    });

    test("a oneOf of one-const lists gives plain strings, without duplicates", () => {
        expect(compatible_options({
            oneOf: [
                { type: "array", items: [{ const: "snps,dwc-ahci" }], minItems: 1, maxItems: 1 },
                { type: "array", items: [{ const: "snps,spear-ahci" }], minItems: 1, maxItems: 1 },
                { type: "array", items: [{ const: "snps,dwc-ahci" }], minItems: 1, maxItems: 1 },
            ],
        }).options).toStrictEqual(["snps,dwc-ahci", "snps,spear-ahci"]);
    });

    test("an enum position of a compatible branch is expanded, the first position varying slowest", () => {
        expect(compatible_options({
            oneOf: [
                { type: "array", items: [{ enum: ["a", "b"] }, { const: "c" }], minItems: 2, maxItems: 2 },
                { type: "array", items: [{ const: "d" }], minItems: 1, maxItems: 1 },
            ],
        }).options).toStrictEqual([["a", "c"], ["b", "c"], "d"]);

        expect(compatible_options({
            oneOf: [{ type: "array", items: [{ enum: ["a", "b"] }, { enum: ["x", "y", "z"] }], minItems: 2, maxItems: 2 }],
        }).options).toStrictEqual([["a", "x"], ["a", "y"], ["a", "z"], ["b", "x"], ["b", "y"], ["b", "z"]]);
    });

    test("a compatible that can't be enumerated is not a list of enum", () => {
        const many = Array.from({ length: 33 }, (_, index) => `v${index}`);
        const fitting = { type: "array", items: [{ enum: many.slice(0, 32) }, { enum: many.slice(0, 16) }], minItems: 2, maxItems: 2 };

        // 32 x 16 = 512 options fit, 33 x 16 do not
        expect(not_enumerated({ oneOf: [fitting] })).toBe(false);
        expect(not_enumerated({ oneOf: [{ type: "array", items: [{ enum: many }, { enum: many.slice(0, 16) }], minItems: 2, maxItems: 2 }] })).toBe(true);
        // the options of several branches add up
        expect(not_enumerated({ oneOf: [fitting, { type: "array", items: [{ const: "other" }], minItems: 1, maxItems: 1 }] })).toBe(true);
        // a position that is a pattern can't be listed
        expect(not_enumerated({ oneOf: [{ type: "array", items: [{ pattern: "^qcom,adreno-[0-9a-f]+$" }, { const: "qcom,adreno" }], minItems: 2, maxItems: 2 }] })).toBe(true);
    });

    test("a string-array property that is no list we know is a list of strings, whatever its branches", () => {
        // gmu: a pattern position can't be listed
        expect(translated({
            compatible: {
                dtType: "string-array",
                oneOf: [
                    { type: "array", items: [{ pattern: String.raw`^qcom,adreno-gmu-[67][0-9][0-9]\.[0-9]$` }, { const: "qcom,adreno-gmu" }], minItems: 2, maxItems: 2 },
                    { type: "array", items: [{ const: "qcom,adreno-gmu-wrapper" }], minItems: 1, maxItems: 1 },
                ],
            },
        }).compatible).toStrictEqual({ _t: "list", item: { _t: "string" } });

        expect(translated({ model: { dtType: "string", oneOf: [{ pattern: "^a" }, { pattern: "^b" }] } }).model)
            .toStrictEqual({ _t: "list", item: { _t: "string" }, maxItems: 1 });

        // a type that isn't a string says nothing
        expect(translated({ foo: { dtType: "uint32", oneOf: [{ pattern: "^a" }, { pattern: "^b" }] } }).foo).toStrictEqual({ _t: "unknown" });
    });

    test("a property with only the type of its name is a flag, or a number of that type", () => {
        const { flag, cells, small, signed } = translated({
            flag: { dtType: "flag", description: "d" },
            cells: { dtType: "uint32", description: "d" },
            small: { dtType: "uint8" },
            signed: { dtType: "int16" },
        });
        expect(flag).toStrictEqual({ _t: "flag", description: "d" });
        expect(cells).toStrictEqual({ _t: "scalar", cell: { _t: "number", minimum: 0n, maximum: 0xFF_FF_FF_FFn }, typeSize: 32, description: "d" });
        expect(small).toStrictEqual({ _t: "scalar", cell: { _t: "number", minimum: 0n, maximum: 255n }, typeSize: 8 });
        expect(signed).toStrictEqual({ _t: "scalar", cell: { _t: "number", minimum: -32_768n, maximum: 32_767n }, typeSize: 16 });
        expect(translated({ cells: { dtType: "uint32", enum: [0, 1] } }).cells).toMatchObject({ _t: "scalar", cell: { _t: "enum", enum_type: "number" }, typeSize: 32 });
        // a const next to the $ref (`$ref: uint32` + `const: 28`) is a one-option enum, the const its default
        expect(translated({ cells: { type: "integer", typeSize: 32, minimum: 0, maximum: 0xFF_FF_FF_FF, const: 28, dtType: "uint32" } }).cells)
            .toStrictEqual({ _t: "scalar", cell: { _t: "enum", enum: [28n], enum_type: "number" }, typeSize: 32, default: 28n });
        // a `oneOf` of values `oneof_to_enum` leaves (one is deprecated) is an enum
        expect(translated({ cells: { dtType: "uint32", oneOf: [{ const: 2 }, { const: 1, deprecated: true }] } }).cells)
            .toStrictEqual({ _t: "scalar", cell: { _t: "enum", enum: [2n, 1n], enum_type: "number" }, typeSize: 32 });
        // numbers a schema says more of are not scalars
        expect(translated({ foo: { dtType: "uint32", items: { minimum: 1 } } }).foo).toStrictEqual({ _t: "unknown" });
    });

    test("an integer array its schema says nothing more of is a list of numbers of its type, an items list one cell each", () => {
        const { protected_clocks, rates, mask, range } = translated({
            protected_clocks: { dtType: "uint32-array" },
            rates: { dtType: "uint32-array", type: "array", minItems: 1, maxItems: 4 },
            mask: { dtType: "uint32-array", type: "array", items: [{ minimum: 0, maximum: 0xFF_00, type: "integer" }, { const: 0 }, { description: "pin" }] },
            range: { dtType: "uint8-array", type: "array", items: [{ maximum: 100 }, { minimum: 1 }] },
        });
        const uint32 = { _t: "number", minimum: 0n, maximum: 0xFF_FF_FF_FFn };

        expect(protected_clocks).toStrictEqual({ _t: "list", item: uint32, typeSize: 32 });
        expect(rates).toStrictEqual({ _t: "list", item: uint32, minItems: 1, maxItems: 4, typeSize: 32 });
        expect(mask).toStrictEqual({
            _t: "list",
            item: [{ _t: "number", minimum: 0n, maximum: 0xFF_00n }, { _t: "enum", enum: [0n], enum_type: "number", default: 0n }, uint32],
            typeSize: 32,
        });
        expect(range).toStrictEqual({ _t: "list", item: [{ _t: "number", minimum: 0n, maximum: 100n }, { _t: "number", minimum: 1n, maximum: 255n }], typeSize: 8 });
    });

    const matrix_of = (items: unknown[]) => ({ dtType: "uint32-matrix", type: "array", items: [{ dtType: "uint32-array", type: "array", items }] });

    test("a matrix row is typed by what its schema bounds, not by its type: msi-map's rows hold a phandle", () => {
        const uint32 = { type: "integer", typeSize: 32, minimum: 0, maximum: 0xFF_FF_FF_FF, dtType: "uint32" };
        const { msi_map, channels } = translated({
            // the `items` merge gives each position the `uint32` it references
            msi_map: matrix_of(["rid-base", "msi-controller", "msi-base", "length"].map(description => ({ description, ...uint32 }))),
            channels: matrix_of([{ ...uint32, maximum: 19 }, { ...uint32, maximum: 19 }]),
        });

        expect(msi_map).toMatchObject({ _t: "matrix", rows: [{ _t: "list", item: { _t: "any" } }] });
        expect(channels).toMatchObject({ _t: "matrix", rows: [{ _t: "list", item: [{ _t: "number", maximum: 19n }, { _t: "number", maximum: 19n }] }] });
    });

    test("a string list whose items translate reads nothing of is a list of strings, an items oneOf of values its options", () => {
        const { names, described_names, compatible, positions } = translated({
            names: { dtType: "string-array", type: "array", items: { pattern: "^(rx|tx)[0-9]$" } },
            described_names: { dtType: "string-array", type: "array", items: { oneOf: [{ description: "DBI", const: "dbi" }, { description: "other", enum: ["mstr", "slv"] }] } },
            compatible: { dtType: "string-array", type: "array", contains: { const: "syscon" } },
            positions: { dtType: "string-array", type: "array", items: [{ pattern: "^jedec,lpddr4-" }, { const: "jedec,lpddr4" }] },
        });

        expect(names).toStrictEqual({ _t: "list", item: { _t: "string" } });
        expect(described_names).toStrictEqual({ _t: "list", item: { _t: "enum", enum: ["dbi", "mstr", "slv"], enum_type: "string" } });
        expect(compatible).toStrictEqual({ _t: "list", item: { _t: "string" } });
        expect(positions).toStrictEqual({ _t: "list", item: [{ _t: "string" }, { _t: "enum", enum: ["jedec,lpddr4"], enum_type: "string", default: "jedec,lpddr4" }] });
    });

    test("a oneOf of fixed lists of names beside the type's string items gives the lists as options", () => {
        // adi,axi-clkgen.yaml's `clock-names`, as the fixups leave it
        const { "clock-names": names } = translated({
            "clock-names": {
                dtType: "string-array", type: "array", items: { type: "string" }, minItems: 2, maxItems: 3,
                oneOf: [
                    { type: "array", items: [{ const: "clkin1" }, { const: "s_axi_aclk" }], minItems: 2, maxItems: 2 },
                    { type: "array", items: [{ const: "clkin1" }, { const: "clkin2" }, { const: "s_axi_aclk" }], minItems: 3, maxItems: 3 },
                ],
            },
        });
        expect(names).toStrictEqual({
            _t: "list",
            item: { _t: "enum", enum: [["clkin1", "s_axi_aclk"], ["clkin1", "clkin2", "s_axi_aclk"]], enum_type: "string" },
            minItems: 1,
            maxItems: 1,
        });
    });

    test("each list a branch of names admits is an option, as far as the property's own bounds allow", () => {
        // qcom,sdm670-mdss.yaml's `interconnect-names`, as the fixups leave it
        const { "interconnect-names": names } = translated({
            "interconnect-names": {
                dtType: "string-array", type: "array", items: { type: "string" }, minItems: 2, maxItems: 2,
                oneOf: [
                    { type: "array", items: [{ const: "mdp0-mem" }, { const: "cpu-cfg" }], minItems: 2, maxItems: 2 },
                    { type: "array", items: [{ const: "mdp0-mem" }, { const: "mdp1-mem" }, { const: "cpu-cfg" }], minItems: 2, maxItems: 3 },
                ],
            },
        });
        expect(names).toStrictEqual({
            _t: "list",
            item: { _t: "enum", enum: [["mdp0-mem", "cpu-cfg"], ["mdp0-mem", "mdp1-mem"]], enum_type: "string" },
            minItems: 1,
            maxItems: 1,
        });

        // a list of one name is the name, and a branch no list of which fits gives none
        const { "reset-names": one } = translated({
            "reset-names": {
                dtType: "string-array", type: "array", items: { type: "string" }, minItems: 1, maxItems: 2,
                oneOf: [
                    { type: "array", items: [{ const: "core" }, { const: "ahb" }], minItems: 1, maxItems: 2 },
                    { type: "array", items: [{ const: "a" }, { const: "b" }, { const: "c" }], minItems: 3, maxItems: 3 },
                ],
            },
        });
        expect(one).toStrictEqual({
            _t: "list",
            item: { _t: "enum", enum: [["core", "ahb"], "core"], enum_type: "string" },
            minItems: 1,
            maxItems: 1,
        });
    });

    test("a oneOf of open lists of an enum is a list of the union of the enums", () => {
        expect(compatible_options({
            dtType: "string-array",
            oneOf: [
                { description: "new", items: { enum: ["a,new-v2", "a,new"] }, type: "array" },
                { description: "old", deprecated: true, items: { enum: ["a,old", "a,new"] }, type: "array" },
            ],
        })).toStrictEqual({ options: ["a,new-v2", "a,new", "a,old"], minItems: undefined, maxItems: undefined });
    });
}
