// The settings files behind `SettingsView`: a project-local `.analog-attach/config.json`
// and a global `$XDG_CONFIG_HOME/analog-attach/config.json`. Local wins over global, then
// the `SettingSpec` default. Each file is one flat JSON object with kebab-case keys; the
// values are strings, except a `path_list`, which is an array of strings.
//
// The parse is strict, as attach-cli's `parse_settings` was: a file that isn't a JSON object,
// a value of the wrong type or outside its options, and (in the local file) a key the active
// backend doesn't declare are errors. Errors are values: a store always opens, carries its
// errors, and leaves an invalid value out of the effective ones, so `config` can still fix
// the file. A file that isn't a JSON object is never written over.

import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Session, SettingSpec, SettingsHooks, SettingsView, SettingWrite } from "../interface/backend-interface";

/** The front end's own key: which backend is active. */
export const BACKEND_KEY = "backend";
export const CONFIG_DIRECTORY = ".analog-attach";
export const CONFIG_FILE = "config.json";

export type Scope = "local" | "global";

/** Modelled on attach-cli's `ConfigError` (src/config/settings.ts). */
export interface ConfigError {
    /** The setting key, or the file name when the file itself is the problem. */
    field: string;
    kind: "missing" | "invalid" | "unknown";
    message: string;
    description?: string;
    hint?: string;
}

/** Where the files are. Injected, so tests use temp directories. */
export interface SettingsLocation {
    cwd: string;
    home: string;
    /** `$XDG_CONFIG_HOME`; ignored when empty or relative, as the XDG spec says. */
    xdg_config_home?: string;
}

export interface SettingsFiles {
    cwd: string;
    home: string;
    /** The directory that holds `.analog-attach/`, or the cwd when no ancestor has one. */
    project_root: string;
    local: string;
    global: string;
}

/** The location of the running process. */
export function process_location(): SettingsLocation {
    return { cwd: process.cwd(), home: os.homedir(), xdg_config_home: process.env["XDG_CONFIG_HOME"] };
}

/**
 * The nearest ancestor of `cwd` (the cwd included) that has a `.analog-attach/` directory.
 * The walk stops at the home directory and at the filesystem root, neither of which is
 * checked unless it is the cwd itself, so a stray `~/.analog-attach/` doesn't claim every
 * directory under home. With none, the cwd.
 */
export function find_project_root(cwd: string, home: string): string {
    const start = path.resolve(cwd);
    const stop = path.resolve(home);
    let directory = start;
    for (;;) {
        if (is_directory(path.join(directory, CONFIG_DIRECTORY))) { return directory; }
        const parent = path.dirname(directory);
        if (parent === directory || parent === stop || parent === path.parse(parent).root) { return start; }
        directory = parent;
    }
}

export function settings_files(location: SettingsLocation): SettingsFiles {
    const home = path.resolve(location.home);
    const xdg = location.xdg_config_home;
    const config_home = xdg !== undefined && xdg !== "" && path.isAbsolute(xdg) ? xdg : path.join(home, ".config");
    const project_root = find_project_root(location.cwd, home);
    return {
        cwd: path.resolve(location.cwd),
        home,
        project_root,
        local: path.join(project_root, CONFIG_DIRECTORY, CONFIG_FILE),
        global: path.join(config_home, "analog-attach", CONFIG_FILE),
    };
}

/** The spec of the `backend` setting, its options the known backend ids. */
export function backend_setting(ids: readonly string[]): SettingSpec {
    return {
        key: BACKEND_KEY,
        category: "General",
        description: `The ecosystem this project targets: ${ids.join(" or ")}`,
        type: "string",
        options: ids,
        required: true,
    };
}

function is_directory(file: string): boolean {
    try {
        return fs.statSync(file).isDirectory();
    } catch {
        return false;
    }
}

/** `/home/me/x` → `~/x`, for messages. */
export function display_path(file: string, home: string): string {
    const relative = path.relative(home, file);
    if (relative === "") { return "~"; }
    return relative.startsWith("..") || path.isAbsolute(relative) ? file : `~/${relative}`;
}

function is_tilde(raw: string): boolean {
    return raw === "~" || raw.startsWith("~/");
}

function expand_tilde(raw: string, home: string): string {
    return raw === "~" ? home : path.join(home, raw.slice(2));
}

// =====================================================================================
// Reading
// =====================================================================================

