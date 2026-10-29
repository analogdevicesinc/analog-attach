// The value tokens of `update <path> <prop> <value...>` (see `parse_value`) and the
// inverse, a lib suggestion as the tokens that write it (`format_suggestion`). Shared
// by `update`, the add interview and the value suggestions.

import {
    AttachEnumType,
    PropertyBuilder,
    type CellValue,
    type DTProperty,
    type ResolvedProperty,
    type SuggestedCell,
    type ValueSuggestion,
} from "attach-lib";

import { ALL_MACROS, HEX_LITERAL } from "./value-check";

export type ShapeHint = "flag" | "strings" | "cells" | undefined;

export function shape_hint(definition: ResolvedProperty | undefined): ShapeHint {
    if (definition === undefined) { return undefined; }
    const type = definition.value;
    switch (type._t) {
        case "flag": { return "flag"; }
        case "list": {
            if (Array.isArray(type.item)) {
                return type.item.every(cell => cell._t === "enum" && cell.enum_type === AttachEnumType.STRING) ? "strings" : "cells";
            }
            if (type.item._t === "string" || (type.item._t === "enum" && type.item.enum_type === AttachEnumType.STRING)) { return "strings"; }
            return "cells";
        }
        case "scalar":
        case "matrix": { return "cells"; }
        case "unknown":
        case "node": { return undefined; }
        default: {
            const _x: never = type;
            throw new Error("Exhaustive check failed!");
        }
    }
}

type ResolvedToken = CellValue | { error: string };

function resolve_token(
    token: bigint | string,
    is_label: (name: string) => boolean,
): ResolvedToken {
    if (typeof token === "bigint") {
        return PropertyBuilder.tag_number(token);
    }

    // A hex literal keeps its radix: `0x2a` is written as typed.
    if (HEX_LITERAL.test(token)) {
        return PropertyBuilder.tag_number(BigInt(token), "hex");
    }

    const macro = ALL_MACROS.find(m => m.name === token);
    if (macro !== undefined) {
        return PropertyBuilder.tag_number(BigInt(macro.value));
    }

    const bare = token.startsWith("&") ? token.slice(1) : token;
    if (is_label(bare)) {
        return PropertyBuilder.tag_label(bare);
    }

    return { error: `'${token}' is not a number, a known macro, or a label in the base tree/overlay` };
}

export function build_raw_property(
    raw: string,
    name: string,
    hint: ShapeHint,
    is_label: (name: string) => boolean,
): DTProperty | undefined | { error: string } {
    const parsed = parse_value(raw);

    if (hint === "flag") {
        return { error: `${name} is a flag: \`update <path> ${name}\` sets it, \`delete <path> ${name}\` clears it` };
    }

    if (hint === "strings") {
        const tokens = raw.trim().split(/\s+/).filter(t => t.length > 0);
        if (tokens.length === 0) { return { error: "Value must not be empty" }; }
        return PropertyBuilder.build_string()
            .with_value(tokens.length === 1 ? tokens[0]! : tokens)
            .with_name(name)
            .build();
    }

    if (hint === "cells") {
        return build_cells_from_parsed(parsed, name, is_label);
    }

    // No hint: infer from the tokens.
    if (typeof parsed === "bigint") {
        return PropertyBuilder.build_cell_array()
            .with_tagged_values(PropertyBuilder.tag_number(parsed))
            .with_name(name)
            .build();
    }

    if (typeof parsed === "string") {
        const resolved = resolve_token(parsed, is_label);
        if ("error" in resolved) {
            // Sole string token with no hint → string value
            return PropertyBuilder.build_string()
                .with_value(parsed)
                .with_name(name)
                .build();
        }
        return PropertyBuilder.build_cell_array()
            .with_tagged_values(resolved)
            .with_name(name)
            .build();
    }

    // Array or matrix: try to resolve every token as a cell.
    const flat_tokens = is_matrix_input(parsed)
        ? parsed.flat()
        : parsed;

    let has_cell = false;
    let has_unknown = false;
    for (const token of flat_tokens) {
        if (typeof token === "bigint") { has_cell = true; continue; }
        const resolved = resolve_token(token, is_label);
        if ("error" in resolved) { has_unknown = true; }
        else { has_cell = true; }
    }

    if (has_cell && has_unknown) {
        // Mix of resolved cell tokens and unknown words
        for (const token of flat_tokens) {
            if (typeof token === "string") {
                const resolved = resolve_token(token, is_label);
                if ("error" in resolved) {
                    return resolved;
                }
            }
        }
    }

    if (!has_cell && has_unknown) {
        // All tokens are unknown strings → treat as strings
        if (is_matrix_input(parsed)) {
            // Matrix of pure strings doesn't make sense for cells, but emit as strings
            const all_strings = parsed.flat().filter((t): t is string => typeof t === "string");
            return PropertyBuilder.build_string()
                .with_value(all_strings.length === 1 ? all_strings[0]! : all_strings)
                .with_name(name)
                .build();
        }
        const all_strings = parsed.filter((t): t is string => typeof t === "string");
        return PropertyBuilder.build_string()
            .with_value(all_strings.length === 1 ? all_strings[0]! : all_strings)
            .with_name(name)
            .build();
    }

    // Every token resolves as a cell → cells
    return build_cells_from_parsed(parsed, name, is_label);
}

