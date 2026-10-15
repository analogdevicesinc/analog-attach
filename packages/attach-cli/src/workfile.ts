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

export interface CreateWorkfileResult {
    path: string;
    message: string;
}

/**
 * Create an empty workfile and save the overlay path to config.
 * Used by both `create-workfile` and `add` (when no overlay is configured).
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
    const output_path = path.resolve(cwd ?? process.cwd(), filename);
    const tree = DeviceTreeOverlay.new_from_string(EMPTY_DTSO, base);
    if (typeof tree === "string") { throw new TypeError(`Empty overlay does not parse: ${tree}`); }
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
}
