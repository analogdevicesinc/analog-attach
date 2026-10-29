import { execFile } from "node:child_process";
import * as fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

// Derived state kept in the backend's state directory (`session.state_dir`). It is never
// a setting: every cache records the linux / dt-schema paths it was built from. They are
// built by `config linux <path>`, `config --reload` and the setup run only; a cache older
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

const compat_index_path = (state_directory: string): string => path.join(state_directory, "compat-index.json");

export function load_compat_index(state_directory: string): CompatIndex | undefined {
    return read_json<CompatIndex>(compat_index_path(state_directory));
}

export function save_compat_index(entries: Record<string, string>, linux: string, dt_schema: string, state_directory: string): string {
    const index: CompatIndex = { generated_at: Date.now(), linux, dt_schema, entries };
    write_json(compat_index_path(state_directory), index);
    return compat_index_path(state_directory);
}

/** Where `dt-mk-schema` output is cached; its stamp sits next to it. */
export function validation_schema_path(state_directory: string): string {
    return path.join(state_directory, "validation.json");
}

const validation_stamp_path = (state_directory: string): string => path.join(state_directory, "validation.stamp.json");

/** Why the cached validation schema is out of date for these paths, if it is. */
export function validation_schema_stale_reason(linux: string, dt_schema: string, state_directory: string): StaleReason | undefined {
    if (!fs.existsSync(validation_schema_path(state_directory))) { return { kind: "missing" }; }
    return stale_reason(read_json<CacheStamp>(validation_stamp_path(state_directory)), linux, dt_schema);
}

const rebuild_hint = (program: string): string => `run '${program} config --reload' to rebuild them.`;

/**
 * A line saying the compat index or validation.json may no longer match the
 * bindings, or `undefined` when both are current. Nothing is rebuilt: the user
 * decides with `config --reload`. Shell completion prints it nowhere, since a
 * `complete` session's `warn` is silent.
 */
export function cache_warning(linux: string, dt_schema: string, state_directory: string, program: string): string | undefined {
    const reasons = [
        compat_index_stale_reason(load_compat_index(state_directory), linux, dt_schema),
        validation_schema_stale_reason(linux, dt_schema, state_directory),
    ];
    const moved = reasons.find(reason => reason?.kind === "linux-changed");
    if (moved !== undefined) {
        return `The binding caches were built for ${moved.from}, not ${moved.to}; ${rebuild_hint(program)}`;
    }
    return reasons.some(reason => reason?.kind === "stale") ? `The binding caches are older than the bindings; ${rebuild_hint(program)}` : undefined;
}

export type BuildResult = { ok: true } | { ok: false; error: string };

/**
 * Run `dt-mk-schema -j` over the Linux bindings into `validation.json`, with
 * its stamp. The tool writes to a temporary file that is renamed on success,
 * so a failure or a parallel reader never sees a partial file (a previous
 * file stays). It writes to a file rather than a pipe so it never waits on a
 * busy event loop (the index builds in the same process meanwhile).
 */
export async function build_validation_schema(dt_mk_schema: string, linux: string, dt_schema: string, state_directory: string): Promise<BuildResult> {
    const bindings = path.join(linux, "Documentation", "devicetree", "bindings");
    const target = validation_schema_path(state_directory);
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
    write_json(validation_stamp_path(state_directory), { generated_at: Date.now(), linux, dt_schema } satisfies CacheStamp);
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
    /** The state directory of a test workspace. */
    const state_of = (directory: string): string => path.join(directory, "state");
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
            expect(await build_validation_schema(tool, linux, "/dt-schema", state_of(directory))).toEqual({ ok: true });
            expect(fs.readFileSync(validation_schema_path(state_of(directory)), "utf8")).toContain("generated-types");
            expect(read_json<CacheStamp>(path.join(state_of(directory), "validation.stamp.json")))
                .toMatchObject({ linux, dt_schema: "/dt-schema" });
            expect(fs.readdirSync(state_of(directory)).sort()).toEqual(["validation.json", "validation.stamp.json"]);
        } finally {
            fs.rmSync(directory, { recursive: true });
        }
    });

    test("build_validation_schema - a failing tool leaves no file and reports its stderr", async () => {
        const directory = workspace_with_bindings();
        try {
            const tool = fake_tool(directory, `echo "bad binding" >&2; echo partial > "$3"; exit 1`);
            const result = await build_validation_schema(tool, path.join(directory, "linux"), "/dt-schema", state_of(directory));
            expect(result.ok).toBe(false);
            expect(!result.ok && result.error).toContain("bad binding");
            expect(fs.existsSync(state_of(directory)) ? fs.readdirSync(state_of(directory)) : []).toEqual([]);
        } finally {
            fs.rmSync(directory, { recursive: true });
        }
    });

    test("build_validation_schema - empty output is a failure and keeps the previous file", async () => {
        const directory = workspace_with_bindings();
        try {
            fs.mkdirSync(state_of(directory), { recursive: true });
            fs.writeFileSync(validation_schema_path(state_of(directory)), "old");
            const tool = fake_tool(directory, `: > "$3"`);
            const result = await build_validation_schema(tool, path.join(directory, "linux"), "/dt-schema", state_of(directory));
            expect(!result.ok && result.error).toContain("no output");
            expect(fs.readFileSync(validation_schema_path(state_of(directory)), "utf8")).toBe("old");
            expect(fs.readdirSync(state_of(directory))).toEqual(["validation.json"]);
        } finally {
            fs.rmSync(directory, { recursive: true });
        }
    });

    const save_both = (directory: string, linux: string, generated_at: number): void => {
        write_json(path.join(state_of(directory), "compat-index.json"), { generated_at, linux, dt_schema: "/dt-schema", entries: {} });
        write_json(validation_stamp_path(state_of(directory)), { generated_at, linux, dt_schema: "/dt-schema" } satisfies CacheStamp);
        fs.writeFileSync(validation_schema_path(state_of(directory)), "{}");
    };

    test("cache_warning - fresh caches give none; a binding newer than them says how to reload", () => {
        const directory = workspace_with_bindings();
        try {
            const linux = path.join(directory, "linux");
            const dt_schema = path.join(directory, "dt-schema");
            fs.mkdirSync(dt_schema);
            save_both(directory, linux, Date.now() + 60_000);
            expect(cache_warning(linux, "/dt-schema", state_of(directory), "aa")).toBeUndefined();
            save_both(directory, linux, 0);
            fs.writeFileSync(path.join(linux, "Documentation", "devicetree", "bindings", "x.yaml"), "");
            expect(cache_warning(linux, "/dt-schema", state_of(directory), "aa")).toBe(
                "The binding caches are older than the bindings; run 'aa config --reload' to rebuild them.",
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
            expect(cache_warning(linux, "/dt-schema", state_of(directory), "aa")).toBe(
                `The binding caches were built for /elsewhere, not ${linux}; run 'aa config --reload' to rebuild them.`,
            );
        } finally {
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
