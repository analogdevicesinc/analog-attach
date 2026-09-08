import { buildCommand } from "@stricli/core";
import {
    Attach,
    DeviceTree,
    DeviceTreeOverlay,
    is_dt_flag,
    dt_to_validator_input,
} from "attach-lib";
import * as fs from "node:fs";

import type { LocalContext } from "../../context";
import { load_config } from "../../config";
import { bigIntReplacer, find_binding, resolve_node_identifier } from "../../utilities";
import { respond, respond_fail, input_error } from "../../protocol/output";

import { set_property, parse_value } from "../set-prop/command";

type Flags = {
    with: string;
    overlay?: string;
    context?: string;
    linux?: string;
    dtSchema?: string;
};

export const update_command = buildCommand({
    parameters: {
        flags: {
            with: {
                kind: "parsed",
                parse: String,
                brief: "Value to set (raw string, parsed by the tool)",
            },
            overlay: {
                kind: "parsed",
                parse: String,
                brief: "dtso",
                optional: true,
            },
            context: {
                kind: "parsed",
                parse: String,
                brief: "The target dts",
                optional: true,
            },
            linux: {
                kind: "parsed",
                parse: String,
                brief: "Path to Linux repo",
                optional: true,
            },
            dtSchema: {
                kind: "parsed",
                parse: String,
                brief: "Path to dt-schema repo",
                optional: true,
            },
        },
        positional: {
            kind: "array" as const,
            parameter: {
                parse: String,
                brief: "Path to property: node path segments followed by property name",
            },
        },
    },
    docs: {
        brief: "Update (upsert) a property value on a node in the overlay",
    },
    async func(this: LocalContext, flags: Flags, ...path: string[]) {
        const config = load_config();
        const context = flags.context ?? config.context;
        const input = flags.overlay ?? config.overlay;
        const linux = flags.linux ?? config.linux;
        const dtSchema = flags.dtSchema ?? config.dtSchema;

        if (path.length < 2) {
            const message = "Path must include at least a node and a property name";
            if (this.json) { input_error(message); return; }
            console.log(message);
            return;
        }

        const property_name = path.at(-1)!;
        const node_identifier = path.slice(0, -1).join("/");

        if (input === undefined) {
            if (this.json) { input_error("Missing: overlay (not configured)"); return; }
            console.log("Missing: --overlay (no config.toml found)");
            return;
        }
        if (context === undefined) {
            if (this.json) { input_error("Missing: context (not configured)"); return; }
            console.log("Missing: --context (no config.toml found)");
            return;
        }
        if (linux === undefined) {
            if (this.json) { input_error("Missing: linux (not configured)"); return; }
            console.log("Missing: --linux (no config.toml found)");
            return;
        }
        if (dtSchema === undefined) {
            if (this.json) { input_error("Missing: dt-schema (not configured)"); return; }
            console.log("Missing: --dt-schema (no config.toml found)");
            return;
        }

        for (const p of [context, linux, dtSchema, input]) {
            if (!fs.existsSync(p)) {
                if (this.json) { input_error(`Missing: ${p}`); return; }
                console.log(`Missing: ${p}`);
                return;
            }
        }

        const context_content = fs.readFileSync(context, "utf8");
        const input_content = fs.readFileSync(input, "utf8");

        const base_dt = DeviceTree.new_from_string(context_content);
        if (typeof base_dt === "string") {
            if (this.json) { input_error(`Failed to parse dts: ${base_dt}`); return; }
            console.log(`Failed to parse dts ${context}: ${base_dt}`);
            return;
        }

        const overlay = DeviceTreeOverlay.new_from_string(input_content, base_dt);
        if (typeof overlay === "string") {
            if (this.json) { input_error(`Failed to parse dtso: ${overlay}`); return; }
            console.log(`Failed to parse dtso ${input}: ${overlay}`);
            return;
        }

        const searched_node = overlay.find_node(resolve_node_identifier(node_identifier, overlay));
        if (searched_node === undefined) {
            if (this.json) {
                respond_fail({ ok: false, message: `Node ${node_identifier} not found`, severity: "error" });
            } else {
                console.log(`Couldn't find ${node_identifier} in ${input}`);
            }
            return;
        }

        const { node: found_node } = searched_node;
        const parent = found_node.labels.at(-1) ?? searched_node.node_path;

        const compatible = found_node.properties.find(p => p.name === "compatible");
        if (compatible === undefined) {
            if (this.json) {
                respond_fail({ ok: false, message: `Missing compatible in ${node_identifier}`, severity: "error" });
            } else {
                console.log(`Missing compatible in ${node_identifier} from ${input}`);
            }
            return;
        }

        const compatible_value = (() => {
            if (is_dt_flag(compatible.value)) { return; }
            const first = compatible.value[0];
            if (first === undefined || first.kind !== "string") { return; }
            return first.value;
        })();

        if (compatible_value === undefined) {
            if (this.json) {
                respond_fail({ ok: false, message: `Unexpected compatible value in ${node_identifier}`, severity: "error" });
            } else {
                console.log(`Unexpected value in compatible of ${node_identifier} in ${input}`);
            }
            return;
        }

        const binding_path = await find_binding(linux, dtSchema, compatible_value);
        if (binding_path === undefined) {
            if (this.json) {
                respond_fail({ ok: false, message: `No binding found for ${compatible_value}`, severity: "error" });
            } else {
                console.log(`Failed to find binding for ${compatible_value}`);
            }
            return;
        }

        const initial = await Attach.new_populated_binding(binding_path, linux, dtSchema, base_dt, found_node, parent);
        if (initial === undefined) {
            if (this.json) {
                respond_fail({ ok: false, message: `Failed to parse binding ${binding_path}`, severity: "error" });
            } else {
                console.log(`Failed to parse binding ${binding_path}`);
            }
            return;
        }

        const input_data = Object.fromEntries(dt_to_validator_input(found_node, initial.parsed_binding));
        const update = initial.attach.update_binding_by_changes(JSON.stringify(input_data, bigIntReplacer));

        if (update === undefined) {
            if (this.json) {
                respond_fail({ ok: false, message: `Failed to update binding for ${compatible_value}`, severity: "error" });
            } else {
                console.log(`Failed to update with set compatible "${compatible_value}" for ${binding_path}`);
            }
            return;
        }

        const binding = {
            parsed_binding: Attach.populate_parsed_binding(update.binding, base_dt, JSON.stringify(input_data, bigIntReplacer), parent),
            patterns: initial.patterns,
        };

        const property_definition = binding.parsed_binding.properties.find(entry => entry.key === property_name);

        if (property_definition === undefined) {
            if (this.json) {
                respond_fail({ ok: false, message: `Property ${property_name} not found in ${compatible_value} binding`, severity: "error" });
            } else {
                console.log(`Couldn't find ${property_name} in ${compatible_value} binding`);
            }
            return;
        }

        const parsed = parse_value(flags.with);
        const success = set_property(parsed, found_node, property_name, property_definition);

        if (success) {
            fs.writeFileSync(input, overlay.print());
            if (this.json) {
                respond({ ok: true, message: `Updated ${property_name}`, severity: "info" });
            } else {
                console.log(`Set ${property_name} on ${node_identifier}`);
            }
        } else {
            if (this.json) {
                respond_fail({ ok: false, message: `Failed to set ${property_name}`, severity: "error" });
            }
        }
    },
});
