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
import path from "node:path";
import { execSync } from "node:child_process";

import type { LocalContext } from "../../context";
import { load_config, save_config } from "../../config";
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
            const config = load_config();
            const input = config.overlay;
            const context = config.context;

            if (input === undefined) {
                if (context_.json) { input_error("Missing: overlay (not configured)"); return; }
                console.log("Missing: overlay (no config.toml found)");
                return;
            }

            if (!fs.existsSync(input)) {
                if (context_.json) { input_error(`Missing: ${input}`); return; }
                console.log(`Missing: ${input}`);
                return;
            }

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

            const template = TEMPLATE;
            const base_dt = overlay.get_base_dts();
            const fragments = overlay.get_fragments();
            const node_blocks: string[] = [];

            for (const [index, fragment_] of fragments.entries()) {
                const fragment = fragment_!;

                const target_node = base_dt === undefined ? undefined : get_fragment_target_node(fragment, base_dt);
                const addr_cells = target_node === undefined ? 1n : (get_cell_value(target_node, '#address-cells') ?? 1n);
                const size_cells = target_node === undefined ? 0n : (get_cell_value(target_node, '#size-cells') ?? 0n);

                const overlay_child = fragment.children.find(c => c.name === '__overlay__');
                const intc_info = overlay_child === undefined ? { has_interrupts: false, interrupt_parent_label: undefined } : check_interrupt_info(overlay_child);

                const inner_lines: string[] = [];

                if (intc_info.has_interrupts) {
                    if (intc_info.interrupt_parent_label === undefined) {
                        const fake_label = `fake_intc_${index}`;
                        inner_lines.push(`\t\tinterrupt-parent = <&${fake_label}>;`, `\t\t${fake_label}: ${fake_label} {`, `\t\t\t#interrupt-cells = <1>;`, `\t\t\tinterrupt-controller;`, `\t\t};`);
                    } else {
                        const intc_node = base_dt === undefined ? undefined : find_node_by_label(base_dt, intc_info.interrupt_parent_label);
                        if (intc_node !== undefined) {
                            inner_lines.push(print_dtnode(intc_node, '\t\t'));
                        }
                    }
                }

                if (overlay_child !== undefined) {
                    for (const property of overlay_child.properties) {
                        inner_lines.push(print_dtprop(property, '\t\t'));
                    }
                    for (const child of overlay_child.children) {
                        inner_lines.push(print_dtnode(child, '\t\t'));
                    }
                }

                const content = inner_lines.length > 0 ? '\n' + inner_lines.join('\n') + '\n' : '';
                node_blocks.push(`\tnode${index} {\n\t\t#address-cells = <${addr_cells}>;\n\t\t#size-cells = <${size_cells}>;${content}\t};`);
            }

            const output = fill_template(template, node_blocks);

            const config_dir = path.join(process.cwd(), '.analog-attach');
            fs.mkdirSync(config_dir, { recursive: true });

            let validation_json_path = config.validationJson;

            if (validation_json_path === undefined) {
                const linux = config.linux;
                if (linux === undefined) {
                    if (context_.json) { input_error("Missing: linux (required to generate validation.json)"); return; }
                    console.log("Missing: linux (required to generate validation.json)");
                    return;
                }

                const bindings_path = path.join(linux, 'Documentation', 'devicetree', 'bindings');
                const generated_path = path.join(config_dir, 'validation.json');

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
            fs.mkdirSync(config_dir, { recursive: true });

            const temporary_dts = path.join(config_dir, 'temp.dts');
            const temporary_dtb = path.join(config_dir, 'temp.dtb');
            const error_json = path.join(config_dir, 'error.json');
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

            if (context_.json) {
                const response = parse_dt_validate_output(error_json);
                respond(response);
                return;
            }

            console.log(`Validated. Errors written to: ${error_json}`);
        });
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

// dt-validate --json-output writes an array of diagnostic objects.
// Each has: level ("error"|"warning"), node (DT path), property_path (string[]),
// formatted (human string, preferred) or message.
interface DtValidateDiagnostic {
    level?: string;
    node?: string;
    property_path?: unknown[];
    formatted?: string;
    message?: string;
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

function parse_dt_validate_output(error_json: string): ValidationResponse {
    let raw: unknown;
    try {
        raw = JSON.parse(fs.readFileSync(error_json, 'utf8'));
    } catch {
        return { errors: [], warnings: [] };
    }

    if (!Array.isArray(raw)) { return { errors: [], warnings: [] }; }

    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];

    for (const entry of raw as DtValidateDiagnostic[]) {
        const mapped = map_diagnostic(entry);
        if (entry.level === 'warning') {
            warnings.push(mapped);
        } else {
            errors.push(mapped);
        }
    }

    return { errors, warnings };
}
