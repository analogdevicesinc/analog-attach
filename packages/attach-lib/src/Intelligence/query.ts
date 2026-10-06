import { ResolvedProperty } from "../Attach/AttachTypes.js";
import { AttachArray, AttachEnumType, FixedIndex } from "../Attach/StructuralTypes.js";
import { DeviceTree, DTNode, DTProperty, get_full_node_name, is_dt_flag } from "../Devicetree/index.js";
import {
    is_clock,
    is_dma_controller,
    is_gpio_controller,
    is_interrupt_controller,
    is_pwm_controller,
    is_regulator,
} from "./predicates.js";

export const INTERRUPT_MACROS: { name: string, value: number }[] = [
    { name: "IRQ_TYPE_NONE", value: 0 },
    { name: "IRQ_TYPE_EDGE_RISING", value: 1 },
    { name: "IRQ_TYPE_EDGE_FALLING", value: 2 },
    { name: "IRQ_TYPE_EDGE_BOTH", value: 2 | 1 },
    { name: "IRQ_TYPE_LEVEL_HIGH", value: 4 },
    { name: "IRQ_TYPE_LEVEL_LOW", value: 8 },
];

export const GPIO_MACROS: { name: string, value: number }[] = [
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

export function cell_extract_first_value(property: DTProperty): bigint | string | undefined {
    if (is_dt_flag(property.value)) { return; }
    const first = property.value[0];
    if (first === undefined || first.kind !== 'array') { return; }
    const element = first.elements[0];
    if (element === undefined) { return; }
    switch (element.kind) {
        case "number": {
            return element.value;
        }
        case "expression": {
            return element.value;
        }
        case "label": {
            return element.name;
        }
        case "path": {
            return element.path;
        }
        default: {
            const _x: never = element;
            throw new Error("Failed exhaustive check!");
        }
    }
}

function find_nodes(
    dt: DeviceTree,
    pred: (node: DTNode) => boolean,
): { node: DTNode; path: string }[] {
    return dt.as_stream()
        .filter((element) => pred(element))
        .toArray()
        .map(([node, path]) => ({ node, path: path.path }));
}

function get_inherited_property(
    devicetree: DeviceTree,
    parent_name: string,
    property_to_search: string,
): DTProperty | undefined {
    const matches = devicetree.as_stream()
        .filter((node) => get_full_node_name(node) === parent_name)
        .toArray();

    if (matches.length !== 1) { return; }
    const first = matches[0];

    if (first === undefined) { return; }
    const [node, path] = first;

    const property = node.properties.find(p => p.name === property_to_search);

    if (property !== undefined) { return property; }
    if (path.path === '/') { return; }

    let new_parent = path.path.split('/').at(-2);

    if (new_parent === undefined) { return; }
    if (new_parent === '') { new_parent = '/'; }

    return get_inherited_property(devicetree, new_parent, property_to_search);
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

export function query_devicetree(
    devicetree: DeviceTree,
    properties: ResolvedProperty[],
    data: string,
    parent_name?: string,
): ResolvedProperty[] {

    const properties_clone = structuredClone(properties);
    const parsed_data = JSON.parse(data);

    for (const property of properties_clone) {
        switch (property.key) {
            case "interrupt-parent": {

                let is_set = parsed_data["interrupt-parent"];

                if (is_set === undefined && parent_name !== undefined) {
                    const inherited = get_inherited_property(devicetree, parent_name, "interrupt-parent");

                    if (inherited !== undefined) {
                        is_set = cell_extract_first_value(inherited);
                    }
                } else if (
                    is_set !== undefined &&
                    Array.isArray(is_set) &&
                    is_set.length === 1 &&
                    typeof is_set[0] === 'string'
                ) {
                    is_set = is_set[0];
                }

                const interrupt_controllers = find_nodes(devicetree, is_interrupt_controller);

                const phandles: string[] = [];

                for (const interrupt_controller of interrupt_controllers) {
                    phandles.push(interrupt_controller.node.labels.at(-1) ?? `&{${interrupt_controller.path}}`);
                }

                if (is_set !== undefined) {

                    const set_interrupt_parent = is_set;

                    const parent = interrupt_controllers.find(
                        (value) => {
                            const name = value.node.labels.at(-1) ?? `&{${value.path}}`;
                            return name === set_interrupt_parent;
                        }
                    );

                    if (parent !== undefined) {

                        const interrupt_cells = parent.node.properties.find((value) => value.name === '#interrupt-cells');
                        if (interrupt_cells !== undefined) {
                            const new_length = cell_extract_first_value(interrupt_cells);

                            if (new_length !== undefined && typeof new_length === 'bigint') {

                                const new_interrupt = properties_clone.find((value) => value.key === "interrupts");

                                if (new_interrupt !== undefined &&
                                    new_interrupt.value._t === 'array'
                                ) {

                                    const new_value: AttachArray = {
                                        _t: 'fixed_index',
                                        prefixItems: [],
                                        minItems: Number(new_length),
                                        maxItems: Number(new_length)
                                    };

                                    for (let index = 0; index < Number(new_length) - 1; index++) {
                                        new_value.prefixItems.push({ _t: "number" });
                                    }

                                    new_value.prefixItems.push(
                                        {
                                            _t: "enum",
                                            enum: INTERRUPT_MACROS.map((value) => value.name),
                                            enum_type: AttachEnumType.MACRO
                                        });

                                    new_interrupt.value = {
                                        _t: "matrix",
                                        minItems: new_interrupt.value.minItems,
                                        maxItems: new_interrupt.value.maxItems,
                                        description: new_interrupt.value.description,
                                        values: [new_value]
                                    };
                                }

                            }

                        }

                    }

                }

                property.value = {
                    _t: "enum_array",
                    minItems: 1,
                    maxItems: 1,
                    enum: phandles,
                    default: is_set,
                    enum_type: AttachEnumType.PHANDLE,
                    description: property.value.description,
                };

                continue;
            }
            case "clocks": {
                const clocks = find_nodes(devicetree, is_clock);

                const phandles: string[] = [];

                for (const clock of clocks) {
                    phandles.push(clock.node.labels.at(-1) ?? `&{${clock.path}}`);
                }

                property.value = {
                    _t: "matrix",
                    minItems: 1,
                    maxItems: 1,
                    description: property.value.description,
                    values: [
                        {
                            _t: "fixed_index",
                            minItems: 1,
                            maxItems: 1,
                            prefixItems: [
                                {
                                    _t: "enum",
                                    enum: phandles,
                                    enum_type: AttachEnumType.PHANDLE,
                                }
                            ]
                        }
                    ]
                };

                continue;
            }
            case "dmas": {

                let set_dma = parsed_data[property.key];

                if (set_dma === undefined ||
                    (Array.isArray(set_dma) && set_dma.length === 0)
                ) {

                    if (property.value._t !== 'array') {
                        continue;
                    }

                    const dmas = find_nodes(devicetree, is_dma_controller);

                    const phandles: string[] = [];

                    for (const dma of dmas) {
                        phandles.push(dma.node.labels.at(-1) ?? `&{${dma.path}}`);
                    }

                    const prefix_items: FixedIndex[] = [{ _t: "enum", enum: phandles, enum_type: AttachEnumType.PHANDLE }];

                    property.value = {
                        _t: 'matrix',
                        minItems: property.value.minItems,
                        maxItems: property.value.maxItems,
                        description: property.value.description,
                        values: [
                            {
                                _t: "fixed_index",
                                minItems: 1,
                                maxItems: 1,
                                prefixItems: prefix_items
                            }
                        ]
                    };

                    continue;
                } else if (
                    Array.isArray(set_dma) &&
                    set_dma.length > 0
                ) {
                    set_dma = set_dma.every((entry) => Array.isArray(entry)) ? set_dma[0][0] : set_dma[0];

                    const dmas = find_nodes(devicetree, is_dma_controller);

                    const phandles: string[] = [];

                    for (const dma of dmas) {
                        phandles.push(dma.node.labels.at(-1) ?? `&{${dma.path}}`);
                    }

                    const node = dmas.find((value) => value.node.labels.at(-1) === set_dma);

                    if (node === undefined) {
                        continue;
                    }

                    const dma_cells = node.node.properties.find((value) => value.name === "#dma-cells");

                    if (dma_cells !== undefined) {
                        const new_length = cell_extract_first_value(dma_cells);

                        if (new_length !== undefined && typeof new_length === 'bigint') {
                            const new_value: AttachArray = {
                                _t: 'fixed_index',
                                prefixItems: [],
                                minItems: Number(new_length) + 1,
                                maxItems: Number(new_length) + 1,
                            };

                            new_value.prefixItems.push(
                                {
                                    _t: "enum",
                                    enum: phandles,
                                    default: set_dma,
                                    enum_type: AttachEnumType.PHANDLE
                                }
                            );

                            for (let index = 0; index < Number(new_length); index++) {
                                new_value.prefixItems.push(
                                    {
                                        _t: "number",
                                        minimum: 0n,
                                        maximum: 0xFF_FF_FF_FFn,
                                    }
                                );
                            }

                            property.value = {
                                _t: 'matrix',
                                minItems: "minItems" in property.value ? property.value.minItems : 1,
                                maxItems: "maxItems" in property.value ? property.value.maxItems : 1,
                                description: property.value.description,
                                values: [
                                    new_value
                                ]
                            };
                        }
                    }

                    continue;
                }
            }
            case "pwms": {

                let set_pwm = parsed_data[property.key];

                if (set_pwm === undefined ||
                    (Array.isArray(set_pwm) && set_pwm.length === 0)
                ) {

                    if (property.value._t !== 'array') {
                        continue;
                    }

                    const pwms = find_nodes(devicetree, is_pwm_controller);

                    const phandles: string[] = [];

                    for (const pwm of pwms) {
                        phandles.push(pwm.node.labels.at(-1) ?? `&{${pwm.path}}`);
                    }

                    const prefix_items: FixedIndex[] = [{ _t: "enum", enum: phandles, enum_type: AttachEnumType.PHANDLE }];

                    property.value = {
                        _t: 'matrix',
                        minItems: property.value.minItems,
                        maxItems: property.value.maxItems,
                        description: property.value.description,
                        values: [
                            {
                                _t: "fixed_index",
                                minItems: 1,
                                maxItems: 1,
                                prefixItems: prefix_items
                            }
                        ]
                    };

                    continue;
                } else if (
                    property.value._t === 'matrix' &&
                    Array.isArray(set_pwm) &&
                    set_pwm.length > 0 &&
                    set_pwm.every((entry) => Array.isArray(entry))
                ) {
                    set_pwm = set_pwm[0][0];

                    const pwms = find_nodes(devicetree, is_pwm_controller);

                    const phandles: string[] = [];

                    for (const pwm of pwms) {
                        phandles.push(pwm.node.labels.at(-1) ?? `&{${pwm.path}}`);
                    }

                    const node = pwms.find((value) => value.node.labels.at(-1) === set_pwm);

                    if (node === undefined) {
                        continue;
                    }

                    const pwm_cells = node.node.properties.find((value) => value.name === "#pwm-cells");

                    if (pwm_cells !== undefined) {
                        const new_length = cell_extract_first_value(pwm_cells);

                        if (new_length !== undefined && typeof new_length === 'bigint') {
                            const new_value: AttachArray = {
                                _t: 'fixed_index',
                                prefixItems: [],
                                minItems: Number(new_length) + 1,
                                maxItems: Number(new_length) + 1,
                            };

                            new_value.prefixItems.push(
                                {
                                    _t: "enum",
                                    enum: phandles,
                                    default: set_pwm,
                                    enum_type: AttachEnumType.PHANDLE
                                }
                            );

                            for (let index = 0; index < Number(new_length); index++) {
                                new_value.prefixItems.push({ _t: "number" });
                            }

                            property.value = {
                                _t: 'matrix',
                                minItems: property.value.minItems,
                                maxItems: property.value.maxItems,
                                description: property.value.description,
                                values: [
                                    new_value
                                ]
                            };
                        }
                    }

                    continue;
                }
            }
        }

        if (property.key.endsWith("-supply")) {
            const regulators = find_nodes(devicetree, is_regulator);

            const phandles: string[] = [];

            for (const regulator of regulators) {
                phandles.push(regulator.node.labels.at(-1) ?? `&{${regulator.path}}`);
            }

            property.value = {
                _t: "enum_array",
                minItems: 1,
                maxItems: 1,
                enum: phandles,
                enum_type: AttachEnumType.PHANDLE,
                description: property.value.description,
            };

            continue;
        }

        if (is_gpio_property(property.key)) {

            const raw_controller = parsed_data[property.key];

            // Extract the controller label from any of: "gpio", ["gpio"],
            // ["gpio", 21, 1], [["gpio", 8, 1], …].
            const set_controller = extract_gpio_controller(raw_controller);

            if (set_controller === undefined) {
                const gpio_controllers = find_nodes(devicetree, is_gpio_controller);

                const phandles: string[] = [];

                for (const gpio_controller of gpio_controllers) {
                    phandles.push(gpio_controller.node.labels.at(-1) ?? `&{${gpio_controller.path}}`);
                }

                property.value = {
                    _t: "enum_array",
                    minItems: 1,
                    maxItems: 1,
                    enum: phandles,
                    enum_type: AttachEnumType.PHANDLE,
                    description: property.value.description,
                };

                continue;
            }

            const gpio_controllers = find_nodes(devicetree, is_gpio_controller);
            const phandles: string[] = [];
            for (const gpio_controller of gpio_controllers) {
                phandles.push(gpio_controller.node.labels.at(-1) ?? `&{${gpio_controller.path}}`);
            }

            const controller_node = gpio_controllers.find((value) => value.node.labels.at(-1) === set_controller);
            if (controller_node === undefined) { continue; }

            const gpio_cells = controller_node.node.properties.find((value) => value.name === "#gpio-cells");
            if (gpio_cells === undefined) { continue; }

            const new_length = cell_extract_first_value(gpio_cells);
            if (new_length === undefined || typeof new_length !== 'bigint') { continue; }

            const row_size = Number(new_length) + 1;

            const row_template: AttachArray = {
                _t: 'fixed_index',
                prefixItems: [
                    { _t: "enum", enum: phandles, default: set_controller, enum_type: AttachEnumType.PHANDLE },
                ],
                minItems: row_size,
                maxItems: row_size,
                description: property.value.description,
            };
            for (let index = 0; index < Number(new_length) - 1; index++) {
                row_template.prefixItems.push({ _t: "number" });
            }
            row_template.prefixItems.push({
                _t: "enum",
                enum: GPIO_MACROS.map((value) => value.name),
                enum_type: AttachEnumType.MACRO,
            });

            const { min_rows, max_rows } = gpio_row_bounds(property.value);

            // eslint-disable-next-line unicorn/prefer-ternary
            if (max_rows <= 1) {
                // Single-row: keep the flat fixed_index shape so the extension's
                // forms don't change.
                property.value = row_template;
            } else {
                property.value = {
                    _t: "matrix",
                    minItems: min_rows,
                    maxItems: max_rows,
                    description: property.value.description,
                    values: [row_template],
                };
            }

            continue;
        }
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
}
