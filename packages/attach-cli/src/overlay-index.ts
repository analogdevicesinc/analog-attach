import * as fs from "node:fs";
import path from "node:path";

// The overlays in the Linux tree, indexed by the compatibles of the devices
// they add. A text scan, so no file is preprocessed: compatibles are always
// literal strings. Each file also records its root `compatible`, the boards it
// is meant for, which `list overlay` compares with the base (src/board-fit.ts).
// Built on every call (about 10 ms for the 549 overlays of an RPi tree), so it
// is never stale, whatever file an overlay includes.

/** The overlays of a Linux tree. */
export interface OverlayIndex {
    linux: string;
    /** Keyed by the path relative to the Linux tree. */
    files: Record<string, OverlayEntry>;
}

export interface OverlayEntry {
    /** Compatibles of the nodes the overlay adds or changes. */
    devices: string[];
    /** The overlay's root `compatible`; absent when it has none. */
    board?: string[];
}

/** Scan every overlay of the Linux tree. */
export function overlay_index(linux: string): OverlayIndex {
    const files: Record<string, OverlayEntry> = {};
    for (const file of overlay_files(linux)) {
        files[file] = scan_overlay(read_overlay_source(path.join(linux, file)));
    }
    return { linux, files };
}

/** The overlay sources of a Linux tree: the RPi `*-overlay.dts` files and every `.dtso`, relative to it. */
export function overlay_files(linux: string): string[] {
    const files: string[] = [];
    const rpi = "arch/arm/boot/dts/overlays";
    if (fs.existsSync(path.join(linux, rpi))) {
        files.push(...fs.readdirSync(path.join(linux, rpi)).filter(file => file.endsWith("-overlay.dts")).map(file => `${rpi}/${file}`));
    }
    const arch = path.join(linux, "arch");
    for (const name of fs.existsSync(arch) ? fs.readdirSync(arch) : []) {
        const dts = `arch/${name}/boot/dts`;
        if (!fs.existsSync(path.join(linux, dts))) { continue; }
        const found = fs.readdirSync(path.join(linux, dts), { recursive: true, encoding: "utf8" });
        files.push(...found.filter(file => file.endsWith(".dtso")).map(file => `${dts}/${file}`));
    }
    return files.sort();
}

/** The overlay's text with its quoted `#include "x.dtsi"` files inlined (the `<dt-bindings/…>` headers hold no nodes). */
export function read_overlay_source(file: string, seen = new Set<string>()): string {
    if (seen.has(file) || !fs.existsSync(file)) { return ""; }
    seen.add(file);
    return fs.readFileSync(file, "utf8").replaceAll(
        /^[ \t]*#include\s+"([^"]+)".*$/gm,
        (_line, name: string) => read_overlay_source(path.join(path.dirname(file), name), seen),
    );
}

