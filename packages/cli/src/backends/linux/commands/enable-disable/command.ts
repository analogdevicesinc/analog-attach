import { DeviceTree, DeviceTreeOverlay, PropertyBuilder } from "attach-lib";

import { answer, input_error, refuse, type ExtraCommand } from "../../../../interface/backend-interface";
import { load_workspace } from "../../config/workspace";
import { positional_word, resolve_path } from "../../utilities";
import type { CommonResponse } from "../../protocol/types";

/** `enable <path>` / `disable <path>`: the node's status in the overlay. */
function status_command(name: "enable" | "disable", status_value: "okay" | "disabled", verb: string): ExtraCommand<Record<never, never>, CommonResponse> {
    return {
        docs: {
            brief: `${verb} a node (status = "${status_value}")`,
            full: `Paths:
  Label:        spi0                       (a label in the base tree)
  Label-first:  spi0/adi,ad7124-8@0       (label then child segments)
  Absolute:     /soc/spi@7e204000          (full device tree path)`,
            examples: [`${name} spi0`, `${name} spi0/spidev@0`],
        },
        positionals: [
            { name: "path", placeholder: "path", brief: "Path to node (label, label-first, or absolute)", optional: true, slot: prior => ({ kind: "extra", command: name, id: "path", prior }) },
        ],
        group: "edit",
        schema: "enable-disable.schema.json",
        async run(arguments_, _flags, session) {
            const path_argument = positional_word(arguments_, "path");
            if (path_argument === undefined) { return input_error("Missing: path"); }

            const loaded = load_workspace(session, ["base", "overlay"]);
            if (!loaded.ok) { return loaded.outcome; }
            const { workspace } = loaded;
            const { source: devicetree, tree: base } = workspace.base;
            const { path: input, tree: overlay } = workspace.overlay;

            const result = set_node_status(base, overlay, path_argument, status_value);
            if (result === "not-found") {
                const response = status_response(result, verb, path_argument);
                return refuse(response.message, { text: `Couldn't find node ${path_argument} in ${devicetree} or ${input}` });
            }
            workspace.overlay.save();
            return answer(status_response(result, verb, path_argument), `${verb}d ${path_argument} in ${input}`);
        },
    };
}

export function status_response(result: "done" | "not-found", verb: string, identifier: string): CommonResponse {
    return result === "done"
        ? { ok: true, message: `${verb}d ${identifier}`, severity: "info" }
        : { ok: false, message: `Not found: ${identifier}`, severity: "error" };
}

export const enable = status_command("enable", "okay", "Enable");
export const disable = status_command("disable", "disabled", "Disable");

export function set_node_status(
    base: DeviceTree,
    overlay: DeviceTreeOverlay,
    identifier: string,
    status: "okay" | "disabled",
): "done" | "not-found" {

    const status_property = PropertyBuilder.build_string()
        .with_value(status)
        .with_name("status")
        .build();

    const resolved = resolve_path(identifier, overlay, base);
    const path = resolved.in_overlay?.node_path ?? resolved.in_base?.path;
    const node = path === undefined ? undefined : overlay.ensure_node(path);
    if (node === undefined) { return "not-found"; }

    const index = node.properties.findIndex(p => p.name === "status");
    if (index === -1) {
        node.properties.push(status_property);
    } else {
        node.properties[index] = status_property;
    }
    return "done";
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

    const overlay_with_status = `/dts-v1/;
/plugin/;

&spi0 {
    status = "disabled";
};`;

    test("set_node_status - enable adds status = okay to node without one", () => {
        const base = DeviceTree.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }

        const overlay = DeviceTreeOverlay.new_from_string(overlay_with_imu, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = set_node_status(base, overlay, "spi0", "okay");

        expect(result).toBe("done");

        const output = overlay.print();

        expect(output).toContain('status = "okay"');
    });

    test("set_node_status - disable adds status = disabled", () => {
        const base = DeviceTree.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }

        const overlay = DeviceTreeOverlay.new_from_string(overlay_with_imu, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = set_node_status(base, overlay, "spi0", "disabled");

        expect(result).toBe("done");

        const output = overlay.print();

        expect(output).toContain('status = "disabled"');
    });

    test("set_node_status - overwrites existing status value", () => {
        const base = DeviceTree.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }

        const overlay = DeviceTreeOverlay.new_from_string(overlay_with_status, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = set_node_status(base, overlay, "spi0", "okay");

        expect(result).toBe("done");

        const output = overlay.print();

        expect(output).toContain('status = "okay"');
        expect(output).not.toContain('status = "disabled"');
    });

    test("set_node_status - returns not-found for unknown node", () => {
        const base = DeviceTree.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }

        const overlay = DeviceTreeOverlay.new_from_string(overlay_with_imu, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = set_node_status(base, overlay, "nonexistent", "okay");

        expect(result).toBe("not-found");
    });

    test("set_node_status - enable works on base-tree node (sets status in overlay)", () => {
        const base = DeviceTree.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }

        const overlay = DeviceTreeOverlay.new_from_string(overlay_with_imu, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = set_node_status(base, overlay, "spi0", "okay");

        expect(result).toBe("done");

        const output = overlay.print();

        expect(output).toContain("spi0");
        expect(output).toContain('status = "okay"');
    });

    test("set_node_status - creates new fragment when base node not yet in overlay", () => {
        const base = DeviceTree.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }

        // Start with an overlay that targets a different node
        const overlay_other = `/dts-v1/;\n/plugin/;\n\n&spi0 {\n};\n`;
        const overlay = DeviceTreeOverlay.new_from_string(overlay_other, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        // Disable spi0 — it has an existing fragment, should update its __overlay__
        const result = set_node_status(base, overlay, "spi0", "okay");

        expect(result).toBe("done");

        const output = overlay.print();

        expect(output).toContain('status = "okay"');
    });

    test("status_response - the JSON for done and not-found", () => {
        expect(status_response("done", "Disable", "spi0/spidev@0"))
            .toEqual({ ok: true, message: "Disabled spi0/spidev@0", severity: "info" });
        expect(status_response("not-found", "Enable", "nope"))
            .toEqual({ ok: false, message: "Not found: nope", severity: "error" });
    });
}
