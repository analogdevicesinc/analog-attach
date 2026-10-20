import { Command } from "commander";
import * as fs from "node:fs";
import path from "node:path";

import {
    DeviceTreeOverlay,
    get_full_node_name,
    unresolved_references,
    unresolved_targets,
    type DeviceTree,
    type UnresolvedReference,
} from "attach-lib";

import type { LocalContext } from "../../context";
import type { OverlayIndex } from "../../config/cache";
import { config_directory, read_settings } from "../../config/settings";
import { load_workspace, report_config_errors } from "../../config/workspace";
import { board_fit } from "../../board-fit";
import { get_or_build_overlay_index, scan_overlay } from "../../overlay-index";
import { respond, respond_fail } from "../../protocol/output";
import type { ImportResponse, UnresolvedTargetEntry } from "../../protocol/types";
import { node_compatibles, run_preprocess } from "../../utilities";
import { next_workfile_name, workfile_from_overlay } from "../../workfile";
import { missing_names } from "../add/command";

// `import <overlay>` brings a whole overlay of the Linux tree (or any overlay
// file) into a new workfile: every fragment as written, minus the RPi
// `__overrides__` parameters. Targets and phandles are not remapped, so the
// ones that name nothing in the base come back as warnings.

export function build_import_command(context: LocalContext): Command {
    return new Command("import")
        .description("Create a workfile from an overlay of the Linux tree")
        .argument("<overlay>", "Overlay file name (from list overlay), or a path to an overlay")
        .addHelpText("after", `
Every fragment is imported as written; the __overrides__ node (the RPi
overlay parameters) is dropped. Targets and phandles are not remapped: the
ones the base doesn't have are listed as warnings. The new workfile is named
after the overlay and becomes the configured overlay. import refuses when an
overlay is already configured.

Examples:
  $ attach-linux list overlay adi,ad7124-8
  $ attach-linux import rpi-ad7124-8-all-diff-overlay.dts
  $ attach-linux import ./my-board-overlay.dts`)
        .action(async (name: string) => {
            await run_import(context, name);
        });
}

async function run_import(context: LocalContext, name: string): Promise<void> {
    const fail = (message: string): void => {
        if (context.json) { respond_fail({ ok: false, message, severity: "error" }); } else { console.log(message); }
    };

    const settings = read_settings();
    if (!settings.ok) {
        report_config_errors(context, settings.errors);
        return;
    }
    if (settings.value.overlay !== undefined) {
        fail(`An overlay is already configured (${settings.value.overlay}); import only creates a new one.`);
        return;
    }

    const workspace = load_workspace(context, ["bindings", "base"]);
    if (workspace === undefined) { return; }
    const { linux } = workspace.bindings;

    const given = path.resolve(name);
    const found = fs.statSync(given, { throwIfNoEntry: false })?.isFile() === true
        ? { kind: "found" as const, file: given }
        : find_overlay(get_or_build_overlay_index(linux), name);
    if (found.kind === "none") {
        fail(`No overlay named ${name} in ${linux} (list overlay <compatible> finds them), and no such file`);
        return;
    }
    if (found.kind === "ambiguous") {
        fail(`Several overlays are named ${name}; pass one of: ${found.files.join(", ")}`);
        return;
    }
    const source = path.resolve(linux, found.file);

    const preprocessed = path.join(config_directory(), "import.preprocessed.dts");
    fs.mkdirSync(config_directory(), { recursive: true });
    const error = run_preprocess(workspace.settings.preprocess_command, { input: source, output: preprocessed, linux });
    if (error !== undefined) {
        fail(`preprocessing ${source} failed:\n${error}`);
        return;
    }
    const text = fs.readFileSync(preprocessed, "utf8");
    const imported = import_overlay(text, workspace.base.tree);
    if (typeof imported === "string") {
        fail(`${source} does not parse after preprocessing: ${imported}`);
        return;
    }

    const workfile = workfile_from_overlay(next_workfile_name(overlay_stem(source)), imported.tree, workspace.settings.overlay_syntax);
    workfile.save();

    const root = workspace.base.tree.node_at("/");
    const fit = board_fit(scan_overlay(text).board, root === undefined ? [] : node_compatibles(root));
    const warnings = import_warnings(imported.tree);
    const shown = path.relative(linux, source).startsWith("..") ? source : path.relative(linux, source);
    const message = `Imported ${shown} into ${workfile.path}`;

    if (context.json) {
        const warned = fit.fit === "incompatible" || warnings.targets.length > 0 || warnings.references.length > 0;
        respond({
            ok: true,
            message,
            severity: warned ? "warn" : "info",
            path: workfile.path,
            source,
            ...fit,
            unresolved_targets: warnings.targets,
            unresolved: warnings.references.map(u => ({ path: u.path.split("/").filter(Boolean), property: u.property, reference: u.reference })),
        } satisfies ImportResponse);
        return;
    }
    console.log(message);
    if (imported.dropped_overrides) { console.log("Dropped __overrides__ (the overlay's parameters)"); }
    if (fit.fit === "incompatible") { console.log(`warning: the overlay is for another board (${fit.reason})`); }
    for (const line of import_warning_lines(warnings, imported.tree.all_labels())) { console.log(line); }
}

