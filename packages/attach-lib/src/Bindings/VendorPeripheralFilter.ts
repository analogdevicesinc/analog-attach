import * as fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";

import type { ParsedBinding, ResolvedProperty } from "./ParsedBinding.js";

/** The node a binding's node sits under: its parent, the bus controller when there is one. */
export interface ControllerContext {
    compatibles: string[];
    binding_path?: string;
    /** Its full name (`spi@7e204000`, `i2c@7e804000`). Without it, the SPI properties stay whatever the parent. */
    name?: string;
}

/** What a Linux tree says of SPI peripherals, in `spi/spi-peripheral-props.yaml` and `spi/spi-controller.yaml`. */
export interface SpiPeripherals {
    /**
     * The properties a node has for being on an SPI bus: spi-peripheral-props' (not `reg`) and its vendor files', and
     * the ones spi-controller.yaml gives its child nodes (`spi-cpha`).
     */
    properties: ReadonlySet<string>;
    /** spi-controller.yaml's `$nodename` pattern: the name of an SPI controller. */
    controller_name: RegExp;
}

const loaded = new Map<string, SpiPeripherals | undefined>();

/** The SPI peripheral schema of the bindings directory `bindings`, read once; undefined when the tree lacks it. */
export function load_spi_peripherals(bindings: string): SpiPeripherals | undefined {
    if (!loaded.has(bindings)) { loaded.set(bindings, read_spi_peripherals(path.join(bindings, "spi"))); }
    return loaded.get(bindings);
}

function read_spi_peripherals(directory: string): SpiPeripherals | undefined {
    const read = (file: string): any => {
        try {
            return parse(fs.readFileSync(path.join(directory, file), "utf8"));
        } catch {
            return undefined;
        }
    };
    const peripheral = read("spi-peripheral-props.yaml");
    const controller = read("spi-controller.yaml");
    const pattern: unknown = controller?.properties?.$nodename?.pattern;
    if (peripheral === undefined || typeof pattern !== "string") { return undefined; }

    const names = new Set<string>();
    const add = (properties: unknown): void => {
        if (typeof properties !== "object" || properties === null) { return; }
        for (const name of Object.keys(properties)) {
            if (name !== "reg") { names.add(name); }
        }
    };
    add(peripheral.properties);
    // The vendor files beside it (`$ref: arm,pl022-peripheral-props.yaml#`)
    for (const entry of Array.isArray(peripheral.allOf) ? peripheral.allOf : []) {
        const reference: unknown = entry?.$ref;
        if (typeof reference === "string" && !reference.startsWith("/")) { add(read(reference.split("#")[0]!)?.properties); }
    }
    for (const child of Object.values<any>(controller.patternProperties ?? {})) { add(child?.properties); }
    return { properties: names, controller_name: new RegExp(pattern) };
}

interface VendorRule {
    prefix: string;
    exact?: boolean;
    stems: string[];
}

const VENDOR_RULES: VendorRule[] = [
    { prefix: "pl022,", stems: ["arm,pl022"] },
    { prefix: "cdns,", stems: ["cdns,qspi-nor"] },
    { prefix: "fsl,", stems: ["fsl,dspi"] },
    { prefix: "controller-data", exact: true, stems: ["samsung,spi"] },
    { prefix: "nvidia,", stems: ["nvidia,tegra210-quad"] },
    { prefix: "st,spi-midi-ns", exact: true, stems: ["st"] },
];

function find_vendor_rule(property_name: string): VendorRule | undefined {
    for (const rule of VENDOR_RULES) {
        if (rule.exact === true) {
            if (property_name === rule.prefix) { return rule; }
        } else {
            if (property_name.startsWith(rule.prefix)) { return rule; }
        }
    }
    return undefined;
}

function stem_matches_controller(stem: string, controller: ControllerContext): boolean {
    // Rule (a): stem is one of the parent's compatibles
    for (const compatible of controller.compatibles) {
        if (compatible === stem || compatible.startsWith(stem + "-") || compatible.endsWith("," + stem)) {
            return true;
        }
    }

    // Rule (b): basename(binding_path) === stem + ".yaml"
    if (controller.binding_path !== undefined) {
        const basename = controller.binding_path.split("/").at(-1) ?? "";
        if (basename === stem + ".yaml") {
            return true;
        }
    }

    // For the "st" vendor prefix rule: check if any compatible has the same vendor prefix
    if (!stem.includes(",")) {
        for (const compatible of controller.compatibles) {
            const vendor = compatible.split(",")[0];
            if (vendor === stem) { return true; }
        }
    }

    return false;
}

export function vendor_file_applies(property_name: string, controller: ControllerContext): boolean {
    const rule = find_vendor_rule(property_name);
    if (rule === undefined) { return true; }
    return rule.stems.some(stem => stem_matches_controller(stem, controller));
}

/** Under a parent that isn't an SPI controller, an SPI property goes, unless the binding requires it. */
function spi_property_applies(name: string, binding: ParsedBinding, controller: ControllerContext, spi: SpiPeripherals | undefined): boolean {
    if (spi === undefined || controller.name === undefined || spi.controller_name.test(controller.name)) { return true; }
    return !spi.properties.has(name) || binding.required_properties.includes(name);
}

/**
 * The binding without the peripheral properties that don't apply under `controller`: another controller's vendor ones
 * (`pl022,`), and the SPI ones (`spi` given) when it isn't an SPI controller.
 */
