import { buildCommand } from "@stricli/core";
import { DeviceTree, DeviceTreeOverlay } from "attach-lib";

import * as fs from 'node:fs';

import type { LocalContext } from "../../context";
import { load_config } from "../../config";
import { resolve_node_identifier } from "../../utilities";
import { respond, respond_fail, input_error } from "../../protocol/output";

type Flags = {
    to: string,
    overlay?: string,
    context?: string,
}

export const rename_command = buildCommand({
    parameters: {
        flags: {
            to: {
                kind: "parsed",
                parse: String,
                brief: "New node key: 'name' preserves unit addr, 'name@unit' overrides it",
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
        },
        positional: {
            kind: "array" as const,
            parameter: {
                parse: String,
                brief: "Path to node (ValidIdentifier segments)",
            },
        },
    },
    docs: {
        brief: "Rename an overlay-added node in an existing dtso"
    },
    async func(this: LocalContext, flags: Flags, ...path: string[]) {
        const config = load_config();
        const context = flags.context ?? config.context;
        const input = flags.overlay ?? config.overlay;
        const { to } = flags;

        if (path.length === 0) {
            if (this.json) { input_error("path is required"); return; }
            console.log("Missing: path (positional arguments)");
            return;
        }

        if (context === undefined) {
            if (this.json) { input_error("missing config: context"); return; }
            console.log("Missing: --context (no config.toml found)");
            return;
        }

        if (input === undefined) {
            if (this.json) { input_error("missing config: overlay"); return; }
            console.log("Missing: --overlay (no config.toml found)");
            return;
        }

        if (!fs.existsSync(context)) {
            if (this.json) { input_error(`file not found: ${context}`); return; }
            console.log(`Missing: ${context}`);
            return;
        }

        if (!fs.existsSync(input)) {
            if (this.json) { input_error(`file not found: ${input}`); return; }
            console.log(`Missing: ${input} (use "create" to generate a new overlay first)`);
            return;
        }

        const context_content = fs.readFileSync(context, 'utf8');
        const base = DeviceTree.new_from_string(context_content);

        if (typeof base === "string") {
            if (this.json) { input_error(`failed to parse dts: ${base}`); return; }
            console.log(`Failed to parse dts ${context}: ${base}`);
            return;
        }

        const input_content = fs.readFileSync(input, 'utf8');
        const overlay = DeviceTreeOverlay.new_from_string(input_content, base);

        if (typeof overlay === "string") {
            if (this.json) { input_error(`failed to parse dtso: ${overlay}`); return; }
            console.log(`Failed to parse dtso ${input}: ${overlay}`);
            return;
        }

        const identifier = path.join("/");
        const result = rename_overlay_target(overlay, identifier, to, path);

        if (this.json) {
            switch (result) {
                case "renamed": {
                    fs.writeFileSync(input, overlay.print());
                    respond({ ok: true, message: `Renamed ${identifier} to ${to}`, severity: "info" });
                    return;
                }
                case "not-found": {
                    respond_fail({ ok: false, message: `${identifier} not found`, severity: "error" });
                    return;
                }
                case "in-base": {
                    respond_fail({ ok: false, message: `${identifier} is part of the base device tree, not this overlay`, severity: "error" });
                    return;
                }
                case "is-root": {
                    respond_fail({ ok: false, message: "Cannot rename the root node", severity: "error" });
                    return;
                }
                case "conflict": {
                    respond_fail({ ok: false, message: `${to} already exists under the same parent`, severity: "error" });
                    return;
                }
            }
        } else {
            switch (result) {
                case "not-found": {
                    console.log(`Couldn't find ${identifier} in ${input}`);
                    return;
                }
                case "in-base": {
                    console.log(`${identifier} is part of the base device tree (${context}), not this overlay; rename only applies to overlay-added nodes`);
                    return;
                }
                case "is-root": {
                    console.log("Refusing to rename the root node");
                    return;
                }
                case "conflict": {
                    console.log(`${to} already exists under the same parent`);
                    return;
                }
                case "renamed": {
                    fs.writeFileSync(input, overlay.print());
                    console.log(`Renamed ${identifier} to ${to} in ${input}`);
                    return;
                }
            }
        }
    }
});

type RenameResult = "renamed" | "not-found" | "in-base" | "is-root" | "conflict";

function rename_overlay_target(
    overlay: DeviceTreeOverlay,
    identifier: string,
    to: string,
    path: string[],
): RenameResult {
    const node_result = rename_overlay_node(overlay, identifier, to);
    if (node_result !== "not-found") { return node_result; }

    if (path.length < 2) { return "not-found"; }

    const property_name = path.at(-1)!;
    const parent_identifier = path.slice(0, -1).join("/");

    return rename_overlay_property(overlay, parent_identifier, property_name, to);
}

function rename_overlay_property(
    overlay: DeviceTreeOverlay,
    parent_identifier: string,
    property_name: string,
    new_name: string,
): RenameResult {
    const found = overlay.find_node(resolve_node_identifier(parent_identifier, overlay));
    if (found === undefined) { return "not-found"; }

    const property = found.node.properties.find(p => p.name === property_name);
    if (property === undefined) { return "not-found"; }

    const conflict = found.node.properties.some(p => p.name === new_name);
    if (conflict) { return "conflict"; }

    property.name = new_name;
    return "renamed";
}

export function rename_overlay_node(
    overlay: DeviceTreeOverlay,
    identifier: string,
    to: string,
): "renamed" | "not-found" | "in-base" | "is-root" | "conflict" {
    const found = overlay.find_node(resolve_node_identifier(identifier, overlay));

    if (found === undefined) { return "not-found"; }
    if (found.is_in_base) { return "in-base"; }
    if (found.parent_node === undefined) { return "is-root"; }

    const at = to.indexOf('@');
    const new_name = at === -1 ? to : to.slice(0, at);
    const new_unit = at === -1
        ? found.node.unit_addr
        : (to.slice(at + 1) === "" ? undefined : to.slice(at + 1));

    const siblings = found.parent_node.children;
    const collision = siblings.some(
        (s) => s !== found.node && s.name === new_name && s.unit_addr === new_unit
    );

    if (collision) { return "conflict"; }

    found.node.name = new_name;
    found.node.unit_addr = new_unit;

    return "renamed";
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

    const overlay_two_children = `/dts-v1/;
/plugin/;

&spi0 {
    imu1: adi,ad7124-8@0 {
        compatible = "adi,ad7124-8";
    };
    imu2: adi,ad7124-8@1 {
        compatible = "adi,ad7124-8";
    };
};`;

    test("rename_overlay_node - renames node key, output has new key not old", () => {
        const base = DeviceTree.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }

        const overlay = DeviceTreeOverlay.new_from_string(overlay_with_imu, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = rename_overlay_node(overlay, "imu1", "my_adc@0");

        expect(result).toBe("renamed");

        const output = overlay.print();

        expect(output).toContain("my_adc@0");
        expect(output).not.toContain("adi,ad7124-8@0");
    });

    test("rename_overlay_node - --to without @ preserves existing unit addr", () => {
        const base = DeviceTree.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }

        const overlay = DeviceTreeOverlay.new_from_string(overlay_with_imu, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = rename_overlay_node(overlay, "imu1", "my_adc");

        expect(result).toBe("renamed");

        const output = overlay.print();

        expect(output).toContain("my_adc@0");
        expect(output).not.toContain("adi,ad7124-8@0");
    });

    test("rename_overlay_node - --to with @ overrides unit addr", () => {
        const base = DeviceTree.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }

        const overlay = DeviceTreeOverlay.new_from_string(overlay_with_imu, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = rename_overlay_node(overlay, "imu1", "my_adc@3");

        expect(result).toBe("renamed");

        const output = overlay.print();

        expect(output).toContain("my_adc@3");
        expect(output).not.toContain("adi,ad7124-8@0");
    });

    test("rename_overlay_node - refuses base-tree node", () => {
        const base = DeviceTree.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }

        const overlay = DeviceTreeOverlay.new_from_string(overlay_with_imu, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = rename_overlay_node(overlay, "spi0", "spi1");

        expect(result).toBe("in-base");
    });

    test("rename_overlay_node - returns not-found for unknown label", () => {
        const base = DeviceTree.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }

        const overlay = DeviceTreeOverlay.new_from_string(overlay_with_imu, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = rename_overlay_node(overlay, "nonexistent", "foo");

        expect(result).toBe("not-found");
    });

    test("rename_overlay_node - returns conflict when new key collides with sibling", () => {
        const base = DeviceTree.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }

        const overlay = DeviceTreeOverlay.new_from_string(overlay_two_children, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = rename_overlay_node(overlay, "imu1", "adi,ad7124-8@1");

        expect(result).toBe("conflict");
    });

    test("rename_overlay_node - renames grandchild via label/child syntax", () => {
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

        const result = rename_overlay_node(overlay, "imu1/channel@0", "channel@1");

        expect(result).toBe("renamed");

        const output = overlay.print();

        expect(output).toContain("channel@1");
        expect(output).not.toContain("channel@0");
        expect(output).toContain("imu1");
    });
}
