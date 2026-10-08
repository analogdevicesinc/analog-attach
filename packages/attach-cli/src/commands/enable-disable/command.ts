import { Command } from "commander";
import { DeviceTree, DeviceTreeOverlay, PropertyBuilder } from "attach-lib";

import * as fs from 'node:fs';

import type { LocalContext } from "../../context";
import { load_config, check_config, check_failure_message } from "../../config";
import { load_trees, resolve_node_identifier, resolve_path, base_target, write_overlay } from "../../utilities";

function make_command(commandName: string, status_value: "okay" | "disabled", verb: string) {
    return (_context: LocalContext): Command => new Command(commandName)
        .description(`${verb} a node by setting status = "${status_value}"`)
        .argument("[path]", "Path to node (e.g. spi0, /soc/spi@7e204000, spi0/spidev@0)")
        .action(async (path_argumentument: string | undefined) => {
            if (path_argumentument === undefined) {
                console.log("Missing: path");
                return;
            }

            const config = load_config();
            if (config === undefined) {
                console.log("No config.toml (run config-set)");
                return;
            }

            const checked = check_config(config, ["overlay", "context"]);
            if (!checked.ok) {
                console.log(check_failure_message(checked).human);
                return;
            }
            const { overlay: input, context } = checked.values;

            const trees = load_trees(_context, context, input, checked.parsed.context);
            if (trees === undefined) { return; }
            const { base_dt: base, overlay } = trees;

            const result = set_node_status(base, overlay, path_argumentument, status_value);

            switch (result) {
                case "not-found": {
                    console.log(`Couldn't find node ${path_argumentument} in ${context} or ${input}`);
                    return;
                }
                case "done": {
                    write_overlay(input, overlay, config);
                    console.log(`${verb}d ${path_argumentument} in ${input}`);
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
    if (resolved.in_overlay !== undefined) {
        const index = resolved.in_overlay.node.properties.findIndex(p => p.name === "status");

        if (index === -1) {
            resolved.in_overlay.node.properties.push(status_property);
        } else {
            resolved.in_overlay.node.properties[index] = status_property;
        }
        return "done";
    }

    const base_referenceerence = base_target(resolved);
    if (base_referenceerence === undefined) {
        return "not-found";
    }

    overlay.add_fragment(base_referenceerence, undefined, status_property);

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
