import { ResolvedProperty } from "../Bindings/ParsedBinding.js";
import { AttachEnumType, is_open, list_cell, type Cell, type List } from "../Bindings/StructuralTypes.js";
import { DeviceTree, number_property } from "../Devicetree/index.js";
import {
    is_clock,
    is_dma_controller,
    is_gpio_controller,
    is_interrupt_controller,
    is_pwm_controller,
    is_regulator,
} from "./predicates.js";
import { find_nodes, phandle_name, phandle_names } from "./providers.js";

export type MacroDefinition = { name: string; value: number };

export const INTERRUPT_MACROS: MacroDefinition[] = [
    { name: "IRQ_TYPE_NONE", value: 0 },
    { name: "IRQ_TYPE_EDGE_RISING", value: 1 },
    { name: "IRQ_TYPE_EDGE_FALLING", value: 2 },
    { name: "IRQ_TYPE_EDGE_BOTH", value: 2 | 1 },
    { name: "IRQ_TYPE_LEVEL_HIGH", value: 4 },
    { name: "IRQ_TYPE_LEVEL_LOW", value: 8 },
];

export const GPIO_MACROS: MacroDefinition[] = [
    { name: "GPIO_ACTIVE_HIGH", value: 0 },
    { name: "GPIO_ACTIVE_LOW", value: 1 },
    { name: "GPIO_PUSH_PULL", value: 0 },
    { name: "GPIO_SINGLE_ENDED", value: 2 },
    { name: "GPIO_LINE_OPEN_SOURCE", value: 0 },
    { name: "GPIO_LINE_OPEN_DRAIN", value: 4 },
    { name: "GPIO_OPEN_DRAIN", value: 2 | 4 },
    // eslint-disable-next-line unicorn/prefer-math-trunc
    { name: "GPIO_OPEN_SOURCE", value: 2 | 0 },
    { name: "GPIO_PERSISTENT", value: 0 },
    { name: "GPIO_TRANSITORY", value: 8 },
    { name: "GPIO_PULL_UP", value: 16 },
    { name: "GPIO_PULL_DOWN", value: 32 },
    { name: "GPIO_PULL_DISABLE", value: 64 },
];

export function value_to_macro(value: number, names: string[]): string | undefined {
    if (
        INTERRUPT_MACROS.every((entry) => names.includes(entry.name)) &&
        INTERRUPT_MACROS.length === names.length
    ) {
        return INTERRUPT_MACROS.find((entry) => entry.value === value)?.name;
    }

    if (
        GPIO_MACROS.every((entry) => names.includes(entry.name)) &&
        GPIO_MACROS.length === names.length
    ) {
        return GPIO_MACROS.find((entry) => entry.value === value)?.name;
    }

    return;
}

export function is_gpio_property(key: string): boolean {
    return key === "gpios" || key === "gpio" || /(?<!,nr)-gpios?$/.test(key);
}

function extract_gpio_controller(data: unknown): string | undefined {
    if (typeof data === "string") { return data; }
    if (!Array.isArray(data) || data.length === 0) { return; }
    // ["gpio"] or ["gpio", 21, 1]
    if (typeof data[0] === "string") { return data[0]; }
    // [["gpio", 8, 1], …] — use the first row whose first cell is a string (skips <0> holes).
    if (Array.isArray(data[0])) {
        for (const row of data) {
            if (Array.isArray(row) && row.length > 0 && typeof row[0] === "string") { return row[0]; }
        }
    }
    return;
}

// --- Row builders ---

/** The `minItems` / `maxItems` a list or matrix carries, nothing for the other types. */
function counts_of(value: ResolvedProperty["value"]): { minItems?: number; maxItems?: number } {
    if (value._t !== "list" && value._t !== "matrix") { return {}; }
    return {
        ...(value.minItems === undefined ? {} : { minItems: value.minItems }),
        ...(value.maxItems === undefined ? {} : { maxItems: value.maxItems }),
    };
}

function specifier_row(options: {
    phandle?: { enum: string[]; default?: string };
    numbers: number;
    number_item: Cell;
    trailing_macros?: string[];
    description?: string;
}): List {
    const { phandle, numbers, number_item, trailing_macros, description } = options;
    const cells: Cell[] = [];
    if (phandle !== undefined) {
        cells.push({ _t: "enum", enum: phandle.enum, ...(phandle.default === undefined ? {} : { default: phandle.default }), enum_type: AttachEnumType.PHANDLE });
    }
    for (let index = 0; index < numbers; index++) {
        cells.push(number_item);
    }
    if (trailing_macros !== undefined) {
        cells.push({ _t: "enum", enum: trailing_macros, enum_type: AttachEnumType.MACRO });
    }
    const size = cells.length;
    return { _t: "list", item: cells, minItems: size, maxItems: size, ...(description === undefined ? {} : { description }) };
}

