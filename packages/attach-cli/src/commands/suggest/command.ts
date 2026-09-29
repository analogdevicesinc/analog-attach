import { Command } from "commander";
import {
    Attach,
    DeviceTree,
    DeviceTreeOverlay,
    IntelligenceStack,
    board_layer,
    describe_slot,
    describe_placement,
    dt_to_validator_input,
    get_full_node_name,
    parent_path_string,
    parse_board_description,
    placement_from_overlay,
    PropertyBuilder,
    suggest_parents,
    type BoardLayer,
    type DTNode,
    type NodePlacement,
    type ParsedBinding,
    type ResolvedProperty,
    type ValueSuggestion,
} from "attach-lib";
import * as fs from "node:fs";

import type { LocalContext } from "../../context";
import { load_config, type AttachConfig } from "../../config";
import { resolve_config } from "../../resolve-config";
import { load_board } from "../../board";
import { format_value, build_raw_property, shape_hint, parse_value } from "../update/command";
import { bigIntReplacer, find_binding, fragment_target, get_or_build_compat_index, load_base, load_trees, parse_property_reference, resolve_node_identifier, resolve_positional_path, resolve_write_target } from "../../utilities";
import { respond, respond_fail, input_error, diagnostic } from "../../protocol/output";
import { attach_type_to_protocol_type } from "../../protocol/dt-to-protocol";
import { resolve_node_binding, type NodeBinding } from "../../binding-resolution";
import { check_value } from "../../value-check";
import type { TypeResponse, Suggestion } from "../../protocol/types";

export function build_suggest_command(context: LocalContext): Command {
    return new Command("suggest")
        .description("Provide suggestions for a given intelligence kind")
        .argument("[args...]", "kind followed by kind-specific args")
        .action(async (arguments_: string[]) => {
            await run_suggest(context, arguments_);
        });
}

// The `suggest` action body, exported so shell-completion (`__complete`) can
// reuse the exact same intelligence in-process without a second subprocess.
export async function run_suggest(context: LocalContext, arguments_: string[]): Promise<void> {
    const kind = arguments_[0];

    if (kind === undefined) {
        if (context.json) { input_error("kind is required"); return; }
        console.log("Missing: kind (first positional argument)");
        return;
    }

    switch (kind) {
        case "parent": {
            await suggest_parent(context, arguments_.slice(1));
            return;
        }
        case "device-key": {
            await suggest_device_key(context, arguments_.slice(1));
            return;
        }
        case "node-prop": {
            await suggest_node_property(context, arguments_.slice(1));
            return;
        }
        case "navigate": {
            await suggest_navigate(context, arguments_.slice(1));
            return;
        }
        case "type": {
            await suggest_type(context, arguments_.slice(1));
            return;
        }
        case "value": {
            await suggest_value(context, arguments_.slice(1));
            return;
        }
        case "board-slot": {
            await suggest_board_slot(context, arguments_.slice(1));
            return;
        }
        default: {
            if (context.json) {
                respond_fail({ ok: false, message: `Unknown suggestion kind: ${kind}`, severity: "error" });
            } else {
                console.log(`Unknown suggestion kind: ${kind}`);
            }
            return;
        }
    }
}

async function suggest_parent(context_: LocalContext, arguments_: string[]): Promise<void> {
    const compatible = arguments_[0];
    if (compatible === undefined) {
        if (context_.json) { input_error("compatible string is required for parent suggestions"); return; }
        console.log("Missing: compatible string");
        return;
    }

    const resolved = resolve_config(context_, ["linux", "dtSchema", "context"]);
    if (resolved === undefined) { return; }
    const { linux, dtSchema, context } = resolved.values;

    const dt = load_base(context_, context, resolved.parsed.context);
    if (dt === undefined) { return; }

    const binding = await load_binding(context_, linux, dtSchema, compatible);
    if (binding === undefined) { return; }

    const parents = suggest_parents(dt, binding);

    if (context_.json) {
        const suggestions = parents.map(p => ({
            value: p.label ?? parent_path_string(p),
            display_string: parent_path_string(p),
        }));
        respond({ ok: true, message: `Found ${suggestions.length} valid parents`, severity: "info", suggestions });
    } else {
        console.log(JSON.stringify(parents));
    }
}

// Parse and emit the standard diagnostics for a binding looked up by compatible.
async function load_binding(context_: LocalContext, linux: string, dtSchema: string, compatible: string): Promise<ParsedBinding | undefined> {
    const binding_path = await find_binding(linux, dtSchema, compatible, context_.json);
    if (binding_path === undefined) {
        if (context_.json) {
            respond({ ok: true, message: `No binding found for ${compatible}`, severity: "warn", suggestions: [] });
        } else {
            console.log(`Failed to find binding for ${compatible}`);
        }
        return;
    }

    const binding = await Attach.new().parse_binding(binding_path, linux, dtSchema);
    if (binding === undefined) {
        if (context_.json) {
            respond_fail({ ok: false, message: `Failed to parse binding ${binding_path}`, severity: "error" });
        } else {
            console.log(`Failed to parse binding ${binding_path}`);
        }
        return;
    }

    return binding.parsed_binding;
}

