import { missing_required, type DeviceTreeOverlay } from "attach-lib";

import type { NodeBinding } from "./binding-resolution";

/**
 * The required properties the node at `path` doesn't have yet, in the order
 * to set them (see the lib's `missing_required`). Properties the base tree
 * already sets on the node count as set.
 */
export function node_missing_required(binding: Pick<NodeBinding, "required_properties">, overlay: DeviceTreeOverlay, path: string): string[] {
    const node = overlay.effective_node(path);
    return missing_required(binding.required_properties, node?.properties.map(p => p.name) ?? []);
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;
    const { DeviceTree, DeviceTreeOverlay: DTO } = await import("attach-lib");

    test("node_missing_required — base and overlay properties both count", () => {
        const base = DeviceTree.new_from_string(`/dts-v1/;\n/ {\n\tsoc {\n\t\tspi0: spi@7e204000 {\n\t\t\tcompatible = "brcm,bcm2835-spi";\n\t\t};\n\t};\n};`);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DTO.new_from_string(`/dts-v1/;\n/plugin/;\n\n&spi0 {\n\treg = <0x7e204000 0x200>;\n\tadc@0 {\n\t\tcompatible = "adi,ad7124-8";\n\t};\n};`, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        expect(node_missing_required({ required_properties: ["compatible", "reg", "clocks"] }, overlay, "/soc/spi@7e204000")).toEqual(["clocks"]);
        expect(node_missing_required({ required_properties: ["compatible", "reg", "interrupts"] }, overlay, "/soc/spi@7e204000/adc@0"))
            .toEqual(["reg", "interrupt-parent", "interrupts"]);
    });
}