function phandle_enum_array(phandles: string[], description?: string, default_value?: string): ResolvedProperty["value"] {
    return {
        _t: "list",
        item: { _t: "enum", enum: phandles, enum_type: AttachEnumType.PHANDLE, ...(default_value === undefined ? {} : { default: default_value }) },
        minItems: 1,
        maxItems: 1,
        description,
    };
}

function phandle_matrix(phandles: string[], bounds: { minItems?: number; maxItems?: number }, description?: string): ResolvedProperty["value"] {
    return {
        _t: "matrix",
        ...bounds,
        description,
        rows: [{
            _t: "list",
            minItems: 1,
            maxItems: 1,
            item: [{ _t: "enum", enum: phandles, enum_type: AttachEnumType.PHANDLE }],
        }],
    };
}

// --- Refiners ---

function effective_interrupt_controller(
    parsed_data: Record<string, unknown>,
    inherited_interrupt_parent: string | undefined,
): string | undefined {
    const raw = parsed_data["interrupt-parent"];
    if (raw === undefined) { return inherited_interrupt_parent; }
    if (Array.isArray(raw) && raw.length === 1 && typeof raw[0] === "string") { return raw[0]; }
    return raw as string | undefined;
}

function refine_interrupt_parent(
    property: ResolvedProperty,
    devicetree: DeviceTree,
    parsed_data: Record<string, unknown>,
    inherited_interrupt_parent: string | undefined,
): boolean {
    if (property.key !== "interrupt-parent") { return false; }

    const is_set = effective_interrupt_controller(parsed_data, inherited_interrupt_parent);
    const phandles = find_nodes(devicetree, is_interrupt_controller).map(located => phandle_name(located));

    property.value = phandle_enum_array(phandles, property.value.description, is_set);
    return true;
}

function refine_interrupts(
    property: ResolvedProperty,
    devicetree: DeviceTree,
    parsed_data: Record<string, unknown>,
    inherited_interrupt_parent: string | undefined,
): boolean {
    if (property.key !== "interrupts" || !is_open(property.value)) { return false; }

    const is_set = effective_interrupt_controller(parsed_data, inherited_interrupt_parent);
    if (is_set === undefined) { return false; }

    const parent = find_nodes(devicetree, is_interrupt_controller).find(value => phandle_name(value) === is_set);
    if (parent === undefined) { return false; }

    const cell_count = number_property(parent.node, "#interrupt-cells");
    if (cell_count === undefined) { return false; }

    const row = specifier_row({
        numbers: Number(cell_count) - 1,
        number_item: { _t: "number" },
        trailing_macros: cell_count > 1n ? INTERRUPT_MACROS.map(m => m.name) : undefined,
    });
    property.value = {
        _t: "matrix",
        ...counts_of(property.value),
        description: property.value.description,
        rows: [row],
    };
    return true;
}

function refine_clocks(property: ResolvedProperty, devicetree: DeviceTree): boolean {
    if (property.key !== "clocks") { return false; }
    property.value = phandle_matrix(phandle_names(devicetree, is_clock), { minItems: 1, maxItems: 1 }, property.value.description);
    return true;
}

function refine_dmas(
    property: ResolvedProperty,
    devicetree: DeviceTree,
    parsed_data: Record<string, unknown>,
): boolean {
    if (property.key !== "dmas") { return false; }

    let set_dma = parsed_data[property.key];

    if (set_dma === undefined || (Array.isArray(set_dma) && set_dma.length === 0)) {
        if (!is_open(property.value)) { return true; }
        property.value = phandle_matrix(phandle_names(devicetree, is_dma_controller), counts_of(property.value), property.value.description);
        return true;
    }

    if (Array.isArray(set_dma) && set_dma.length > 0) {
        set_dma = set_dma.every((entry: unknown) => Array.isArray(entry)) ? set_dma[0][0] : set_dma[0];
        const dmas = find_nodes(devicetree, is_dma_controller);
        const phandles = dmas.map(located => phandle_name(located));
        const node = dmas.find(value => phandle_name(value) === set_dma);
        if (node === undefined) { return true; }

        const cell_count = number_property(node.node, "#dma-cells");
        if (cell_count !== undefined) {
            const row = specifier_row({
                phandle: { enum: phandles, default: set_dma as string },
                numbers: Number(cell_count),
                number_item: { _t: "number", minimum: 0n, maximum: 0xFF_FF_FF_FFn },
            });
            const own = property.value._t === "list" || property.value._t === "matrix" ? property.value : undefined;
            property.value = {
                _t: "matrix",
                ...(own === undefined ? { minItems: 1, maxItems: 1 } : counts_of(own)),
                description: property.value.description,
                rows: [row],
            };
        }
        return true;
    }

    return false;
}

