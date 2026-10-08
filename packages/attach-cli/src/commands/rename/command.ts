import { Command } from "commander";
import { DeviceTree, DeviceTreeOverlay } from "attach-lib";

import type { LocalContext } from "../../context";
import { resolve_config } from "../../resolve-config";
import { load_trees, resolve_node_identifier, not_found_message, write_overlay } from "../../utilities";
import { respond, respond_fail, input_error } from "../../protocol/output";

export function build_rename_command(context_: LocalContext): Command {
    return new Command("rename")
        .description("Rename an overlay-added node")
        .argument("<path>", "Path to node")
        .argument("<new-name>", "New name for the node (e.g. adc@1)")
        .action(async (path_argumentument: string, new_name: string) => {
            const resolved = resolve_config(context_, ["context", "overlay"]);
            if (resolved === undefined) { return; }
            const { context, overlay: input } = resolved.values;

            const trees = load_trees(context_, context, input, resolved.parsed.context);
            if (trees === undefined) { return; }
            const overlay = trees.overlay;

            const result = rename_overlay_node(overlay, path_argumentument, new_name);

            if (context_.json) {
                switch (result) {
                    case "renamed": {
                        write_overlay(input, overlay, resolved.config);
                        respond({ ok: true, message: `Renamed ${path_argumentument} to ${new_name}`, severity: "info" });
                        return;
                    }
                    case "not-found": {
                        respond_fail({ ok: false, message: not_found_message(path_argumentument, overlay, trees.base_dt), severity: "error" });
                        return;
                    }
                    case "in-base": {
                        respond_fail({ ok: false, message: `${path_argumentument} is part of the base device tree, not this overlay`, severity: "error" });
                        return;
                    }
                    case "is-root": {
                        respond_fail({ ok: false, message: "Cannot rename the root node", severity: "error" });
                        return;
                    }
                    case "conflict": {
                        respond_fail({ ok: false, message: `${new_name} already exists under the same parent`, severity: "error" });
                        return;
                    }
                }
            } else {
                switch (result) {
                    case "not-found": {
                        console.log(not_found_message(path_argumentument, overlay, trees.base_dt));
                        return;
                    }
                    case "in-base": {
                        console.log(`${path_argumentument} is part of the base device tree (${context}), not this overlay; rename only applies to overlay-added nodes`);
                        return;
                    }
                    case "is-root": {
                        console.log("Refusing to rename the root node");
                        return;
                    }
                    case "conflict": {
                        console.log(`${new_name} already exists under the same parent`);
                        return;
                    }
                    case "renamed": {
                        write_overlay(input, overlay, resolved.config);
                        console.log(`Renamed ${path_argumentument} to ${new_name} in ${input}`);
                        return;
                    }
                }
            }
        });
}

export function rename_overlay_node(
    overlay: DeviceTreeOverlay,
    identifier: string,
    to: string,
): "renamed" | "not-found" | "in-base" | "is-root" | "conflict" {
    const found = overlay.find_node(resolve_node_identifier(identifier, overlay));

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
        const base = DeviceTree.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }

        const overlay = DeviceTreeOverlay.new_from_string(overlay_with_imu, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = rename_overlay_node(overlay, "imu1", "my_adc@0");

        expect(result).toBe("renamed");

        const output = overlay.print();

        expect(output).toContain("my_adc@0");
        expect(output).not.toContain("adi,ad7124-8@0");
    });

    test("rename_overlay_node - new-name without @ preserves existing unit addr", () => {
        const base = DeviceTree.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }

        const overlay = DeviceTreeOverlay.new_from_string(overlay_with_imu, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = rename_overlay_node(overlay, "imu1", "my_adc");

        expect(result).toBe("renamed");

        const output = overlay.print();

        expect(output).toContain("my_adc@0");
        expect(output).not.toContain("adi,ad7124-8@0");
    });

    test("rename_overlay_node - new-name with @ overrides unit addr", () => {
        const base = DeviceTree.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }

        const overlay = DeviceTreeOverlay.new_from_string(overlay_with_imu, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = rename_overlay_node(overlay, "imu1", "my_adc@3");

        expect(result).toBe("renamed");

        const output = overlay.print();

        expect(output).toContain("my_adc@3");
        expect(output).not.toContain("adi,ad7124-8@0");
    });

    test("rename_overlay_node - refuses base-tree node", () => {
        const base = DeviceTree.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }

        const overlay = DeviceTreeOverlay.new_from_string(overlay_with_imu, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = rename_overlay_node(overlay, "spi0", "spi1");

        expect(result).toBe("in-base");
    });

    test("rename_overlay_node - returns not-found for unknown label", () => {
        const base = DeviceTree.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }

        const overlay = DeviceTreeOverlay.new_from_string(overlay_with_imu, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = rename_overlay_node(overlay, "nonexistent", "foo");

        expect(result).toBe("not-found");
    });

    test("rename_overlay_node - returns conflict when new key collides with sibling", () => {
        const base = DeviceTree.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }

        const overlay = DeviceTreeOverlay.new_from_string(overlay_two_children, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = rename_overlay_node(overlay, "imu1", "adi,ad7124-8@1");

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
        const base = DeviceTree.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }

        const overlay = DeviceTreeOverlay.new_from_string(overlay_nested, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = rename_overlay_node(overlay, "imu1/channel@0", "channel@1");

        expect(result).toBe("renamed");

        const output = overlay.print();

        expect(output).toContain("channel@1");
        expect(output).not.toContain("channel@0");
        expect(output).toContain("imu1");
    });
}
