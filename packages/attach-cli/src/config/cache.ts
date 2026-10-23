import { execFile } from "node:child_process";
import * as fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { config_directory } from "./settings";

// Derived state kept under .attach-linux/. It is never part of config.toml:
// every cache records the linux / dt-schema paths it was built from. They are
// built by `config-set linux` and `config-get --reload` only; a cache older
// than the bindings, or built for another tree, is just warned about.

export interface CacheStamp {
    generated_at: number;
    linux?: string;
    dt_schema?: string;
}

export interface CompatIndex extends CacheStamp {
    entries: Record<string, string>;
}

export function get_latest_mtime(directory: string): number {
    if (!fs.existsSync(directory)) {
        return 0;
    }

    let latest = fs.statSync(directory).mtimeMs;
    const list = fs.readdirSync(directory);

    for (const file of list) {
        if (file === ".git") {
            continue;
        }

        const filePath = path.join(directory, file);
        const stat = fs.statSync(filePath);

        latest = Math.max(latest, stat.isDirectory() ? get_latest_mtime(filePath) : stat.mtimeMs);
    }

    return latest;
}

/** Why a cache has to be (re)built; `undefined` when it is current. */
export type StaleReason =
    | { kind: "missing" }
    | { kind: "stale" }
    | { kind: "linux-changed"; from: string; to: string };

/** Why a cache built from `stamp` is out of date for these linux / dt-schema paths, if it is. */
export function stale_reason(stamp: CacheStamp | undefined, linux: string, dt_schema: string): StaleReason | undefined {
    if (stamp === undefined) { return { kind: "missing" }; }
    if (typeof stamp.generated_at !== "number") { return { kind: "stale" }; }
    if (stamp.linux !== undefined && path.resolve(linux) !== path.resolve(stamp.linux)) {
        return { kind: "linux-changed", from: stamp.linux, to: linux };
    }
    if (stamp.dt_schema !== undefined && path.resolve(dt_schema) !== path.resolve(stamp.dt_schema)) { return { kind: "stale" }; }

    const bindings_folder = path.resolve(linux, "Documentation", "devicetree", "bindings");
    const latest_mtime = Math.max(get_latest_mtime(bindings_folder), get_latest_mtime(dt_schema));

    return latest_mtime > stamp.generated_at ? { kind: "stale" } : undefined;
}

export function compat_index_stale_reason(index: CompatIndex | undefined, linux: string, dt_schema: string): StaleReason | undefined {
    if (index?.entries === undefined) { return { kind: "missing" }; }
    return stale_reason(index, linux, dt_schema);
}

function read_json<T>(file: string): T | undefined {
    if (!fs.existsSync(file)) { return undefined; }
    try {
        return JSON.parse(fs.readFileSync(file, "utf8")) as T;
    } catch {
        return undefined;
    }
}

function write_json(file: string, value: unknown): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value, undefined, 2));
}

const compat_index_path = (cwd = process.cwd()): string => path.join(config_directory(cwd), "compat-index.json");

export function load_compat_index(cwd = process.cwd()): CompatIndex | undefined {
    return read_json<CompatIndex>(compat_index_path(cwd));
}

export function save_compat_index(entries: Record<string, string>, linux: string, dt_schema: string, cwd = process.cwd()): string {
    const index: CompatIndex = { generated_at: Date.now(), linux, dt_schema, entries };
    write_json(compat_index_path(cwd), index);
    return compat_index_path(cwd);
}

/** Where `dt-mk-schema` output is cached; its stamp sits next to it. */
export function validation_schema_path(cwd = process.cwd()): string {
    return path.join(config_directory(cwd), "validation.json");
}

const validation_stamp_path = (cwd = process.cwd()): string => path.join(config_directory(cwd), "validation.stamp.json");

/** Why the cached validation schema is out of date for these paths, if it is. */
export function validation_schema_stale_reason(linux: string, dt_schema: string, cwd = process.cwd()): StaleReason | undefined {
    if (!fs.existsSync(validation_schema_path(cwd))) { return { kind: "missing" }; }
    return stale_reason(read_json<CacheStamp>(validation_stamp_path(cwd)), linux, dt_schema);
}

let warnings_silenced = false;

