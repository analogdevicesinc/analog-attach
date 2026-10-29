import type { DeviceTree, DeviceTreeOverlay, ValueSuggestion } from "attach-lib";

import type { Bindings, Workfile } from "./config/workspace";
import type { MissingProperty } from "./protocol/types";
import { resolve_target_binding, value_suggestions, type TargetBinding } from "./commands/list/suggest";
import { format_missing } from "./commands/read/command";
import { node_missing_required, property_details } from "./node-state";

// The required properties a new node still lacks, after `add` or after
// `update <path> <child>`: listed in text mode, and described for an AI
// under --json. Asking for them on a terminal (the interview, and the values
// filled in before it) is in missing-interview.ts.

/** The node to complete: `identifier` is how commands name it (a label, `adc/channel@0`), `path` its absolute path. */
export interface NewNode {
    workfile: Workfile;
    base: DeviceTree;
    bindings: Bindings;
    identifier: string;
    path: string;
}

/** The required properties the node still lacks, in the order to set them. */
export async function missing_required_of(node: NewNode): Promise<string[]> {
    const { binding } = await resolve_target_binding(node.identifier, node.workfile.tree, node.base, { ok: true, value: node.bindings });
    return "error" in binding ? [] : node_missing_required(binding, node.workfile.tree, node.path);
}

/** The missing properties with what the binding says about them, for an AI to ask itself. */
export async function describe_missing(node: NewNode, missing: string[]): Promise<MissingProperty[]> {
    const { workfile, base, bindings, identifier } = node;
    const target = await resolve_target_binding(identifier, workfile.tree, base, { ok: true, value: bindings });
    return missing.map(property => {
        const { info, suggestions, others } = property_details(target, workfile.tree, base, identifier, property);
        return {
            property,
            ...(info?.description === undefined ? {} : { description: info.description }),
            suggestions: [...suggestions, ...others],
        };
    });
}

/** How a command lists what is still missing: the names, then how to set them; nothing when complete. */
export function missing_lines(identifier: string, missing: string[]): string[] {
    if (missing.length === 0) { return []; }
    return [...format_missing(missing), `Set them with: update ${identifier} <property> <value>`];
}

/** A value as a line shows it: `<1>`, `<0x2a>` (`hex`), `"adi,x"`. */
export function show_value(suggestion: Pick<ValueSuggestion, "rows" | "strings">, hex = false): string {
    if (suggestion.strings !== undefined) { return suggestion.strings.map(text => `"${text}"`).join(", "); }
    const cell = (value: ValueSuggestion["rows"][number][number]): string => {
        if (typeof value === "bigint") { return hex ? `0x${value.toString(16)}` : value.toString(); }
        return "label" in value ? `&${value.label}` : value.macro;
    };
    return suggestion.rows.map(row => `<${row.map(element => cell(element)).join(" ")}>`).join(", ");
}

/**
 * The value the binding pins `property` to, when it pins one: the binding
 * layer offers exactly one value then (a `const`, a one-option enum, a flag the
 * narrowed binding requires). A binding that leaves a choice offers none or
 * several; its `default:` is one of them, never the only one.
 */
