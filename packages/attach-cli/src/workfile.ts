import * as fs from "node:fs";
import path from "node:path";

import { save_config, type AttachConfig } from "./config";

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

/** The workfile to start from: an empty overlay. */
export function initial_workfile(_config: AttachConfig): { text: string; source?: string; warnings: string[]; persist: Partial<AttachConfig> } | { error: string } {
    return { text: EMPTY_DTSO, warnings: [], persist: {} };
}

export interface CreateWorkfileResult {
    path: string;
    source?: string;
    warnings: string[];
    message: string;
}

/**
 * Create a workfile and save the overlay path to config.
 * Used by both `create-workfile` and `add` (when no overlay is configured).
 */
export function create_workfile(
    config: AttachConfig,
    filename = "overlay.dtso",
    cwd?: string,
): CreateWorkfileResult | { error: string } {
    const initial = initial_workfile(config);
    if ("error" in initial) { return initial; }

    const output_path = path.resolve(cwd ?? process.cwd(), filename);
    fs.writeFileSync(output_path, initial.text);
    save_config({ overlay: output_path, ...initial.persist });

    const from = initial.source === undefined ? "" : ` from ${initial.source}`;
    return {
        path: output_path,
        source: initial.source,
        warnings: initial.warnings,
        message: `Wrote ${output_path}${from}`,
    };
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
