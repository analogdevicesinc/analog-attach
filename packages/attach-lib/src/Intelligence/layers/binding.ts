import { ResolvedProperty } from "../../Bindings/ParsedBinding.js";
import { AttachEnumType, list_cell, type Cell } from "../../Bindings/StructuralTypes.js";
import { DeviceTree } from "../../Devicetree/index.js";
import { insert_known_structures } from "../known_properties.js";
import { IntelligenceLayer, PropertyContext, ValueSuggestion } from "./types.js";

type PinnedValue = Pick<ValueSuggestion, "rows" | "strings" | "flag">;

function enum_value(value: unknown, enum_type: AttachEnumType): PinnedValue | undefined {
    switch (enum_type) {
        case AttachEnumType.STRING: { return { rows: [], strings: [String(value)] }; }
        case AttachEnumType.NUMBER: {
            return typeof value === "bigint" || typeof value === "number" ? { rows: [[BigInt(value)]] } : undefined;
        }
        // Phandle and macro enums are filled in from the devicetree / known
        // structures, so a single option there is not a binding constraint.
        case AttachEnumType.PHANDLE:
        case AttachEnumType.MACRO: { return; }
    }
}

/**
 * The value a binding pins a property to: the only option of a one-value enum
 * (a `const` is one), or `true` for a required flag. Undefined when the
 * binding leaves a choice.
 */
export function pinned_value(definition: ResolvedProperty["value"], required: boolean): PinnedValue | undefined {
    switch (definition._t) {
        case "flag": { return required ? { rows: [], flag: true } : undefined; }
        case "scalar": {
            const cell = definition.cell;
            return cell._t === "enum" && cell.enum.length === 1 ? enum_value(cell.enum[0], cell.enum_type) : undefined;
        }
        case "list": {
            const cell = list_cell(definition);
            if (cell?._t !== "enum" || cell.enum.length !== 1 || definition.minItems !== 1 || definition.maxItems !== 1) { return; }
            return enum_value(cell.enum[0], cell.enum_type);
        }
        default: { return; }
    }
}

type EnumOption = PinnedValue & { is_default?: true };

/**
 * The options of a single-value enum, each a whole value, the binding's
 * default first. Empty when the property isn't one: no option of a fixed-size
 * enum array is a whole value.
 */
export function enum_options(definition: ResolvedProperty["value"]): EnumOption[] {
    let options: PinnedValue[];
    let fallback: unknown;
    switch (definition._t) {
        case "scalar": {
            if (definition.cell._t !== "enum") { return []; }
            const { enum: values, enum_type } = definition.cell;
            options = values.flatMap(v => enum_value(v, enum_type) ?? []);
            fallback = definition.default;
            break;
        }
        case "list": {
            const cell = list_cell(definition);
            if (cell?._t !== "enum" || (definition.minItems ?? 0) > 1) { return []; }
            options = cell.enum.flatMap(v => enum_value(v, cell.enum_type) ?? []);
            fallback = cell.default;
            break;
        }
        default: { return []; }
    }
    const key = typeof fallback === "string" ? `"${fallback}"` : String(fallback);
    const index = fallback === undefined ? -1 : options.findIndex(o => describe_pinned(o) === key);
    if (index === -1) { return options; }
    return [{ ...options[index]!, is_default: true }, ...options.slice(0, index), ...options.slice(index + 1)];
}

function describe_pinned(pinned: PinnedValue): string {
    if (pinned.flag !== undefined) { return String(pinned.flag); }
    if (pinned.strings !== undefined) { return pinned.strings.map(s => `"${s}"`).join(", "); }
    return pinned.rows.map(row => row.map(String).join(" ")).join(", ");
}

function suggest_from_binding(property: string, context: PropertyContext): ValueSuggestion[] {
    const definition = context.binding?.properties.find(p => p.key === property);
    if (definition === undefined) { return []; }
    const required = context.binding!.required_properties.includes(property);
    const pinned = pinned_value(definition.value, required);
    if (pinned === undefined) {
        return enum_options(definition.value).map(({ is_default, ...option }) => ({
            ...option,
            display: is_default ? `${describe_pinned(option)} — the binding's default` : describe_pinned(option),
            source: "binding",
        }));
    }
    const why = pinned.flag === undefined
        ? `the only value the binding allows${required ? " (required)" : ""}`
        : "a flag the binding requires";
    return [{ ...pinned, display: `${describe_pinned(pinned)} — ${why}`, source: "binding" }];
}