// The configured board as an intelligence layer. The board is optional for the
// kinds that use this, so a broken board is reported and ignored, not fatal.
function optional_board_layer(config: AttachConfig): { layer?: BoardLayer; board_error?: string } {
    if (config.board === undefined) { return {}; }
    const board = load_board(config.board);
    if (typeof board === "string") {
        return { board_error: `board ${config.board} ignored: ${board}` };
    }
    return { layer: board_layer(board) };
}

export function no_layer_message(property_name: string, board_error?: string): { message: string; severity: "info" | "warn" } {
    if (board_error !== undefined) {
        return { message: `No layer offers values for ${property_name}; ${board_error}`, severity: "warn" };
    }
    return { message: `No layer offers values for ${property_name} (no board loaded)`, severity: "info" };
}

function to_suggestion(suggestion: ValueSuggestion): Suggestion {
    const display = suggestion.note !== undefined && !suggestion.display.includes(suggestion.note)
        ? `${suggestion.display} (${suggestion.note})`
        : suggestion.display;
    return {
        value: format_value(suggestion.rows),
        display_string: display,
        ...(suggestion.note === undefined ? {} : { note: suggestion.note }),
    };
}

// How the board layer read the node's position, for the response message.
export function slot_message(layer: BoardLayer, base_dt: DeviceTree, placement: NodePlacement, count: number): { message: string; severity: "info" | "warn" } {
    const found = `Found ${count} value(s) from ${layer.board.board}`;

    // 1. The node is itself a board bus.
    const own_bus = layer.bus_of_node(base_dt, placement.node_path);
    if (own_bus !== undefined) {
        const cs_note = own_bus.chip_selects.length > 0
            ? `the board provides cs-gpios for it`
            : `no values for it`;
        return { message: `${found}; ${own_bus.name} is a bus on ${layer.board.board}; ${cs_note}`, severity: "info" };
    }

    // 2. The parent is not a board bus.
    const inference = layer.infer_slots(base_dt, placement);
    if (inference.bus === undefined) {
        return count > 0
            ? { message: found, severity: "info" }
            : { message: `${found}: parent of ${placement.node_path} is not a bus on ${layer.board.board}`, severity: "warn" };
    }

    // 3. unwired_reg — reg is valid but not a wired chip select.
    if (inference.unwired_reg !== undefined) {
        const wired = inference.bus.chip_selects.map(cs => cs.reg).join(", ");
        return {
            message: `${found}; reg ${inference.unwired_reg} is not a chip select wired on ${inference.bus.name} (board wires ${wired}); use one of those or check the wiring`,
            severity: "warn",
        };
    }

    // 4. No slots on the bus.
    if (inference.slots.length === 0) {
        const reserved = inference.bus.reserved_addresses;
        const reserved_note = reserved.length > 0
            ? ` (reserved: ${reserved.map(r => `0x${r.address.toString(16)} ${r.description}`).join(", ")})`
            : "";
        return {
            message: `${found}; ${inference.bus.name} has no slots on ${layer.board.board}${reserved_note}`,
            severity: "warn",
        };
    }

    // 5. Narrowed or ambiguous.
    if (inference.narrowed) {
        return { message: `${found}; narrowed to ${inference.slots[0]!.id}`, severity: "info" };
    }
    const ids = inference.slots.map(slot => slot.id).join(", ");
    return {
        message: `${found}; ambiguous: ${inference.slots.length} slots on ${inference.bus.name} (${ids}), ask the user which slot the device is plugged into`,
        severity: "warn",
    };
}

async function suggest_value(context_: LocalContext, arguments_: string[]): Promise<void> {
    const reference = parse_property_reference(arguments_);
    if (reference === undefined) {
        if (context_.json) { input_error("prop-ref must contain a node reference and a property name"); return; }
        console.log("Missing: prop-ref (node reference followed by property name)");
        return;
    }
    const { node_identifier, property_name } = reference;

    const resolved = resolve_config(context_, ["context", "overlay"]);
    if (resolved === undefined) { return; }
    const { context, overlay: overlay_path } = resolved.values;

    const trees = load_trees(context_, context, overlay_path, resolved.parsed.context);
    if (trees === undefined) { return; }
    const { base_dt, overlay } = trees;

    const { binding_node, binding_parent, parent_name } = resolve_write_target(node_identifier, overlay, base_dt);

    const target_reference = resolve_node_identifier(node_identifier, overlay);
    const placement = placement_from_overlay(overlay, target_reference);
    if (placement === undefined) {
        if (context_.json) {
            respond_fail({ ok: false, message: `Node ${node_identifier} not found`, severity: "error" });
        } else {
            console.log(`Node not found: ${node_identifier}`);
        }
        return;
    }

    // Pass the node's real data so the intelligence stack can resolve phandle
    // references (e.g. interrupt-parent → controller → #interrupt-cells).
    let data = "{}";
    if (binding_node !== undefined) {
        const binding = await resolve_binding_for_data(binding_node, binding_parent, parent_name, base_dt, resolved.config);
        if (binding !== undefined) {
            const input_data = Object.fromEntries(dt_to_validator_input(binding_node, {
                required_properties: binding.required_properties,
                properties: binding.properties,
                pattern_properties: undefined,
                examples: [],
            }));
            data = JSON.stringify(input_data, bigIntReplacer);
        }
    }

    const { layer, board_error } = optional_board_layer(resolved.config);
    const stack = layer === undefined ? IntelligenceStack.default() : IntelligenceStack.default().with(layer);
    const values = stack.suggest_values(property_name, { devicetree: base_dt, data, placement });

    // Binding check: annotate suggestions when linux/dt-schema are available.
    const linux = resolved.config.linux;
    const dtSchema = resolved.config.dtSchema;
    let binding_check_reason: string | undefined;

    if (linux !== undefined && dtSchema !== undefined && fs.existsSync(linux) && fs.existsSync(dtSchema) && binding_node !== undefined) {
        const annotated = await annotate_suggestions(values, property_name, binding_node, binding_parent, parent_name, base_dt, linux, dtSchema, context_.json, overlay);
        if (annotated === undefined) {
            binding_check_reason = "binding could not be resolved";
        } else {
            // Annotations applied in-place via the note field
        }
    } else {
        if (linux === undefined || dtSchema === undefined) {
            binding_check_reason = "linux/dt-schema not configured";
        } else if (binding_node === undefined) {
            binding_check_reason = "node not found for binding resolution";
        } else {
            binding_check_reason = "linux or dt-schema path does not exist";
        }
    }

    const suggestions = values.map((value) => to_suggestion(value));

    let { message, severity } = layer === undefined
        ? no_layer_message(property_name, board_error)
        : slot_message(layer, base_dt, placement, suggestions.length);

    if (binding_check_reason !== undefined) {
        message = `${message}; not checked against a binding (${binding_check_reason})`;
    }

    if (context_.json) {
        respond({ ok: true, message, severity, suggestions });
    } else {
        if (severity === "warn" || suggestions.length === 0) { console.log(message); }
        for (const suggestion of suggestions) {
            console.log(`${suggestion.value}\t${suggestion.display_string}`);
        }
    }
}

