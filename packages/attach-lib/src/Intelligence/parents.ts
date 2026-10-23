import { ParsedBinding } from "../Bindings/ParsedBinding.js";
import { DeviceTree, DTNode, has_property, type LocatedNode } from "../Devicetree/index.js";
import { find_nodes, node_label } from "./providers.js";

export type PathAndLabel = {
    path: string[];
    label?: string;
};

export function parent_path_string(p: PathAndLabel): string {
    return p.path.length <= 1 ? "/" : `/${p.path.slice(1).join("/")}`;
}

export enum DTCommDeviceTypes {
    SPI,
    I2C,
    FIXED_CLOCK,
    REGULATOR_FIXED,
}

function is_bus_parent(name: string): (node: DTNode) => boolean {
    return (node: DTNode) =>
        node.name === name &&
        has_property(node, "compatible") &&
        has_property(node, "#address-cells") &&
        has_property(node, "#size-cells");
}

function is_fixed_clock_parent(node: DTNode): boolean {
    return node.name === 'clocks' && !has_property(node, '#clock-cells');
}

function to_path_and_label(located: LocatedNode): PathAndLabel {
    return {
        path: ['/', ...located.path.split('/').slice(1)],
        label: node_label(located.node),
    };
}

export function suggest_parents(devicetree: DeviceTree, node: ParsedBinding): PathAndLabel[] {
    const compatible = extract_compatible(node);

    if (compatible !== undefined) {
        if (compatible.includes("fixed-clock")) {
            return suggest_parents_impl(devicetree, [DTCommDeviceTypes.FIXED_CLOCK]);
        }

        if (compatible.includes("regulator-fixed")) {
            return suggest_parents_impl(devicetree, [DTCommDeviceTypes.REGULATOR_FIXED]);
        }
    }

    const spi_max_frequency = node.properties.some((value) => value.key === "spi-max-frequency");
    // eslint-disable-next-line unicorn/prevent-abbreviations
    const i2c_example = node.examples.some((example) => /\bi2c[\d@&]?\S*\s*\{/.test(example));

    let suggestions: PathAndLabel[] = [];

    if (spi_max_frequency === true) {
        suggestions = [...suggestions, ...suggest_parents_impl(devicetree, [DTCommDeviceTypes.SPI])];
    }

    if (i2c_example === true) {
        suggestions = [...suggestions, ...suggest_parents_impl(devicetree, [DTCommDeviceTypes.I2C])];
    }

    return suggestions;
}

export function suggest_parents_impl(devicetree: DeviceTree, parent_types: DTCommDeviceTypes[]): PathAndLabel[] {
    let suggestions: PathAndLabel[] = [];

    for (const parent_type of parent_types) {
        switch (parent_type) {
            case DTCommDeviceTypes.I2C: {
                suggestions = [...suggestions, ...find_nodes(devicetree, is_bus_parent("i2c")).map(located => to_path_and_label(located))];
                break;
            }
            case DTCommDeviceTypes.SPI: {
                suggestions = [...suggestions, ...find_nodes(devicetree, is_bus_parent("spi")).map(located => to_path_and_label(located))];
                break;
            }
            case DTCommDeviceTypes.FIXED_CLOCK: {
                const parents = find_nodes(devicetree, is_fixed_clock_parent).map(located => ({
                    ...to_path_and_label(located),
                    label: node_label(located.node) ?? located.node.name,
                }));
                suggestions = [...suggestions, ...(parents.length > 0 ? parents : [{ path: ['/'], label: '/' }])];
                break;
            }
            case DTCommDeviceTypes.REGULATOR_FIXED: {
                suggestions = [...suggestions, { path: ['/'], label: '/' }];
                break;
            }
            default: {
                const _x: never = parent_type;
                throw new Error("Exhaustion check failed");
            }
        }
    }

    return suggestions;
}

export function extract_compatible(node: ParsedBinding): string[] | undefined {

    const compatible = node.properties.find((value) => value.key === "compatible");

    if (compatible === undefined) {
        return;
    }

    if (compatible.value._t === "enum_array") {
        let compatible_accumulator: string[] = [];

        for (const entry of compatible.value.enum) {
            if (typeof entry === 'string') {
                compatible_accumulator.push(entry);
            } else if (Array.isArray(entry)) {
                compatible_accumulator = [...compatible_accumulator, ...entry];
            }
        }

        return compatible_accumulator;
    } else if (compatible.value._t === 'const') {
        return [compatible.value.const];
    }
}


if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    const dts = (source: string) => {
        const dt = DeviceTree.new_from_string(source);
        if (typeof dt === "string") { throw new TypeError(dt); }
        return dt;
    };

    const rpi_like = `/dts-v1/;
/ {
    soc {
        i2c0: i2c@7e205000 {
            compatible = "brcm,bcm2835-i2c";
            #address-cells = <1>;
            #size-cells = <0>;
        };
        spi0: spi@7e204000 {
            compatible = "brcm,bcm2835-spi";
            #address-cells = <1>;
            #size-cells = <0>;
        };
    };
};`;

    test("suggest_parents_impl — SPI: finds spi nodes with required properties", () => {
        const dt = dts(rpi_like);
        const result = suggest_parents_impl(dt, [DTCommDeviceTypes.SPI]);
        expect(result).toHaveLength(1);
        expect(result[0]?.label).toBe("spi0");
    });

    test("suggest_parents_impl — I2C: finds i2c nodes with required properties", () => {
        const dt = dts(rpi_like);
        const result = suggest_parents_impl(dt, [DTCommDeviceTypes.I2C]);
        expect(result).toHaveLength(1);
        expect(result[0]?.label).toBe("i2c0");
    });

    test("suggest_parents_impl — REGULATOR_FIXED: always returns root", () => {
        const dt = dts(rpi_like);
        const result = suggest_parents_impl(dt, [DTCommDeviceTypes.REGULATOR_FIXED]);
        expect(result).toHaveLength(1);
        expect(result[0]?.path).toStrictEqual(['/']);
    });

    test("suggest_parents_impl — FIXED_CLOCK: finds clocks container without #clock-cells", () => {
        const dt = dts(`/dts-v1/;
/ {
    clocks {
        clk_osc: osc {
            compatible = "fixed-clock";
            #clock-cells = <0>;
            clock-frequency = <19200000>;
        };
    };
};`);
        const result = suggest_parents_impl(dt, [DTCommDeviceTypes.FIXED_CLOCK]);
        expect(result).toHaveLength(1);
        expect(result[0]?.label).toBe("clocks");
    });

    test("suggest_parents_impl — path array format: slash-separated segments", () => {
        const dt = dts(rpi_like);
        const result = suggest_parents_impl(dt, [DTCommDeviceTypes.SPI]);
        expect(result[0]?.path).toStrictEqual(['/', 'soc', 'spi@7e204000']);
    });

    test("suggest_parents_impl — FIXED_CLOCK: falls back to root when no /clocks container", () => {
        const dt = dts(`/dts-v1/;
/ {
    osc: oscillator {
        compatible = "fixed-clock";
        #clock-cells = <0>;
    };
};`);
        const result = suggest_parents_impl(dt, [DTCommDeviceTypes.FIXED_CLOCK]);
        expect(result).toHaveLength(1);
        expect(result[0]?.path).toStrictEqual(['/']);
    });

    test("suggest_parents — I2C example with i2c0 or i2c@addr pattern", () => {
        const dt = dts(rpi_like);
        // eslint-disable-next-line unicorn/consistent-function-scoping
        const binding = (example: string) => ({
            properties: [],
            required_properties: [],
            examples: [example],
        }) as unknown as ParsedBinding;

        expect(suggest_parents(dt, binding("i2c0 {\n  dev@48 {};\n};"))).toHaveLength(1);
        expect(suggest_parents(dt, binding("&i2c1 {\n  dev@48 {};\n};"))).toHaveLength(1);
        expect(suggest_parents(dt, binding("i2c@7e205000 {\n  dev@48 {};\n};"))).toHaveLength(1);
    });
}
