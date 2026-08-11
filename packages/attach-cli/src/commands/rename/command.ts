import { buildCommand } from "@stricli/core";
import { DeviceTree, DeviceTreeOverlay, get_full_node_name } from "attach-lib";

import * as fs from 'node:fs';


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
        const base = DeviceTree.new_from_string(context_content);

        if (typeof base === "string") {
            console.log(`Failed to parse dts ${context}: ${base}`);
            return;
        }

        const input_content = fs.readFileSync(input, 'utf8');
        const overlay = DeviceTreeOverlay.new_from_string(input_content, base);

        if (typeof overlay === "string") {
            console.log(`Failed to parse dtso ${input}: ${overlay}`);
            return;
        }

        const result = rename_overlay_node(base, overlay, node, to);

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
                fs.writeFileSync(input, overlay.print());
                console.log(`Renamed ${node} to ${to} in ${input}`);
                return;
            }
        }
    }
});

export function rename_overlay_node(
    base: DeviceTree,
    overlay: DeviceTreeOverlay,
    identifier: string,
    to: string,
): "renamed" | "not-found" | "in-base" | "is-root" | "conflict" {
    const found = overlay.find_node(identifier);

    if (found === undefined) { return "not-found"; }
    if (found.is_in_base) { return "in-base"; }
    if (found.parent_node === undefined) { return "is-root"; }

    const at = to.indexOf('@');
    const new_name = at === -1 ? to : to.slice(0, at);
    const new_unit = at === -1
        ? found.node.unit_addr
        : (to.slice(at + 1) === "" ? undefined : to.slice(at + 1));

    const siblings = found.parent_node.children;
    const collision = siblings.some(
        (s) => s !== found.node && s.name === new_name && s.unit_addr === new_unit
    );

    if (collision) { return "conflict"; }

    found.node.name = new_name;
    found.node.unit_addr = new_unit;

    return "renamed";
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;
    const { DeviceTree: DT, DeviceTreeOverlay: DTO_cls } = await import('attach-lib');

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
        const base = DT.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DTO_cls.new_from_string(overlay_with_imu, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }
        const result = rename_overlay_node(base, overlay, "imu1", "my_adc@0");
        expect(result).toBe("renamed");
        const output = overlay.print();
        expect(output).toContain("my_adc@0");
        expect(output).not.toContain("adi,ad7124-8@0");
    });

    test("rename_overlay_node - --to without @ preserves existing unit addr", () => {
        const base = DT.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DTO_cls.new_from_string(overlay_with_imu, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }
        const result = rename_overlay_node(base, overlay, "imu1", "my_adc");
        expect(result).toBe("renamed");
        const output = overlay.print();
        expect(output).toContain("my_adc@0");
        expect(output).not.toContain("adi,ad7124-8@0");
    });

    test("rename_overlay_node - --to with @ overrides unit addr", () => {
        const base = DT.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DTO_cls.new_from_string(overlay_with_imu, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }
        const result = rename_overlay_node(base, overlay, "imu1", "my_adc@3");
        expect(result).toBe("renamed");
        const output = overlay.print();
        expect(output).toContain("my_adc@3");
        expect(output).not.toContain("adi,ad7124-8@0");
    });

    test("rename_overlay_node - refuses base-tree node", () => {
        const base = DT.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DTO_cls.new_from_string(overlay_with_imu, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }
        const result = rename_overlay_node(base, overlay, "spi0", "spi1");
        expect(result).toBe("in-base");
    });

    test("rename_overlay_node - returns not-found for unknown label", () => {
        const base = DT.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DTO_cls.new_from_string(overlay_with_imu, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }
        const result = rename_overlay_node(base, overlay, "nonexistent", "foo");
        expect(result).toBe("not-found");
    });

    test("rename_overlay_node - returns conflict when new key collides with sibling", () => {
        const base = DT.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DTO_cls.new_from_string(overlay_two_children, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }
        const result = rename_overlay_node(base, overlay, "imu1", "adi,ad7124-8@1");
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
        const base = DT.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DTO_cls.new_from_string(overlay_nested, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }
        const result = rename_overlay_node(base, overlay, "imu1/channel@0", "channel@1");
        expect(result).toBe("renamed");
        const output = overlay.print();
        expect(output).toContain("channel@1");
        expect(output).not.toContain("channel@0");
        expect(output).toContain("imu1");
    });
}