async function resolve_binding_for_data(
    binding_node: DTNode,
    binding_parent: DTNode | undefined,
    parent_name: string,
    base_dt: DeviceTree,
    config: AttachConfig,
): Promise<NodeBinding | undefined> {
    const linux = config.linux;
    const dtSchema = config.dtSchema;
    if (linux === undefined || dtSchema === undefined) { return; }
    if (!fs.existsSync(linux) || !fs.existsSync(dtSchema)) { return; }

    const binding = await resolve_node_binding(binding_node, binding_parent, parent_name, base_dt, linux, dtSchema, true);
    if ('error' in binding) { return; }
    return binding;
}

async function annotate_suggestions(
    suggestions: ValueSuggestion[],
    property_name: string,
    binding_node: DTNode,
    binding_parent: DTNode | undefined,
    parent_name: string,
    base_dt: DeviceTree,
    linux: string,
    dtSchema: string,
    json: boolean,
    overlay: DeviceTreeOverlay,
): Promise<true | undefined> {
    const binding = await resolve_node_binding(binding_node, binding_parent, parent_name, base_dt, linux, dtSchema, json);
    if ('error' in binding) { return; }

    const origin_desc = binding.origin.kind === "compatible"
        ? `${binding.origin.compatible} binding`
        : `pattern "${binding.origin.pattern}" of ${binding.origin.parent_compatible}`;

    const is_label = (name: string): boolean => {
        if (base_dt.get_node_by_label({ kind: "label", labels: [], name }) !== undefined) { return true; }
        return overlay.find_node({ kind: "label", labels: [], name }) !== undefined;
    };

    for (const suggestion of suggestions) {
        const formatted = format_value(suggestion.rows);
        const preview_node = structuredClone(binding_node);

        // Build the property from the suggestion value and place it on the preview node
        const hint = shape_hint(binding.properties.find(p => p.key === property_name));
        const built = build_raw_property(formatted, property_name, hint, is_label);
        if (built !== null && built !== undefined && !("error" in built)) {
            const existing_index = preview_node.properties.findIndex(p => p.name === property_name);
            if (existing_index === -1) {
                preview_node.properties.push(built);
            } else {
                preview_node.properties[existing_index] = built;
            }
        }

        // Narrow and populate the binding with the preview node to get the definition
        const result = binding.narrow_and_populate(preview_node);
        if (result === undefined) { continue; }

        const definition = result.properties.find(p => p.key === property_name);
        if (definition === undefined) {
            suggestion.note = combine_notes(suggestion.note, `not defined by ${origin_desc}; validate may reject it`);
            continue;
        }

        if (definition.value._t === "generic" || definition.value._t === "object") {
            continue;
        }

        const check = check_value(parse_value(formatted), property_name, definition);
        if (check !== true) {
            suggestion.note = combine_notes(suggestion.note, check);
        }
    }

    return true;
}

function combine_notes(existing: string | undefined, addition: string): string {
    if (existing === undefined) { return addition; }
    return `${existing}; ${addition}`;
}

export function placement_message(board_name: string, compatible: string, suggestions: Suggestion[]): string {
    const distinct_slots = new Set(suggestions.map(s => s.value)).size;
    return `${suggestions.length} placement(s) in ${distinct_slots} slot(s) on ${board_name} can host ${compatible}`;
}

