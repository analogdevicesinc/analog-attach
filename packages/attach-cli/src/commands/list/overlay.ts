import path from "node:path";

import type { LocalContext } from "../../context";
import type { OverlayIndex } from "../../config/cache";
import { load_workspace } from "../../config/workspace";
import { board_fit, type Fit } from "../../board-fit";
import { get_or_build_overlay_index, overlays_with } from "../../overlay-index";
import { input_error, respond } from "../../protocol/output";
import type { ListOverlayResponse, OverlayDescription } from "../../protocol/types";
import { node_compatibles } from "../../utilities";

export async function list_overlay(context_: LocalContext, arguments_: string[]): Promise<void> {
    const [compatible] = arguments_;
    if (compatible === undefined) {
        if (context_.json) { input_error("compatible string is required for list overlay"); }
        else { console.log("Missing: compatible (list overlay <compatible>)"); }
        return;
    }

    const workspace = load_workspace(context_, ["bindings", "base"]);
    if (workspace === undefined) { return; }
    const { linux } = workspace.bindings;
    const root = workspace.base.tree.node_at("/");
    const rows = overlay_rows(get_or_build_overlay_index(linux), compatible, root === undefined ? [] : node_compatibles(root));

    if (context_.json) {
        const response: ListOverlayResponse = {
            ok: true,
            message: `${rows.length} overlays with ${compatible}`,
            severity: "info",
            overlays: rows,
        };
        respond(response);
        return;
    }
    if (rows.length === 0) {
        console.log(`No overlay in ${linux} has ${compatible}`);
        return;
    }
    for (const line of format_overlay_rows(rows)) { console.log(line); }
}

const FIT_ORDER: Record<Fit, number> = { compatible: 0, unknown: 1, incompatible: 2 };

/** The overlays with the compatible and how they fit the base: compatible ones first, then unknown, then incompatible. */
export function overlay_rows(index: OverlayIndex, compatible: string, base: string[]): OverlayDescription[] {
    return overlays_with(index, compatible)
        .map(file => ({ name: path.basename(file), path: path.join(index.linux, file), ...board_fit(index.files[file]?.board, base) }))
        .sort((a, b) => FIT_ORDER[a.fit] - FIT_ORDER[b.fit] || a.name.localeCompare(b.name));
}

export function format_overlay_rows(rows: OverlayDescription[]): string[] {
    const width = Math.max(...rows.map(row => row.name.length));
    return rows.map(row => `${row.name.padEnd(width)}  ${row.fit} (${row.reason})`);
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    const index: OverlayIndex = {
        generated_at: 0,
        linux: "/linux",
        files: {
            "arch/arm64/boot/dts/xilinx/zynqmp-ad7124.dtso": { devices: ["adi,ad7124-8"], board: ["xlnx,zynqmp"] },
            "arch/arm/boot/dts/overlays/generic-adc-overlay.dts": { devices: ["adi,ad7124-8"] },
            "arch/arm/boot/dts/overlays/rpi-ad7124-overlay.dts": { devices: ["adi,ad7124-8"], board: ["brcm,bcm2835"] },
            "arch/arm/boot/dts/overlays/ad7124-8-overlay.dts": { devices: ["adi,ad7124-8"], board: ["brcm,bcm2711"] },
            "arch/arm/boot/dts/overlays/other-overlay.dts": { devices: ["adi,ad7173-8"], board: ["brcm,bcm2711"] },
        },
    };
    const PI4 = ["raspberrypi,4-model-b", "brcm,bcm2711"];

    test("overlay_rows — compatible first, then unknown, then incompatible; by name within each", () => {
        expect(overlay_rows(index, "adi,ad7124-8", PI4)).toEqual([
            { name: "ad7124-8-overlay.dts", path: "/linux/arch/arm/boot/dts/overlays/ad7124-8-overlay.dts", fit: "compatible", reason: "brcm,bcm2711" },
            { name: "rpi-ad7124-overlay.dts", path: "/linux/arch/arm/boot/dts/overlays/rpi-ad7124-overlay.dts", fit: "compatible", reason: "family: brcm,bcm2835 → raspberrypi" },
            { name: "generic-adc-overlay.dts", path: "/linux/arch/arm/boot/dts/overlays/generic-adc-overlay.dts", fit: "unknown", reason: "no root compatible" },
            { name: "zynqmp-ad7124.dtso", path: "/linux/arch/arm64/boot/dts/xilinx/zynqmp-ad7124.dtso", fit: "incompatible", reason: "overlay: xlnx,zynqmp; base: raspberrypi,4-model-b, brcm,bcm2711" },
        ]);
    });

    test("format_overlay_rows — names aligned, the fit and why", () => {
        expect(format_overlay_rows(overlay_rows(index, "adi,ad7124-8", PI4))).toEqual([
            "ad7124-8-overlay.dts     compatible (brcm,bcm2711)",
            "rpi-ad7124-overlay.dts   compatible (family: brcm,bcm2835 → raspberrypi)",
            "generic-adc-overlay.dts  unknown (no root compatible)",
            "zynqmp-ad7124.dtso       incompatible (overlay: xlnx,zynqmp; base: raspberrypi,4-model-b, brcm,bcm2711)",
        ]);
    });
}
