import {
    AttachEnumType,
    INTERRUPT_MACROS,
    GPIO_MACROS,
    type Cell,
    type List,
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

const MATRIX_STRING_ROW_ERROR = (property: string) =>
    `Property ${property} matrix rows must be numeric or reference values, not strings`;

function describe_options(options: unknown[]): string {
    return JSON.stringify(options, (_key, value) => typeof value === "bigint" ? Number(value) : value);
}

function macro_values(names: unknown[]): Set<bigint> {
    const values = new Set<bigint>();
    for (const name of names) {
        const resolved = ALL_MACROS.find(m => m.name === name);
        if (resolved !== undefined) { values.add(BigInt(resolved.value)); }
    }
    return values;
}

/** Where a value sits: its property, its position in a tuple, and whether it is in a matrix row. */
type Place = { property: string; index?: number; matrix?: boolean };

function enum_error(cell: Extract<Cell, { _t: "enum" }>, place: Place, element: bigint | string): string {
    const options = describe_options(cell.enum);
    if (place.index === undefined) { return `Values for property ${place.property} are ${options}`; }
    if (typeof element === "bigint" && cell.enum_type === AttachEnumType.MACRO) {
        return `Property ${place.property} at index ${place.index} accepts a macro from ${options} or its numeric value`;
    }
    return `Property ${place.property} at index ${place.index} require a value from ${options}`;
}

/** Whether one value (a number, a label, a macro name, a string) is what the cell takes. */
function check_cell(element: bigint | string, cell: Cell, place: Place): true | string {
    switch (cell._t) {
        case "any": {
            return true;
        }
        case "number": {
            if (typeof element === "bigint") { return true; }
            return place.index === undefined
                ? `Property ${place.property} in binding demands numbers`
                : `Property ${place.property} requires a number at index ${place.index}`;
        }
        case "string": {
            if (typeof element !== "string") { return `Property ${place.property} in binding demands string`; }
            return place.matrix === true ? MATRIX_STRING_ROW_ERROR(place.property) : true;
        }
        case "enum": {
            if (typeof element === "bigint") {
                // A binding's numeric enum holds plain numbers, the parsed value a bigint.
                const listed = cell.enum.some(option => (typeof option === "bigint" || typeof option === "number") && BigInt(option) === element);
                const macro = cell.enum_type === AttachEnumType.MACRO && macro_values(cell.enum).has(element);
                return listed || macro ? true : enum_error(cell, place, element);
            }
            if (cell.enum_type === AttachEnumType.NUMBER || !cell.enum.includes(element)) { return enum_error(cell, place, element); }
            return cell.enum_type === AttachEnumType.STRING && place.matrix === true ? MATRIX_STRING_ROW_ERROR(place.property) : true;
        }
    }
}

function is_phandle(cell: Cell | undefined): boolean {
    return cell?._t === "enum" && cell.enum_type === AttachEnumType.PHANDLE;
}

function is_phandle_array_hole(row: ArrayInput, definition: List): boolean {
    if (row.length !== 1 || row[0] !== 0n) { return false; }
    return is_phandle(Array.isArray(definition.item) ? definition.item[0] : definition.item);
}

/** The values of one list (or one matrix row) against its cells. */
function check_list(values: ArrayInput, list: List, property: string, matrix: boolean): true | string {
    const { item, minItems, maxItems } = list;
    const outside = (minItems ?? 0) > values.length || (maxItems !== undefined && maxItems < values.length);
    const bounds = `between ${minItems ?? 0} and ${maxItems ?? "∞"}`;

    if (Array.isArray(item)) {
        if (outside) { return `Property ${property} accepts ${bounds} items`; }
        for (let index = 0; index < item.length && index < values.length; index++) {
            const checked = check_cell(values[index]!, item[index]!, { property, index, matrix });
            if (checked !== true) { return checked; }
        }
        return true;
    }

    for (const element of values) {
        const checked = check_cell(element, item, { property, matrix });
        if (checked !== true) { return checked; }
    }
    // Only a list of enum members is held to its counts here; the others are warned about by item-count.
    if (item._t === "enum" && outside) {
        return `Property ${property} accepts ${bounds} items from ${describe_options(item.enum)}`;
    }
    return true;
}

function check_scalar(parsed: ParsedInputValue, property: string, cell: Cell, default_value: bigint | string | undefined): true | string {
    if (Array.isArray(parsed)) {
        return `Definition in binding for property '${property}' requires a singular value`;
    }
    if (typeof parsed === "boolean") {
        return `Property '${property}' isn't a flag => can't have boolean values`;
    }
    if (typeof parsed === "string" && (cell._t === "number" || (cell._t === "enum" && cell.enum_type === AttachEnumType.NUMBER))) {
        return `Property ${property} in binding demands numbers`;
    }
    const checked = check_cell(parsed, cell, { property });
    if (checked === true || cell._t !== "enum") { return checked; }
    // A scalar whose only option is its default is a const.
    return cell.enum.length === 1 && cell.enum[0] === default_value
        ? `Value for property ${property} is: ${describe_options([default_value]).slice(1, -1)}`
        : `Values for property ${property} are: ${describe_options(cell.enum)}`;
}

function check_matrix(parsed: ParsedInputValue, property: string, rows: List[], min_rows: number | undefined, max_rows: number | undefined): true | string {
    if (typeof parsed === "boolean") {
        return `Property '${property}' isn't a flag => can't have boolean values`;
    }

    const input: ArrayInput[] = is_matrix_input(parsed)
        ? parsed
        : [Array.isArray(parsed) ? parsed : [parsed]];

    if (input.length < (min_rows ?? 0) || (max_rows !== undefined && input.length > max_rows)) {
        return `Property ${property} accepts between ${min_rows ?? 0} and ${max_rows ?? "∞"} row(s)`;
    }

    for (const [index, row] of input.entries()) {
        const definition = rows[index] ?? rows[0];
        if (definition === undefined) {
            return `Property ${property} has no row definition in its binding`;
        }

        if (is_phandle_array_hole(row, definition)) { continue; }

        const checked = check_list(row, definition, property, true);
        if (checked !== true) { return checked; }
    }

    return true;
}

/**
 * Whether the parsed input is accepted by the property's definition: `true`,
 * or a message explaining what the binding rejects.
 */
export function check_value(parsed: ParsedInputValue, property: string, definition: ResolvedProperty): true | string {
    const type = definition.value;
    switch (type._t) {
        case "flag": {
            return typeof parsed === "boolean"
                ? true
                : `Property ${property} is a flag and can be set to appear with 'true' or disappear with 'false'`;
        }
        case "scalar": {
            return check_scalar(parsed, property, type.cell, type.default);
        }
        case "list": {
            if (typeof parsed === "boolean") {
                return `Property '${property}' isn't a flag => can't have boolean values`;
            }
            if (is_matrix_input(parsed)) {
                return `Property ${property} does not accept comma-separated rows`;
            }
            return check_list(Array.isArray(parsed) ? parsed : [parsed], type, property, false);
        }
        case "matrix": {
            return check_matrix(parsed, property, type.rows, type.minItems, type.maxItems);
        }
        case "node": {
            return `Property '${property}' is defined as an object!`;
        }
        case "unknown": {
            return `Property '${property}' couldn't be interpreted!`;
        }
        default: {
            const _x: never = type;
            throw new Error("Exhaustive check failed!");
        }
    }
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    const phandle_matrix: ResolvedProperty = {
        key: "cs-gpios",
        value: {
            _t: "matrix",
            minItems: 1,
            maxItems: 6,
            rows: [{
                _t: "list",
                minItems: 3,
                maxItems: 3,
                item: [
                    { _t: "enum", enum: ["gpio"], enum_type: AttachEnumType.PHANDLE },
                    { _t: "number" },
                    { _t: "enum", enum: ["GPIO_ACTIVE_HIGH", "GPIO_ACTIVE_LOW"], enum_type: AttachEnumType.MACRO },
                ],
            }],
        },
    };

    const number_matrix: ResolvedProperty = {
        key: "reg",
        value: {
            _t: "matrix",
            minItems: 1,
            maxItems: 4,
            rows: [{ _t: "list", item: { _t: "number", minimum: 0n, maximum: 6n }, minItems: 2, maxItems: 2 }],
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

    test("a number enum's numbers accept the parsed bigint", () => {
        const width: ResolvedProperty = {
            key: "spi-rx-bus-width",
            value: { _t: "list", item: { _t: "enum", enum: [0n, 1n, 2n, 4n, 8n], enum_type: AttachEnumType.NUMBER }, minItems: 1, maxItems: 1 },
        };
        expect(check_value([4n], "spi-rx-bus-width", width)).toBe(true);
        expect(check_value([3n], "spi-rx-bus-width", width)).not.toBe(true);
    });

    test("a scalar enum names its options; a const names its one value", () => {
        const mode: ResolvedProperty = { key: "adi,mode", value: { _t: "scalar", cell: { _t: "enum", enum: [1n, 2n], enum_type: AttachEnumType.NUMBER } } };
        expect(check_value(2n, "adi,mode", mode)).toBe(true);
        expect(check_value(3n, "adi,mode", mode)).toBe("Values for property adi,mode are: [1,2]");
        const fixed: ResolvedProperty = { key: "adi,fixed", value: { _t: "scalar", cell: { _t: "enum", enum: [3n], enum_type: AttachEnumType.NUMBER }, default: 3n } };
        expect(check_value(4n, "adi,fixed", fixed)).toBe("Value for property adi,fixed is: 3");
    });
}