/** The device and root compatibles of an overlay source. */
export function scan_overlay(text: string): OverlayEntry {
    const source = text.replaceAll(/\/\*[\s\S]*?\*\//g, " ").replaceAll(/\/\/[^\n]*/g, "");
    const devices = new Set<string>();
    const board: string[] = [];
    // One entry per open brace: whether it opens the overlay's own root node (`/ {`).
    const open: boolean[] = [];
    // A compatible property starts a line or follows `{` or `;`, which leaves out `"compatible=…"` in __overrides__.
    for (const match of source.matchAll(/(\{)|(\})|(?<=[{;]\s*|^[ \t]*)compatible\s*=\s*([^;]*);/gm)) {
        if (match[1] !== undefined) {
            open.push(open.length === 0 && source.slice(0, match.index).trimEnd().endsWith("/"));
        } else if (match[2] === undefined) {
            const strings = [...(match[3] ?? "").matchAll(/"([^"]*)"/g)].map(string => string[1] ?? "");
            if (open.length === 1 && open[0] === true) {
                board.push(...strings);
            } else {
                for (const string of strings) { devices.add(string); }
            }
        } else {
            open.pop();
        }
    }
    return { devices: [...devices], ...(board.length === 0 ? {} : { board }) };
}

/** An overlay that adds the device, and the other compatible of its binding it names instead when it isn't `compatible` itself. */
export interface OverlayMatch {
    file: string;
    matched?: string;
}

/**
 * The overlays that add a node with `compatible`, or with one of `siblings`
 * (the binding's other compatibles); exact ones first, then by relative path.
 */
export function overlays_matching(index: OverlayIndex, compatible: string, siblings: readonly string[] = []): OverlayMatch[] {
    const matches: OverlayMatch[] = [];
    for (const [file, entry] of Object.entries(index.files)) {
        if (entry.devices.includes(compatible)) { matches.push({ file }); continue; }
        const matched = siblings.find(sibling => entry.devices.includes(sibling));
        if (matched !== undefined) { matches.push({ file, matched }); }
    }
    return matches.sort((a, b) => Number(a.matched !== undefined) - Number(b.matched !== undefined) || a.file.localeCompare(b.file));
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;
    const os = await import("node:os");

    test("scan_overlay — fragments, a root compatible, comments and __overrides__", () => {
        expect(scan_overlay(`/dts-v1/;
/plugin/;

/ {
\tcompatible = "brcm,bcm2835", "brcm,bcm2711";
\t/* compatible = "commented,out"; */
\tfragment@0 {
\t\ttarget = <&spi0>;
\t\t__overlay__ {
\t\t\tadc@0 {
\t\t\t\tcompatible = "adi,ad7124-8"; // compatible = "x,y";
\t\t\t\treg = <0>;
\t\t\t};
\t\t};
\t};
\t__overrides__ {
\t\tdevice = <&adc>,"compatible=adi,ad7124-4";
\t};
};
`)).toEqual({ devices: ["adi,ad7124-8"], board: ["brcm,bcm2835", "brcm,bcm2711"] });
    });

    test("scan_overlay — label syntax, nested nodes, no root compatible", () => {
        expect(scan_overlay(`/dts-v1/;
/plugin/;

&spi0 {
    adc@0 {
        compatible = "adi,ad7124-8";
        channel@0 { reg = <0>; };
    };
};

&{/} {
    vref: regulator { compatible = "regulator-fixed"; };
};
`)).toEqual({ devices: ["adi,ad7124-8", "regulator-fixed"] });
    });

    test("scan_overlay — a root compatible in a separate root node, and the typo kept as written", () => {
        expect(scan_overlay(`/dts-v1/;
/plugin/;
/ { compatible = "bcrm, bcm2711"; };
&i2c1 { sensor@48 { compatible = "adi,adt7410"; }; };
`)).toEqual({ devices: ["adi,adt7410"], board: ["bcrm, bcm2711"] });
    });

    test("scan_overlay — a root compatible after #include lines", () => {
        expect(scan_overlay(`/dts-v1/;
/plugin/;

/ {
	#include <dt-bindings/gpio/gpio.h>

	compatible = "brcm,bcm2835", "brcm,bcm2711";
	__overrides__ {
		device = <&adc>,
			"compatible=adi,ad7124-4";
	};
};
`)).toEqual({ devices: [], board: ["brcm,bcm2835", "brcm,bcm2711"] });
    });

    test("read_overlay_source — quoted includes are inlined, relative to the including file", () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "attach-overlays-"));
        try {
            fs.writeFileSync(path.join(directory, "touch.dtsi"), '#include "buses.dtsi"\n/ { compatible = "brcm,bcm2835"; };\n');
            fs.writeFileSync(path.join(directory, "buses.dtsi"), "&i2c1 { touch@38 { compatible = \"edt,edt-ft5506\"; }; };\n");
            fs.writeFileSync(path.join(directory, "loop.dtsi"), '#include "loop.dtsi"\n');
            fs.writeFileSync(path.join(directory, "a-overlay.dts"),
                '/dts-v1/;\n#include <dt-bindings/gpio/gpio.h>\n#include "touch.dtsi"\n#include "loop.dtsi"\n#include "missing.dtsi"\n');
            const source = read_overlay_source(path.join(directory, "a-overlay.dts"));
            expect(source).toContain("#include <dt-bindings/gpio/gpio.h>");
            expect(scan_overlay(source)).toEqual({ devices: ["edt,edt-ft5506"], board: ["brcm,bcm2835"] });
        } finally {
            fs.rmSync(directory, { recursive: true });
        }
    });

    test("overlay_files — RPi overlays and .dtso files anywhere under arch/*/boot/dts", () => {
        const linux = fs.mkdtempSync(path.join(os.tmpdir(), "attach-overlays-"));
        try {
            const touch = (file: string): void => {
                fs.mkdirSync(path.dirname(path.join(linux, file)), { recursive: true });
                fs.writeFileSync(path.join(linux, file), "");
            };
            touch("arch/arm/boot/dts/overlays/ad7124-overlay.dts");
            touch("arch/arm/boot/dts/overlays/README");
            touch("arch/arm/boot/dts/broadcom/bcm2711-rpi-4-b.dts");
            touch("arch/arm64/boot/dts/xilinx/zynqmp-ad9081.dtso");
            touch("arch/arm64/boot/dts/ti/k3-am62x-sk-csi2-imx219.dtso");
            expect(overlay_files(linux)).toEqual([
                "arch/arm/boot/dts/overlays/ad7124-overlay.dts",
                "arch/arm64/boot/dts/ti/k3-am62x-sk-csi2-imx219.dtso",
                "arch/arm64/boot/dts/xilinx/zynqmp-ad9081.dtso",
            ]);
            expect(overlay_files(path.join(linux, "nope"))).toEqual([]);
        } finally {
            fs.rmSync(linux, { recursive: true });
        }
    });

    test("overlays_matching — the exact compatible first, then the binding's others, each by path", () => {
        const index: OverlayIndex = {
            linux: "/linux",
            files: {
                "b-overlay.dts": { devices: ["adi,ad7124-8"] },
                "a-overlay.dts": { devices: ["adi,ad7124-4", "adi,ad7124-8"], board: ["brcm,bcm2835"] },
                "c-overlay.dts": { devices: ["adi,ad7124-4"], board: ["adi,ad7124-8"] },
                "d-overlay.dts": { devices: ["adi,adxl345"] },
            },
        };
        expect(overlays_matching(index, "adi,ad7124-8")).toEqual([{ file: "a-overlay.dts" }, { file: "b-overlay.dts" }]);
        expect(overlays_matching(index, "adi,ad7124-8", ["adi,ad7124-4"]))
            .toEqual([{ file: "a-overlay.dts" }, { file: "b-overlay.dts" }, { file: "c-overlay.dts", matched: "adi,ad7124-4" }]);
        expect(overlays_matching(index, "adi,nope", ["adi,none"])).toEqual([]);
    });
}