/** Shell completion prints nothing but candidates, so it turns the cache warning off. */
export function silence_cache_warnings(silent = true): void {
    warnings_silenced = silent;
}

const RELOAD_HINT = "run 'attach-linux config-get --reload' to rebuild them.";

/**
 * A line saying the compat index or validation.json may no longer match the
 * bindings, or `undefined` when both are current (or warnings are silenced).
 * Nothing is rebuilt: the user decides with `config-get --reload`.
 */
export function cache_warning(linux: string, dt_schema: string, cwd = process.cwd()): string | undefined {
    if (warnings_silenced) { return undefined; }
    const reasons = [
        compat_index_stale_reason(load_compat_index(cwd), linux, dt_schema),
        validation_schema_stale_reason(linux, dt_schema, cwd),
    ];
    const moved = reasons.find(reason => reason?.kind === "linux-changed");
    if (moved !== undefined) {
        return `The binding caches were built for ${moved.from}, not ${moved.to}; ${RELOAD_HINT}`;
    }
    return reasons.some(reason => reason?.kind === "stale") ? `The binding caches are older than the bindings; ${RELOAD_HINT}` : undefined;
}

export type BuildResult = { ok: true } | { ok: false; error: string };

/**
 * Run `dt-mk-schema -j` over the Linux bindings into `validation.json`, with
 * its stamp. The tool writes to a temporary file that is renamed on success,
 * so a failure or a parallel reader never sees a partial file (a previous
 * file stays). It writes to a file rather than a pipe so it never waits on a
 * busy event loop (the index builds in the same process meanwhile).
 */
