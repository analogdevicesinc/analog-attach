import path from "node:path";

import { Command } from "commander";
import { DeviceTreeOverlay, is_dt_flag, print_property, type DTProperty } from "attach-lib";

import type { LocalContext } from "../../context";
import { load_workspace, parse_bindings, type Bindings } from "../../config/workspace";
import type { Result } from "../../config/settings";
import { bigIntReplacer, resolve_node_identifier, not_found_message, parse_node_path, parse_property_name } from "../../utilities";
import { respond, respond_fail, input_error } from "../../protocol/output";
import { convert_node, convert_property } from "../../protocol/dt-to-protocol";
import type { Node, ReadResponse, Suggestion, Types } from "../../protocol/types";
import { property_info, resolve_target_binding, value_suggestions, type PropertyInfo } from "../list/suggest";
import { node_missing_required } from "../../node-state";

export interface ReadOptions {
    /** Only the value (or "true" for a flag), as before the binding details were added. */
    quiet: boolean;
}

/**
 * Find a node and optionally a property on it, printing JSON or human output.
 * Unless quiet, a property comes with what its binding says about it and the
 * values on offer, and a node with the required properties it still lacks.
 * Shared with `update <path> <prop>` without a value.
 */
export async function read_target(
    context_: LocalContext,
    overlay: DeviceTreeOverlay,
    bindings: Result<Bindings>,
    path_string: string,
    property_name: string | undefined,
    options: ReadOptions,
): Promise<void> {
    const found = overlay.find_node(resolve_node_identifier(path_string, overlay));
    const base = overlay.get_base_dts() ?? undefined;

    if (found === undefined) {
        const message = not_found_message(path_string, overlay, base);
        if (context_.json) {
            respond_fail({ ok: false, message, severity: "error" });
        } else {
            console.log(message);
        }
        return;
    }

    const property = property_name === undefined ? undefined : found.node.properties.find(p => p.name === property_name);
    if (property_name !== undefined && property === undefined) {
        const message = `Not found: ${property_name} on ${path_string}`;
        if (context_.json) {
            respond_fail({ ok: false, message, severity: "error" });
        } else {
            console.log(message);
        }
        return;
    }

    const target = options.quiet || base === undefined ? undefined : await resolve_target_binding(path_string, overlay, base, bindings);
    const binding = target === undefined || "error" in target.binding ? undefined : target.binding;

    if (property === undefined) {
        const missing = binding === undefined ? undefined : node_missing_required(binding, overlay, found.node_path);
        if (context_.json) {
            const response: ReadResponse = { ...convert_node(found.node), ...(missing === undefined ? {} : { missing_required: missing }) };
            respond(response);
        } else {
            print_node_human(found.node);
            for (const line of format_missing(missing ?? [])) { console.log(line); }
        }
        return;
    }

    let info: PropertyInfo | undefined;
    let suggestions: Suggestion[] = [];
    if (target !== undefined && base !== undefined) {
        if (binding !== undefined && target.target.binding_node !== undefined) {
            const result = property_info(binding, target.target.binding_node, property.name);
            if (result.ok) { info = result.info; }
        }
        const values = value_suggestions(target, overlay, base, path_string, property.name);
        if (values.ok) { suggestions = values.suggestions; }
    }

    if (context_.json) {
        const response: ReadResponse = {
            ...convert_property(property),
            ...(info?.description === undefined ? {} : { description: info.description }),
            ...(suggestions.length === 0 ? {} : { suggestions }),
        };
        respond(response);
    } else if (options.quiet) {
        console.log(is_dt_flag(property.value) ? "true" : print_property(property, "", 0).trim());
    } else {
        console.log(property_line(property));
        for (const line of format_details(info, suggestions)) { console.log(line); }
    }
}

function property_line(property: DTProperty): string {
    return is_dt_flag(property.value) ? `${property.name};` : print_property(property, "", 0).trim();
}

/** The lines under a property's value: its description and binding file, what's allowed, and the suggestions. */
function format_details(info: PropertyInfo | undefined, suggestions: Suggestion[]): string[] {
    const lines: string[] = [];
    if (info !== undefined) {
        const description = (info.description ?? "").trim().split("\n").map(line => line.trim()).filter(Boolean);
        const file = `(${path.basename(info.binding_path)})`;
        const last = description.pop();
        lines.push(...description.map(line => `  ${line}`), last === undefined ? `  ${file}` : `  ${last}   ${file}`);
        const allowed = allowed_text(info);
        if (allowed !== undefined) { lines.push(`  Allowed: ${allowed}`); }
        if (info.constraints.default !== undefined) { lines.push(`  Default: ${JSON.stringify(info.constraints.default, bigIntReplacer)}`); }
    }
    if (suggestions.length > 0) {
        const plain = suggestions.every(s => (s.display_string ?? s.value) === s.value);
        if (plain) {
            lines.push(`  Suggestions: ${suggestions.map(s => s.value).join(", ")}`);
        } else {
            lines.push("  Suggestions:");
            for (const { value, display_string: display = value } of suggestions) {
                lines.push(display.startsWith(value) ? `    ${display}` : `    ${value}  ${display}`);
            }
        }
    }
    return lines;
}

