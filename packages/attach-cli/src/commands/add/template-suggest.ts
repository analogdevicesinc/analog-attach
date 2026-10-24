import path from "node:path";

import type { Settings } from "../../config/settings";
import type { Bindings } from "../../config/workspace";
import type { DeviceTree } from "attach-lib";
import { overlay_index, type OverlayIndex } from "../../overlay-index";
import { overlay_rows } from "../list/overlay";
import { find_overlay } from "../import/command";
import type { Suggestion } from "../../protocol/types";
import { binding_siblings, find_binding, node_compatibles } from "../../utilities";
import { binding_examples, BUS_LABEL, device_matcher, find_examples, type ExampleSearch } from "./example";

/** The `--template` values for a device: `required`, each example that holds it, and the overlays of the tree that add it. */
export async function template_suggestions(workspace: { settings: Settings; bindings: Bindings; base: { tree: DeviceTree } }, compatible: string): Promise<Suggestion[]> {
    const { settings, bindings } = workspace;
    const suggestions: Suggestion[] = [{ value: "required", display_string: "interview for the required properties" }];
    const binding_path = await find_binding(bindings.linux, bindings.dt_schema, compatible);
    if (binding_path === undefined) { return suggestions; }

    const search = find_examples(await binding_examples(binding_path, bindings), device_matcher(bindings, binding_path, compatible), settings, bindings.linux);
    suggestions.push(...example_suggestions(search));

    const root = workspace.base.tree.node_at("/");
    const index = overlay_index(bindings.linux);
    suggestions.push(...overlay_suggestions(index, compatible, root === undefined ? [] : node_compatibles(root), await binding_siblings(bindings, compatible)));
    return suggestions;
}

/** `example:N` for each example with the device, its bus as the description. */
export function example_suggestions(search: ExampleSearch): Suggestion[] {
    return search.matches.map(match => ({
        value: `example:${match.index}`,
        display_string: match.bus === undefined ? "binding example" : BUS_LABEL[match.bus],
    }));
}

/** `overlay:<name>` for each overlay with the device, compatible ones first; the path from the tree when the name alone is ambiguous. */
export function overlay_suggestions(index: OverlayIndex, compatible: string, base: string[], siblings: readonly string[] = []): Suggestion[] {
    return overlay_rows(index, compatible, base, siblings).map(row => {
        const name = find_overlay(index, row.name).kind === "found" ? row.name : path.relative(index.linux, row.path);
        return { value: `overlay:${name}`, display_string: `${row.fit} (${row.reason})${row.matched === undefined ? "" : ` via ${row.matched}`}` };
    });
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    test("example_suggestions — one per example with the device, the bus as the description", () => {
        const node = { labels: [], name: "adc", unit_addr: undefined, properties: [], children: [] };
        expect(example_suggestions({
            count: 3,
            matches: [{ index: 1, node, bus: "i2c" }, { index: 3, node, bus: "spi" }, { index: 4, node, bus: undefined }],
            broken: new Map(),
        })).toEqual([
            { value: "example:1", display_string: "I2C" },
            { value: "example:3", display_string: "SPI" },
            { value: "example:4", display_string: "binding example" },
        ]);
    });

    test("overlay_suggestions — compatible ones first; a name shared by two overlays gets its path", () => {
        const index: OverlayIndex = {
            linux: "/linux",
            files: {
                "arch/arm/boot/dts/overlays/ad7124-overlay.dts": { devices: ["adi,ad7124-8"], board: ["brcm,bcm2711"] },
                "arch/arm64/boot/dts/xilinx/zynqmp-ad7124.dtso": { devices: ["adi,ad7124-8"], board: ["xlnx,zynqmp"] },
                "arch/arm/boot/dts/overlays/same.dtso": { devices: ["adi,ad7124-8"], board: ["brcm,bcm2711"] },
                "arch/arm64/boot/dts/xilinx/same.dtso": { devices: ["adi,ad7124-8"], board: ["brcm,bcm2711"] },
            },
        };
        index.files["arch/arm/boot/dts/overlays/four-overlay.dts"] = { devices: ["adi,ad7124-4"], board: ["brcm,bcm2711"] };
        expect(overlay_suggestions(index, "adi,ad7124-8", ["brcm,bcm2711"], ["adi,ad7124-4"])).toEqual([
            { value: "overlay:ad7124-overlay.dts", display_string: "compatible (brcm,bcm2711)" },
            { value: "overlay:arch/arm/boot/dts/overlays/same.dtso", display_string: "compatible (brcm,bcm2711)" },
            { value: "overlay:arch/arm64/boot/dts/xilinx/same.dtso", display_string: "compatible (brcm,bcm2711)" },
            { value: "overlay:four-overlay.dts", display_string: "compatible (brcm,bcm2711) via adi,ad7124-4" },
            { value: "overlay:zynqmp-ad7124.dtso", display_string: "incompatible (overlay: xlnx,zynqmp; base: brcm,bcm2711)" },
        ]);
    });
}
