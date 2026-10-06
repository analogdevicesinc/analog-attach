import {
    AttachEnumType,
    PropertyBuilder,
    INTERRUPT_MACROS,
    GPIO_MACROS,
    to_attach_array,
    type AttachArray,
    type CellValue,
    type DTNode,
    type DTProperty,
    type ResolvedProperty,
} from "attach-lib";

type ParsedInputValue = SingleInput | ArrayInput | MatrixInput;
type SingleInput = boolean | bigint | string;
type ArrayInput = (bigint | string)[];
type MatrixInput = ArrayInput[];

function is_matrix_input(value: ParsedInputValue): value is MatrixInput {
    return Array.isArray(value) && value.length > 0 && value.every(row => Array.isArray(row));
}

const ALL_MACROS = [...INTERRUPT_MACROS, ...GPIO_MACROS];

function to_cell_value(entry: bigint | string, enum_type: AttachEnumType): CellValue {
    if (typeof entry === "bigint") {
        return PropertyBuilder.tag_number(entry);
    }

    switch (enum_type) {
        case AttachEnumType.PHANDLE: {
            return PropertyBuilder.tag_label(entry);
        }
        case AttachEnumType.MACRO: {
            const resolved = ALL_MACROS.find(m => m.name === entry);
            if (resolved !== undefined) {
                return PropertyBuilder.tag_number(BigInt(resolved.value));
            }
            return PropertyBuilder.tag_expression(entry);
        }
        default: {
            throw new Error(`Unexpected enum_type for string value: ${enum_type}`);
        }
    }
}

function macro_enum_values(enum_names: unknown[]): Set<bigint> {
    const values = new Set<bigint>();
    for (const name of enum_names) {
        const resolved = ALL_MACROS.find(m => m.name === name);
        if (resolved !== undefined) { values.add(BigInt(resolved.value)); }
    }
    return values;
}

function enum_accepts(element: bigint | string, enum_values: unknown[], macro_values: Set<bigint> | undefined): boolean {
    if (enum_values.includes(element)) { return true; }
    return typeof element === "bigint" && macro_values !== undefined && macro_values.has(element);
}

function is_phandle_array_hole(row: ArrayInput, definition: AttachArray): boolean {
    if (row.length !== 1 || row[0] !== 0n) { return false; }
    if (definition._t === "fixed_index") {
        const first = definition.prefixItems[0];
        return first !== undefined && first._t !== "number" && first.enum_type === AttachEnumType.PHANDLE;
    }
    if (definition._t === "enum_array") {
        return definition.enum_type === AttachEnumType.PHANDLE;
    }
    return false;
}

const MATRIX_STRING_ROW_ERROR = (property: string) =>
    `Property ${property} matrix rows must be numeric or reference values, not strings`;

