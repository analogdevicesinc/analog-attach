import {
    AttachEnumType,
    cell_number,
    INTERRUPT_MACROS,
    GPIO_MACROS,
    is_dt_flag,
    type AttachType,
    type Cell,
    type DTProperty,
    type EnumOption,
    type List,
    type ResolvedProperty,
} from "attach-lib";

import { whole_list_enum } from "./item-count";

type ParsedInputValue = SingleInput | ArrayInput | MatrixInput;
type SingleInput = boolean | bigint | string;
type ArrayInput = (bigint | string)[];
type MatrixInput = ArrayInput[];

function is_matrix_input(value: ParsedInputValue): value is MatrixInput {
    return Array.isArray(value) && value.length > 0 && value.every(row => Array.isArray(row));
}

/** The macros a value may name for a number: `IRQ_TYPE_*` and `GPIO_*`. */
export const ALL_MACROS = [...INTERRUPT_MACROS, ...GPIO_MACROS];

export const HEX_LITERAL = /^0x[\da-f]+$/i;

/** Whether a word can be a number cell: a decimal or hex number, or a known macro. */
export function is_number_token(word: string): boolean {
    return /^-?\d+$/.test(word) || HEX_LITERAL.test(word) || ALL_MACROS.some(m => m.name === word);
}

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

    // The values of a whole-list option are one value, the list (LIST-079).
    const whole = whole_list_enum(list);
    if (whole !== undefined) {
        return outside_options(values, whole.enum, whole.enum_type) === undefined
            ? true
            : `Values for property ${property} are ${describe_options(whole.enum)}`;
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

/** A written value the binding can bound: a number cell or a string; a label, a path or a macro is undefined. */
type Written = bigint | string | undefined;

/**
 * The written values, by position. A number cell (an expression too, `(-20000)` being how a negative is written) is
 * what dtc stores in a cell of its width, read signed when the binding's cell at its position, `signed(index)`,
 * allows a negative (as dt-schema decodes an `int32`), unsigned otherwise.
 */
function written_values(property: DTProperty, signed: (index: number) => boolean): Written[] {
    if (is_dt_flag(property.value)) { return []; }
    const values: Written[] = [];
    for (const value of property.value) {
        switch (value.kind) {
            case "string": { values.push(value.value); break; }
            case "array": {
                for (const element of value.elements) {
                    const number = cell_number(element);
                    const width = Number(value.bit_width);
                    values.push(number === undefined
                        ? undefined
                        : (signed(values.length) ? BigInt.asIntN(width, number) : BigInt.asUintN(width, number)));
                }
                break;
            }
            default: { values.push(undefined); }
        }
    }
    return values;
}

/** Whether a cell allows a negative number: its minimum, or an option of its enum. */
function allows_negative(cell: Cell | undefined): boolean {
    if (cell?._t === "number") { return cell.minimum !== undefined && cell.minimum < 0n; }
    if (cell?._t !== "enum" || cell.enum_type !== AttachEnumType.NUMBER) { return false; }
    return cell.enum.flat().some(option => typeof option === "bigint" && option < 0n);
}

function has_phandle(item: Cell | Cell[]): boolean {
    return (Array.isArray(item) ? item : [item]).some(cell => cell._t === "enum" && cell.enum_type === AttachEnumType.PHANDLE);
}

/**
 * The cell each written value is held to, by position: a scalar's, a list's (one for all, or one per position), the
 * one row of a matrix. None for a list whose entries name a phandle, since each has as many cells as its provider.
 */
function cell_at(type: AttachType, index: number): Cell | undefined {
    switch (type._t) {
        case "scalar": { return index === 0 ? type.cell : undefined; }
        case "list": {
            if (has_phandle(type.item)) { return undefined; }
            return Array.isArray(type.item) ? type.item[index] : type.item;
        }
        case "matrix": {
            const [row, ...others] = type.rows;
            if (row === undefined || others.length > 0 || has_phandle(row.item)) { return undefined; }
            return Array.isArray(row.item) ? row.item[index % row.item.length] : row.item;
        }
        default: { return undefined; }
    }
}

/** What `cell` takes when `value` is outside it (`0 to 15`, `one of 0, 1, 3`), else undefined. Macros aren't checked. */
function outside(value: bigint | string, cell: Cell): string | undefined {
    if (cell._t === "number" && typeof value === "bigint") {
        const { minimum, maximum } = cell;
        if ((minimum === undefined || value >= minimum) && (maximum === undefined || value <= maximum)) { return undefined; }
        if (minimum === undefined) { return `at most ${maximum}`; }
        return maximum === undefined ? `at least ${minimum}` : `${minimum} to ${maximum}`;
    }
    if (cell._t !== "enum") { return undefined; }
    const numbers = cell.enum_type === AttachEnumType.NUMBER && typeof value === "bigint";
    const strings = cell.enum_type === AttachEnumType.STRING && typeof value === "string";
    if (!numbers && !strings) { return undefined; }
    const listed = cell.enum.some(option => (typeof option === "bigint" || typeof option === "number") && typeof value === "bigint"
        ? BigInt(option) === value
        : option === value);
    return listed ? undefined : `one of ${cell.enum.map(String).join(", ")}`;
}

/**
 * What the whole-list `options` take when the written `values`, as one list, are none of them (`one of 0 20000 |
 * 0 24000`), and how the values read; undefined when they are one, or can't be checked (a label among them, or
 * values of another kind than the enum's). An option that is one value is a list of one.
 */
function outside_options(values: Written[], options: EnumOption[], enum_type: AttachEnumType): { takes: string; got: string } | undefined {
    const numbers = enum_type === AttachEnumType.NUMBER && values.every(value => typeof value === "bigint");
    const strings = enum_type === AttachEnumType.STRING && values.every(value => typeof value === "string");
    if (!numbers && !strings) { return undefined; }
    const lists = options.map(option => Array.isArray(option) ? option : [option]);
    const same = (list: (bigint | string)[]): boolean => list.length === values.length
        && list.every((entry, index) => (numbers ? BigInt(entry) === values[index] : entry === values[index]));
    if (lists.some(list => same(list))) { return undefined; }
    // Each list as update takes it, its entries joined by a space; a string can hold commas, so options are set apart by `|`.
    const show = (list: Written[]): string => list.map(String).join(" ");
    return { takes: `one of ${lists.map(list => show(list)).join(" | ")}`, got: show(values) };
}

/**
 * The warning for the first written value outside what the binding allows (a number above its maximum, a value
 * that is no option of its enum), undefined when every value fits or the binding doesn't bound it (UPDATE-041).
 * The values of a whole-list option are checked together, as one value.
 */
export function value_warning(property: string, type: AttachType, written: DTProperty): string | undefined {
    const whole = whole_list_enum(type);
    if (whole !== undefined) {
        const outcome = outside_options(written_values(written, () => allows_negative(whole)), whole.enum, whole.enum_type);
        return outcome === undefined ? undefined : `warning: ${property} takes ${outcome.takes}, got ${outcome.got}`;
    }
    for (const [index, value] of written_values(written, index => allows_negative(cell_at(type, index))).entries()) {
        if (value === undefined) { continue; }
        const cell = cell_at(type, index);
        const takes = cell === undefined ? undefined : outside(value, cell);
        if (takes !== undefined) { return `warning: ${property} takes ${takes}, got ${String(value)}`; }
    }
    return undefined;
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

    test("a whole-list option is checked as the whole list, of numbers or of strings", () => {
        const range: ResolvedProperty = {
            key: "adi,range-microamp",
            value: { _t: "list", item: { _t: "enum", enum: [[0n, 20_000n], [-20_000n, 20_000n]], enum_type: AttachEnumType.NUMBER }, minItems: 1, maxItems: 1 },
        };
        expect(check_value([0n, 20_000n], "adi,range-microamp", range)).toBe(true);
        expect(check_value([-20_000n, 20_000n], "adi,range-microamp", range)).toBe(true);
        expect(check_value([1n, 2n], "adi,range-microamp", range)).toBe("Values for property adi,range-microamp are [[0,20000],[-20000,20000]]");
        expect(check_value(0n, "adi,range-microamp", range)).toBe("Values for property adi,range-microamp are [[0,20000],[-20000,20000]]");
        const compatible: ResolvedProperty = {
            key: "compatible",
            value: { _t: "list", item: { _t: "enum", enum: [["raspberrypi,4-model-b", "brcm,bcm2711"], "brcm,bcm2711"], enum_type: AttachEnumType.STRING }, minItems: 1, maxItems: 1 },
        };
        expect(check_value(["raspberrypi,4-model-b", "brcm,bcm2711"], "compatible", compatible)).toBe(true);
        expect(check_value("brcm,bcm2711", "compatible", compatible)).toBe(true);
        expect(check_value(["brcm,bcm2711", "raspberrypi,4-model-b"], "compatible", compatible))
            .toBe(`Values for property compatible are [["raspberrypi,4-model-b","brcm,bcm2711"],"brcm,bcm2711"]`);
    });

    const written = async (source: string): Promise<DTProperty> => {
        const { DeviceTree } = await import("attach-lib");
        const tree = DeviceTree.new_from_string(`/dts-v1/;\n/ { ${source} };`);
        if (typeof tree === "string") { throw new TypeError(tree); }
        const found = tree.node_at("/")?.properties[0];
        if (found === undefined) { throw new TypeError(source); }
        return found;
    };

    test("value_warning — a number outside its bounds, a value outside its enum; the first one", async () => {
        const channel_reg: AttachType = { _t: "matrix", minItems: 1, maxItems: 1, rows: [{ _t: "list", item: { _t: "number", minimum: 0n, maximum: 15n }, minItems: 1, maxItems: 1 }] };
        expect(value_warning("reg", channel_reg, await written("reg = <20>;"))).toBe("warning: reg takes 0 to 15, got 20");
        expect(value_warning("reg", channel_reg, await written("reg = <15>;"))).toBeUndefined();
        const reference: AttachType = { _t: "scalar", cell: { _t: "enum", enum: [0n, 1n, 3n], enum_type: AttachEnumType.NUMBER } };
        expect(value_warning("adi,reference-select", reference, await written("adi,reference-select = <2>;")))
            .toBe("warning: adi,reference-select takes one of 0, 1, 3, got 2");
        const status: AttachType = { _t: "list", item: { _t: "enum", enum: ["okay", "disabled"], enum_type: AttachEnumType.STRING }, minItems: 1, maxItems: 1 };
        expect(value_warning("status", status, await written(`status = "okay";`))).toBeUndefined();
        expect(value_warning("status", status, await written(`status = "bogus";`))).toBe("warning: status takes one of okay, disabled, got bogus");
        const pair: AttachType = { _t: "list", item: [{ _t: "number", maximum: 7n }, { _t: "number", minimum: 2n }] };
        expect(value_warning("pair", pair, await written("pair = <9 0>;"))).toBe("warning: pair takes at most 7, got 9");
        expect(value_warning("pair", pair, await written("pair = <1 0>;"))).toBe("warning: pair takes at least 2, got 0");
    });

    test("value_warning — labels, macros and phandle lists aren't checked", async () => {
        const gpios: AttachType = { _t: "list", item: { _t: "enum", enum: ["gpio"], enum_type: AttachEnumType.PHANDLE } };
        expect(value_warning("rdy-gpios", gpios, await written("rdy-gpios = <&gpio 99 1>;"))).toBeUndefined();
        const flags: AttachType = { _t: "scalar", cell: { _t: "enum", enum: ["GPIO_ACTIVE_HIGH"], enum_type: AttachEnumType.MACRO } };
        expect(value_warning("flags", flags, await written("flags = <5>;"))).toBeUndefined();
        const numbers: AttachType = { _t: "list", item: { _t: "number", maximum: 3n } };
        expect(value_warning("n", numbers, await written("n = <&n>;"))).toBeUndefined();
    });

    test("value_warning — an expression is checked by its value, in its cell's width, signed when the cell allows a negative", async () => {
        const offset: AttachType = { _t: "scalar", cell: { _t: "number", minimum: -5n, maximum: 5n } };
        expect(value_warning("offset", offset, await written("offset = <(-5)>;"))).toBeUndefined();
        expect(value_warning("offset", offset, await written("offset = <(-6)>;"))).toBe("warning: offset takes -5 to 5, got -6");
        // dtc stores -1 as 0xffffffff, which an unsigned cell reads as such.
        const channel: AttachType = { _t: "scalar", cell: { _t: "number", minimum: 0n, maximum: 15n } };
        expect(value_warning("reg", channel, await written("reg = <(-1)>;"))).toBe("warning: reg takes 0 to 15, got 4294967295");
        expect(value_warning("reg", channel, await written("reg = <(4<<2)>;"))).toBe("warning: reg takes 0 to 15, got 16");
        expect(value_warning("reg", channel, await written("reg = <(4<<1)>;"))).toBeUndefined();
        expect(value_warning("reg", channel, await written("reg = <(FOO+1)>;"))).toBeUndefined();
        const word: AttachType = { _t: "scalar", cell: { _t: "number", minimum: 0n, maximum: 4_294_967_295n } };
        expect(value_warning("word", word, await written("word = <(-1)>;"))).toBeUndefined();
        const wide: AttachType = { _t: "scalar", cell: { _t: "number", minimum: -1n, maximum: 1n } };
        expect(value_warning("wide", wide, await written("wide = /bits/ 64 <(-1)>;"))).toBeUndefined();
        const range: AttachType = { _t: "list", item: { _t: "enum", enum: [[0n, 20_000n], [-20_000n, 20_000n]], enum_type: AttachEnumType.NUMBER }, minItems: 1, maxItems: 1 };
        expect(value_warning("adi,range-microamp", range, await written("adi,range-microamp = <(-20000) 20000>;"))).toBeUndefined();
        expect(value_warning("adi,range-microamp", range, await written("adi,range-microamp = <(-1) 2>;")))
            .toBe("warning: adi,range-microamp takes one of 0 20000 | -20000 20000, got -1 2");
        const mode: AttachType = { _t: "scalar", cell: { _t: "enum", enum: [-1n, 1n], enum_type: AttachEnumType.NUMBER } };
        expect(value_warning("mode", mode, await written("mode = <(-1)>;"))).toBeUndefined();
        expect(value_warning("mode", mode, await written("mode = <(-2)>;"))).toBe("warning: mode takes one of -1, 1, got -2");
    });

    test("value_warning — a whole-list option is the whole written list, of numbers or of strings", async () => {
        const range: AttachType = { _t: "list", item: { _t: "enum", enum: [[0n, 20_000n], [4n, 24_000n]], enum_type: AttachEnumType.NUMBER }, minItems: 1, maxItems: 1 };
        expect(value_warning("adi,range-microamp", range, await written("adi,range-microamp = <0 20000>;"))).toBeUndefined();
        expect(value_warning("adi,range-microamp", range, await written("adi,range-microamp = <0x4 24000>;"))).toBeUndefined();
        expect(value_warning("adi,range-microamp", range, await written("adi,range-microamp = <1 2>;")))
            .toBe("warning: adi,range-microamp takes one of 0 20000 | 4 24000, got 1 2");
        expect(value_warning("adi,range-microamp", range, await written("adi,range-microamp = <0>;")))
            .toBe("warning: adi,range-microamp takes one of 0 20000 | 4 24000, got 0");
        expect(value_warning("adi,range-microamp", range, await written("adi,range-microamp = <0 20000 3>;")))
            .toBe("warning: adi,range-microamp takes one of 0 20000 | 4 24000, got 0 20000 3");
        expect(value_warning("adi,range-microamp", range, await written("adi,range-microamp = <&n 20000>;"))).toBeUndefined();
        const compatible: AttachType = {
            _t: "list",
            item: { _t: "enum", enum: [["raspberrypi,400", "brcm,bcm2711"], ["raspberrypi,4-model-b", "brcm,bcm2711"], "brcm,bcm2711"], enum_type: AttachEnumType.STRING },
            minItems: 1,
            maxItems: 1,
        };
        expect(value_warning("compatible", compatible, await written(`compatible = "raspberrypi,4-model-b", "brcm,bcm2711";`))).toBeUndefined();
        expect(value_warning("compatible", compatible, await written(`compatible = "brcm,bcm2711";`))).toBeUndefined();
        expect(value_warning("compatible", compatible, await written(`compatible = "brcm,bcm2711", "raspberrypi,400";`)))
            .toBe(`warning: compatible takes one of raspberrypi,400 brcm,bcm2711 | raspberrypi,4-model-b brcm,bcm2711 | brcm,bcm2711, got brcm,bcm2711 raspberrypi,400`);
    });
}
