import { Command } from "commander";
import { DeviceTree, DeviceTreeOverlay, is_dt_flag, print_property } from "attach-lib";
import * as fs from "node:fs";

import type { LocalContext } from "../../context";
import { load_config } from "../../config";
import { resolve_node_identifier } from "../../utilities";
import { respond, respond_fail, input_error } from "../../protocol/output";
import { convert_node, convert_property } from "../../protocol/dt-to-protocol";
import type { Node } from "../../protocol/types";

export function build_read_command(context_: LocalContext): Command {
    return new Command("read")
        .description("Read a node subtree or property value from the overlay")
        .option("--overlay <value>", "dtso")
        .option("--context <value>", "The target dts")
        .argument("[path...]", "Path to node or property (ValidIdentifier segments)")
        .action(async (path: string[], options) => {
            const config = load_config();
            const input = options.overlay ?? config.overlay;
            const context = options.context ?? config.context;

            if (input === undefined) {
                if (context_.json) { input_error("Missing: overlay (not configured)"); return; }
                console.log("Missing: --overlay (no config.toml found)");
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
                if (context_.json) { input_error(`Failed to parse dtso: ${overlay}`); return; }
                console.log(`Failed to parse dtso ${input}: ${overlay}`);
                return;
            }

            if (path.length === 0) {
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
                    console.log(overlay.print());
                }
                return;
            }

            const identifier = path.join("/");

            const last_segment = path.at(-1)!;
            const node_path = path.slice(0, -1);

            const found = overlay.find_node(resolve_node_identifier(identifier, overlay));

            if (found !== undefined) {
                if (context_.json) {
                    respond(convert_node(found.node));
                } else {
                    print_node_human(found.node);
                }
                return;
            }

            if (node_path.length === 0) {
                if (context_.json) {
                    respond_fail({ ok: false, message: `Not found: ${identifier}`, severity: "error" });
                } else {
                    console.log(`Couldn't find ${identifier} in ${input}`);
                }
                return;
            }

            const parent_identifier = node_path.join("/");
            const parent_found = overlay.find_node(resolve_node_identifier(parent_identifier, overlay));

            if (parent_found === undefined) {
                if (context_.json) {
                    respond_fail({ ok: false, message: `Not found: ${identifier}`, severity: "error" });
                } else {
                    console.log(`Couldn't find ${parent_identifier} in ${input}`);
                }
                return;
            }

            const property = parent_found.node.properties.find(p => p.name === last_segment);
            if (property === undefined) {
                if (context_.json) {
                    respond_fail({ ok: false, message: `Not found: ${identifier}`, severity: "error" });
                } else {
                    console.log(`Couldn't find ${last_segment} in ${parent_identifier} in ${input}`);
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
        });
}

function print_node_human(node: { name: string; unit_addr?: string; properties: any[]; children: any[] }, indent: string = ""): void {
    const key = node.unit_addr ? `${node.name}@${node.unit_addr}` : node.name;
    console.log(`${indent}${key} {`);
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
