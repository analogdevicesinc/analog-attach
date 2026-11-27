import { answer, type ExtraCommand, type Outcome, type Session } from "../../../../interface/backend-interface";
import { load_workspace } from "../../config/workspace";
import { overlay_index, overlay_rows, type OverlayIndex } from "../../overlay-index";
import type { ListOverlayResponse, OverlayDescription } from "../../protocol/types";
import { binding_siblings, node_compatibles, positional_word } from "../../utilities";

/** `list overlay <compatible>`: the overlays of the Linux tree with the device, and whether they fit the board. */
export const list_overlay: ExtraCommand<Record<never, never>, ListOverlayResponse> = {
	docs: {
		brief: "List the overlays in the Linux tree with a device, and whether they fit the board",
		full: `The overlays that add the device (or another compatible of its binding: "via
..."), compatible ones first, by whether their root compatible fits the base
devicetree's. Without a compatible, every overlay, with the compatibles it adds.
Each name is ready for 'import <name>' or 'add <compatible> --template overlay:<name>'.`,
		placeholders: { compatible: "compatible" },
		examples: ["list overlay adi,ad7124-8", "list overlay"],
	},
	positionals: [
		{ name: "compatible", placeholder: "compatible", brief: "The device's compatible string", optional: true, slot: prior => ({ kind: "extra", command: "list overlay", id: "compatible", prior }) },
	],
	group: "tooling",
	schema: "list-overlay.schema.json",
	async run(arguments_, _flags, session) {
		const compatible = positional_word(arguments_, "compatible");
		if (compatible === undefined) { return every_overlay(session); }
		const loaded = load_workspace(session, ["bindings", "base"]);
		if (!loaded.ok) { return loaded.outcome; }
		const { workspace } = loaded;
		const { linux } = workspace.bindings;
		const root = workspace.base.tree.node_at("/");
		const rows = overlay_rows(overlay_index(linux), compatible, root === undefined ? [] : node_compatibles(root), await binding_siblings(workspace.bindings, compatible));
		const response: ListOverlayResponse = { ok: true, message: `${rows.length} overlays with ${compatible}`, severity: "info", overlays: rows };
		return answer(response, () => (rows.length === 0 ? `No overlay in ${linux} has ${compatible}` : format_overlay_rows(rows).join("\n")));
	},
};

/** `list overlay` without a compatible: every overlay of the Linux tree, with what it adds; no bindings needed. */
function every_overlay(session: Session): Outcome<ListOverlayResponse> {
	const loaded = load_workspace(session, ["linux", "base"]);
	if (!loaded.ok) { return loaded.outcome; }
	const { linux, base } = loaded.workspace;
	const root = base.tree.node_at("/");
	const rows = overlay_rows(overlay_index(linux), undefined, root === undefined ? [] : node_compatibles(root));
	const response: ListOverlayResponse = { ok: true, message: `${rows.length} overlays`, severity: "info", overlays: rows };
	return answer(response, () => (rows.length === 0 ? `No overlay in ${linux}` : format_overlay_rows(rows, { devices: true }).join("\n")));
}

/** One line per overlay: its name, its fit and why, and the sibling it adds, or with `devices` what it adds. */
export function format_overlay_rows(rows: OverlayDescription[], options: { devices?: boolean } = {}): string[] {
	const width = Math.max(...rows.map(row => row.name.length));
	return rows.map(row => {
		const tail = options.devices === true
			? (row.devices.length === 0 ? "" : `  adds ${row.devices.join(", ")}`)
			: (row.matched === undefined ? "" : `  via ${row.matched}`);
		return `${row.name.padEnd(width)}  ${row.fit} (${row.reason})${tail}`;
	});
}

