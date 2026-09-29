import { Command } from "commander";
import {
    Attach,
    AttachEnumType,
    IntelligenceStack,
    board_layer,
    parse_board_description,
    DeviceTree,
    DeviceTreeOverlay,
    PropertyBuilder,
    INTERRUPT_MACROS,
    GPIO_MACROS,
    type CellValue,
    type DTNode,
    type DTProperty,
    type DTLabel,
    type DTPath,
    type FoundNodeResult,
    type ResolvedProperty,
    type SuggestedCell,
} from "attach-lib";
import * as fs from "node:fs";

import type { LocalContext } from "../../context";
import { resolve_config } from "../../resolve-config";
import { load_trees, parse_property_reference, resolve_write_target } from "../../utilities";
import { resolve_node_binding } from "../../binding-resolution";
import { respond, respond_fail, input_error, diagnostic } from "../../protocol/output";

export type ShapeHint = "flag" | "strings" | "cells" | undefined;

const ALL_MACROS = [...INTERRUPT_MACROS, ...GPIO_MACROS];

export function shape_hint(definition: ResolvedProperty | undefined): ShapeHint {
    if (definition === undefined) { return undefined; }
    switch (definition.value._t) {
        case "boolean": { return "flag"; }
        case "string_array": { return "strings"; }
        case "enum_array":
        case "fixed_index": {
            if (definition.value._t === "enum_array" && definition.value.enum_type === AttachEnumType.STRING) { return "strings"; }
            if (definition.value._t === "fixed_index" && definition.value.prefixItems.every(index => index._t === "enum" && index.enum_type === AttachEnumType.STRING)) { return "strings"; }
            return "cells";
        }
        case "integer":
        case "enum_integer":
        case "const":
        case "number_array":
        case "array":
        case "matrix": { return "cells"; }
        case "generic":
        case "object": { return undefined; }
        default: {
            const _x: never = definition.value;
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

    if (hint === "flag" || typeof parsed === "boolean") {
        if (typeof parsed === "boolean") {
            return parsed
                ? PropertyBuilder.build_flag().set_flag().with_name(name).build()
                : undefined;
        }
        const lower = raw.trim().toLowerCase();
        if (lower === "true") {
            return PropertyBuilder.build_flag().set_flag().with_name(name).build();
        }
        if (lower === "false") {
            return undefined;
        }
        return { error: `Property ${name} is a flag; set it with 'true' or remove it with 'false'` };
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
    if (typeof parsed === "boolean") {
        return { error: `Cannot write a boolean as cells for ${name}` };
    }

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

export function build_update_command(context_: LocalContext): Command {
    return new Command("update")
        .description("Update (upsert) a property value on an overlay-added node or a base-tree node (writes into an overlay fragment; the base tree is never modified)")
        .requiredOption("--with <value>", "Value to set (raw string, parsed by the tool)")
        .argument("[path...]", "Path to property: node path segments followed by property name")
        .action(async (path: string[], options) => {
            const withValue: string = options['with'];

            const reference = parse_property_reference(path);

            if (reference === undefined) {
                const message = "Path must include at least a node and a property name";
                if (context_.json) { input_error(message); return; }
                console.log(message);
                return;
            }

            const resolved = resolve_config(context_, ["overlay", "context", "linux", "dtSchema"]);
            if (resolved === undefined) { return; }
            const { overlay: input, context, linux, dtSchema } = resolved.values;

            const trees = load_trees(context_, context, input, resolved.parsed.context);
            if (trees === undefined) { return; }
            const { base_dt, overlay } = trees;

            const { node_identifier, property_name } = reference;
            const { target_reference, found, is_base_target, binding_node, binding_parent, parent_name } =
                resolve_write_target(node_identifier, overlay, base_dt);

            if (found === undefined && !is_base_target) {
                if (context_.json) {
                    respond_fail({ ok: false, message: `Node ${node_identifier} not found`, severity: "error" });
                } else {
                    console.log(`Couldn't find ${node_identifier} in ${input}`);
                }
                return;
            }

            let property_definition: ResolvedProperty | undefined;

            if (binding_node !== undefined) {
                const binding = await resolve_node_binding(binding_node, binding_parent, parent_name, base_dt, linux, dtSchema, context_.json);

                if ('error' in binding) {
                    diagnostic(`Property ${property_name} written without schema validation: ${binding.error}`);
                } else {
                    const result = binding.narrow_and_populate(binding_node);
                    if (result === undefined) {
                        diagnostic(`Property ${property_name} written without schema validation: failed to narrow binding`);
                    } else {
                        property_definition = result.properties.find(entry => entry.key === property_name);
                        if (property_definition === undefined) {
                            const origin_desc = binding.origin.kind === "compatible"
                                ? `${binding.origin.compatible} binding`
                                : `pattern "${binding.origin.pattern}" of ${binding.origin.parent_compatible}`;
                            diagnostic(`Property ${property_name} not defined by ${origin_desc}; written without schema validation`);
                        }
                    }
                }
            }

            const hint = shape_hint(property_definition);

            const is_label = (name: string): boolean => {
                if (base_dt.get_node_by_label({ kind: "label", labels: [], name }) !== undefined) { return true; }
                return overlay.find_node({ kind: "label", labels: [], name }) !== undefined;
            };

            const built = build_raw_property(withValue, property_name, hint, is_label);

            if (built !== null && typeof built === "object" && "error" in built) {
                if (context_.json) {
                    respond_fail({ ok: false, message: built.error, severity: "error" });
                } else {
                    console.log(built.error);
                }
                return;
            }

            place_property(overlay, target_reference, found, is_base_target, built, property_name);

            const printed = overlay.print();
            const test_parse = DeviceTreeOverlay.new_from_string(printed, base_dt);

            if (typeof test_parse === "string") {
                if (context_.json) {
                    respond_fail({ ok: false, message: `Update would produce an unreadable overlay: ${test_parse}`, severity: "error" });
                } else {
                    console.log(`Update would produce an unreadable overlay: ${test_parse}`);
                }
                return;
            }

            fs.writeFileSync(input, printed);

            if (context_.json) {
                respond({ ok: true, message: `Updated ${property_name}`, severity: "info" });
            } else {
                console.log(`Set ${property_name} on ${node_identifier}`);
            }
        });
}

type ParsedInputValue = SingleInput | ArrayInput | MatrixInput;
type SingleInput = boolean | bigint | string;
type ArrayInput = (bigint | string)[];
type MatrixInput = ArrayInput[];

function parse_token(token: string): bigint | string {
    return /^-?\d+$/.test(token) ? BigInt(token) : token;
}

export function parse_value(value: string): ParsedInputValue {
    value = value.trim();

    const lowerValue = value.toLowerCase();
    if (lowerValue === 'true') { return true; }
    if (lowerValue === 'false') { return false; }

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

function is_matrix_input(value: ParsedInputValue): value is MatrixInput {
    return Array.isArray(value) && value.length > 0 && value.every(row => Array.isArray(row));
}

function upsert_property(found_node: DTNode, property: DTProperty): void {
    const existing = found_node.properties.find(p => p.name === property.name);
    if (existing === undefined) { found_node.properties.push(property); return; }
    existing.value = structuredClone(property.value);
}

export function place_property(
    overlay: DeviceTreeOverlay,
    target_reference: DTLabel | DTPath,
    found: FoundNodeResult | undefined,
    is_base_target: boolean,
    built: DTProperty | undefined,
    property_name: string,
): void {
    if (is_base_target) {
        if (built === undefined) {
            overlay.remove_property(target_reference, property_name);
        } else {
            overlay.add_fragment(target_reference, undefined, built);
        }
        return;
    }

    if (found !== undefined) {
        if (built === undefined) {
            found.node.properties = found.node.properties.filter(p => p.name !== property_name);
        } else {
            upsert_property(found.node, built);
        }
    }
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

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

    const overlay_with_imu = `/dts-v1/;
/plugin/;

&spi0 {
    imu1: adi,ad7124-8@0 {
        compatible = "adi,ad7124-8";
    };
};`;

    const parse = (overlay_source: string) => {
        const base = DeviceTree.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DeviceTreeOverlay.new_from_string(overlay_source, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }
        return { base, overlay };
    };

    const base_is_label = (name: string): boolean => {
        const { base, overlay } = parse(empty_overlay);
        if (base.get_node_by_label({ kind: "label", labels: [], name }) !== undefined) { return true; }
        return overlay.find_node({ kind: "label", labels: [], name }) !== undefined;
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

    test("build_raw_property — flags work as before", () => {
        const result_true = build_raw_property("true", "wakeup-source", "flag", base_is_label);
        expect(result_true).toBeDefined();
        expect("error" in result_true!).toBe(false);
        expect((result_true as DTProperty).value).toEqual({ kind: "flag" });

        const result_false = build_raw_property("false", "wakeup-source", "flag", base_is_label);
        expect(result_false).toBeUndefined();
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

    test("parse_value - scalars, flat arrays, and comma-separated matrices", () => {
        expect(parse_value("0")).toBe(0n);
        expect(parse_value("some_label")).toBe("some_label");
        expect(parse_value("true")).toBe(true);
        expect(parse_value("false")).toBe(false);
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

    test("format_value - board suggestions round-trip through parse_value + build_raw_property into the expected cells", () => {
        const board = parse_board_description(fs.readFileSync(new URL("../../../bundled/boards/pmd-rpi-intz.yaml", import.meta.url), "utf8"));
        if (typeof board === "string") { throw new TypeError(board); }
        const devicetree = DeviceTree.new_from_string(`/dts-v1/;
/ {
    soc {
        gpio: gpio@7e200000 {
            compatible = "brcm,bcm2711-gpio";
            gpio-controller;
            #gpio-cells = <2>;
            interrupt-controller;
            #interrupt-cells = <2>;
        };
        spi0: spi@7e204000 {
            compatible = "brcm,bcm2835-spi";
            #address-cells = <1>;
            #size-cells = <0>;
        };
    };
};`);
        if (typeof devicetree === "string") { throw new TypeError(devicetree); }

        const data = JSON.stringify({ "interrupt-parent": "gpio", "reset-gpios": ["gpio"] });
        const definitions = Attach.populate_properties([
            { key: "interrupt-parent", value: { _t: "generic" } },
            { key: "interrupts", value: { _t: "array", minItems: 1, maxItems: 1 } },
            { key: "reset-gpios", value: { _t: "generic" } },
        ], devicetree, data);

        const placement = { node_path: "/soc/spi@7e204000/adc@0", parent_path: "/soc/spi@7e204000", reg: 0n, siblings: [] };
        const stack = IntelligenceStack.default().with(board_layer(board));

        const is_label_rt = (name: string): boolean =>
            devicetree.get_node_by_label({ kind: "label", labels: [], name }) !== undefined;

        const round_trip = (property: string, display: string) => {
            const suggestion = stack.suggest_values(property, { devicetree, data, placement }).find(s => s.display === display);
            expect(suggestion, `${property}: ${display}`).toBeDefined();
            const definition = definitions.find(d => d.key === property)!;
            const hint = shape_hint(definition);
            const result = build_raw_property(format_value(suggestion!.rows), property, hint, is_label_rt);
            expect(result).toBeDefined();
            expect("error" in result!).toBe(false);
            return (result as DTProperty).value;
        };

        expect(round_trip("interrupts", "19 IRQ_TYPE_EDGE_FALLING — spi_pmod1.int")).toMatchObject([
            { kind: "array", elements: [{ kind: "number", value: 19n }, { kind: "number", value: 2n }] },
        ]);
        expect(round_trip("reset-gpios", "gpio 21 GPIO_ACTIVE_LOW — spi_pmod1.reset")).toMatchObject([
            { kind: "array", elements: [{ kind: "label", name: "gpio" }, { kind: "number", value: 21n }, { kind: "number", value: 1n }] },
        ]);
        expect(round_trip("interrupt-parent", "gpio — interrupt lines of spi_pmod1")).toMatchObject([
            { kind: "array", elements: [{ kind: "label", name: "gpio" }] },
        ]);
    });

    test("place_property - writes a true multi-row matrix as separate <...> groups", () => {
        const { overlay } = parse(empty_overlay);
        const target: DTLabel = { kind: "label", labels: [], name: "spi0" };

        const built = build_raw_property("1 2,3 4", "reg", "cells", () => false);
        expect(built).toBeDefined();
        expect("error" in built!).toBe(false);
        place_property(overlay, target, undefined, true, built as DTProperty, "reg");

        const output = overlay.print();
        expect(output).toMatch(/<[^>]*>,\s*<[^>]*>/);
    });

    test("place_property - adds a property to a base node with no fragment yet", () => {
        const { overlay } = parse(empty_overlay);

        expect(overlay.get_fragments().length).toBe(0);

        const built = build_raw_property("5000000", "spi-max-frequency", "cells", () => false);
        expect(built).toBeDefined();
        expect("error" in built!).toBe(false);
        place_property(overlay, { kind: "label", labels: [], name: "spi0" }, undefined, true, built as DTProperty, "spi-max-frequency");

        const output = overlay.print();
        expect(output).toContain("spi0");
        expect(output).toContain("spi-max-frequency");
        expect(overlay.get_fragments().length).toBe(1);
    });

    test("place_property - updating a base-node property reuses the fragment", () => {
        const { overlay } = parse(empty_overlay);
        const target: DTLabel = { kind: "label", labels: [], name: "spi0" };

        const b1 = build_raw_property("1", "spi-max-frequency", "cells", () => false) as DTProperty;
        const b2 = build_raw_property("2", "spi-max-frequency", "cells", () => false) as DTProperty;
        place_property(overlay, target, undefined, true, b1, "spi-max-frequency");
        place_property(overlay, target, undefined, true, b2, "spi-max-frequency");

        expect(overlay.get_fragments().length).toBe(1);
        expect(overlay.print()).toContain("spi-max-frequency");
    });

    test("place_property - removing a base-node boolean prunes the emptied fragment", () => {
        const { overlay } = parse(empty_overlay);
        const target: DTLabel = { kind: "label", labels: [], name: "spi0" };

        const built = build_raw_property("true", "wakeup-source", "flag", () => false) as DTProperty;
        place_property(overlay, target, undefined, true, built, "wakeup-source");
        expect(overlay.get_fragments().length).toBe(1);

        place_property(overlay, target, undefined, true, undefined, "wakeup-source");
        expect(overlay.print()).not.toContain("wakeup-source");
        expect(overlay.get_fragments().length).toBe(0);
    });

    test("place_property - mutates an overlay-added node in place", () => {
        const { overlay } = parse(overlay_with_imu);
        const found = overlay.find_node({ kind: "label", labels: [], name: "imu1" });
        expect(found).toBeDefined();

        const built = build_raw_property("0", "reg", "cells", () => false) as DTProperty;
        place_property(overlay, { kind: "label", labels: [], name: "imu1" }, found, false, built, "reg");

        const output = overlay.print();
        expect(output).toContain("imu1");
        expect(output).toContain("reg");
    });

    test("build_raw_property — end-to-end cs-gpios with 6-row board suggestion", () => {
        const board = parse_board_description(fs.readFileSync(new URL("../../../bundled/boards/pmd-rpi-intz.yaml", import.meta.url), "utf8"));
        if (typeof board === "string") { throw new TypeError(board); }
        const devicetree = DeviceTree.new_from_string(`/dts-v1/;
/ {
    soc {
        gpio: gpio@7e200000 {
            compatible = "brcm,bcm2711-gpio";
            gpio-controller;
            #gpio-cells = <2>;
        };
        spi0: spi@7e204000 {
            compatible = "brcm,bcm2835-spi";
            #address-cells = <1>;
            #size-cells = <0>;
            cs-gpios = <&gpio 8 1>, <&gpio 7 1>;
        };
    };
};`);
        if (typeof devicetree === "string") { throw new TypeError(devicetree); }

        const is_label_cs = (name: string): boolean =>
            devicetree.get_node_by_label({ kind: "label", labels: [], name }) !== undefined;

        const overlay = DeviceTreeOverlay.new_from_string(`/dts-v1/;\n/plugin/;\n/ { };`, devicetree);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const stack = IntelligenceStack.default().with(board_layer(board));
        const placement = { node_path: "/soc/spi@7e204000", parent_path: "/soc", siblings: [] };
        const cs_suggestion = stack.suggest_values("cs-gpios", { devicetree, data: "{}", placement })[0];
        expect(cs_suggestion).toBeDefined();

        const formatted = format_value(cs_suggestion!.rows);
        const built = build_raw_property(formatted, "cs-gpios", "cells", is_label_cs);
        expect(built).toBeDefined();
        expect("error" in built!).toBe(false);
        const property = built as DTProperty;

        place_property(overlay, { kind: "label", labels: [], name: "spi0" }, undefined, true, property, "cs-gpios");
        const printed = overlay.print();
        const reparsed = DeviceTreeOverlay.new_from_string(printed, devicetree);
        expect(typeof reparsed).not.toBe("string");

        expect(printed).toContain("&gpio");
        expect(printed).toMatch(/<&gpio\s+8\s+1>/);
    });

    test("build_raw_property — <0> placeholder round-trips through format → parse → build → print → reparse", () => {
        const board = parse_board_description(fs.readFileSync(new URL("../../../bundled/boards/pmd-rpi-intz.yaml", import.meta.url), "utf8"));
        if (typeof board === "string") { throw new TypeError(board); }

        const gapped_fixture = `
schema_version: 3
board: GAPPED-CS
gpio_controller: "&gpio"
buses:
  spi0:
    node: "&spi0"
    chip_selects:
      0: {gpio: 8, user: slot.cs}
      1: {gpio: 7, user: slot.cs2}
      3: {gpio: 18, user: slot.cs4}
slots:
  slot:
    bus: "&spi0"
    reg: 0
    signals:
      cs2: {kind: chip-select, gpio: 7, reg: 1}
      cs4: {kind: chip-select, gpio: 18, reg: 3}`;
        const gapped_board = parse_board_description(gapped_fixture);
        if (typeof gapped_board === "string") { throw new TypeError(gapped_board); }

        const devicetree = DeviceTree.new_from_string(`/dts-v1/;
/ {
    soc {
        gpio: gpio@7e200000 {
            compatible = "brcm,bcm2711-gpio";
            gpio-controller;
            #gpio-cells = <2>;
        };
        spi0: spi@7e204000 {
            compatible = "brcm,bcm2835-spi";
            #address-cells = <1>;
            #size-cells = <0>;
        };
    };
};`);
        if (typeof devicetree === "string") { throw new TypeError(devicetree); }

        const is_label = (name: string): boolean =>
            devicetree.get_node_by_label({ kind: "label", labels: [], name }) !== undefined;

        const overlay = DeviceTreeOverlay.new_from_string(`/dts-v1/;\n/plugin/;\n/ { };`, devicetree);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const stack = IntelligenceStack.default().with(board_layer(gapped_board));
        const placement = { node_path: "/soc/spi@7e204000", parent_path: "/soc", siblings: [] };
        const cs_suggestion = stack.suggest_values("cs-gpios", { devicetree, data: "{}", placement })[0];
        expect(cs_suggestion).toBeDefined();
        expect(cs_suggestion!.rows).toHaveLength(4);
        expect(cs_suggestion!.rows[2]).toStrictEqual([0n]);

        const formatted = format_value(cs_suggestion!.rows);
        const built = build_raw_property(formatted, "cs-gpios", "cells", is_label);
        expect(built).toBeDefined();
        expect("error" in built!).toBe(false);

        place_property(overlay, { kind: "label", labels: [], name: "spi0" }, undefined, true, built as DTProperty, "cs-gpios");
        const printed = overlay.print();
        const reparsed = DeviceTreeOverlay.new_from_string(printed, devicetree);
        expect(typeof reparsed).not.toBe("string");

        expect(printed).toMatch(/<&gpio\s+8\s+1>/);
        expect(printed).toMatch(/<&gpio\s+7\s+1>/);
        expect(printed).toContain("<0>");
        expect(printed).toMatch(/<&gpio\s+18\s+1>/);
    });
}