async function suggest_board_slot(context_: LocalContext, arguments_: string[]): Promise<void> {
    const compatible = arguments_[0];

    const resolved = resolve_config(context_, ["board"]);
    if (resolved === undefined) { return; }

    const board = load_board(resolved.values.board);
    if (typeof board === "string") {
        const error = `board ${resolved.values.board} ignored: ${board}`;
        if (context_.json) {
            respond_fail({ ok: false, message: error, severity: "error" });
        } else {
            console.log(error);
        }
        return;
    }

    let suggestions: Suggestion[];
    if (compatible === undefined) {
        suggestions = board.slots.map(slot => ({ value: slot.id, display_string: describe_slot(board, slot) }));
    } else {
        const binding_config = resolve_config(context_, ["linux", "dtSchema", "context"]);
        if (binding_config === undefined) { return; }
        const { linux, dtSchema, context } = binding_config.values;

        const base_dt = load_base(context_, context, binding_config.parsed.context);
        if (base_dt === undefined) { return; }

        const binding = await load_binding(context_, linux, dtSchema, compatible);
        if (binding === undefined) { return; }

        suggestions = IntelligenceStack.default().with(board_layer(board))
            .suggest_placement(binding, base_dt)
            .filter(placement => placement.slot !== undefined)
            .map(placement => ({ value: placement.slot!, display_string: placement.display }));
    }

    const message = compatible === undefined
        ? `${board.board} has ${suggestions.length} slot(s)`
        : placement_message(board.board, compatible, suggestions);

    if (context_.json) {
        respond({ ok: true, message, severity: suggestions.length === 0 ? "warn" : "info", suggestions });
    } else {
        if (suggestions.length === 0) { console.log(message); }
        for (const suggestion of suggestions) {
            console.log(suggestion.display_string ?? suggestion.value);
        }
    }
}

async function suggest_device_key(context: LocalContext, arguments_: string[]): Promise<void> {
    const filter = arguments_[0];

    const config = load_config() ?? {};

    const index = await get_or_build_compat_index(config.linux, config.dtSchema);

    if (index === undefined) {
        if (context.json) { input_error("No compat-index.json found and linux/dt-schema not configured. Run 'attach config-set' first."); return; }
        console.log("No compat-index.json found and linux/dt-schema not configured. Run 'attach config-set' first.");
        return;
    }

    const entries = Object.keys(index.entries);
    const matching = filter === undefined
        ? entries
        : entries.filter(entry => entry.includes(filter));

    if (context.json) {
        const suggestions = matching.map(entry => ({ value: entry }));
        respond({ ok: true, message: `Found ${suggestions.length} devices`, severity: "info", suggestions });
    } else {
        for (const entry of matching) {
            console.log(entry);
        }
    }
}

async function suggest_node_property(context_: LocalContext, arguments_: string[]): Promise<void> {
    const identifier = resolve_positional_path(arguments_);

    if (identifier === undefined) {
        if (context_.json) { input_error("node reference is required for node-prop suggestions"); return; }
        console.log("Missing: node reference");
        return;
    }

    const resolved = resolve_config(context_, ["linux", "dtSchema", "context", "overlay"]);
    if (resolved === undefined) { return; }
    const { linux, dtSchema, context, overlay: overlay_path } = resolved.values;

    const trees = load_trees(context_, context, overlay_path, resolved.parsed.context);
    if (trees === undefined) { return; }
    const { base_dt, overlay } = trees;

    const found = overlay.find_node(resolve_node_identifier(identifier, overlay));
    if (found === undefined) {
        if (context_.json) {
            respond_fail({ ok: false, message: `Node ${identifier} not found`, severity: "error" });
        } else {
            console.log(`Node not found: ${identifier}`);
        }
        return;
    }

    const { node: found_node, parent_node, node_path } = found;
    const existing_keys = new Set(found_node.properties.map(p => p.name));
    const parent_name = found_node.labels.at(-1) ?? node_path;

    const binding = await resolve_node_binding(found_node, parent_node, parent_name, base_dt, linux, dtSchema, context_.json);
    if ('error' in binding) {
        if (context_.json) {
            respond_fail({ ok: false, message: binding.error, severity: "error" });
        } else {
            console.log(binding.error);
        }
        return;
    }

    const required = new Set(binding.required_properties);
    const all_properties = binding.properties;

    if (context_.json) {
        const suggestions = all_properties.map(p => {
            const labels = [
                ...(existing_keys.has(p.key) ? ["set"] : []),
                ...(required.has(p.key) ? ["required"] : []),
            ].join(", ");
            return {
                value: p.key,
                ...(labels ? { display_string: `${p.key} (${labels})` } : {}),
            };
        });
        respond({ ok: true, message: `Found ${suggestions.length} properties`, severity: "info", suggestions });
    } else {
        for (const p of all_properties) {
            const markers = [
                ...(existing_keys.has(p.key) ? ["set"] : []),
                ...(required.has(p.key) ? ["required"] : []),
            ].join(", ");
            console.log(markers ? `${p.key} (${markers})` : p.key);
        }
    }
}

async function binding_property_suggestions(
    found_node: DTNode,
    parent_node: DTNode | undefined,
    parent_name: string,
    base_dt: DeviceTree,
    linux: string,
    dtSchema: string,
    json: boolean,
): Promise<Suggestion[] | undefined> {
    const binding = await resolve_node_binding(found_node, parent_node, parent_name, base_dt, linux, dtSchema, json);
    if ('error' in binding) { return undefined; }

    const required = new Set(binding.required_properties);
    const existing_keys = new Set(found_node.properties.map(p => p.name));

    return binding.properties.map(p => {
        const labels = [
            ...(existing_keys.has(p.key) ? ["set"] : []),
            ...(required.has(p.key) ? ["required"] : []),
        ].join(", ");
        return {
            value: p.key,
            ...(labels ? { display_string: `${p.key} (${labels})` } : {}),
        };
    });
}

