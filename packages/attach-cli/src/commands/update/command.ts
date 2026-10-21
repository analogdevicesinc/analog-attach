import { Command } from "commander";
import {
    AttachEnumType,
    DeviceTree,
    DeviceTreeOverlay,
    NodeBuilder,
    PropertyBuilder,
    INTERRUPT_MACROS,
    GPIO_MACROS,
    is_dt_flag,
    print_property,
    get_full_node_name,
    address_cells_of,
    encode_reg_address,
    ensure_address_cells,
    parse_unit_address,
    sync_unit_address_from_reg,
    unit_radix,
    type CellValue,
    type DTNode,
    type DTProperty,
    type DTLabel,
    type DTPath,
    type FoundNodeResult,
    type NodeTarget,
    type ResolvedProperty,
    type SuggestedCell,
    type ValueSuggestion,
    effective_interrupt_parent,
    base_lookup,
} from "attach-lib";
import * as fs from "node:fs";

import type { LocalContext } from "../../context";
import { load_workspace, type Bindings, type Workfile } from "../../config/workspace";
import { resolve_write_target, parse_node_path, not_found_message } from "../../utilities";
import { child_unit_radix, find_property_definition, resolve_node_binding } from "../../binding-resolution";
import { respond, respond_fail, input_error, diagnostic } from "../../protocol/output";
import { convert_node } from "../../protocol/dt-to-protocol";
import { read_target } from "../read/command";
import { node_reg_warnings, reg_warning_lines } from "../../reg-conflicts";
import { ask_for_missing, describe_missing, missing_required_of, type NewNode } from "../../missing-required";
import type { UpdateChildResponse } from "../../protocol/types";
import { count_warning, value_count } from "../../item-count";

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

export function resolve_property_definition(
    binding_node: DTNode | undefined,
    binding_parent: DTNode | undefined,
    parent_name: string,
    base_dt: DeviceTree,
    linux: string,
    dtSchema: string,
    property_name: string,
    quiet = false,
): Promise<{ definition: ResolvedProperty | undefined }> {
    return (async () => {
        if (binding_node === undefined) { return { definition: undefined }; }
        const binding = await resolve_node_binding(binding_node, binding_parent, parent_name, base_dt, linux, dtSchema);
        if ('error' in binding) {
            if (!quiet) { diagnostic(`Property ${property_name} written without schema validation: ${binding.error}`); }
            return { definition: undefined };
        }
        const result = binding.narrow_and_populate(binding_node);
        if (result === undefined) {
            if (!quiet) { diagnostic(`Property ${property_name} written without schema validation: failed to narrow binding`); }
            return { definition: undefined };
        }
        const definition = find_property_definition(binding, result.properties, property_name);
        if (definition === undefined && !quiet) {
            const origin_desc = binding.origin.kind === "compatible"
                ? `${binding.origin.compatible} binding`
                : `pattern "${binding.origin.pattern}" of ${binding.origin.parent_compatible}`;
            diagnostic(`Property ${property_name} not defined by ${origin_desc}; written without schema validation`);
        }
        return { definition };
    })();
}

export type UpdateDecision = "set-flag" | "read" | "value" | { error: string };

export function decide_update(hint: ShapeHint, value_tokens: string[], existing_has_value: boolean): UpdateDecision {
    if (value_tokens.length === 0) {
        if (hint === "flag") { return "set-flag"; }
        if (hint === undefined) {
            return existing_has_value ? "read" : "set-flag";
        }
        return "read";
    }
    if (hint === "flag") {
        return { error: `is a flag: \`update <path> ${""}\` sets it, \`delete <path> ${""}\` clears it` };
    }
    return "value";
}

