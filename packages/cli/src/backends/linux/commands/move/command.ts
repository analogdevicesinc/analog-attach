import { DeviceTree, DeviceTreeOverlay, get_full_node_name, type DTNode } from "attach-lib";

import { answer, refuse, type ExtraCommand } from "../../../../interface/backend-interface";
import type { CommonResponse } from "../../protocol/types";
import { resolve_node_identifier, resolve_path, not_found_message, positional_word } from "../../utilities";
import { load_workspace } from "../../config/workspace";

/** `move <path> <destination>`: a node the overlay adds, to another parent. */
export const move: ExtraCommand<Record<never, never>, CommonResponse> = {
    docs: {
        brief: "Move a node to a different parent",
        full: `Paths:
  Label:        spi0                       (a label in the base tree)
  Label-first:  spi0/adi,ad7124-8@0       (label then child segments)
  Absolute:     /soc/spi@7e204000          (full device tree path)`,
        examples: ["move spi0/adi,ad7124-8@0 spi1"],
    },
    positionals: [
        { name: "path", placeholder: "path", brief: "Path to node (label, label-first, or absolute)", slot: prior => ({ kind: "extra", command: "move", id: "path", prior }) },
        { name: "destination", placeholder: "destination", brief: "Destination parent (label, label-first, or absolute)", slot: prior => ({ kind: "extra", command: "move", id: "destination", prior }) },
    ],
    group: "edit",
    schema: "move.schema.json",
    async run(arguments_, _flags, session) {
        const path_argument = positional_word(arguments_, "path") ?? "";
        const destination = positional_word(arguments_, "destination") ?? "";

        const loaded = load_workspace(session, ["base", "overlay"]);
        if (!loaded.ok) { return loaded.outcome; }
        const { workspace } = loaded;
        const { source: devicetree, tree: base } = workspace.base;
        const { path: input, tree: overlay } = workspace.overlay;

        const result = move_overlay_node(base, overlay, path_argument, destination);
        switch (result) {
            case "moved": {
                workspace.overlay.save();
                return answer({ ok: true, message: `Moved ${path_argument} to ${destination}`, severity: "info" }, `Moved ${path_argument} to ${destination} in ${input}`);
            }
            case "not-found": { return refuse(not_found_message(path_argument, overlay, base)); }
            case "in-base": {
                return refuse(`${path_argument} is part of the base device tree (${devicetree}), not this overlay; move only applies to overlay-added nodes`);
            }
            case "is-root": { return refuse("Cannot move the root node"); }
            case "parent-not-found": {
                return refuse(`Parent node ${destination} not found`, { text: `Couldn't find parent node ${destination} in ${devicetree} or ${input}` });
            }
            case "into-self": { return refuse(`Cannot move ${path_argument} into itself or one of its descendants`); }
            case "conflict": {
                const found = overlay.find_node(resolve_node_identifier(path_argument, overlay));
                const node_key = found === undefined ? path_argument : get_full_node_name(found.node);
                return refuse(`${destination} already has a child named ${node_key}`);
            }
        }
    },
};

export function move_overlay_node(
    base: DeviceTree,
    overlay: DeviceTreeOverlay,
    identifier: string,
    parent_identifier: string,
): "moved" | "not-found" | "in-base" | "is-root" | "parent-not-found" | "conflict" | "into-self" {

    const found = overlay.find_node(resolve_node_identifier(identifier, overlay));

    if (found === undefined) { return "not-found"; }
    if (found.is_in_base) { return "in-base"; }
    if (found.parent_node === undefined) { return "is-root"; }

    const node = found.node;

    const resolved_parent = resolve_path(parent_identifier, overlay, base);
    const destination_path = resolved_parent.in_overlay?.node_path ?? resolved_parent.in_base?.path;
    if (destination_path === undefined) { return "parent-not-found"; }

    if (resolved_parent.in_overlay !== undefined && is_self_or_descendant(node, resolved_parent.in_overlay.node)) {
        return "into-self";
    }

    // R2: check effective_children at destination for duplicates
    if (overlay.effective_children(destination_path).has(get_full_node_name(node))) { return "conflict"; }

    const destination_node = overlay.ensure_node(destination_path);
    if (destination_node === undefined) { return "parent-not-found"; }

    destination_node.children.push(node);

    if (!overlay.remove_node(found.node_path)) {
        destination_node.children.pop();
        return "not-found";
    }

    return "moved";
}