function refine_pwms(
    property: ResolvedProperty,
    devicetree: DeviceTree,
    parsed_data: Record<string, unknown>,
): boolean {
    if (property.key !== "pwms") { return false; }

    let set_pwm = parsed_data[property.key];

    if (set_pwm === undefined || (Array.isArray(set_pwm) && set_pwm.length === 0)) {
        if (!is_open(property.value)) { return true; }
        property.value = phandle_matrix(phandle_names(devicetree, is_pwm_controller), counts_of(property.value), property.value.description);
        return true;
    }

    if (
        property.value._t === "matrix" &&
        Array.isArray(set_pwm) &&
        set_pwm.length > 0 &&
        set_pwm.every((entry: unknown) => Array.isArray(entry))
    ) {
        set_pwm = set_pwm[0][0];
        const pwms = find_nodes(devicetree, is_pwm_controller);
        const phandles = pwms.map(located => phandle_name(located));
        const node = pwms.find(value => phandle_name(value) === set_pwm);
        if (node === undefined) { return true; }

        const cell_count = number_property(node.node, "#pwm-cells");
        if (cell_count !== undefined) {
            const row = specifier_row({
                phandle: { enum: phandles, default: set_pwm as string },
                numbers: Number(cell_count),
                number_item: { _t: "number" },
            });
            property.value = {
                _t: "matrix",
                ...counts_of(property.value),
                description: property.value.description,
                rows: [row],
            };
        }
        return true;
    }

    return false;
}

function refine_supply(property: ResolvedProperty, devicetree: DeviceTree): boolean {
    if (!property.key.endsWith("-supply")) { return false; }
    property.value = phandle_enum_array(phandle_names(devicetree, is_regulator), property.value.description);
    return true;
}

function refine_gpio(
    property: ResolvedProperty,
    devicetree: DeviceTree,
    parsed_data: Record<string, unknown>,
): boolean {
    if (!is_gpio_property(property.key)) { return false; }

    const set_controller = extract_gpio_controller(parsed_data[property.key]);

    if (set_controller === undefined) {
        property.value = phandle_enum_array(phandle_names(devicetree, is_gpio_controller), property.value.description);
        return true;
    }

    const gpio_controllers = find_nodes(devicetree, is_gpio_controller);
    const phandles = gpio_controllers.map(located => phandle_name(located));
    const controller_node = gpio_controllers.find(value => phandle_name(value) === set_controller);
    if (controller_node === undefined) { return true; }

    const cell_count = number_property(controller_node.node, "#gpio-cells");
    if (cell_count === undefined) { return true; }

    const row = specifier_row({
        phandle: { enum: phandles, default: set_controller },
        numbers: Number(cell_count) - 1,
        number_item: { _t: "number" },
        trailing_macros: cell_count > 1n ? GPIO_MACROS.map(m => m.name) : undefined,
        description: property.value.description,
    });

    const { min_rows, max_rows } = gpio_row_bounds(property.value);

    // eslint-disable-next-line unicorn/prefer-ternary
    if (max_rows !== undefined && max_rows <= 1) {
        property.value = row;
    } else {
        property.value = {
            _t: "matrix",
            minItems: min_rows,
            ...(max_rows === undefined ? {} : { maxItems: max_rows }),
            description: property.value.description,
            rows: [row],
        };
    }

    return true;
}

// --- Main entry ---

