import path from "node:path";

import { Command } from "commander";
import { DeviceTreeOverlay, creatable_providers, get_full_node_name, is_dt_flag, print_property, type DTProperty } from "attach-lib";

import type { LocalContext } from "../../context";
import { load_workspace, parse_bindings, type Bindings } from "../../config/workspace";
import type { ConfigResult } from "../../config/settings";
import { bigIntReplacer, resolve_node_identifier, not_found_message, parse_node_path, parse_property_name } from "../../utilities";
import { respond, respond_fail, input_error } from "../../protocol/output";
import { convert_node, convert_property } from "../../protocol/dt-to-protocol";
import type { Node, ReadNode, ReadResponse, Suggestion, Types, ValueSource } from "../../protocol/types";
import { format_type, resolve_target_binding, type PropertyInfo } from "../list/suggest";
import { node_missing_required, property_details } from "../../node-state";

export interface ReadOptions {
    /** Only the value (or "true" for a flag), as before the binding details were added. */
    quiet: boolean;
}

/**
 * Find a node and optionally a property on it, printing JSON or human output.
 * The node is read as the base and the overlay together have it, each value
 * marked with where it is set. Unless quiet, a property comes with what its
 * binding says about it, the values on offer and the providers that can be
 * added for it, and a node (in human mode) with the required properties it
 * still lacks. Shared with `update <path> <prop>` without a value.
 */
export async function read_target(
    context_: LocalContext,
    overlay: DeviceTreeOverlay,
    bindings: ConfigResult<Bindings>,
    path_string: string,
    property_name: string | undefined,
    options: ReadOptions,
): Promise<void> {
    const base = overlay.get_base_dts() ?? undefined;
    const reference = resolve_node_identifier(path_string, overlay);
    const node_path = overlay.find_node(reference)?.node_path ?? base?.locate(reference)?.path;
    const node = node_path === undefined ? undefined : overlay.effective_node(node_path);

    if (node_path === undefined || node === undefined) {
        const message = not_found_message(path_string, overlay, base);
        if (context_.json) {
            respond_fail({ ok: false, message, severity: "error" });
        } else {
            console.log(message);
        }
        return;
    }

    const property = property_name === undefined ? undefined : node.properties.find(p => p.name === property_name);
    if (property_name !== undefined && property === undefined) {
        const message = `Not found: ${property_name} on ${path_string}`;
        if (context_.json) {
            respond_fail({ ok: false, message, severity: "error" });
        } else {
            console.log(message);
        }
        return;
    }

    // A node's binding only gives the missing required properties, which JSON mode doesn't report.
    const needs_binding = !options.quiet && (property !== undefined || !context_.json);
    const target = !needs_binding || base === undefined ? undefined : await resolve_target_binding(path_string, overlay, base, bindings);
    const binding = target === undefined || "error" in target.binding ? undefined : target.binding;

    if (property === undefined) {
        const read = read_node(overlay, node_path);
        if (context_.json) {
            const response: ReadResponse = protocol_node(read);
            respond(response);
        } else {
            const missing = binding === undefined ? [] : node_missing_required(binding, overlay, node_path);
            for (const line of node_lines(read)) { console.log(line); }
            for (const line of format_missing(missing)) { console.log(line); }
        }
        return;
    }

    const details = target === undefined || base === undefined
        ? { info: undefined, suggestions: [], others: [] }
        : property_details(target, overlay, base, path_string, property.name);
    const { info } = details;
    const suggestions = [...details.suggestions, ...details.others];
    const creatable = options.quiet ? [] : creatable_providers(property.name);

    const source = property_source(overlay, node_path, property.name);
    if (context_.json) {
        const response: ReadResponse = {
            ...convert_property(property),
            source,
            ...(info?.description === undefined ? {} : { description: info.description }),
            ...(suggestions.length === 0 && creatable.length === 0 ? {} : {
                suggestions: {
                    values: suggestions,
                    ...(creatable.length === 0 ? {} : { can_create: creatable.map(compatible => ({ value: compatible, display_string: `add ${compatible}` })) }),
                },
            }),
        };
        respond(response);
    } else if (options.quiet) {
        console.log(is_dt_flag(property.value) ? "true" : print_property(property, "", 0).trim());
    } else {
        console.log(`${property_line(property)}${source === "base" ? BASE_MARK : ""}`);
        for (const line of format_details(info, suggestions)) { console.log(line); }
        if (creatable.length > 0) { console.log(`  Or add your own: ${creatable.map(compatible => `attach-linux add ${compatible}`).join(", ")}`); }
    }
}