export async function build_validation_schema(dt_mk_schema: string, linux: string, dt_schema: string, cwd = process.cwd()): Promise<BuildResult> {
    const bindings = path.join(linux, "Documentation", "devicetree", "bindings");
    const target = validation_schema_path(cwd);
    const temporary = `${target}.${process.pid}.tmp`;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    try {
        await promisify(execFile)(dt_mk_schema, ["-j", "-o", temporary, bindings], { maxBuffer: 16 * 1024 * 1024 });
        if (!fs.existsSync(temporary) || fs.statSync(temporary).size === 0) {
            return { ok: false, error: `${dt_mk_schema} produced no output` };
        }
        fs.renameSync(temporary, target);
    } catch (error) {
        const stderr = (error as { stderr?: Buffer | string }).stderr?.toString().trim();
        return { ok: false, error: stderr === undefined || stderr === "" ? String(error) : stderr };
    } finally {
        fs.rmSync(temporary, { force: true });
    }
    write_json(validation_stamp_path(cwd), { generated_at: Date.now(), linux, dt_schema } satisfies CacheStamp);
    return { ok: true };
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;
    const os = await import("node:os");

    const fake_tool = (directory: string, body: string): string => {
        const tool = path.join(directory, "dt-mk-schema");
        fs.writeFileSync(tool, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
        return tool;
    };
    const workspace_with_bindings = (): string => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "attach-cache-"));
        fs.mkdirSync(path.join(directory, "linux", "Documentation", "devicetree", "bindings"), { recursive: true });
        return directory;
    };

    test("build_validation_schema - writes validation.json and its stamp, no temp file left", async () => {
        const directory = workspace_with_bindings();
        try {
            // dt-mk-schema -j -o <file> <bindings>
            const tool = fake_tool(directory, `echo '{"generated-types":{}}' > "$3"`);
            const linux = path.join(directory, "linux");
            expect(await build_validation_schema(tool, linux, "/dt-schema", directory)).toEqual({ ok: true });
            expect(fs.readFileSync(validation_schema_path(directory), "utf8")).toContain("generated-types");
            expect(read_json<CacheStamp>(path.join(config_directory(directory), "validation.stamp.json")))
                .toMatchObject({ linux, dt_schema: "/dt-schema" });
            expect(fs.readdirSync(config_directory(directory)).sort()).toEqual(["validation.json", "validation.stamp.json"]);
        } finally {
            fs.rmSync(directory, { recursive: true });
        }
    });

    test("build_validation_schema - a failing tool leaves no file and reports its stderr", async () => {
        const directory = workspace_with_bindings();
        try {
            const tool = fake_tool(directory, `echo "bad binding" >&2; echo partial > "$3"; exit 1`);
            const result = await build_validation_schema(tool, path.join(directory, "linux"), "/dt-schema", directory);
            expect(result.ok).toBe(false);
            expect(!result.ok && result.error).toContain("bad binding");
            expect(fs.existsSync(config_directory(directory)) ? fs.readdirSync(config_directory(directory)) : []).toEqual([]);
        } finally {
            fs.rmSync(directory, { recursive: true });
        }
    });

    test("build_validation_schema - empty output is a failure and keeps the previous file", async () => {
        const directory = workspace_with_bindings();
        try {
            fs.mkdirSync(config_directory(directory));
            fs.writeFileSync(validation_schema_path(directory), "old");
            const tool = fake_tool(directory, `: > "$3"`);
            const result = await build_validation_schema(tool, path.join(directory, "linux"), "/dt-schema", directory);
            expect(!result.ok && result.error).toContain("no output");
            expect(fs.readFileSync(validation_schema_path(directory), "utf8")).toBe("old");
            expect(fs.readdirSync(config_directory(directory))).toEqual(["validation.json"]);
        } finally {
            fs.rmSync(directory, { recursive: true });
        }
    });

    const save_both = (directory: string, linux: string, generated_at: number): void => {
        write_json(path.join(config_directory(directory), "compat-index.json"), { generated_at, linux, dt_schema: "/dt-schema", entries: {} });
        write_json(validation_stamp_path(directory), { generated_at, linux, dt_schema: "/dt-schema" } satisfies CacheStamp);
        fs.writeFileSync(validation_schema_path(directory), "{}");
    };

    test("cache_warning - fresh caches give none; a binding newer than them says how to reload", () => {
        const directory = workspace_with_bindings();
        try {
            const linux = path.join(directory, "linux");
            const dt_schema = path.join(directory, "dt-schema");
            fs.mkdirSync(dt_schema);
            save_both(directory, linux, Date.now() + 60_000);
            expect(cache_warning(linux, "/dt-schema", directory)).toBeUndefined();
            save_both(directory, linux, 0);
            fs.writeFileSync(path.join(linux, "Documentation", "devicetree", "bindings", "x.yaml"), "");
            expect(cache_warning(linux, "/dt-schema", directory)).toBe(
                "The binding caches are older than the bindings; run 'attach-linux config-get --reload' to rebuild them.",
            );
        } finally {
            fs.rmSync(directory, { recursive: true });
        }
    });

    test("cache_warning - names both trees when linux changed since the caches were built", () => {
        const directory = workspace_with_bindings();
        try {
            const linux = path.join(directory, "linux");
            save_both(directory, "/elsewhere", Date.now() + 60_000);
            expect(cache_warning(linux, "/dt-schema", directory)).toBe(
                `The binding caches were built for /elsewhere, not ${linux}; run 'attach-linux config-get --reload' to rebuild them.`,
            );
        } finally {
            fs.rmSync(directory, { recursive: true });
        }
    });

    test("cache_warning - silenced for shell completion", () => {
        const directory = workspace_with_bindings();
        try {
            save_both(directory, "/elsewhere", 0);
            silence_cache_warnings();
            expect(cache_warning(path.join(directory, "linux"), "/dt-schema", directory)).toBeUndefined();
        } finally {
            silence_cache_warnings(false);
            fs.rmSync(directory, { recursive: true });
        }
    });

    test("stale_reason - missing, a changed linux path, newer files, fresh", () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "attach-cache-"));
        try {
            const future = Date.now() + 60_000;
            expect(stale_reason(undefined, directory, directory)).toEqual({ kind: "missing" });
            expect(stale_reason({ generated_at: future, linux: "/elsewhere", dt_schema: directory }, directory, directory))
                .toEqual({ kind: "linux-changed", from: "/elsewhere", to: directory });
            fs.writeFileSync(path.join(directory, "x.yaml"), "");
            expect(stale_reason({ generated_at: 0, linux: directory, dt_schema: directory }, directory, directory)).toEqual({ kind: "stale" });
            expect(stale_reason({ generated_at: future, linux: directory, dt_schema: directory }, directory, directory)).toBeUndefined();
        } finally {
            fs.rmSync(directory, { recursive: true });
        }
    });
}
