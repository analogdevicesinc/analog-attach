import path from "node:path";

import type { Progress } from "../../../interface/backend-interface";
import { build_validation_schema, compat_index_stale_reason, load_compat_index, save_compat_index, validation_schema_path, validation_schema_stale_reason } from "./cache";
import { format_duration } from "../progress";
import { build_compat_index } from "../utilities";
import type { ConfigError, ConfigResult, Settings } from "./settings";
import { parse_dt_schema, parse_linux, parse_tools, type WorkspaceContext } from "./workspace";

/** How a long step reports itself (`session.progress`). */
export type StartProgress = (label: string) => Progress;

export interface RebuildResult {
    ok: boolean;
    message: string;
}

/**
 * Build `validation.json` from the Linux tree (`dt-mk-schema`), then the
 * compat index from it. A failed compile builds neither, so the previous pair
 * stays. This is the only place the two caches are built: `config linux
 * <path>`, `config --reload` and the setup run call it. The progress goes to stderr.
 */
export async function rebuild_caches(
    { linux, dt_schema }: { linux: string; dt_schema: string },
    dt_mk_schema: string,
    state_directory: string,
    start_progress: StartProgress,
): Promise<RebuildResult> {
    const started = Date.now();
    const progress = start_progress("Indexing device bindings and compiling binding schemas...");
    const schema = await build_validation_schema(dt_mk_schema, linux, dt_schema, state_directory);
    if (!schema.ok) {
        progress.done("Compiling binding schemas failed");
        return { ok: false, message: `Compiling binding schemas failed:\n${schema.error}` };
    }
    const index = build_compat_index(schema.schemas, linux);
    save_compat_index(index.entries, linux, dt_schema, state_directory);
    const message = `Indexed ${Object.keys(index.entries).length} compatibles from ${index.files} bindings and compiled binding schemas in ${format_duration(Date.now() - started)}`;
    progress.done(message);
    return { ok: true, message };
}

/**
 * Check what a rebuild needs (the configured Linux tree, the bundled dt-schema
 * and tools) and run it. Config problems are returned as errors; a failed
 * build is a `RebuildResult` that is not ok.
 */
export async function reload_caches(settings: Settings, context: WorkspaceContext, start_progress: StartProgress): Promise<ConfigResult<RebuildResult>> {
    const linux = parse_linux(settings, context.program);
    const dt_schema = parse_dt_schema(context);
    const tools = parse_tools(context);
    if (!linux.ok || !dt_schema.ok || !tools.ok) {
        const errors: ConfigError[] = [linux, dt_schema, tools].flatMap(result => (result.ok ? [] : result.errors));
        return { ok: false, errors };
    }
    return { ok: true, value: await rebuild_caches({ linux: linux.value, dt_schema: dt_schema.value }, tools.value.dt_mk_schema, context.state_dir, start_progress) };
}

/** True when the compat index and validation.json exist and are current for these paths: nothing to rebuild. */
export function caches_current(linux: string, dt_schema: string, state_directory: string): boolean {
    return compat_index_stale_reason(load_compat_index(state_directory), linux, dt_schema) === undefined
        && validation_schema_stale_reason(linux, dt_schema, state_directory) === undefined;
}

export interface EnsureResult extends RebuildResult {
    /** False when the caches were already current for the configured Linux tree. */
    rebuilt: boolean;
}