function property_line(property: DTProperty): string {
    return is_dt_flag(property.value) ? `${property.name};` : print_property(property, "", 0).trim();
}

const BASE_MARK = "   // base";

function property_source(overlay: DeviceTreeOverlay, node_path: string, name: string): ValueSource {
    return overlay.property_node(node_path, name) === undefined ? "base" : "overlay";
}

/** A node as `read` shows it (see `ReadNode`), with its properties still parsed for printing. */
interface NodeRead {
    key: string;
    labels: string[];
    origin: ReadNode["origin"];
    collapsed: boolean;
    properties: { property: DTProperty; source: ValueSource }[];
    children: NodeRead[];
}

/**
 * The node at `node_path` as the base and the overlay together have it. The
 * children the overlay reaches (it changes them or something below them) are
 * read the same way; the others are collapsed to their name and labels, so a
 * base subtree isn't printed whole.
 */
function read_node(overlay: DeviceTreeOverlay, node_path: string): NodeRead {
    const roots = overlay.get_fragments().flatMap(fragment => overlay.get_fragment_root_path(fragment) ?? []);
    const touches = (path: string): boolean => overlay.overlay_nodes_at(path).length > 0;
    const reaches = (path: string): boolean => touches(path) || roots.some(root => root.startsWith(path === "/" ? "/" : `${path}/`));
    const origin = (path: string): ReadNode["origin"] => {
        if (overlay.get_base_dts()?.node_exists(path) !== true) { return "overlay"; }
        return touches(path) ? "both" : "base";
    };

    const read = (path: string): NodeRead => {
        const node = overlay.effective_node(path);
        const children = [...overlay.effective_children(path)].map(([name, child]): NodeRead => {
            const child_path = path === "/" ? `/${name}` : `${path}/${name}`;
            if (reaches(child_path)) { return read(child_path); }
            return { key: name, labels: child.labels, origin: "base", collapsed: true, properties: [], children: [] };
        });
        return {
            key: node === undefined ? path : get_full_node_name(node),
            labels: node?.labels ?? [],
            origin: origin(path),
            collapsed: false,
            properties: (node?.properties ?? []).map(property => ({ property, source: property_source(overlay, path, property.name) })),
            children,
        };
    };
    return read(node_path);
}

function protocol_node(node: NodeRead): ReadNode {
    return {
        kind: "node",
        key: node.key,
        properties: node.properties.map(({ property, source }) => ({ ...convert_property(property), source })),
        children: node.children.map(child => protocol_node(child)),
        alias: node.labels,
        origin: node.origin,
    };
}

/** A read node as DTS, with `// base` after what the base sets and after collapsed children. */
function node_lines(node: NodeRead, indent = ""): string[] {
    const labels = node.labels.map(label => `${label}: `).join("");
    if (node.collapsed) { return [`${indent}${labels}${node.key} { … };${BASE_MARK}`]; }
    const lines = [`${indent}${labels}${node.key} {`];
    for (const { property, source } of node.properties) {
        lines.push(`${indent}    ${property_line(property)}${source === "base" ? BASE_MARK : ""}`);
    }
    for (const child of node.children) { lines.push(...node_lines(child, `${indent}    `)); }
    lines.push(`${indent}};`);
    return lines;
}

/**
 * The lines under a property's value: its description and binding file, what's
 * allowed, and the suggestions. `with_type` adds the type when nothing narrower
 * is allowed, for a question that has no value to show yet. Without
 * `with_allowed`, what is allowed is left out too (a question that lists the
 * options itself).
 */