export function pinned_value_of(
    target: TargetBinding,
    overlay: DeviceTreeOverlay,
    base: DeviceTree,
    identifier: string,
    property: string,
): ValueSuggestion | undefined {
    const result = value_suggestions(target, overlay, base, identifier, property);
    if (!result.ok) { return; }
    const offered = result.values.filter(value => value.source === "binding");
    const only = offered.length === 1 ? offered[0] : undefined;
    return only?.flag === false ? undefined : only;
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;
    type NodeBinding = import("./binding-resolution").NodeBinding;
    type AttachType = import("attach-lib").AttachType;
    type AttachEnumType = import("attach-lib").AttachEnumType;

    test("missing_lines — the missing list with how to set them, nothing when complete", () => {
        expect(missing_lines("ad7124_8", ["interrupt-parent", "interrupts"])).toEqual([
            "Missing required: interrupt-parent, interrupts",
            "Set them with: update ad7124_8 <property> <value>",
        ]);
        expect(missing_lines("adc/channel@0", ["diff-channels"])).toEqual([
            "Missing required: diff-channels",
            "Set them with: update adc/channel@0 <property> <value>",
        ]);
        expect(missing_lines("ad7124_8", [])).toEqual([]);
    });

    const { DeviceTree: DT, DeviceTreeOverlay: DTO, AttachEnumType: Kind } = await import("attach-lib");
    const { resolve_write_target } = await import("./utilities");

    // A node `adc@0` under spi0 whose binding is made of `properties` and requires `required`.
    const pinned_case = (properties: NodeBinding["properties"], required: string[]) => {
        const base = DT.new_from_string(`/dts-v1/;\n/ {\n\tspi0: spi@7e204000 {\n\t};\n};`);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DTO.new_from_string(`/dts-v1/;\n/plugin/;\n\n&spi0 {\n\tadc@0 {\n\t\tcompatible = "adi,ad5592r";\n\t\treg = <0>;\n\t};\n};`, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }
        const binding: NodeBinding = {
            properties,
            required_properties: required,
            child_nodes: [],
            property_patterns: [],
            binding_path: "/linux/iio/dac/adi,ad5592r.yaml",
            origin: { kind: "compatible", compatible: "adi,ad5592r" },
            narrow_and_populate: () => ({ properties, required_properties: required, errors: [] }),
        };
        const target: TargetBinding = { target: resolve_write_target("spi0/adc@0", overlay, base), binding };
        return (property: string) => pinned_value_of(target, overlay, base, "spi0/adc@0", property);
    };
    const one_of = (values: (bigint | string)[], enum_type: AttachEnumType = Kind.NUMBER, default_value?: string): AttachType =>
        ({ _t: "scalar", cell: { _t: "enum", enum: values, enum_type, ...(default_value === undefined ? {} : { default: default_value }) } });

    test("pinned_value_of — a const, a one-option enum and a required flag are pinned", () => {
        const pinned = pinned_case([
            { key: "#address-cells", value: one_of([1n]) },
            { key: "adi,mode", value: one_of(["only"], Kind.STRING) },
            { key: "spi-cpol", value: { _t: "flag" } },
        ], ["#address-cells", "adi,mode", "spi-cpol"]);
        expect(pinned("#address-cells")).toMatchObject({ rows: [[1n]], source: "binding" });
        expect(pinned("adi,mode")).toMatchObject({ strings: ["only"] });
        expect(pinned("spi-cpol")).toMatchObject({ flag: true });
    });

    test("pinned_value_of — a choice, a default and an optional flag are not pinned", () => {
        const pinned = pinned_case([
            { key: "adi,mode", value: one_of([0n, 1n]) },
            { key: "adi,rate", value: { _t: "scalar", cell: { _t: "number", signed: false }, default: 8n } as unknown as AttachType },
            { key: "spi-cpha", value: { _t: "flag" } },
            { key: "adi,names", value: one_of(["a", "b"], Kind.STRING, "a") },
        ], ["adi,mode", "adi,rate", "adi,names"]);
        // Two options: several suggestions, the first being the binding's default for the name list.
        expect(pinned("adi,mode")).toBeUndefined();
        expect(pinned("adi,rate")).toBeUndefined();
        expect(pinned("spi-cpha")).toBeUndefined();
        expect(pinned("adi,names")).toBeUndefined();
        expect(pinned("unknown")).toBeUndefined();
    });

    test("pinned_value_of — a property no layer has a value for is not pinned", () => {
        expect(pinned_case([{ key: "reg", value: { _t: "unknown" } }], ["reg"])("reg")).toBeUndefined();
    });

    test("show_value — cells, hex on request, macros, labels, strings", () => {
        expect(show_value({ rows: [[1n]] })).toBe("<1>");
        expect(show_value({ rows: [[42n]] }, true)).toBe("<0x2a>");
        expect(show_value({ rows: [[{ label: "gpio" }, 5n, { macro: "GPIO_ACTIVE_LOW" }], [1n]] })).toBe("<&gpio 5 GPIO_ACTIVE_LOW>, <1>");
        expect(show_value({ rows: [], strings: ["a", "b"] })).toBe('"a", "b"');
    });
}