type Value = string | readonly string[];

interface Layer {
    scope: Scope;
    file: string;
    /** The whole object as on disk, unknown and invalid keys included, so a save keeps them. */
    table: Record<string, unknown>;
    /** The valid values of declared keys, paths resolved. */
    values: Map<string, Value>;
    /** Why the file can't be read or written over: not JSON, or not an object. */
    unreadable?: string;
}

/** A path as stored → absolute, or why it can't be. */
function resolve_stored_path(raw: string, scope: Scope, files: SettingsFiles): string | { problem: string } {
    if (is_tilde(raw)) { return expand_tilde(raw, files.home); }
    if (path.isAbsolute(raw)) { return path.normalize(raw); }
    if (scope === "global") { return { problem: `${JSON.stringify(raw)} is relative; a global path must be absolute or start with ~` }; }
    return path.resolve(files.project_root, raw);
}

function check_scalar(spec: SettingSpec, raw: string): string | undefined {
    if (raw === "") { return "must not be empty"; }
    if (spec.type === "bool" && raw !== "true" && raw !== "false") { return `${JSON.stringify(raw)} is not true or false`; }
    if (spec.type === "numeric" && !Number.isFinite(Number(raw.trim()))) { return `${JSON.stringify(raw)} is not a number`; }
    if (Array.isArray(spec.options) && !spec.options.includes(raw)) {
        return `${JSON.stringify(raw)} is not one of ${spec.options.join(" | ")}`;
    }
    return undefined;
}

/** A stored value → its effective form, or why it is invalid. Dynamic options aren't checked on read. */
function parse_stored(spec: SettingSpec, raw: unknown, scope: Scope, files: SettingsFiles): Value | { problem: string } {
    if (spec.type === "path_list") {
        if (!Array.isArray(raw) || !raw.every(entry => typeof entry === "string")) { return { problem: "must be an array of strings" }; }
        const resolved: string[] = [];
        for (const entry of raw as string[]) {
            if (entry === "") { return { problem: "must not have an empty entry" }; }
            const value = resolve_stored_path(entry, scope, files);
            if (typeof value !== "string") { return value; }
            resolved.push(value);
        }
        return resolved;
    }
    if (typeof raw !== "string") { return { problem: "must be a string" }; }
    const problem = check_scalar(spec, raw);
    if (problem !== undefined) { return { problem }; }
    return spec.type === "path" ? resolve_stored_path(raw, scope, files) : raw;
}

function read_layer(scope: Scope, files: SettingsFiles, specs: readonly SettingSpec[], errors: ConfigError[]): Layer {
    const file = scope === "local" ? files.local : files.global;
    const shown = display_path(file, files.home);
    const layer: Layer = { scope, file, table: {}, values: new Map() };

    let text: string;
    try {
        text = fs.readFileSync(file, "utf8");
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") { return layer; }
        layer.unreadable = `${shown}: ${error instanceof Error ? error.message : String(error)}`;
        errors.push({ field: CONFIG_FILE, kind: "invalid", message: layer.unreadable });
        return layer;
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch (error) {
        layer.unreadable = `${shown}: not JSON (${error instanceof Error ? error.message : String(error)})`;
    }
    if (layer.unreadable === undefined && (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))) {
        layer.unreadable = `${shown}: not a JSON object`;
    }
    if (layer.unreadable !== undefined) {
        errors.push({ field: CONFIG_FILE, kind: "invalid", message: layer.unreadable, hint: `Fix or remove ${shown}.` });
        return layer;
    }

    layer.table = parsed as Record<string, unknown>;
    for (const [key, raw] of Object.entries(layer.table)) {
        const spec = specs.find(candidate => candidate.key === key);
        if (spec === undefined) {
            // The global file is shared by every backend: another one's keys are kept and ignored.
            if (scope === "local") {
                errors.push({
                    field: key,
                    kind: "unknown",
                    message: `${shown}: unknown key ${key}`,
                    hint: `Remove unknown keys from ${shown}; valid keys are ${specs.map(s => s.key).join(", ")}.`,
                });
            }
            continue;
        }
        const value = parse_stored(spec, raw, scope, files);
        if (typeof value === "string" || Array.isArray(value)) {
            layer.values.set(key, value);
        } else {
            errors.push({ field: key, kind: "invalid", message: `${shown}: ${key}: ${(value as { problem: string }).problem}`, description: spec.description, hint: spec.hint });
        }
    }
    return layer;
}

