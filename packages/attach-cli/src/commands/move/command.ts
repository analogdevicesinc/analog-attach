import { buildCommand } from "@stricli/core";
import { get_node_key, mergeDtso, parse_dts, parseDtso, printDtso, search_node_in_dts, type DtsDocument, type DtsNode } from "attach-lib";

import * as fs from 'node:fs';

import { resolve_node_identifier } from "../../utilities";
import { load_config } from "../../config";

type Flags = {
    node: string,
    parent: string,
    overlay: string,
    context?: string,
}

export const move_command = buildCommand({
    parameters: {
        flags: {
            node: {
                kind: "parsed",
                parse: String,
                brief: "Node to move: label, &label, path, &{path}, or label/child",
            },
            parent: {
                kind: "parsed",
                parse: String,
                brief: "Destination parent: label, &label, path, &{path}, or label/child",
            },
            overlay: {
                kind: "parsed",
                parse: String,
                brief: "dtso",
            },
            context: {
                kind: "parsed",
                parse: String,
                brief: "The target dts",
                optional: true,
            },
        }
    },
    docs: {
        brief: "Move an overlay-added node to a different parent in an existing dtso"
    },
    async func(flags: Flags) {
        const config = load_config();
        const context = flags.context ?? config.context;
        const { node, parent, overlay: input } = flags;

        if (context === undefined) {
            console.log("Missing: --context (no config.toml found)");
            return;
        }

        if (!fs.existsSync(context)) {
            console.log(`Missing: ${context}`);
            return;
        }

        if (!fs.existsSync(input)) {
            console.log(`Missing: ${input} (use "create" to generate a new overlay first)`);
            return;
        }

        const context_content = fs.readFileSync(context, 'utf8');

        const base_document = (() => {
            try {
                return parse_dts(context_content);
            } catch {
                return;
            }
        })();

        if (base_document === undefined) {
            console.log(`Failed to parse dts ${context}`);
            return;
        }

        const input_content = fs.readFileSync(input, 'utf8');

        const input_document = (() => {
            try {
                return parseDtso(input_content);
            } catch (error) {
                console.log(`${error}`);
                return;
            }
        })();

        if (input_document === undefined) {
            console.log(`Failed to parse dtso ${input}`);
            return;
        }

        const merged = mergeDtso(base_document, input_content, true);

        const result = move_overlay_node(base_document, merged, node, parent);

        switch (result) {
            case "not-found": {
                console.log(`Couldn't find node ${node} in ${input}`);
                return;
            }
            case "in-base": {
                console.log(`${node} is part of the base device tree (${context}), not this overlay; move only applies to overlay-added nodes`);
                return;
            }
            case "is-root": {
                console.log("Refusing to move the root node");
                return;
            }
            case "parent-not-found": {
                console.log(`Couldn't find parent node ${parent} in ${context} or ${input}`);
                return;
            }
            case "into-self": {
                console.log(`Cannot move ${node} into itself or one of its descendants`);
                return;
            }
            case "conflict": {
                console.log(`${parent} already has a child named ${get_node_key(search_node_in_dts(merged, resolve_node_identifier(merged, node))!.found_node)}`);
                return;
            }
            case "moved": {
                fs.writeFileSync(input, printDtso(merged));
                console.log(`Moved ${node} to ${parent} in ${input}`);
                return;
            }
        }
    }
});

export function move_overlay_node(
    base: DtsDocument,
    merged: DtsDocument,
    identifier: string,
    parent_identifier: string,
): "moved" | "not-found" | "in-base" | "is-root" | "parent-not-found" | "conflict" | "into-self" {
    const resolved = resolve_node_identifier(merged, identifier);
    const found = search_node_in_dts(merged, resolved);
    if (found === undefined) { return "not-found"; }
    if (found.parent_node === undefined) { return "is-root"; }
    if (search_node_in_dts(base, resolved) !== undefined) { return "in-base"; }

    const resolved_parent = resolve_node_identifier(merged, parent_identifier);
    const dest = search_node_in_dts(merged, resolved_parent);
    if (dest === undefined) { return "parent-not-found"; }

    if (is_self_or_descendant(found.found_node, dest.found_node)) { return "into-self"; }

    const node = found.found_node;
    const key = get_node_key(node);
    const collision = dest.found_node.children.some(
        (c) => c !== node && get_node_key(c) === key
    );
    if (collision) { return "conflict"; }

    const siblings = found.parent_node.children;
    const index = siblings.indexOf(node);
    if (index === -1) { return "not-found"; }
    siblings.splice(index, 1);
    dest.found_node.children.push(node);
    dest.found_node.modified_by_user = true;
    return "moved";
}

function is_self_or_descendant(node: DtsNode, candidate: DtsNode): boolean {
    if (node === candidate) { return true; }
    return node.children.some((child) => is_self_or_descendant(child, candidate));
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;
    const { parse_dts: parse_dts_v } = await import('attach-lib');

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
        const base = parse_dts_v(base_dts);
        const merged = mergeDtso(base, overlay_with_imu, true);
        const result = move_overlay_node(base, merged, "imu1", "spi1");
        expect(result).toBe("moved");
        const output = printDtso(merged);
        expect(output).toContain("spi1");
        expect(output).toContain("adi,ad7124-8@0");
        // spi0 block should be gone since it has no modified content left
        expect(output).not.toContain("spi0");
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
        const base = parse_dts_v(base_dts);
        const merged = mergeDtso(base, overlay_nested, true);
        const result = move_overlay_node(base, merged, "imu1", "spi1");
        expect(result).toBe("moved");
        const output = printDtso(merged);
        expect(output).toContain("spi1");
        expect(output).toContain("channel@0");
        expect(output).not.toContain("spi0");
    });

    test("move_overlay_node - refuses base-tree node", () => {
        const base = parse_dts_v(base_dts);
        const merged = mergeDtso(base, overlay_with_imu, true);
        const result = move_overlay_node(base, merged, "spi0", "spi1");
        expect(result).toBe("in-base");
    });

    test("move_overlay_node - returns not-found for unknown node", () => {
        const base = parse_dts_v(base_dts);
        const merged = mergeDtso(base, overlay_with_imu, true);
        const result = move_overlay_node(base, merged, "nonexistent", "spi1");
        expect(result).toBe("not-found");
    });

    test("move_overlay_node - returns parent-not-found for unknown destination", () => {
        const base = parse_dts_v(base_dts);
        const merged = mergeDtso(base, overlay_with_imu, true);
        const result = move_overlay_node(base, merged, "imu1", "i2c0");
        expect(result).toBe("parent-not-found");
    });

    test("move_overlay_node - returns conflict when destination has same key", () => {
        const base = parse_dts_v(base_dts);
        const merged = mergeDtso(base, overlay_with_imu_on_both, true);
        const result = move_overlay_node(base, merged, "imu1", "spi1");
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
        const base = parse_dts_v(base_dts);
        const merged = mergeDtso(base, overlay_nested, true);
        const result = move_overlay_node(base, merged, "imu1", "imu1/channel@0");
        expect(result).toBe("into-self");
    });
}
