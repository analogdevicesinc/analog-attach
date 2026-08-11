import { buildCommand } from "@stricli/core";
import { DeviceTree, DeviceTreeOverlay, NodeBuilder, PropertyBuilder, type DTNode, type DTProperty } from "attach-lib";

import * as fs from 'node:fs';


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
            const base = DeviceTree.new_from_string(context_content);

            if (typeof base === "string") {
                console.log(`Failed to parse dts ${context}: ${base}`);
                return;
            }

            const input_content = fs.readFileSync(input, 'utf8');
            const overlay = DeviceTreeOverlay.new_from_string(input_content, base);

            if (typeof overlay === "string") {
                console.log(`Failed to parse dtso ${input}: ${overlay}`);
                return;
            }

            const result = set_node_status(base, overlay, node, status_value);

            switch (result) {
                case "not-found": {
                    console.log(`Couldn't find node ${node} in ${context} or ${input}`);
                    return;
                }
                case "done": {
                    fs.writeFileSync(input, overlay.print());
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
    base: DeviceTree,
    overlay: DeviceTreeOverlay,
    identifier: string,
    status: "okay" | "disabled",
): "done" | "not-found" {

    const status_property = PropertyBuilder.build_string()
        .with_value(status)
        .with_name("status")
        .build();

    // Check if there's already an overlay fragment touching this node
    const found = overlay.find_node(identifier);
    if (found !== undefined) {
        const index = found.node.properties.findIndex(p => p.name === "status");

        if (index === -1) {
            found.node.properties.push(status_property);
        } else {
            found.node.properties[index] = status_property;
        }
        return "done";
    }

    // Not in any fragment — check if it exists in base and create a new fragment
    const in_base = base.resolve_identifier(identifier);
    if (in_base === undefined) {
        return "not-found";
    }

    overlay.add_fragment(in_base, undefined, status_property);

    return "done";
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;
    const { DeviceTree: DT, DeviceTreeOverlay: DTO_cls } = await import('attach-lib');

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
        const base = DT.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }

        const overlay = DTO_cls.new_from_string(overlay_with_imu, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = set_node_status(base, overlay, "spi0", "okay");

        expect(result).toBe("done");

        const output = overlay.print();

        expect(output).toContain('status = "okay"');
    });

    test("set_node_status - disable adds status = disabled", () => {
        const base = DT.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }

        const overlay = DTO_cls.new_from_string(overlay_with_imu, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = set_node_status(base, overlay, "spi0", "disabled");

        expect(result).toBe("done");

        const output = overlay.print();

        expect(output).toContain('status = "disabled"');
    });

    test("set_node_status - overwrites existing status value", () => {
        const base = DT.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }

        const overlay = DTO_cls.new_from_string(overlay_with_status, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = set_node_status(base, overlay, "spi0", "okay");

        expect(result).toBe("done");

        const output = overlay.print();

        expect(output).toContain('status = "okay"');
        expect(output).not.toContain('status = "disabled"');
    });

    test("set_node_status - returns not-found for unknown node", () => {
        const base = DT.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }

        const overlay = DTO_cls.new_from_string(overlay_with_imu, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = set_node_status(base, overlay, "nonexistent", "okay");

        expect(result).toBe("not-found");
    });

    test("set_node_status - enable works on base-tree node (sets status in overlay)", () => {
        const base = DT.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }

        const overlay = DTO_cls.new_from_string(overlay_with_imu, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = set_node_status(base, overlay, "spi0", "okay");

        expect(result).toBe("done");

        const output = overlay.print();

        expect(output).toContain("spi0");
        expect(output).toContain('status = "okay"');
    });

    test("set_node_status - creates new fragment when base node not yet in overlay", () => {
        const base = DT.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }

        // Start with an overlay that targets a different node
        const overlay_other = `/dts-v1/;\n/plugin/;\n\n&spi0 {\n};\n`;
        const overlay = DTO_cls.new_from_string(overlay_other, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        // Disable spi0 — it has an existing fragment, should update its __overlay__
        const result = set_node_status(base, overlay, "spi0", "okay");

        expect(result).toBe("done");

        const output = overlay.print();

        expect(output).toContain('status = "okay"');
    });
}