/** The name a workfile takes after the overlay: `ad7124-overlay.dts` → `ad7124`, `zynqmp-ad9081.dtso` → `zynqmp-ad9081`. */
export function overlay_stem(file: string): string {
    return path.basename(file).replace(/(-overlay\.dts|\.dtso|\.dts)$/, "");
}

export type FoundOverlay = { kind: "found"; file: string } | { kind: "none" } | { kind: "ambiguous"; files: string[] };

/** The indexed overlay `name` stands for: its path in the tree, its file name or its stem. */
export function find_overlay(index: OverlayIndex, name: string): FoundOverlay {
    const files = Object.keys(index.files).sort()
        .filter(file => file === name || path.basename(file) === name || overlay_stem(file) === name);
    const [file] = files;
    if (file === undefined) { return { kind: "none" }; }
    return files.length === 1 ? { kind: "found", file } : { kind: "ambiguous", files };
}

export interface ImportedOverlay {
    tree: DeviceTreeOverlay;
    dropped_overrides: boolean;
}

/** Parse a preprocessed overlay against the base and drop its `__overrides__`; the parse error otherwise. */
export function import_overlay(text: string, base: DeviceTree): ImportedOverlay | string {
    const tree = DeviceTreeOverlay.new_from_string(text, base);
    if (typeof tree === "string") { return tree; }
    return { tree, dropped_overrides: tree.remove_root_node("__overrides__") };
}

export interface ImportWarnings {
    targets: UnresolvedTargetEntry[];
    references: UnresolvedReference[];
}

export function import_warnings(tree: DeviceTreeOverlay): ImportWarnings {
    const fragments = tree.get_fragments();
    const targets = unresolved_targets(tree).map(({ fragment, target }) => {
        const node = fragments[fragment];
        const by_path = node?.properties.some(p => p.name === "target") !== true;
        return {
            fragment: node === undefined ? `fragment ${fragment}` : get_full_node_name(node),
            property: by_path ? "target-path" as const : "target" as const,
            target: target.replace(/^&/, ""),
        };
    });
    return { targets, references: unresolved_references(tree) };
}

/** `path` from its deepest labelled node (`spi0/adc@0`); a target that didn't resolve as written, without `&`. */
export function display_path(at: string, labels: Map<string, string>): string {
    if (!at.startsWith("/")) { return at.replace(/^&/, ""); }
    const label_of = new Map<string, string>();
    for (const [label, node] of labels) { if (!label_of.has(node)) { label_of.set(node, label); } }
    const parts = at.split("/").filter(Boolean);
    for (let n = parts.length; n > 0; n--) {
        const label = label_of.get(`/${parts.slice(0, n).join("/")}`);
        if (label !== undefined) { return [label, ...parts.slice(n)].join("/"); }
    }
    return at;
}

