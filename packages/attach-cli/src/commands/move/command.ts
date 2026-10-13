import { Command } from "commander";
import { DeviceTree, DeviceTreeOverlay, get_full_node_name, type DTNode } from "attach-lib";

import type { LocalContext } from "../../context";
import { load_trees, resolve_node_identifier, resolve_path, base_target, not_found_message, write_overlay } from "../../utilities";
import { resolve_config } from "../../resolve-config";
import { respond, respond_fail, input_error } from "../../protocol/output";

export function build_move_command(context_: LocalContext): Command {
    return new Command("move")
        .description("Move an overlay-added node to a different parent")
        .argument("<path>", "Path to node")
        .argument("<destination>", "Destination parent: label or path (e.g. spi1, /soc/spi@7e205000)")
        .action(async (path_argument: string, destination: string) => {
            const parent_identifier = destination;

            const resolved = resolve_config(context_, ["devicetree", "overlay"]);
            if (resolved === undefined) { return; }
            const { devicetree, overlay: input } = resolved.values;

            const trees = load_trees(context_, devicetree, input, resolved.parsed.devicetree);
            if (trees === undefined) { return; }
            const { base_dt: base, overlay } = trees;

            const result = move_overlay_node(base, overlay, path_argument, parent_identifier);

            if (context_.json) {
                switch (result) {
                    case "moved": {
                        write_overlay(input, overlay, resolved.config);
                        respond({ ok: true, message: `Moved ${path_argument} to ${parent_identifier}`, severity: "info" });
                        return;
                    }
                    case "not-found": {
                        respond_fail({ ok: false, message: not_found_message(path_argument, overlay, base), severity: "error" });
                        return;
                    }
                    case "in-base": {
                        respond_fail({ ok: false, message: `${path_argument} is part of the base device tree, not this overlay`, severity: "error" });
                        return;
                    }
                    case "is-root": {
                        respond_fail({ ok: false, message: "Cannot move the root node", severity: "error" });
                        return;
                    }
                    case "parent-not-found": {
                        respond_fail({ ok: false, message: `Parent node ${parent_identifier} not found`, severity: "error" });
                        return;
                    }
                    case "into-self": {
                        respond_fail({ ok: false, message: `Cannot move ${path_argument} into itself or one of its descendants`, severity: "error" });
                        return;
                    }
                    case "conflict": {
                        const found = overlay.find_node(resolve_node_identifier(path_argument, overlay));
                        const node_key = found === undefined ? path_argument : get_full_node_name(found.node);
                        respond_fail({ ok: false, message: `${parent_identifier} already has a child named ${node_key}`, severity: "error" });
                        return;
                    }
                }
            } else {
                switch (result) {
                    case "not-found": {
                        console.log(not_found_message(path_argument, overlay, base));
                        return;
                    }
                    case "in-base": {
                        console.log(`${path_argument} is part of the base device tree (${devicetree}), not this overlay; move only applies to overlay-added nodes`);
                        return;
                    }
                    case "is-root": {
                        console.log("Refusing to move the root node");
                        return;
                    }
                    case "parent-not-found": {
                        console.log(`Couldn't find parent node ${parent_identifier} in ${devicetree} or ${input}`);
                        return;
                    }
                    case "into-self": {
                        console.log(`Cannot move ${path_argument} into itself or one of its descendants`);
                        return;
                    }
                    case "conflict": {
                        const found = overlay.find_node(resolve_node_identifier(path_argument, overlay));
                        const node_key = found === undefined ? path_argument : get_full_node_name(found.node);
                        console.log(`${parent_identifier} already has a child named ${node_key}`);
                        return;
                    }
                    case "moved": {
                        write_overlay(input, overlay, resolved.config);
                        console.log(`Moved ${path_argument} to ${parent_identifier} in ${input}`);
                        return;
                    }
                }
            }
        });
}

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
    const destination_in_overlay = resolved_parent.in_overlay;

    const destination_node: DTNode | "parent-not-found" = (() => {
        if (destination_in_overlay === undefined) {
            const base_reference = base_target(resolved_parent);
            if (base_reference === undefined) { return "parent-not-found"; }
            // eslint-disable-next-line unicorn/no-useless-undefined
            overlay.add_fragment(base_reference, undefined, undefined);

            return overlay.find_node(base_reference)!.node;
        } else {
            return destination_in_overlay.node;
        }
    })();

    if (destination_node === 'parent-not-found') { return destination_node; };
    if (is_self_or_descendant(node, destination_node)) { return "into-self"; }

    const key = get_full_node_name(node);

    // R2: check effective_children at destination for duplicates
    const destination_path = destination_in_overlay === undefined
        ? parent_identifier
        : destination_in_overlay.node_path;
    const effective = overlay.effective_children(destination_path);
    if (effective.has(key)) { return "conflict"; }

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
