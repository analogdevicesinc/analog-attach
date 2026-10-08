import { Command } from "commander";
import { DeviceTree, DeviceTreeOverlay, is_dt_flag, print_property } from "attach-lib";
import * as fs from "node:fs";

import type { LocalContext } from "../../context";
import { resolve_config } from "../../resolve-config";
import { resolve_node_identifier, not_found_message, parse_node_path, parse_property_name, overlay_print_options } from "../../utilities";
import { respond, respond_fail, input_error } from "../../protocol/output";
import { convert_node, convert_property } from "../../protocol/dt-to-protocol";
import type { Node } from "../../protocol/types";

/**
 * Find a node and optionally a property on it, printing JSON or human output.
 * Exported so `update` can delegate the "no value → read" path here.
 */
export function read_target(
    context_: LocalContext,
    overlay: DeviceTreeOverlay,
    input: string,
    path_string: string,
    property_name: string | undefined,
): void {
    const found = overlay.find_node(resolve_node_identifier(path_string, overlay));

    if (found === undefined) {
        const base = overlay.get_base_dts();
        const message = not_found_message(path_string, overlay, base ?? undefined);
        if (context_.json) {
            respond_fail({ ok: false, message, severity: "error" });
        } else {
            console.log(message);
        }
        return;
    }

    if (property_name === undefined) {
        if (context_.json) {
            respond(convert_node(found.node));
        } else {
            print_node_human(found.node);
        }
        return;
    }

    const property = found.node.properties.find(p => p.name === property_name);
    if (property === undefined) {
        const message = `Not found: ${property_name} on ${path_string}`;
        if (context_.json) {
            respond_fail({ ok: false, message, severity: "error" });
        } else {
            console.log(message);
        }
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

export function build_read_command(context_: LocalContext): Command {
    return new Command("read")
        .description("Read a node subtree or property value from the overlay")
        .argument("[path]", "Path to node (label-first or absolute)")
        .argument("[property]", "Property name")
        .action(async (path_argument: string | undefined, property_argument: string | undefined) => {
            const resolved = resolve_config(context_, ["overlay"]);
            if (resolved === undefined) { return; }
            const input = resolved.values.overlay;
            const context = resolved.config.context;

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
                if (context_.json) { input_error(`Failed to parse dtso: ${overlay}`); return; }
                console.log(`Failed to parse dtso ${input}: ${overlay}`);
                return;
            }

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
                    console.log(overlay.print(overlay_print_options(resolved.config)));
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

            read_target(context_, overlay, input, parsed_path.value, property_argument);
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
