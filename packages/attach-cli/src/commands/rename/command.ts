import { buildCommand } from "@stricli/core";
import { mergeDtso, parse_dts, parseDtso, printDtso, search_node_in_dts, type DtsDocument } from "attach-lib";

import * as fs from 'node:fs';

import { resolve_node_identifier } from "../../utilities";
import { load_config } from "../../config";

type Flags = {
    node: string,
    to: string,
    overlay: string,
    context?: string,
}

export const rename_command = buildCommand({
    parameters: {
        flags: {
            node: {
                kind: "parsed",
                parse: String,
                brief: "Node to rename: label, &label, path, &{path}, or label/child",
            },
            to: {
                kind: "parsed",
                parse: String,
                brief: "New node key: 'name' preserves unit addr, 'name@unit' overrides it",
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
        brief: "Rename an overlay-added node in an existing dtso"
    },
    async func(flags: Flags) {
        const config = load_config();
        const context = flags.context ?? config.context;
        const { node, to, overlay: input } = flags;

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

        const result = rename_overlay_node(base_document, merged, node, to);

        switch (result) {
            case "not-found": {
                console.log(`Couldn't find node ${node} in ${input}`);
                return;
            }
            case "in-base": {
                console.log(`${node} is part of the base device tree (${context}), not this overlay; rename only applies to overlay-added nodes`);
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
                fs.writeFileSync(input, printDtso(merged));
                console.log(`Renamed ${node} to ${to} in ${input}`);
                return;
            }
        }
    }
});

export function rename_overlay_node(
    base: DtsDocument,
    merged: DtsDocument,
    identifier: string,
    to: string,
): "renamed" | "not-found" | "in-base" | "is-root" | "conflict" {
    const resolved = resolve_node_identifier(merged, identifier);
    const found = search_node_in_dts(merged, resolved);
    if (found === undefined) { return "not-found"; }
    if (found.parent_node === undefined) { return "is-root"; }
    if (search_node_in_dts(base, resolved) !== undefined) { return "in-base"; }

    const at = to.indexOf('@');
    const new_name = at === -1 ? to : to.slice(0, at);
    const new_unit = at === -1
        ? found.found_node.unit_addr
        : (to.slice(at + 1) === "" ? undefined : to.slice(at + 1));

    const siblings = found.parent_node.children;
    const collision = siblings.some(
        (s) => s !== found.found_node && s.name === new_name && s.unit_addr === new_unit
    );
    if (collision) { return "conflict"; }

    found.found_node.name = new_name;
    found.found_node.unit_addr = new_unit;
    found.found_node.modified_by_user = true;
    return "renamed";
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
        const base = parse_dts_v(base_dts);
        const merged = mergeDtso(base, overlay_with_imu, true);
        const result = rename_overlay_node(base, merged, "imu1", "my_adc@0");
        expect(result).toBe("renamed");
        const output = printDtso(merged);
        expect(output).toContain("my_adc@0");
        expect(output).not.toContain("adi,ad7124-8@0");
    });

    test("rename_overlay_node - --to without @ preserves existing unit addr", () => {
        const base = parse_dts_v(base_dts);
        const merged = mergeDtso(base, overlay_with_imu, true);
        const result = rename_overlay_node(base, merged, "imu1", "my_adc");
        expect(result).toBe("renamed");
        const output = printDtso(merged);
        expect(output).toContain("my_adc@0");
        expect(output).not.toContain("adi,ad7124-8@0");
    });

    test("rename_overlay_node - --to with @ overrides unit addr", () => {
        const base = parse_dts_v(base_dts);
        const merged = mergeDtso(base, overlay_with_imu, true);
        const result = rename_overlay_node(base, merged, "imu1", "my_adc@3");
        expect(result).toBe("renamed");
        const output = printDtso(merged);
        expect(output).toContain("my_adc@3");
        expect(output).not.toContain("adi,ad7124-8@0");
    });

    test("rename_overlay_node - refuses base-tree node", () => {
        const base = parse_dts_v(base_dts);
        const merged = mergeDtso(base, overlay_with_imu, true);
        const result = rename_overlay_node(base, merged, "spi0", "spi1");
        expect(result).toBe("in-base");
    });

    test("rename_overlay_node - returns not-found for unknown label", () => {
        const base = parse_dts_v(base_dts);
        const merged = mergeDtso(base, overlay_with_imu, true);
        const result = rename_overlay_node(base, merged, "nonexistent", "foo");
        expect(result).toBe("not-found");
    });

    test("rename_overlay_node - returns conflict when new key collides with sibling", () => {
        const base = parse_dts_v(base_dts);
        const merged = mergeDtso(base, overlay_two_children, true);
        const result = rename_overlay_node(base, merged, "imu1", "adi,ad7124-8@1");
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
        const base = parse_dts_v(base_dts);
        const merged = mergeDtso(base, overlay_nested, true);
        const result = rename_overlay_node(base, merged, "imu1/channel@0", "channel@1");
        expect(result).toBe("renamed");
        const output = printDtso(merged);
        expect(output).toContain("channel@1");
        expect(output).not.toContain("channel@0");
        expect(output).toContain("imu1");
    });
}
