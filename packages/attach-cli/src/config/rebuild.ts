import path from "node:path";

import { build_validation_schema, compat_index_stale_reason, load_compat_index, save_compat_index, validation_schema_path, validation_schema_stale_reason } from "./cache";
import { format_duration, start_progress, type ProgressStream } from "../progress";
import { build_compat_index } from "../utilities";
import type { ConfigError, ConfigResult, Settings } from "./settings";
import { parse_dt_schema, parse_linux, parse_tools } from "./workspace";

export interface RebuildResult {
    ok: boolean;
    message: string;
}

/**
 * Build the compat index and `validation.json` from the Linux tree, both at
 * once (`dt-mk-schema` runs as a child process while the index parses in this
 * one). This is the only place the two caches are built: `config linux <path>`
 * and `config --reload` call it. The progress goes to stderr.
 */
export async function rebuild_caches(
    { linux, dt_schema }: { linux: string; dt_schema: string },
    dt_mk_schema: string,
    cwd = process.cwd(),
    stream: ProgressStream = process.stderr,
): Promise<RebuildResult> {
    const started = Date.now();
    const progress = start_progress("Indexing device bindings and compiling binding schemas...", stream);
    const [index, schema] = await Promise.all([
        build_compat_index(linux, dt_schema, (done, total) => { progress.update(done, total); }),
        build_validation_schema(dt_mk_schema, linux, dt_schema, cwd),
    ]);
    save_compat_index(index.entries, linux, dt_schema, cwd);
    if (!schema.ok) {
        progress.done("Compiling binding schemas failed");
        return { ok: false, message: `Compiling binding schemas failed:\n${schema.error}` };
    }
    const message = `Indexed ${Object.keys(index.entries).length} compatibles from ${index.files} bindings and compiled binding schemas in ${format_duration(Date.now() - started)}`;
    progress.done(message);
    return { ok: true, message };
}

/**
 * Check what a rebuild needs (the configured Linux tree, the bundled dt-schema
 * and tools) and run it. Config problems are returned as errors; a failed
 * build is a `RebuildResult` that is not ok.
 */
export async function reload_caches(settings: Settings, cwd = process.cwd(), stream: ProgressStream = process.stderr): Promise<ConfigResult<RebuildResult>> {
    const linux = parse_linux(settings);
    const dt_schema = parse_dt_schema();
    const tools = parse_tools();
    if (!linux.ok || !dt_schema.ok || !tools.ok) {
        const errors: ConfigError[] = [linux, dt_schema, tools].flatMap(result => (result.ok ? [] : result.errors));
        return { ok: false, errors };
    }
    return { ok: true, value: await rebuild_caches({ linux: linux.value, dt_schema: dt_schema.value }, tools.value.dt_mk_schema, cwd, stream) };
}

/** True when the compat index and validation.json exist and are current for these paths: nothing to rebuild. */
export function caches_current(linux: string, dt_schema: string, cwd = process.cwd()): boolean {
    return compat_index_stale_reason(load_compat_index(cwd), linux, dt_schema) === undefined
        && validation_schema_stale_reason(linux, dt_schema, cwd) === undefined;
}

export interface EnsureResult extends RebuildResult {
    /** False when the caches were already current for the configured Linux tree. */
    rebuilt: boolean;
}

