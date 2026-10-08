import { Command } from "commander";
import {
    DeviceTree,
    DeviceTreeOverlay,
    is_dt_flag,
    cell_extract_first_value,
    print_property,
    type DTNode,
    type DTProperty,
    type DTLabel,
    type DTPath,
} from "attach-lib";
import * as fs from "node:fs";
import * as os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";

import type { LocalContext } from "../../context";
import { save_config } from "../../config";
import { resolve_config } from "../../resolve-config";
import { is_tool_available } from "../../utilities";
import { respond, input_error } from "../../protocol/output";
import type { ValidationResponse, ValidationError } from "../../protocol/types";

const TEMPLATE = `/dts-v1/;
/plugin/;

/ {
\tcompatible = "goo";
\tmodel = "goo";

\t#address-cells = <1>;
\t#size-cells = <1>;

\tnode{nr} {
\t\t// should be injected from parent
\t\t#address-cells = <{adr-c}>;
\t\t#size-cells = <{size-c}>;

\t};
};
`;

export function build_validate2_command(context_: LocalContext): Command {
    return new Command("validate2")
        .description("Validate a device node against its binding (alternative implementation)")
        .action(async () => {
            const resolved = resolve_config(context_, ["overlay"]);
            if (resolved === undefined) { return; }
            const config = resolved.config;
            const input = resolved.values.overlay;
            const context = config.context;

            const input_content = fs.readFileSync(input, "utf8");

            const base = (() => {
                if (context !== undefined && fs.existsSync(context)) {
                    return DeviceTree.new_from_string(fs.readFileSync(context, "utf8"));
                }
                return;
            })();

            const overlay = typeof base === "string" || base === undefined
                ? DeviceTreeOverlay.new_from_string(input_content)
                : DeviceTreeOverlay.new_from_string(input_content, base);

            if (typeof overlay === "string") {
                if (context_.json) {
                    respond({ errors: [{ kind: "generic", path: [], message: `Failed to parse overlay: ${overlay}` }], warnings: [] } satisfies ValidationResponse);
                    return;
                }
                console.log(`Failed to parse dtso ${input}: ${overlay}`);
                return;
            }

            const output = build_validation_dts(overlay);

            const config_directory = path.join(process.cwd(), '.attach-linux');
            fs.mkdirSync(config_directory, { recursive: true });

            let validation_json_path = config.validationJson;

            if (validation_json_path === undefined) {
                const linux = config.linux;
                if (linux === undefined) {
                    if (context_.json) { input_error("Missing: linux (required to generate validation.json)"); return; }
                    console.log("Missing: linux (required to generate validation.json)");
                    return;
                }

                const bindings_path = path.join(linux, 'Documentation', 'devicetree', 'bindings');
                const generated_path = path.join(config_directory, 'validation.json');

                if (!context_.json) { console.log("Generating validation.json (this may take a while)..."); }

                try {
                    const schema_output = execSync(`dt-mk-schema -j ${bindings_path}`, { stdio: 'pipe', maxBuffer: 256 * 1024 * 1024 });
                    fs.writeFileSync(generated_path, schema_output);
                } catch (error: any) {
                    const stderr: string = (error.stderr as Buffer | undefined)?.toString() ?? String(error);
                    if (context_.json) { input_error(`Failed to generate validation.json: ${stderr}`); return; }
                    console.log(`Failed to generate validation.json:\n${stderr}`);
                    return;
                }

                save_config({ validationJson: generated_path });
                validation_json_path = generated_path;
            }

            if (!fs.existsSync(validation_json_path)) {
                if (context_.json) { input_error(`validation.json not found: ${validation_json_path}`); return; }
                console.log(`validation.json not found: ${validation_json_path}`);
                return;
            }
            fs.mkdirSync(config_directory, { recursive: true });

            const temporary_dts = path.join(config_directory, 'temp.dts');
            const temporary_dtb = path.join(config_directory, 'temp.dtb');
            const error_json = path.join(config_directory, 'error.json');
            fs.writeFileSync(temporary_dts, output);

            let dtc_error: string | undefined;
            try {
                execSync(`dtc -I dts -O dtb -o ${temporary_dtb} ${temporary_dts}`, { stdio: 'pipe' });
            } catch (error: any) {
                dtc_error = (error.stderr as Buffer | undefined)?.toString() ?? String(error);
            }

            if (dtc_error !== undefined) {
                if (context_.json) {
                    respond({ errors: [{ kind: "generic", path: [], message: dtc_error }], warnings: [] } satisfies ValidationResponse);
                } else {
                    console.log(`dtc error:\n${dtc_error}`);
                }
                return;
            }

            // Delete stale error.json so a dt-validate crash isn't hidden by an old file.
            if (fs.existsSync(error_json)) { fs.unlinkSync(error_json); }

            // dt-validate exits non-zero when there are validation errors — that is not a tool failure.
            // We always read error.json; only fall back to stderr if the file wasn't written.
            let tool_error: string | undefined;
            try {
                execSync(`dt-validate -s ${validation_json_path} ${temporary_dtb} --json-output ${error_json}`, { stdio: 'pipe' });
            } catch (error: any) {
                const stderr: string = (error.stderr as Buffer | undefined)?.toString() ?? String(error);
                if (!fs.existsSync(error_json)) {
                    tool_error = stderr;
                }
            }

            if (tool_error !== undefined) {
                if (context_.json) {
                    respond({ errors: [{ kind: "generic", path: [], message: tool_error }], warnings: [] } satisfies ValidationResponse);
                } else {
                    console.log(`dt-validate error:\n${tool_error}`);
                }
                return;
            }

            const diagnostics = read_dt_validate_diagnostics(error_json);
            if ('error' in diagnostics) {
                if (context_.json) {
                    respond({ errors: [{ kind: "generic", path: [], message: diagnostics.error }], warnings: [] } satisfies ValidationResponse);
                } else {
                    console.log(diagnostics.error);
                }
                return;
            }

            if (context_.json) {
                respond(parse_dt_validate_output(diagnostics));
                return;
            }

            const targets = fragment_display_targets(overlay);
            const report = format_validation_report(diagnostics, targets);
            for (const line of report) { console.log(line); }
        });
}