// Layer 1: knowledge derived from the binding alone (well-known property
// shapes, the values the binding pins, and the options of an enum).
export const binding_layer: IntelligenceLayer = {
    name: "binding",
    refine_properties(properties) {
        return insert_known_structures(properties);
    },
    suggest_values(property, context, lower) {
        return [...lower, ...suggest_from_binding(property, context)];
    },
};

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    const devicetree = DeviceTree.new_from_string("/dts-v1/;\n/ { };");
    if (typeof devicetree === "string") { throw new TypeError(devicetree); }
    const enum_cell = (values: (bigint | string)[], enum_type: AttachEnumType, default_value?: string): Cell =>
        ({ _t: "enum", enum: values, enum_type, ...(default_value === undefined ? {} : { default: default_value }) });
    const list_of = (item: Cell, minItems: number, maxItems: number): ResolvedProperty["value"] => ({ _t: "list", item, minItems, maxItems });
    const scalar_of = (cell: Cell, default_value?: bigint): ResolvedProperty["value"] => ({ _t: "scalar", cell, ...(default_value === undefined ? {} : { default: default_value }) });
    const binding: PropertyContext["binding"] = {
        required_properties: ["clock-names", "spi-cpol", "vref-supply"],
        properties: [
            { key: "clock-names", value: list_of(enum_cell(["mclk"], AttachEnumType.STRING), 1, 1) },
            { key: "spi-cpol", value: { _t: "flag" } },
            { key: "spi-lsb-first", value: { _t: "flag" } },
            { key: "adi,mode", value: scalar_of(enum_cell([3n], AttachEnumType.NUMBER), 3n) },
            { key: "adi,lines", value: scalar_of(enum_cell([1n, 2n], AttachEnumType.NUMBER)) },
            { key: "adi,gain", value: scalar_of(enum_cell([1n, 2n, 4n], AttachEnumType.NUMBER), 4n) },
            { key: "adi,mode-name", value: list_of(enum_cell(["fast", "slow"], AttachEnumType.STRING, "slow"), 1, 1) },
            { key: "adi,widths", value: list_of(enum_cell([1n, 4n], AttachEnumType.NUMBER), 1, 4) },
            { key: "adi,pair", value: list_of(enum_cell(["a", "b"], AttachEnumType.STRING), 2, 2) },
            { key: "interrupt-parent", value: list_of(enum_cell(["gpio"], AttachEnumType.PHANDLE), 1, 1) },
            { key: "vref-supply", value: { _t: "unknown" } },
        ],
    };
    const values = (property: string) => binding_layer.suggest_values!(property, { devicetree, data: "{}", binding }, []);

    test("binding_layer — suggests values the binding pins", () => {
        expect(values("clock-names")).toStrictEqual([
            { rows: [], strings: ["mclk"], display: `"mclk" — the only value the binding allows (required)`, source: "binding" },
        ]);
        expect(values("spi-cpol")).toStrictEqual([
            { rows: [], flag: true, display: "true — a flag the binding requires", source: "binding" },
        ]);
        expect(values("adi,mode")).toStrictEqual([
            { rows: [[3n]], display: "3 — the only value the binding allows", source: "binding" },
        ]);
    });

    test("binding_layer — every option of an enum, the binding's default first", () => {
        expect(values("adi,lines")).toStrictEqual([
            { rows: [[1n]], display: "1", source: "binding" },
            { rows: [[2n]], display: "2", source: "binding" },
        ]);
        expect(values("adi,gain")).toStrictEqual([
            { rows: [[4n]], display: "4 — the binding's default", source: "binding" },
            { rows: [[1n]], display: "1", source: "binding" },
            { rows: [[2n]], display: "2", source: "binding" },
        ]);
        expect(values("adi,mode-name").map(s => [s.strings, s.display])).toStrictEqual([
            [["slow"], `"slow" — the binding's default`],
            [["fast"], `"fast"`],
        ]);
        expect(values("adi,widths").map(s => s.rows)).toStrictEqual([[[1n]], [[4n]]]);
    });

    test("binding_layer — no option of a fixed-size enum array is a whole value", () => {
        expect(values("adi,pair")).toStrictEqual([]);
    });

    test("binding_layer — no suggestion when the binding leaves an open choice", () => {
        expect(values("spi-lsb-first")).toStrictEqual([]);    // optional flag
        expect(values("interrupt-parent")).toStrictEqual([]); // filled from the devicetree
        expect(values("vref-supply")).toStrictEqual([]);      // external hardware
        expect(binding_layer.suggest_values!("clock-names", { devicetree, data: "{}" }, [])).toStrictEqual([]);
    });
}
