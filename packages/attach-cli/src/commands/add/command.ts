import { buildCommand } from "@stricli/core";
import { DeviceTree, DeviceTreeOverlay, NodeBuilder, PropertyBuilder, type DTProperty } from "attach-lib";

import * as fs from 'node:fs';

import { find_binding } from "../../utilities";
import { load_config } from "../../config";

type Flags = {
    compatible?: string,
    name?: string,
    parent?: string,
    label?: string,
    overlay: string,
    context?: string,
    linux?: string,
    dtSchema?: string,
}

export const add_command = buildCommand({
    parameters: {
        flags: {
            compatible: {
                kind: "parsed",
                parse: String,
                brief: "Compatible string of the device binding to add",
                optional: true,
            },
            name: {
                kind: "parsed",
                parse: String,
                brief: "Node name (e.g. channel@0); defaults to --compatible",
                optional: true,
            },
            parent: {
                kind: "parsed",
                parse: String,
                brief: "Parent node: label, &label, path, &{path}, or label/child (e.g. spi0, &spi0, /soc/spi@0, &{/soc/spi@0}, spi0/adi,ad7124-8)",
                optional: true,
            },
            label: {
                kind: "parsed",
                parse: String,
                brief: "Label to attach to the new node (e.g. imu1), for later reference as &label",
                optional: true,
            },
            overlay: {
                kind: "parsed",
                parse: String,
                brief: "dtso"
            },
            context: {
                kind: "parsed",
                parse: String,
                brief: "The target dts",
                optional: true,
            },
            linux: {
                kind: "parsed",
                parse: String,
                brief: "Path to Linux repo",
                optional: true,
            },
            dtSchema: {
                kind: "parsed",
                parse: String,
                brief: "Path to dt-schema repo",
                optional: true,
            },
        }
    },
    docs: {
        brief: "Add a new node to an existing dtso"
    },
    async func(flags: Flags) {
        const config = load_config();
        const linux = flags.linux ?? config.linux;
        const dtSchema = flags.dtSchema ?? config.dtSchema;
        const context = flags.context ?? config.context;
        const { compatible, name, parent, label, overlay: input } = flags;

        if (compatible === undefined && name === undefined) {
            console.log("Missing: --compatible or --name (at least one is required)");
            return;
        }

        if (linux === undefined) {
            console.log("Missing: --linux (no config.toml found)");
            return;
        }

        if (dtSchema === undefined) {
            console.log("Missing: --dt-schema (no config.toml found)");
            return;
        }

        if (context === undefined) {
            console.log("Missing: --context (no config.toml found)");
            return;
        }

        if (!fs.existsSync(context)) {
            console.log(`Missing: ${context}`);
            return;
        }

        if (!fs.existsSync(linux)) {
            console.log(`Missing: ${linux}`);
            return;
        }

        if (!fs.existsSync(dtSchema)) {
            console.log(`Missing: ${dtSchema}`);
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

        if (compatible !== undefined) {
            const binding_path = await find_binding(linux, dtSchema, compatible);

            if (binding_path === undefined) {
                console.log(`Failed to find binding for ${compatible}`);
                return;
            }
        }

        const node_name = name ?? compatible!;
        const result = add_overlay_node(base, overlay, node_name, parent, label, compatible);

        switch (result) {
            case "parent-not-found": {
                console.log(`Couldn't find parent node ${parent} in ${context} or ${input}`);
                return;
            }
            case "added": {
                fs.writeFileSync(input, overlay.print());
                console.log(`Added ${node_name} to ${input}`);
                return;
            }
        }
    }
});

export function add_overlay_node(
    base: DeviceTree,
    overlay: DeviceTreeOverlay,
    node_name: string,
    parent_identifier: string | undefined,
    label: string | undefined,
    compatible: string | undefined,
): "added" | "parent-not-found" {

    const compatible_property: DTProperty | undefined = (() => {
        if (compatible === undefined) {
            return;
        }

        return PropertyBuilder.build_string()
            .with_value(compatible)
            .with_name("compatible")
            .build();
    })();

    const at = node_name.indexOf('@');
    const name = at === -1 ? node_name : node_name.slice(0, at);
    const unit = at === -1 ? undefined : node_name.slice(at + 1);

    const new_node = NodeBuilder.new()
        .with_name(name)
        .with_unit_address(unit)
        .with_label(label ?? [])
        .with_properties(compatible_property);

    if (parent_identifier === undefined) {
        // Add to root — create a fragment targeting "/"
        // eslint-disable-next-line unicorn/no-useless-undefined
        overlay.add_fragment({ kind: "path", labels: [], path: "/" }, new_node, undefined);
        return "added";
    }

    // Try to find parent in overlay (could be in an existing fragment's __overlay__)
    const in_overlay = overlay.find_node(parent_identifier);
    if (in_overlay !== undefined) {
        in_overlay.node.children.push(new_node.build());
        return "added";
    }

    // Try to find parent in base
    const in_base = base.resolve_identifier(parent_identifier);
    if (in_base === undefined) {
        return "parent-not-found";
    }

    // eslint-disable-next-line unicorn/no-useless-undefined
    overlay.add_fragment(in_base, new_node, undefined);

    return "added";
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

    const empty_overlay = `/dts-v1/;
/plugin/;

&spi0 {
};`;

    test("add_overlay_node - adds node to existing overlay fragment", () => {
        const base = DT.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }

        const overlay = DTO_cls.new_from_string(empty_overlay, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = add_overlay_node(base, overlay, "adi,ad7124-8@0", "spi0", "imu1", "adi,ad7124-8");

        expect(result).toBe("added");

        const output = overlay.print();

        expect(output).toContain("adi,ad7124-8@0");
        expect(output).toContain('compatible = "adi,ad7124-8"');
        expect(output).toContain("spi0");
    });

    test("add_overlay_node - creates new fragment when parent not yet in overlay", () => {
        const base = DT.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }

        const overlay = DTO_cls.new_from_string(empty_overlay, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = add_overlay_node(base, overlay, "adi,ad7124-8@0", "spi1", "imu2", "adi,ad7124-8");

        expect(result).toBe("added");

        const output = overlay.print();

        expect(output).toContain("adi,ad7124-8@0");
        expect(output).toContain("spi1");
    });

    test("add_overlay_node - adds to root when no parent specified", () => {
        const base = DT.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }

        const overlay = DTO_cls.new_from_string(empty_overlay, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        // eslint-disable-next-line unicorn/no-useless-undefined
        const result = add_overlay_node(base, overlay, "my-device", undefined, undefined, undefined);

        expect(result).toBe("added");

        const output = overlay.print();

        expect(output).toContain("my-device");
    });

    test("add_overlay_node - returns parent-not-found for unknown parent", () => {
        const base = DT.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }

        const overlay = DTO_cls.new_from_string(empty_overlay, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = add_overlay_node(base, overlay, "adi,ad7124-8@0", "i2c0", "imu1", "adi,ad7124-8");
        expect(result).toBe("parent-not-found");
    });

    test("add_overlay_node - adds grandchild to overlay-added parent", () => {
        const overlay_with_imu = `/dts-v1/;
/plugin/;

&spi0 {
    imu1: adi,ad7124-8@0 {
        compatible = "adi,ad7124-8";
    };
};`;
        const base = DT.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }

        const overlay = DTO_cls.new_from_string(overlay_with_imu, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        // eslint-disable-next-line unicorn/no-useless-undefined
        const result = add_overlay_node(base, overlay, "channel@0", "imu1", undefined, undefined);

        expect(result).toBe("added");

        const output = overlay.print();

        expect(output).toContain("channel@0");
        expect(output).toContain("imu1");
    });
}
