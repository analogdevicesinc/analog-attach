import * as fs from "node:fs";
import path from "node:path";

import { load_overlay_index, save_overlay_index, type OverlayEntry, type OverlayIndex, type StaleReason } from "./config/cache";
import { format_duration, rebuild_message, start_progress } from "./progress";
import { can_build_index, index_action } from "./utilities";

// The overlays in the Linux tree, indexed by the compatibles of the devices
// they add. A text scan, so no file is preprocessed: compatibles are always
// literal strings. Each file also records its root `compatible`, the boards it
// is meant for, which `list overlay` compares with the base (src/board-fit.ts).
// Cached in .attach-linux/overlay-index.json and rebuilt when an overlay file
// is added, removed or newer than the index.

/**
 * Load the overlay index, building it when missing or stale. Shell completion
 * never builds it: no index gives an empty one, a stale one is used as is.
 */
export function get_or_build_overlay_index(linux: string): OverlayIndex {
    const loaded = load_overlay_index();
    const allowed = can_build_index();
    const files = allowed ? overlay_files(linux) : [];
    const reason = allowed ? overlay_index_stale_reason(loaded, linux, files) : undefined;
    switch (index_action(loaded, reason, allowed)) {
        case "use": { return loaded!; }
        case "empty": { return { generated_at: 0, linux, files: {} }; }
        case "build": { break; }
    }

    const started = Date.now();
    const progress = start_progress(rebuild_message("overlays", reason ?? { kind: "missing" }));
    const entries: Record<string, OverlayEntry> = {};
    for (const [done, file] of files.entries()) {
        entries[file] = scan_overlay(read_overlay_source(path.join(linux, file)));
        progress.update(done + 1, files.length);
    }
    const index: OverlayIndex = { generated_at: Date.now(), linux, files: entries };
    save_overlay_index(index);
    progress.done(`Indexed ${files.length} overlays in ${format_duration(Date.now() - started)}`);
    return index;
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

/** Why the overlay index has to be (re)built for this tree and its overlay files, if it does. */
export function overlay_index_stale_reason(index: OverlayIndex | undefined, linux: string, files: string[]): StaleReason | undefined {
    if (index?.files === undefined || typeof index.generated_at !== "number") { return { kind: "missing" }; }
    if (path.resolve(index.linux) !== path.resolve(linux)) { return { kind: "linux-changed", from: index.linux, to: linux }; }
    const indexed = index.files;
    if (Object.keys(indexed).length !== files.length || files.some(file => indexed[file] === undefined)) { return { kind: "stale" }; }
    const newer = files.some(file => fs.statSync(path.join(linux, file)).mtimeMs > index.generated_at);
    return newer ? { kind: "stale" } : undefined;
}

/** The overlays that add a node with `compatible`, by relative path. */
export function overlays_with(index: OverlayIndex, compatible: string): string[] {
    return Object.entries(index.files)
        .filter(([, entry]) => entry.devices.includes(compatible))
        .map(([file]) => file)
        .sort();
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

    test("overlay_index_stale_reason — missing, another tree, files added or newer, current", () => {
        const linux = fs.mkdtempSync(path.join(os.tmpdir(), "attach-overlays-"));
        try {
            const file = "arch/arm/boot/dts/overlays/a-overlay.dts";
            fs.mkdirSync(path.join(linux, path.dirname(file)), { recursive: true });
            fs.writeFileSync(path.join(linux, file), "");
            const future = Date.now() + 60_000;
            const index = (generated_at: number, files: string[]): OverlayIndex =>
                ({ generated_at, linux, files: Object.fromEntries(files.map(f => [f, { devices: [] }])) });
            expect(overlay_index_stale_reason(undefined, linux, [file])).toEqual({ kind: "missing" });
            expect(overlay_index_stale_reason({ ...index(future, [file]), linux: "/elsewhere" }, linux, [file]))
                .toEqual({ kind: "linux-changed", from: "/elsewhere", to: linux });
            expect(overlay_index_stale_reason(index(future, []), linux, [file])).toEqual({ kind: "stale" });
            expect(overlay_index_stale_reason(index(0, [file]), linux, [file])).toEqual({ kind: "stale" });
            expect(overlay_index_stale_reason(index(future, [file]), linux, [file])).toBeUndefined();
        } finally {
            fs.rmSync(linux, { recursive: true });
        }
    });

    test("overlays_with — the files adding the compatible, sorted", () => {
        const index: OverlayIndex = {
            generated_at: 0,
            linux: "/linux",
            files: {
                "b-overlay.dts": { devices: ["adi,ad7124-8"] },
                "a-overlay.dts": { devices: ["adi,ad7124-4", "adi,ad7124-8"], board: ["brcm,bcm2835"] },
                "c-overlay.dts": { devices: ["adi,ad7124-4"], board: ["adi,ad7124-8"] },
            },
        };
        expect(overlays_with(index, "adi,ad7124-8")).toEqual(["a-overlay.dts", "b-overlay.dts"]);
        expect(overlays_with(index, "adi,nope")).toEqual([]);
    });
}
