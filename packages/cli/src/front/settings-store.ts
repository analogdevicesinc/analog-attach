// The settings files behind `SettingsView`: a project-local `.analog-attach/config.json`
// and a global `$XDG_CONFIG_HOME/analog-attach/config.json`. Local wins over global, then
// the `SettingSpec` default. Each file is one JSON object: the front end's `backend` at the
// top level, and each backend's settings in an object named after its id (its section):
//
//   { "backend": "linux", "linux": { "devicetree": "…", "workfile": "overlay.dtso" }, "noos": { … } }
//
// Only the active backend's section is read, and the files layer section by section. The
// other sections are kept as they are. Keys are kebab-case; the values are strings, except
// a `path_list`, which is an array of strings.
//
// The parse is strict, as attach-cli's `parse_settings` was: a file that isn't a JSON object,
// a section that isn't an object, a value of the wrong type or outside its options, and (in
// the local file) a key that is neither the top level's nor the active backend's are errors.
// Errors are values: a store always opens, carries its errors, and leaves an invalid value
// out of the effective ones, so `config` can still fix the file. A file that isn't a JSON
// object is never written over, nor a section that isn't one written into.

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

/** The active backend: its id names its section, its specs are the keys there. */
export interface ActiveSection {
    id: string;
    specs: readonly SettingSpec[];
}

/** What a file may hold: the top level's keys, the sections, and which section is read. */
interface Shape {
    top: readonly SettingSpec[];
    /** Every registered backend's id, the active one included. */
    sections: readonly string[];
    active?: ActiveSection;
}

interface Layer {
    scope: Scope;
    file: string;
    /** The whole object as on disk, unknown keys and the other sections included, so a save keeps them. */
    table: Record<string, unknown>;
    /** The valid values of declared keys (the top level's and the active section's), paths resolved. */
    values: Map<string, Value>;
    /** Why the file can't be read or written over: not JSON, or not an object. */
    unreadable?: string;
    /** Why the active section can't be written into: it isn't an object. */
    bad_section?: string;
}

function is_object(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `valid top-level keys are backend and the backends' sections linux, noos, …`, for hints. */
function valid_top_keys(shape: Shape): string {
    const keys = shape.top.map(spec => spec.key);
    if (shape.sections.length === 0) { return `valid top-level keys are ${keys.length === 0 ? "none" : keys.join(", ")}`; }
    const sections = `the backends' sections ${shape.sections.join(", ")}, each an object of that backend's settings`;
    return `valid top-level keys are ${keys.length === 0 ? sections : `${keys.join(", ")} and ${sections}`}`;
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

/**
 * One file. The top level has the front end's keys and one object per registered backend
 * (its section). Only the active section is read; the others are kept as they are. An
 * unknown key, at the top level or in the active section, is an error in the local file
 * only: the global one is shared by every project, and its unknown keys are kept and
 * ignored. A wrong type is an error in either file, a section that isn't an object too.
 */
function read_layer(scope: Scope, files: SettingsFiles, shape: Shape, errors: ConfigError[]): Layer {
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
    if (layer.unreadable === undefined && !is_object(parsed)) {
        layer.unreadable = `${shown}: not a JSON object`;
    }
    if (layer.unreadable !== undefined) {
        errors.push({ field: CONFIG_FILE, kind: "invalid", message: layer.unreadable, hint: `Fix or remove ${shown}.` });
        return layer;
    }

    /** A declared key's value, `name` being how messages write it (`linux.devicetree` in a section). */
    const read_value = (spec: SettingSpec, name: string, raw: unknown): void => {
        const value = parse_stored(spec, raw, scope, files);
        if (typeof value === "string" || Array.isArray(value)) {
            layer.values.set(spec.key, value);
        } else {
            errors.push({ field: name, kind: "invalid", message: `${shown}: ${name}: ${(value as { problem: string }).problem}`, description: spec.description, hint: spec.hint });
        }
    };

    layer.table = parsed as Record<string, unknown>;
    for (const [key, raw] of Object.entries(layer.table)) {
        if (shape.sections.includes(key)) {
            if (!is_object(raw)) {
                const message = `${shown}: ${key}: must be an object`;
                if (key === shape.active?.id) { layer.bad_section = message; }
                errors.push({ field: key, kind: "invalid", message, hint: `Make ${key} an object in ${shown}; ${valid_top_keys(shape)}.` });
            }
            continue;
        }
        const spec = shape.top.find(candidate => candidate.key === key);
        if (spec !== undefined) {
            read_value(spec, key, raw);
        } else if (scope === "local") {
            errors.push({ field: key, kind: "unknown", message: `${shown}: unknown key ${key}`, hint: `Remove unknown keys from ${shown}; ${valid_top_keys(shape)}.` });
        }
    }

    const { active } = shape;
    const section = active === undefined ? undefined : layer.table[active.id];
    if (active !== undefined && is_object(section)) {
        for (const [key, raw] of Object.entries(section)) {
            const name = `${active.id}.${key}`;
            const spec = active.specs.find(candidate => candidate.key === key);
            if (spec !== undefined) {
                read_value(spec, name, raw);
            } else if (scope === "local") {
                errors.push({
                    field: name,
                    kind: "unknown",
                    message: `${shown}: unknown key ${name}`,
                    hint: `Remove unknown keys from ${shown}; valid keys in ${active.id} are ${active.specs.map(s => s.key).join(", ")}.`,
                });
            }
        }
    }
    return layer;
}

/** `table`'s keys in `order` first, then the rest as they were. */
function ordered(table: Readonly<Record<string, unknown>>, order: readonly string[]): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const key of order) {
        if (table[key] !== undefined) { result[key] = table[key]; }
    }
    for (const [key, value] of Object.entries(table)) {
        if (!(key in result)) { result[key] = value; }
    }
    return result;
}

