import { Command } from "commander";
import { DeviceTree, DeviceTreeOverlay, NodeBuilder, PropertyBuilder, type DTProperty } from "attach-lib";

import * as fs from 'node:fs';

import type { LocalContext } from "../../context";
import { find_binding, resolve_node_identifier } from "../../utilities";
import { load_config } from "../../config";
import { respond, respond_fail, input_error } from "../../protocol/output";
import type { AddResponse } from "../../protocol/types";

export type AddResult =
    | { status: "added"; key: string; path: string[] }
    | { status: "parent-not-found" };

export function build_add_command(context_: LocalContext): Command {
    return new Command("add")
        .description("Add a new node to an existing dtso")
        .option("--name <value>", "Node name (e.g. channel@0); defaults to the positional key")
        .option("--to <value...>", "Parent node: label, &label, path, &{path}, or label/child")
        .option("--label <value>", "Label to attach to the new node (e.g. imu1)")
        .option("--overlay <value>", "Path to the dtso file (falls back to config.toml)")
        .option("--context <value>", "The target dts (falls back to config.toml)")
        .option("--linux <value>", "Path to Linux repo (falls back to config.toml)")
        .option("--dt-schema <value>", "Path to dt-schema repo (falls back to config.toml)")
        .argument("[keys...]", "Device key / compatible string of the device binding to add")
        .action(async (keys: string[], options) => {
            const config = load_config();
            const linux = options.linux ?? config.linux;
            const dtSchema = options.dtSchema ?? config.dtSchema;
            const context = options.context ?? config.context;
            const input = options.overlay ?? config.overlay;
            const key = keys[0];
            const { name, label } = options;
            const to: string | undefined = options.to === undefined ? undefined : (options.to as string[]).join("/");

            if (key === undefined && name === undefined) {
                if (context_.json) { input_error("key or --name required"); return; }
                console.log("Missing: key (positional) or --name (at least one is required)");
                return;
            }

            if (linux === undefined) {
                if (context_.json) { input_error("--linux not set (run config-set)"); return; }
                console.log("Missing: --linux (no config.toml found)");
                return;
            }

            if (dtSchema === undefined) {
                if (context_.json) { input_error("--dt-schema not set (run config-set)"); return; }
                console.log("Missing: --dt-schema (no config.toml found)");
                return;
            }

            if (context === undefined) {
                if (context_.json) { input_error("--context not set (run config-set)"); return; }
                console.log("Missing: --context (no config.toml found)");
                return;
            }

            if (input === undefined) {
                if (context_.json) { input_error("--overlay not set (run config-set)"); return; }
                console.log("Missing: --overlay (no config.toml found)");
                return;
            }

            if (!fs.existsSync(context)) {
                if (context_.json) { input_error(`Missing: ${context}`); return; }
                console.log(`Missing: ${context}`);
                return;
            }

            if (!fs.existsSync(linux)) {
                if (context_.json) { input_error(`Missing: ${linux}`); return; }
                console.log(`Missing: ${linux}`);
                return;
            }

            if (!fs.existsSync(dtSchema)) {
                if (context_.json) { input_error(`Missing: ${dtSchema}`); return; }
                console.log(`Missing: ${dtSchema}`);
                return;
            }

            if (!fs.existsSync(input)) {
                if (context_.json) { input_error(`Missing: ${input}`); return; }
                console.log(`Missing: ${input} (use "create-workfile" to generate a new overlay first)`);
                return;
            }

            const context_content = fs.readFileSync(context, 'utf8');
            const base = DeviceTree.new_from_string(context_content);

            if (typeof base === "string") {
                if (context_.json) { input_error(`Failed to parse dts ${context}: ${base}`); return; }
                console.log(`Failed to parse dts ${context}: ${base}`);
                return;
            }

            const input_content = fs.readFileSync(input, 'utf8');
            const overlay = DeviceTreeOverlay.new_from_string(input_content, base);

            if (typeof overlay === "string") {
                if (context_.json) { input_error(`Failed to parse dtso ${input}: ${overlay}`); return; }
                console.log(`Failed to parse dtso ${input}: ${overlay}`);
                return;
            }

            if (key !== undefined) {
                const binding_path = await find_binding(linux, dtSchema, key, context_.json);

                if (binding_path === undefined) {
                    if (context_.json) {
                        respond_fail({ ok: false, message: `Failed to find binding for ${key}`, severity: "error" });
                        return;
                    }
                    console.log(`Failed to find binding for ${key}`);
                    return;
                }
            }

            const node_name = name ?? key!;
            const result = add_overlay_node(base, overlay, node_name, to, label, key);

            switch (result.status) {
                case "parent-not-found": {
                    if (context_.json) {
                        respond_fail({ ok: false, message: `Parent node ${to} not found`, severity: "error" });
                        return;
                    }
                    console.log(`Couldn't find parent node ${to} in ${context} or ${input}`);
                    return;
                }
                case "added": {
                    fs.writeFileSync(input, overlay.print());
                    if (context_.json) {
                        const response: AddResponse = {
                            ok: true,
                            message: `Added ${node_name}`,
                            severity: "info",
                            key: result.key,
                            path: result.path,
                        };
                        respond(response);
                        return;
                    }
                    console.log(`Added ${node_name} to ${input}`);
                    return;
                }
            }
        });
}

