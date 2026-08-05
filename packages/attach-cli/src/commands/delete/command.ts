import { buildCommand } from "@stricli/core";
import { mergeDtso, parse_dts, parseDtso, printDtso, search_node_in_dts, type DtsDocument } from "attach-lib";

import * as fs from 'node:fs';

import { resolve_node_identifier } from "../../utilities";
import { load_config } from "../../config";

type Flags = {
    node: string,
    overlay: string,
    context?: string,
}

export const delete_command = buildCommand({
    parameters: {
        flags: {
            node: {
                kind: "parsed",
                parse: String,
                brief: "Node to delete: label, &label, path, &{path}, or label/child",
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
        brief: "Delete an overlay-added node from an existing dtso"
    },
    async func(flags: Flags) {
        const config = load_config();
        const context = flags.context ?? config.context;
        const { node, overlay: input } = flags;

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

        const result = delete_overlay_node(base_document, merged, node);

        switch (result) {
            case "not-found": {
                console.log(`Couldn't find node ${node} in ${input}`);
                return;
            }
            case "in-base": {
                console.log(`${node} is part of the base device tree (${context}), not this overlay; delete only removes overlay-added nodes`);
                return;
            }
            case "is-root": {
                console.log("Refusing to delete the root node");
                return;
            }
            case "deleted": {
                fs.writeFileSync(input, printDtso(merged));
                console.log(`Deleted ${node} from ${input}`);
                return;
            }
        }
    }
});

export function delete_overlay_node(
    base: DtsDocument,
    merged: DtsDocument,
    identifier: string,
): "deleted" | "not-found" | "in-base" | "is-root" {
    const resolved = resolve_node_identifier(merged, identifier);
    const found = search_node_in_dts(merged, resolved);
    if (found === undefined) { return "not-found"; }
    if (found.parent_node === undefined) { return "is-root"; }
    if (search_node_in_dts(base, resolved) !== undefined) { return "in-base"; }
    const siblings = found.parent_node.children;
    const index = siblings.indexOf(found.found_node);
    if (index === -1) { return "not-found"; }
    siblings.splice(index, 1);
    return "deleted";
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;
    const { parse_dts: parse_dts_v } = await import('attach-lib');

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

    test("delete_overlay_node - removes overlay-added node, whole &spi0 block gone when empty", () => {
        const base = parse_dts_v(base_dts);
        const merged = mergeDtso(base, overlay_with_imu, true);
        const result = delete_overlay_node(base, merged, "imu1");
        expect(result).toBe("deleted");
        const output = printDtso(merged);
        expect(output).not.toContain("imu1");
        expect(output).not.toContain("spi0");
    });

    test("delete_overlay_node - &spi0 block remains when spi0 has user-set properties", () => {
        const base = parse_dts_v(base_dts);
        const merged = mergeDtso(base, overlay_spi_with_status, true);
        const result = delete_overlay_node(base, merged, "imu1");
        expect(result).toBe("deleted");
        const output = printDtso(merged);
        expect(output).not.toContain("imu1");
        expect(output).toContain("spi0");
        expect(output).toContain('status = "okay"');
    });

    test("delete_overlay_node - refuses base-tree node", () => {
        const base = parse_dts_v(base_dts);
        const merged = mergeDtso(base, overlay_with_imu, true);
        const result = delete_overlay_node(base, merged, "spi0");
        expect(result).toBe("in-base");
    });

    test("delete_overlay_node - returns not-found for unknown label", () => {
        const base = parse_dts_v(base_dts);
        const merged = mergeDtso(base, overlay_with_imu, true);
        const result = delete_overlay_node(base, merged, "nonexistent");
        expect(result).toBe("not-found");
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
        const base = parse_dts_v(base_dts);
        const merged = mergeDtso(base, overlay_nested, true);
        const result = delete_overlay_node(base, merged, "imu1/channel@0");
        expect(result).toBe("deleted");
        const output = printDtso(merged);
        expect(output).not.toContain("channel@0");
        expect(output).toContain("imu1");
    });
}