/** One warning per unresolved target, and per node and property for the references. */
export function import_warning_lines(warnings: ImportWarnings, labels: Map<string, string>): string[] {
    const groups = new Map<string, { labels: string[]; paths: string[] }>();
    for (const { path: at, property, reference } of warnings.references) {
        const where = `${display_path(at, labels)}: ${property}`;
        const group = groups.get(where) ?? { labels: [], paths: [] };
        if (reference.startsWith("&{")) { group.paths.push(reference.slice(2, -1)); } else { group.labels.push(reference.slice(1)); }
        groups.set(where, group);
    }
    return [
        ...warnings.targets.map(({ fragment, property, target }) => `warning: ${fragment}: ${property} "${target}" not found in the base`),
        ...[...groups].map(([where, { labels: names, paths }]) =>
            `warning: ${where}: ${[...missing_names("label", names), ...missing_names("node", paths)].join(", ")}`),
    ];
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;
    const { DeviceTree: DT } = await import("attach-lib");

    const BASE = `/dts-v1/;
/ {
    compatible = "raspberrypi,4-model-b", "brcm,bcm2711";
    #address-cells = <1>;
    #size-cells = <1>;
    soc {
        #address-cells = <1>;
        #size-cells = <1>;
        gpio: gpio@7e200000 { reg = <0x7e200000 0xb4>; };
        spi0: spi@7e204000 {
            reg = <0x7e204000 0x200>;
            #address-cells = <1>;
            #size-cells = <0>;
        };
    };
};`;
    const base = (): DeviceTree => {
        const tree = DT.new_from_string(BASE);
        if (typeof tree === "string") { throw new TypeError(tree); }
        return tree;
    };

    const OVERLAY = `/dts-v1/;
/plugin/;
/ {
    compatible = "brcm,bcm2835";
    fragment@0 {
        target = <&spi0>;
        __overlay__ {
            status = "okay";
            ad7124: adc@0 {
                compatible = "adi,ad7124-8";
                reg = <0>;
                interrupt-parent = <&gpio>;
                refin1-supply = <&vref>;
                clocks = <&adc_clk>;
                channel@0 { reg = <0>; diff-channels = <0 1>; io-supply = <&vio>; };
            };
        };
    };
    fragment@1 {
        target = <&spi7>;
        __overlay__ { status = "okay"; };
    };
    fragment@2 {
        target-path = "/soc/nope";
        __overlay__ { status = "okay"; };
    };
    __overrides__ {
        cs = <&ad7124>, "reg:0";
    };
};
`;

    const imported = (text = OVERLAY): ImportedOverlay => {
        const result = import_overlay(text, base());
        if (typeof result === "string") { throw new TypeError(result); }
        return result;
    };

    test("overlay_stem — the RPi -overlay.dts suffix, .dtso and .dts", () => {
        expect(overlay_stem("arch/arm/boot/dts/overlays/rpi-ad7124-overlay.dts")).toBe("rpi-ad7124");
        expect(overlay_stem("arch/arm64/boot/dts/xilinx/zynqmp-ad9081.dtso")).toBe("zynqmp-ad9081");
        expect(overlay_stem("/home/me/board.dts")).toBe("board");
    });

    test("find_overlay — by path in the tree, file name or stem; several matches are ambiguous", () => {
        const index: OverlayIndex = {
            generated_at: 0,
            linux: "/linux",
            files: {
                "arch/arm/boot/dts/overlays/ad7124-overlay.dts": { devices: [] },
                "arch/arm/boot/dts/overlays/max31827-overlay.dts": { devices: [] },
                "arch/arm64/boot/dts/xilinx/max31827.dtso": { devices: [] },
            },
        };
        expect(find_overlay(index, "ad7124-overlay.dts")).toEqual({ kind: "found", file: "arch/arm/boot/dts/overlays/ad7124-overlay.dts" });
        expect(find_overlay(index, "ad7124")).toEqual({ kind: "found", file: "arch/arm/boot/dts/overlays/ad7124-overlay.dts" });
        expect(find_overlay(index, "arch/arm64/boot/dts/xilinx/max31827.dtso"))
            .toEqual({ kind: "found", file: "arch/arm64/boot/dts/xilinx/max31827.dtso" });
        expect(find_overlay(index, "max31827")).toEqual({
            kind: "ambiguous",
            files: ["arch/arm/boot/dts/overlays/max31827-overlay.dts", "arch/arm64/boot/dts/xilinx/max31827.dtso"],
        });
        expect(find_overlay(index, "nope")).toEqual({ kind: "none" });
    });

    test("import_overlay — keeps the fragments and the root compatible, drops __overrides__", () => {
        const { tree, dropped_overrides } = imported();
        expect(dropped_overrides).toBe(true);
        const printed = tree.print();
        expect(printed).not.toContain("__overrides__");
        expect(printed).toContain('compatible = "brcm,bcm2835";');
        expect(tree.get_fragments().map(f => get_full_node_name(f))).toEqual(["fragment@0", "fragment@1", "fragment@2"]);
        expect(imported("/dts-v1/;\n/plugin/;\n&spi0 { status = \"okay\"; };\n").dropped_overrides).toBe(false);
    });

    test("import_overlay — a parse error comes back as text", () => {
        expect(typeof import_overlay("/dts-v1/;\n/plugin/;\n&spi0 { status = \"okay\" };\n", base())).toBe("string");
    });

    test("import_warnings — targets the base lacks, by fragment, and the unresolved references", () => {
        const warnings = import_warnings(imported().tree);
        expect(warnings.targets).toEqual([
            { fragment: "fragment@1", property: "target", target: "spi7" },
            { fragment: "fragment@2", property: "target-path", target: "/soc/nope" },
        ]);
        expect(warnings.references.map(u => `${u.path} ${u.property} ${u.reference}`)).toEqual([
            "/soc/spi@7e204000/adc@0 refin1-supply &vref",
            "/soc/spi@7e204000/adc@0 clocks &adc_clk",
            "/soc/spi@7e204000/adc@0/channel@0 io-supply &vio",
        ]);
    });

    test("display_path — from the deepest labelled node; an unresolved target as written", () => {
        const labels = new Map([["spi0", "/soc/spi@7e204000"], ["ad7124", "/soc/spi@7e204000/adc@0"]]);
        expect(display_path("/soc/spi@7e204000/adc@0/channel@0", labels)).toBe("ad7124/channel@0");
        expect(display_path("/soc/spi@7e204000/spidev@0", labels)).toBe("spi0/spidev@0");
        expect(display_path("/soc", labels)).toBe("/soc");
        expect(display_path("&spi7/adc@0", labels)).toBe("spi7/adc@0");
    });

    test("import_warning_lines — targets, then one line per node and property", () => {
        const { tree } = imported();
        expect(import_warning_lines(import_warnings(tree), tree.all_labels())).toEqual([
            'warning: fragment@1: target "spi7" not found in the base',
            'warning: fragment@2: target-path "/soc/nope" not found in the base',
            'warning: ad7124: refin1-supply: no label "vref"',
            'warning: ad7124: clocks: no label "adc_clk"',
            'warning: ad7124/channel@0: io-supply: no label "vio"',
        ]);
        expect(import_warning_lines({
            targets: [],
            references: [
                { path: "&spi7/adc@0", property: "clocks", reference: "&a" },
                { path: "&spi7/adc@0", property: "clocks", reference: "&b" },
                { path: "&spi7/adc@0", property: "io-channels", reference: "&{/soc/x}" },
            ],
        }, new Map())).toEqual([
            'warning: spi7/adc@0: clocks: no labels "a", "b"',
            'warning: spi7/adc@0: io-channels: no node "/soc/x"',
        ]);
        // A label named twice in one property (two GPIOs of the same controller) is listed once.
        expect(import_warning_lines({
            targets: [],
            references: [
                { path: "&spi7/adc@0", property: "gpios", reference: "&rp1_gpio" },
                { path: "&spi7/adc@0", property: "gpios", reference: "&rp1_gpio" },
            ],
        }, new Map())).toEqual(['warning: spi7/adc@0: gpios: no label "rp1_gpio"']);
        expect(import_warning_lines({ targets: [], references: [] }, new Map())).toEqual([]);
    });
}
