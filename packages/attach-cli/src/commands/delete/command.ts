import { buildCommand } from "@stricli/core";
import { DeviceTree, DeviceTreeOverlay } from "attach-lib";

import * as fs from 'node:fs';


import { load_config } from "../../config";

type Flags = {
    node: string,
    overlay: string,
    context?: string,
}

export const delete_command = buildCommand({
    parameters: {
        flags: {
            node: {
                kind: "parsed",
                parse: String,
                brief: "Node to delete: label, &label, path, &{path}, or label/child",
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
        brief: "Delete an overlay-added node from an existing dtso"
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

        const result = delete_overlay_node(base, overlay, node);

        switch (result) {
            case "not-found": {
                console.log(`Couldn't find node ${node} in ${input}`);
                return;
            }
            case "in-base": {
                console.log(`${node} is part of the base device tree (${context}), not this overlay; delete only removes overlay-added nodes`);
                return;
            }
            case "is-root": {
                console.log("Refusing to delete the root node");
                return;
            }
            case "deleted": {
                fs.writeFileSync(input, overlay.print());
                console.log(`Deleted ${node} from ${input}`);
                return;
            }
        }
    }
});

export function delete_overlay_node(
    base: DeviceTree,
    overlay: DeviceTreeOverlay,
    identifier: string,
): "deleted" | "not-found" | "in-base" | "is-root" {
    const found = overlay.find_node(identifier);

    if (found === undefined) { return "not-found"; }
    if (found.is_in_base) { return "in-base"; }
    if (found.parent_node === undefined) { return "is-root"; }

    if (!overlay.remove_node({ kind: "path", labels: [], path: found.node_path })) {
        return "not-found";
    }

    return "deleted";
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

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

    const overlay_spi_with_status = `/dts-v1/;
/plugin/;

&spi0 {
    status = "okay";
    imu1: adi,ad7124-8@0 {
        compatible = "adi,ad7124-8";
    };
};`;

    test("delete_overlay_node - removes overlay-added node", () => {
        const base = DeviceTree.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }

        const overlay = DeviceTreeOverlay.new_from_string(overlay_with_imu, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = delete_overlay_node(base, overlay, "imu1");

        expect(result).toBe("deleted");

        const output = overlay.print();

        expect(output).not.toContain("imu1");
    });

    test("delete_overlay_node - &spi0 block remains when spi0 has overlay properties", () => {
        const base = DeviceTree.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }

        const overlay = DeviceTreeOverlay.new_from_string(overlay_spi_with_status, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = delete_overlay_node(base, overlay, "imu1");

        expect(result).toBe("deleted");

        const output = overlay.print();

        expect(output).not.toContain("imu1");
        expect(output).toContain("spi0");
        expect(output).toContain('status = "okay"');
    });

    test("delete_overlay_node - refuses base-tree node", () => {
        const base = DeviceTree.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }

        const overlay = DeviceTreeOverlay.new_from_string(overlay_with_imu, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = delete_overlay_node(base, overlay, "spi0");

        expect(result).toBe("in-base");
    });

    test("delete_overlay_node - returns not-found for unknown label", () => {
        const base = DeviceTree.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }

        const overlay = DeviceTreeOverlay.new_from_string(overlay_with_imu, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = delete_overlay_node(base, overlay, "nonexistent");

        expect(result).toBe("not-found");
    });

    test("delete_overlay_node - fragment pruned when __overlay__ becomes empty", () => {
        const base = DeviceTree.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }

        const overlay = DeviceTreeOverlay.new_from_string(overlay_with_imu, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = delete_overlay_node(base, overlay, "imu1");

        expect(result).toBe("deleted");

        const output = overlay.print();

        expect(output).not.toContain("imu1");
        expect(output).not.toContain("spi0");
    });

    test("delete_overlay_node - removes overlay grandchild via label/child syntax", () => {
        const overlay_nested = `/dts-v1/;
/plugin/;

&spi0 {
    imu1: adi,ad7124-8@0 {
        compatible = "adi,ad7124-8";
        channel@0 {
            reg = <0>;
        };
    };
};`;
        const base = DeviceTree.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }

        const overlay = DeviceTreeOverlay.new_from_string(overlay_nested, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = delete_overlay_node(base, overlay, "imu1/channel@0");

        expect(result).toBe("deleted");

        const output = overlay.print();

        expect(output).not.toContain("channel@0");
        expect(output).toContain("imu1");
    });
}