/** `reload_caches`, skipped when the caches are already current for the configured Linux tree (`init`). */
export async function ensure_caches(settings: Settings, context: WorkspaceContext, start_progress: StartProgress): Promise<ConfigResult<EnsureResult>> {
    const linux = parse_linux(settings, context.program);
    const dt_schema = parse_dt_schema(context);
    if (linux.ok && dt_schema.ok && caches_current(linux.value, dt_schema.value, context.state_dir)) {
        return { ok: true, value: { ok: true, rebuilt: false, message: "The binding caches are current" } };
    }
    const reloaded = await reload_caches(settings, context, start_progress);
    return reloaded.ok ? { ok: true, value: { ...reloaded.value, rebuilt: true } } : reloaded;
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;
    const fs = await import("node:fs");
    const os = await import("node:os");

    const capture = (): { stream: StartProgress; text: () => string } => {
        let written = "";
        const stream: StartProgress = label => {
            written += `${label}\n`;
            return { update: () => {}, line: text => { written += `${text}\n`; }, done: summary => { written += `${summary ?? label}\n`; } };
        };
        return { stream, text: () => written };
    };
    const context = (directory: string): WorkspaceContext => ({ state_dir: path.join(directory, "state"), assets_dir: path.join(directory, "assets"), program: "aa" });
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
            const result = await reload_caches({ overlay_syntax: "fragment", preprocess_command: "" }, context(directory), capture().stream);
            expect(result.ok).toBe(false);
            expect(!result.ok && result.errors.map(error => error.field)).toContain("linux");
            expect(fs.existsSync(path.join(directory, "state"))).toBe(false);
        } finally {
            fs.rmSync(directory, { recursive: true });
        }
    });

    test("caches_current - false until both caches exist, true once they are current, false again for another Linux tree", () => {
        const { directory, linux } = workspace("true");
        const state = path.join(directory, "state");
        try {
            expect(caches_current(linux, "/dt-schema", state)).toBe(false);
            save_compat_index({}, linux, "/dt-schema", state);
            expect(caches_current(linux, "/dt-schema", state)).toBe(false);
            fs.writeFileSync(validation_schema_path(state), "{}");
            fs.writeFileSync(path.join(path.dirname(validation_schema_path(state)), "validation.stamp.json"), JSON.stringify({ generated_at: Date.now() + 5000, linux, dt_schema: "/dt-schema" }));
            expect(caches_current(linux, "/dt-schema", state)).toBe(true);
            expect(caches_current(path.join(directory, "other"), "/dt-schema", state)).toBe(false);
        } finally {
            fs.rmSync(directory, { recursive: true });
        }
    });

    test("ensure_caches - without a configured Linux tree it reports the config, builds nothing", async () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "attach-rebuild-"));
        try {
            const result = await ensure_caches({ overlay_syntax: "fragment", preprocess_command: "" }, context(directory), capture().stream);
            expect(!result.ok && result.errors.map(error => error.field)).toContain("linux");
        } finally {
            fs.rmSync(directory, { recursive: true });
        }
    });

    test("rebuild_caches - builds validation.json, then the index from it", async () => {
        // The tool copies processed.json next to it: dt-mk-schema -j -o <file> <bindings>
        const { directory, linux, tool } = workspace(`cat "$(dirname "$0")/processed.json" > "$3"`);
        const state = path.join(directory, "state");
        const bindings = path.join(linux, "Documentation", "devicetree", "bindings");
        const adc = path.join(bindings, "iio", "adc", "adi,ad7124.yaml");
        fs.writeFileSync(path.join(directory, "processed.json"), JSON.stringify({
            "generated-types": { $id: "generated-types", properties: {} },
            "http://devicetree.org/schemas/iio/adc/adi,ad7124.yaml": {
                $filename: adc,
                properties: { compatible: { items: [{ enum: ["adi,ad7124-4", "adi,ad7124-8"] }], maxItems: 1, minItems: 1 } },
            },
            "http://devicetree.org/schemas/simple-bus.yaml": { $filename: "/tmp/_MEI0/dtschema/schemas/simple-bus.yaml", properties: { compatible: { contains: { const: "simple-bus" } } } },
        }));
        try {
            const progress = capture();
            const result = await rebuild_caches({ linux, dt_schema: "/dt-schema" }, tool, state, progress.stream);
            expect(result.ok).toBe(true);
            expect(result.message).toMatch(/^Indexed 2 compatibles from 1 bindings and compiled binding schemas in /);
            expect(load_compat_index(state)).toMatchObject({ linux, dt_schema: "/dt-schema", entries: { "adi,ad7124-4": adc, "adi,ad7124-8": adc } });
            expect(fs.existsSync(validation_schema_path(state))).toBe(true);
            expect(progress.text()).toContain("Indexing device bindings and compiling binding schemas...");
        } finally {
            fs.rmSync(directory, { recursive: true });
        }
    });

    test("rebuild_caches - a failing dt-mk-schema is reported, and both previous caches stay", async () => {
        const { directory, linux, tool } = workspace(`echo "bad binding" >&2; exit 1`);
        const state = path.join(directory, "state");
        try {
            save_compat_index({ "adi,ad7124-8": "/old.yaml" }, linux, "/dt-schema", state);
            fs.writeFileSync(validation_schema_path(state), "{}");
            const result = await rebuild_caches({ linux, dt_schema: "/dt-schema" }, tool, state, capture().stream);
            expect(result.ok).toBe(false);
            expect(result.message).toContain("Compiling binding schemas failed");
            expect(result.message).toContain("bad binding");
            expect(load_compat_index(state)?.entries).toEqual({ "adi,ad7124-8": "/old.yaml" });
            expect(fs.readFileSync(validation_schema_path(state), "utf8")).toBe("{}");
        } finally {
            fs.rmSync(directory, { recursive: true });
        }
    });
}