// TODO: this will gladly add 2 nodes with the same name to the same parent => BUG!
export function add_overlay_node(
    base: DeviceTree,
    overlay: DeviceTreeOverlay,
    node_name: string,
    parent_identifier: string | undefined,
    label: string | undefined,
    compatible: string | undefined,
): AddResult {

    const compatible_property: DTProperty | undefined = (() => {
        if (compatible === undefined) {
            return;
        }

        return PropertyBuilder.build_string()
            .with_value(compatible)
            .with_name("compatible")
            .build();
    })();

    const at = node_name.indexOf('@');
    const name = at === -1 ? node_name : node_name.slice(0, at);
    const unit = at === -1 ? undefined : node_name.slice(at + 1);

    const node_key = unit === undefined ? name : `${name}@${unit}`;

    const new_node = NodeBuilder.new()
        .with_name(name)
        .with_unit_address(unit)
        .with_label(label ?? [])
        .with_properties(compatible_property);

    if (parent_identifier === undefined) {
        // eslint-disable-next-line unicorn/no-useless-undefined
        overlay.add_fragment({ kind: "path", labels: [], path: "/" }, new_node, undefined);

        const found = overlay.find_node(
            label === undefined
                ? { kind: "label", labels: [], name: name }
                : { kind: "label", labels: [], name: label }
        );
        const path_segments = found === undefined ? [node_key] : found.node_path.split("/").filter(Boolean);

        return { status: "added", key: node_key, path: path_segments };
    }

    const in_overlay = overlay.find_node(resolve_node_identifier(parent_identifier, overlay));
    if (in_overlay !== undefined) {
        in_overlay.node.children.push(new_node.build());

        const found = overlay.find_node(
            label === undefined
                ? { kind: "path", labels: [], path: `${in_overlay.node_path}/${node_key}` }
                : { kind: "label", labels: [], name: label }
        );
        const path_segments = found === undefined ? [node_key] : found.node_path.split("/").filter(Boolean);

        return { status: "added", key: node_key, path: path_segments };
    }

    const in_base = base.resolve_identifier(parent_identifier);
    if (in_base === undefined) {
        return { status: "parent-not-found" };
    }

    // eslint-disable-next-line unicorn/no-useless-undefined
    overlay.add_fragment(in_base, new_node, undefined);

    const found = overlay.find_node(
        label === undefined
            ? { kind: "label", labels: [], name: name }
            : { kind: "label", labels: [], name: label }
    );
    const path_segments = found === undefined ? [node_key] : found.node_path.split("/").filter(Boolean);

    return { status: "added", key: node_key, path: path_segments };
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;
    const { DeviceTree: DT, DeviceTreeOverlay: DTO_cls } = await import('attach-lib');

    const base_dts = `/dts-v1/;
/ {
    soc {
        spi0: spi@7e204000 {
        };
        spi1: spi@7e205000 {
        };
    };
};`;

    const empty_overlay = `/dts-v1/;
/plugin/;

&spi0 {
};`;

    test("add_overlay_node - adds node to existing overlay fragment", () => {
        const base = DT.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }

        const overlay = DTO_cls.new_from_string(empty_overlay, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = add_overlay_node(base, overlay, "adi,ad7124-8@0", "spi0", "imu1", "adi,ad7124-8");

        expect(result.status).toBe("added");
        if (result.status !== "added") { return; }
        expect(result.key).toBe("adi,ad7124-8@0");
        expect(result.path.length).toBeGreaterThan(0);

        const output = overlay.print();

        expect(output).toContain("adi,ad7124-8@0");
        expect(output).toContain('compatible = "adi,ad7124-8"');
        expect(output).toContain("spi0");
    });

    test("add_overlay_node - creates new fragment when parent not yet in overlay", () => {
        const base = DT.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }

        const overlay = DTO_cls.new_from_string(empty_overlay, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = add_overlay_node(base, overlay, "adi,ad7124-8@0", "spi1", "imu2", "adi,ad7124-8");

        expect(result.status).toBe("added");
        if (result.status !== "added") { return; }
        expect(result.key).toBe("adi,ad7124-8@0");

        const output = overlay.print();

        expect(output).toContain("adi,ad7124-8@0");
        expect(output).toContain("spi1");
    });

    test("add_overlay_node - adds to root when no parent specified", () => {
        const base = DT.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }

        const overlay = DTO_cls.new_from_string(empty_overlay, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        // eslint-disable-next-line unicorn/no-useless-undefined
        const result = add_overlay_node(base, overlay, "my-device", undefined, undefined, undefined);

        expect(result.status).toBe("added");
        if (result.status !== "added") { return; }
        expect(result.key).toBe("my-device");

        const output = overlay.print();

        expect(output).toContain("my-device");
    });

    test("add_overlay_node - returns parent-not-found for unknown parent", () => {
        const base = DT.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }

        const overlay = DTO_cls.new_from_string(empty_overlay, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = add_overlay_node(base, overlay, "adi,ad7124-8@0", "i2c0", "imu1", "adi,ad7124-8");
        expect(result.status).toBe("parent-not-found");
    });

    test("add_overlay_node - adds grandchild to overlay-added parent", () => {
        const overlay_with_imu = `/dts-v1/;
/plugin/;

&spi0 {
    imu1: adi,ad7124-8@0 {
        compatible = "adi,ad7124-8";
    };
};`;
        const base = DT.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }

        const overlay = DTO_cls.new_from_string(overlay_with_imu, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        // eslint-disable-next-line unicorn/no-useless-undefined
        const result = add_overlay_node(base, overlay, "channel@0", "imu1", undefined, undefined);

        expect(result.status).toBe("added");
        if (result.status !== "added") { return; }
        expect(result.key).toBe("channel@0");

        const output = overlay.print();

        expect(output).toContain("channel@0");
        expect(output).toContain("imu1");
    });
}
