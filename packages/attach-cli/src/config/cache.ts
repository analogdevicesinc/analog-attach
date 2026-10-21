import * as fs from "node:fs";
import path from "node:path";

import { config_directory } from "./settings";

// Derived state kept under .attach-linux/. It is never part of config.toml:
// every cache records the linux / dt-schema paths it was built from and is
// rebuilt when they change or their files are newer than the cache.

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

const compat_index_path = (): string => path.join(config_directory(), "compat-index.json");

export function load_compat_index(): CompatIndex | undefined {
    return read_json<CompatIndex>(compat_index_path());
}

export function save_compat_index(entries: Record<string, string>, linux: string, dt_schema: string): string {
    const index: CompatIndex = { generated_at: Date.now(), linux, dt_schema, entries };
    write_json(compat_index_path(), index);
    return compat_index_path();
}

/** Where `dt-mk-schema` output is cached; its stamp sits next to it. */
export function validation_schema_path(): string {
    return path.join(config_directory(), "validation.json");
}

const validation_stamp_path = (): string => path.join(config_directory(), "validation.stamp.json");

/** Why the cached validation schema has to be (re)built for these paths, if it does. */
export function validation_schema_stale_reason(linux: string, dt_schema: string): StaleReason | undefined {
    if (!fs.existsSync(validation_schema_path())) { return { kind: "missing" }; }
    return stale_reason(read_json<CacheStamp>(validation_stamp_path()), linux, dt_schema);
}

export function stamp_validation_schema(linux: string, dt_schema: string): void {
    write_json(validation_stamp_path(), { generated_at: Date.now(), linux, dt_schema } satisfies CacheStamp);
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;
    const os = await import("node:os");

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