export function query_devicetree(
    devicetree: DeviceTree,
    properties: ResolvedProperty[],
    data: string,
    inherited_interrupt_parent?: string,
): ResolvedProperty[] {

    const properties_clone = structuredClone(properties);
    const parsed_data = JSON.parse(data);

    for (const property of properties_clone) {
        if (refine_interrupt_parent(property, devicetree, parsed_data, inherited_interrupt_parent)) { continue; }
        if (refine_interrupts(property, devicetree, parsed_data, inherited_interrupt_parent)) { continue; }
        if (refine_clocks(property, devicetree)) { continue; }
        if (refine_dmas(property, devicetree, parsed_data)) { continue; }
        if (refine_pwms(property, devicetree, parsed_data)) { continue; }
        if (refine_supply(property, devicetree)) { continue; }
        if (refine_gpio(property, devicetree, parsed_data)) { continue; }
    }

    return properties_clone;
}

/**
 * Row bounds of a `*-gpios` property, sized the way dt-schema does
 * (dtschema/fixups.py `_fixup_items_size`, whose `items`-list and typed-array
 * cases `fixup_mark_array_size` already applies upstream): a lone `minItems`
 * or `maxItems` fixes the count to it, and with no sizing at all the property
 * is a bare phandle-array (types.yaml): at least one row, no upper bound.
 */
