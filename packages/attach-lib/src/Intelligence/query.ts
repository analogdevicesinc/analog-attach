import { ResolvedProperty } from "../Attach/AttachTypes.js";
import { AttachArray, AttachEnumType, FixedIndex } from "../Attach/StructuralTypes.js";
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

function specifier_row(options: {
    phandle?: { enum: string[]; default?: string };
    numbers: number;
    number_item: { _t: "number"; minimum?: bigint; maximum?: bigint } | { _t: "number" };
    trailing_macros?: string[];
    description?: string;
}): AttachArray {
    const { phandle, numbers, number_item, trailing_macros, description } = options;
    const prefixItems: FixedIndex[] = [];
    if (phandle !== undefined) {
        prefixItems.push({ _t: "enum", enum: phandle.enum, ...(phandle.default === undefined ? {} : { default: phandle.default }), enum_type: AttachEnumType.PHANDLE });
    }
    for (let index = 0; index < numbers; index++) {
        prefixItems.push(number_item);
    }
    if (trailing_macros !== undefined) {
        prefixItems.push({ _t: "enum", enum: trailing_macros, enum_type: AttachEnumType.MACRO });
    }
    const size = prefixItems.length;
    return { _t: "fixed_index", prefixItems, minItems: size, maxItems: size, ...(description === undefined ? {} : { description }) };
}

function phandle_enum_array(phandles: string[], description?: string, default_value?: string): ResolvedProperty["value"] {
    return {
        _t: "enum_array",
        minItems: 1,
        maxItems: 1,
        enum: phandles,
        ...(default_value === undefined ? {} : { default: default_value }),
        enum_type: AttachEnumType.PHANDLE,
        description,
    };
}

function phandle_matrix(phandles: string[], bounds: { minItems: number; maxItems: number }, description?: string): ResolvedProperty["value"] {
    return {
        _t: "matrix",
        minItems: bounds.minItems,
        maxItems: bounds.maxItems,
        description,
        values: [{
            _t: "fixed_index",
            minItems: 1,
            maxItems: 1,
            prefixItems: [{ _t: "enum", enum: phandles, enum_type: AttachEnumType.PHANDLE }],
        }],
    };
}

// --- Refiners ---