async function suggest_navigate(context_: LocalContext, arguments_: string[]): Promise<void> {
    const resolved = resolve_config(context_, ["context", "overlay"]);
    if (resolved === undefined) { return; }
    const { context, overlay: overlay_path } = resolved.values;
    const linux = resolved.config.linux;
    const dtSchema = resolved.config.dtSchema;

    const trees = load_trees(context_, context, overlay_path, resolved.parsed.context);
    if (trees === undefined) { return; }
    const { base_dt, overlay } = trees;

    if (arguments_.length === 0) {
        const targets = [...new Set(
            overlay.get_fragments()
                .map(fragment => fragment_target(fragment))
                .filter((target): target is string => target !== undefined)
        )];

        if (context_.json) {
            respond({ ok: true, message: `Found ${targets.length} entry points`, severity: "info", suggestions: targets.map(value => ({ value })) });
        } else {
            for (const target of targets) {
                console.log(target);
            }
        }
        return;
    }

    const identifier = resolve_positional_path(arguments_)!;
    const found = overlay.find_node(resolve_node_identifier(identifier, overlay));
    if (found === undefined) {
        // The path may terminate at a property (a leaf), which has nothing to
        // navigate into but is not an error.
        const last_slash = identifier.lastIndexOf("/");
        if (last_slash > 0) {
            const parent_identifier = identifier.slice(0, last_slash);
            const property_name = identifier.slice(last_slash + 1);
            const parent = overlay.find_node(resolve_node_identifier(parent_identifier, overlay));
            if (parent !== undefined && parent.node.properties.some(p => p.name === property_name)) {
                if (context_.json) {
                    respond({ ok: true, message: `${property_name} is a property`, severity: "info", suggestions: [] });
                }
                return;
            }
        }

        if (context_.json) {
            respond_fail({ ok: false, message: `Node ${identifier} not found`, severity: "error" });
        } else {
            console.log(`Node not found: ${identifier}`);
        }
        return;
    }

    const { node: found_node, parent_node, node_path } = found;

    const child_suggestions: Suggestion[] = found_node.children.map(child => ({ value: get_full_node_name(child) }));

    let property_suggestions: Suggestion[] | undefined;
    if (linux !== undefined && dtSchema !== undefined && fs.existsSync(linux) && fs.existsSync(dtSchema)) {
        const nav_parent_name = found_node.labels.at(-1) ?? node_path;
        property_suggestions = await binding_property_suggestions(found_node, parent_node, nav_parent_name, base_dt, linux, dtSchema, context_.json);
    }
    property_suggestions ??= found_node.properties.map(p => ({ value: p.name }));

    const suggestions = [...child_suggestions, ...property_suggestions];

    if (context_.json) {
        respond({ ok: true, message: `Found ${suggestions.length} items`, severity: "info", suggestions });
    } else {
        for (const suggestion of suggestions) {
            console.log(suggestion.display_string ?? suggestion.value);
        }
    }
}

async function suggest_type(context_: LocalContext, arguments_: string[]): Promise<void> {
    const reference = parse_property_reference(arguments_);
    if (reference === undefined) {
        if (context_.json) { input_error("prop-ref must contain a node reference and a property name"); return; }
        console.log("Missing: prop-ref (node reference followed by property name)");
        return;
    }
    const { node_identifier, property_name } = reference;

    const resolved = resolve_config(context_, ["linux", "dtSchema", "context", "overlay"]);
    if (resolved === undefined) { return; }
    const { linux, dtSchema, context, overlay: overlay_path } = resolved.values;

    const trees = load_trees(context_, context, overlay_path, resolved.parsed.context);
    if (trees === undefined) { return; }
    const { base_dt, overlay } = trees;

    const { target_reference, binding_node, binding_parent, parent_name, is_base_target, found } = resolve_write_target(node_identifier, overlay, base_dt);
    if (binding_node === undefined) {
        if (context_.json) {
            respond_fail({ ok: false, message: `Node ${node_identifier} not found`, severity: "error" });
        } else {
            console.log(`Node not found: ${node_identifier}`);
        }
        return;
    }

    // With a board configured, its layer attaches concrete values to the properties it knows about.
    const { layer, board_error } = optional_board_layer(resolved.config);
    const placement = layer === undefined ? undefined : placement_from_overlay(overlay, target_reference);
    const options = layer === undefined || placement === undefined ? undefined : { layers: [layer], placement };

    const binding = await resolve_node_binding(binding_node, binding_parent, parent_name, base_dt, linux, dtSchema, context_.json, options);
    if ('error' in binding) {
        if (context_.json) {
            respond_fail({ ok: false, message: binding.error, severity: "error" });
        } else {
            console.log(binding.error);
        }
        return;
    }

    const result = binding.narrow_and_populate(binding_node);
    if (result === undefined) {
        const message = binding.origin.kind === "compatible"
            ? `Failed to narrow binding for ${binding.origin.compatible}`
            : `Failed to validate against pattern "${binding.origin.pattern}" of ${binding.origin.parent_compatible}`;
        if (context_.json) {
            respond_fail({ ok: false, message: message, severity: "error" });
        } else {
            console.log(message);
        }
        return;
    }

    const origin_desc = binding.origin.kind === "compatible"
        ? `${binding.origin.compatible} binding`
        : `pattern "${binding.origin.pattern}" of ${binding.origin.parent_compatible}`;

    const property_definition = result.properties.find(p => p.key === property_name);
    if (property_definition === undefined) {
        if (context_.json) {
            respond_fail({ ok: false, message: `Property ${property_name} not found in ${origin_desc}`, severity: "error" });
        } else {
            console.log(`Property ${property_name} not found in ${origin_desc}`);
        }
        return;
    }

    const type = attach_type_to_protocol_type(property_definition.value);
    const suggestions = (property_definition.suggestions ?? []).map((suggestion) => to_suggestion(suggestion));

    const type_message = board_error !== undefined ? `Type of ${property_name}; ${board_error}` : `Type of ${property_name}`;
    const type_severity = board_error !== undefined ? "warn" as const : "info" as const;

    if (context_.json) {
        const response: TypeResponse = {
            ok: true,
            message: type_message,
            severity: type_severity,
            type,
            description: property_definition.value.description,
            ...(suggestions.length > 0 ? { suggestions } : {}),
        };
        respond(response);
    } else {
        if (board_error !== undefined) { console.log(`warning: ${board_error}`); }
        console.log(format_type(type));
        for (const suggestion of suggestions) {
            console.log(`  ${suggestion.value}\t${suggestion.display_string}`);
        }
    }
}

