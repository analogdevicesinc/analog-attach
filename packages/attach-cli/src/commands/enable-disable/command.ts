import { Command } from "commander";
import { DeviceTree, DeviceTreeOverlay, PropertyBuilder } from "attach-lib";

import type { LocalContext } from "../../context";
import { load_workspace } from "../../config/workspace";
import { resolve_path } from "../../utilities";

function make_command(commandName: string, status_value: "okay" | "disabled", verb: string) {
    return (_context: LocalContext): Command => new Command(commandName)
        .description(`${verb} a node (status = "${status_value}")`)
        .argument("[path]", "Path to node (label, label-first, or absolute)")
        .addHelpText("after", `
Paths:
  Label:        spi0                       (a label in the base tree)
  Label-first:  spi0/adi,ad7124-8@0       (label then child segments)
  Absolute:     /soc/spi@7e204000          (full device tree path)

Example:
  $ attach-linux ${commandName} spi0
  $ attach-linux ${commandName} spi0/spidev@0`)
        .action(async (path_argument: string | undefined) => {
            if (path_argument === undefined) {
                console.log("Missing: path");
                return;
            }

            const workspace = load_workspace(_context, ["base", "overlay"]);
            if (workspace === undefined) { return; }
            const { source: devicetree, tree: base } = workspace.base;
            const { path: input, tree: overlay } = workspace.overlay;

            const result = set_node_status(base, overlay, path_argument, status_value);

            switch (result) {
                case "not-found": {
                    console.log(`Couldn't find node ${path_argument} in ${devicetree} or ${input}`);
                    return;
                }
                case "done": {
                    workspace.overlay.save();
                    console.log(`${verb}d ${path_argument} in ${input}`);
                    return;
                }
            }
        });
}

export const build_enable_command = make_command("enable", "okay", "Enable");
export const build_disable_command = make_command("disable", "disabled", "Disable");

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

    const resolved = resolve_path(identifier, overlay, base);
    const path = resolved.in_overlay?.node_path ?? resolved.in_base?.path;
    const node = path === undefined ? undefined : overlay.ensure_node(path);
    if (node === undefined) { return "not-found"; }

    const index = node.properties.findIndex(p => p.name === "status");
    if (index === -1) {
        node.properties.push(status_property);
    } else {
        node.properties[index] = status_property;
    }
    return "done";
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

    const overlay_with_status = `/dts-v1/;
/plugin/;

&spi0 {
    status = "disabled";
};`;

    test("set_node_status - enable adds status = okay to node without one", () => {
        const base = DeviceTree.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }

        const overlay = DeviceTreeOverlay.new_from_string(overlay_with_imu, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = set_node_status(base, overlay, "spi0", "okay");

        expect(result).toBe("done");

        const output = overlay.print();

        expect(output).toContain('status = "okay"');
    });

    test("set_node_status - disable adds status = disabled", () => {
        const base = DeviceTree.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }

        const overlay = DeviceTreeOverlay.new_from_string(overlay_with_imu, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = set_node_status(base, overlay, "spi0", "disabled");

        expect(result).toBe("done");

        const output = overlay.print();

        expect(output).toContain('status = "disabled"');
    });

    test("set_node_status - overwrites existing status value", () => {
        const base = DeviceTree.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }

        const overlay = DeviceTreeOverlay.new_from_string(overlay_with_status, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = set_node_status(base, overlay, "spi0", "okay");

        expect(result).toBe("done");

        const output = overlay.print();

        expect(output).toContain('status = "okay"');
        expect(output).not.toContain('status = "disabled"');
    });

    test("set_node_status - returns not-found for unknown node", () => {
        const base = DeviceTree.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }

        const overlay = DeviceTreeOverlay.new_from_string(overlay_with_imu, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = set_node_status(base, overlay, "nonexistent", "okay");

        expect(result).toBe("not-found");
    });

    test("set_node_status - enable works on base-tree node (sets status in overlay)", () => {
        const base = DeviceTree.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }

        const overlay = DeviceTreeOverlay.new_from_string(overlay_with_imu, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = set_node_status(base, overlay, "spi0", "okay");

        expect(result).toBe("done");

        const output = overlay.print();

        expect(output).toContain("spi0");
        expect(output).toContain('status = "okay"');
    });

    test("set_node_status - creates new fragment when base node not yet in overlay", () => {
        const base = DeviceTree.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }

        // Start with an overlay that targets a different node
        const overlay_other = `/dts-v1/;\n/plugin/;\n\n&spi0 {\n};\n`;
        const overlay = DeviceTreeOverlay.new_from_string(overlay_other, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        // Disable spi0 — it has an existing fragment, should update its __overlay__
        const result = set_node_status(base, overlay, "spi0", "okay");

        expect(result).toBe("done");

        const output = overlay.print();

        expect(output).toContain('status = "okay"');
    });
}
