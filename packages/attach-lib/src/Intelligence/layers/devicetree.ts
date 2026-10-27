import { DeviceTree, DTNode, string_property, number_property, get_full_node_name } from "../../Devicetree/index.js";
import { is_clock, is_interrupt_controller, is_regulator } from "../predicates.js";
import { query_devicetree } from "../query.js";
import { parent_path_string, suggest_parents } from "../parents.js";
import { effective_interrupt_parent, base_lookup } from "../interrupt_parent.js";
import { labelled_providers } from "../providers.js";
import { IntelligenceLayer, PropertyContext, ValueSuggestion } from "./types.js";

function format_frequency(hz: bigint): string {
    if (hz % 1_000_000n === 0n) { return `${hz / 1_000_000n} MHz`; }
    if (hz % 1000n === 0n) { return `${hz / 1000n} kHz`; }
    return `${hz} Hz`;
}

function format_voltage(microvolt: bigint): string {
    return `${Number(microvolt) / 1_000_000} V`;
}

/** "fixed-clock "osc", 54 MHz" */
function describe_clock(node: DTNode): string {
    const name = string_property(node, "clock-output-names");
    const frequency = number_property(node, "clock-frequency");
    return ["fixed-clock", ...(name === undefined ? [] : [`"${name}"`]), ...(frequency === undefined ? [] : [format_frequency(frequency)])].join(" ");
}

/** "regulator "3v3", 3.3 V, always on" */
function describe_regulator(node: DTNode): string {
    const name = string_property(node, "regulator-name");
    const microvolt = number_property(node, "regulator-min-microvolt");
    const always_on = node.properties.some(p => p.name === "regulator-always-on");
    return [
        `regulator${name === undefined ? "" : ` "${name}"`}`,
        ...(microvolt === undefined ? [] : [format_voltage(microvolt)]),
        ...(always_on ? ["always on"] : []),
    ].join(", ");
}

function suggest_interrupt_parents(
    property: string,
    devicetree: DeviceTree,
    node_path: string | undefined,
): ValueSuggestion[] {
    if (property !== "interrupt-parent") { return []; }

    const controllers = labelled_providers(devicetree, is_interrupt_controller);
    if (controllers.length === 0) { return []; }

    const inherited = node_path === undefined
        ? undefined
        : effective_interrupt_parent(base_lookup(devicetree), node_path, devicetree);

    const suggestions: ValueSuggestion[] = [];

    if (inherited !== undefined && inherited.label !== undefined) {
        const matching = controllers.find(c => c.label === inherited.label);
        if (matching !== undefined) {
            const cells = number_property(matching.node, "#interrupt-cells");
            suggestions.push({
                rows: [[{ label: inherited.label }]],
                display: `${inherited.label} — interrupt controller, #interrupt-cells = <${cells ?? "?"}>${inherited.from === "/" ? "" : ` at ${inherited.from}`}; inherited from ${inherited.from}`,
                source: "devicetree",
            });
        }
    }

    for (const { label, node } of controllers) {
        if (inherited !== undefined && label === inherited.label) { continue; }
        const cells = number_property(node, "#interrupt-cells");
        suggestions.push({
            rows: [[{ label }]],
            display: `${label} — interrupt controller, #interrupt-cells = <${cells ?? "?"}>`,
            source: "devicetree",
        });
    }

    return suggestions;
}

/**
 * Clock and supply providers the base tree already has.
 */
function suggest_labelled_providers(property: string, devicetree: DeviceTree): ValueSuggestion[] {
    if (property === "clocks") {
        return labelled_providers(devicetree, is_clock).map(({ label, node }) => ({
            rows: [[{ label }]],
            display: `${label} — ${describe_clock(node)}`,
            source: "devicetree",
        }));
    }
    if (property.endsWith("-supply")) {
        return labelled_providers(devicetree, is_regulator).map(({ label, node }) => ({
            rows: [[{ label }]],
            display: `${label} — ${describe_regulator(node)}`,
            source: "devicetree",
        }));
    }
    return [];
}