function format_type(type: import("../../protocol/types").Types): string {
    switch (type.kind) {
        case "number": {
            return "number";
        }
        case "string": {
            return "string";
        }
        case "bool": {
            return "bool";
        }
        case "enum": {
            return `enum(${type.options.map(o => String(o.display_string ?? o.value)).join(" | ")})`;
        }
        case "array": {
            return `${format_type(type.items)}[]`;
        }
        case "tuple": {
            return `(${type.items.map((element) => format_type(element)).join(", ")})`;
        }
    }
}

if (import.meta.vitest) {
    const { test, expect, describe } = import.meta.vitest;
    type VS = import("attach-lib").ValueSuggestion;

    // ── to_suggestion ──────────────────────────────────────────────────

    test("to_suggestion — carries note and appends it to display once", () => {
        const suggestion: VS = { rows: [[19n, { macro: "IRQ_TYPE_EDGE_FALLING" }]], display: "19 IRQ_TYPE_EDGE_FALLING", source: "board:test", note: "needs interrupt-parent" };
        const result = to_suggestion(suggestion);
        expect(result.note).toBe("needs interrupt-parent");
        expect(result.display_string).toBe("19 IRQ_TYPE_EDGE_FALLING (needs interrupt-parent)");
    });

    test("to_suggestion — does not duplicate note already in display", () => {
        const suggestion: VS = { rows: [[0n]], display: "0 — in use by spidev@0 (in use by spidev@0)", source: "board:test", note: "in use by spidev@0" };
        const result = to_suggestion(suggestion);
        expect(result.note).toBe("in use by spidev@0");
        expect(result.display_string).not.toContain("(in use by spidev@0) (in use by spidev@0)");
    });

    test("to_suggestion — no note means no note field", () => {
        const suggestion: VS = { rows: [[1n]], display: "1", source: "board:test" };
        const result = to_suggestion(suggestion);
        expect(result.note).toBeUndefined();
        expect(result.display_string).toBe("1");
    });

    // ── to_suggestion with board-layer-shaped suggestions ──────────────

    test("to_suggestion — matrix rows produce comma-separated --with value", () => {
        const suggestion: VS = {
            rows: [[{ label: "gpio" }, 8n, { macro: "GPIO_ACTIVE_LOW" }], [{ label: "gpio" }, 7n, { macro: "GPIO_ACTIVE_LOW" }]],
            display: "2 chip selects — GPIO8, GPIO7",
            source: "board:PMD-RPI-INTZ",
        };
        const result = to_suggestion(suggestion);
        expect(result.value).toBe("gpio 8 GPIO_ACTIVE_LOW,gpio 7 GPIO_ACTIVE_LOW");
        expect(result.display_string).toBe("2 chip selects — GPIO8, GPIO7");
    });

    test("to_suggestion — single-row label+number+macro formats as space-separated value", () => {
        const suggestion: VS = {
            rows: [[{ label: "gpio" }, 19n, { macro: "IRQ_TYPE_EDGE_FALLING" }]],
            display: "gpio 19 IRQ_TYPE_EDGE_FALLING — spi_pmod1.int",
            source: "board:PMD-RPI-INTZ",
            slot: "spi_pmod1",
        };
        const result = to_suggestion(suggestion);
        expect(result.value).toBe("gpio 19 IRQ_TYPE_EDGE_FALLING");
    });

    test("to_suggestion — single-cell reg", () => {
        const suggestion: VS = { rows: [[2n]], display: "2 — GPIO20 (spi_pmod1.cs2)", source: "board:PMD-RPI-INTZ", slot: "spi_pmod1" };
        const result = to_suggestion(suggestion);
        expect(result.value).toBe("2");
    });

    // ── parse_property_reference ────────────────────────────────────────

    describe("parse_property_reference", () => {
        test("single segment with slash separates node and property", () => {
            expect(parse_property_reference(["mynode/status"])).toStrictEqual({
                node_identifier: "mynode",
                property_name: "status",
            });
        });

        test("multi-segment path splits at last slash", () => {
            expect(parse_property_reference(["spi0", "adc@0", "reg"])).toStrictEqual({
                node_identifier: "spi0/adc@0",
                property_name: "reg",
            });
        });

        test("root-relative path", () => {
            expect(parse_property_reference(["/soc/spi@7e204000/adc@0/interrupts"])).toStrictEqual({
                node_identifier: "/soc/spi@7e204000/adc@0",
                property_name: "interrupts",
            });
        });

        test("returns undefined for empty input", () => {
            expect(parse_property_reference([])).toBeUndefined();
        });

        test("returns undefined when no slash is present (no property name)", () => {
            expect(parse_property_reference(["status"])).toBeUndefined();
        });
    });

    // ── format_type ────────────────────────────────────────────────────

    describe("format_type", () => {
        test("number", () => {
            expect(format_type({ kind: "number", subtype: "int" })).toBe("number");
        });

        test("string", () => {
            expect(format_type({ kind: "string" })).toBe("string");
        });

        test("bool", () => {
            expect(format_type({ kind: "bool" })).toBe("bool");
        });

        test("enum with string options", () => {
            expect(format_type({ kind: "enum", options: [{ value: "okay" }, { value: "disabled" }] }))
                .toBe("enum(okay | disabled)");
        });

        test("enum with display_string options", () => {
            expect(format_type({ kind: "enum", options: [{ value: 0, display_string: "IRQ_TYPE_NONE" }] }))
                .toBe("enum(IRQ_TYPE_NONE)");
        });

        test("array of numbers", () => {
            expect(format_type({ kind: "array", items: { kind: "number", subtype: "int" } }))
                .toBe("number[]");
        });

        test("tuple", () => {
            expect(format_type({
                kind: "tuple",
                items: [
                    { kind: "number", subtype: "int" },
                    { kind: "enum", options: [{ value: "IRQ_TYPE_EDGE_FALLING" }] },
                ],
            })).toBe("(number, enum(IRQ_TYPE_EDGE_FALLING))");
        });

        test("nested array of enums", () => {
            expect(format_type({
                kind: "array",
                items: { kind: "enum", options: [{ value: 0 }, { value: 1 }] },
            })).toBe("enum(0 | 1)[]");
        });
    });

    // ── slot_message ───────────────────────────────────────────────────

    describe("slot_message", () => {
        const board_yaml = `
schema_version: 3
board: TEST-BOARD
host: test
gpio_controller: "&gpio"
buses:
  spi0:
    node: "&spi0"
    chip_selects:
      0: {gpio: 8, user: [slot_a.cs, slot_b.cs]}
      1: {gpio: 7, user: slot_b.cs2}
      2: {gpio: 20, user: slot_a.cs2}
  i2c1:
    node: "&i2c1"
slots:
  slot_a:
    bus: "&spi0"
    reg: 0
    signals:
      cs2: {kind: chip-select, gpio: 20, reg: 2}
      int: {kind: interrupt, gpio: 19}
  slot_b:
    bus: "&spi0"
    reg: 0
    signals:
      cs2: {kind: chip-select, gpio: 7, reg: 1}
  slot_c:
    bus: "&i2c1"
    signals: {}`;

        const base_dts = `/dts-v1/;
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
        i2c1: i2c@7e804000 {
            compatible = "brcm,bcm2835-i2c";
            #address-cells = <1>;
            #size-cells = <0>;
        };
        spi1: spi@7e215080 {
            compatible = "brcm,bcm2835-aux-spi";
            #address-cells = <1>;
            #size-cells = <0>;
        };
    };
};`;

        const board_desc = parse_board_description(board_yaml);
        if (typeof board_desc === "string") { throw new TypeError(board_desc); }
        const dt = DeviceTree.new_from_string(base_dts);
        if (typeof dt === "string") { throw new TypeError(dt); }
        const layer = board_layer(board_desc);

        test("narrowed slot — reports the single slot", () => {
            const placement: NodePlacement = {
                node_path: "/soc/spi@7e204000/dev@2",
                parent_path: "/soc/spi@7e204000",
                reg: 2n,
                siblings: [],
            };
            const { message, severity } = slot_message(layer, dt, placement, 3);
            expect(severity).toBe("info");
            expect(message).toContain("narrowed to slot_a");
            expect(message).toContain("Found 3 value(s)");
        });

        test("ambiguous slots — warns and lists slot ids", () => {
            const placement: NodePlacement = {
                node_path: "/soc/spi@7e204000/dev@0",
                parent_path: "/soc/spi@7e204000",
                reg: 0n,
                siblings: [],
            };
            const { message, severity } = slot_message(layer, dt, placement, 2);
            expect(severity).toBe("warn");
            expect(message).toContain("ambiguous");
            expect(message).toContain("slot_a");
            expect(message).toContain("slot_b");
        });

        test("off-board bus — zero results warns about parent", () => {
            const placement: NodePlacement = {
                node_path: "/soc/spi@7e215080/dev@0",
                parent_path: "/soc/spi@7e215080",
                reg: 0n,
                siblings: [],
            };
            const { message, severity } = slot_message(layer, dt, placement, 0);
            expect(severity).toBe("warn");
            expect(message).toContain("not a bus");
        });

        test("off-board bus — nonzero results returns info", () => {
            const placement: NodePlacement = {
                node_path: "/soc/spi@7e215080/dev@0",
                parent_path: "/soc/spi@7e215080",
                reg: 0n,
                siblings: [],
            };
            const { message, severity } = slot_message(layer, dt, placement, 1);
            expect(severity).toBe("info");
            expect(message).toContain("Found 1 value(s)");
        });

        test("bus node — reports bus info with cs-gpios", () => {
            const placement: NodePlacement = {
                node_path: "/soc/spi@7e204000",
                parent_path: "/soc",
                siblings: [],
            };
            const { message, severity } = slot_message(layer, dt, placement, 1);
            expect(severity).toBe("info");
            expect(message).toContain("spi0 is a bus");
            expect(message).toContain("provides cs-gpios");
        });

        test("unwired reg — warns about chip select not on board", () => {
            const placement: NodePlacement = {
                node_path: "/soc/spi@7e204000/dev@7",
                parent_path: "/soc/spi@7e204000",
                reg: 7n,
                siblings: [],
            };
            const { message, severity } = slot_message(layer, dt, placement, 3);
            expect(severity).toBe("warn");
            expect(message).toContain("reg 7 is not a chip select wired");
            expect(message).toContain("board wires 0, 1, 2");
        });

        test("slotless bus — warns with reserved addresses", () => {
            const board_with_reserved = board_yaml.replace(
                "  i2c1:\n    node: \"&i2c1\"",
                "  i2c1:\n    node: \"&i2c1\"\n  i2c0:\n    node: \"&i2c0\"\n    reserved_addresses: {0x50: \"HAT ID EEPROM\"}"
            );
            const base_with_extra_bus = base_dts.replace(
                "        spi1:",
                "        i2c0: i2c@7e205000 {\n            compatible = \"brcm,bcm2835-i2c\";\n            #address-cells = <1>;\n            #size-cells = <0>;\n        };\n        spi1:"
            );
            const board2 = parse_board_description(board_with_reserved);
            if (typeof board2 === "string") { throw new TypeError(board2); }
            const dt2 = DeviceTree.new_from_string(base_with_extra_bus);
            if (typeof dt2 === "string") { throw new TypeError(dt2); }
            const layer2 = board_layer(board2);

            const placement: NodePlacement = {
                node_path: "/soc/i2c@7e205000/dev@48",
                parent_path: "/soc/i2c@7e205000",
                reg: 0x48n,
                siblings: [],
            };
            const { message, severity } = slot_message(layer2, dt2, placement, 0);
            expect(severity).toBe("warn");
            expect(message).toContain("has no slots");
            expect(message).toContain("HAT ID EEPROM");
        });

        test("bus node without chip selects — reports no values", () => {
            const placement: NodePlacement = {
                node_path: "/soc/i2c@7e804000",
                parent_path: "/soc",
                siblings: [],
            };
            const { message, severity } = slot_message(layer, dt, placement, 0);
            expect(severity).toBe("info");
            expect(message).toContain("no values for it");
        });
    });

    // ── placement_message ──────────────────────────────────────────────

    describe("placement_message", () => {
        test("counts distinct slots separately from total placements", () => {
            const suggestions: Suggestion[] = [
                { value: "quikeval", display_string: "quikeval — spi0" },
                { value: "quikeval", display_string: "quikeval — i2c1" },
                { value: "slot_a", display_string: "slot_a — spi0" },
            ];
            const message = placement_message("TEST-BOARD", "adi,ad7124-8", suggestions);
            expect(message).toContain("3 placement(s)");
            expect(message).toContain("2 slot(s)");
            expect(message).toContain("TEST-BOARD");
            expect(message).toContain("adi,ad7124-8");
        });
    });

    // ── no_layer_message ────────────────────────────────────────────────

    describe("no_layer_message", () => {
        test("no board — info severity", () => {
            const { message, severity } = no_layer_message("interrupts");
            expect(severity).toBe("info");
            expect(message).toBe("No layer offers values for interrupts (no board loaded)");
        });

        test("broken board — warn severity and contains the error", () => {
            const { message, severity } = no_layer_message("reg", "board foo.yaml ignored: invalid YAML");
            expect(severity).toBe("warn");
            expect(message).toContain("No layer offers values for reg");
            expect(message).toContain("board foo.yaml ignored: invalid YAML");
        });
    });

    // ── optional_board_layer ──────────────────────────────────────────

    describe("optional_board_layer", () => {
        test("nonexistent board returns board_error naming the reference", () => {
            const { layer, board_error } = optional_board_layer({ board: "/nonexistent.yaml" });
            expect(layer).toBeUndefined();
            expect(board_error).toMatch(/^board \/nonexistent\.yaml ignored: /);
        });
    });

    // ── combine_notes ──────────────────────────────────────────────────

    describe("combine_notes", () => {
        test("appends to existing note with semicolon", () => {
            expect(combine_notes("in use by spidev@0", "binding rejects it")).toBe("in use by spidev@0; binding rejects it");
        });

        test("returns addition when no existing note", () => {
            expect(combine_notes(undefined, "not defined by binding")).toBe("not defined by binding");
        });
    });
}
