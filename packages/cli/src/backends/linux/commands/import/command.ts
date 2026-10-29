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

import { answer, command, refuse, type ImportArguments } from "../../../../interface/backend-interface";
import { load_workspace } from "../../config/workspace";
import { board_fit } from "../../board-fit";
import { overlay_index, scan_overlay, type OverlayIndex } from "../../overlay-index";
import type { ImportResponse, UnresolvedTargetEntry } from "../../protocol/types";
import { node_compatibles, run_preprocess } from "../../utilities";
import { next_workfile_name, workfile_from_overlay } from "../../workfile";
import { board_lines, reference_lines, target_lines, unique_references } from "../../unresolved";

// `import <overlay>` brings a whole overlay of the Linux tree (or any overlay
// file) into a new workfile: every fragment as written, minus the RPi
// `__overrides__` parameters. Targets and phandles are not remapped, so the
// ones that name nothing in the base come back as warnings.

export const import_command = command<ImportArguments, ImportResponse>({
    docs: {
        brief: "Create a workfile from an overlay of the Linux tree",
        full: `Every fragment is imported as written; the __overrides__ node (the RPi
overlay parameters) is dropped. Targets and phandles are not remapped: the
ones the base doesn't have are listed as warnings. The new workfile is named
after the overlay and becomes the configured workfile; one configured before
is kept as it is (config workfile <file> switches back).`,
        examples: [
            "import rpi-ad7124-8-all-diff-overlay.dts   An overlay of the Linux tree",
            "import ./my-board-overlay.dts              Any overlay file",
        ],
    },
    async run({ source: name }, _flags, session) {
        const loaded = load_workspace(session, ["bindings", "base"]);
        if (!loaded.ok) { return loaded.outcome; }
        const { workspace } = loaded;
        const { linux } = workspace.bindings;
        const previous = session.settings.get("workfile");

        const found = locate_overlay(linux, name, session.cwd);
        if (found.kind !== "found") { return refuse(lookup_failure(found, name, linux)); }
        const source = found.file;

        const preprocessed = preprocess_overlay(source, workspace.settings.preprocess_command, linux, path.join(session.state_dir, "import.preprocessed.dts"));
        if (!preprocessed.ok) { return refuse(preprocessed.error); }
        const { text } = preprocessed;
        const imported = import_overlay(text, workspace.base.tree);
        if (typeof imported === "string") { return refuse(`${source} does not parse after preprocessing: ${imported}`); }

        const workfile = workfile_from_overlay(next_workfile_name(overlay_stem(source), session.cwd), imported.tree, workspace.settings.overlay_syntax, session.cwd);
        workfile.save();
        const written = await session.settings.set("workfile", workfile.path);
        if (!written.ok) { return refuse(`Imported ${source} into ${workfile.path}, but it is not the configured workfile: ${written.message}`); }

        const root = workspace.base.tree.node_at("/");
        const board = scan_overlay(text).board ?? [];
        const base_board = root === undefined ? [] : node_compatibles(root);
        const fit = board_fit(board, base_board);
        const warnings = import_warnings(imported.tree);
        const shown = path.relative(linux, source).startsWith("..") ? source : path.relative(linux, source);
        const [message = "", ...switched] = import_message(shown, workfile.path, previous);

        // The fit and the unresolved targets and references are warnings, on stderr in every mode (and in the JSON).
        const warning_lines = [
            ...(fit.fit === "incompatible" ? board_lines(board, base_board) : []),
            ...import_warning_lines(warnings, imported.tree.all_labels()),
        ];
        for (const line of warning_lines) { session.warn(line); }

        return answer<ImportResponse>(
            {
                ok: true,
                message,
                severity: warning_lines.length > 0 ? "warn" : "info",
                path: workfile.path,
                source,
                ...(previous === undefined ? {} : { replaced: previous }),
                ...fit,
                unresolved_targets: warnings.targets,
                unresolved: warnings.references.map(u => ({ path: u.path.split("/").filter(Boolean), property: u.property, reference: u.reference })),
            },
            [message, ...switched, ...(imported.dropped_overrides ? ["Dropped __overrides__ (the overlay's parameters)"] : [])].join("\n"),
        );
    },
});

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

