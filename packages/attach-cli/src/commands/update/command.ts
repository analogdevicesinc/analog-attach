import { Command } from "commander";
import {
    Attach,
    AttachEnumType,
    IntelligenceStack,
    board_layer,
    parse_board_description,
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
    parse_unit_address,
    sync_unit_address_from_reg,
    type CellValue,
    type DTNode,
    type DTProperty,
    type DTLabel,
    type DTPath,
    type FoundNodeResult,
    type ResolvedProperty,
    type SuggestedCell,
    type ValueSuggestion,
    effective_interrupt_parent,
    base_lookup,
} from "attach-lib";
import * as fs from "node:fs";

import type { LocalContext } from "../../context";
import { resolve_config } from "../../resolve-config";
import { load_trees, resolve_write_target, overlay_print_options, parse_node_path, not_found_message } from "../../utilities";
import { resolve_node_binding } from "../../binding-resolution";
import { respond, respond_fail, input_error, diagnostic } from "../../protocol/output";
import { convert_node, convert_property } from "../../protocol/dt-to-protocol";

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
    json: boolean,
    quiet = false,
): Promise<{ definition: ResolvedProperty | undefined }> {
    return (async () => {
        if (binding_node === undefined) { return { definition: undefined }; }
        const binding = await resolve_node_binding(binding_node, binding_parent, parent_name, base_dt, linux, dtSchema, json);
        if ('error' in binding) {
            if (!quiet) { diagnostic(`Property ${property_name} written without schema validation: ${binding.error}`); }
            return { definition: undefined };
        }
        const result = binding.narrow_and_populate(binding_node);
        if (result === undefined) {
            if (!quiet) { diagnostic(`Property ${property_name} written without schema validation: failed to narrow binding`); }
            return { definition: undefined };
        }
        const definition = result.properties.find(entry => entry.key === property_name);
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

function read_property(context_: LocalContext, found: FoundNodeResult | undefined, property_name: string, node_identifier: string): void {
    if (found === undefined) {
        if (context_.json) { respond_fail({ ok: false, message: `Not found: ${node_identifier}`, severity: "error" }); }
        else { console.log(`Not found: ${node_identifier}`); }
        return;
    }
    const property = found.node.properties.find(p => p.name === property_name);
    if (property === undefined) {
        if (context_.json) { respond_fail({ ok: false, message: `Not found: ${property_name} on ${node_identifier}`, severity: "error" }); }
        else { console.log(`Property ${property_name} not set on ${node_identifier}`); }
        return;
    }
    if (context_.json) {
        respond(convert_property(property));
    } else {
        if (is_dt_flag(property.value)) {
            console.log("true");
        } else {
            console.log(print_property(property, "", 0).trim());
        }
    }
}

export function build_update_command(context_: LocalContext): Command {
    return new Command("update")
        .description("Set a property value, or read it when no value is given. Flags are set with no value and cleared with delete.")
        .argument("[path]", "Path to node (e.g. spi0/adi,ad7124-8@0)")
        .argument("[property]", "Property name")
        .argument("[value...]", "Value tokens (omit to read or set a flag)")
        .action(async (path_argument: string | undefined, property_argument: string | undefined, value_arguments: string[]) => {
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

            const resolved = resolve_config(context_, ["overlay", "context", "linux", "dtSchema"]);
            if (resolved === undefined) { return; }
            const { overlay: input, context, linux, dtSchema } = resolved.values;

            const trees = load_trees(context_, context, input, resolved.parsed.context);
            if (trees === undefined) { return; }
            const { base_dt, overlay } = trees;

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
                const effective = overlay.effective_children(found?.node_path ?? node_identifier);
                const existing_child = effective.get(property_name);
                if (existing_child !== undefined) {
                    const child_path = `${found?.node_path ?? node_identifier}/${property_name}`;
                    const child_found = overlay.find_node({ kind: "path", labels: [], path: child_path });
                    if (child_found !== undefined) {
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
                    } else {
                        if (context_.json) { respond_fail({ ok: false, message: `Not found: ${child_path}`, severity: "error" }); }
                        else { console.log(`Not found: ${child_path}`); }
                    }
                    return;
                }

                // Check if it matches a pattern_properties regex
                const { definition: def } = await resolve_property_definition(
                    binding_node, binding_parent, parent_name, base_dt, linux, dtSchema,
                    property_name, context_.json, true,
                );
                // Try to find the binding's child_nodes (pattern_properties)
                let matched_pattern = false;
                if (binding_node !== undefined) {
                    const binding = await resolve_node_binding(binding_node, binding_parent, parent_name, base_dt, linux, dtSchema, context_.json);
                    if (!("error" in binding) && binding.child_nodes.length > 0) {
                        const patterns = binding.child_nodes.map(c => c.pattern);
                        for (const pattern of patterns) {
                            if (new RegExp(pattern).test(property_name)) {
                                matched_pattern = true;
                                break;
                            }
                        }
                    }
                }

                if (matched_pattern) {
                    if (value_arguments.length > 0) {
                        const message = `${property_name} is a child node; set its properties with \`update ${node_identifier}/${property_name} <prop> <value>\``;
                        if (context_.json) { respond_fail({ ok: false, message, severity: "error" }); }
                        else { console.log(message); }
                        return;
                    }

                    // Create the child node
                    const at = property_name.indexOf("@");
                    const child_name = property_name.slice(0, at);
                    const child_unit = property_name.slice(at + 1);
                    const child_props: DTProperty[] = [];

                    const parsed_addr = parse_unit_address(child_unit);
                    if (parsed_addr !== undefined) {
                        const cells = address_cells_of(overlay, found?.node_path ?? node_identifier);
                        child_props.push(encode_reg_address(parsed_addr, cells.address, cells.size));

                        // C3: write #address-cells/#size-cells on parent if missing
                        if (found !== undefined && !is_base_target) {
                            const has_addr = found.node.properties.some(p => p.name === "#address-cells");
                            if (!has_addr) {
                                found.node.properties.push(
                                    PropertyBuilder.build_cell_array().with_tagged_values(PropertyBuilder.tag_number(1n)).with_name("#address-cells").build(),
                                    PropertyBuilder.build_cell_array().with_tagged_values(PropertyBuilder.tag_number(0n)).with_name("#size-cells").build(),
                                );
                            }
                        }
                    }

                    const child_node = NodeBuilder.new()
                        .with_name(child_name)
                        .with_unit_address(child_unit)
                        .with_label([])
                        .with_properties(child_props.length > 0 ? child_props : undefined)
                        .build();

                    if (found !== undefined) {
                        found.node.children.push(child_node);
                    } else if (is_base_target) {
                        overlay.add_fragment(target_reference, NodeBuilder.new().with_name(child_name).with_unit_address(child_unit).with_label([]).with_properties(child_props.length > 0 ? child_props : undefined), undefined);
                    }

                    const printed = overlay.print(overlay_print_options(resolved.config));
                    fs.writeFileSync(input, printed);
                    const message = `Added ${property_name} to ${node_identifier}`;
                    if (context_.json) { respond({ ok: true, message, severity: "info" }); }
                    else { console.log(message); }
                    return;
                }
                // Fall through to property handling (creates a flag for unknown names)
            }

            const { definition: property_definition } = await resolve_property_definition(
                binding_node, binding_parent, parent_name, base_dt, linux, dtSchema,
                property_name, context_.json, value_arguments.length === 0,
            );

            const hint = shape_hint(property_definition);

            const existing_property = found?.node.properties.find(p => p.name === property_name);
            const existing_has_value = existing_property !== undefined && !is_dt_flag(existing_property.value);

            const decision = decide_update(hint, value_arguments, existing_has_value);

            if (typeof decision === "object" && "error" in decision) {
                const message = `${property_name} ${decision.error}`;
                if (context_.json) { respond_fail({ ok: false, message, severity: "error" }); }
                else { console.log(message); }
                return;
            }

            if (decision === "read") {
                read_property(context_, found, property_name, node_identifier);
                return;
            }

            if (decision === "set-flag") {
                const built = PropertyBuilder.build_flag().set_flag().with_name(property_name).build();
                place_property(overlay, target_reference, found, is_base_target, built, property_name);
                const printed = overlay.print(overlay_print_options(resolved.config));
                const test_parse = DeviceTreeOverlay.new_from_string(printed, base_dt);
                if (typeof test_parse === "string") {
                    if (context_.json) { respond_fail({ ok: false, message: `Update would produce an unreadable overlay: ${test_parse}`, severity: "error" }); }
                    else { console.log(`Update would produce an unreadable overlay: ${test_parse}`); }
                    return;
                }
                fs.writeFileSync(input, printed);
                if (context_.json) { respond({ ok: true, message: `Set flag ${property_name} on ${node_identifier}`, severity: "info" }); }
                else { console.log(`Set flag ${property_name} on ${node_identifier}`); }
                return;
            }

            // decision === "value"
            const with_value = value_arguments.join(" ");
            const is_label = (name: string): boolean => {
                if (base_dt.get_node_by_label({ kind: "label", labels: [], name }) !== undefined) { return true; }
                return overlay.find_node({ kind: "label", labels: [], name }) !== undefined;
            };

            const built = build_raw_property(with_value, property_name, hint, is_label);

            if (built !== null && typeof built === "object" && "error" in built) {
                if (context_.json) {
                    respond_fail({ ok: false, message: built.error, severity: "error" });
                } else {
                    console.log(built.error);
                }
                return;
            }

            place_property(overlay, target_reference, found, is_base_target, built, property_name);

            const ip_result = implicit_interrupt_parent(overlay, base_dt, target_reference, found, is_base_target, property_name, built);
            if (ip_result.warning !== undefined) { diagnostic(ip_result.warning); }

            // R10: updating reg renames the node (overlay-added targets only)
            let rename_message = "";
            if (property_name === "reg" && found !== undefined && !is_base_target) {
                const parent_path = found.node_path.split("/").slice(0, -1).join("/") || "/";
                const cells = address_cells_of(overlay, parent_path);
                const effective = overlay.effective_children(parent_path);
                const sync = sync_unit_address_from_reg(found.node, cells.address, effective);
                switch (sync) {
                    case "conflict": {
                        if (context_.json) { respond_fail({ ok: false, message: `reg update would create a naming conflict`, severity: "error" }); }
                        else { console.log("reg update would create a naming conflict; not written"); }
                        return;
                    }
                    case "renamed": {
                        rename_message = `; renamed to ${get_full_node_name(found.node)}`;
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

            const printed = overlay.print(overlay_print_options(resolved.config));
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

            const ip_msg = ip_result.message !== undefined ? `; ${ip_result.message}` : "";
            if (context_.json) {
                respond({ ok: true, message: `Set ${property_name} on ${node_identifier}${rename_message}${ip_msg}`, severity: ip_result.warning !== undefined ? "warn" : "info" });
            } else {
                console.log(`Set ${property_name} on ${node_identifier}${rename_message}`);
                if (ip_result.message !== undefined) { console.log(ip_result.message); }
            }
        });
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
            const suggestion = stack.suggest_values(property, { devicetree, data, placement }).find(s => s.display.includes(display));
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

        const built = PropertyBuilder.build_flag().set_flag().with_name("wakeup-source").build();
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
schema_version: 4
board: GAPPED-CS
gpio_controller: "&gpio"
buses:
  spi0: {type: spi}
slots:
  slot:
    bus: spi0
    signals:
      cs: {kind: chip-select, gpio: 8, reg: 0}
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