export function build_update_command(context_: LocalContext): Command {
    return new Command("update")
        .description("Update/insert a property")
        .argument("[path]", "Path to node (label, label-first, or absolute)")
        .argument("[property]", "Property name")
        .argument("[value...]", "Value tokens (omit to read or set a flag)")
        .option("--quiet", "When reading: print only the value, as 'read --quiet' does")
        .option("--no-interview", "When creating a child node: list its missing required properties instead of asking for them")
        .addHelpText("after", `
Paths:
  Label:        spi0                       (a label in the base tree)
  Label-first:  spi0/adi,ad7124-8@0       (label then child segments)
  Absolute:     /soc/spi@7e204000          (full device tree path)

Value syntax:
  Numbers:     0, 1, 0x1F                  Cell values
  Macros:      GPIO_ACTIVE_LOW, IRQ_TYPE_EDGE_FALLING, ...
  Labels:      &spi0, spi0                 Phandle references
  Strings:     words without & are strings when the binding expects them
  Arrays:      multiple tokens in one call
  Matrices:    rows separated by ","

Special cases:
  No value     Sets a flag property, or reads the current value (as 'read' does)
  Child name   'update <path> <child-name>' creates a child node, then asks
               for its missing required properties on a terminal
               (--no-interview lists them instead)
  reg          'update <path> reg <n>' also renames the node's unit address

Examples:
  $ attach-linux update spi0/adi,ad7124-8@0 spi-max-frequency 1000000
  $ attach-linux update spi0/adi,ad7124-8@0 reg 1
  $ attach-linux update spi0/adi,ad7124-8@0 interrupts 25 IRQ_TYPE_EDGE_FALLING
  $ attach-linux update spi0/adi,ad7124-8@0 io-channels 0 1 , 2 3
  $ attach-linux update spi0/adi,ad7124-8@0 channel@0`)
        .action(async (path_argument: string | undefined, property_argument: string | undefined, value_arguments: string[], options: { quiet?: boolean; interview: boolean }) => {
            if (path_argument === undefined) {
                const message = "Missing: path";
                if (context_.json) { input_error(message); } else { console.log(message); }
                return;
            }
            if (property_argument === undefined) {
                const message = "Missing: property name";
                if (context_.json) { input_error(message); } else { console.log(message); }
                return;
            }

            const parsed_path = parse_node_path(path_argument);
            if (!parsed_path.ok) {
                if (context_.json) { input_error(parsed_path.error); } else { console.log(parsed_path.error); }
                return;
            }
            const node_identifier = parsed_path.value;

            const workspace = load_workspace(context_, ["bindings", "base", "overlay"]);
            if (workspace === undefined) { return; }
            const { linux, dt_schema: dtSchema } = workspace.bindings;
            const base_dt = workspace.base.tree;
            const { tree: overlay } = workspace.overlay;

            const { target_reference, found, is_base_target, binding_node, binding_parent, parent_name } =
                resolve_write_target(node_identifier, overlay, base_dt);

            if (found === undefined && !is_base_target) {
                const message = not_found_message(node_identifier, overlay, base_dt);
                if (context_.json) {
                    respond_fail({ ok: false, message, severity: "error" });
                } else {
                    console.log(message);
                }
                return;
            }

            const property_name = property_argument;

            // R12: child nodes via update
            if (property_name.includes("@")) {
                // A name with @ is always a child node, never a property
                const node_path = found?.node_path ?? base_dt.locate(target_reference)?.path ?? node_identifier;
                const effective = overlay.effective_children(node_path);
                const existing_child = effective.get(property_name);
                if (existing_child !== undefined) {
                    const child_path = `${node_path}/${property_name}`;
                    const child_found = overlay.find_node(child_path);
                    if (child_found === undefined) {
                        if (context_.json) { respond_fail({ ok: false, message: `Not found: ${child_path}`, severity: "error" }); }
                        else { console.log(`Not found: ${child_path}`); }
                    } else {
                        if (context_.json) {
                            respond(convert_node(child_found.node));
                        } else {
                            const ck = existing_child.unit_addr ? `${existing_child.name}@${existing_child.unit_addr}` : existing_child.name;
                            console.log(`${ck} {`);
                            for (const p of existing_child.properties) {
                                if (is_dt_flag(p.value)) { console.log(`    ${p.name};`); }
                                else { console.log(`    ${print_property(p, "    ", 0).trim()}`); }
                            }
                            console.log("};");
                        }
                    }
                    return;
                }

                // Check if it matches a pattern_properties regex
                // Try to find the binding's child_nodes (pattern_properties)
                let child_patterns: string[] = [];
                if (binding_node !== undefined) {
                    const binding = await resolve_node_binding(binding_node, binding_parent, parent_name, base_dt, linux, dtSchema);
                    if (!("error" in binding)) {
                        child_patterns = binding.child_nodes.map(c => c.pattern);
                    }
                }
                const matched_pattern = child_patterns.some(pattern => new RegExp(pattern).test(property_name));

                if (matched_pattern) {
                    if (value_arguments.length > 0) {
                        const message = `${property_name} is a child node; set its properties with \`update ${node_identifier}/${property_name} <prop> <value>\``;
                        if (context_.json) { respond_fail({ ok: false, message, severity: "error" }); }
                        else { console.log(message); }
                        return;
                    }

                    const child_path = create_child_node(overlay, node_path, property_name, child_patterns);
                    workspace.overlay.save();
                    const message = `Added ${property_name} to ${node_identifier}`;
                    const child: NewNode = {
                        workfile: workspace.overlay,
                        base: base_dt,
                        bindings: workspace.bindings,
                        identifier: `${node_identifier}/${property_name}`,
                        path: child_path,
                    };
                    const missing = await missing_required_of(child);
                    if (context_.json) {
                        respond({
                            ok: true,
                            message,
                            severity: "info",
                            path: child_path.split("/").filter(Boolean),
                            missing_required: await describe_missing(child, missing),
                        } satisfies UpdateChildResponse);
                        return;
                    }
                    console.log(message);
                    await ask_for_missing(child, missing, { interview: options.interview });
                    return;
                }
                // Fall through to property handling (creates a flag for unknown names)
            }

            const outcome = await apply_update(workspace.overlay, base_dt, workspace.bindings, node_identifier, property_name, value_arguments);
            switch (outcome.kind) {
                case "read": {
                    await read_target(context_, overlay, { ok: true, value: workspace.bindings }, node_identifier, property_name, { quiet: options.quiet ?? false });
                    return;
                }
                case "error": {
                    if (context_.json) { respond_fail({ ok: false, message: outcome.message, severity: "error" }); }
                    else { console.log(outcome.message); }
                    return;
                }
                case "set": {
                    if (context_.json) {
                        const message = outcome.detail === undefined ? outcome.message : `${outcome.message}; ${outcome.detail}`;
                        respond({ ok: true, message, severity: outcome.warned ? "warn" : "info" });
                    } else {
                        console.log(outcome.message);
                        if (outcome.detail !== undefined) { console.log(outcome.detail); }
                    }
                    return;
                }
            }
        });
}