function gpio_row_bounds(value: ResolvedProperty["value"]): { min_rows: number, max_rows: number | undefined } {
    const { minItems: min, maxItems: max } = counts_of(value);
    if (min === undefined && max === undefined) { return { min_rows: 1, max_rows: undefined }; }
    return { min_rows: min ?? max!, max_rows: max ?? min! };
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    const open_list = (minItems?: number, maxItems?: number): ResolvedProperty["value"] => ({
        _t: "list",
        item: { _t: "any" },
        ...(minItems === undefined ? {} : { minItems }),
        ...(maxItems === undefined ? {} : { maxItems }),
    });

    /** A list with one cell per position (a specifier row), or undefined for any other type. */
    const tuple_of = (value: ResolvedProperty["value"] | undefined) =>
        value?._t === "list" && Array.isArray(value.item) ? { cells: value.item, minItems: value.minItems, maxItems: value.maxItems } : undefined;

    /** The enum cell of a list of single values. */
    const enum_of = (value: ResolvedProperty["value"] | undefined) => {
        const cell = value?._t === "list" ? list_cell(value) : undefined;
        return cell?._t === "enum" ? cell : undefined;
    };

    const dts = (source: string) => {
        const dt = DeviceTree.new_from_string(source);
        if (typeof dt === "string") { throw new TypeError(dt); }
        return dt;
    };

    test("query_devicetree — interrupt-parent: enumerates interrupt controllers", () => {
        const dt = dts(`/dts-v1/;
/ {
    gic: interrupt-controller@ff841000 {
        interrupt-controller;
        #interrupt-cells = <3>;
    };
    spi0: spi@7e204000 {
    };
};`);
        const properties = [
            {
                key: "interrupt-parent",
                value: { _t: "unknown" as const },
            },
        ];
        const result = query_devicetree(dt, properties, "{}");
        const ip = result.find(p => p.key === "interrupt-parent");
        expect(enum_of(ip?.value)?.enum).toContain("gic");
    });

    test("query_devicetree — interrupt-parent: inherited label refines interrupts to matrix", () => {
        const dt = dts(`/dts-v1/;
/ {
    gic: interrupt-controller@ff841000 {
        interrupt-controller;
        #interrupt-cells = <3>;
    };
};`);
        const properties = [
            { key: "interrupt-parent", value: { _t: "unknown" as const } },
            { key: "interrupts", value: open_list(1, 1) },
        ];
        const result = query_devicetree(dt, properties, "{}", "gic");
        const interrupts = result.find(p => p.key === "interrupts");
        expect(interrupts?.value._t).toBe("matrix");
    });

    test("query_devicetree — interrupts reshaped even without interrupt-parent in binding", () => {
        const dt = dts(`/dts-v1/;
/ {
    gic: interrupt-controller@ff841000 {
        interrupt-controller;
        #interrupt-cells = <2>;
    };
};`);
        const properties = [
            { key: "interrupts", value: open_list(1, 4) },
        ];
        const result = query_devicetree(dt, properties, "{}", "gic");
        const interrupts = result.find(p => p.key === "interrupts");
        expect(interrupts?.value._t).toBe("matrix");
        if (interrupts?.value._t === "matrix") {
            expect(interrupts.value.minItems).toBe(1);
            expect(interrupts.value.maxItems).toBe(4);
        }
    });

    test("query_devicetree — #interrupt-cells = <1>: row is [number], no macro", () => {
        const dt = dts(`/dts-v1/;
/ {
    intc: interrupt-controller {
        interrupt-controller;
        #interrupt-cells = <1>;
    };
};`);
        const properties = [
            { key: "interrupt-parent", value: { _t: "unknown" as const } },
            { key: "interrupts", value: open_list(1, 1) },
        ];
        const result = query_devicetree(dt, properties, "{}", "intc");
        const interrupts = result.find(p => p.key === "interrupts");
        expect(interrupts?.value._t).toBe("matrix");
        if (interrupts?.value._t === "matrix") {
            const row = tuple_of(interrupts.value.rows[0]);
            expect(row).toBeDefined();
            expect(row?.cells).toHaveLength(0);
            expect(row?.minItems).toBe(0);
        }
    });

    test("query_devicetree — #gpio-cells = <1>: row is [phandle, number], no macro", () => {
        const dt = dts(`/dts-v1/;
/ {
    gpio: gpio@7e200000 {
        compatible = "brcm,bcm2711-gpio";
        gpio-controller;
        #gpio-cells = <1>;
    };
};`);
        const properties = [{ key: "reset-gpios", value: open_list(1, 1) }];
        const result = query_devicetree(dt, properties, JSON.stringify({ "reset-gpios": ["gpio"] }));
        const reset = tuple_of(result.find(p => p.key === "reset-gpios")?.value);
        expect(reset?.cells).toHaveLength(1);
        expect(reset?.cells[0]?._t).toBe("enum");
    });

    test("query_devicetree — *-gpios: item count is the phandle plus #gpio-cells", () => {
        const dt = dts(`/dts-v1/;
/ {
    gpio: gpio@7e200000 {
        compatible = "brcm,bcm2711-gpio";
        gpio-controller;
        #gpio-cells = <2>;
    };
};`);
        const properties = [{ key: "reset-gpios", value: open_list(1, 1) }];
        const result = query_devicetree(dt, properties, JSON.stringify({ "reset-gpios": ["gpio"] }));
        const reset = tuple_of(result.find(p => p.key === "reset-gpios")?.value);
        expect(reset?.cells).toHaveLength(3);
        expect(reset?.minItems).toBe(3);
        expect(reset?.maxItems).toBe(3);
    });

    test("query_devicetree — clocks: enumerates fixed-clock sources", () => {
        const dt = dts(`/dts-v1/;
/ {
    clk_osc: oscillator {
        compatible = "fixed-clock";
        #clock-cells = <0>;
        clock-frequency = <19200000>;
    };
};`);
        const properties = [{ key: "clocks", value: { _t: "unknown" as const } }];
        const result = query_devicetree(dt, properties, "{}");
        const clocks_property = result.find(p => p.key === "clocks");
        expect(clocks_property?.value._t).toBe("matrix");
    });

    const gpio_dt = dts(`/dts-v1/;
/ {
    gpio: gpio@7e200000 {
        compatible = "brcm,bcm2711-gpio";
        gpio-controller;
        #gpio-cells = <2>;
    };
};`);

    test("query_devicetree — *-gpios: nested data [[\"gpio\", 8, 1], …] is typed as matrix", () => {
        const properties = [{ key: "cs-gpios", value: open_list(1, 6) }];
        const data = JSON.stringify({ "cs-gpios": [["gpio", 8, 1], ["gpio", 7, 1]] });
        const result = query_devicetree(gpio_dt, properties, data);
        const cs = result.find(p => p.key === "cs-gpios");
        expect(cs?.value._t).toBe("matrix");
        if (cs?.value._t === "matrix") {
            expect(cs.value.maxItems).toBe(6);
            expect(cs.value.rows).toHaveLength(1);
            expect(tuple_of(cs.value.rows[0])).toBeDefined();
        }
    });

    test("query_devicetree — *-gpios: maxItems 1 stays a single row", () => {
        const properties = [{ key: "reset-gpios", value: open_list(1, 1) }];
        const data = JSON.stringify({ "reset-gpios": ["gpio"] });
        const result = query_devicetree(gpio_dt, properties, data);
        expect(tuple_of(result.find(p => p.key === "reset-gpios")?.value)).toBeDefined();
    });

    test("query_devicetree — *-gpios: plain string data 'gpio' is typed (not unknown)", () => {
        const properties = [{ key: "reset-gpios", value: open_list(1, 1) }];
        const data = JSON.stringify({ "reset-gpios": "gpio" });
        const result = query_devicetree(gpio_dt, properties, data);
        expect(tuple_of(result.find(p => p.key === "reset-gpios")?.value)?.cells).toHaveLength(3);
    });

    test("query_devicetree — *-gpios: row bounds follow dt-schema's _fixup_items_size", () => {
        const rows = (value: ResolvedProperty["value"]) => {
            const result = query_devicetree(gpio_dt, [{ key: "cs-gpios", value }], JSON.stringify({ "cs-gpios": ["gpio"] }));
            const cs = result.find(p => p.key === "cs-gpios");
            if (tuple_of(cs?.value) !== undefined) { return "single row"; }
            return cs?.value._t === "matrix" ? [cs.value.minItems, cs.value.maxItems] : cs?.value._t;
        };
        // No sizing (e.g. spi-controller.yaml cs-gpios): a bare phandle-array.
        expect(rows({ _t: "unknown" })).toStrictEqual([1, undefined]);
        // A lone minItems or maxItems fixes the count.
        expect(rows(open_list(2))).toStrictEqual([2, 2]);
        expect(rows(open_list(undefined, 3))).toStrictEqual([3, 3]);
        expect(rows(open_list(1, 6))).toStrictEqual([1, 6]);
        expect(rows(open_list(1, 1))).toBe("single row");
    });

    test("is_gpio_property — matches gpios, gpio, *-gpios, *-gpio; rejects vendor,nr-gpios and gpio-controller", () => {
        expect(is_gpio_property("gpios")).toBe(true);
        expect(is_gpio_property("gpio")).toBe(true);
        expect(is_gpio_property("reset-gpio")).toBe(true);
        expect(is_gpio_property("cs-gpios")).toBe(true);
        expect(is_gpio_property("wlf,reset-gpio")).toBe(true);
        expect(is_gpio_property("enable-gpios")).toBe(true);
        expect(is_gpio_property("vendor,nr-gpios")).toBe(false);
        expect(is_gpio_property("gpio-controller")).toBe(false);
    });

    test("query_devicetree — singular reset-gpio with ['gpio'] data is typed as a single row", () => {
        const properties = [{ key: "reset-gpio", value: open_list(1, 1) }];
        const data = JSON.stringify({ "reset-gpio": ["gpio"] });
        const result = query_devicetree(gpio_dt, properties, data);
        expect(tuple_of(result.find(p => p.key === "reset-gpio")?.value)?.cells).toHaveLength(3);
    });

    test("extract_gpio_controller — [[0], ['gpio', 7, 1]] skips the <0> hole", () => {
        const data = [[0], ["gpio", 7, 1]];
        const properties = [{ key: "cs-gpios", value: open_list(1, 4) }];
        const result = query_devicetree(gpio_dt, properties, JSON.stringify({ "cs-gpios": data }));
        const cs = result.find(p => p.key === "cs-gpios");
        expect(cs?.value._t).toBe("matrix");
    });

    test("query_devicetree — pwms: row length includes the phandle", () => {
        const dt = dts(`/dts-v1/;
/ {
    pwm: pwm@7e20c000 {
        compatible = "brcm,bcm2835-pwm";
        #pwm-cells = <2>;
    };
};`);
        const properties = [{ key: "pwms", value: { _t: "matrix" as const, minItems: 1, maxItems: 1, rows: [] } }];
        const data = JSON.stringify({ pwms: [["pwm"]] });
        const result = query_devicetree(dt, properties, data);
        const pwms = result.find(p => p.key === "pwms");
        expect(pwms?.value._t).toBe("matrix");
        if (pwms?.value._t === "matrix") {
            const row = tuple_of(pwms.value.rows[0]);
            expect(row?.cells).toHaveLength(3);
            expect(row?.minItems).toBe(3);
            expect(row?.maxItems).toBe(3);
        }
    });

    test("query_devicetree — dmas: unset becomes phandle-only matrix", () => {
        const dt = dts(`/dts-v1/;
/ {
    dma: dma@48000000 {
        compatible = "st,stm32-dma";
        dma-controller;
        #dma-cells = <4>;
    };
};`);
        const properties = [{ key: "dmas", value: open_list(1, 2) }];
        const result = query_devicetree(dt, properties, "{}");
        const dmas = result.find(p => p.key === "dmas");
        expect(dmas?.value._t).toBe("matrix");
        if (dmas?.value._t === "matrix") {
            expect(dmas.value.minItems).toBe(1);
            expect(dmas.value.maxItems).toBe(2);
            const row = tuple_of(dmas.value.rows[0]);
            expect(row?.cells).toHaveLength(1);
            expect(row?.cells[0]).toMatchObject({ _t: "enum", enum: ["dma"] });
            expect(row?.minItems).toBe(1);
            expect(row?.maxItems).toBe(1);
        }
    });

    test("query_devicetree — dmas: set controller expands to phandle + #dma-cells numbers", () => {
        const dt = dts(`/dts-v1/;
/ {
    dma: dma@48000000 {
        compatible = "st,stm32-dma";
        dma-controller;
        #dma-cells = <4>;
    };
};`);
        const properties = [{ key: "dmas", value: open_list(1, 2) }];
        const data = JSON.stringify({ dmas: [["dma", 0, 1, 2, 3]] });
        const result = query_devicetree(dt, properties, data);
        const dmas = result.find(p => p.key === "dmas");
        expect(dmas?.value._t).toBe("matrix");
        if (dmas?.value._t === "matrix") {
            expect(dmas.value.minItems).toBe(1);
            expect(dmas.value.maxItems).toBe(2);
            const row = tuple_of(dmas.value.rows[0]);
            expect(row?.cells).toHaveLength(5);
            expect(row?.minItems).toBe(5);
            expect(row?.maxItems).toBe(5);
            expect(row?.cells[0]).toMatchObject({ _t: "enum", default: "dma" });
            expect(row?.cells[1]).toMatchObject({ _t: "number", minimum: 0n, maximum: 0xFF_FF_FF_FFn });
        }
    });

    test("query_devicetree — *-supply: enumerates regulators as phandle enum", () => {
        const dt = dts(`/dts-v1/;
/ {
    reg_3v3: regulator-3v3 {
        compatible = "regulator-fixed";
        regulator-min-microvolt = <3300000>;
        regulator-max-microvolt = <3300000>;
    };
};`);
        const properties = [{ key: "vdd-supply", value: { _t: "unknown" as const } }];
        const result = query_devicetree(dt, properties, "{}");
        const supply = result.find(p => p.key === "vdd-supply");
        expect(enum_of(supply?.value)?.enum).toContain("reg_3v3");
        expect(supply?.value).toMatchObject({ _t: "list", minItems: 1, maxItems: 1 });
    });

    test("query_devicetree — pwms: unset becomes phandle-only matrix", () => {
        const dt = dts(`/dts-v1/;
/ {
    pwm: pwm@7e20c000 {
        compatible = "brcm,bcm2835-pwm";
        #pwm-cells = <2>;
    };
};`);
        const properties = [{ key: "pwms", value: open_list(1, 1) }];
        const result = query_devicetree(dt, properties, "{}");
        const pwms = result.find(p => p.key === "pwms");
        expect(pwms?.value._t).toBe("matrix");
        if (pwms?.value._t === "matrix") {
            expect(pwms.value.minItems).toBe(1);
            expect(pwms.value.maxItems).toBe(1);
            const row = tuple_of(pwms.value.rows[0]);
            expect(row?.cells).toHaveLength(1);
            expect(row?.cells[0]).toMatchObject({ _t: "enum", enum: ["pwm"] });
            expect(row?.minItems).toBe(1);
            expect(row?.maxItems).toBe(1);
        }
    });

    test("query_devicetree — clocks: bounds are always 1/1 regardless of input", () => {
        const dt = dts(`/dts-v1/;
/ {
    osc: oscillator {
        compatible = "fixed-clock";
        #clock-cells = <0>;
        clock-frequency = <24000000>;
    };
};`);
        const properties = [{ key: "clocks", value: open_list(2, 4) }];
        const result = query_devicetree(dt, properties, "{}");
        const clocks = result.find(p => p.key === "clocks");
        expect(clocks?.value._t).toBe("matrix");
        if (clocks?.value._t === "matrix") {
            expect(clocks.value.minItems).toBe(1);
            expect(clocks.value.maxItems).toBe(1);
            const row = tuple_of(clocks.value.rows[0]);
            expect(row).toBeDefined();
            expect(row?.minItems).toBe(1);
            expect(row?.maxItems).toBe(1);
        }
    });
}
