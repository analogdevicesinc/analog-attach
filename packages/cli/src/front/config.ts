// `config`: show the settings, set or reset one, or rebuild what the backend caches. Modelled
// on attach-cli's config command (spec 03-commands/config.md) over step 1's settings store.
//
//   config [<key>]                   show every setting, or one
//   config <key> <value>... [--global]   set it (a path_list takes several values)
//   config <key> --reset [--global]  remove it from the file
//   config --reload                  the backend's `settings_hooks.reload`
//
// After a set or reset the backend's `settings_hooks.changed` runs, and its outcome, when it
// gives one, takes the place of the front end's answer (decision 10). Without a backend,
// `config` still knows `backend` itself. The keys it shows and writes are the top level's
// `backend` and the active backend's section (settings-store.ts).

import {
    answer, input_error,
    type Completion, type Outcome, type Session, type SettingSpec,
} from "../interface/backend-interface";
import type { CommonResponse } from "../interface/backend-responses";
import { BACKEND_KEY, display_path, type ConfigError, type SettingsStore } from "./settings-store";
import { backend_command, type FrontEnd, type PositionalValues, type Route } from "./routes";

/** One setting as `config --json` lists it: attach-cli's `Config`, with `path_list` and `source`. */
export interface ConfigEntry {
    field_name: string;
    category: string;
    description: string;
    type: "path" | "path_list" | "string" | "numeric" | "bool" | { options: string[] };
    required: boolean;
    default: string | null;
    /** The effective value: local, global, then the default. */
    value: string | readonly string[] | null;
    /** Where `value` comes from. */
    source: "local" | "global" | "default" | "unset";
}

export interface ConfigResponse extends CommonResponse {
    configs: ConfigEntry[];
}

// =====================================================================================
// Configuration errors (COM-071, COM-072)
// =====================================================================================

/** The errors' distinct hints, in order. */
function hints_of(errors: readonly ConfigError[]): string[] {
    return [...new Set(errors.flatMap(error => error.hint === undefined ? [] : [error.hint]))];
}

/** COM-072's wording: one problem as its line, several under `Configuration errors:`, then the hints. */
export function format_config_errors(errors: readonly ConfigError[]): string {
    const line = (error: ConfigError): string => error.description === undefined ? error.message : `${error.message} — ${error.description}`;
    const body = errors.length === 1 ? line(errors[0]!) : ["Configuration errors:", ...errors.map(error => `  ${line(error)}`)].join("\n");
    const hints = hints_of(errors);
    return hints.length === 0 ? body : `${body}\n\n${hints.join("\n")}`;
}

/** Settings that don't load: on stderr, exit 2, in both modes; under `--json` as `{ errors, hints }` (COM-071). */
export function config_errors(errors: readonly ConfigError[], json: boolean): Outcome<never> {
    return input_error(json ? JSON.stringify({ errors, hints: hints_of(errors) }) : format_config_errors(errors));
}

// =====================================================================================
// Showing
// =====================================================================================

async function entry_type(spec: SettingSpec, front: FrontEnd, session: Session): Promise<ConfigEntry["type"]> {
    if (Array.isArray(spec.options)) { return { options: [...spec.options as readonly string[]] }; }
    if (spec.options === "dynamic") {
        // A scan that fails or finds nothing shows the plain type, as attach-noos did.
        const options = await dynamic_options(spec.key, front, session);
        if (options.length > 0) { return { options }; }
    }
    return spec.type;
}

async function dynamic_options(key: string, front: FrontEnd, session: Session): Promise<string[]> {
    const hook = front.backend?.settings_hooks?.options;
    if (hook === undefined) { return []; }
    try {
        return await hook(key, session);
    } catch {
        return [];
    }
}

function value_of(settings: SettingsStore, spec: SettingSpec): string | readonly string[] | undefined {
    return spec.type === "path_list" ? settings.paths(spec.key) : settings.get(spec.key);
}

function source_of(settings: SettingsStore, key: string): ConfigEntry["source"] {
    const origin = settings.origin(key);
    return typeof origin === "string" ? origin : origin.scope;
}

