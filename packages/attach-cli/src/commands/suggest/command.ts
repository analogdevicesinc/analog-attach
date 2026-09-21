import { Command } from "commander";
import { Attach, DeviceTree, DeviceTreeOverlay, get_full_node_name, suggest_parents, type DTNode } from "attach-lib";
import * as fs from "node:fs";

import type { LocalContext } from "../../context";
import { load_config } from "../../config";
import { load_compat_index, save_compat_index } from "../../config";
import { find_binding, fragment_target, is_compat_index_stale, build_compat_index, resolve_node_identifier, resolve_positional_path } from "../../utilities";
import { respond, respond_fail, input_error } from "../../protocol/output";
import { attach_type_to_protocol_type } from "../../protocol/dt-to-protocol";
import { resolve_node_binding } from "../../binding-resolution";
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
    const config = load_config();
    const context = config.context;
    const overlay_path = config.overlay;
    const linux = config.linux;
    const dtSchema = config.dtSchema;

    if (context === undefined || overlay_path === undefined) {
        if (context_.json) { input_error("Tool config incomplete: context and overlay must be set"); return; }
        console.log("Missing config: context and overlay must be set");
        return;
    }

    for (const p of [context, overlay_path]) {
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

    const { node: found_node, parent_node, node_path } = searched_node;
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

    const result = binding.narrow_and_populate(found_node);
    if (result === undefined) {
        const msg = binding.origin.kind === "compatible"
            ? `Failed to narrow binding for ${binding.origin.compatible}`
            : `Failed to validate against pattern "${binding.origin.pattern}" of ${binding.origin.parent_compatible}`;
        if (context_.json) {
            respond_fail({ ok: false, message: msg, severity: "error" });
        } else {
            console.log(msg);
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

    if (context_.json) {
        const response: TypeResponse = { ok: true, message: `Type of ${property_name}`, severity: "info", type, description: property_definition.value.description };
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
