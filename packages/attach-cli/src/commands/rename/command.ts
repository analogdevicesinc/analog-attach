import { Command } from "commander";
import {
    DeviceTree,
    DeviceTreeOverlay,
    parse_unit_address,
    address_cells_of,
    encode_reg_address,
    decode_reg_address,
    is_dt_flag,
} from "attach-lib";

import type { LocalContext } from "../../context";
import { resolve_config } from "../../resolve-config";
import { load_trees, resolve_node_identifier, not_found_message, write_overlay } from "../../utilities";
import { respond, respond_fail, diagnostic } from "../../protocol/output";

export function build_rename_command(context_: LocalContext): Command {
    return new Command("rename")
        .description("Rename an overlay-added node")
        .argument("<path>", "Path to node")
        .argument("<new-name>", "New name for the node (e.g. adc@1)")
        .action(async (path_argument: string, new_name: string) => {
            const resolved = resolve_config(context_, ["context", "overlay"]);
            if (resolved === undefined) { return; }
            const { context, overlay: input } = resolved.values;

            const trees = load_trees(context_, context, input, resolved.parsed.context);
            if (trees === undefined) { return; }
            const overlay = trees.overlay;

            const result = rename_overlay_node(overlay, path_argument, new_name);

            if (context_.json) {
                switch (result.status) {
                    case "renamed": {
                        write_overlay(input, overlay, resolved.config);
                        const message = result.reg_message !== undefined
                            ? `Renamed ${path_argument} to ${new_name}; ${result.reg_message}`
                            : `Renamed ${path_argument} to ${new_name}`;
                        respond({ ok: true, message, severity: "info" });
                        return;
                    }
                    case "not-found": {
                        respond_fail({ ok: false, message: not_found_message(path_argument, overlay, trees.base_dt), severity: "error" });
                        return;
                    }
                    case "in-base": {
                        respond_fail({ ok: false, message: `${path_argument} is part of the base device tree, not this overlay`, severity: "error" });
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
                switch (result.status) {
                    case "not-found": {
                        console.log(not_found_message(path_argument, overlay, trees.base_dt));
                        return;
                    }
                    case "in-base": {
                        console.log(`${path_argument} is part of the base device tree (${context}), not this overlay; rename only applies to overlay-added nodes`);
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
                        if (result.reg_message !== undefined) { console.log(result.reg_message); }
                        console.log(`Renamed ${path_argument} to ${new_name} in ${input}`);
                        return;
                    }
                }
            }
        });
}

type RenameResult =
    | { status: "renamed"; reg_message?: string }
    | { status: "not-found" | "in-base" | "is-root" | "conflict" };

export function rename_overlay_node(
    overlay: DeviceTreeOverlay,
    identifier: string,
    to: string,
): RenameResult {
    const found = overlay.find_node(resolve_node_identifier(identifier, overlay));

    if (found === undefined) { return { status: "not-found" }; }
    if (found.is_in_base) { return { status: "in-base" }; }
    if (found.parent_node === undefined) { return { status: "is-root" }; }

    const at = to.indexOf('@');
    const new_name = at === -1 ? to : to.slice(0, at);
    const new_unit = at === -1
        ? found.node.unit_addr
        : (to.slice(at + 1) === "" ? undefined : to.slice(at + 1));

    // R2/R9: duplicate check against effective siblings
    const parent_path = found.node_path.split("/").slice(0, -1).join("/") || "/";
    const effective = overlay.effective_children(parent_path);
    const new_key = new_unit === undefined ? new_name : `${new_name}@${new_unit}`;
    const old_key = found.node.unit_addr === undefined ? found.node.name : `${found.node.name}@${found.node.unit_addr}`;
    if (new_key !== old_key && effective.has(new_key)) {
        return { status: "conflict" };
    }

    found.node.name = new_name;
    found.node.unit_addr = new_unit;

    // R9: update reg when unit address changes
    let reg_message: string | undefined;
    if (at !== -1 && new_unit !== undefined) {
        const parsed = parse_unit_address(new_unit);
        if (parsed !== undefined) {
            const cells = address_cells_of(overlay, parent_path);
            const existing_reg = found.node.properties.find(p => p.name === "reg");
            if (existing_reg !== undefined) {
                // Replace first address cells, keep size cells and other entries
                const new_reg = encode_reg_address(parsed, cells.address, cells.size);
                const index = found.node.properties.indexOf(existing_reg);
                found.node.properties[index] = new_reg;
                reg_message = `reg first cell set to ${parsed}`;
            } else {
                // Create reg
                const new_reg = encode_reg_address(parsed, cells.address, cells.size);
                found.node.properties.push(new_reg);
                reg_message = `reg created`;
            }
        }
    }

    return { status: "renamed", reg_message };
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    const base_dts = `/dts-v1/;
/ {
    soc {
        spi0: spi@7e204000 {
            #address-cells = <1>;
            #size-cells = <0>;
            spidev@0 {
                reg = <0>;
            };
        };
    };
};`;

    const overlay_with_imu = `/dts-v1/;
/plugin/;

&spi0 {
    imu1: adi,ad7124-8@0 {
        compatible = "adi,ad7124-8";
        reg = <0>;
    };
};`;

    const overlay_two_children = `/dts-v1/;
/plugin/;

&spi0 {
    imu1: adi,ad7124-8@0 {
        compatible = "adi,ad7124-8";
        reg = <0>;
    };
    imu2: adi,ad7124-8@1 {
        compatible = "adi,ad7124-8";
        reg = <1>;
    };
};`;

    test("rename_overlay_node — renames node key", () => {
        const base = DeviceTree.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DeviceTreeOverlay.new_from_string(overlay_with_imu, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = rename_overlay_node(overlay, "imu1", "my_adc@0");
        expect(result.status).toBe("renamed");
        expect(overlay.print()).toContain("my_adc@0");
    });

    test("rename_overlay_node — unit change rewrites reg", () => {
        const base = DeviceTree.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DeviceTreeOverlay.new_from_string(overlay_with_imu, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = rename_overlay_node(overlay, "imu1", "adc@3");
        expect(result.status).toBe("renamed");
        if (result.status !== "renamed") { return; }
        expect(result.reg_message).toContain("reg");
        expect(overlay.print()).toContain("adc@3");
    });

    test("rename_overlay_node — conflict with effective sibling", () => {
        const base = DeviceTree.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DeviceTreeOverlay.new_from_string(overlay_two_children, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = rename_overlay_node(overlay, "imu1", "adi,ad7124-8@1");
        expect(result.status).toBe("conflict");
    });

    test("rename_overlay_node — conflict with base child", () => {
        const base = DeviceTree.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DeviceTreeOverlay.new_from_string(overlay_with_imu, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = rename_overlay_node(overlay, "imu1", "spidev@0");
        expect(result.status).toBe("conflict");
    });

    test("rename_overlay_node — bare name preserves unit and reg", () => {
        const base = DeviceTree.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DeviceTreeOverlay.new_from_string(overlay_with_imu, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = rename_overlay_node(overlay, "imu1", "my_adc");
        expect(result.status).toBe("renamed");
        if (result.status !== "renamed") { return; }
        expect(result.reg_message).toBeUndefined();
        expect(overlay.print()).toContain("my_adc@0");
    });

    test("rename_overlay_node — refuses base-tree node", () => {
        const base = DeviceTree.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DeviceTreeOverlay.new_from_string(overlay_with_imu, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        expect(rename_overlay_node(overlay, "spi0", "spi1").status).toBe("in-base");
    });
}
