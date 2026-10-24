import * as fs from "node:fs";
import path from "node:path";

import { DeviceTreeOverlay, type DeviceTree } from "attach-lib";

import { save_settings, type OverlaySyntax } from "./config/settings";
import { open_workfile, type Workfile } from "./config/workspace";

const EMPTY_DTSO = String.raw`/dts-v1/;
/plugin/;

/ {
};
`;

export { EMPTY_DTSO };

/** Pick the next available overlay filename: <stem>.dtso, <stem>-1.dtso, <stem>-2.dtso, … */
export function next_workfile_name(stem = "overlay", cwd?: string): string {
    const directory = cwd ?? process.cwd();
    if (!fs.existsSync(path.join(directory, `${stem}.dtso`))) { return `${stem}.dtso`; }
    let n = 1;
    while (fs.existsSync(path.join(directory, `${stem}-${n}.dtso`))) { n++; }
    return `${stem}-${n}.dtso`;
}

/** What `init` does about the overlay: keep the configured file, or create a new one. */
export type OverlayChoice = { kind: "keep"; path: string } | { kind: "create"; filename: string };

/** A workfile name as the user typed it: `.dtso` is added when missing. */
export function workfile_filename(name: string): string {
    return name.endsWith(".dtso") ? name : `${name}.dtso`;
}

/** Why a new workfile cannot be created at `filename` (an existing file is never overwritten), or undefined. */
export function workfile_problem(filename: string, cwd?: string): string | undefined {
    const resolved = path.resolve(cwd ?? process.cwd(), filename);
    if (fs.existsSync(resolved)) {
        return `${filename} already exists; use it with 'config-set overlay ${filename}' or pick another name`;
    }
    if (!fs.statSync(path.dirname(resolved), { throwIfNoEntry: false })?.isDirectory()) {
        return `${path.dirname(resolved)} is not a directory`;
    }
    return undefined;
}

export interface CreateWorkfileResult {
    path: string;
    message: string;
}

/**
 * Create an empty workfile and save the overlay path to config.
 * Used by `init`.
 */
export function create_workfile(filename = "overlay.dtso", cwd?: string): CreateWorkfileResult {
    const output_path = path.resolve(cwd ?? process.cwd(), filename);
    fs.writeFileSync(output_path, EMPTY_DTSO);
    save_settings({ overlay: output_path }, cwd);
    return { path: output_path, message: `Wrote ${output_path}` };
}

/**
 * An empty workfile held in memory: nothing touches disk or config until
 * `save()`, which writes the file and records it as the configured overlay.
 * Used by `add` when no overlay is configured, so a failed add leaves no trace.
 */
export function new_workfile(filename: string, base: DeviceTree, syntax: OverlaySyntax, cwd?: string): Workfile {
    const tree = DeviceTreeOverlay.new_from_string(EMPTY_DTSO, base);
    if (typeof tree === "string") { throw new TypeError(`Empty overlay does not parse: ${tree}`); }
    return workfile_from_overlay(filename, tree, syntax, cwd);
}

/** A workfile holding `tree`, written and recorded as the configured overlay only on `save()`. Used by `import`. */
export function workfile_from_overlay(filename: string, tree: DeviceTreeOverlay, syntax: OverlaySyntax, cwd?: string): Workfile {
    const output_path = path.resolve(cwd ?? process.cwd(), filename);
    const workfile = open_workfile(output_path, tree, syntax);
    return {
        ...workfile,
        save: () => {
            workfile.save();
            save_settings({ overlay: output_path }, cwd);
        },
    };
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;
    const os = await import("node:os");

    test("next_workfile_name — returns overlay.dtso in an empty directory", () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "attach-wf-"));
        try {
            expect(next_workfile_name("overlay", directory)).toBe("overlay.dtso");
        } finally {
            fs.rmSync(directory, { recursive: true });
        }
    });

    test("next_workfile_name — indexes past existing files", () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "attach-wf-"));
        try {
            fs.writeFileSync(path.join(directory, "overlay.dtso"), "");
            expect(next_workfile_name("overlay", directory)).toBe("overlay-1.dtso");

            fs.writeFileSync(path.join(directory, "overlay-1.dtso"), "");
            expect(next_workfile_name("overlay", directory)).toBe("overlay-2.dtso");

            fs.writeFileSync(path.join(directory, "overlay-2.dtso"), "");
            expect(next_workfile_name("overlay", directory)).toBe("overlay-3.dtso");

            fs.writeFileSync(path.join(directory, "ad7124-8.dtso"), "");
            expect(next_workfile_name("ad7124-8", directory)).toBe("ad7124-8-1.dtso");
        } finally {
            fs.rmSync(directory, { recursive: true });
        }
    });

    test("workfile_filename — adds .dtso only when it is missing", () => {
        expect(workfile_filename("my-overlay")).toBe("my-overlay.dtso");
        expect(workfile_filename("my-overlay.dtso")).toBe("my-overlay.dtso");
    });

    test("workfile_problem — an existing file and a missing directory are refused", () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "attach-wf-"));
        try {
            expect(workfile_problem("overlay.dtso", directory)).toBeUndefined();
            fs.writeFileSync(path.join(directory, "overlay.dtso"), "");
            expect(workfile_problem("overlay.dtso", directory)).toContain("overlay.dtso already exists");
            expect(workfile_problem("nope/overlay.dtso", directory)).toContain("is not a directory");
        } finally {
            fs.rmSync(directory, { recursive: true });
        }
    });

    test("new_workfile — writes the file and config only on save", async () => {
        const { DeviceTree } = await import("attach-lib");
        const base = DeviceTree.new_from_string("/dts-v1/;\n/ {\n};");
        if (typeof base === "string") { throw new TypeError(base); }
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "attach-wf-"));
        try {
            const workfile = new_workfile("dev.dtso", base, "fragment", directory);
            expect(fs.existsSync(path.join(directory, "dev.dtso"))).toBe(false);
            expect(fs.existsSync(path.join(directory, ".attach-linux"))).toBe(false);

            workfile.save();
            expect(fs.readFileSync(path.join(directory, "dev.dtso"), "utf8")).toContain("/plugin/;");
            expect(fs.readFileSync(path.join(directory, ".attach-linux", "config.toml"), "utf8")).toContain("dev.dtso");
        } finally {
            fs.rmSync(directory, { recursive: true });
        }
    });

    test("workfile_from_overlay — writes the given overlay and the config only on save", () => {
        const tree = DeviceTreeOverlay.new_from_string("/dts-v1/;\n/plugin/;\n&spi0 { adc@0 { reg = <0>; }; };\n");
        if (typeof tree === "string") { throw new TypeError(tree); }
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "attach-wf-"));
        try {
            const workfile = workfile_from_overlay("ad7124.dtso", tree, "label", directory);
            expect(workfile.path).toBe(path.join(directory, "ad7124.dtso"));
            expect(fs.existsSync(workfile.path)).toBe(false);

            workfile.save();
            expect(fs.readFileSync(workfile.path, "utf8")).toContain("&spi0 {");
            expect(fs.readFileSync(path.join(directory, ".attach-linux", "config.toml"), "utf8")).toContain("ad7124.dtso");
        } finally {
            fs.rmSync(directory, { recursive: true });
        }
    });
}