function refine_interrupt_parent(
    property: ResolvedProperty,
    properties_clone: ResolvedProperty[],
    devicetree: DeviceTree,
    parsed_data: Record<string, unknown>,
    inherited_interrupt_parent: string | undefined,
): boolean {
    if (property.key !== "interrupt-parent") { return false; }

    const is_set = (() => {
        const raw = parsed_data["interrupt-parent"];
        if (raw === undefined) { return inherited_interrupt_parent; }
        if (Array.isArray(raw) && raw.length === 1 && typeof raw[0] === "string") { return raw[0]; }
        return raw;
    })();

    const interrupt_controllers = find_nodes(devicetree, is_interrupt_controller);
    const phandles = interrupt_controllers.map(located => phandle_name(located));

    if (is_set !== undefined) {
        const parent = interrupt_controllers.find(value => phandle_name(value) === is_set);
        if (parent !== undefined) {
            const cell_count = number_property(parent.node, "#interrupt-cells");
            if (cell_count !== undefined) {
                const new_interrupt = properties_clone.find(value => value.key === "interrupts");
                if (new_interrupt !== undefined && new_interrupt.value._t === "array") {
                    const row = specifier_row({
                        numbers: Number(cell_count) - 1,
                        number_item: { _t: "number" },
                        trailing_macros: INTERRUPT_MACROS.map(m => m.name),
                    });
                    new_interrupt.value = {
                        _t: "matrix",
                        minItems: new_interrupt.value.minItems,
                        maxItems: new_interrupt.value.maxItems,
                        description: new_interrupt.value.description,
                        values: [row],
                    };
                }
            }
        }
    }

    property.value = phandle_enum_array(phandles, property.value.description, is_set as string | undefined);
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
        if (property.value._t !== "array") { return true; }
        property.value = phandle_matrix(phandle_names(devicetree, is_dma_controller), { minItems: property.value.minItems, maxItems: property.value.maxItems }, property.value.description);
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
            property.value = {
                _t: "matrix",
                minItems: "minItems" in property.value ? property.value.minItems : 1,
                maxItems: "maxItems" in property.value ? property.value.maxItems : 1,
                description: property.value.description,
                values: [row],
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
        if (property.value._t !== "array") { return true; }
        property.value = phandle_matrix(phandle_names(devicetree, is_pwm_controller), { minItems: property.value.minItems, maxItems: property.value.maxItems }, property.value.description);
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
                minItems: property.value.minItems,
                maxItems: property.value.maxItems,
                description: property.value.description,
                values: [row],
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
        trailing_macros: GPIO_MACROS.map(m => m.name),
        description: property.value.description,
    });

    const { min_rows, max_rows } = gpio_row_bounds(property.value);

    // eslint-disable-next-line unicorn/prefer-ternary
    if (max_rows <= 1) {
        property.value = row;
    } else {
        property.value = {
            _t: "matrix",
            minItems: min_rows,
            maxItems: max_rows,
            description: property.value.description,
            values: [row],
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
        if (refine_interrupt_parent(property, properties_clone, devicetree, parsed_data, inherited_interrupt_parent)) { continue; }
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
function gpio_row_bounds(value: ResolvedProperty["value"]): { min_rows: number, max_rows: number } {
    const min = "minItems" in value && typeof value.minItems === "number" ? value.minItems : undefined;
    const max = "maxItems" in value && typeof value.maxItems === "number" ? value.maxItems : undefined;
    if (min === undefined && max === undefined) { return { min_rows: 1, max_rows: Number.POSITIVE_INFINITY }; }
    return { min_rows: min ?? max!, max_rows: max ?? min! };
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

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
                value: { _t: "generic" as const },
            },
        ];
        const result = query_devicetree(dt, properties, "{}");
        const ip = result.find(p => p.key === "interrupt-parent");
        expect(ip?.value._t).toBe("enum_array");
        if (ip?.value._t === "enum_array") {
            expect(ip.value.enum).toContain("gic");
        }
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
            { key: "interrupt-parent", value: { _t: "generic" as const } },
            { key: "interrupts", value: { _t: "array" as const, minItems: 1, maxItems: 1 } },
        ];
        const result = query_devicetree(dt, properties, "{}", "gic");
        const interrupts = result.find(p => p.key === "interrupts");
        expect(interrupts?.value._t).toBe("matrix");
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
        const properties = [{ key: "reset-gpios", value: { _t: "array" as const, minItems: 1, maxItems: 1 } }];
        const result = query_devicetree(dt, properties, JSON.stringify({ "reset-gpios": ["gpio"] }));
        const reset = result.find(p => p.key === "reset-gpios");
        expect(reset?.value._t).toBe("fixed_index");
        if (reset?.value._t === "fixed_index") {
            expect(reset.value.prefixItems).toHaveLength(3);
            expect(reset.value.minItems).toBe(3);
            expect(reset.value.maxItems).toBe(3);
        }
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
        const properties = [{ key: "clocks", value: { _t: "generic" as const } }];
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
        const properties = [{ key: "cs-gpios", value: { _t: "array" as const, minItems: 1, maxItems: 6 } }];
        const data = JSON.stringify({ "cs-gpios": [["gpio", 8, 1], ["gpio", 7, 1]] });
        const result = query_devicetree(gpio_dt, properties, data);
        const cs = result.find(p => p.key === "cs-gpios");
        expect(cs?.value._t).toBe("matrix");
        if (cs?.value._t === "matrix") {
            expect(cs.value.maxItems).toBe(6);
            expect(cs.value.values).toHaveLength(1);
            expect(cs.value.values[0]?._t).toBe("fixed_index");
        }
    });

    test("query_devicetree — *-gpios: maxItems 1 stays fixed_index", () => {
        const properties = [{ key: "reset-gpios", value: { _t: "array" as const, minItems: 1, maxItems: 1 } }];
        const data = JSON.stringify({ "reset-gpios": ["gpio"] });
        const result = query_devicetree(gpio_dt, properties, data);
        const reset = result.find(p => p.key === "reset-gpios");
        expect(reset?.value._t).toBe("fixed_index");
    });

    test("query_devicetree — *-gpios: plain string data 'gpio' is typed (not generic)", () => {
        const properties = [{ key: "reset-gpios", value: { _t: "array" as const, minItems: 1, maxItems: 1 } }];
        const data = JSON.stringify({ "reset-gpios": "gpio" });
        const result = query_devicetree(gpio_dt, properties, data);
        const reset = result.find(p => p.key === "reset-gpios");
        expect(reset?.value._t).toBe("fixed_index");
        if (reset?.value._t === "fixed_index") {
            expect(reset.value.prefixItems).toHaveLength(3);
        }
    });

    test("query_devicetree — *-gpios: row bounds follow dt-schema's _fixup_items_size", () => {
        const rows = (value: ResolvedProperty["value"]) => {
            const result = query_devicetree(gpio_dt, [{ key: "cs-gpios", value }], JSON.stringify({ "cs-gpios": ["gpio"] }));
            const cs = result.find(p => p.key === "cs-gpios");
            if (cs?.value._t === "fixed_index") { return "single row"; }
            return cs?.value._t === "matrix" ? [cs.value.minItems, cs.value.maxItems] : cs?.value._t;
        };
        // No sizing (e.g. spi-controller.yaml cs-gpios): a bare phandle-array.
        expect(rows({ _t: "generic" })).toStrictEqual([1, Number.POSITIVE_INFINITY]);
        // A lone minItems or maxItems fixes the count.
        expect(rows({ _t: "array", minItems: 2 } as ResolvedProperty["value"])).toStrictEqual([2, 2]);
        expect(rows({ _t: "array", maxItems: 3 } as ResolvedProperty["value"])).toStrictEqual([3, 3]);
        expect(rows({ _t: "array", minItems: 1, maxItems: 6 })).toStrictEqual([1, 6]);
        expect(rows({ _t: "array", minItems: 1, maxItems: 1 })).toBe("single row");
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

    test("query_devicetree — singular reset-gpio with ['gpio'] data is typed as fixed_index", () => {
        const properties = [{ key: "reset-gpio", value: { _t: "array" as const, minItems: 1, maxItems: 1 } }];
        const data = JSON.stringify({ "reset-gpio": ["gpio"] });
        const result = query_devicetree(gpio_dt, properties, data);
        const reset = result.find(p => p.key === "reset-gpio");
        expect(reset?.value._t).toBe("fixed_index");
        if (reset?.value._t === "fixed_index") {
            expect(reset.value.prefixItems).toHaveLength(3);
        }
    });

    test("extract_gpio_controller — [[0], ['gpio', 7, 1]] skips the <0> hole", () => {
        const data = [[0], ["gpio", 7, 1]];
        const properties = [{ key: "cs-gpios", value: { _t: "array" as const, minItems: 1, maxItems: 4 } }];
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
        const properties = [{ key: "pwms", value: { _t: "matrix" as const, minItems: 1, maxItems: 1, values: [] } }];
        const data = JSON.stringify({ pwms: [["pwm"]] });
        const result = query_devicetree(dt, properties, data);
        const pwms = result.find(p => p.key === "pwms");
        expect(pwms?.value._t).toBe("matrix");
        if (pwms?.value._t === "matrix") {
            const row = pwms.value.values[0];
            expect(row?._t).toBe("fixed_index");
            if (row?._t === "fixed_index") {
                expect(row.prefixItems).toHaveLength(3);
                expect(row.minItems).toBe(3);
                expect(row.maxItems).toBe(3);
            }
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
        const properties = [{ key: "dmas", value: { _t: "array" as const, minItems: 1, maxItems: 2 } }];
        const result = query_devicetree(dt, properties, "{}");
        const dmas = result.find(p => p.key === "dmas");
        expect(dmas?.value._t).toBe("matrix");
        if (dmas?.value._t === "matrix") {
            expect(dmas.value.minItems).toBe(1);
            expect(dmas.value.maxItems).toBe(2);
            const row = dmas.value.values[0];
            expect(row?._t).toBe("fixed_index");
            if (row?._t === "fixed_index") {
                expect(row.prefixItems).toHaveLength(1);
                expect(row.prefixItems[0]).toMatchObject({ _t: "enum", enum: ["dma"] });
                expect(row.minItems).toBe(1);
                expect(row.maxItems).toBe(1);
            }
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
        const properties = [{ key: "dmas", value: { _t: "array" as const, minItems: 1, maxItems: 2 } }];
        const data = JSON.stringify({ dmas: [["dma", 0, 1, 2, 3]] });
        const result = query_devicetree(dt, properties, data);
        const dmas = result.find(p => p.key === "dmas");
        expect(dmas?.value._t).toBe("matrix");
        if (dmas?.value._t === "matrix") {
            expect(dmas.value.minItems).toBe(1);
            expect(dmas.value.maxItems).toBe(2);
            const row = dmas.value.values[0];
            expect(row?._t).toBe("fixed_index");
            if (row?._t === "fixed_index") {
                expect(row.prefixItems).toHaveLength(5);
                expect(row.minItems).toBe(5);
                expect(row.maxItems).toBe(5);
                expect(row.prefixItems[0]).toMatchObject({ _t: "enum", default: "dma" });
                expect(row.prefixItems[1]).toMatchObject({ _t: "number", minimum: 0n, maximum: 0xFF_FF_FF_FFn });
            }
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
        const properties = [{ key: "vdd-supply", value: { _t: "generic" as const } }];
        const result = query_devicetree(dt, properties, "{}");
        const supply = result.find(p => p.key === "vdd-supply");
        expect(supply?.value._t).toBe("enum_array");
        if (supply?.value._t === "enum_array") {
            expect(supply.value.enum).toContain("reg_3v3");
            expect(supply.value.minItems).toBe(1);
            expect(supply.value.maxItems).toBe(1);
        }
    });

    test("query_devicetree — pwms: unset becomes phandle-only matrix", () => {
        const dt = dts(`/dts-v1/;
/ {
    pwm: pwm@7e20c000 {
        compatible = "brcm,bcm2835-pwm";
        #pwm-cells = <2>;
    };
};`);
        const properties = [{ key: "pwms", value: { _t: "array" as const, minItems: 1, maxItems: 1 } }];
        const result = query_devicetree(dt, properties, "{}");
        const pwms = result.find(p => p.key === "pwms");
        expect(pwms?.value._t).toBe("matrix");
        if (pwms?.value._t === "matrix") {
            expect(pwms.value.minItems).toBe(1);
            expect(pwms.value.maxItems).toBe(1);
            const row = pwms.value.values[0];
            expect(row?._t).toBe("fixed_index");
            if (row?._t === "fixed_index") {
                expect(row.prefixItems).toHaveLength(1);
                expect(row.prefixItems[0]).toMatchObject({ _t: "enum", enum: ["pwm"] });
                expect(row.minItems).toBe(1);
                expect(row.maxItems).toBe(1);
            }
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
        const properties = [{ key: "clocks", value: { _t: "array" as const, minItems: 2, maxItems: 4 } }];
        const result = query_devicetree(dt, properties, "{}");
        const clocks = result.find(p => p.key === "clocks");
        expect(clocks?.value._t).toBe("matrix");
        if (clocks?.value._t === "matrix") {
            expect(clocks.value.minItems).toBe(1);
            expect(clocks.value.maxItems).toBe(1);
            const row = clocks.value.values[0];
            expect(row?._t).toBe("fixed_index");
            if (row?._t === "fixed_index") {
                expect(row.minItems).toBe(1);
                expect(row.maxItems).toBe(1);
            }
        }
    });
}