// =====================================================================================
// The store
// =====================================================================================

export interface SettingsStore extends SettingsView {
    readonly files: SettingsFiles;
    readonly specs: readonly SettingSpec[];
    /** What the last read of the files found wrong. Empty when both files are valid. */
    readonly errors: readonly ConfigError[];
}

export interface OpenSettingsOptions {
    files: SettingsFiles;
    /** Every key the local file may have: the front end's (`backend_setting`) and the active backend's. */
    specs: readonly SettingSpec[];
    /**
     * `ignore`: a local key not in `specs` is no error (reading `backend` before the backend,
     * and so its keys, is known). Default `error`.
     */
    unknown_local?: "error" | "ignore";
    hooks?: SettingsHooks;
    /** The session the hooks get. Needed only when a hook runs. */
    session?: () => Session;
}

/** Read both files into a store. Never throws on what the files hold: see `errors`. */
export function open_settings(options: OpenSettingsOptions): SettingsStore {
    const { files, specs, hooks } = options;
    let errors: ConfigError[] = [];
    const layers: Record<Scope, Layer> = {} as Record<Scope, Layer>;

    const reload = (): void => {
        const found: ConfigError[] = [];
        layers.local = read_layer("local", files, specs, found);
        layers.global = read_layer("global", files, specs, found);
        errors = options.unknown_local === "ignore" ? found.filter(error => error.kind !== "unknown") : found;
    };
    reload();

    const spec_of = (key: string): SettingSpec | undefined => specs.find(spec => spec.key === key);
    const session = (): Session => {
        if (options.session === undefined) { throw new Error("settings hooks need a session"); }
        return options.session();
    };

    const effective = (key: string): Value | undefined => layers.local.values.get(key) ?? layers.global.values.get(key);

    /** Write `patch` into the scope's file; an `undefined` value removes the key. */
    const write = (scope: Scope, patch: Readonly<Record<string, Value | undefined>>): SettingWrite => {
        const layer = layers[scope];
        if (layer.unreadable !== undefined) { return { ok: false, message: layer.unreadable }; }
        const merged: Record<string, unknown> = { ...layer.table };
        for (const [key, value] of Object.entries(patch)) {
            if (value === undefined) { delete merged[key]; } else { merged[key] = value; }
        }
        // Declared keys in spec order, then the rest as they were, so the next read still reports them.
        const ordered: Record<string, unknown> = {};
        for (const spec of specs) {
            if (merged[spec.key] !== undefined) { ordered[spec.key] = merged[spec.key]; }
        }
        for (const [key, value] of Object.entries(merged)) {
            if (!(key in ordered)) { ordered[key] = value; }
        }
        try {
            fs.mkdirSync(path.dirname(layer.file), { recursive: true });
            fs.writeFileSync(layer.file, `${JSON.stringify(ordered, undefined, 2)}\n`);
        } catch (error) {
            return { ok: false, message: `${display_path(layer.file, files.home)}: ${error instanceof Error ? error.message : String(error)}` };
        }
        reload();
        return { ok: true, file: layer.file };
    };

    /** A path as typed → what is stored, or why it is refused. A local relative path is the cwd's, stored absolute. */
    const stored_path = (raw: string, scope: Scope, spec: SettingSpec): string | { problem: string } => {
        if (raw === "") { return { problem: "must not be empty" }; }
        let absolute: string;
        if (is_tilde(raw)) {
            absolute = expand_tilde(raw, files.home);
        } else if (path.isAbsolute(raw)) {
            absolute = path.normalize(raw);
        } else if (scope === "global") {
            return { problem: `${JSON.stringify(raw)} is relative; a global path must be absolute or start with ~` };
        } else {
            absolute = path.resolve(files.cwd, raw);
        }
        if (spec.must_exist === true && !fs.existsSync(absolute)) { return { problem: `${absolute} does not exist` }; }
        // `~` is kept as typed, so a global file stays valid for another home.
        return is_tilde(raw) ? raw : absolute;
    };

    /** The static checks of a value for `spec`; `dynamic` asks the hook. */
    const check_value = async (spec: SettingSpec, value: Value, scope: Scope): Promise<Value | { problem: string }> => {
        if (spec.type === "path_list") {
            if (typeof value === "string") { return { problem: "takes a list of paths" }; }
            const stored: string[] = [];
            for (const entry of value) {
                const result = stored_path(entry, scope, spec);
                if (typeof result !== "string") { return result; }
                stored.push(result);
            }
            return stored;
        }
        if (typeof value !== "string") { return { problem: "takes one value" }; }
        const problem = check_scalar(spec, value);
        if (problem !== undefined) { return { problem }; }
        if (spec.options === "dynamic") {
            const allowed = hooks?.options === undefined ? undefined : await hooks.options(spec.key, session());
            if (allowed !== undefined && !allowed.includes(value)) {
                return { problem: `${JSON.stringify(value)} is not one of ${allowed.join(" | ")}` };
            }
        }
        return spec.type === "path" ? stored_path(value, scope, spec) : value;
    };

    const set = async (key: string, value: Value, scope: Scope = "local"): Promise<SettingWrite> => {
        const spec = spec_of(key);
        if (spec === undefined) { return { ok: false, message: `Unknown setting ${key}; valid keys are ${specs.map(s => s.key).join(", ")}.` }; }
        const checked = await check_value(spec, value, scope);
        if (typeof checked !== "string" && !Array.isArray(checked)) { return { ok: false, message: `${key}: ${(checked as { problem: string }).problem}` }; }

        const patch: Record<string, Value | undefined> = { [key]: checked };
        if (hooks?.check !== undefined) {
            // The hook takes one string: a list is passed as its JSON text.
            const verdict = await hooks.check(key, typeof checked === "string" ? checked : JSON.stringify(checked), session(), scope);
            if (!verdict.ok) { return { ok: false, message: verdict.message }; }
            for (const [also_key, also_value] of Object.entries(verdict.also ?? {})) {
                const also_spec = spec_of(also_key);
                if (also_spec === undefined) { throw new Error(`settings check for ${key} sets the unknown setting ${also_key}`); }
                if (also_value !== null) {
                    const problem = also_spec.type === "path_list" ? "takes a list of paths" : check_scalar(also_spec, also_value);
                    if (problem !== undefined) { throw new Error(`settings check for ${key} sets ${also_key}: ${problem}`); }
                }
                // `null` resets it.
                patch[also_key] = also_value === null ? undefined : also_value;
            }
        }
        return write(scope, patch);
    };

    return {
        files,
        specs,
        get errors() { return errors; },
        get(key) {
            const spec = spec_of(key);
            if (spec === undefined || spec.type === "path_list") { return; }
            const value = effective(key);
            if (typeof value === "string") { return value; }
            if (spec.default === undefined) { return; }
            if (spec.type !== "path") { return spec.default; }
            const resolved = resolve_stored_path(spec.default, "local", files);
            return typeof resolved === "string" ? resolved : undefined;
        },
        paths(key) {
            if (spec_of(key)?.type !== "path_list") { return; }
            const value = effective(key);
            return Array.isArray(value) ? value : undefined;
        },
        origin(key) {
            const spec = spec_of(key);
            if (spec === undefined) { return "unset"; }
            for (const scope of ["local", "global"] as const) {
                if (layers[scope].values.has(key)) { return { scope, file: layers[scope].file }; }
            }
            return spec.default === undefined || spec.type === "path_list" ? "unset" : "default";
        },
        set,
        reset(key, scope = "local") {
            if (spec_of(key) === undefined) { return Promise.resolve({ ok: false, message: `Unknown setting ${key}; valid keys are ${specs.map(s => s.key).join(", ")}.` }); }
            const layer = layers[scope];
            // Nothing to remove: no file is created for it.
            if (layer.unreadable === undefined && !(key in layer.table)) { return Promise.resolve({ ok: true, file: layer.file }); }
            return Promise.resolve(write(scope, { [key]: undefined }));
        },
    };
}