function is_self_or_descendant(node: DTNode, candidate: DTNode): boolean {
    if (node === candidate) {
        return true;
    }

    return node.children.some((child) => is_self_or_descendant(child, candidate));
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

    const overlay_with_imu = `/dts-v1/;
/plugin/;

&spi0 {
    imu1: adi,ad7124-8@0 {
        compatible = "adi,ad7124-8";
    };
};`;

    const overlay_with_imu_on_both = `/dts-v1/;
/plugin/;

&spi0 {
    imu1: adi,ad7124-8@0 {
        compatible = "adi,ad7124-8";
    };
};

&spi1 {
    imu2: adi,ad7124-8@0 {
        compatible = "adi,ad7124-8";
    };
};`;

    test("move_overlay_node - moves node from spi0 to spi1", () => {
        const base = DT.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }

        const overlay = DTO_cls.new_from_string(overlay_with_imu, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = move_overlay_node(base, overlay, "imu1", "spi1");

        expect(result).toBe("moved");

        const output = overlay.print();

        expect(output).not.toContain("spi0");
        expect(output).toContain("spi1");
        expect(output).toContain("adi,ad7124-8@0");
    });

    test("move_overlay_node - moved subtree keeps grandchildren", () => {
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
        const base = DT.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }

        const overlay = DTO_cls.new_from_string(overlay_nested, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = move_overlay_node(base, overlay, "imu1", "spi1");

        expect(result).toBe("moved");

        const output = overlay.print();

        expect(output).not.toContain("spi0");
        expect(output).toContain("spi1");
        expect(output).toContain("channel@0");
    });

    test("move_overlay_node - refuses base-tree node", () => {
        const base = DT.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }

        const overlay = DTO_cls.new_from_string(overlay_with_imu, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = move_overlay_node(base, overlay, "spi0", "spi1");

        expect(result).toBe("in-base");
    });

    test("move_overlay_node - returns not-found for unknown node", () => {
        const base = DT.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }

        const overlay = DTO_cls.new_from_string(overlay_with_imu, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = move_overlay_node(base, overlay, "nonexistent", "spi1");

        expect(result).toBe("not-found");
    });

    test("move_overlay_node - returns parent-not-found for unknown destination", () => {
        const base = DT.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }

        const overlay = DTO_cls.new_from_string(overlay_with_imu, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = move_overlay_node(base, overlay, "imu1", "i2c0");

        expect(result).toBe("parent-not-found");
    });

    test("move_overlay_node - returns conflict when destination has same key", () => {
        const base = DT.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }

        const overlay = DTO_cls.new_from_string(overlay_with_imu_on_both, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = move_overlay_node(base, overlay, "imu1", "spi1");

        expect(result).toBe("conflict");
    });

    test("move_overlay_node - returns conflict when a base-only destination has same key", () => {
        const base = DT.new_from_string(base_dts.replace("spi1: spi@7e205000 {", "spi1: spi@7e205000 {\n            adi,ad7124-8@0 { };"));
        if (typeof base === "string") { throw new TypeError(base); }

        const overlay = DTO_cls.new_from_string(overlay_with_imu, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        expect(move_overlay_node(base, overlay, "imu1", "spi1")).toBe("conflict");
        expect(overlay.get_fragments()).toHaveLength(1);
    });

    test("move_overlay_node - returns into-self when moving into own descendant", () => {
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
        const base = DT.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }

        const overlay = DTO_cls.new_from_string(overlay_nested, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = move_overlay_node(base, overlay, "imu1", "imu1/channel@0");

        expect(result).toBe("into-self");
    });
}