/** Add the child `name` (`channel@0`) under `node_path`, with a reg in the radix the parent's patterns name it in; its path. */
export function create_child_node(overlay: DeviceTreeOverlay, node_path: string, name: string, child_patterns: string[]): string {
    const at = name.indexOf("@");
    const child_name = name.slice(0, at);
    const child_unit = name.slice(at + 1);
    const child_properties: DTProperty[] = [];

    const parsed_addr = parse_unit_address(child_unit, unit_radix(child_patterns, child_name) ?? 16);
    if (parsed_addr !== undefined) {
        const cells = address_cells_of(overlay, node_path);
        child_properties.push(encode_reg_address(parsed_addr, cells.address, cells.size));
        // C3: write #address-cells/#size-cells on parent if missing
        ensure_address_cells(overlay, node_path);
    }

    overlay.ensure_node(node_path)?.children.push(NodeBuilder.new()
        .with_name(child_name)
        .with_unit_address(child_unit)
        .with_label([])
        .with_properties(child_properties.length > 0 ? child_properties : undefined)
        .build());
    return `${node_path === "/" ? "" : node_path}/${name}`;
}

export type UpdateOutcome =
    | { kind: "read" }
    | { kind: "error"; message: string }
    /** `detail` is a second line (the implicit interrupt-parent); `warned` when a warning went to stderr. */
    | { kind: "set"; message: string; detail?: string; warned: boolean };

/**
 * Set a property (or a flag) on a node and write the workfile, or say that
 * the request is a read. Warnings go to stderr; the rest is returned.
 * Shared by `update` and the interview after `add`.
 */
