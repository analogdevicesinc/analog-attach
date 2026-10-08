import type { ParsedBinding, ResolvedProperty } from "../Attach/AttachTypes.js";

export interface ControllerContext {
    compatibles: string[];
    binding_path?: string;
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

export function filter_vendor_peripheral_props(
    binding: ParsedBinding,
    controller: ControllerContext | undefined,
): ParsedBinding {
    if (controller === undefined) { return binding; }

    const filtered_properties = binding.properties.filter(
        (property: ResolvedProperty) => vendor_file_applies(property.key, controller),
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

    test("filter_vendor_peripheral_props — undefined controller returns unchanged", () => {
        const binding: ParsedBinding = {
            required_properties: ["reg"],
            properties: [{ key: "reg", value: {} as any }, { key: "pl022,interface", value: {} as any }],
            examples: [],
        };
        expect(filter_vendor_peripheral_props(binding, undefined)).toBe(binding);
    });

    test("filter_vendor_peripheral_props — bcm2835 removes all vendor props", () => {
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
        const filtered = filter_vendor_peripheral_props(binding, ctrl);
        expect(filtered.properties.map(p => p.key)).toEqual(["reg", "spi-max-frequency"]);
    });

    test("filter_vendor_peripheral_props — input is not mutated", () => {
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
        filter_vendor_peripheral_props(binding, ctrl);
        expect(binding.properties.length).toBe(original_length);
    });
}
