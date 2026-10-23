import { ParsedBinding, ResolvedProperty } from "../../Bindings/ParsedBinding.js";
import { DeviceTree } from "../../Devicetree/index.js";
import { binding_layer } from "./binding.js";
import { devicetree_layer } from "./devicetree.js";
import { insert_known_structures } from "../known_properties.js";
import { query_devicetree } from "../query.js";
import { IntelligenceLayer, PlacementSuggestion, PropertyContext, ValueSuggestion } from "./types.js";

// An ordered set of intelligence layers, least system-specific first. Every
// operation folds over the layers in order, handing each one the result of
// the layers below it.
export class IntelligenceStack {

    private constructor(public readonly layers: readonly IntelligenceLayer[]) {
    }

    public static new(layers: readonly IntelligenceLayer[]): IntelligenceStack {
        return new IntelligenceStack(layers);
    }

    public static default(): IntelligenceStack {
        return new IntelligenceStack([binding_layer, devicetree_layer]);
    }

    public with(...layers: IntelligenceLayer[]): IntelligenceStack {
        return new IntelligenceStack([...this.layers, ...layers]);
    }

    private fold<T>(initial: T, pick: (layer: IntelligenceLayer) => ((value: T) => T) | undefined): T {
        let result = initial;
        for (const layer of this.layers) {
            const step = pick(layer);
            if (step !== undefined) { result = step(result); }
        }
        return result;
    }

    public refine_properties(properties: ResolvedProperty[], context: PropertyContext): ResolvedProperty[] {
        return this.fold(properties, layer => layer.refine_properties && (refined => layer.refine_properties!(refined, context)));
    }

    public suggest_values(property: string, context: PropertyContext): ValueSuggestion[] {
        return this.fold([] as ValueSuggestion[], layer => layer.suggest_values && (lower => layer.suggest_values!(property, context, lower)));
    }

    public suggest_placement(binding: ParsedBinding, devicetree: DeviceTree): PlacementSuggestion[] {
        return this.fold([] as PlacementSuggestion[], layer => layer.suggest_placement && (lower => layer.suggest_placement!(binding, devicetree, lower)));
    }
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    const dts = (source: string) => {
        const dt = DeviceTree.new_from_string(source);
        if (typeof dt === "string") { throw new TypeError(dt); }
        return dt;
    };

    const devicetree = dts(`/dts-v1/;
/ {
    gpio: gpio@7e200000 {
        compatible = "brcm,bcm2711-gpio";
        gpio-controller;
        #gpio-cells = <2>;
        interrupt-controller;
        #interrupt-cells = <2>;
    };
    vdd: regulator {
        compatible = "regulator-fixed";
    };
};`);

    const properties: ResolvedProperty[] = [
        { key: "reg", value: { _t: "list", item: { _t: "any" }, minItems: 1, maxItems: 1 } },
        { key: "spi-cpol", value: { _t: "unknown" } },
        { key: "sample-rate-hz", value: { _t: "list", item: { _t: "any" }, minItems: 1, maxItems: 1 } },
        { key: "interrupt-parent", value: { _t: "unknown" } },
        { key: "interrupts", value: { _t: "list", item: { _t: "any" }, minItems: 1, maxItems: 1 } },
        { key: "reset-gpios", value: { _t: "unknown" } },
        { key: "vdd-supply", value: { _t: "unknown" } },
    ];

    test("IntelligenceStack.default — matches the historical insert_known_structures(query_devicetree(...))", () => {
        const data = JSON.stringify({ "interrupt-parent": "gpio", "reset-gpios": ["gpio"] });
        const expected = insert_known_structures(query_devicetree(devicetree, properties, data));
        const actual = IntelligenceStack.default().refine_properties(properties, { devicetree, data });
        expect(actual).toStrictEqual(expected);
    });

    test("IntelligenceStack — higher layers receive lower layers' results", () => {
        const seen: ValueSuggestion[][] = [];
        const low: IntelligenceLayer = {
            name: "low",
            suggest_values: (_property, _context, lower) => [...lower, { rows: [[1n]], display: "1", source: "low" }],
        };
        const high: IntelligenceLayer = {
            name: "high",
            suggest_values: (_property, _context, lower) => { seen.push(lower); return [...lower, { rows: [[2n]], display: "2", source: "high" }]; },
        };
        const result = IntelligenceStack.new([low]).with(high).suggest_values("reg", { devicetree, data: "{}" });
        expect(seen).toStrictEqual([[{ rows: [[1n]], display: "1", source: "low" }]]);
        expect(result.map(s => s.source)).toStrictEqual(["low", "high"]);
    });

    test("IntelligenceStack — properties with no matching providers get empty suggestions", () => {
        const result = IntelligenceStack.default().suggest_values("reg", { devicetree, data: "{}" });
        expect(result).toStrictEqual([]);
    });
}