async function config_entry(spec: SettingSpec, front: FrontEnd, session: Session): Promise<ConfigEntry> {
    /* eslint-disable unicorn/no-null -- the protocol's Config has null for "none" */
    return {
        field_name: spec.key,
        category: spec.category,
        description: spec.description,
        type: await entry_type(spec, front, session),
        required: spec.required,
        default: spec.default ?? null,
        value: value_of(front.settings, spec) ?? null,
        source: source_of(front.settings, spec.key),
    };
    /* eslint-enable unicorn/no-null */
}

function shown_value(value: ConfigEntry["value"] | readonly string[] | undefined): string {
    if (value === null || value === undefined) { return "(not set)"; }
    return typeof value === "string" ? value : value.join(", ");
}

/** The hint of a required setting that is unset; `backend` points to `config backend`. */
function hint_of(spec: SettingSpec, front: FrontEnd): string | undefined {
    return spec.key === BACKEND_KEY ? `Run '${front.program}' on a terminal, or ${backend_command(front)}.` : spec.hint;
}

/** Every setting: the files, then a table by category, then the hints of the required ones that are unset. */
function format_table(entries: readonly ConfigEntry[], specs: readonly SettingSpec[], front: FrontEnd): string {
    const { files } = front.settings;
    const { home } = front;
    const lines = [`Local:  ${display_path(files.local, home)}`, `Global: ${display_path(files.global, home)}`, ""];
    const name_width = Math.max(...entries.map(entry => entry.field_name.length)) + 2;
    const value_width = Math.max(10, ...entries.map(entry => shown_value(entry.value).length)) + 2;
    const categories = [...new Set(entries.map(entry => entry.category))];
    for (const [index, category] of categories.entries()) {
        if (index > 0) { lines.push(""); }
        lines.push(`  ${category}`);
        for (const entry of entries.filter(candidate => candidate.category === category)) {
            const mark = entry.required ? "*" : " ";
            const source = entry.source === "unset" ? "" : entry.source;
            lines.push(`  ${mark} ${entry.field_name.padEnd(name_width)}${shown_value(entry.value).padEnd(value_width)}${source}`.trimEnd());
        }
    }
    if (entries.some(entry => entry.required)) { lines.push("", "  * required"); }
    const hints = unset_hints(entries, specs, front);
    if (hints.length > 0) { lines.push("", ...hints); }
    return lines.join("\n");
}

function unset_hints(entries: readonly ConfigEntry[], specs: readonly SettingSpec[], front: FrontEnd): string[] {
    const hints = entries.flatMap(entry => {
        if (!entry.required || entry.value !== null) { return []; }
        const spec = specs.find(candidate => candidate.key === entry.field_name);
        const hint = spec === undefined ? undefined : hint_of(spec, front);
        return hint === undefined ? [] : [hint];
    });
    return [...new Set(hints)];
}

/** One setting, as attach-cli shows a field (CONFIG-013). */
function format_one(entry: ConfigEntry, spec: SettingSpec, front: FrontEnd): string {
    let shown = shown_value(entry.value);
    if (entry.source === "default") {
        shown += " (default)";
    } else if (entry.source !== "unset") {
        shown += ` (${entry.source})`;
    }
    const options = typeof entry.type === "object" ? ` [${entry.type.options.join(" | ")}]` : "";
    const lines = [`${entry.field_name}${entry.required ? " [required]" : ""}: ${shown}`, `  ${entry.description}${options}`];
    const hint = entry.required && entry.value === null ? hint_of(spec, front) : undefined;
    if (hint !== undefined) { lines.push("", hint); }
    return lines.join("\n");
}

/** Every setting, or `only` that one. */
async function show(front: FrontEnd, session: Session, only?: SettingSpec): Promise<Outcome<ConfigResponse>> {
    if (front.settings.errors.length > 0) { return config_errors(front.settings.errors, front.json); }
    const specs = only === undefined ? front.settings.specs : [only];
    const entries = await Promise.all(specs.map(spec => config_entry(spec, front, session)));
    const response: ConfigResponse = { ok: true, message: `${entries.length} config field(s)`, severity: "info", configs: entries };
    const [entry] = entries;
    return answer(response, only === undefined || entry === undefined ? format_table(entries, specs, front) : format_one(entry, only, front));
}

// =====================================================================================
// Writing
// =====================================================================================