function allowed_text({ type, constraints }: PropertyInfo): string | undefined {
    if (constraints.const !== undefined) { return JSON.stringify(constraints.const, bigIntReplacer); }
    const options = enum_options(type);
    if (options !== undefined) { return options.join(" | "); }
    const { minimum, maximum } = constraints;
    if (minimum !== undefined && maximum !== undefined) {
        return is_cell_width(minimum, maximum) ? undefined : `${minimum}..${maximum}`;
    }
    if (minimum !== undefined) { return `>= ${minimum}`; }
    if (maximum !== undefined) { return `<= ${maximum}`; }
    return undefined;
}

function enum_options(type: Types): string[] | undefined {
    if (type.kind === "enum") { return type.options.map(o => String(o.display_string ?? o.value)); }
    if (type.kind === "array") { return enum_options(type.items); }
    return undefined;
}

/** Whether a range is just what a uint8/16/32/64 or int8/16/32/64 cell can hold, which says nothing. */
function is_cell_width(minimum: number | bigint, maximum: number | bigint): boolean {
    const low = BigInt(minimum);
    const high = BigInt(maximum);
    return [8n, 16n, 32n, 64n].some(bits => (low === 0n && high === (1n << bits) - 1n)
        || (low === -(1n << (bits - 1n)) && high === (1n << (bits - 1n)) - 1n));
}

function format_missing(missing: string[]): string[] {
    return missing.length === 0 ? [] : [`Missing required: ${missing.join(", ")}`];
}

export function build_read_command(context_: LocalContext): Command {
    return new Command("read")
        .description("Read nodes or properties from the overlay")
        .argument("[path]", "Path to node (label, label-first, or absolute)")
        .argument("[property]", "Property name")
        .option("--quiet", "Print only the value, without the binding's description and the suggestions")
        .addHelpText("after", `
Paths:
  Label:        spi0                       (a label in the base tree)
  Label-first:  spi0/adi,ad7124-8@0       (label then child segments)
  Absolute:     /soc/spi@7e204000          (full device tree path)

A property is shown with its binding description, the allowed values and
suggestions; a node with the required properties it still lacks.

Examples:
  $ attach-linux read                              Print the entire overlay
  $ attach-linux read spi0                         Print a node by label
  $ attach-linux read spi0/adi,ad7124-8@0          Print a node subtree
  $ attach-linux read spi0/adi,ad7124-8@0 reg      Read a single property
  $ attach-linux read --quiet spi0/adi,ad7124-8@0 reg   Only the value`)
        .action(async (path_argument: string | undefined, property_argument: string | undefined, options: { quiet?: boolean }) => {
            const workspace = load_workspace(context_, ["base", "overlay"]);
            if (workspace === undefined) { return; }
            const { tree: overlay } = workspace.overlay;
            if (path_argument === undefined) {
                const fragments = overlay.get_fragments();
                const children = fragments.flatMap(f => {
                    const overlay_child = f.children.find(c => c.name === "__overlay__");
                    return overlay_child?.children ?? [];
                });

                const root: Node = {
                    kind: "node",
                    key: "/",
                    properties: [],
                    children: children.map(c => convert_node(c)),
                };

                if (context_.json) {
                    respond(root);
                } else {
                    console.log(workspace.overlay.print());
                }
                return;
            }

            const parsed_path = parse_node_path(path_argument);
            if (!parsed_path.ok) {
                if (context_.json) { input_error(parsed_path.error); }
                else { console.log(parsed_path.error); }
                return;
            }

            if (property_argument !== undefined) {
                const parsed_property = parse_property_name(property_argument);
                if (!parsed_property.ok) {
                    if (context_.json) { input_error(parsed_property.error); }
                    else { console.log(parsed_property.error); }
                    return;
                }
            }

            // Bindings are optional: without them read prints the plain value.
            await read_target(context_, overlay, parse_bindings(workspace.settings), parsed_path.value, property_argument, { quiet: options.quiet ?? false });
        });
}

function print_node_human(node: { name: string; unit_addr?: string; labels?: string[]; properties: any[]; children: any[] }, indent: string = ""): void {
    const key = node.unit_addr ? `${node.name}@${node.unit_addr}` : node.name;
    const label_prefix = node.labels !== undefined && node.labels.length > 0 ? `${node.labels.join(": ")}: ` : "";
    console.log(`${indent}${label_prefix}${key} {`);
    for (const property of node.properties) {
        if (is_dt_flag(property.value)) {
            console.log(`${indent}    ${property.name};`);
        } else {
            console.log(`${indent}    ${print_property(property, indent + "    ", 0).trim()}`);
        }
    }
    for (const child of node.children) {
        print_node_human(child, indent + "    ");
    }
    console.log(`${indent}};`);
}