if (import.meta.vitest) {
	const { test, expect } = import.meta.vitest;

	const index: OverlayIndex = {
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
			{ name: "ad7124-8-overlay.dts", path: "/linux/arch/arm/boot/dts/overlays/ad7124-8-overlay.dts", devices: ["adi,ad7124-8"], fit: "compatible", reason: "brcm,bcm2711" },
			{ name: "rpi-ad7124-overlay.dts", path: "/linux/arch/arm/boot/dts/overlays/rpi-ad7124-overlay.dts", devices: ["adi,ad7124-8"], fit: "compatible", reason: "family: brcm,bcm2835 → raspberrypi" },
			{ name: "generic-adc-overlay.dts", path: "/linux/arch/arm/boot/dts/overlays/generic-adc-overlay.dts", devices: ["adi,ad7124-8"], fit: "unknown", reason: "no root compatible" },
			{ name: "zynqmp-ad7124.dtso", path: "/linux/arch/arm64/boot/dts/xilinx/zynqmp-ad7124.dtso", devices: ["adi,ad7124-8"], fit: "incompatible", reason: "overlay: xlnx,zynqmp; base: raspberrypi,4-model-b, brcm,bcm2711" },
		]);
	});

	test("overlay_rows — overlays with another compatible of the binding come after the exact ones of their fit, marked", () => {
		const wide: OverlayIndex = {
			linux: "/linux",
			files: {
				"arch/arm/boot/dts/overlays/a-overlay.dts": { devices: ["adi,ad7124-4"], board: ["brcm,bcm2711"] },
				"arch/arm/boot/dts/overlays/b-overlay.dts": { devices: ["adi,ad7124-8"], board: ["brcm,bcm2711"] },
				"arch/arm64/boot/dts/xilinx/c.dtso": { devices: ["adi,ad7124-8"], board: ["xlnx,zynqmp"] },
				"arch/arm/boot/dts/overlays/d-overlay.dts": { devices: ["adi,ad7124-4", "adi,ad7124-8"], board: ["brcm,bcm2711"] },
			},
		};
		const rows = overlay_rows(wide, "adi,ad7124-8", PI4, ["adi,ad7124-4"]);
		expect(rows.map(row => [row.name, row.fit, row.matched])).toEqual([
			["b-overlay.dts", "compatible", undefined],
			["d-overlay.dts", "compatible", undefined],
			["a-overlay.dts", "compatible", "adi,ad7124-4"],
			["c.dtso", "incompatible", undefined],
		]);
		expect(rows[0]).not.toHaveProperty("matched");
		expect(format_overlay_rows(rows)[2]).toBe("a-overlay.dts  compatible (brcm,bcm2711)  via adi,ad7124-4");
		// Without siblings only the exact compatible is listed.
		expect(overlay_rows(wide, "adi,ad7124-8", PI4).map(row => row.name)).toEqual(["b-overlay.dts", "d-overlay.dts", "c.dtso"]);
	});

	test("overlay_rows — without a compatible, every overlay, with what it adds", () => {
		const rows = overlay_rows(index, undefined, PI4);
		expect(rows.map(row => [row.name, row.fit, row.devices])).toEqual([
			["ad7124-8-overlay.dts", "compatible", ["adi,ad7124-8"]],
			["other-overlay.dts", "compatible", ["adi,ad7173-8"]],
			["rpi-ad7124-overlay.dts", "compatible", ["adi,ad7124-8"]],
			["generic-adc-overlay.dts", "unknown", ["adi,ad7124-8"]],
			["zynqmp-ad7124.dtso", "incompatible", ["adi,ad7124-8"]],
		]);
		expect(rows.some(row => "matched" in row)).toBe(false);
	});

	test("format_overlay_rows — with devices, what each adds after its fit", () => {
		const rows = overlay_rows({ linux: "/linux", files: { ...index.files, "arch/arm/boot/dts/overlays/disable-bt-overlay.dts": { devices: [] } } }, undefined, PI4);
		expect(format_overlay_rows(rows.slice(2), { devices: true })).toEqual([
			"rpi-ad7124-overlay.dts   compatible (family: brcm,bcm2835 → raspberrypi)  adds adi,ad7124-8",
			"disable-bt-overlay.dts   unknown (no root compatible)",
			"generic-adc-overlay.dts  unknown (no root compatible)  adds adi,ad7124-8",
			"zynqmp-ad7124.dtso       incompatible (overlay: xlnx,zynqmp; base: raspberrypi,4-model-b, brcm,bcm2711)  adds adi,ad7124-8",
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
