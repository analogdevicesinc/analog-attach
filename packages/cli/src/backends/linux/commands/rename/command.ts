import {
    DeviceTree,
    DeviceTreeOverlay,
    parse_unit_address,
    address_cells_of,
    encode_reg_address,
    decode_reg_address,
    is_dt_flag,
    type UnitRadix,
} from "attach-lib";

import { answer, command, refuse, type RenameArguments } from "../../../../interface/backend-interface";
import type { CommonResponse } from "../../protocol/types";
import { load_workspace, optional_bindings } from "../../config/workspace";
import { child_unit_radix } from "../../binding-resolution";
import { resolve_node_identifier, not_found_message } from "../../utilities";
import { node_reg_warnings, reg_warning_lines } from "../../reg-conflicts";

export const rename = command<RenameArguments, CommonResponse>({
    docs: {
        brief: "Rename a node",
        placeholders: { name: "new-name" },
        full: `A bare name (no @) keeps the existing unit address: adc@0 renamed to
my_adc becomes my_adc@0. Include @ to change it; reg is updated to match.

Paths:
  Label:        spi0                       (a label in the base tree)
  Label-first:  spi0/adi,ad7124-8@0       (label then child segments)
  Absolute:     /soc/spi@7e204000          (full device tree path)`,
        examples: [
            "rename spi0/adi,ad7124-8@0 adc        Rename, keep unit address",
            "rename spi0/adi,ad7124-8@0 adc@1      Rename and change unit address",
        ],
    },
    async run({ path: path_argument, name: new_name }, _flags, session) {
        const loaded = load_workspace(session, ["base", "overlay"]);
        if (!loaded.ok) { return loaded.outcome; }
        const { workspace } = loaded;
        const { source: devicetree, tree: base } = workspace.base;
        const { path: input, tree: overlay } = workspace.overlay;
        // Bindings are optional here: they only decide the radix of the unit address.
        const bindings = optional_bindings(workspace);
        const found = overlay.find_node(resolve_node_identifier(path_argument, overlay));
        const parent_path = found === undefined ? undefined : found.node_path.split("/").slice(0, -1).join("/") || "/";
        const radix = bindings.ok && parent_path !== undefined
            ? await child_unit_radix(overlay.effective_node(parent_path), new_name.split("@")[0] ?? new_name, bindings.value)
            : undefined;
        const result = rename_overlay_node(overlay, path_argument, new_name, radix);
        switch (result.status) {
            case "not-found": { return refuse(not_found_message(path_argument, overlay, base)); }
            case "in-base": {
                return refuse(`${path_argument} is part of the base device tree (${devicetree}), not this overlay; rename only applies to overlay-added nodes`);
            }
            case "is-root": { return refuse("Cannot rename the root node"); }
            case "conflict": { return refuse(`${new_name} already exists under the same parent`); }
            case "renamed": {
                workspace.overlay.save();
                const warnings = node_reg_warnings(overlay, result.path);
                for (const line of warnings.flatMap(w => reg_warning_lines(w))) { session.warn(line); }
                const message = result.reg_message === undefined
                    ? `Renamed ${path_argument} to ${new_name}`
                    : `Renamed ${path_argument} to ${new_name}; ${result.reg_message}`;
                const text = [
                    ...(result.reg_message === undefined ? [] : [result.reg_message]),
                    `Renamed ${path_argument} to ${new_name} in ${input}`,
                ].join("\n");
                return answer({ ok: true, message, severity: warnings.length > 0 ? "warn" : "info" }, text);
            }
        }
    },
});

type RenameResult =
    | { status: "renamed"; path: string; reg_message?: string }
    | { status: "not-found" | "in-base" | "is-root" | "conflict" };

export function rename_overlay_node(
    overlay: DeviceTreeOverlay,
    identifier: string,
    to: string,
    radix: UnitRadix = 16,
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
        const parsed = parse_unit_address(new_unit, radix);
        if (parsed !== undefined) {
            const cells = address_cells_of(overlay, parent_path);
            const existing_reg = found.node.properties.find(p => p.name === "reg");
            if (existing_reg === undefined) {
                // Create reg
                const new_reg = encode_reg_address(parsed, cells.address, cells.size);
                found.node.properties.push(new_reg);
                reg_message = `reg created`;
            } else {
                // Replace first address cells, keep size cells and other entries
                const new_reg = encode_reg_address(parsed, cells.address, cells.size);
                const index = found.node.properties.indexOf(existing_reg);
                found.node.properties[index] = new_reg;
                reg_message = `reg first cell set to ${parsed}`;
            }
        }
    }

    return { status: "renamed", path: parent_path === "/" ? `/${new_key}` : `${parent_path}/${new_key}`, reg_message };
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

    test("rename_overlay_node — decimal radix reads the unit as decimal", () => {
        const base = DeviceTree.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DeviceTreeOverlay.new_from_string(overlay_with_imu, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        expect(rename_overlay_node(overlay, "imu1", "adc@10", 10)).toMatchObject({ status: "renamed" });
        expect(overlay.print()).toMatch(/adc@10 \{[^}]*reg = <10>/s);
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
