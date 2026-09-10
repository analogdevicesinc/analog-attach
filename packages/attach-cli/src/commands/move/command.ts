import { Command } from "commander";
import { DeviceTree, DeviceTreeOverlay, get_full_node_name, type DTNode } from "attach-lib";

import * as fs from 'node:fs';

import type { LocalContext } from "../../context";
import { resolve_node_identifier } from "../../utilities";
import { load_config } from "../../config";
import { respond, respond_fail, input_error } from "../../protocol/output";

export function build_move_command(ctx: LocalContext): Command {
    return new Command("move")
        .description("Move an overlay-added node to a different parent in an existing dtso")
        .requiredOption("--to <value...>", "Destination parent: label, &label, path, &{path}, or label/child")
        .option("--overlay <value>", "dtso")
        .option("--context <value>", "The target dts")
        .argument("[path...]", "Path to node (ValidIdentifier segments)")
        .action(async (path: string[], options) => {
            const config = load_config();
            const context = options.context ?? config.context;
            const input = options.overlay ?? config.overlay;
            const to: string = (options.to as string[]).join("/");

            if (path.length === 0) {
                if (ctx.json) { input_error("path is required"); return; }
                console.log("Missing: path (positional arguments)");
                return;
            }

            if (context === undefined) {
                if (ctx.json) { input_error("missing config: context"); return; }
                console.log("Missing: --context (no config.toml found)");
                return;
            }

            if (input === undefined) {
                if (ctx.json) { input_error("missing config: overlay"); return; }
                console.log("Missing: --overlay (no config.toml found)");
                return;
            }

            if (!fs.existsSync(context)) {
                if (ctx.json) { input_error(`file not found: ${context}`); return; }
                console.log(`Missing: ${context}`);
                return;
            }

            if (!fs.existsSync(input)) {
                if (ctx.json) { input_error(`file not found: ${input}`); return; }
                console.log(`Missing: ${input} (use "create" to generate a new overlay first)`);
                return;
            }

            const context_content = fs.readFileSync(context, 'utf8');
            const base = DeviceTree.new_from_string(context_content);

            if (typeof base === "string") {
                if (ctx.json) { input_error(`failed to parse dts: ${base}`); return; }
                console.log(`Failed to parse dts ${context}: ${base}`);
                return;
            }

            const input_content = fs.readFileSync(input, 'utf8');
            const overlay = DeviceTreeOverlay.new_from_string(input_content, base);

            if (typeof overlay === "string") {
                if (ctx.json) { input_error(`failed to parse dtso: ${overlay}`); return; }
                console.log(`Failed to parse dtso ${input}: ${overlay}`);
                return;
            }

            const identifier = path.join("/");
            const result = move_overlay_node(base, overlay, identifier, to);

            if (ctx.json) {
                switch (result) {
                    case "moved": {
                        fs.writeFileSync(input, overlay.print());
                        respond({ ok: true, message: `Moved ${identifier} to ${to}`, severity: "info" });
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
                        respond_fail({ ok: false, message: "Cannot move the root node", severity: "error" });
                        return;
                    }
                    case "parent-not-found": {
                        respond_fail({ ok: false, message: `Parent node ${to} not found`, severity: "error" });
                        return;
                    }
                    case "into-self": {
                        respond_fail({ ok: false, message: `Cannot move ${identifier} into itself or one of its descendants`, severity: "error" });
                        return;
                    }
                    case "conflict": {
                        const found = overlay.find_node(resolve_node_identifier(identifier, overlay));
                        const node_key = found === undefined ? identifier : get_full_node_name(found.node);
                        respond_fail({ ok: false, message: `${to} already has a child named ${node_key}`, severity: "error" });
                        return;
                    }
                }
            } else {
                switch (result) {
                    case "not-found": {
                        console.log(`Couldn't find node ${identifier} in ${input}`);
                        return;
                    }
                    case "in-base": {
                        console.log(`${identifier} is part of the base device tree (${context}), not this overlay; move only applies to overlay-added nodes`);
                        return;
                    }
                    case "is-root": {
                        console.log("Refusing to move the root node");
                        return;
                    }
                    case "parent-not-found": {
                        console.log(`Couldn't find parent node ${to} in ${context} or ${input}`);
                        return;
                    }
                    case "into-self": {
                        console.log(`Cannot move ${identifier} into itself or one of its descendants`);
                        return;
                    }
                    case "conflict": {
                        const found = overlay.find_node(resolve_node_identifier(identifier, overlay));
                        const node_key = found === undefined ? identifier : get_full_node_name(found.node);
                        console.log(`${to} already has a child named ${node_key}`);
                        return;
                    }
                    case "moved": {
                        fs.writeFileSync(input, overlay.print());
                        console.log(`Moved ${identifier} to ${to} in ${input}`);
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

    const destination_in_overlay = overlay.find_node(resolve_node_identifier(parent_identifier, overlay));

    const destination_node: DTNode | "parent-not-found" = (() => {
        if (destination_in_overlay === undefined) {
            const destination_in_base = base.resolve_identifier(parent_identifier);

            if (destination_in_base === undefined) { return "parent-not-found"; }
            // eslint-disable-next-line unicorn/no-useless-undefined
            const reference = overlay.add_fragment(destination_in_base, undefined, undefined)!;

            return overlay.deref_node(reference)!.children.find(c => c.name === "__overlay__")!;
        } else {
            return destination_in_overlay.node;
        }
    })();

    if (destination_node === 'parent-not-found') { return destination_node; };
    if (is_self_or_descendant(node, destination_node)) { return "into-self"; }

    const key = get_full_node_name(node);
    const collision = destination_node.children.some(
        (c) => c !== node && get_full_node_name(c) === key
    );

    if (collision) { return "conflict"; }

    if (!overlay.remove_node({ kind: "path", labels: [], path: found.node_path })) {
        return "not-found";
    }

    destination_node.children.push(node);

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
