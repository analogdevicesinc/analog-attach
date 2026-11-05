import { DeviceTree, DeviceTreeOverlay, get_full_node_name, parent_path_string, suggest_parents, type DTNode, type PathAndLabel } from "attach-lib";

import { answer, refuse, type ExtraCommand } from "../../../../interface/backend-interface";
import type { CommonResponse } from "../../protocol/types";
import { resolve_node_identifier, resolve_path, not_found_message, positional_word, node_compatibles } from "../../utilities";
import { load_workspace, optional_bindings, type Bindings } from "../../config/workspace";
import { load_binding } from "../list/data";

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

        const planned = plan_move(base, overlay, path_argument, destination);
        if (typeof planned !== "string") {
            const bindings = optional_bindings(workspace);
            const allowed = bindings.ok ? await valid_parents(planned.node, overlay.merged_tree() ?? base, bindings.value) : undefined;
            const mismatch = allowed === undefined ? undefined : wrong_parent(allowed, planned.destination_path);
            // A wrong parent is refused. To make it a warning instead: session.warn(the message) and go on.
            if (mismatch !== undefined) {
                return refuse(`Cannot move ${path_argument} under ${destination}: ${mismatch.compatible} goes under ${mismatch.parents.join(", ")} (see: ${session.program} list parent ${mismatch.compatible})`);
            }
        }
        const result = typeof planned === "string" ? planned : apply_move(overlay, planned);
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

type MoveRefusal = "not-found" | "in-base" | "is-root" | "parent-not-found" | "conflict" | "into-self";

/** A move every check of `plan_move` passed: the node, where it is, and the destination's path. */
interface PlannedMove {
    node: DTNode;
    node_path: string;
    destination_path: string;
}

export function move_overlay_node(
    base: DeviceTree,
    overlay: DeviceTreeOverlay,
    identifier: string,
    parent_identifier: string,
): "moved" | MoveRefusal {
    const planned = plan_move(base, overlay, identifier, parent_identifier);
    return typeof planned === "string" ? planned : apply_move(overlay, planned);
}

/** Resolve the node and the destination, and check the move: nothing is changed. */
export function plan_move(
    base: DeviceTree,
    overlay: DeviceTreeOverlay,
    identifier: string,
    parent_identifier: string,
): PlannedMove | MoveRefusal {

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

    return { node, node_path: found.node_path, destination_path };
}

/** Append the node to the destination, then remove it from its old place. */
function apply_move(overlay: DeviceTreeOverlay, { node, node_path, destination_path }: PlannedMove): "moved" | "parent-not-found" | "not-found" {
    const destination_node = overlay.ensure_node(destination_path);
    if (destination_node === undefined) { return "parent-not-found"; }

    destination_node.children.push(node);

    if (!overlay.remove_node(node_path)) {
        destination_node.children.pop();
        return "not-found";
    }

    return "moved";
}

/**
 * The parents the node's binding allows in `tree` (the merged tree, so a bus the overlay adds
 * counts), from the first of its compatibles that has a binding. Nothing when it has none.
 */
async function valid_parents(node: DTNode, tree: DeviceTree, bindings: Bindings): Promise<{ compatible: string; parents: PathAndLabel[] } | undefined> {
    for (const compatible of node_compatibles(node)) {
        const binding = await load_binding(bindings, compatible);
        if (binding.ok) { return { compatible, parents: suggest_parents(tree, binding.binding) }; }
    }
    return undefined;
}

/**
 * When the destination isn't one of the valid parents: the compatible and the parents, by label
 * or else path, as `list parent` gives them. Nothing when it is, or when no parent is known.
 */
export function wrong_parent(
    { compatible, parents }: { compatible: string; parents: PathAndLabel[] },
    destination_path: string,
): { compatible: string; parents: string[] } | undefined {
    if (parents.length === 0) { return undefined; }
    if (parents.some(parent => parent_path_string(parent) === destination_path)) { return undefined; }
    return { compatible, parents: parents.map(parent => parent.label ?? parent_path_string(parent)) };
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

    test("wrong_parent: the valid parents when the destination is none of them", () => {
        const allowed = { compatible: "adi,ad7124-8", parents: [{ path: ["/", "soc", "spi@7e204000"], label: "spi0" }, { path: ["/", "soc", "spi@7e215080"] }] };
        expect(wrong_parent(allowed, "/soc/spi@7e204000")).toBeUndefined();
        expect(wrong_parent(allowed, "/soc/spi@7e215080")).toBeUndefined();
        expect(wrong_parent(allowed, "/soc/i2c@7e804000")).toEqual({ compatible: "adi,ad7124-8", parents: ["spi0", "/soc/spi@7e215080"] });
        expect(wrong_parent({ compatible: "x,y", parents: [] }, "/anywhere")).toBeUndefined();
    });

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