/**
 * Build the stand-in tree dt-validate checks: one `nodeN` per fragment holding
 * the fragment's `__overlay__` children, plus a stub for every base-tree node
 * the overlay references by label (interrupt parents, GPIO controllers, clock
 * providers, …). Stubs carry the provider's `#*-cells` and `*-controller`
 * properties so dt-validate can decode specifiers such as `<&gpio 26 1>`.
 */
export function build_validation_dts(overlay: DeviceTreeOverlay): string {
    const base_dt = overlay.get_base_dts();
    const fragments = overlay.get_fragments();
    const overlay_roots = fragments.flatMap(fragment => fragment.children.filter(c => c.name === '__overlay__'));
    // Labels the overlay defines itself need no stub (and must not be defined twice).
    const defined_labels = new Set(overlay_roots.flatMap(root => collect_defined_labels(root)));
    const stubbed = new Set<DTNode>();
    const node_blocks: string[] = [];

    for (const [index, fragment] of fragments.entries()) {
        const target_node = base_dt === undefined ? undefined : get_fragment_target_node(fragment, base_dt);
        const addr_cells = target_node === undefined ? 1n : (get_cell_value(target_node, '#address-cells') ?? 1n);
        const size_cells = target_node === undefined ? 0n : (get_cell_value(target_node, '#size-cells') ?? 0n);

        const overlay_child = fragment.children.find(c => c.name === '__overlay__');
        const inner_lines: string[] = [];

        if (overlay_child !== undefined) {
            const intc_info = check_interrupt_info(overlay_child);
            if (intc_info.has_interrupts && intc_info.interrupt_parent_label === undefined) {
                const fake_label = `fake_intc_${index}`;
                inner_lines.push(`\t\tinterrupt-parent = <&${fake_label}>;`, `\t\t${fake_label}: ${fake_label} {`, `\t\t\t#interrupt-cells = <1>;`, `\t\t\tinterrupt-controller;`, `\t\t};`);
            }

            for (const label of collect_referenced_labels(overlay_child)) {
                if (defined_labels.has(label) || base_dt === undefined) { continue; }
                const provider = find_node_by_label(base_dt, label);
                if (provider === undefined || stubbed.has(provider)) { continue; }
                stubbed.add(provider);
                inner_lines.push(print_provider_stub(provider, '\t\t'));
            }

            for (const child of overlay_child.children) {
                inner_lines.push(print_dtnode(child, '\t\t'));
            }
        }

        const content = inner_lines.length > 0 ? '\n' + inner_lines.join('\n') + '\n' : '';
        node_blocks.push(`\tnode${index} {\n\t\t#address-cells = <${addr_cells}>;\n\t\t#size-cells = <${size_cells}>;${content}\t};`);
    }

    return fill_template(TEMPLATE, node_blocks);
}

