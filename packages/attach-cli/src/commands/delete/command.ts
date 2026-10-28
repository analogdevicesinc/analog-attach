import { Command } from "commander";
import { DeviceTree, DeviceTreeOverlay, type DTNode } from "attach-lib";

import type { LocalContext } from "../../context";
import { load_workspace } from "../../config/workspace";
import { resolve_node_identifier, not_found_message } from "../../utilities";
import { respond, respond_fail, input_error } from "../../protocol/output";
import type { DeletePreview } from "../../protocol/types";

export function build_delete_command(context_: LocalContext): Command {
    return new Command("delete")
        .description("Delete a node or remove a property from the overlay")
        .argument("[path]", "Path to node (label, label-first, or absolute)")
        .argument("[property]", "Property name")
        .option("--force", "Force delete of non-leaf nodes (waterfall delete)")
        .addHelpText("after", `
Paths:
  Label:        spi0                       (a label in the base tree)
  Label-first:  spi0/adi,ad7124-8@0       (label then child segments)
  Absolute:     /soc/spi@7e204000          (full device tree path)

Examples:
  $ attach-linux delete spi0/adi,ad7124-8@0              Delete a node
  $ attach-linux delete spi0/adi,ad7124-8@0 spi-cpha     Remove a property
  $ attach-linux delete spi0 --force                      Delete all overlay children and properties`)
        .action(async (path_argument: string | undefined, property_argument: string | undefined, options) => {
            const workspace = load_workspace(context_, ["base", "overlay"]);
            if (workspace === undefined) { return; }
            const { source: devicetree, tree: base } = workspace.base;
            const { path: input, tree: overlay } = workspace.overlay;

            if (path_argument === undefined) {
                const preview = count_overlay_root(overlay);

                if (!options.force) {
                    const response: DeletePreview = {
                        ok: true,
                        message: `Would delete ${preview.node_count} node(s) and ${preview.property_count} property(ies)`,
                        severity: "warn",
                        node_count: preview.node_count,
                        property_count: preview.property_count,
                        paths: preview.paths,
                    };
                    if (context_.json) {
                        respond(response);
                    } else {
                        console.log(`Would delete ${preview.node_count} node(s) and ${preview.property_count} property(ies)`);
                        for (const p of preview.paths) { console.log(`  ${p.join("/")}`); }
                    }
                    return;
                }

                overlay.delete_all();
                workspace.overlay.save();
                if (context_.json) {
                    respond({ ok: true, message: "Deleted all overlay content", severity: "info" });
                } else {
                    console.log(`Deleted all overlay content from ${input}`);
                }
                return;
            }

            if (path_argument === "/" && property_argument === undefined) {
                if (context_.json) {
                    respond_fail({ ok: false, message: "Cannot delete the root node", severity: "error" });
                } else {
                    console.log("Refusing to delete the root node");
                }
                return;
            }

            if (property_argument !== undefined) {
                const result = remove_overlay_property(overlay, path_argument, property_argument);
                if (result === "removed") {
                    workspace.overlay.save();
                    if (context_.json) {
                        respond({ ok: true, message: `Removed ${property_argument} from ${path_argument}`, severity: "info" });
                    } else {
                        console.log(`Removed ${property_argument} from ${path_argument} in ${input}`);
                    }
                } else {
                    const message = `Not found: ${property_argument} on ${path_argument}`;
                    if (context_.json) {
                        respond_fail({ ok: false, message, severity: "error" });
                    } else {
                        console.log(message);
                    }
                }
                return;
            }

            const identifier = path_argument;

            const found = overlay.find_node(resolve_node_identifier(identifier, overlay));
            if (found !== undefined && !found.is_in_base && found.parent_node !== undefined
                && found.node.children.length > 0 && !options.force) {
                const preview = count_subtree(found.node);
                const message = `Would delete ${preview.node_count} node(s) and ${preview.property_count} property(ies)`;
                if (context_.json) {
                    const response: DeletePreview = {
                        ok: true,
                        message,
                        severity: "warn",
                        node_count: preview.node_count,
                        property_count: preview.property_count,
                        paths: preview.paths,
                    };
                    respond(response);
                } else {
                    console.log(message);
                    for (const p of preview.paths) { console.log(`  ${p.join("/")}`); }
                }
                return;
            }

            if (context_.json) {
                const result = delete_overlay_node(base, overlay, identifier);

                switch (result) {
                    case "deleted": {
                        workspace.overlay.save();
                        respond({ ok: true, message: `Deleted ${identifier}`, severity: "info" });
                        return;
                    }
                    case "not-found": {
                        const message = not_found_message(identifier, overlay, base);
                        respond_fail({ ok: false, message, severity: "error" });
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
                        console.log(not_found_message(identifier, overlay, base));
                        return;
                    }
                    case "in-base": {
                        console.log(`${identifier} is part of the base device tree (${devicetree}), not this overlay; delete only removes overlay-added nodes`);
                        return;
                    }
                    case "is-root": {
                        console.log("Refusing to delete the root node");
                        return;
                    }
                    case "deleted": {
                        workspace.overlay.save();
                        console.log(`Deleted ${identifier} from ${input}`);
                        return;
                    }
                }
            }
        });
}

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

    if (!overlay.remove_node(found.node_path)) {
        return "not-found";
    }

    return "deleted";
}

export function remove_overlay_property(
    overlay: DeviceTreeOverlay,
    node_identifier: string,
    property_name: string,
): "removed" | "not-found" {
    return overlay.remove_property(resolve_node_identifier(node_identifier, overlay), property_name)
        ? "removed"
        : "not-found";
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

    test("remove_overlay_property - removes a property added onto a base node", () => {
        const base = DeviceTree.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }

        const overlay = DeviceTreeOverlay.new_from_string(overlay_spi_with_status, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = remove_overlay_property(overlay, "spi0", "status");

        expect(result).toBe("removed");

        const output = overlay.print();

        expect(output).not.toContain('status = "okay"');
        expect(output).toContain("imu1");
        expect(output).toContain("spi0");
    });

    test("remove_overlay_property - prunes the fragment when the last property is removed", () => {
        const overlay_only_status = `/dts-v1/;
/plugin/;

&spi0 {
    status = "okay";
};`;
        const base = DeviceTree.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }

        const overlay = DeviceTreeOverlay.new_from_string(overlay_only_status, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        expect(remove_overlay_property(overlay, "spi0", "status")).toBe("removed");

        const output = overlay.print();

        expect(output).not.toContain("status");
        expect(output).not.toContain("spi0");
    });

    test("remove_overlay_property - removes a property from an overlay-added node", () => {
        const base = DeviceTree.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }

        const overlay = DeviceTreeOverlay.new_from_string(overlay_with_imu, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        expect(remove_overlay_property(overlay, "imu1", "compatible")).toBe("removed");

        const output = overlay.print();

        expect(output).not.toContain('compatible = "adi,ad7124-8"');
        expect(output).toContain("imu1");
    });

    test("remove_overlay_property - not-found for a missing property", () => {
        const base = DeviceTree.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }

        const overlay = DeviceTreeOverlay.new_from_string(overlay_with_imu, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        expect(remove_overlay_property(overlay, "imu1", "nonexistent")).toBe("not-found");
    });
}
