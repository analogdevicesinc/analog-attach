import * as fs from "node:fs";
import path from "node:path";

import { save_settings } from "./config/settings";

const EMPTY_DTSO = String.raw`/dts-v1/;
/plugin/;

/ {
};
`;

export { EMPTY_DTSO };

/** Pick the next available overlay filename: overlay.dtso, overlay-1.dtso, overlay-2.dtso, … */
export function next_workfile_name(cwd?: string): string {
    const directory = cwd ?? process.cwd();
    if (!fs.existsSync(path.join(directory, "overlay.dtso"))) { return "overlay.dtso"; }
    let n = 1;
    while (fs.existsSync(path.join(directory, `overlay-${n}.dtso`))) { n++; }
    return `overlay-${n}.dtso`;
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

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;
    const os = await import("node:os");

    test("next_workfile_name — returns overlay.dtso in an empty directory", () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "attach-wf-"));
        try {
            expect(next_workfile_name(directory)).toBe("overlay.dtso");
        } finally {
            fs.rmSync(directory, { recursive: true });
        }
    });

    test("next_workfile_name — indexes past existing files", () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "attach-wf-"));
        try {
            fs.writeFileSync(path.join(directory, "overlay.dtso"), "");
            expect(next_workfile_name(directory)).toBe("overlay-1.dtso");

            fs.writeFileSync(path.join(directory, "overlay-1.dtso"), "");
            expect(next_workfile_name(directory)).toBe("overlay-2.dtso");

            fs.writeFileSync(path.join(directory, "overlay-2.dtso"), "");
            expect(next_workfile_name(directory)).toBe("overlay-3.dtso");
        } finally {
            fs.rmSync(directory, { recursive: true });
        }
    });
}