function build_cells_from_parsed(
    parsed: ParsedInputValue,
    name: string,
    is_label: (name: string) => boolean,
): DTProperty | { error: string } {
    if (typeof parsed === "bigint") {
        return PropertyBuilder.build_cell_array()
            .with_tagged_values(PropertyBuilder.tag_number(parsed))
            .with_name(name)
            .build();
    }

    if (typeof parsed === "string") {
        const resolved = resolve_token(parsed, is_label);
        if ("error" in resolved) { return resolved; }
        return PropertyBuilder.build_cell_array()
            .with_tagged_values(resolved)
            .with_name(name)
            .build();
    }

    if (is_matrix_input(parsed)) {
        const rows: CellValue[][] = [];
        for (const row of parsed) {
            const cells: CellValue[] = [];
            for (const token of row) {
                const resolved = resolve_token(token, is_label);
                if ("error" in resolved) { return resolved; }
                cells.push(resolved);
            }
            rows.push(cells);
        }
        return PropertyBuilder.build_cell_array()
            .with_tagged_values(...(rows as [CellValue[], ...CellValue[][]]))
            .with_name(name)
            .build();
    }

    // Flat array
    const cells: CellValue[] = [];
    for (const token of parsed) {
        const resolved = resolve_token(token, is_label);
        if ("error" in resolved) { return resolved; }
        cells.push(resolved);
    }
    return PropertyBuilder.build_cell_array()
        .with_tagged_values(cells)
        .with_name(name)
        .build();
}

export type ParsedInputValue = SingleInput | ArrayInput | MatrixInput;
type SingleInput = bigint | string;
type ArrayInput = (bigint | string)[];
type MatrixInput = ArrayInput[];

/** A decimal number becomes a bigint; anything else, a hex literal too, stays a token for `resolve_token`. */
function parse_token(token: string): bigint | string {
    return /^-?\d+$/.test(token) ? BigInt(token) : token;
}

export function parse_value(value: string): ParsedInputValue {
    value = value.trim();

    const rows: MatrixInput = value
        .split(',')
        .map(row => row.trim().split(/\s+/).filter(token => token.length > 0).map((element) => parse_token(element)));

    if (rows.length > 1) { return rows; }

    const first = rows[0] ?? [];
    if (first.length === 1) { return first[0]!; }
    return first;
}

export function format_value(rows: SuggestedCell[][]): string {
    return rows
        .map(row => row
            .map(cell => typeof cell === "bigint" ? cell.toString() : ("label" in cell ? cell.label : cell.macro))
            .join(" "))
        .join(",");
}

export function format_suggestion(suggestion: Pick<ValueSuggestion, "rows" | "strings" | "flag">): string {
    if (suggestion.flag !== undefined) { return ""; }
    if (suggestion.strings !== undefined) { return suggestion.strings.join(" "); }
    return format_value(suggestion.rows);
}

function is_matrix_input(value: ParsedInputValue): value is MatrixInput {
    return Array.isArray(value) && value.length > 0 && value.every(row => Array.isArray(row));
}