/** `reload_caches`, skipped when the caches are already current for the configured Linux tree (`init`). */
export async function ensure_caches(settings: Settings, cwd = process.cwd(), stream: ProgressStream = process.stderr): Promise<ConfigResult<EnsureResult>> {
    const linux = parse_linux(settings);
    const dt_schema = parse_dt_schema();
    if (linux.ok && dt_schema.ok && caches_current(linux.value, dt_schema.value, cwd)) {
        return { ok: true, value: { ok: true, rebuilt: false, message: "The binding caches are current" } };
    }
    const reloaded = await reload_caches(settings, cwd, stream);
    return reloaded.ok ? { ok: true, value: { ...reloaded.value, rebuilt: true } } : reloaded;
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;
    const fs = await import("node:fs");
    const os = await import("node:os");

    const capture = (): { stream: { isTTY: boolean; write: (chunk: string) => boolean }; text: () => string } => {
        let written = "";
        return { stream: { isTTY: false, write: (chunk: string) => { written += chunk; return true; } }, text: () => written };
    };
    const workspace = (tool_body: string): { directory: string; linux: string; tool: string } => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "attach-rebuild-"));
        const linux = path.join(directory, "linux");
        const bindings = path.join(linux, "Documentation", "devicetree", "bindings");
        fs.mkdirSync(bindings, { recursive: true });
        // Older than any cache a test builds: a stamp in the same millisecond would count as stale.
        const before = new Date(Date.now() - 60_000);
        fs.utimesSync(bindings, before, before);
        const tool = path.join(directory, "dt-mk-schema");
        fs.writeFileSync(tool, `#!/bin/sh\n${tool_body}\n`, { mode: 0o755 });
        return { directory, linux, tool };
    };

    test("reload_caches - without a configured Linux tree it reports the config, builds nothing", async () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "attach-rebuild-"));
        try {
            const result = await reload_caches({ overlay_syntax: "fragment", preprocess_command: "" }, directory, capture().stream);
            expect(result.ok).toBe(false);
            expect(!result.ok && result.errors.map(error => error.field)).toContain("linux");
            expect(fs.existsSync(path.join(directory, ".attach-linux"))).toBe(false);
        } finally {
            fs.rmSync(directory, { recursive: true });
        }
    });

    test("caches_current - false until both caches exist, true once they are current, false again for another Linux tree", () => {
        const { directory, linux } = workspace("true");
        try {
            expect(caches_current(linux, "/dt-schema", directory)).toBe(false);
            save_compat_index({}, linux, "/dt-schema", directory);
            expect(caches_current(linux, "/dt-schema", directory)).toBe(false);
            fs.writeFileSync(validation_schema_path(directory), "{}");
            fs.writeFileSync(path.join(path.dirname(validation_schema_path(directory)), "validation.stamp.json"), JSON.stringify({ generated_at: Date.now() + 5000, linux, dt_schema: "/dt-schema" }));
            expect(caches_current(linux, "/dt-schema", directory)).toBe(true);
            expect(caches_current(path.join(directory, "other"), "/dt-schema", directory)).toBe(false);
        } finally {
            fs.rmSync(directory, { recursive: true });
        }
    });

    test("ensure_caches - without a configured Linux tree it reports the config, builds nothing", async () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "attach-rebuild-"));
        try {
            const result = await ensure_caches({ overlay_syntax: "fragment", preprocess_command: "" }, directory, capture().stream);
            expect(!result.ok && result.errors.map(error => error.field)).toContain("linux");
        } finally {
            fs.rmSync(directory, { recursive: true });
        }
    });

    test("rebuild_caches - builds the index and validation.json together", async () => {
        const { directory, linux, tool } = workspace(`sleep 0.2; echo '{}' > "$3"`);
        try {
            const progress = capture();
            const result = await rebuild_caches({ linux, dt_schema: "/dt-schema" }, tool, directory, progress.stream);
            expect(result.ok).toBe(true);
            expect(result.message).toMatch(/^Indexed 0 compatibles from 0 bindings and compiled binding schemas in /);
            expect(load_compat_index(directory)).toMatchObject({ linux, dt_schema: "/dt-schema", entries: {} });
            expect(fs.existsSync(validation_schema_path(directory))).toBe(true);
            expect(progress.text()).toContain("Indexing device bindings and compiling binding schemas...");
        } finally {
            fs.rmSync(directory, { recursive: true });
        }
    });

    test("rebuild_caches - a failing dt-mk-schema is reported, the index is still saved", async () => {
        const { directory, linux, tool } = workspace(`echo "bad binding" >&2; exit 1`);
        try {
            const result = await rebuild_caches({ linux, dt_schema: "/dt-schema" }, tool, directory, capture().stream);
            expect(result.ok).toBe(false);
            expect(result.message).toContain("Compiling binding schemas failed");
            expect(result.message).toContain("bad binding");
            expect(load_compat_index(directory)?.entries).toEqual({});
            expect(fs.existsSync(validation_schema_path(directory))).toBe(false);
        } finally {
            fs.rmSync(directory, { recursive: true });
        }
    });
}
