import { DeviceTree, DeviceTreeOverlay, references_to, type DTNode, type ReferenceTo } from "attach-lib";

import { answer, command, refuse, type DeleteArguments } from "../../../../interface/backend-interface";
import { load_workspace } from "../../config/workspace";
import { resolve_node_identifier, not_found_message } from "../../utilities";
import type { DeleteResponse, DeletePreview } from "../../protocol/types";
import { display_path } from "../../unresolved";

/** What a delete would remove: the response, and the lines that list it. */
function preview_answer(preview: { node_count: number; property_count: number; paths: string[][] }) {
    const message = `Would delete ${preview.node_count} node(s) and ${preview.property_count} property(ies)`;
    const response: DeletePreview = {
        ok: true,
        message,
        severity: "warn",
        error_type: "needs-force",
        node_count: preview.node_count,
        property_count: preview.property_count,
        paths: preview.paths,
    };
    return answer<DeleteResponse>(response, [message, ...preview.paths.map(p => `  ${p.join("/")}`)].join("\n"));
}

/** A referencing property as the CLI names it: the holder label-first, then the property. */
interface Referrer {
    owner: string;
    property: string;
}

function referrers(overlay: DeviceTreeOverlay, references: ReferenceTo[]): Referrer[] {
    const labels = overlay.all_labels();
    return references.map(reference => ({ owner: display_path(reference.path, labels), property: reference.property }));
}

const properties = (amount: number): string => `${String(amount)} ${amount === 1 ? "property" : "properties"}`;
const references_word = (amount: number): string => `${String(amount)} ${amount === 1 ? "reference" : "references"}`;

/** A node other properties refer to, previewed as the noos backend does: the node, then each referencing property. */
function reference_preview(identifier: string, node: DTNode, found: Referrer[]) {
    const those = found.length === 1 ? "that reference" : "those references";
    const response: DeletePreview = {
        ok: true,
        message: `'${identifier}' is referenced by ${properties(found.length)}; deleting it would clear ${those}. Re-run with --force.`,
        severity: "warn",
        error_type: "needs-force",
        node_count: count_subtree(node).node_count,
        property_count: found.length,
        paths: [[identifier], ...found.map(referrer => [referrer.owner, referrer.property])],
    };
    const text = `${identifier}: referenced by\n\n`
        + found.map(referrer => `  ${referrer.owner} ${referrer.property}\n`).join("")
        + "\nNothing was changed. Re-run with --force to delete the node and clear those references.";
    return answer<DeleteResponse>(response, text);
}

export const delete_command = command<DeleteArguments, DeleteResponse>({
    docs: {
        brief: "Delete a node or remove a property from the overlay",
        full: `Paths:
  Label:        spi0                       (a label in the base tree)
  Label-first:  spi0/adi,ad7124-8@0       (label then child segments)
  Absolute:     /soc/spi@7e204000          (full device tree path)

A node with children, or the whole overlay, is only previewed without --force.`,
        examples: [
            "delete spi0/adi,ad7124-8@0              Delete a node",
            "delete spi0/adi,ad7124-8@0 spi-cpha     Remove a property",
            "delete spi0 --force                     Delete all overlay children and properties",
        ],
    },
    run({ path: path_argument, property: property_argument, force }, _flags, session) {
        const loaded = load_workspace(session, ["base", "overlay"]);
        if (!loaded.ok) { return Promise.resolve(loaded.outcome); }
        const { workspace } = loaded;
        const { source: devicetree, tree: base } = workspace.base;
        const { path: input, tree: overlay } = workspace.overlay;

        if (path_argument === undefined) {
            if (!force) { return Promise.resolve(preview_answer(count_overlay_root(overlay))); }
            overlay.delete_all();
            workspace.overlay.save();
            return Promise.resolve(answer<DeleteResponse>(
                { ok: true, message: "Deleted all overlay content", severity: "info" },
                `Deleted all overlay content from ${input}`,
            ));
        }

        if (path_argument === "/" && property_argument === undefined) {
            return Promise.resolve(refuse("Cannot delete the root node", { type: "read-only" }));
        }

        if (property_argument !== undefined) {
            const result = remove_overlay_property(overlay, path_argument, property_argument);
            if (result !== "removed") { return Promise.resolve(refuse(`Not found: ${property_argument} on ${path_argument}`, { type: "not-found" })); }
            workspace.overlay.save();
            return Promise.resolve(answer<DeleteResponse>(
                { ok: true, message: `Removed ${property_argument} from ${path_argument}`, severity: "info" },
                `Removed ${property_argument} from ${path_argument} in ${input}`,
            ));
        }

        const identifier = path_argument;
        const found = overlay.find_node(resolve_node_identifier(identifier, overlay));
        const added = found !== undefined && !found.is_in_base && found.parent_node !== undefined ? found : undefined;
        const references = added === undefined ? [] : references_to(overlay, added.node_path);
        if (added !== undefined && !force) {
            if (references.length > 0) { return Promise.resolve(reference_preview(identifier, added.node, referrers(overlay, references))); }
            if (added.node.children.length > 0) { return Promise.resolve(preview_answer(count_subtree(added.node))); }
        }

        // With --force, the properties that refer to the node go first, so no reference dangles.
        for (const reference of references) { overlay.remove_property(reference.path, reference.property); }
        const result = delete_overlay_node(base, overlay, identifier);
        switch (result) {
            case "not-found": { return Promise.resolve(refuse(not_found_message(identifier, overlay, base), { type: "not-found" })); }
            case "in-base": {
                return Promise.resolve(refuse(`${identifier} is part of the base device tree (${devicetree}), not this overlay; delete only removes overlay-added nodes`, { type: "read-only" }));
            }
            case "is-root": { return Promise.resolve(refuse("Cannot delete the root node", { type: "read-only" })); }
            case "deleted": {
                workspace.overlay.save();
                const cleared = references.length === 0 ? "" : ` and cleared ${references_word(references.length)} to it`;
                return Promise.resolve(answer<DeleteResponse>(
                    { ok: true, message: `Deleted ${identifier}${cleared}`, severity: "info" },
                    `Deleted ${identifier}${cleared} from ${input}`,
                ));
            }
        }
    },
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