export async function apply_update(
    workfile: Workfile,
    base_dt: DeviceTree,
    { linux, dt_schema: dtSchema }: Bindings,
    node_identifier: string,
    property_name: string,
    value_arguments: string[],
): Promise<UpdateOutcome> {
    const { path: input, tree: overlay } = workfile;
    const { target_reference, found, is_base_target, binding_node, binding_parent, parent_name } =
        resolve_write_target(node_identifier, overlay, base_dt);
    if (found === undefined && !is_base_target) {
        return { kind: "error", message: not_found_message(node_identifier, overlay, base_dt) };
    }

    const { definition: property_definition } = await resolve_property_definition(
        binding_node, binding_parent, parent_name, base_dt, linux, dtSchema,
        property_name, value_arguments.length === 0,
    );

    const hint = shape_hint(property_definition);

    const existing_property = found?.node.properties.find(p => p.name === property_name);
    const existing_has_value = existing_property !== undefined && !is_dt_flag(existing_property.value);

    const decision = decide_update(hint, value_arguments, existing_has_value);

    if (typeof decision === "object" && "error" in decision) {
        return { kind: "error", message: `${property_name} ${decision.error}` };
    }

    if (decision === "read") { return { kind: "read" }; }

    if (decision === "set-flag") {
        const built = PropertyBuilder.build_flag().set_flag().with_name(property_name).build();
        place_property(overlay, target_reference, found, is_base_target, built, property_name);
        const printed = workfile.print();
        const test_parse = DeviceTreeOverlay.new_from_string(printed, base_dt);
        if (typeof test_parse === "string") {
            return { kind: "error", message: `Update would produce an unreadable overlay: ${test_parse}` };
        }
        fs.writeFileSync(input, printed);
        return { kind: "set", message: `Set flag ${property_name} on ${node_identifier}`, warned: false };
    }

    // decision === "value"
    const with_value = value_arguments.join(" ");
    const is_label = (name: string): boolean => {
        if (base_dt.node_exists(name)) { return true; }
        return overlay.find_node(name) !== undefined;
    };

    const built = build_raw_property(with_value, property_name, hint, is_label);

    if (built !== null && typeof built === "object" && "error" in built) {
        return { kind: "error", message: built.error };
    }

    place_property(overlay, target_reference, found, is_base_target, built, property_name);

    const ip_result = implicit_interrupt_parent(overlay, base_dt, target_reference, found, is_base_target, property_name, built);
    if (ip_result.warning !== undefined) { diagnostic(ip_result.warning); }

    // R10: updating reg renames the node (overlay-added targets only)
    let rename_message = "";
    let reg_path = is_base_target ? base_dt.locate(target_reference)?.path : found?.node_path;
    if (property_name === "reg" && found !== undefined && !is_base_target) {
        const parent_path = found.node_path.split("/").slice(0, -1).join("/") || "/";
        const cells = address_cells_of(overlay, parent_path);
        const effective = overlay.effective_children(parent_path);
        const radix = await child_unit_radix(overlay.effective_node(parent_path), found.node.name, linux, dtSchema);
        const sync = sync_unit_address_from_reg(found.node, cells.address, effective, radix);
        switch (sync) {
            case "conflict": {
                return { kind: "error", message: "reg update would create a naming conflict; not written" };
            }
            case "renamed": {
                rename_message = `; renamed to ${get_full_node_name(found.node)}`;
                reg_path = parent_path === "/" ? `/${get_full_node_name(found.node)}` : `${parent_path}/${get_full_node_name(found.node)}`;
                break;
            }
            case "not-numeric": {
                diagnostic("reg contains non-numeric cells; node not renamed");
                break;
            }
        }
    } else if (property_name === "reg" && is_base_target) {
        diagnostic("an overlay can't rename a base node; reg written but name unchanged");
    }

    const printed = workfile.print();
    const test_parse = DeviceTreeOverlay.new_from_string(printed, base_dt);

    if (typeof test_parse === "string") {
        return { kind: "error", message: `Update would produce an unreadable overlay: ${test_parse}` };
    }

    fs.writeFileSync(input, printed);

    const reg_warnings = property_name === "reg" && reg_path !== undefined ? node_reg_warnings(overlay, reg_path) : [];
    for (const line of reg_warnings.flatMap(w => reg_warning_lines(w))) { diagnostic(line); }
    // The binding shapes the value but never refuses it: a count it doesn't allow is written, with a warning.
    const count = property_definition === undefined || built === undefined
        ? undefined
        : count_warning(property_name, property_definition.value, value_count(built));
    if (count !== undefined) { diagnostic(count); }

    return {
        kind: "set",
        message: `Set ${property_name} on ${node_identifier}${rename_message}`,
        ...(ip_result.message === undefined ? {} : { detail: ip_result.message }),
        warned: ip_result.warning !== undefined || reg_warnings.length > 0 || count !== undefined,
    };
}

