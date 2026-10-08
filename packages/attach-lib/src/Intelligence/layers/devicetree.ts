import { DeviceTree, DTNode, is_dt_flag } from "../../Devicetree/index.js";
import { is_clock, is_interrupt_controller, is_regulator } from "../predicates.js";
import { cell_extract_first_value, query_devicetree } from "../query.js";
import { parent_path_string, suggest_parents } from "../parents.js";
import { effective_interrupt_parent, base_lookup } from "../interrupt_parent.js";
import { IntelligenceLayer, ValueSuggestion } from "./types.js";

function string_property(node: DTNode, name: string): string | undefined {
    const property = node.properties.find(p => p.name === name);
    if (property === undefined || is_dt_flag(property.value)) { return; }
    const first = property.value[0];
    return first?.kind === "string" ? first.value : undefined;
}

function number_property(node: DTNode, name: string): bigint | undefined {
    const property = node.properties.find(p => p.name === name);
    if (property === undefined || is_dt_flag(property.value)) { return; }
    const value = cell_extract_first_value(property);
    return typeof value === "bigint" ? value : undefined;
}

function format_frequency(hz: bigint): string {
    if (hz % 1_000_000n === 0n) { return `${hz / 1_000_000n} MHz`; }
    if (hz % 1000n === 0n) { return `${hz / 1000n} kHz`; }
    return `${hz} Hz`;
}

function format_voltage(microvolt: bigint): string {
    return `${Number(microvolt) / 1_000_000} V`;
}

/** Labelled, enabled nodes of the base tree matching `predicate`, in tree order. */
function providers(devicetree: DeviceTree, predicate: (node: DTNode) => boolean): { label: string, node: DTNode }[] {
    return devicetree.as_stream()
        .filter(node => predicate(node))
        .toArray()
        .flatMap(([node]) => {
            const label = node.labels.at(-1);
            return label === undefined || string_property(node, "status") === "disabled" ? [] : [{ label, node }];
        });
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

    const controllers = providers(devicetree, is_interrupt_controller);
    if (controllers.length === 0) { return []; }

    const inherited = node_path !== undefined
        ? effective_interrupt_parent(base_lookup(devicetree), node_path, devicetree)
        : undefined;

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
            note: "only right if the device's interrupt line is wired to this controller",
        });
    }

    return suggestions;
}

/**
 * Clock and supply providers the base tree already has. The board can't say
 * which one feeds the device (it is external hardware), so each candidate is
 * only valid if it is actually wired to the device.
 */
function suggest_providers(property: string, devicetree: DeviceTree): ValueSuggestion[] {
    if (property === "clocks") {
        return providers(devicetree, is_clock).map(({ label, node }) => ({
            rows: [[{ label }]],
            display: `${label} — ${describe_clock(node)}`,
            source: "devicetree",
            note: "from the context devicetree: only right if this clock is actually wired to the device",
        }));
    }
    if (property.endsWith("-supply")) {
        return providers(devicetree, is_regulator).map(({ label, node }) => ({
            rows: [[{ label }]],
            display: `${label} — ${describe_regulator(node)}`,
            source: "devicetree",
            note: "from the context devicetree: only right if this supply actually powers the device",
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

// Layer 2: knowledge derived from the base device tree (controllers, buses, phandles).
export const devicetree_layer: IntelligenceLayer = {
    name: "devicetree",
    refine_properties(properties, context) {
        let inherited_label: string | undefined;
        if (context.placement?.node_path !== undefined) {
            inherited_label = effective_interrupt_parent(base_lookup(context.devicetree), context.placement.node_path, context.devicetree)?.label;
        } else if (context.parent_name !== undefined) {
            const path_from_name = context.devicetree.as_stream()
                .filter(node => {
                    const full = node.unit_addr !== undefined ? `${node.name}@${node.unit_addr}` : node.name;
                    return full === context.parent_name;
                })
                .toArray()[0]?.[1]?.path;
            if (path_from_name !== undefined) {
                inherited_label = effective_interrupt_parent(base_lookup(context.devicetree), `${path_from_name}/child`, context.devicetree)?.label;
            }
        }
        return query_devicetree(context.devicetree, properties, context.data, context.parent_name, inherited_label);
    },
    suggest_values(property, context, lower) {
        return [
            ...lower,
            ...suggest_unit_address_reg(property, context.placement?.node_path),
            ...suggest_providers(property, context.devicetree),
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
            note: "from the context devicetree: only right if this clock is actually wired to the device",
        }]);
    });

    test("devicetree_layer — *-supply: labelled fixed regulators with their voltage", () => {
        expect(values("vref-supply").map(s => s.display)).toStrictEqual([`vdd_3v3_reg — regulator "3v3", 3.3 V, always on`]);
        expect(values("vref-supply")[0]?.note).toBe("from the context devicetree: only right if this supply actually powers the device");
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
        expect(result.length).toBeGreaterThanOrEqual(2);
        expect(result[0]!.display).toContain("gicv2");
        expect(result[0]!.display).toContain("inherited");
        expect(result[1]!.display).toContain("gpio");
        expect(result[1]!.note).toContain("only right if");
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