export function format_details(info: PropertyInfo | undefined, all_suggestions: Suggestion[], { with_type = false, with_allowed = true } = {}): string[] {
    const lines: string[] = [];
    let suggestions = all_suggestions;
    if (info !== undefined) {
        const description = (info.description ?? "").trim().split("\n").map(line => line.trim()).filter(Boolean);
        const file = `(${path.basename(info.binding_path)})`;
        const last = description.pop();
        lines.push(...description.map(line => `  ${line}`), last === undefined ? `  ${file}` : `  ${last}   ${file}`);
        // A phandle's options are every node it could name, so they are left to the suggestions.
        const allowed = info.phandle_options === undefined && with_allowed ? allowed_text(info) : undefined;
        if (allowed !== undefined) { lines.push(`  Allowed: ${allowed}`); }
        else if (with_type) { lines.push(`  Type: ${info.phandle_options === undefined ? format_type(info.type) : "phandle"}`); }
        if (info.constraints.default !== undefined) { lines.push(`  Default: ${JSON.stringify(info.constraints.default, bigIntReplacer)}`); }
        // The binding suggests each option of an enum, which the Allowed line already lists: those that say no more go.
        const options = allowed === undefined ? undefined : enum_options(info.type);
        if (options !== undefined) {
            suggestions = suggestions.filter(s => !options.includes(s.value) || (s.display_string ?? s.value) !== s.value);
        }
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

export function format_missing(missing: string[]): string[] {
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

    test("format_details — an option the Allowed line lists is no suggestion of its own; without with_allowed, neither is shown", () => {
        const reference: PropertyInfo = { ...info, description: undefined, type: { kind: "enum", options: [{ value: 0 }, { value: 1 }, { value: 3 }] }, constraints: { default: 3 } };
        const suggestions = [{ value: "3", display_string: "3 — the binding's default" }, { value: "0", display_string: "0" }, { value: "1" }];
        expect(format_details(reference, suggestions)).toEqual([
            "  (adi,ad7124.yaml)",
            "  Allowed: 0 | 1 | 3",
            "  Default: 3",
            "  Suggestions:",
            "    3 — the binding's default",
        ]);
        expect(format_details(reference, [], { with_allowed: false })).toEqual(["  (adi,ad7124.yaml)", "  Default: 3"]);
    });

    test("format_details — a phandle lists no Allowed line, and its type is phandle", () => {
        const phandle_info: PropertyInfo = {
            ...info,
            description: "Interrupt parent",
            type: { kind: "enum", options: [{ value: "gpio" }, { value: "gicv2" }, { value: "aon_intr" }] },
            constraints: {},
            phandle_options: ["gpio", "gicv2", "aon_intr"],
        };
        expect(format_details(phandle_info, [
            { value: "gicv2", display_string: "gicv2 — interrupt controller; inherited from /" },
            { value: "aon_intr", display_string: "aon_intr (disabled)" },
        ])).toEqual([
            "  Interrupt parent   (adi,ad7124.yaml)",
            "  Suggestions:",
            "    gicv2 — interrupt controller; inherited from /",
            "    aon_intr (disabled)",
        ]);
        expect(format_details(phandle_info, [], { with_type: true })).toEqual(["  Interrupt parent   (adi,ad7124.yaml)", "  Type: phandle"]);
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

    test("format_details — with_type shows the type when nothing narrower is allowed", () => {
        expect(format_details({ ...info, constraints: {} }, [], { with_type: true })).toEqual([
            "  Maximum SPI clocking speed of the device in Hz.   (adi,ad7124.yaml)",
            "  Type: number",
        ]);
        expect(format_details(info, [], { with_type: true }).at(-1)).toBe("  Allowed: <= 5000000");
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
        const no_bindings: ConfigResult<Bindings> = { ok: false, errors: [{ field: "dt-schema", kind: "missing", message: "no dt-schema" }] };

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

    test("read_target — the base and the overlay together, base values marked, base children collapsed", async () => {
        const base = DT.new_from_string(`/dts-v1/;\n/ {\n\tsoc {\n\t\ti2c_arm: i2c1: i2c@7e804000 {\n\t\t\tcompatible = "brcm,bcm2835-i2c";\n\t\t\tstatus = "disabled";\n\t\t\trtc@51 {\n\t\t\t\treg = <0x51>;\n\t\t\t};\n\t\t};\n\t\tspi0: spi@7e204000 {\n\t\t\tcompatible = "brcm,bcm2835-spi";\n\t\t};\n\t};\n};`);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DTO.new_from_string(`/dts-v1/;\n/plugin/;\n\n&i2c_arm {\n\tstatus = "okay";\n\thwmon@2e {\n\t\treg = <0x2e>;\n\t};\n};`, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }
        const no_bindings: ConfigResult<Bindings> = { ok: false, errors: [{ field: "dt-schema", kind: "missing", message: "no dt-schema" }] };
        const human = async (path: string, property?: string): Promise<string[]> => {
            const logs: string[] = [];
            const spy = vi.spyOn(console, "log").mockImplementation((line: string) => { logs.push(line); });
            await read_target({ json: false }, overlay, no_bindings, path, property, { quiet: false });
            spy.mockRestore();
            return logs;
        };

        expect(await human("i2c1", "compatible")).toEqual([`compatible = "brcm,bcm2835-i2c";   // base`]);
        expect(await human("i2c1", "status")).toEqual([`status = "okay";`]);
        expect(await human("i2c1")).toEqual([
            "i2c_arm: i2c1: i2c@7e804000 {",
            `    compatible = "brcm,bcm2835-i2c";   // base`,
            `    status = "okay";`,
            "    rtc@51 { … };   // base",
            "    hwmon@2e {",
            "        reg = <0x2e>;",
            "    };",
            "};",
        ]);
        // A base node the overlay doesn't touch reads too.
        expect(await human("spi0")).toEqual(["spi0: spi@7e204000 {", `    compatible = "brcm,bcm2835-spi";   // base`, "};"]);
        // The overlay reaches /soc through i2c1, so it is read; spi0 isn't, so it is collapsed.
        const soc = await human("/soc");
        expect(soc.filter(line => line.startsWith("    ") && !line.startsWith("        "))).toEqual([
            "    i2c_arm: i2c1: i2c@7e804000 {",
            "    };",
            "    spi0: spi@7e204000 { … };   // base",
        ]);

        const responses: unknown[] = [];
        const spy = vi.spyOn(console, "log").mockImplementation((line: string) => { responses.push(JSON.parse(line)); });
        await read_target({ json: true }, overlay, no_bindings, "i2c1", "compatible", { quiet: false });
        await read_target({ json: true }, overlay, no_bindings, "i2c1", undefined, { quiet: false });
        spy.mockRestore();
        expect(responses[0]).toMatchObject({ key: "compatible", source: "base" });
        expect(responses[1]).toMatchObject({
            key: "i2c@7e804000",
            origin: "both",
            properties: [{ key: "compatible", source: "base" }, { key: "status", source: "overlay" }],
            children: [{ key: "rtc@51", origin: "base", properties: [], children: [] }, { key: "hwmon@2e", origin: "overlay" }],
        });
        expect(responses[1]).not.toHaveProperty("children.0.collapsed");
        expect(responses[1]).not.toHaveProperty("missing_required");
    });

    test("read_target — a clock or a supply can be added instead of the values on offer, unless quiet", async () => {
        const base = DT.new_from_string(`/dts-v1/;\n/ {\n\tsoc {\n\t\tspi0: spi@7e204000 {\n\t\t};\n\t};\n};`);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DTO.new_from_string(`/dts-v1/;\n/plugin/;\n\n&spi0 {\n\tadc@0 {\n\t\tvref-supply = <&spi0>;\n\t\tspi-max-frequency = <1000000>;\n\t};\n};`, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }
        const no_bindings: ConfigResult<Bindings> = { ok: false, errors: [{ field: "dt-schema", kind: "missing", message: "no dt-schema" }] };
        const run = async (json: boolean, property: string, quiet = false): Promise<string[]> => {
            const logs: string[] = [];
            const spy = vi.spyOn(console, "log").mockImplementation((line: string) => { logs.push(line); });
            await read_target({ json }, overlay, no_bindings, "spi0/adc@0", property, { quiet });
            spy.mockRestore();
            return logs;
        };

        const [supply] = await run(true, "vref-supply");
        expect(JSON.parse(supply ?? "")).toMatchObject({
            suggestions: { values: [], can_create: [{ value: "regulator-fixed", display_string: "add regulator-fixed" }] },
        });
        expect(await run(false, "vref-supply")).toEqual(["vref-supply = <&spi0>;", "  Or add your own: attach-linux add regulator-fixed"]);
        const [quiet] = await run(true, "vref-supply", true);
        expect(JSON.parse(quiet ?? "")).not.toHaveProperty("suggestions");
        const [frequency] = await run(true, "spi-max-frequency");
        expect(JSON.parse(frequency ?? "")).not.toHaveProperty("suggestions");
    });
}