type ParsedInputValue = SingleInput | ArrayInput | MatrixInput;
type SingleInput = bigint | string;
type ArrayInput = (bigint | string)[];
type MatrixInput = ArrayInput[];

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

export function implicit_interrupt_parent(
    overlay: DeviceTreeOverlay,
    base_dt: DeviceTree,
    target_reference: DTLabel | DTPath,
    found: FoundNodeResult | undefined,
    is_base_target: boolean,
    property_name: string,
    built: DTProperty | undefined,
): { message?: string; warning?: string } {
    if (property_name !== "interrupts") { return {}; }
    if (built === undefined) { return {}; }

    const node_path = found?.node_path;
    if (node_path === undefined) { return {}; }

    const has_interrupt_parent = found?.node.properties.some(p => p.name === "interrupt-parent") ?? false;
    if (has_interrupt_parent) { return {}; }

    const inherited = effective_interrupt_parent(base_lookup(base_dt), node_path, base_dt);
    if (inherited === undefined) {
        return { warning: `No interrupt-parent inherited for ${node_path}; set one: update ${node_path} interrupt-parent <controller>` };
    }
    if (inherited.label === undefined) {
        return { warning: `Inherited interrupt-parent at ${inherited.from} has no label; cannot write &{/path} in a plugin` };
    }

    const ip_built = PropertyBuilder.build_cell_array()
        .with_tagged_values(PropertyBuilder.tag_label(inherited.label))
        .with_name("interrupt-parent")
        .build();

    place_property(overlay, target_reference, found, is_base_target, ip_built, "interrupt-parent");

    let warning: string | undefined;
    if (inherited.interrupt_cells !== undefined) {
        const row_count = count_interrupt_cells(built);
        if (row_count !== undefined && row_count !== inherited.interrupt_cells) {
            warning = `${inherited.label} has #interrupt-cells = <${inherited.interrupt_cells}> but interrupts has ${row_count} cells; set interrupt-parent explicitly`;
        }
    }

    return {
        message: `Set interrupt-parent = <&${inherited.label}> on ${node_path} (inherited from ${inherited.from})`,
        warning,
    };
}

function count_interrupt_cells(property: DTProperty): number | undefined {
    if (is_dt_flag(property.value)) { return undefined; }
    const first = property.value[0];
    if (first?.kind !== "array") { return undefined; }
    return first.elements.length;
}

function upsert_property(found_node: DTNode, property: DTProperty): void {
    const existing = found_node.properties.find(p => p.name === property.name);
    if (existing === undefined) { found_node.properties.push(property); return; }
    existing.value = structuredClone(property.value);
}