/** Every key's effective value and origin, to see what a write changed. */
function snapshot(settings: SettingsStore): Map<string, string> {
    return new Map(settings.specs.map(spec => [spec.key, JSON.stringify([value_of(settings, spec), settings.origin(spec.key)])]));
}

function changed_keys(before: Map<string, string>, settings: SettingsStore): string[] {
    const after = snapshot(settings);
    return settings.specs.map(spec => spec.key).filter(key => before.get(key) !== after.get(key));
}

/** A refused write: the store's message, then the setting's description and hint (CONFIG-103). */
function refused_write(message: string, spec: SettingSpec, front: FrontEnd): Outcome<never> {
    const hint = hint_of(spec, front);
    return input_error(`${message} — ${spec.description}${hint === undefined ? "" : `\n\n${hint}`}`);
}

/** What else a write changed: ` (and chip = chip-a, reset port)`. */
function also_text(keys: readonly string[], front: FrontEnd): string {
    if (keys.length === 0) { return ""; }
    const parts = keys.map(key => {
        const spec = front.settings.specs.find(candidate => candidate.key === key);
        const value = spec === undefined ? undefined : value_of(front.settings, spec);
        return value === undefined || source_of(front.settings, key) === "default" ? `reset ${key}` : `${key} = ${shown_value(value)}`;
    });
    return ` (and ${parts.join(", ")})`;
}

/** Run the backend's `changed` hook; its outcome, when it gives one, replaces `own`. */
async function after_write(keys: readonly string[], own: Outcome<CommonResponse>, front: FrontEnd, session: Session): Promise<Outcome<CommonResponse>> {
    const backend_keys = keys.filter(key => key !== BACKEND_KEY);
    const hook = front.backend?.settings_hooks?.changed;
    if (hook === undefined || backend_keys.length === 0) { return own; }
    return await hook(backend_keys, session) ?? own;
}

async function set(front: FrontEnd, spec: SettingSpec, values: readonly string[], global: boolean, session: Session): Promise<Outcome<CommonResponse>> {
    const { settings } = front;
    if (spec.type !== "path_list" && values.length > 1) { return input_error(`${spec.key} takes one value; got ${values.length}`); }
    const before = snapshot(settings);
    const scope = global ? "global" : "local";
    const write = await settings.set(spec.key, spec.type === "path_list" ? values : values[0]!, scope);
    if (!write.ok) { return refused_write(write.message, spec, front); }
    const keys = changed_keys(before, settings);
    const also = keys.filter(key => key !== spec.key);
    const message = `Set ${spec.key} = ${values.join(" ")}${global ? " (global)" : ""}${also_text(also, front)}`;
    return after_write([spec.key, ...also], answer({ ok: true, message, severity: "info" }, message), front, session);
}

async function reset(front: FrontEnd, spec: SettingSpec, global: boolean, session: Session): Promise<Outcome<CommonResponse>> {
    const { settings } = front;
    const before = snapshot(settings);
    const write = await settings.reset(spec.key, global ? "global" : "local");
    if (!write.ok) { return input_error(write.message); }
    const keys = changed_keys(before, settings);
    const origin = settings.origin(spec.key);
    let now: string;
    if (typeof origin === "object") {
        now = `still set in the ${origin.scope} config: ${shown_value(value_of(settings, spec))}`;
    } else {
        now = spec.default === undefined ? "not set" : `default: ${spec.default}`;
    }
    const message = `Reset ${spec.key}${global ? " (global)" : ""} (${now})`;
    return after_write([spec.key, ...keys.filter(key => key !== spec.key)], answer({ ok: true, message, severity: "info" }, message), front, session);
}

async function reload(front: FrontEnd, session: Session): Promise<Outcome<CommonResponse>> {
    const hook = front.backend?.settings_hooks?.reload;
    if (hook !== undefined) { return hook(session); }
    const message = front.backend === undefined
        ? "Nothing to rebuild: no backend is set"
        : `Nothing to rebuild: the ${front.backend.id} backend keeps no caches`;
    return answer({ ok: true, message, severity: "info" }, message);
}

// =====================================================================================
// The command
// =====================================================================================