/**
 * `reg` matching the node's unit address (`channel@1` → `<1>`, `temp@48` →
 * `<0x48>`): by devicetree convention the first `reg` cell is the unit
 * address. Only single-cell unit addresses are handled.
 */
function suggest_unit_address_reg(property: string, node_path: string | undefined): ValueSuggestion[] {
    if (property !== "reg" || node_path === undefined) { return []; }
    const name = node_path.slice(node_path.lastIndexOf("/") + 1);
    const unit = /@([0-9a-fA-F]+)$/.exec(name)?.[1];
    if (unit === undefined) { return []; }
    const value = BigInt(`0x${unit}`);
    return [{
        rows: [[value]],
        display: `${value < 10n ? value : `0x${unit}`} — matches the unit address of ${name}`,
        source: "devicetree",
    }];
}

function inherited_interrupt_label(context: PropertyContext): string | undefined {
    const dt = context.devicetree;
    const lookup = base_lookup(dt);
    if (context.placement?.node_path !== undefined) {
        return effective_interrupt_parent(lookup, context.placement.node_path, dt)?.label;
    }
    if (context.parent_name !== undefined) {
        const path_from_name = dt.as_stream()
            .filter(({ node }) => get_full_node_name(node) === context.parent_name)
            .toArray()[0]?.path;
        if (path_from_name !== undefined) {
            return effective_interrupt_parent(lookup, `${path_from_name}/child`, dt)?.label;
        }
    }
    return undefined;
}