export function place_property(
    overlay: DeviceTreeOverlay,
    target: NodeTarget,
    found: FoundNodeResult | undefined,
    is_base_target: boolean,
    built: DTProperty | undefined,
    property_name: string,
): void {
    if (is_base_target) {
        if (built === undefined) {
            overlay.remove_property(target, property_name);
        } else {
            overlay.add_fragment(target, undefined, built);
        }
        return;
    }

    if (found !== undefined) {
        if (built === undefined) {
            overlay.remove_property(found.node_path, property_name);
        } else {
            upsert_property(overlay.property_node(found.node_path, property_name) ?? found.node, built);
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

    test("decide_update — known flag, no value → set-flag", () => {
        expect(decide_update("flag", [], false)).toBe("set-flag");
    });

    test("decide_update — known non-flag, no value → read", () => {
        expect(decide_update("cells", [], false)).toBe("read");
        expect(decide_update("strings", [], false)).toBe("read");
    });

    test("decide_update — unknown and absent, no value → set-flag", () => {
        expect(decide_update(undefined, [], false)).toBe("set-flag");
    });

    test("decide_update — unknown and present with value, no value → read", () => {
        expect(decide_update(undefined, [], true)).toBe("read");
    });

    test("decide_update — value under flag hint → error", () => {
        const result = decide_update("flag", ["true"], false);
        expect(typeof result).toBe("object");
        expect((result as { error: string }).error).toContain("is a flag");
    });

    test("decide_update — value with any other hint → value", () => {
        expect(decide_update("cells", ["19", "2"], false)).toBe("value");
        expect(decide_update(undefined, ["okay"], false)).toBe("value");
    });

    test("create_child_node - writes reg in the radix the parent's pattern names, returns the child's path", () => {
        const { overlay } = parse(overlay_with_imu);
        const path = "/soc/spi@7e204000/adi,ad7124-8@0";
        expect(create_child_node(overlay, path, "channel@10", ["^channel@([0-9]|1[0-5])$"])).toBe(`${path}/channel@10`);
        const printed = overlay.print();
        expect(printed).toMatch(/channel@10 \{\s*reg = <10>;/);
        expect(printed).toContain("#address-cells = <1>;");
        expect(create_child_node(overlay, path, "port@a", ["^port@[0-9a-f]+$"])).toBe(`${path}/port@a`);
        expect(overlay.print()).toMatch(/port@a \{\s*reg = <10>;/);
    });

    test("place_property - writes a true multi-row matrix as separate <...> groups", () => {
        const { overlay } = parse(empty_overlay);
        const built = build_raw_property("1 2,3 4", "reg", "cells", () => false);
        expect(built).toBeDefined();
        expect("error" in built!).toBe(false);
        place_property(overlay, "spi0", undefined, true, built as DTProperty, "reg");

        const output = overlay.print();
        expect(output).toMatch(/<[^>]*>,\s*<[^>]*>/);
    });

    test("place_property - adds a property to a base node with no fragment yet", () => {
        const { overlay } = parse(empty_overlay);

        expect(overlay.get_fragments().length).toBe(0);

        const built = build_raw_property("5000000", "spi-max-frequency", "cells", () => false);
        expect(built).toBeDefined();
        expect("error" in built!).toBe(false);
        place_property(overlay, "spi0", undefined, true, built as DTProperty, "spi-max-frequency");

        const output = overlay.print();
        expect(output).toContain("spi0");
        expect(output).toContain("spi-max-frequency");
        expect(overlay.get_fragments().length).toBe(1);
    });

    test("place_property - updating a base-node property reuses the fragment", () => {
        const { overlay } = parse(empty_overlay);

        const b1 = build_raw_property("1", "spi-max-frequency", "cells", () => false) as DTProperty;
        const b2 = build_raw_property("2", "spi-max-frequency", "cells", () => false) as DTProperty;
        place_property(overlay, "spi0", undefined, true, b1, "spi-max-frequency");
        place_property(overlay, "spi0", undefined, true, b2, "spi-max-frequency");

        expect(overlay.get_fragments().length).toBe(1);
        expect(overlay.print()).toContain("spi-max-frequency");
    });

    test("place_property - removing a base-node boolean prunes the emptied fragment", () => {
        const { overlay } = parse(empty_overlay);

        const built = PropertyBuilder.build_flag().set_flag().with_name("wakeup-source").build();
        place_property(overlay, "spi0", undefined, true, built, "wakeup-source");
        expect(overlay.get_fragments().length).toBe(1);

        place_property(overlay, "spi0", undefined, true, undefined, "wakeup-source");
        expect(overlay.print()).not.toContain("wakeup-source");
        expect(overlay.get_fragments().length).toBe(0);
    });

    test("place_property - mutates an overlay-added node in place", () => {
        const { overlay } = parse(overlay_with_imu);
        const found = overlay.find_node("imu1");
        expect(found).toBeDefined();

        const built = build_raw_property("0", "reg", "cells", () => false) as DTProperty;
        place_property(overlay, "imu1", found, false, built, "reg");

        const output = overlay.print();
        expect(output).toContain("imu1");
        expect(output).toContain("reg");
    });

}