if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;
    const { DeviceTree, DeviceTreeOverlay } = await import("attach-lib");

    const base_dts = `/dts-v1/;
/ {
    soc {
        gpio: gpio@7e200000 {
            compatible = "brcm,bcm2711-gpio";
            gpio-controller;
            #gpio-cells = <2>;
        };
        spi0: spi@7e204000 {
            compatible = "brcm,bcm2835-spi";
        };
    };
};`;

    const empty_overlay = `/dts-v1/;
/plugin/;

/ {
};
`;

    const base_is_label = (name: string): boolean => {
        const base = DeviceTree.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DeviceTreeOverlay.new_from_string(empty_overlay, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }
        if (base.node_exists(name)) { return true; }
        return overlay.find_node(name) !== undefined;
    };

    test("build_raw_property — macros become numbers", () => {
        const result = build_raw_property("gpio 8 GPIO_ACTIVE_LOW", "cs-gpios", "cells", base_is_label);
        expect(result).toBeDefined();
        expect(result).not.toBeNull();
        expect("error" in result!).toBe(false);
        const property = result as DTProperty;
        expect(property.value).toMatchObject([{
            kind: "array",
            elements: [
                { kind: "label", name: "gpio" },
                { kind: "number", value: 8n },
                { kind: "number", value: 1n },
            ],
        }]);
    });

    test("build_raw_property — base and overlay labels become &label", () => {
        const result = build_raw_property("gpio", "interrupt-parent", "cells", base_is_label);
        expect(result).toBeDefined();
        expect("error" in result!).toBe(false);
        const property = result as DTProperty;
        expect(property.value).toMatchObject([{
            kind: "array",
            elements: [{ kind: "label", name: "gpio" }],
        }]);
    });

    test("build_raw_property — &gpio is accepted", () => {
        const result = build_raw_property("&gpio", "interrupt-parent", "cells", base_is_label);
        expect(result).toBeDefined();
        expect("error" in result!).toBe(false);
        const property = result as DTProperty;
        expect(property.value).toMatchObject([{
            kind: "array",
            elements: [{ kind: "label", name: "gpio" }],
        }]);
    });

    test("build_raw_property — unknown word gives an error", () => {
        const result = build_raw_property("bogus 1", "foo", "cells", base_is_label);
        expect(result).toBeDefined();
        expect(result).not.toBeNull();
        expect("error" in result!).toBe(true);
        expect((result as { error: string }).error).toContain("bogus");
    });

    test("build_raw_property — strings hint keeps 'gpio' as a string and adi,ad7124-8 intact", () => {
        const result = build_raw_property("adi,ad7124-8", "compatible", "strings", base_is_label);
        expect(result).toBeDefined();
        expect("error" in result!).toBe(false);
        const property = result as DTProperty;
        expect(property.value).toMatchObject([{ kind: "string", value: "adi,ad7124-8" }]);
    });

    test("build_raw_property — with no hint, 'okay' becomes a string", () => {
        const result = build_raw_property("okay", "status", undefined, base_is_label);
        expect(result).toBeDefined();
        expect("error" in result!).toBe(false);
        const property = result as DTProperty;
        expect(property.value).toMatchObject([{ kind: "string", value: "okay" }]);
    });

    test("build_raw_property — flag hint rejects any value", () => {
        const result = build_raw_property("true", "wakeup-source", "flag", base_is_label);
        expect(result).toBeDefined();
        expect("error" in result!).toBe(true);
        expect((result as { error: string }).error).toContain("is a flag");
    });

    test("build_raw_property — with no hint, true and false are strings", () => {
        const result_true = build_raw_property("true", "my-prop", undefined, base_is_label);
        expect(result_true).toBeDefined();
        expect("error" in result_true!).toBe(false);
        expect((result_true as DTProperty).value).toMatchObject([{ kind: "string", value: "true" }]);

        const result_false = build_raw_property("false", "my-prop", undefined, base_is_label);
        expect(result_false).toBeDefined();
        expect("error" in result_false!).toBe(false);
        expect((result_false as DTProperty).value).toMatchObject([{ kind: "string", value: "false" }]);
    });

    test("build_raw_property — multi-row cells matrix", () => {
        const result = build_raw_property("gpio 8 GPIO_ACTIVE_LOW,gpio 7 GPIO_ACTIVE_LOW", "cs-gpios", "cells", base_is_label);
        expect(result).toBeDefined();
        expect("error" in result!).toBe(false);
        const property = result as DTProperty;
        expect(property.value).toMatchObject([
            { kind: "array", elements: [{ kind: "label", name: "gpio" }, { kind: "number", value: 8n }, { kind: "number", value: 1n }] },
            { kind: "array", elements: [{ kind: "label", name: "gpio" }, { kind: "number", value: 7n }, { kind: "number", value: 1n }] },
        ]);
    });

    const printed = (raw: string, hint?: ShapeHint): string => {
        const result = build_raw_property(raw, "reg", hint, base_is_label);
        if (result === undefined || "error" in result) { throw new TypeError(JSON.stringify(result)); }
        return PropertyBuilder.to_string(result).trim();
    };

    test("build_raw_property — hex numbers are taken and print in hex, decimal ones in decimal", () => {
        expect(printed("0x2a", "cells")).toBe("reg = <0x2a>;");
        expect(printed("0X2A", "cells")).toBe("reg = <0x2a>;");
        expect(printed("42", "cells")).toBe("reg = <42>;");
        expect(printed("0x10 16, 0x20 32", "cells")).toBe("reg = <0x10 16>, <0x20 32>;");
        expect(printed("gpio 0x1c GPIO_ACTIVE_LOW", "cells")).toBe("reg = <&gpio 0x1c 1>;");
        // With no binding hint a lone hex literal is a number, not the string "0x2a".
        expect(printed("0x2a")).toBe("reg = <0x2a>;");
        expect(printed("0x10 0x20")).toBe("reg = <0x10 0x20>;");
    });

    test("build_raw_property — a malformed hex literal is a word, refused in cells", () => {
        expect(build_raw_property("0x2g", "reg", "cells", base_is_label)).toEqual({ error: "'0x2g' is not a number, a known macro, or a label in the base tree/overlay" });
    });

    test("parse_value - scalars, flat arrays, and comma-separated matrices", () => {
        expect(parse_value("0")).toBe(0n);
        expect(parse_value("some_label")).toBe("some_label");
        expect(parse_value("true")).toBe("true");
        expect(parse_value("false")).toBe("false");
        expect(parse_value("a b c")).toEqual(["a", "b", "c"]);
        expect(parse_value("1 2")).toEqual([1n, 2n]);
        expect(parse_value("1 2,3 4")).toEqual([[1n, 2n], [3n, 4n]]);
        expect(parse_value("0,1,2")).toEqual([[0n], [1n], [2n]]);
    });

    test("format_value - is the inverse of parse_value for suggestion rows", () => {
        const cases: [SuggestedCell[][], string][] = [
            [[[0n]], "0"],
            [[[{ label: "gpio" }]], "gpio"],
            [[[19n, { macro: "IRQ_TYPE_EDGE_FALLING" }]], "19 IRQ_TYPE_EDGE_FALLING"],
            [[[{ label: "gpio" }, 8n, { macro: "GPIO_ACTIVE_LOW" }], [{ label: "gpio" }, 7n, { macro: "GPIO_ACTIVE_LOW" }]], "gpio 8 GPIO_ACTIVE_LOW,gpio 7 GPIO_ACTIVE_LOW"],
        ];
        for (const [rows, text] of cases) {
            expect(format_value(rows)).toBe(text);
            const expected = rows.map(row => row.map(cell => typeof cell === "bigint" ? cell : ("label" in cell ? cell.label : cell.macro)));
            const parsed = parse_value(text);
            expect(parsed).toEqual(expected.length > 1 ? expected : (expected[0]!.length > 1 ? expected[0] : expected[0]![0]));
        }
    });

    test("format_suggestion - string and flag suggestions build the right value text", () => {
        const strings = build_raw_property(format_suggestion({ rows: [], strings: ["mclk"] }), "clock-names", "strings", () => false) as DTProperty;
        expect(strings.value).toMatchObject([{ kind: "string", value: "mclk" }]);
        expect(format_suggestion({ rows: [], flag: true })).toBe("");
        expect(format_suggestion({ rows: [[19n, { macro: "IRQ_TYPE_EDGE_RISING" }]] })).toBe("19 IRQ_TYPE_EDGE_RISING");
    });

}
