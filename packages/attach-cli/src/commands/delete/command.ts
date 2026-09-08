import { buildCommand } from "@stricli/core";
import { DeviceTree, DeviceTreeOverlay, type DTNode } from "attach-lib";

import * as fs from 'node:fs';

import type { LocalContext } from "../../context";
import { load_config } from "../../config";
import { resolve_node_identifier } from "../../utilities";
import { respond, respond_fail, input_error } from "../../protocol/output";
import type { DeletePreview } from "../../protocol/types";

type Flags = {
    overlay?: string,
    context?: string,
    force?: boolean,
}

export const delete_command = buildCommand({
    parameters: {
        flags: {
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
            force: {
                kind: "boolean",
                brief: "Force delete of non-leaf nodes (waterfall delete)",
                optional: true,
            },
        },
        positional: {
            kind: "array" as const,
            parameter: {
                parse: String,
                brief: "Path to node or property (ValidIdentifier segments)",
            },
        },
    },
    docs: {
        brief: "Delete a node or property from an existing dtso"
    },
    async func(this: LocalContext, flags: Flags, ...path: string[]) {
        const config = load_config();
        const context = flags.context ?? config.context;
        const input = flags.overlay ?? config.overlay;

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

        if (path.length === 0) {
            const preview = count_overlay_root(overlay);

            if (!flags.force) {
                const response: DeletePreview = {
                    ok: true,
                    message: `Would delete ${preview.node_count} node(s) and ${preview.property_count} property(ies)`,
                    severity: "warn",
                    node_count: preview.node_count,
                    property_count: preview.property_count,
                    paths: preview.paths,
                };
                if (this.json) {
                    respond(response);
                } else {
                    console.log(`Would delete ${preview.node_count} node(s) and ${preview.property_count} property(ies)`);
                    for (const p of preview.paths) { console.log(`  ${p.join("/")}`); }
                }
                return;
            }

            overlay.delete_all();
            fs.writeFileSync(input, overlay.print());
            if (this.json) {
                respond({ ok: true, message: "Deleted all overlay content", severity: "info" });
            } else {
                console.log(`Deleted all overlay content from ${input}`);
            }
            return;
        }

        const identifier = path.join("/");

        if (this.json) {
            const found = overlay.find_node(resolve_node_identifier(identifier, overlay));

            if (found !== undefined && !found.is_in_base && found.parent_node !== undefined
                && found.node.children.length > 0 && !flags.force) {
                const preview = count_subtree(found.node);
                const response: DeletePreview = {
                    ok: true,
                    message: `Would delete ${preview.node_count} node(s) and ${preview.property_count} property(ies)`,
                    severity: "warn",
                    node_count: preview.node_count,
                    property_count: preview.property_count,
                    paths: preview.paths,
                };
                respond(response);
                return;
            }

            const result = delete_overlay_node(base, overlay, identifier);

            switch (result) {
                case "deleted": {
                    fs.writeFileSync(input, overlay.print());
                    respond({ ok: true, message: `Deleted ${identifier}`, severity: "info" });
                    return;
                }
                case "not-found": {
                    respond_fail({ ok: false, message: `Node ${identifier} not found`, severity: "error" });
                    return;
                }
                case "in-base": {
                    respond_fail({ ok: false, message: `${identifier} is part of the base device tree, not this overlay`, severity: "error" });
                    return;
                }
                case "is-root": {
                    respond_fail({ ok: false, message: "Cannot delete the root node without --force", severity: "error" });
                    return;
                }
            }
        } else {
            const result = delete_overlay_node(base, overlay, identifier);

            switch (result) {
                case "not-found": {
                    console.log(`Couldn't find node ${identifier} in ${input}`);
                    return;
                }
                case "in-base": {
                    console.log(`${identifier} is part of the base device tree (${context}), not this overlay; delete only removes overlay-added nodes`);
                    return;
                }
                case "is-root": {
                    console.log("Refusing to delete the root node");
                    return;
                }
                case "deleted": {
                    fs.writeFileSync(input, overlay.print());
                    console.log(`Deleted ${identifier} from ${input}`);
                    return;
                }
            }
        }
    }
});

function count_overlay_root(overlay: DeviceTreeOverlay): { node_count: number; property_count: number; paths: string[][] } {
    let node_count = 0;
    let property_count = 0;
    const paths: string[][] = [];

    for (const fragment of overlay.get_fragments()) {
        const overlay_node = fragment.children.find(c => c.name === "__overlay__");
        if (overlay_node === undefined) { continue; }

        for (const child of overlay_node.children) {
            const sub = count_subtree(child);
            node_count += sub.node_count;
            property_count += sub.property_count;
            for (const p of sub.paths) { paths.push(p); }
        }

        property_count += overlay_node.properties.length;
    }

    return { node_count, property_count, paths };
}

function count_subtree(node: DTNode): { node_count: number; property_count: number; paths: string[][] } {
    let node_count = 1;
    let property_count = node.properties.length;
    const key = node.unit_addr ? `${node.name}@${node.unit_addr}` : node.name;
    const paths: string[][] = [[key]];

    for (const child of node.children) {
        const sub = count_subtree(child);
        node_count += sub.node_count;
        property_count += sub.property_count;
        for (const p of sub.paths) {
            paths.push([key, ...p]);
        }
    }

    return { node_count, property_count, paths };
}

export function delete_overlay_node(
    base: DeviceTree,
    overlay: DeviceTreeOverlay,
    identifier: string,
): "deleted" | "not-found" | "in-base" | "is-root" {
    const found = overlay.find_node(resolve_node_identifier(identifier, overlay));

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
