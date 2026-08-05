import { buildCommand } from "@stricli/core";
import { create_string_array, mergeDtso, parse_dts, parseDtso, printDtso, search_node_in_dts, type DtsDocument } from "attach-lib";

import * as fs from 'node:fs';

import { resolve_node_identifier } from "../../utilities";
import { load_config } from "../../config";

type Flags = {
    node: string,
    overlay: string,
    context?: string,
}

function make_command(status_value: "okay" | "disabled", verb: string) {
    return buildCommand({
        parameters: {
            flags: {
                node: {
                    kind: "parsed",
                    parse: String,
                    brief: "Target node: label, &label, path, &{path}, or label/child",
                },
                overlay: {
                    kind: "parsed",
                    parse: String,
                    brief: "dtso",
                },
                context: {
                    kind: "parsed",
                    parse: String,
                    brief: "The target dts",
                    optional: true,
                },
            }
        },
        docs: {
            brief: `${verb} a node in a dtso by setting status = "${status_value}"`,
        },
        async func(flags: Flags) {
            const config = load_config();
            const context = flags.context ?? config.context;
            const { node, overlay: input } = flags;

            if (context === undefined) {
                console.log("Missing: --context (no config.toml found)");
                return;
            }

            if (!fs.existsSync(context)) {
                console.log(`Missing: ${context}`);
                return;
            }

            if (!fs.existsSync(input)) {
                console.log(`Missing: ${input} (use "create" to generate a new overlay first)`);
                return;
            }

            const context_content = fs.readFileSync(context, 'utf8');

            const base_document = (() => {
                try {
                    return parse_dts(context_content);
                } catch {
                    return;
                }
            })();

            if (base_document === undefined) {
                console.log(`Failed to parse dts ${context}`);
                return;
            }

            const input_content = fs.readFileSync(input, 'utf8');

            const input_document = (() => {
                try {
                    return parseDtso(input_content);
                } catch (error) {
                    console.log(`${error}`);
                    return;
                }
            })();

            if (input_document === undefined) {
                console.log(`Failed to parse dtso ${input}`);
                return;
            }

            const merged = mergeDtso(base_document, input_content, true);

            const result = set_node_status(merged, node, status_value);

            switch (result) {
                case "not-found": {
                    console.log(`Couldn't find node ${node} in ${context} or ${input}`);
                    return;
                }
                case "done": {
                    fs.writeFileSync(input, printDtso(merged));
                    console.log(`${verb}d ${node} in ${input}`);
                    return;
                }
            }
        }
    });
}

export const enable_command = make_command("okay", "Enable");
export const disable_command = make_command("disabled", "Disable");

export function set_node_status(
    merged: DtsDocument,
    identifier: string,
    status: "okay" | "disabled",
): "done" | "not-found" {
    const resolved = resolve_node_identifier(merged, identifier);
    const found = search_node_in_dts(merged, resolved);
    if (found === undefined) { return "not-found"; }

    const node = found.found_node;
    const existing = node.properties.find((p) => p.name === "status");

    if (existing === undefined) {
        node.properties.push(create_string_array("status", status));
    } else {
        existing.value = structuredClone(create_string_array("status", status).value);
        existing.modified_by_user = true;
    }

    node.modified_by_user = true;
    return "done";
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;
    const { parse_dts: parse_dts_v } = await import('attach-lib');

    const base_dts = `/dts-v1/;
/ {
    soc {
        spi0: spi@7e204000 {
        };
    };
};`;

    const overlay_with_imu = `/dts-v1/;
/plugin/;

&spi0 {
    imu1: adi,ad7124-8@0 {
        compatible = "adi,ad7124-8";
    };
};`;

    const overlay_with_status = `/dts-v1/;
/plugin/;

&spi0 {
    status = "disabled";
};`;

    test("set_node_status - enable adds status = okay to node without one", () => {
        const base = parse_dts_v(base_dts);
        const merged = mergeDtso(base, overlay_with_imu, true);
        const result = set_node_status(merged, "spi0", "okay");
        expect(result).toBe("done");
        const output = printDtso(merged);
        expect(output).toContain('status = "okay"');
    });

    test("set_node_status - disable adds status = disabled", () => {
        const base = parse_dts_v(base_dts);
        const merged = mergeDtso(base, overlay_with_imu, true);
        const result = set_node_status(merged, "spi0", "disabled");
        expect(result).toBe("done");
        const output = printDtso(merged);
        expect(output).toContain('status = "disabled"');
    });

    test("set_node_status - overwrites existing status value", () => {
        const base = parse_dts_v(base_dts);
        const merged = mergeDtso(base, overlay_with_status, true);
        const result = set_node_status(merged, "spi0", "okay");
        expect(result).toBe("done");
        const output = printDtso(merged);
        expect(output).toContain('status = "okay"');
        expect(output).not.toContain('status = "disabled"');
    });

    test("set_node_status - returns not-found for unknown node", () => {
        const base = parse_dts_v(base_dts);
        const merged = mergeDtso(base, overlay_with_imu, true);
        const result = set_node_status(merged, "nonexistent", "okay");
        expect(result).toBe("not-found");
    });

    test("set_node_status - enable works on base-tree node (sets status in overlay)", () => {
        const base = parse_dts_v(base_dts);
        const merged = mergeDtso(base, overlay_with_imu, true);
        const result = set_node_status(merged, "spi0", "okay");
        expect(result).toBe("done");
        const output = printDtso(merged);
        expect(output).toContain("spi0");
        expect(output).toContain('status = "okay"');
    });
}