function build_row_cells(values: ArrayInput, definition: AttachArray, property: string): CellValue[] | string {
    switch (definition._t) {
        case "array": {
            return values.map(element =>
                typeof element === "bigint" ? PropertyBuilder.tag_number(element) : PropertyBuilder.tag_expression(element)
            );
        }
        case "number_array": {
            if (!values.every((element): element is bigint => typeof element === "bigint")) {
                return `Property ${property} in binding demands numbers`;
            }
            return values.map(element => PropertyBuilder.tag_number(element));
        }
        case "string_array": {
            return MATRIX_STRING_ROW_ERROR(property);
        }
        case "enum_array": {
            const macro_values = definition.enum_type === AttachEnumType.MACRO
                ? macro_enum_values(definition.enum) : undefined;
            if (!values.every(element => enum_accepts(element, definition.enum, macro_values))) {
                return `Values for property ${property} are ${JSON.stringify(definition.enum)}`;
            }
            if (definition.minItems > values.length || definition.maxItems < values.length) {
                return `Property ${property} accepts between ${definition.minItems} and ${definition.maxItems} items from ${JSON.stringify(definition.enum)}`;
            }
            if (definition.enum_type === AttachEnumType.STRING) {
                return MATRIX_STRING_ROW_ERROR(property);
            }
            if (values.some(element => typeof element === "bigint")
                && definition.enum_type !== AttachEnumType.NUMBER
                && definition.enum_type !== AttachEnumType.MACRO) {
                return `Values for property ${property} are ${JSON.stringify(definition.enum)}`;
            }
            return values.map(element => to_cell_value(element, definition.enum_type));
        }
        case "fixed_index": {
            if (definition.minItems > values.length || definition.maxItems < values.length) {
                return `Property ${property} accepts between ${definition.minItems} and ${definition.maxItems} items`;
            }

            const cell_values: CellValue[] = [];

            for (let index = 0; index < definition.prefixItems.length && index < values.length; index++) {
                const v = values[index]!;
                const item_definition = definition.prefixItems[index]!;

                if (typeof v === "bigint") {
                    if (item_definition._t === "number") {
                        cell_values.push(PropertyBuilder.tag_number(v));
                    } else if (item_definition.enum_type === AttachEnumType.MACRO) {
                        if (!macro_enum_values(item_definition.enum).has(v)) {
                            return `Property ${property} at index ${index} accepts a macro from ${JSON.stringify(item_definition.enum)} or its numeric value`;
                        }
                        cell_values.push(PropertyBuilder.tag_number(v));
                    } else {
                        return `Property ${property} doesn't require a number at index ${index}`;
                    }
                } else {
                    if (item_definition._t === "number") {
                        return `Property ${property} requires a number at index ${index}`;
                    }
                    if (!item_definition.enum.includes(v)) {
                        return `Property ${property} at index ${index} require a value from ${JSON.stringify(item_definition.enum)}`;
                    }
                    if (item_definition.enum_type === AttachEnumType.STRING) {
                        return MATRIX_STRING_ROW_ERROR(property);
                    }
                    cell_values.push(to_cell_value(v, item_definition.enum_type));
                }
            }

            return cell_values;
        }
        default: {
            const _x: never = definition;
            throw new Error("Exhaustive check failed!");
        }
    }
}

function set_property(
    parsed_value: ParsedInputValue,
    found_node: DTNode,
    property: string,
    definition: ResolvedProperty
): string | true {
    switch (definition.value._t) {
        case "boolean": {
            if (typeof parsed_value !== 'boolean') {
                return `Property ${property} is a flag and can be set to appear with 'true' or disappear with 'false'`;
            }

            const existing = found_node.properties.find(p => p.name === property);

            if (existing !== undefined && parsed_value === false) {
                found_node.properties = found_node.properties.filter(p => p !== existing);
            } else if (existing === undefined && parsed_value === true) {
                found_node.properties.push(
                    PropertyBuilder.build_flag()
                        .set_flag()
                        .with_name(property)
                        .build()
                );
            }
            return true;
        }
        case "integer":
        case "enum_integer":
        case "const": {
            if (Array.isArray(parsed_value)) {
                return `Definition in binding for property '${property}' requires a singular value`;
            }
            if (typeof parsed_value === 'boolean') {
                return `Property '${property}' isn't a flag => can't have boolean values`;
            }
            if (typeof parsed_value === 'string') {
                return `Property ${property} in binding demands numbers`;
            }
            if (definition.value._t === 'enum_integer' && !definition.value.enum.includes(parsed_value)) {
                return `Values for property ${property} are: ${JSON.stringify(definition.value.enum)}`;
            }
            if (definition.value._t === 'const' && BigInt(definition.value.const) !== parsed_value) {
                return `Value for property ${property} is: ${JSON.stringify(definition.value.const)}`;
            }

            const scratch_property = PropertyBuilder.build_cell_array()
                .with_tagged_values(PropertyBuilder.tag_number(parsed_value))
                .with_name(property)
                .build();
            const existing = found_node.properties.find(p => p.name === property);
            if (existing === undefined) { found_node.properties.push(scratch_property); }
            else { existing.value = structuredClone(scratch_property.value); }

            return true;
        }
        case "array":
        case "number_array":
        case "string_array":
        case "enum_array":
        case "fixed_index": {
            if (typeof parsed_value === 'boolean') {
                return `Property '${property}' isn't a flag => can't have boolean values`;
            }
            if (is_matrix_input(parsed_value)) {
                return `Property ${property} does not accept comma-separated rows`;
            }

            const array_definition = to_attach_array(definition);

            if (array_definition === undefined) { throw new Error("Failed cast"); }

            return set_array_property(
                Array.isArray(parsed_value) ? parsed_value : [parsed_value],
                found_node,
                property,
                array_definition
            );
        }
        case "matrix": {
            if (typeof parsed_value === 'boolean') {
                return `Property '${property}' isn't a flag => can't have boolean values`;
            }

            const rows: ArrayInput[] = is_matrix_input(parsed_value)
                ? parsed_value
                : [Array.isArray(parsed_value) ? parsed_value : [parsed_value]];

            if (rows.length < definition.value.minItems || rows.length > definition.value.maxItems) {
                return `Property ${property} accepts between ${definition.value.minItems} and ${definition.value.maxItems} row(s)`;
            }

            const row_definitions = definition.value.values;
            const built_rows: CellValue[][] = [];

            for (const [index, row] of rows.entries()) {
                const row_definition = row_definitions[index] ?? row_definitions[0];
                if (row_definition === undefined) {
                    return `Property ${property} has no row definition in its binding`;
                }

                if (is_phandle_array_hole(row!, row_definition)) {
                    built_rows.push([PropertyBuilder.tag_number(0n)]);
                    continue;
                }

                const cells = build_row_cells(row!, row_definition, property);
                if (typeof cells === "string") { return cells; }
                built_rows.push(cells);
            }

            const matrix_property = PropertyBuilder.build_cell_array()
                .with_tagged_values(...(built_rows as [CellValue[], ...CellValue[][]]))
                .with_name(property)
                .build();
            const existing_matrix = found_node.properties.find(p => p.name === property);
            if (existing_matrix === undefined) { found_node.properties.push(matrix_property); }
            else { existing_matrix.value = structuredClone(matrix_property.value); }

            return true;
        }
        case "object": {
            return `Property '${property}' is defined as an object!`;
        }
        case "generic": {
            return `Property '${property}' couldn't be interpreted!`;
        }
        default: {
            const _x: never = definition.value;
            throw new Error("Exhaustive check failed!");
        }
    }
}