/**
 * The overlay `name` stands for: a file path (relative to `cwd`; absolute result), else a name
 * from the Linux tree's overlay index (`find_overlay`, absolute result).
 */
export function locate_overlay(linux: string, name: string, cwd: string): { kind: "found"; file: string } | { kind: "none" } | { kind: "ambiguous"; files: string[] } {
    const given = path.resolve(cwd, name);
    if (fs.statSync(given, { throwIfNoEntry: false })?.isFile() === true) { return { kind: "found", file: given }; }
    const found = find_overlay(overlay_index(linux), name);
    return found.kind === "found" ? { kind: "found", file: path.resolve(linux, found.file) } : found;
}

/** Why `locate_overlay` found nothing usable. */
export function lookup_failure(found: { kind: "none" } | { kind: "ambiguous"; files: string[] }, name: string, linux: string): string {
    return found.kind === "none"
        ? `No overlay named ${name} in ${linux} (list overlay <compatible> finds them), and no such file`
        : `Several overlays are named ${name}; pass one of: ${found.files.join(", ")}`;
}

/** The overlay run through `preprocess-command` into `output` (a file of the state directory), or the error to show. */
export function preprocess_overlay(source: string, command: string, linux: string, output: string): { ok: true; text: string } | { ok: false; error: string } {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    const error = run_preprocess(command, { input: source, output, linux });
    if (error !== undefined) { return { ok: false, error: `preprocessing ${source} failed:\n${error}` }; }
    return { ok: true, text: fs.readFileSync(output, "utf8") };
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
    return { targets, references: unique_references(unresolved_references(tree)) };
}

/** What import did: the new workfile, and the configured workfile it replaces, when there was one. */
export function import_message(shown: string, workfile: string, previous?: string): string[] {
    const imported = `Imported ${shown} into ${workfile}`;
    if (previous === undefined) { return [imported]; }
    return [imported, `The configured workfile is now ${workfile} (was ${previous}, kept; switch back with: config workfile ${previous})`];
}

/** The targets the base lacks, then the references that resolve to nothing. */
export function import_warning_lines(warnings: ImportWarnings, labels: Map<string, string>): string[] {
    return [...target_lines(warnings.targets), ...reference_lines("warning", warnings.references, labels)];
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

    test("import_message — the import, and the overlay it replaces as the configured one", () => {
        expect(import_message("arch/arm/boot/dts/overlays/rpi-ad7124-overlay.dts", "/w/rpi-ad7124.dtso"))
            .toEqual(["Imported arch/arm/boot/dts/overlays/rpi-ad7124-overlay.dts into /w/rpi-ad7124.dtso"]);
        expect(import_message("arch/arm/boot/dts/overlays/max31827-overlay.dts", "/w/max31827.dtso", "/w/rpi-ad7124.dtso")).toEqual([
            "Imported arch/arm/boot/dts/overlays/max31827-overlay.dts into /w/max31827.dtso",
            "The configured workfile is now /w/max31827.dtso (was /w/rpi-ad7124.dtso, kept; switch back with: config workfile /w/rpi-ad7124.dtso)",
        ]);
    });

    test("import_warning_lines — the targets the base lacks, then the references", () => {
        const { tree } = imported();
        expect(import_warning_lines(import_warnings(tree), tree.all_labels())).toEqual([
            "warning: 2 fragments target nodes the base doesn't have:",
            "  fragment@1  target spi7",
            "  fragment@2  target-path /soc/nope",
            "warning: 3 references point to nodes neither the base nor the overlay has:",
            "  ad7124            refin1-supply → &vref",
            "  ad7124            clocks → &adc_clk",
            "  ad7124/channel@0  io-supply → &vio",
            "  fix with: update <node> <property> <value>, or delete <node> <property>",
        ]);
        expect(import_warning_lines({ targets: [], references: [] }, new Map())).toEqual([]);
    });
}
