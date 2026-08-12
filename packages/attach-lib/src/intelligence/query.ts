import { ResolvedProperty } from "../AttachTypes.js";
import { AttachArray, AttachEnumType, FixedIndex } from "../StructuralTypes.js";
import { DeviceTree } from "../Devicetree/Devicetree.js";
import { DTNode, DTProperty, get_full_node_name, is_dt_flag } from "../Devicetree/parser";
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
                                minItems: Number(new_length),
                                maxItems: Number(new_length),
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
            };

            continue;
        }

        if (property.key.endsWith("-gpios") || property.key === "gpios" || property.key === "gpio") {

            let set_controller = parsed_data[property.key];

            if (
                set_controller === undefined ||
                (Array.isArray(set_controller) && set_controller.length === 0)
            ) {
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
                };

                continue;
            } else if (
                Array.isArray(set_controller) &&
                set_controller.length > 0 &&
                typeof set_controller[0] === 'string'
            ) {
                set_controller = set_controller[0];

                const gpio_controllers = find_nodes(devicetree, is_gpio_controller);

                const phandles: string[] = [];

                for (const gpio_controller of gpio_controllers) {
                    phandles.push(gpio_controller.node.labels.at(-1) ?? `&{${gpio_controller.path}}`);
                }

                const node = gpio_controllers.find((value) => value.node.labels.at(-1) === set_controller);

                if (node === undefined) {
                    continue;
                }

                const gpio_cells = node.node.properties.find((value) => value.name === "#gpio-cells");

                if (gpio_cells !== undefined) {
                    const new_length = cell_extract_first_value(gpio_cells);

                    if (new_length !== undefined && typeof new_length === 'bigint') {
                        const new_value: AttachArray = {
                            _t: 'fixed_index',
                            prefixItems: [],
                            minItems: Number(new_length),
                            maxItems: Number(new_length),
                        };

                        new_value.prefixItems.push(
                            {
                                _t: "enum",
                                enum: phandles,
                                default: set_controller,
                                enum_type: AttachEnumType.PHANDLE
                            }
                        );

                        for (let index = 0; index < Number(new_length) - 1; index++) {
                            new_value.prefixItems.push({ _t: "number" });
                        }

                        new_value.prefixItems.push(
                            {
                                _t: "enum",
                                enum: GPIO_MACROS.map((value) => value.name),
                                enum_type: AttachEnumType.MACRO
                            }
                        );

                        property.value = new_value;
                    }
                }
            }

            continue;
        }
    }

    return properties_clone;
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
}
