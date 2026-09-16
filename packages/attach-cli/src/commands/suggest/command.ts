import { Command } from "commander";
import { Attach, DeviceTree, DeviceTreeOverlay, is_dt_flag, suggest_parents, dt_to_validator_input } from "attach-lib";
import * as fs from "node:fs";

import type { LocalContext } from "../../context";
import { load_config } from "../../config";
import { load_compat_index, save_compat_index } from "../../config";
import { find_binding, is_compat_index_stale, build_compat_index, resolve_node_identifier, resolve_positional_path, bigIntReplacer } from "../../utilities";
import { respond, respond_fail, input_error } from "../../protocol/output";
import { attach_type_to_protocol_type } from "../../protocol/dt-to-protocol";
import type { TypeResponse } from "../../protocol/types";

export function build_suggest_command(context: LocalContext): Command {
    return new Command("suggest")
        .description("Provide suggestions for a given intelligence kind")
        .argument("[args...]", "kind followed by kind-specific args")
        .action(async (arguments_: string[]) => {
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
                case "type": {
                    await suggest_type(context, arguments_.slice(1));
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
        });
}

async function suggest_parent(context_: LocalContext, arguments_: string[]): Promise<void> {
    const compatible = arguments_[0];
    if (compatible === undefined) {
        if (context_.json) { input_error("compatible string is required for parent suggestions"); return; }
        console.log("Missing: compatible string");
        return;
    }

    const config = load_config();
    const linux = config.linux;
    const dtSchema = config.dtSchema;
    const context = config.context;

    if (linux === undefined || dtSchema === undefined || context === undefined) {
        if (context_.json) { input_error("Tool config incomplete: linux, dt-schema, and context must be set"); return; }
        console.log("Missing config: linux, dt-schema, and context must be set");
        return;
    }

    if (!fs.existsSync(context) || !fs.existsSync(linux) || !fs.existsSync(dtSchema)) {
        if (context_.json) { input_error("Configured path does not exist"); return; }
        console.log("One or more configured paths do not exist");
        return;
    }

    const context_content = fs.readFileSync(context, "utf8");
    const dt = DeviceTree.new_from_string(context_content);

    if (typeof dt === "string") {
        if (context_.json) { input_error(`Failed to parse dts: ${dt}`); return; }
        console.log(`Failed to parse dts ${context}: ${dt}`);
        return;
    }

    const binding_path = await find_binding(linux, dtSchema, compatible, context_.json);
    if (binding_path === undefined) {
        if (context_.json) {
            respond({ ok: true, message: `No binding found for ${compatible}`, severity: "warn", suggestions: [] });
        } else {
            console.log(`Failed to find binding for ${compatible}`);
        }
        return;
    }

    const attach = Attach.new();
    const binding = await attach.parse_binding(binding_path, linux, dtSchema);

    if (binding === undefined) {
        if (context_.json) {
            respond_fail({ ok: false, message: `Failed to parse binding ${binding_path}`, severity: "error" });
        } else {
            console.log(`Failed to parse binding ${binding_path}`);
        }
        return;
    }

    const parents = suggest_parents(dt, binding.parsed_binding);

    if (context_.json) {
        const suggestions = parents.map(p => ({
            value: p.label ?? p.path.join("/"),
            display_string: p.path.join("/"),
        }));
        respond({ ok: true, message: `Found ${suggestions.length} valid parents`, severity: "info", suggestions });
    } else {
        console.log(JSON.stringify(parents));
    }
}

async function suggest_device_key(context: LocalContext, arguments_: string[]): Promise<void> {
    const filter = arguments_[0];

    let index = load_compat_index();
    const config = load_config();

    if (index === undefined) {
        if (config.linux === undefined || config.dtSchema === undefined) {
            if (context.json) { input_error("No compat-index.json found and linux/dt-schema not configured. Run 'attach config-set' first."); return; }
            console.log("No compat-index.json found and linux/dt-schema not configured. Run 'attach config-set' first.");
            return;
        }

        const entries = await build_compat_index(config.linux, config.dtSchema);
        save_compat_index(entries);
        index = { generated_at: Date.now(), entries };
    } else if (config.linux !== undefined && config.dtSchema !== undefined && is_compat_index_stale(index, config.linux, config.dtSchema)) {
        const entries = await build_compat_index(config.linux, config.dtSchema);
        save_compat_index(entries);
        index = { generated_at: Date.now(), entries };
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

    const config = load_config();
    const linux = config.linux;
    const dtSchema = config.dtSchema;
    const context = config.context;
    const overlay_path = config.overlay;

    if (linux === undefined || dtSchema === undefined || context === undefined || overlay_path === undefined) {
        if (context_.json) { input_error("Tool config incomplete: linux, dt-schema, context, and overlay must be set"); return; }
        console.log("Missing config: linux, dt-schema, context, and overlay must be set");
        return;
    }

    for (const p of [linux, dtSchema, context, overlay_path]) {
        if (!fs.existsSync(p)) {
            if (context_.json) { input_error(`Configured path does not exist: ${p}`); return; }
            console.log(`Configured path does not exist: ${p}`);
            return;
        }
    }

    const base_dt = DeviceTree.new_from_string(fs.readFileSync(context, "utf8"));
    if (typeof base_dt === "string") {
        if (context_.json) { input_error(`Failed to parse dts: ${base_dt}`); return; }
        console.log(`Failed to parse dts ${context}: ${base_dt}`);
        return;
    }

    const overlay = DeviceTreeOverlay.new_from_string(fs.readFileSync(overlay_path, "utf8"), base_dt);
    if (typeof overlay === "string") {
        if (context_.json) { input_error(`Failed to parse dtso: ${overlay}`); return; }
        console.log(`Failed to parse dtso ${overlay_path}: ${overlay}`);
        return;
    }

    const found = overlay.find_node(resolve_node_identifier(identifier, overlay));
    if (found === undefined) {
        if (context_.json) {
            respond_fail({ ok: false, message: `Node ${identifier} not found`, severity: "error" });
        } else {
            console.log(`Node not found: ${identifier}`);
        }
        return;
    }

    const { node: found_node } = found;
    const existing_keys = new Set(found_node.properties.map(p => p.name));

    const compatible_property = found_node.properties.find(p => p.name === "compatible");
    if (compatible_property === undefined) {
        if (context_.json) {
            // TODO: not 100% sure this is right, maybe we should suggest the basic, always present, properties
            respond_fail({ ok: true, message: `Node ${identifier} has no compatible property`, severity: "warn" });
        } else {
            console.log(`Node ${identifier} has no compatible property`);
        }
        return;
    }

    const compatible_value = (() => {
        if (is_dt_flag(compatible_property.value)) { return; }
        const first = compatible_property.value[0];
        if (first === undefined || first.kind !== "string") { return; }
        return first.value;
    })();

    if (compatible_value === undefined) {
        if (context_.json) {
            respond_fail({ ok: false, message: `Unexpected compatible value on ${identifier}`, severity: "error" });
        } else {
            console.log(`Unexpected compatible value on ${identifier}`);
        }
        return;
    }

    const binding_path = await find_binding(linux, dtSchema, compatible_value, context_.json);
    if (binding_path === undefined) {
        if (context_.json) {
            respond({ ok: true, message: `No binding found for ${compatible_value}`, severity: "warn", suggestions: [] });
        } else {
            console.log(`Failed to find binding for ${compatible_value}`);
        }
        return;
    }

    const attach = Attach.new();
    const binding = await attach.parse_binding(binding_path, linux, dtSchema);
    if (binding === undefined) {
        if (context_.json) {
            respond_fail({ ok: false, message: `Failed to parse binding ${binding_path}`, severity: "error" });
        } else {
            console.log(`Failed to parse binding ${binding_path}`);
        }
        return;
    }

    const required = new Set(binding.parsed_binding.required_properties);
    const all_properties = binding.parsed_binding.properties;

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

async function suggest_type(context_: LocalContext, arguments_: string[]): Promise<void> {
    const full_path = arguments_.join("/");
    const last_slash = full_path.lastIndexOf("/");
    const property_name = last_slash === -1 ? "" : full_path.slice(last_slash + 1);
    const node_identifier = last_slash > 0
        ? full_path.slice(0, last_slash)
        : (last_slash === 0 ? "/" : "");

    if (!property_name || !node_identifier) {
        if (context_.json) { input_error("prop-ref must contain a node reference and a property name"); return; }
        console.log("Missing: prop-ref (node reference followed by property name)");
        return;
    }

    const config = load_config();
    const linux = config.linux;
    const dtSchema = config.dtSchema;
    const context = config.context;
    const overlay_path = config.overlay;

    if (linux === undefined || dtSchema === undefined || context === undefined || overlay_path === undefined) {
        if (context_.json) { input_error("Tool config incomplete: linux, dt-schema, context, and overlay must be set"); return; }
        console.log("Missing config: linux, dt-schema, context, and overlay must be set");
        return;
    }

    for (const p of [linux, dtSchema, context, overlay_path]) {
        if (!fs.existsSync(p)) {
            if (context_.json) { input_error(`Configured path does not exist: ${p}`); return; }
            console.log(`Configured path does not exist: ${p}`);
            return;
        }
    }

    const base_dt = DeviceTree.new_from_string(fs.readFileSync(context, "utf8"));
    if (typeof base_dt === "string") {
        if (context_.json) { input_error(`Failed to parse dts: ${base_dt}`); return; }
        console.log(`Failed to parse dts ${context}: ${base_dt}`);
        return;
    }

    const overlay = DeviceTreeOverlay.new_from_string(fs.readFileSync(overlay_path, "utf8"), base_dt);
    if (typeof overlay === "string") {
        if (context_.json) { input_error(`Failed to parse dtso: ${overlay}`); return; }
        console.log(`Failed to parse dtso ${overlay_path}: ${overlay}`);
        return;
    }

    const searched_node = overlay.find_node(resolve_node_identifier(node_identifier, overlay));
    if (searched_node === undefined) {
        if (context_.json) {
            respond_fail({ ok: false, message: `Node ${node_identifier} not found`, severity: "error" });
        } else {
            console.log(`Node not found: ${node_identifier}`);
        }
        return;
    }

    const { node: found_node } = searched_node;
    const parent = found_node.labels.at(-1) ?? searched_node.node_path;
    const compatible_property = found_node.properties.find(p => p.name === "compatible");
    if (compatible_property === undefined) {
        if (context_.json) {
            respond_fail({ ok: false, message: `Node ${node_identifier} has no compatible property`, severity: "error" });
        } else {
            console.log(`Node ${node_identifier} has no compatible property`);
        }
        return;
    }

    const compatible_value = (() => {
        if (is_dt_flag(compatible_property.value)) { return; }
        const first = compatible_property.value[0];
        if (first === undefined || first.kind !== "string") { return; }
        return first.value;
    })();

    if (compatible_value === undefined) {
        if (context_.json) {
            respond_fail({ ok: false, message: `Unexpected compatible value on ${node_identifier}`, severity: "error" });
        } else {
            console.log(`Unexpected compatible value on ${node_identifier}`);
        }
        return;
    }

    const binding_path = await find_binding(linux, dtSchema, compatible_value, context_.json);
    if (binding_path === undefined) {
        if (context_.json) {
            respond_fail({ ok: false, message: `No binding found for ${compatible_value}`, severity: "error" });
        } else {
            console.log(`Failed to find binding for ${compatible_value}`);
        }
        return;
    }

    const initial = await Attach.new_populated_binding(binding_path, linux, dtSchema, base_dt, found_node, parent);
    if (initial === undefined) {
        if (context_.json) {
            respond_fail({ ok: false, message: `Failed to parse binding ${binding_path}`, severity: "error" });
        } else {
            console.log(`Failed to parse binding ${binding_path}`);
        }
        return;
    }

    const input_data = Object.fromEntries(dt_to_validator_input(found_node, initial.parsed_binding));
    const update = initial.attach.update_binding_by_changes(JSON.stringify(input_data, bigIntReplacer));

    if (update === undefined) {
        if (context_.json) {
            respond_fail({ ok: false, message: `Failed to update binding for ${compatible_value}`, severity: "error" });
        } else {
            console.log(`Failed to update binding for ${compatible_value}`);
        }
        return;
    }

    const binding = {
        parsed_binding: Attach.populate_parsed_binding(update.binding, base_dt, JSON.stringify(input_data, bigIntReplacer), parent),
    };

    const property_definition = binding.parsed_binding.properties.find(p => p.key === property_name);
    if (property_definition === undefined) {
        if (context_.json) {
            respond_fail({ ok: false, message: `Property ${property_name} not found in ${compatible_value} binding`, severity: "error" });
        } else {
            console.log(`Property ${property_name} not found in ${compatible_value} binding`);
        }
        return;
    }

    const type = attach_type_to_protocol_type(property_definition.value);

    if (context_.json) {
        const response: TypeResponse = { ok: true, message: `Type of ${property_name}`, severity: "info", type };
        respond(response);
    } else {
        console.log(format_type(type));
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