if (import.meta.vitest) {
    const { test, expect, vi } = import.meta.vitest;
    const { DeviceTree: DT, DeviceTreeOverlay: DTO } = await import("attach-lib");

    const info: PropertyInfo = {
        type: { kind: "number", subtype: "int" },
        description: "Maximum SPI clocking speed of the device in Hz.",
        required: false,
        binding_path: "/linux/Documentation/devicetree/bindings/iio/adc/adi,ad7124.yaml",
        constraints: { maximum: 5_000_000n },
        suggestions: [],
    };

    test("format_details — description with the binding file, range and suggestions", () => {
        expect(format_details(info, [{ value: "5000000", display_string: "5000000" }])).toEqual([
            "  Maximum SPI clocking speed of the device in Hz.   (adi,ad7124.yaml)",
            "  Allowed: <= 5000000",
            "  Suggestions: 5000000",
        ]);
    });

    test("format_details — a range that is just the cell width says nothing", () => {
        expect(format_details({ ...info, constraints: { minimum: 0, maximum: 4_294_967_295 } }, [])).toEqual([
            "  Maximum SPI clocking speed of the device in Hz.   (adi,ad7124.yaml)",
        ]);
    });

    const lines = (constraints: PropertyInfo["constraints"]): string[] => format_details({ ...info, description: undefined, constraints }, []);

    test("format_details — ranges, const and default", () => {
        expect(lines({ minimum: 1, maximum: 8 })).toEqual(["  (adi,ad7124.yaml)", "  Allowed: 1..8"]);
        expect(lines({ minimum: 2 })).toEqual(["  (adi,ad7124.yaml)", "  Allowed: >= 2"]);
        expect(lines({ const: "adi,ad7124-8", default: 3 })).toEqual(["  (adi,ad7124.yaml)", "  Allowed: \"adi,ad7124-8\"", "  Default: 3"]);
    });

    test("format_details — enum options, and suggestions with notes one per line", () => {
        const enum_info: PropertyInfo = {
            ...info,
            description: "Interrupt parent",
            type: { kind: "enum", options: [{ value: "gpio" }, { value: "gicv2" }] },
            constraints: {},
        };
        expect(format_details(enum_info, [
            { value: "gicv2", display_string: "gicv2 — interrupt controller; inherited from /" },
            { value: "gpio", display_string: "gpio — interrupt controller" },
        ])).toEqual([
            "  Interrupt parent   (adi,ad7124.yaml)",
            "  Allowed: gpio | gicv2",
            "  Suggestions:",
            "    gicv2 — interrupt controller; inherited from /",
            "    gpio — interrupt controller",
        ]);
    });

    test("format_details — a display that doesn't start with the value shows both", () => {
        expect(format_details({ ...info, constraints: {} }, [{ value: "19 IRQ_TYPE_EDGE_FALLING", display_string: "GPIO 19, falling edge" }]).at(-2))
            .toBe("  Suggestions:");
        expect(format_details({ ...info, constraints: {} }, [{ value: "19 IRQ_TYPE_EDGE_FALLING", display_string: "GPIO 19, falling edge" }]).at(-1))
            .toBe("    19 IRQ_TYPE_EDGE_FALLING  GPIO 19, falling edge");
    });

    test("format_details — a multi-line description puts the file after the last line", () => {
        expect(format_details({ ...info, description: "First line.\nSecond line.\n", constraints: {} }, [])).toEqual([
            "  First line.",
            "  Second line.   (adi,ad7124.yaml)",
        ]);
    });

    test("format_details — no binding: suggestions only", () => {
        expect(format_details(undefined, [])).toEqual([]);
        expect(format_details(undefined, [{ value: "1", display_string: "1" }])).toEqual(["  Suggestions: 1"]);
    });

    test("format_missing — the missing required properties of a node", () => {
        expect(format_missing(["interrupt-parent", "interrupts"])).toEqual(["Missing required: interrupt-parent, interrupts"]);
        expect(format_missing([])).toEqual([]);
    });

    test("read_target — without bindings a property prints just its value and a node no missing list", async () => {
        const base = DT.new_from_string(`/dts-v1/;\n/ {\n\tsoc {\n\t\tspi0: spi@7e204000 {\n\t\t};\n\t};\n};`);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DTO.new_from_string(`/dts-v1/;\n/plugin/;\n\n&spi0 {\n\tadc@0 {\n\t\tcompatible = "adi,ad7124-8";\n\t\tspi-max-frequency = <1000000>;\n\t};\n};`, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }
        const no_bindings: Result<Bindings> = { ok: false, errors: [{ field: "dt-schema", kind: "missing", message: "no dt-schema" }] };

        const logs: string[] = [];
        const spy = vi.spyOn(console, "log").mockImplementation((line: string) => { logs.push(line); });
        await read_target({ json: false }, overlay, no_bindings, "spi0/adc@0", "spi-max-frequency", { quiet: false });
        await read_target({ json: false }, overlay, no_bindings, "spi0/adc@0", undefined, { quiet: false });
        spy.mockRestore();

        expect(logs).toEqual([
            "spi-max-frequency = <1000000>;",
            "adc@0 {",
            "    compatible = \"adi,ad7124-8\";",
            "    spi-max-frequency = <1000000>;",
            "};",
        ]);
    });
}