export async function run_config(front: FrontEnd, positionals: PositionalValues, flags: { global: boolean; reset: boolean; reload: boolean }, session: Session): Promise<Outcome<CommonResponse>> {
    const key = typeof positionals["key"] === "string" ? positionals["key"] : undefined;
    const raw = positionals["values"];
    const values = Array.isArray(raw) ? raw as readonly string[] : [];
    const specs = front.settings.specs;
    const program = front.program;

    if (flags.reload) {
        if (key !== undefined || flags.reset || flags.global) { return input_error("--reload rebuilds the caches and takes no other argument"); }
        return reload(front, session);
    }
    if (key === undefined) {
        if (flags.reset) { return input_error(`--reset needs a key: ${program} config <key> --reset`); }
        if (flags.global) { return input_error(`--global needs a key: ${program} config <key> <value> --global`); }
        return show(front, session);
    }
    const spec = specs.find(candidate => candidate.key === key);
    if (spec === undefined) {
        const first = front.backend === undefined ? ` Choose a backend first: ${backend_command(front)}.` : "";
        return input_error(`Unknown config field: ${key}. Valid fields: ${specs.map(candidate => candidate.key).join(", ")}.${first}`);
    }
    if (flags.reset) {
        if (values.length > 0) { return input_error("--reset takes no value"); }
        return reset(front, spec, flags.global, session);
    }
    if (values.length === 0) {
        if (flags.global) { return input_error(`--global applies when setting or resetting: ${program} config ${key} <value> --global`); }
        return show(front, session, spec);
    }
    return set(front, spec, values, flags.global, session);
}

/** `config`'s completion: the keys, then a key's values (its options, the backend ids, or file names for a path). */
async function complete_config(front: FrontEnd, index: number, prior: readonly string[], session: Session): Promise<Completion | undefined> {
    const specs = front.settings.specs;
    if (index === 0) { return { candidates: specs.map(spec => ({ value: spec.key, description: spec.description })) }; }
    const spec = specs.find(candidate => candidate.key === prior[0]);
    if (spec === undefined) { return { candidates: [] }; }
    if (spec.type === "path_list" || spec.type === "path") {
        return spec.type === "path" && index > 1 ? undefined : { candidates: [], fallback: "files" };
    }
    if (index > 1) { return undefined; }
    if (spec.key === BACKEND_KEY) { return { candidates: Object.keys(front.registry).map(id => ({ value: id })) }; }
    if (Array.isArray(spec.options)) { return { candidates: (spec.options as readonly string[]).map(value => ({ value })) }; }
    if (spec.options === "dynamic") {
        const options = await dynamic_options(spec.key, front, session);
        return { candidates: options.map(value => ({ value })) };
    }
    if (spec.type === "bool") { return { candidates: [{ value: "true" }, { value: "false" }] }; }
    return { candidates: [] };
}

export function config_route(front: FrontEnd): Route {
    const program = front.program;
    return {
        path: ["config"],
        brief: "Show the settings, or set or reset one",
        full: `Show the settings, or set or reset one.

Settings are read from the project's .analog-attach/config.json (in this directory or
the nearest one above that has .analog-attach/), then from the global
~/.config/analog-attach/config.json. A write goes to the project's file, or with
--global to the global one.

Each backend's settings are kept in their own section of a file, an object named
after the backend ("linux": { ... }). The keys shown and written are those of the
active backend; switching backend leaves the other's section as it is.`,
        examples: ["config", "config backend", `config backend ${Object.keys(front.registry)[0] ?? "<id>"}`, "config <key> --reset", "config --reload"],
        group: "setup",
        positionals: [
            { name: "key", placeholder: "key", brief: "Setting to show or change (omit for all)", optional: true },
            { name: "values", placeholder: "value", brief: "Value to set (omit to show the setting)", optional: true, variadic: true },
        ],
        flags: {
            global: { kind: "boolean", brief: "Write the global settings, not the project's" },
            reset: { kind: "boolean", brief: "Remove the setting: back to its default, or unset" },
            reload: { kind: "boolean", brief: "Rebuild what the backend caches (no key)" },
        },
        asks: false,
        supported: true,
        run: (input, session) => run_config(front, input.positionals, {
            global: input.flags["global"] === true,
            reset: input.flags["reset"] === true,
            reload: input.flags["reload"] === true,
        }, session),
        complete: (index, prior, _partial, session) => complete_config(front, index, prior, session),
    };
}