function set_array_property(
    values: ArrayInput,
    found_node: DTNode,
    property: string,
    definition: AttachArray
): string | true {
    const upsert = (property_: DTProperty) => {
        const existing = found_node.properties.find(p => p.name === property);
        if (existing === undefined) { found_node.properties.push(property_); }
        else { existing.value = structuredClone(property_.value); }
    };

    switch (definition._t) {
        case "array": {
            const tagged = values.map(element =>
                typeof element === "bigint" ? PropertyBuilder.tag_number(element) : PropertyBuilder.tag_expression(element)
            );

            upsert(
                PropertyBuilder.build_cell_array()
                    .with_tagged_values(tagged)
                    .with_name(property)
                    .build()
            );

            return true;
        }
        case "number_array": {
            if (!values.every((element): element is bigint => typeof element === "bigint")) {
                return `Property ${property} in binding demands numbers`;
            }

            upsert(
                PropertyBuilder.build_cell_array()
                    .with_tagged_values(
                        values.map(element => PropertyBuilder.tag_number(element))
                    )
                    .with_name(property).build()
            );

            return true;
        }
        case "string_array": {
            if (!values.every((element): element is string => typeof element === "string")) {
                return `Property ${property} in binding demands string`;
            }

            upsert(
                PropertyBuilder.build_string()
                    .with_value(values)
                    .with_name(property)
                    .build()
            );

            return true;
        }
        case "enum_array": {
            const macro_values_set = definition.enum_type === AttachEnumType.MACRO
                ? macro_enum_values(definition.enum) : undefined;
            if (!values.every(element => enum_accepts(element, definition.enum, macro_values_set))) {
                return `Values for property ${property} are ${JSON.stringify(definition.enum)}`;
            }
            if (definition.minItems > values.length || definition.maxItems < values.length) {
                return `Property ${property} accepts between ${definition.minItems} and ${definition.maxItems} items from ${JSON.stringify(definition.enum)}`;
            }
            if (values.some(element => typeof element === "bigint")
                && definition.enum_type !== AttachEnumType.NUMBER
                && definition.enum_type !== AttachEnumType.MACRO) {
                return `Values for property ${property} are ${JSON.stringify(definition.enum)}`;
            }

            if (definition.enum_type === AttachEnumType.STRING &&
                values.every((element): element is string => typeof element === 'string')
            ) {
                upsert(
                    PropertyBuilder.build_string()
                        .with_value(values)
                        .with_name(property)
                        .build()
                );
            } else {
                upsert(
                    PropertyBuilder.build_cell_array()
                        .with_tagged_values(
                            values.map(element => to_cell_value(element, definition.enum_type))
                        )
                        .with_name(property).build());
            }
            return true;
        }
        case "fixed_index": {
            if (definition.minItems > values.length || definition.maxItems < values.length) {
                return `Property ${property} accepts between ${definition.minItems} and ${definition.maxItems} items`;
            }

            const cell_values: CellValue[] = [];
            const string_values: string[] = [];

            for (let index = 0; index < definition.prefixItems.length && index < values.length; index++) {

                const v = values[index]!;
                const item_definition = definition.prefixItems[index]!;

                if (typeof v === "bigint") {
                    if (item_definition._t === "number") {
                        cell_values.push(PropertyBuilder.tag_number(v));
                    } else if (item_definition.enum_type === AttachEnumType.MACRO) {
                        if (!macro_enum_values(item_definition.enum).has(v)) {
                            return `Property ${property} at index ${index} accepts a macro from ${JSON.stringify(item_definition.enum)} or its numeric value`;
                        }
                        cell_values.push(PropertyBuilder.tag_number(v));
                    } else {
                        return `Property ${property} doesn't require a number at index ${index}`;
                    }
                } else {
                    if (item_definition._t === "number") {
                        return `Property ${property} requires a number at index ${index}`;
                    }
                    if (!item_definition.enum.includes(v)) {
                        return `Property ${property} at index ${index} require a value from ${JSON.stringify(item_definition.enum)}`;
                    }

                    if (item_definition.enum_type === AttachEnumType.STRING) {
                        string_values.push(v);
                    } else {
                        cell_values.push(to_cell_value(v, item_definition.enum_type));
                    }
                }
            }

            if (string_values.length > 0 && cell_values.length === 0) {
                upsert(
                    PropertyBuilder.build_string()
                        .with_value(string_values)
                        .with_name(property)
                        .build()
                );
            } else if (cell_values.length > 0 && string_values.length === 0) {
                upsert(
                    PropertyBuilder.build_cell_array()
                        .with_tagged_values(cell_values)
                        .with_name(property)
                        .build()
                );
            }
            return true;
        }
        default: {
            const _x: never = definition;
            throw new Error("Exhaustive check failed!");
        }
    }
}