export function filter_peripheral_properties(
    binding: ParsedBinding,
    controller: ControllerContext | undefined,
    spi?: SpiPeripherals,
): ParsedBinding {
    if (controller === undefined) { return binding; }

    const filtered_properties = binding.properties.filter(
        (property: ResolvedProperty) => vendor_file_applies(property.key, controller) && spi_property_applies(property.key, binding, controller, spi),
    );

    if (filtered_properties.length === binding.properties.length) { return binding; }

    return {
        ...binding,
        properties: filtered_properties,
    };
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    test("vendor_file_applies — generic SPI props are always kept", () => {
        const ctrl: ControllerContext = { compatibles: ["brcm,bcm2835-spi"] };
        expect(vendor_file_applies("spi-max-frequency", ctrl)).toBe(true);
        expect(vendor_file_applies("spi-cpha", ctrl)).toBe(true);
        expect(vendor_file_applies("reg", ctrl)).toBe(true);
    });

    test("vendor_file_applies — pl022 props hidden under bcm2835", () => {
        const ctrl: ControllerContext = { compatibles: ["brcm,bcm2835-spi"] };
        expect(vendor_file_applies("pl022,interface", ctrl)).toBe(false);
        expect(vendor_file_applies("pl022,com-mode", ctrl)).toBe(false);
    });

    test("vendor_file_applies — pl022 props kept under arm,pl022", () => {
        const ctrl: ControllerContext = { compatibles: ["arm,pl022"] };
        expect(vendor_file_applies("pl022,interface", ctrl)).toBe(true);
    });

    test("vendor_file_applies — fsl props kept under fsl controller", () => {
        const ctrl: ControllerContext = { compatibles: ["fsl,vf610-dspi"], binding_path: "/some/path/fsl,dspi.yaml" };
        expect(vendor_file_applies("fsl,spi-cs-sck-delay", ctrl)).toBe(true);
    });

    test("vendor_file_applies — fsl props hidden under bcm2835", () => {
        const ctrl: ControllerContext = { compatibles: ["brcm,bcm2835-spi"] };
        expect(vendor_file_applies("fsl,spi-cs-sck-delay", ctrl)).toBe(false);
    });

    test("vendor_file_applies — controller-data kept under samsung", () => {
        const ctrl: ControllerContext = { compatibles: ["tesla,fsd-spi"], binding_path: "/some/path/samsung,spi.yaml" };
        expect(vendor_file_applies("controller-data", ctrl)).toBe(true);
    });

    test("vendor_file_applies — controller-data hidden under bcm2835", () => {
        const ctrl: ControllerContext = { compatibles: ["brcm,bcm2835-spi"] };
        expect(vendor_file_applies("controller-data", ctrl)).toBe(false);
    });

    test("vendor_file_applies — nvidia props", () => {
        const ctrl_nvidia: ControllerContext = { compatibles: ["nvidia,tegra234-qspi"], binding_path: "/some/nvidia,tegra210-quad.yaml" };
        expect(vendor_file_applies("nvidia,tx-clk-tap-delay", ctrl_nvidia)).toBe(true);
        const ctrl_bcm: ControllerContext = { compatibles: ["brcm,bcm2835-spi"] };
        expect(vendor_file_applies("nvidia,tx-clk-tap-delay", ctrl_bcm)).toBe(false);
    });

    test("vendor_file_applies — st,spi-midi-ns kept under st controller", () => {
        const ctrl: ControllerContext = { compatibles: ["st,stm32f4-spi"] };
        expect(vendor_file_applies("st,spi-midi-ns", ctrl)).toBe(true);
    });

    test("vendor_file_applies — st,spi-midi-ns hidden under bcm2835", () => {
        const ctrl: ControllerContext = { compatibles: ["brcm,bcm2835-spi"] };
        expect(vendor_file_applies("st,spi-midi-ns", ctrl)).toBe(false);
    });

    test("filter_peripheral_properties — undefined controller returns unchanged", () => {
        const binding: ParsedBinding = {
            required_properties: ["reg"],
            properties: [{ key: "reg", value: {} as any }, { key: "pl022,interface", value: {} as any }],
            examples: [],
        };
        // eslint-disable-next-line unicorn/no-useless-undefined
        expect(filter_peripheral_properties(binding, undefined)).toBe(binding);
    });

    test("filter_peripheral_properties — bcm2835 removes all vendor props", () => {
        const binding: ParsedBinding = {
            required_properties: ["reg"],
            properties: [
                { key: "reg", value: {} as any },
                { key: "spi-max-frequency", value: {} as any },
                { key: "pl022,interface", value: {} as any },
                { key: "cdns,read-delay", value: {} as any },
                { key: "fsl,spi-cs-sck-delay", value: {} as any },
                { key: "controller-data", value: {} as any },
                { key: "nvidia,tx-clk-tap-delay", value: {} as any },
                { key: "st,spi-midi-ns", value: {} as any },
            ],
            examples: [],
        };
        const ctrl: ControllerContext = { compatibles: ["brcm,bcm2835-spi"] };
        const filtered = filter_peripheral_properties(binding, ctrl);
        expect(filtered.properties.map(p => p.key)).toEqual(["reg", "spi-max-frequency"]);
    });

    test("filter_peripheral_properties — input is not mutated", () => {
        const binding: ParsedBinding = {
            required_properties: ["reg"],
            properties: [
                { key: "reg", value: {} as any },
                { key: "pl022,interface", value: {} as any },
            ],
            examples: [],
        };
        const ctrl: ControllerContext = { compatibles: ["brcm,bcm2835-spi"] };
        const original_length = binding.properties.length;
        filter_peripheral_properties(binding, ctrl);
        expect(binding.properties.length).toBe(original_length);
    });
}