/** Labels attached to `node` or any descendant. */
function collect_defined_labels(node: DTNode): string[] {
    return [...node.labels, ...node.children.flatMap(child => collect_defined_labels(child))];
}

/** Labels referenced as phandles (`<&label …>`) by `node` or any descendant, in first-use order. */
function collect_referenced_labels(node: DTNode): string[] {
    const labels = new Set<string>();
    const scan = (n: DTNode): void => {
        for (const property of n.properties) {
            if (is_dt_flag(property.value)) { continue; }
            for (const cell of property.value) {
                if (cell.kind !== 'array') { continue; }
                for (const element of cell.elements) {
                    if (element.kind === 'label') { labels.add((element as DTLabel).name); }
                }
            }
        }
        for (const child of n.children) { scan(child); }
    };
    scan(node);
    return [...labels];
}

/** A base-tree provider reduced to what specifier decoding needs: its labels, `#*-cells` and `*-controller` flags. */
function print_provider_stub(provider: DTNode, indent: string): string {
    const key = provider.unit_addr === undefined ? provider.name : `${provider.name}@${provider.unit_addr}`;
    const label_prefix = provider.labels.length > 0 ? `${provider.labels.join(': ')}: ` : '';
    const properties = provider.properties.filter(p => /^#.+-cells$/.test(p.name) || p.name.endsWith('-controller'));
    return [
        `${indent}${label_prefix}${key} {`,
        ...properties.map(property => print_dtprop(property, indent + '\t')),
        `${indent}};`,
    ].join('\n');
}

function get_fragment_target_node(fragment: DTNode, base_dt: DeviceTree): DTNode | undefined {
    const target_property = fragment.properties.find(p => p.name === "target");
    if (target_property !== undefined && !is_dt_flag(target_property.value)) {
        const first = target_property.value[0];
        if (first?.kind === 'array') {
            for (const element of first.elements) {
                if (element.kind === 'label') {
                    const reference = base_dt.get_node_by_label(element as DTLabel);
                    if (reference !== undefined) { return base_dt.deref_node(reference); }
                }
                if (element.kind === 'path') {
                    const reference = base_dt.get_node_by_path(element as DTPath);
                    if (reference !== undefined) { return base_dt.deref_node(reference); }
                }
            }
        }
    }

    const target_path_property = fragment.properties.find(p => p.name === "target-path");
    if (target_path_property !== undefined && !is_dt_flag(target_path_property.value)) {
        const first = target_path_property.value[0];
        if (first?.kind === 'string') {
            const reference = base_dt.get_node_by_path({ kind: 'path', path: first.value, labels: [] });
            if (reference !== undefined) { return base_dt.deref_node(reference); }
        }
    }

    return undefined;
}

function get_cell_value(node: DTNode, name: string): bigint | undefined {
    const property = node.properties.find(p => p.name === name);
    if (property === undefined || is_dt_flag(property.value)) { return undefined; }
    const value = cell_extract_first_value(property);
    return typeof value === 'bigint' ? value : undefined;
}

interface InterruptInfo {
    has_interrupts: boolean;
    interrupt_parent_label: string | undefined;
}

function check_interrupt_info(node: DTNode): InterruptInfo {
    let has_interrupts = false;
    let interrupt_parent_label: string | undefined;

    function scan(n: DTNode): void {
        for (const property of n.properties) {
            if (property.name === 'interrupts') { has_interrupts = true; }
            if (property.name === 'interrupt-parent' && !is_dt_flag(property.value)) {
                const first = property.value[0];
                if (first?.kind === 'array') {
                    for (const element of first.elements) {
                        if (element.kind === 'label') {
                            interrupt_parent_label = (element as DTLabel).name;
                        }
                    }
                }
            }
        }
        for (const child of n.children) { scan(child); }
    }

    scan(node);
    return { has_interrupts, interrupt_parent_label };
}

function find_node_by_label(base_dt: DeviceTree, label: string): DTNode | undefined {
    const reference = base_dt.get_node_by_label({ kind: 'label', name: label, labels: [] });
    if (reference === undefined) { return undefined; }
    return base_dt.deref_node(reference);
}

function print_dtnode(node: DTNode, indent: string): string {
    const key = node.unit_addr === undefined ? node.name : `${node.name}@${node.unit_addr}`;
    const label_prefix = node.labels.length > 0 ? `${node.labels.join(': ')}: ` : '';
    const lines: string[] = [`${indent}${label_prefix}${key} {`];

    for (const property of node.properties) {
        lines.push(print_dtprop(property, indent + '\t'));
    }

    for (const child of node.children) {
        lines.push(print_dtnode(child, indent + '\t'));
    }

    lines.push(`${indent}};`);
    return lines.join('\n');
}

function print_dtprop(property: DTProperty, indent: string): string {
    if (is_dt_flag(property.value)) {
        return `${indent}${property.name};`;
    }
    return `${indent}${print_property(property, indent, 0).trim()}`;
}

// Replace the node{nr} placeholder block with all generated node blocks.
function fill_template(template: string, node_blocks: string[]): string {
    return template.replace(
        /[ \t]*node\{nr\} \{[\s\S]*?\n[ \t]*\};/,
        node_blocks.join('\n\n')
    );
}

interface DtValidateDiagnostic {
    type?: string;
    level?: string;
    node?: string;
    property_path?: unknown[];
    formatted?: string;
    message?: string;
    note?: string;
    context?: unknown[];
}

export function read_dt_validate_diagnostics(error_json: string): DtValidateDiagnostic[] | { error: string } {
    let content: string;
    try {
        content = fs.readFileSync(error_json, 'utf8');
    } catch (error: any) {
        return { error: `dt-validate output unreadable: ${error.message ?? String(error)}` };
    }
    let raw: unknown;
    try {
        raw = JSON.parse(content);
    } catch {
        return { error: `dt-validate output unreadable: not valid JSON` };
    }
    if (!Array.isArray(raw)) { return { error: `dt-validate output unreadable: not an array` }; }
    return raw as DtValidateDiagnostic[];
}

export function fragment_display_targets(overlay: DeviceTreeOverlay): Map<number, string> {
    const targets = new Map<number, string>();
    const fragments = overlay.get_fragments();
    for (const [index, fragment] of fragments.entries()) {
        const target_property = fragment.properties.find(p => p.name === "target");
        if (target_property !== undefined && !is_dt_flag(target_property.value)) {
            const first = target_property.value[0];
            if (first?.kind === 'array') {
                for (const element of first.elements) {
                    if (element.kind === 'label') {
                        targets.set(index, (element as DTLabel).name);
                        break;
                    }
                }
            }
        }
        if (!targets.has(index)) {
            const target_path_property = fragment.properties.find(p => p.name === "target-path");
            if (target_path_property !== undefined && !is_dt_flag(target_path_property.value)) {
                const first = target_path_property.value[0];
                if (first?.kind === 'string') {
                    targets.set(index, first.value);
                }
            }
        }
    }
    return targets;
}

export function display_node(node: string, targets: Map<number, string>): string {
    const match = /^\/node(\d+)(.*)$/.exec(node);
    if (match === null) { return node; }
    const index = Number(match[1]);
    const rest = match[2] ?? '';
    const target = targets.get(index);
    if (target === undefined) { return node; }
    return target + rest;
}

export function format_validation_report(diagnostics: DtValidateDiagnostic[], targets: Map<number, string>): string[] {
    const errors: DtValidateDiagnostic[] = [];
    const warnings: DtValidateDiagnostic[] = [];
    const nodeless: DtValidateDiagnostic[] = [];

    for (const d of diagnostics) {
        if (d.node === undefined || d.node === '') {
            nodeless.push(d);
        } else if (d.level === 'warning') {
            warnings.push(d);
        } else {
            errors.push(d);
        }
    }

    const lines: string[] = [];

    for (const d of nodeless) {
        const level = d.level === 'warning' ? 'warning' : 'error';
        lines.push(`${level}: ${d.message ?? 'Unknown error'}`);
    }

    const grouped = new Map<string, DtValidateDiagnostic[]>();
    for (const d of [...errors, ...warnings]) {
        const key = display_node(d.node!, targets);
        const group = grouped.get(key);
        if (group === undefined) { grouped.set(key, [d]); }
        else { group.push(d); }
    }

    for (const [node, group] of grouped) {
        lines.push(`${node}:`);
        for (const d of group) {
            const level = d.level === 'warning' ? 'warning' : 'error';
            const property_path = Array.isArray(d.property_path) && d.property_path.length > 0
                ? d.property_path.map(String).join('/')
                : '(node)';
            lines.push(`  ${level}: ${property_path}: ${d.message ?? 'Unknown error'}`);
            if (d.note !== undefined) { lines.push(`    note: ${d.note}`); }
            if (d.context !== undefined) {
                for (const line of d.context) {
                    const text = typeof line === 'string' ? line : JSON.stringify(line);
                    lines.push(`    context: ${text}`);
                }
            }
        }
    }

    const error_count = errors.length + nodeless.filter(d => d.level !== 'warning').length;
    const warning_count = warnings.length + nodeless.filter(d => d.level === 'warning').length;

    if (error_count === 0) {
        if (warning_count > 0) {
            lines.push(`No errors! (${warning_count} warning(s))`);
        } else {
            lines.push('No errors!');
        }
    }

    return lines;
}

function map_diagnostic(d: DtValidateDiagnostic): ValidationError {
    const node_segs = typeof d.node === 'string' ? d.node.split('/').filter(s => s.length > 0) : [];
    const property_segs = Array.isArray(d.property_path) ? d.property_path.map(String) : [];
    return {
        kind: "generic",
        path: [...node_segs, ...property_segs],
        message: d.formatted ?? d.message ?? 'Unknown error',
    };
}

function parse_dt_validate_output(diagnostics: DtValidateDiagnostic[]): ValidationResponse {
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];

    for (const entry of diagnostics) {
        const mapped = map_diagnostic(entry);
        if (entry.level === 'warning') {
            warnings.push(mapped);
        } else {
            errors.push(mapped);
        }
    }

    return { errors, warnings };
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    const base = DeviceTree.new_from_string(`/dts-v1/;
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
            #address-cells = <1>;
            #size-cells = <0>;
        };
    };
};`);
    if (typeof base === "string") { throw new TypeError(base); }

    const overlay = DeviceTreeOverlay.new_from_string(`/dts-v1/;
/plugin/;
&spi0 {
    expander: dac@0 {
        reg = <0>;
        gpio-controller;
        #gpio-cells = <2>;
        interrupt-parent = <&gpio>;
        interrupts = <19 2>;
        reset-gpios = <&gpio 26 1>;
    };
};
&{/} {
    ports {
        in-gpios = <&expander 4 0>;
    };
};`, base);
    if (typeof overlay === "string") { throw new TypeError(overlay); }

    test("build_validation_dts — one stub per referenced provider, with gpio and interrupt cells", () => {
        const dts = build_validation_dts(overlay);
        expect(dts.match(/gpio: gpio@7e200000 \{/g)).toHaveLength(1);
        const stub = dts.slice(dts.indexOf("gpio: gpio@7e200000 {"), dts.indexOf("};", dts.indexOf("gpio: gpio@7e200000 {")));
        expect(stub).toContain("#gpio-cells = <2>;");
        expect(stub).toContain("gpio-controller;");
        expect(stub).toContain("#interrupt-cells = <2>;");
        expect(stub).not.toContain("compatible");
        // &expander is defined by the overlay itself: referenced, not stubbed.
        expect(dts.match(/expander:/g)).toHaveLength(1);
    });

    test.skipIf(!is_tool_available("dtc --version"))("build_validation_dts — dtc compiles the stand-in tree", () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "attach-validate2-"));
        try {
            const input = path.join(directory, "t.dts");
            fs.writeFileSync(input, build_validation_dts(overlay));
            execSync(`dtc -I dts -O dtb -o "${path.join(directory, "t.dtb")}" "${input}"`, { stdio: "pipe" });
        } finally {
            fs.rmSync(directory, { recursive: true });
        }
    });

    test("read_dt_validate_diagnostics — non-JSON input", () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "attach-diag-"));
        const file = path.join(directory, "bad.json");
        try {
            fs.writeFileSync(file, "not json");
            const result = read_dt_validate_diagnostics(file);
            expect(result).toHaveProperty("error");
            expect((result as { error: string }).error).toContain("not valid JSON");
        } finally {
            fs.rmSync(directory, { recursive: true });
        }
    });

    test("read_dt_validate_diagnostics — empty array", () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "attach-diag-"));
        const file = path.join(directory, "empty.json");
        try {
            fs.writeFileSync(file, "[]");
            const result = read_dt_validate_diagnostics(file);
            expect(Array.isArray(result)).toBe(true);
            expect(result).toHaveLength(0);
        } finally {
            fs.rmSync(directory, { recursive: true });
        }
    });

    test("read_dt_validate_diagnostics — missing file", () => {
        const result = read_dt_validate_diagnostics("/nonexistent/path.json");
        expect(result).toHaveProperty("error");
        expect((result as { error: string }).error).toContain("unreadable");
    });

    test("display_node — maps nodeN to fragment target", () => {
        const targets = new Map<number, string>([[0, "spi0"], [1, "/"]]);
        expect(display_node("/node0/dac@0", targets)).toBe("spi0/dac@0");
        expect(display_node("/node1", targets)).toBe("/");
        expect(display_node("/node1/ports", targets)).toBe("//ports");
        expect(display_node("/node5/x", targets)).toBe("/node5/x");
        expect(display_node("/other", targets)).toBe("/other");
    });

    test("fragment_display_targets — extracts label and path targets", () => {
        const targets = fragment_display_targets(overlay);
        expect(targets.get(0)).toBe("spi0");
        expect(targets.get(1)).toBe("/");
    });

    test("format_validation_report — empty input", () => {
        const report = format_validation_report([], new Map());
        expect(report).toEqual(["No errors!"]);
    });

    test("format_validation_report — one error and one warning", () => {
        const diagnostics: DtValidateDiagnostic[] = [
            { level: "error", node: "/node0/dac@0", property_path: ["reg"], message: "reg is required" },
            { level: "warning", node: "/node0/dac@0", property_path: ["spi-max-frequency"], message: "missing recommended property" },
        ];
        const targets = new Map<number, string>([[0, "spi0"]]);
        const report = format_validation_report(diagnostics, targets);
        expect(report[0]).toBe("spi0/dac@0:");
        expect(report[1]).toContain("error: reg: reg is required");
        expect(report[2]).toContain("warning: spi-max-frequency: missing recommended property");
        expect(report).not.toContain(expect.stringContaining("No errors!"));
    });

    test("format_validation_report — warnings only", () => {
        const diagnostics: DtValidateDiagnostic[] = [
            { level: "warning", node: "/node0/dac@0", property_path: ["spi-max-frequency"], message: "missing" },
        ];
        const targets = new Map<number, string>([[0, "spi0"]]);
        const report = format_validation_report(diagnostics, targets);
        expect(report.some(l => l.includes("warning"))).toBe(true);
        expect(report.at(-1)).toBe("No errors! (1 warning(s))");
    });

    test("format_validation_report — note and context are printed", () => {
        const diagnostics: DtValidateDiagnostic[] = [
            { level: "error", node: "/node0/x", property_path: ["p"], message: "bad", note: "see spec", context: ["line 1", "line 2"] },
        ];
        const report = format_validation_report(diagnostics, new Map([[0, "spi0"]]));
        expect(report.some(l => l.includes("note: see spec"))).toBe(true);
        expect(report.some(l => l.includes("context: line 1"))).toBe(true);
        expect(report.some(l => l.includes("context: line 2"))).toBe(true);
    });
}