/**
 * Run the typed `set_property` validation against a scratch node. Returns `true`
 * if the value is accepted by the definition, or an error message explaining
 * what the binding rejects.
 */
export function check_value(parsed: ParsedInputValue, property: string, definition: ResolvedProperty): true | string {
    const scratch: DTNode = { name: "scratch", unit_addr: undefined, labels: [], properties: [], children: [] };
    return set_property(parsed, scratch, property, definition);
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    const phandle_matrix: ResolvedProperty = {
        key: "cs-gpios",
        value: {
            _t: "matrix",
            minItems: 1,
            maxItems: 6,
            values: [{
                _t: "fixed_index",
                minItems: 3,
                maxItems: 3,
                prefixItems: [
                    { _t: "enum", enum: ["gpio"], enum_type: AttachEnumType.PHANDLE, },
                    { _t: "number", },
                    { _t: "enum", enum: ["GPIO_ACTIVE_HIGH", "GPIO_ACTIVE_LOW"], enum_type: AttachEnumType.MACRO, },
                ],
                description: "",
            }],
        },
    };

    const number_matrix: ResolvedProperty = {
        key: "reg",
        value: {
            _t: "matrix",
            minItems: 1,
            maxItems: 4,
            values: [{ _t: "number_array", minItems: 2, maxItems: 2, minimum: 0n, maximum: 6n }],
        },
    };

    test("<0> row passes against a phandle matrix template", () => {
        const parsed: MatrixInput = [["gpio", 8n, 1n], [0n], ["gpio", 18n, 1n]];
        expect(check_value(parsed, "cs-gpios", phandle_matrix)).toBe(true);
    });

    test("<0> row in a non-phandle matrix is not treated as a hole", () => {
        const parsed: MatrixInput = [[1n, 2n], [0n], [5n, 6n]];
        const result = check_value(parsed, "reg", number_matrix);
        expect(result).toBe(true);
    });
}
