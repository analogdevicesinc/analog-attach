import { ParsedBinding } from "../AttachTypes.js";
import { DeviceTree } from "../Devicetree.js";
import { DTNode } from "../Devicetree/parser";
import { extract_compatible } from "../DtQuery.js";

export type PathAndLabel = {
    path: string[];
    label?: string;
};

export enum DTCommDeviceTypes {
    SPI,
    I2C,
    FIXED_CLOCK,
    REGULATOR_FIXED,
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

// eslint-disable-next-line unicorn/prevent-abbreviations
function is_i2c_parent(node: DTNode): boolean {
    if (node.name !== 'i2c') { return false; }
    return node.properties.some(p => p.name === 'compatible') &&
        node.properties.some(p => p.name === '#address-cells') &&
        node.properties.some(p => p.name === '#size-cells');
}

function is_spi_parent(node: DTNode): boolean {
    if (node.name !== 'spi') { return false; }
    return node.properties.some(p => p.name === 'compatible') &&
        node.properties.some(p => p.name === '#address-cells') &&
        node.properties.some(p => p.name === '#size-cells');
}

function is_fixed_clock_parent(node: DTNode): boolean {
    return node.name === 'clocks' &&
        !node.properties.some(p => p.name === '#clock-cells');
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
    const i2c_example = node.examples.some((example) => { return example.includes("i2c {"); });

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
                // eslint-disable-next-line unicorn/prevent-abbreviations
                const i2c_devices = find_nodes(devicetree, is_i2c_parent);
                const paths: PathAndLabel[] = i2c_devices.map((device) => ({
                    path: ['/', ...device.path.split('/').slice(1)],
                    label: device.node.labels.at(0),
                }));
                suggestions = [...suggestions, ...paths];
                break;
            }
            case DTCommDeviceTypes.SPI: {
                const spi_devices = find_nodes(devicetree, is_spi_parent);
                const paths: PathAndLabel[] = spi_devices.map((device) => ({
                    path: ['/', ...device.path.split('/').slice(1)],
                    label: device.node.labels.at(0),
                }));
                suggestions = [...suggestions, ...paths];
                break;
            }
            case DTCommDeviceTypes.FIXED_CLOCK: {
                const clock_definitions = find_nodes(devicetree, is_fixed_clock_parent);
                const paths: PathAndLabel[] = clock_definitions.map((device) => ({
                    path: ['/', ...device.path.split('/').slice(1)],
                    label: device.node.labels.at(0) ?? device.node.name,
                }));
                suggestions = [...suggestions, ...paths];
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
}