if (import.meta.vitest) {
    const { test, expect, describe, beforeEach, afterEach } = import.meta.vitest;

    let base: string;
    let home: string;
    let project: string;
    beforeEach(() => {
        base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "aa-settings-")));
        home = path.join(base, "home");
        project = path.join(home, "work", "project");
        fs.mkdirSync(project, { recursive: true });
    });
    afterEach(() => { fs.rmSync(base, { recursive: true, force: true }); });

    const SPECS: readonly SettingSpec[] = [
        backend_setting(["fake", "other"]),
        { key: "tree", category: "Sources", description: "A tree", type: "path", required: true, must_exist: true, hint: "Set tree." },
        { key: "modules", category: "Sources", description: "Modules", type: "path_list", required: false },
        { key: "syntax", category: "Output", description: "Syntax", type: "string", options: ["a", "b"], required: false, default: "a" },
        { key: "board", category: "Target", description: "Board", type: "string", options: "dynamic", required: false },
        { key: "chip", category: "Target", description: "Chip", type: "string", required: false },
        { key: "verbose", category: "Output", description: "Verbose", type: "bool", required: false, default: "false" },
        { key: "jobs", category: "Output", description: "Jobs", type: "numeric", required: false },
        { key: "workfile", category: "Workfile", description: "Workfile", type: "path", required: false, default: "workfile.json" },
    ];

    const write_json = (file: string, value: unknown): void => {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
    };
    const read_json = (file: string): unknown => JSON.parse(fs.readFileSync(file, "utf8"));
    const files_at = (cwd = project): SettingsFiles => settings_files({ cwd, home, xdg_config_home: path.join(home, ".config") });
    const open = (cwd = project, extra: Partial<OpenSettingsOptions> = {}): SettingsStore => open_settings({ files: files_at(cwd), specs: SPECS, ...extra });

    describe("find_project_root", () => {
        test("the nearest ancestor with .analog-attach/, the cwd included", () => {
            const nested = path.join(project, "a", "b");
            fs.mkdirSync(nested, { recursive: true });
            expect(find_project_root(nested, home)).toBe(nested);
            fs.mkdirSync(path.join(project, CONFIG_DIRECTORY));
            expect(find_project_root(nested, home)).toBe(project);
            expect(find_project_root(project, home)).toBe(project);
            fs.mkdirSync(path.join(nested, CONFIG_DIRECTORY));
            expect(find_project_root(nested, home)).toBe(nested);
        });

        test("a .analog-attach/ file is not a project; home is checked only as the cwd", () => {
            fs.writeFileSync(path.join(path.dirname(project), CONFIG_DIRECTORY), "");
            expect(find_project_root(project, home)).toBe(project);
            fs.mkdirSync(path.join(home, CONFIG_DIRECTORY));
            expect(find_project_root(project, home)).toBe(project);
            expect(find_project_root(home, home)).toBe(home);
        });

        test("outside home the walk stops below the filesystem root", () => {
            const outside = path.join(base, "elsewhere", "deep");
            fs.mkdirSync(outside, { recursive: true });
            expect(find_project_root(outside, home)).toBe(outside);
            fs.mkdirSync(path.join(base, CONFIG_DIRECTORY));
            expect(find_project_root(outside, home)).toBe(base);
        });
    });

    test("settings_files - the global file follows XDG_CONFIG_HOME, else ~/.config", () => {
        expect(settings_files({ cwd: project, home, xdg_config_home: "/xdg" }).global).toBe("/xdg/analog-attach/config.json");
        expect(settings_files({ cwd: project, home }).global).toBe(path.join(home, ".config", "analog-attach", "config.json"));
        expect(settings_files({ cwd: project, home, xdg_config_home: "rel" }).global).toBe(path.join(home, ".config", "analog-attach", "config.json"));
        expect(settings_files({ cwd: project, home }).local).toBe(path.join(project, ".analog-attach", "config.json"));
    });

    test("layering - local wins over global, then the default", () => {
        const files = files_at();
        write_json(files.global, { syntax: "b", chip: "g" });
        write_json(files.local, { chip: "l" });
        const store = open();
        expect(store.errors).toEqual([]);
        expect(store.get("chip")).toBe("l");
        expect(store.origin("chip")).toEqual({ scope: "local", file: files.local });
        expect(store.get("syntax")).toBe("b");
        expect(store.origin("syntax")).toEqual({ scope: "global", file: files.global });
        expect(store.get("verbose")).toBe("false");
        expect(store.origin("verbose")).toBe("default");
        expect(store.get("jobs")).toBeUndefined();
        expect(store.origin("jobs")).toBe("unset");
        expect(store.get("nope")).toBeUndefined();
    });

    test("strict parse - a file that isn't a JSON object names the file, and is never written over", async () => {
        const files = files_at();
        write_json(files.local, "{ not json");
        write_json(files.global, "[1]");
        const store = open();
        expect(store.errors.map(error => error.message)).toEqual([
            expect.stringMatching(/^~\/work\/project\/\.analog-attach\/config\.json: not JSON/),
            "~/.config/analog-attach/config.json: not a JSON object",
        ]);
        const write = await store.set("chip", "x");
        expect(write.ok).toBe(false);
        expect(fs.readFileSync(files.local, "utf8")).toBe("{ not json");
    });

    test("strict parse - bad value types and options are errors, and the value isn't effective", () => {
        const files = files_at();
        write_json(files.local, { chip: 5, syntax: "c", verbose: "yes", jobs: "x", modules: "a:b", workfile: "" });
        const store = open();
        expect(store.errors.map(error => [error.field, error.kind])).toEqual([
            ["chip", "invalid"], ["syntax", "invalid"], ["verbose", "invalid"], ["jobs", "invalid"], ["modules", "invalid"], ["workfile", "invalid"],
        ]);
        expect(store.errors[1]!.message).toBe("~/work/project/.analog-attach/config.json: syntax: \"c\" is not one of a | b");
        expect(store.get("syntax")).toBe("a");
        expect(store.origin("syntax")).toBe("default");
    });

    test("strict parse - a local unknown key is an error; a global one is ignored and kept on save", async () => {
        const files = files_at();
        write_json(files.local, { "other-key": "x" });
        write_json(files.global, { "noos-key": "y", chip: "g" });
        const store = open();
        expect(store.errors).toHaveLength(1);
        expect(store.errors[0]).toMatchObject({ field: "other-key", kind: "unknown" });
        expect(store.errors[0]!.message).toBe("~/work/project/.analog-attach/config.json: unknown key other-key");
        expect(open(project, { unknown_local: "ignore" }).errors).toEqual([]);

        expect(await store.set("syntax", "b", "global")).toMatchObject({ ok: true });
        expect(Object.keys(read_json(files.global) as object)).toEqual(["syntax", "chip", "noos-key"]);
        // The local file keeps its unknown key too, so the next read still reports it.
        expect(await store.set("chip", "l")).toMatchObject({ ok: true });
        expect(read_json(files.local)).toEqual({ chip: "l", "other-key": "x" });
        expect(store.errors).toHaveLength(1);
    });

    test("save - keys are written in spec order", async () => {
        const store = open();
        await store.set("jobs", "4");
        await store.set("chip", "c");
        await store.set(BACKEND_KEY, "fake");
        expect(fs.readFileSync(store.files.local, "utf8")).toBe(`{\n  "backend": "fake",\n  "chip": "c",\n  "jobs": "4"\n}\n`);
    });

    describe("paths", () => {
        test("a local relative path resolves against the project root, ~ against home", () => {
            const files = files_at();
            write_json(files.local, { tree: "../tree", workfile: "~/w.json", modules: ["m1", "/abs/m2", "~"] });
            const nested = path.join(project, "sub");
            fs.mkdirSync(nested);
            const store = open(nested);
            expect(store.files.project_root).toBe(project);
            expect(store.get("tree")).toBe(path.join(home, "work", "tree"));
            expect(store.get("workfile")).toBe(path.join(home, "w.json"));
            expect(store.paths("modules")).toEqual([path.join(project, "m1"), "/abs/m2", home]);
            expect(store.get("modules")).toBeUndefined();
            expect(store.paths("tree")).toBeUndefined();
        });

        test("a relative default resolves against the project root", () => {
            expect(open().get("workfile")).toBe(path.join(project, "workfile.json"));
        });

        test("a global relative path is an error on read, and refused on write", async () => {
            const files = files_at();
            write_json(files.global, { workfile: "w.json", modules: ["/ok", "rel"] });
            const store = open();
            expect(store.errors.map(error => error.field)).toEqual(["workfile", "modules"]);
            expect(store.errors[0]!.message).toContain("a global path must be absolute or start with ~");
            expect(store.get("workfile")).toBe(path.join(project, "workfile.json"));

            const refused = await store.set("workfile", "x.json", "global");
            expect(refused).toEqual({ ok: false, message: "workfile: \"x.json\" is relative; a global path must be absolute or start with ~" });
            expect(await store.set("workfile", "~/x.json", "global")).toMatchObject({ ok: true });
            expect((read_json(files.global) as Record<string, unknown>)["workfile"]).toBe("~/x.json");
        });

        test("set - a local relative path is the cwd's, stored absolute; must_exist is checked", async () => {
            const nested = path.join(project, "sub");
            fs.mkdirSync(path.join(nested, "t"), { recursive: true });
            fs.mkdirSync(path.join(project, CONFIG_DIRECTORY));
            const store = open(nested);
            expect(await store.set("tree", "missing")).toEqual({ ok: false, message: `tree: ${path.join(nested, "missing")} does not exist` });
            expect(await store.set("tree", "t")).toEqual({ ok: true, file: path.join(project, CONFIG_DIRECTORY, CONFIG_FILE) });
            expect(store.get("tree")).toBe(path.join(nested, "t"));
            expect(await store.set("modules", "one")).toEqual({ ok: false, message: "modules: takes a list of paths" });
            expect(await store.set("modules", ["a", "~/b"])).toMatchObject({ ok: true });
            expect(store.paths("modules")).toEqual([path.join(nested, "a"), path.join(home, "b")]);
        });
    });

    test("set - checks type and options", async () => {
        const store = open();
        expect(await store.set("syntax", "c")).toEqual({ ok: false, message: "syntax: \"c\" is not one of a | b" });
        expect(await store.set("verbose", "1")).toEqual({ ok: false, message: "verbose: \"1\" is not true or false" });
        expect(await store.set("jobs", "many")).toEqual({ ok: false, message: "jobs: \"many\" is not a number" });
        expect(await store.set("chip", ["a"])).toEqual({ ok: false, message: "chip: takes one value" });
        expect(await store.set("nope", "x")).toMatchObject({ ok: false });
        expect(fs.existsSync(store.files.local)).toBe(false);
    });

    test("set - creates .analog-attach/ at the project root, which then is the project", async () => {
        const store = open();
        const write = await store.set("chip", "c");
        expect(write).toEqual({ ok: true, file: path.join(project, CONFIG_DIRECTORY, CONFIG_FILE) });
        expect(find_project_root(path.join(project), home)).toBe(project);
    });

    test("set - dynamic options and the check hook's also, in one save", async () => {
        const calls: string[] = [];
        const hooks: SettingsHooks = {
            options: (key) => { calls.push(`options ${key}`); return Promise.resolve(["b1", "b2"]); },
            check: (key, value) => {
                calls.push(`check ${key}=${value}`);
                // eslint-disable-next-line unicorn/no-null -- `also` resets a setting with null
                if (key === "board") { return Promise.resolve({ ok: true, also: value === "b1" ? { chip: "c1" } : { chip: null } }); }
                if (key === "chip" && value === "bad") { return Promise.resolve({ ok: false, message: "bad chip" }); }
                return Promise.resolve({ ok: true });
            },
        };
        const store = open(project, { hooks, session: () => ({}) as Session });
        expect(await store.set("board", "b3")).toEqual({ ok: false, message: "board: \"b3\" is not one of b1 | b2" });
        expect(await store.set("chip", "bad")).toEqual({ ok: false, message: "bad chip" });
        expect(await store.set("board", "b1")).toMatchObject({ ok: true });
        expect(read_json(store.files.local)).toEqual({ board: "b1", chip: "c1" });
        expect(await store.set("board", "b2")).toMatchObject({ ok: true });
        expect(read_json(store.files.local)).toEqual({ board: "b2" });
        expect(store.get("chip")).toBeUndefined();
        expect(calls).toEqual(["options board", "check chip=bad", "options board", "check board=b1", "options board", "check board=b2"]);
    });

    test("reset - removes the key from one scope, keeps the others; no file is created", async () => {
        const files = files_at();
        const store = open();
        expect(await store.reset("chip")).toEqual({ ok: true, file: files.local });
        expect(fs.existsSync(files.local)).toBe(false);

        write_json(files.global, { chip: "g", "noos-key": 1 });
        write_json(files.local, { chip: "l", syntax: "b" });
        const loaded = open();
        expect(await loaded.reset("chip")).toMatchObject({ ok: true });
        expect(read_json(files.local)).toEqual({ syntax: "b" });
        expect(loaded.get("chip")).toBe("g");
        expect(await loaded.reset("chip", "global")).toMatchObject({ ok: true });
        expect(read_json(files.global)).toEqual({ "noos-key": 1 });
        expect(loaded.origin("chip")).toBe("unset");
    });
}