// =====================================================================================
// The store
// =====================================================================================

export interface SettingsStore extends SettingsView {
    readonly files: SettingsFiles;
    /** Every key the store knows: the top level's, then the active section's. */
    readonly specs: readonly SettingSpec[];
    /** The active section's id, undefined when no backend is active. */
    readonly section: string | undefined;
    /** What the last read of the files found wrong. Empty when both files are valid. */
    readonly errors: readonly ConfigError[];
}

export interface OpenSettingsOptions {
    files: SettingsFiles;
    /** The top level's keys: the front end's own (`backend_setting`). */
    top?: readonly SettingSpec[];
    /** The registered backends' ids: the top level may have a section, an object, for each. */
    sections?: readonly string[];
    /** The active backend, whose section the store reads and writes. Unset: no section is active. */
    active?: ActiveSection;
    hooks?: SettingsHooks;
    /** The session the hooks get. Needed only when a hook runs. */
    session?: () => Session;
}

/** Read both files into a store. Never throws on what the files hold: see `errors`. */
export function open_settings(options: OpenSettingsOptions): SettingsStore {
    const { files, hooks, active } = options;
    const top = options.top ?? [];
    const sections = [...options.sections ?? []];
    if (active !== undefined && !sections.includes(active.id)) { sections.push(active.id); }
    const shape: Shape = { top, sections, ...(active === undefined ? {} : { active }) };
    const specs: readonly SettingSpec[] = [...top, ...active?.specs ?? []];

    let errors: ConfigError[] = [];
    const layers: Record<Scope, Layer> = {} as Record<Scope, Layer>;

    const reload = (): void => {
        errors = [];
        layers.local = read_layer("local", files, shape, errors);
        layers.global = read_layer("global", files, shape, errors);
    };
    reload();

    const spec_of = (key: string): SettingSpec | undefined => specs.find(spec => spec.key === key);
    /** Where a declared key is stored. */
    const in_section = (key: string): boolean => !top.some(spec => spec.key === key);
    const session = (): Session => {
        if (options.session === undefined) { throw new Error("settings hooks need a session"); }
        return options.session();
    };

    const effective = (key: string): Value | undefined => layers.local.values.get(key) ?? layers.global.values.get(key);

    /** Write `patch` into the scope's file; an `undefined` value removes the key. Section keys go in the active section. */
    const write = (scope: Scope, patch: Readonly<Record<string, Value | undefined>>): SettingWrite => {
        const layer = layers[scope];
        if (layer.unreadable !== undefined) { return { ok: false, message: layer.unreadable }; }
        const table: Record<string, unknown> = { ...layer.table };
        const apply = (target: Record<string, unknown>, key: string, value: Value | undefined): void => {
            if (value === undefined) { delete target[key]; } else { target[key] = value; }
        };
        const section_patch = Object.entries(patch).filter(([key]) => in_section(key));
        if (section_patch.length > 0) {
            if (active === undefined) { throw new Error(`no backend is active to write ${section_patch.map(([key]) => key).join(", ")}`); }
            if (layer.bad_section !== undefined) { return { ok: false, message: layer.bad_section }; }
            const current = layer.table[active.id];
            const section: Record<string, unknown> = { ...is_object(current) ? current : {} };
            for (const [key, value] of section_patch) { apply(section, key, value); }
            // The section's declared keys in spec order, then the rest as they were, so the next read still reports them.
            const written = ordered(section, active.specs.map(spec => spec.key));
            if (Object.keys(written).length === 0) { delete table[active.id]; } else { table[active.id] = written; }
        }
        for (const [key, value] of Object.entries(patch)) {
            if (!in_section(key)) { apply(table, key, value); }
        }
        // The top level's keys, then the sections in registry order, then the rest as they were.
        const text = JSON.stringify(ordered(table, [...top.map(spec => spec.key), ...sections]), undefined, 2);
        try {
            fs.mkdirSync(path.dirname(layer.file), { recursive: true });
            fs.writeFileSync(layer.file, `${text}\n`);
        } catch (error) {
            return { ok: false, message: `${display_path(layer.file, files.home)}: ${error instanceof Error ? error.message : String(error)}` };
        }
        reload();
        return { ok: true, file: layer.file };
    };

    /** Whether the scope's file holds `key` where the store reads it. */
    const stored_in = (layer: Layer, key: string): boolean => {
        if (!in_section(key)) { return key in layer.table; }
        const section = active === undefined ? undefined : layer.table[active.id];
        return is_object(section) && key in section;
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
            // None found is no list to check against (CONFIG-510): the backend's check says why.
            if (allowed !== undefined && allowed.length > 0 && !allowed.includes(value)) {
                return { problem: `${JSON.stringify(value)} is not one of ${allowed.join(" | ")}` };
            }
        }
        return spec.type === "path" ? stored_path(value, scope, spec) : value;
    };

    const unknown_setting = (key: string): SettingWrite => ({ ok: false, message: `Unknown setting ${key}; valid keys are ${specs.map(s => s.key).join(", ")}.` });

    const set = async (key: string, value: Value, scope: Scope = "local"): Promise<SettingWrite> => {
        const spec = spec_of(key);
        if (spec === undefined) { return unknown_setting(key); }
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
        section: active?.id,
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
            if (spec_of(key) === undefined) { return Promise.resolve(unknown_setting(key)); }
            const layer = layers[scope];
            // Nothing to remove: no file is created for it.
            const blocked = layer.unreadable !== undefined || (in_section(key) && layer.bad_section !== undefined);
            if (!blocked && !stored_in(layer, key)) { return Promise.resolve({ ok: true, file: layer.file }); }
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

    const IDS = ["fake", "other"];
    const TOP: readonly SettingSpec[] = [backend_setting(IDS)];
    /** The `fake` section's keys. */
    const SPECS: readonly SettingSpec[] = [
        { key: "tree", category: "Sources", description: "A tree", type: "path", required: true, must_exist: true, hint: "Set tree." },
        { key: "modules", category: "Sources", description: "Modules", type: "path_list", required: false },
        { key: "syntax", category: "Output", description: "Syntax", type: "string", options: ["a", "b"], required: false, default: "a" },
        { key: "board", category: "Target", description: "Board", type: "string", options: "dynamic", required: false },
        { key: "chip", category: "Target", description: "Chip", type: "string", required: false },
        { key: "verbose", category: "Output", description: "Verbose", type: "bool", required: false, default: "false" },
        { key: "jobs", category: "Output", description: "Jobs", type: "numeric", required: false },
        { key: "workfile", category: "Workfile", description: "Workfile", type: "path", required: false, default: "workfile.json" },
    ];
    /** The `other` section's keys. */
    const OTHER: readonly SettingSpec[] = [
        { key: "workfile", category: "Workfile", description: "Other's workfile", type: "path", required: false },
        { key: "capi", category: "Sources", description: "Capi", type: "string", required: false },
    ];
    const LOCAL = "~/work/project/.analog-attach/config.json";
    const GLOBAL = "~/.config/analog-attach/config.json";

    const write_json = (file: string, value: unknown): void => {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
    };
    const read_json = (file: string): unknown => JSON.parse(fs.readFileSync(file, "utf8"));
    const files_at = (cwd = project): SettingsFiles => settings_files({ cwd, home, xdg_config_home: path.join(home, ".config") });
    const open = (cwd = project, extra: Partial<OpenSettingsOptions> = {}): SettingsStore =>
        open_settings({ files: files_at(cwd), top: TOP, sections: IDS, active: { id: "fake", specs: SPECS }, ...extra });
    const open_other = (): SettingsStore => open(project, { active: { id: "other", specs: OTHER } });

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

    describe("layering", () => {
        test("local wins over global, then the default, section by section", () => {
            const files = files_at();
            write_json(files.global, { backend: "other", fake: { syntax: "b", chip: "g" } });
            write_json(files.local, { backend: "fake", fake: { chip: "l" } });
            const store = open();
            expect(store.errors).toEqual([]);
            expect(store.section).toBe("fake");
            expect(store.get(BACKEND_KEY)).toBe("fake");
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

        test("a key of one section never stands in for the same key of another", () => {
            const files = files_at();
            write_json(files.global, { fake: { workfile: "~/g-fake.json" }, other: { workfile: "~/g-other.json" } });
            write_json(files.local, { other: { workfile: "l-other.json" } });
            const fake = open();
            expect(fake.get("workfile")).toBe(path.join(home, "g-fake.json"));
            expect(fake.origin("workfile")).toMatchObject({ scope: "global" });
            const other = open_other();
            expect(other.get("workfile")).toBe(path.join(project, "l-other.json"));
            expect(other.origin("workfile")).toMatchObject({ scope: "local" });
            // A section the local file lacks is the global's whole.
            write_json(files.local, {});
            expect(open().get("workfile")).toBe(path.join(home, "g-fake.json"));
        });

        test("the top level's keys aren't read in a section, nor a section's at the top level", () => {
            const files = files_at();
            write_json(files.local, { chip: "top", fake: { backend: "fake" } });
            const store = open();
            expect(store.get("chip")).toBeUndefined();
            expect(store.get(BACKEND_KEY)).toBeUndefined();
            expect(store.errors.map(error => error.message)).toEqual([`${LOCAL}: unknown key chip`, `${LOCAL}: unknown key fake.backend`]);
        });

        test("with no active backend, no section is read", () => {
            const files = files_at();
            write_json(files.local, { backend: "fake", fake: { chip: 5, bogus: "x" }, other: { anything: true } });
            const store = open(project, { active: undefined });
            expect(store.errors).toEqual([]);
            expect(store.section).toBeUndefined();
            expect(store.specs.map(spec => spec.key)).toEqual([BACKEND_KEY]);
            expect(store.get("chip")).toBeUndefined();
        });
    });

    describe("strict parse", () => {
        test("a file that isn't a JSON object names the file, and is never written over", async () => {
            const files = files_at();
            write_json(files.local, "{ not json");
            write_json(files.global, "[1]");
            const store = open();
            expect(store.errors.map(error => error.message)).toEqual([
                expect.stringMatching(/^~\/work\/project\/\.analog-attach\/config\.json: not JSON/),
                `${GLOBAL}: not a JSON object`,
            ]);
            const write = await store.set("chip", "x");
            expect(write.ok).toBe(false);
            expect(fs.readFileSync(files.local, "utf8")).toBe("{ not json");
        });

        test("bad value types and options are errors named with their section, and the value isn't effective", () => {
            const files = files_at();
            write_json(files.local, { backend: 5, fake: { chip: 5, syntax: "c", verbose: "yes", jobs: "x", modules: "a:b", workfile: "" } });
            const store = open();
            expect(store.errors.map(error => [error.field, error.kind])).toEqual([
                ["backend", "invalid"],
                ["fake.chip", "invalid"], ["fake.syntax", "invalid"], ["fake.verbose", "invalid"], ["fake.jobs", "invalid"], ["fake.modules", "invalid"], ["fake.workfile", "invalid"],
            ]);
            expect(store.errors[0]!.message).toBe(`${LOCAL}: backend: must be a string`);
            expect(store.errors[2]).toMatchObject({ message: `${LOCAL}: fake.syntax: "c" is not one of a | b`, description: "Syntax" });
            expect(store.get("syntax")).toBe("a");
            expect(store.origin("syntax")).toBe("default");
        });

        test("an unknown key in the active section is an error in the local file, named with its section; the global's is kept", async () => {
            const files = files_at();
            write_json(files.local, { fake: { "other-key": "x" } });
            write_json(files.global, { fake: { "noos-key": "y", chip: "g" } });
            const store = open();
            expect(store.errors).toEqual([{
                field: "fake.other-key",
                kind: "unknown",
                message: `${LOCAL}: unknown key fake.other-key`,
                hint: `Remove unknown keys from ${LOCAL}; valid keys in fake are tree, modules, syntax, board, chip, verbose, jobs, workfile.`,
            }]);

            expect(await store.set("syntax", "b", "global")).toMatchObject({ ok: true });
            expect(read_json(files.global)).toEqual({ fake: { syntax: "b", chip: "g", "noos-key": "y" } });
            expect(Object.keys((read_json(files.global) as { fake: object }).fake)).toEqual(["syntax", "chip", "noos-key"]);
            // The local file keeps its unknown key too, so the next read still reports it.
            expect(await store.set("chip", "l")).toMatchObject({ ok: true });
            expect(read_json(files.local)).toEqual({ fake: { chip: "l", "other-key": "x" } });
            expect(store.errors).toHaveLength(1);
        });

        test("an inactive section is neither read nor checked, and is kept as it is", async () => {
            const files = files_at();
            const other = { workfile: 5, "not-a-key": ["x"], capi: "" };
            write_json(files.local, { backend: "fake", other });
            const store = open();
            expect(store.errors).toEqual([]);
            expect(await store.set("chip", "c")).toMatchObject({ ok: true });
            expect(read_json(files.local)).toEqual({ backend: "fake", fake: { chip: "c" }, other });
            // Active, it is checked.
            expect(open_other().errors.map(error => error.message)).toEqual([
                `${LOCAL}: other.workfile: must be a string`,
                `${LOCAL}: unknown key other.not-a-key`,
                `${LOCAL}: other.capi: must not be empty`,
            ]);
        });

        test("an unknown top-level key is an error in the local file; the global's is kept and ignored", async () => {
            const files = files_at();
            write_json(files.local, { backend: "fake", zephyr: {} });
            write_json(files.global, { color: "blue" });
            const store = open();
            expect(store.errors).toEqual([{
                field: "zephyr",
                kind: "unknown",
                message: `${LOCAL}: unknown key zephyr`,
                hint: `Remove unknown keys from ${LOCAL}; valid top-level keys are backend and the backends' sections fake, other, each an object of that backend's settings.`,
            }]);
            expect(await store.set("chip", "g", "global")).toMatchObject({ ok: true });
            expect(read_json(files.global)).toEqual({ fake: { chip: "g" }, color: "blue" });
        });

        test("a section that isn't an object is an error in either file, active or not; the active one is never written into", async () => {
            const files = files_at();
            write_json(files.local, { backend: "fake", fake: "~/tree", other: ["x"] });
            write_json(files.global, { fake: [] });
            const store = open();
            expect(store.errors.map(error => [error.field, error.kind, error.message])).toEqual([
                ["fake", "invalid", `${LOCAL}: fake: must be an object`],
                ["other", "invalid", `${LOCAL}: other: must be an object`],
                ["fake", "invalid", `${GLOBAL}: fake: must be an object`],
            ]);
            expect(store.errors[0]!.hint).toBe(`Make fake an object in ${LOCAL}; valid top-level keys are backend and the backends' sections fake, other, each an object of that backend's settings.`);
            expect(await store.set("chip", "c")).toEqual({ ok: false, message: `${LOCAL}: fake: must be an object` });
            expect(await store.reset("chip")).toEqual({ ok: false, message: `${LOCAL}: fake: must be an object` });
            // The top level can still be written.
            expect(await store.set(BACKEND_KEY, "other")).toMatchObject({ ok: true });
            expect(read_json(files.local)).toEqual({ backend: "other", fake: "~/tree", other: ["x"] });
        });

        test("an old flat file fails with its keys at the top level", () => {
            const files = files_at();
            write_json(files.local, { backend: "fake", tree: "/t", chip: "c", syntax: "b" });
            const store = open();
            expect(store.errors.map(error => [error.field, error.kind, error.message])).toEqual([
                ["tree", "unknown", `${LOCAL}: unknown key tree`],
                ["chip", "unknown", `${LOCAL}: unknown key chip`],
                ["syntax", "unknown", `${LOCAL}: unknown key syntax`],
            ]);
            expect(store.get("chip")).toBeUndefined();
            expect(store.get(BACKEND_KEY)).toBe("fake");
        });
    });

    describe("save", () => {
        test("the top level's keys, then the sections in registry order, each section's keys in spec order", async () => {
            const files = files_at();
            write_json(files.local, { zeta: 1, other: { capi: "c" } });
            const store = open();
            await store.set("jobs", "4");
            await store.set("chip", "c");
            await store.set(BACKEND_KEY, "fake");
            expect(fs.readFileSync(store.files.local, "utf8")).toBe(
                `{\n  "backend": "fake",\n  "fake": {\n    "chip": "c",\n    "jobs": "4"\n  },\n  "other": {\n    "capi": "c"\n  },\n  "zeta": 1\n}\n`,
            );
        });

        test("switching the backend keeps both sections, and each store sees only its own", async () => {
            const files = files_at();
            fs.mkdirSync(path.join(project, "t"));
            const fake = open();
            expect(await fake.set("tree", "t")).toMatchObject({ ok: true });
            expect(await fake.set("workfile", "fake.json")).toMatchObject({ ok: true });
            expect(await fake.set(BACKEND_KEY, "other")).toMatchObject({ ok: true });
            const other = open_other();
            expect(other.errors).toEqual([]);
            expect(other.get("workfile")).toBeUndefined();
            expect(await other.set("workfile", "other.json")).toMatchObject({ ok: true });
            expect(await other.set(BACKEND_KEY, "fake")).toMatchObject({ ok: true });
            expect(read_json(files.local)).toEqual({
                backend: "fake",
                fake: { tree: path.join(project, "t"), workfile: path.join(project, "fake.json") },
                other: { workfile: path.join(project, "other.json") },
            });
            expect(open().get("workfile")).toBe(path.join(project, "fake.json"));
        });

        test("resetting a section's last key removes the section", async () => {
            const files = files_at();
            write_json(files.local, { backend: "fake", fake: { chip: "c" } });
            expect(await open().reset("chip")).toMatchObject({ ok: true });
            expect(read_json(files.local)).toEqual({ backend: "fake" });
        });
    });

    describe("paths", () => {
        test("a local relative path resolves against the project root, ~ against home", () => {
            const files = files_at();
            write_json(files.local, { fake: { tree: "../tree", workfile: "~/w.json", modules: ["m1", "/abs/m2", "~"] } });
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
            write_json(files.global, { fake: { workfile: "w.json", modules: ["/ok", "rel"] } });
            const store = open();
            expect(store.errors.map(error => error.field)).toEqual(["fake.workfile", "fake.modules"]);
            expect(store.errors[0]!.message).toBe(`${GLOBAL}: fake.workfile: "w.json" is relative; a global path must be absolute or start with ~`);
            expect(store.get("workfile")).toBe(path.join(project, "workfile.json"));

            const refused = await store.set("workfile", "x.json", "global");
            expect(refused).toEqual({ ok: false, message: "workfile: \"x.json\" is relative; a global path must be absolute or start with ~" });
            expect(await store.set("workfile", "~/x.json", "global")).toMatchObject({ ok: true });
            expect(read_json(files.global)).toEqual({ fake: { modules: ["/ok", "rel"], workfile: "~/x.json" } });
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
            expect(read_json(store.files.local)).toEqual({ fake: { tree: path.join(nested, "t"), modules: [path.join(nested, "a"), "~/b"] } });
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

    test("set - dynamic options and the check hook's also, in one save into the active section", async () => {
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
        write_json(files_at().local, { backend: "fake", other: { capi: "x" } });
        const store = open(project, { hooks, session: () => ({}) as Session });
        expect(await store.set("board", "b3")).toEqual({ ok: false, message: "board: \"b3\" is not one of b1 | b2" });
        expect(await store.set("chip", "bad")).toEqual({ ok: false, message: "bad chip" });
        expect(await store.set("board", "b1")).toMatchObject({ ok: true });
        expect(read_json(store.files.local)).toEqual({ backend: "fake", fake: { board: "b1", chip: "c1" }, other: { capi: "x" } });
        expect(await store.set("board", "b2")).toMatchObject({ ok: true });
        expect(read_json(store.files.local)).toEqual({ backend: "fake", fake: { board: "b2" }, other: { capi: "x" } });
        expect(store.get("chip")).toBeUndefined();
        expect(calls).toEqual(["options board", "check chip=bad", "options board", "check board=b1", "options board", "check board=b2"]);
    });

    test("reset - removes the key from one scope, keeps the others; no file is created", async () => {
        const files = files_at();
        const store = open();
        expect(await store.reset("chip")).toEqual({ ok: true, file: files.local });
        expect(fs.existsSync(files.local)).toBe(false);

        write_json(files.global, { fake: { chip: "g", "noos-key": 1 }, other: { chip: "kept" } });
        write_json(files.local, { fake: { chip: "l", syntax: "b" } });
        const loaded = open();
        expect(await loaded.reset("chip")).toMatchObject({ ok: true });
        expect(read_json(files.local)).toEqual({ fake: { syntax: "b" } });
        expect(loaded.get("chip")).toBe("g");
        expect(await loaded.reset("chip", "global")).toMatchObject({ ok: true });
        expect(read_json(files.global)).toEqual({ fake: { "noos-key": 1 }, other: { chip: "kept" } });
        expect(loaded.origin("chip")).toBe("unset");
        // A key only another section has is nothing to remove.
        expect(await loaded.reset("syntax", "global")).toMatchObject({ ok: true });
        expect(read_json(files.global)).toEqual({ fake: { "noos-key": 1 }, other: { chip: "kept" } });
    });
}