// Layer 2: knowledge derived from the base device tree (controllers, buses, phandles).
export const devicetree_layer: IntelligenceLayer = {
    name: "devicetree",
    refine_properties(properties, context) {
        return query_devicetree(context.devicetree, properties, context.data, inherited_interrupt_label(context));
    },
    suggest_values(property, context, lower) {
        return [
            ...lower,
            ...suggest_unit_address_reg(property, context.placement?.node_path),
            ...suggest_labelled_providers(property, context.devicetree),
            ...suggest_interrupt_parents(property, context.devicetree, context.placement?.node_path),
        ];
    },
    suggest_placement(binding, devicetree, lower) {
        return [
            ...lower,
            ...suggest_parents(devicetree, binding).map(parent => ({
                parent,
                display: parent_path_string(parent),
                source: "devicetree",
            })),
        ];
    },
};

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    const devicetree = DeviceTree.new_from_string(`/dts-v1/;
/ {
    clocks {
        clk_osc: clk-osc {
            compatible = "fixed-clock";
            #clock-cells = <0>;
            clock-output-names = "osc";
            clock-frequency = <54000000>;
        };
        cam_clk: cam-clk {
            compatible = "fixed-clock";
            #clock-cells = <0>;
            status = "disabled";
        };
    };
    vdd_3v3_reg: fixedregulator_3v3 {
        compatible = "regulator-fixed";
        regulator-always-on;
        regulator-min-microvolt = <3300000>;
        regulator-max-microvolt = <3300000>;
        regulator-name = "3v3";
    };
    switched_reg {
        compatible = "regulator-fixed";
        regulator-name = "unlabelled";
    };
};`);
    if (typeof devicetree === "string") { throw new TypeError(devicetree); }
    const values = (property: string) => devicetree_layer.suggest_values!(property, { devicetree, data: "{}" }, []);

    test("devicetree_layer — clocks: enabled, labelled fixed clocks with their frequency", () => {
        expect(values("clocks")).toStrictEqual([{
            rows: [[{ label: "clk_osc" }]],
            display: `clk_osc — fixed-clock "osc" 54 MHz`,
            source: "devicetree",
        }]);
    });

    test("devicetree_layer — *-supply: labelled fixed regulators with their voltage", () => {
        expect(values("vref-supply").map(s => s.display)).toStrictEqual([`vdd_3v3_reg — regulator "3v3", 3.3 V, always on`]);
        expect(values("vref-supply")[0]?.note).toBeUndefined();
    });

    test("devicetree_layer — on a merged tree, the overlay's providers and the ones it enables count", async () => {
        const { DeviceTreeOverlay } = await import("../../Devicetree/index.js");
        const overlay = DeviceTreeOverlay.new_from_string(`/dts-v1/;\n/plugin/;\n&{/} {\n\tvref: fixedregulator@0 {\n\t\tcompatible = "regulator-fixed";\n\t\tregulator-min-microvolt = <2500000>;\n\t};\n};\n&cam_clk {\n\tstatus = "okay";\n};`, devicetree);
        if (typeof overlay === "string") { throw new TypeError(overlay); }
        const merged = overlay.merged_tree();
        if (merged === undefined) { throw new TypeError("no merged tree"); }
        const merged_values = (property: string) => devicetree_layer.suggest_values!(property, { devicetree: merged, data: "{}" }, []);
        expect(merged_values("vref-supply").map(s => s.display)).toStrictEqual([
            `vdd_3v3_reg — regulator "3v3", 3.3 V, always on`,
            `vref — regulator, 2.5 V`,
        ]);
        expect(merged_values("clocks").map(s => s.rows)).toStrictEqual([[[{ label: "clk_osc" }]], [[{ label: "cam_clk" }]]]);
        // The base is left as it was.
        expect(values("clocks")).toHaveLength(1);
    });

    test("devicetree_layer — reg matches the unit address", () => {
        // eslint-disable-next-line unicorn/consistent-function-scoping
        const at = (node_path: string) => devicetree_layer.suggest_values!("reg", {
            devicetree, data: "{}", placement: { node_path, parent_path: "/", siblings: [] },
        }, []);
        expect(at("/soc/spi@7e204000/adc@0/channel@1")).toStrictEqual([
            { rows: [[1n]], display: "1 — matches the unit address of channel@1", source: "devicetree" },
        ]);
        expect(at("/soc/i2c@7e804000/temp@48")[0]?.rows).toStrictEqual([[0x48n]]);
        expect(at("/soc/i2c@7e804000/temp@48")[0]?.display).toBe("0x48 — matches the unit address of temp@48");
        expect(at("/soc/regulators")).toStrictEqual([]);
    });

    test("devicetree_layer — other properties get no provider suggestions", () => {
        expect(values("reg")).toStrictEqual([]);
        expect(values("clock-names")).toStrictEqual([]);
    });

    const int_dt = DeviceTree.new_from_string(`/dts-v1/;
/ {
    interrupt-parent = <&gicv2>;
    gicv2: interrupt-controller@ff841000 {
        interrupt-controller;
        #interrupt-cells = <3>;
    };
    soc {
        gpio: gpio@7e200000 {
            interrupt-controller;
            #interrupt-cells = <2>;
        };
        spi0: spi@7e204000 {
            #address-cells = <1>;
            #size-cells = <0>;
        };
    };
    no_label_intc {
        interrupt-controller;
        #interrupt-cells = <1>;
    };
    disabled_intc: disabled_intc {
        interrupt-controller;
        #interrupt-cells = <1>;
        status = "disabled";
    };
};`);
    if (typeof int_dt === "string") { throw new TypeError(int_dt); }

    test("devicetree_layer — interrupt-parent: lists enabled labelled controllers, inherited first", () => {
        const result = devicetree_layer.suggest_values!("interrupt-parent", {
            devicetree: int_dt, data: "{}",
            placement: { node_path: "/soc/spi@7e204000/adc@0", parent_path: "/soc/spi@7e204000", siblings: [] },
        }, []);
        expect(result).toHaveLength(2);
        expect(result[0]!.display).toContain("gicv2");
        expect(result[0]!.display).toContain("inherited");
        expect(result[1]!.display).toContain("gpio");
        expect(result[1]!.note).toBeUndefined();
        expect(result.every(s => !s.display.includes("no_label_intc"))).toBe(true);
        expect(result.every(s => !s.display.includes("disabled_intc"))).toBe(true);
    });

    test("devicetree_layer — interrupt-parent: no suggestions for other properties", () => {
        const result = devicetree_layer.suggest_values!("interrupts", {
            devicetree: int_dt, data: "{}",
            placement: { node_path: "/soc/spi@7e204000/adc@0", parent_path: "/soc/spi@7e204000", siblings: [] },
        }, []);
        expect(result).toStrictEqual([]);
    });
}
