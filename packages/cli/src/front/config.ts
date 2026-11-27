// `config`: show the settings, set or reset one, or rebuild what the backend caches. Modelled
// on attach-cli's config command (spec 03-commands/config.md) over step 1's settings store.
//
//   config [<key>]                   show every setting, or one
//   config <key> <value>... [--global]   set it (a path_list takes several values)
//   config <key> --reset [--global]  remove it from the file
//   config --reload                  the backend's `settings_hooks.reload`
//   config var [<NAME> [<value>]]    the scripts' variables (a backend with `variables`):
//                                    list them, show one, set one; --secret, --reset
//
// After a set or reset the backend's `settings_hooks.changed` runs, and its outcome, when it
// gives one, takes the place of the front end's answer (decision 10). Without a backend,
// `config` still knows `backend` itself. The keys it shows and writes are the top level's
// `backend` and the active backend's section (settings-store.ts).

import {
	answer, default_of, input_error, refuse,
	type Completion, type Outcome, type ScriptVariables, type Session, type SettingSpec,
} from "../interface/backend-interface";
import type { CommonResponse, Suggestion } from "../interface/backend-responses";
import { did_you_mean } from "../interface/names";
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
	/**
	 * `config <key>` of a setting that takes any value (a path): values found for it, offered,
	 * not required (the backend's `suggestions` hook). Absent when none are found.
	 */
	suggestions?: Suggestion[];
}

export interface ConfigResponse extends CommonResponse {
	configs: ConfigEntry[];
	/** `config` with no key, for a backend that runs scripts: their variables (CONFIG-016, CONFIG-015). */
	variables?: VariableEntry[];
}

/** One variable of the backend's scripts, as `config --json` and `config var --json` list it. */
export interface VariableEntry {
	name: string;
	/**
	 * `system`: the backend computes it (`AA_…`); `executable`: a command the backend runs, with a
	 * default (`AA_BUILD`); `project`: `config var <NAME> <value>`; `secret`: `config var <NAME> --secret`.
	 */
	kind: "system" | "executable" | "project" | "secret";
	/** A system or executable variable's; a project variable has none. */
	description?: string;
	/** Its value as the settings stand; null for a secret, and a system variable that has none now. */
	value: string | null;
	/** An executable variable's: what runs it (`build`, `deploy`, `preprocess`). */
	runs?: string;
	/** An executable variable's: its value when the project hasn't changed it. */
	default?: string;
	/** The scripts that get it; none for an executable variable. */
	scripts: string[];
	/** A secret: whether the environment `config` runs in has it, as `deploy` would read it. */
	in_environment?: boolean;
}

export interface VariablesResponse extends CommonResponse {
	variables: VariableEntry[];
}

/** The pseudo-key of the scripts' variables: `config var …`. */
export const VAR_KEY = "var";

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

async function config_entry(spec: SettingSpec, front: FrontEnd, session: Session, suggest = false): Promise<ConfigEntry> {
	const suggestions = suggest ? await suggestions_of(spec.key, front, session) : [];
	/* eslint-disable unicorn/no-null -- the protocol's Config has null for "none" */
	return {
		field_name: spec.key,
		category: spec.category,
		description: spec.description,
		type: await entry_type(spec, front, session),
		required: spec.required,
		default: default_of(spec, key => front.settings.get(key)) ?? null,
		value: value_of(front.settings, spec) ?? null,
		source: source_of(front.settings, spec.key),
		...(suggestions.length > 0 ? { suggestions } : {}),
	};
	/* eslint-enable unicorn/no-null */
}

/** What the backend found for a setting (its `suggestions` hook); none when it fails or has no hook. */
async function suggestions_of(key: string, front: FrontEnd, session: Session): Promise<Suggestion[]> {
	const hook = front.backend?.settings_hooks?.suggestions;
	if (hook === undefined) { return []; }
	try {
		return await hook(key, session);
	} catch {
		return [];
	}
}

const NOT_SET = "(not set)";

/** A value on one line, for the messages of a write. */
function shown_value(value: ConfigEntry["value"] | readonly string[] | undefined): string {
	if (value === null || value === undefined) { return NOT_SET; }
	return typeof value === "string" ? value : value.join(", ");
}
/** Where a line of `config`'s text is cut (the description, the options). */
const TEXT_WIDTH = 80;

/** The value as lines: a path_list one path per line, paths from the home directory as `~`. */
function value_lines(entry: ConfigEntry, home: string): string[] {
	const { value } = entry;
	if (value === null) { return [NOT_SET]; }
	const shown = (one: string): string => entry.type === "path" || entry.type === "path_list" ? display_path(one, home) : one;
	if (typeof value === "string") { return [shown(value)]; }
	return value.length === 0 ? [NOT_SET] : value.map(one => shown(one));
}

/** Words joined into lines of at most `width` characters (a longer word gets a line of its own). */
function wrap(words: readonly string[], width: number, separator = " "): string[] {
	const lines: string[] = [];
	let line = "";
	for (const word of words) {
		const next = line === "" ? word : `${line}${separator}${word}`;
		if (line !== "" && next.length > width) {
			lines.push(`${line}${separator.trimEnd()}`);
			line = word;
		} else {
			line = next;
		}
	}
	if (line !== "") { lines.push(line); }
	return lines;
}

/** The hint of a required setting that is unset; `backend` points to `config backend`. */
function hint_of(spec: SettingSpec, front: FrontEnd): string | undefined {
	return spec.key === BACKEND_KEY ? `Run '${front.program}' on a terminal, or ${backend_command(front)}.` : spec.hint;
}

/**
 * Every setting: the files, then the settings by category, then the hints of the required ones
 * that are unset. A setting is a row `* key  value  source`; a path_list's other paths go on
 * the lines below, under the first.
 */
function format_table(entries: readonly ConfigEntry[], specs: readonly SettingSpec[], front: FrontEnd, style: Session["style"]): string {
	const { files } = front.settings;
	const { home } = front;
	const lines = [`Local:  ${display_path(files.local, home)}`, `Global: ${display_path(files.global, home)}`, ""];
	const name_width = Math.max(...entries.map(entry => entry.field_name.length)) + 2;
	const shown = new Map(entries.map(entry => [entry, value_lines(entry, home)]));
	const value_width = Math.max(10, ...[...shown.values()].flat().map(line => line.length)) + 2;
	const categories = [...new Set(entries.map(entry => entry.category))];
	for (const [index, category] of categories.entries()) {
		if (index > 0) { lines.push(""); }
		lines.push(`  ${style.bold(category)}`);
		for (const entry of entries.filter(candidate => candidate.category === category)) {
			const mark = entry.required ? "*" : " ";
			const [first = NOT_SET, ...more] = shown.get(entry) ?? [];
			const value = first === NOT_SET ? style.dim(first.padEnd(value_width)) : first.padEnd(value_width);
			const source = entry.source === "unset" ? "" : style.dim(entry.source);
			lines.push(`  ${mark} ${entry.field_name.padEnd(name_width)}${value}${source}`.trimEnd());
			const indent = " ".repeat(4 + name_width);
			lines.push(...more.map(line => `${indent}${line}`));
		}
	}
	if (entries.some(entry => entry.required)) { lines.push("", style.dim("  * required")); }
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

/** A label of `format_one` and `format_variable`, `<name>:` padded. */
const label = (name: string): string => `  ${`${name}:`.padEnd(LABEL_WIDTH)}`;

/**
 * One setting (CONFIG-013): its key, then labelled lines as `read` shows a property's details:
 * the value and where it comes from, the description and the options, wrapped.
 */
function format_one(entry: ConfigEntry, spec: SettingSpec, front: FrontEnd, style: Session["style"]): string {
	const indent = " ".repeat(2 + LABEL_WIDTH);
	const under = (first: string, rest: readonly string[]): string[] => [first, ...rest.map(line => `${indent}${line}`)];
	const width = TEXT_WIDTH - indent.length;

	const lines = [`${style.bold(entry.field_name)}${entry.required ? style.dim("  (required)") : ""}`, ""];
	const [value = NOT_SET, ...more] = value_lines(entry, front.home);
	const source = entry.source === "unset" ? "" : style.dim(`  (${entry.source})`);
	lines.push(...under(`${label("Value")}${value === NOT_SET ? style.dim(value) : value}${source}`, more));
	const [description = "", ...wrapped] = wrap(entry.description.split(" "), width);
	lines.push(...under(`${label("Description")}${description}`, wrapped));
	if (typeof entry.type === "object") {
		const [options = "", ...rest] = wrap(entry.type.options, width, ", ");
		lines.push(...under(`${label("Options")}${options}`, rest));
	}
	const found = (entry.suggestions ?? []).map(suggestion =>
		`${display_path(suggestion.value, front.home)}${suggestion.display_string === undefined ? "" : style.dim(`  ${suggestion.display_string}`)}`);
	if (found.length > 0) {
		const [first = "", ...rest] = found;
		lines.push(...under(`${label("Found")}${first}`, rest));
	}
	const hint = entry.required && entry.value === null ? hint_of(spec, front) : undefined;
	if (hint !== undefined) { lines.push("", hint); }
	return lines.join("\n");
}

/** The width of a label column of format_one, `Description:` and two spaces. */
const LABEL_WIDTH = 14;

/** Every setting, or `only` that one. */
async function show(front: FrontEnd, session: Session, only?: SettingSpec): Promise<Outcome<ConfigResponse>> {
	if (front.settings.errors.length > 0) { return config_errors(front.settings.errors, front.json); }
	const specs = only === undefined ? front.settings.specs : [only];
	// What was found for a setting is looked for when it is asked for alone: a scan of folders.
	const entries = await Promise.all(specs.map(spec => config_entry(spec, front, session, only !== undefined)));
	const variables = only === undefined ? variable_entries(front, session) : undefined;
	const response: ConfigResponse = {
		ok: true, message: `${entries.length} config field(s)`, severity: "info", configs: entries,
		...(variables === undefined ? {} : { variables }),
	};
	const [entry] = entries;
	const { style } = session;
	if (only !== undefined && entry !== undefined) { return answer(response, format_one(entry, only, front, style)); }
	const table = format_table(entries, specs, front, style);
	return answer(response, variables === undefined ? table : `${table}\n\n${format_variables(variables, front, style)}`);
}

// =====================================================================================
// The scripts' variables (`config var`)
// =====================================================================================

/** Every variable: the system ones, the executable ones, then the project's in file order. Undefined for a backend without scripts. */
function variable_entries(front: FrontEnd, session: Session): VariableEntry[] | undefined {
	const scripts = front.backend?.variables;
	if (scripts === undefined) { return undefined; }
	/* eslint-disable unicorn/no-null -- the protocol has null for "none" */
	const system: VariableEntry[] = scripts.system(session).map(variable => ({
		name: variable.name,
		kind: "system",
		description: variable.description,
		value: variable.value ?? null,
		scripts: [...variable.scripts],
	}));
	const executable: VariableEntry[] = scripts.executables.map(variable => ({
		name: variable.name,
		kind: "executable",
		description: variable.description,
		value: front.settings.executable(variable.name) ?? variable.default,
		runs: variable.runs,
		default: variable.default,
		scripts: [],
	}));
	const project: VariableEntry[] = front.settings.variables().map(variable => variable.secret
		? { name: variable.name, kind: "secret", value: null, scripts: [...scripts.secret_scripts], in_environment: (session.environment[variable.name] ?? "") !== "" }
		: { name: variable.name, kind: "project", value: variable.value, scripts: [...scripts.scripts] });
	/* eslint-enable unicorn/no-null */
	return [...system, ...executable, ...project];
}

/** A variable's value on one line: a secret says whether the environment has it. */
function variable_value(entry: VariableEntry, front: FrontEnd): string {
	if (entry.kind === "secret") { return entry.in_environment === true ? "(secret, in the environment)" : "(secret, not in the environment)"; }
	if (entry.value === null) { return NOT_SET; }
	return entry.kind === "system" ? display_path(entry.value, front.home) : entry.value;
}

/** A value on one line of the table: a command of several lines shows its first. */
function one_line(value: string): string {
	const [first = "", ...rest] = value.split("\n");
	return rest.length === 0 ? first : `${first} …`;
}

/** `a`, `a and b`, `a, b and c`. */
export function and_list(words: readonly string[]): string {
	return words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words.at(-1) ?? ""}`;
}

/** What a variable's line says after its value: its kind, and what gets it or runs it. */
function variable_kind(entry: VariableEntry): string {
	if (entry.kind !== "executable") { return `${entry.kind}, ${and_list(entry.scripts)}`; }
	return `executable${entry.value === entry.default ? " (default)" : ""}, run by ${entry.runs ?? ""}`;
}

/** The variables as a table: `name  value  kind  scripts`, the system ones first. */
function format_variables(entries: readonly VariableEntry[], front: FrontEnd, style: Session["style"]): string {
	const lines = [`  ${style.bold("Variables")}`];
	const name_width = Math.max(0, ...entries.map(entry => entry.name.length)) + 2;
	const values = entries.map(entry => one_line(variable_value(entry, front)));
	const value_width = Math.max(10, ...values.map(value => value.length)) + 2;
	for (const [index, entry] of entries.entries()) {
		const value = values[index] ?? NOT_SET;
		const shown = entry.value === null && entry.kind !== "secret" ? style.dim(value.padEnd(value_width)) : value.padEnd(value_width);
		lines.push(`    ${entry.name.padEnd(name_width)}${shown}${style.dim(variable_kind(entry))}`);
	}
	if (!entries.some(entry => entry.kind === "project" || entry.kind === "secret")) {
		lines.push("", style.dim(`  No project variables: ${front.program} config var <NAME> <value>, or --secret for a password.`));
	}
	return lines.join("\n");
}

/** One variable, labelled as `format_one` shows a setting. */
function format_variable(entry: VariableEntry, front: FrontEnd, style: Session["style"]): string {
	const indent = " ".repeat(2 + LABEL_WIDTH);
	// A command of several lines: each under the first.
	const [first_line = "", ...more] = variable_value(entry, front).split("\n");
	const lines = [style.bold(entry.name), "", `${label("Value")}${first_line}`, ...more.map(line => `${indent}${line}`), `${label("Kind")}${entry.kind}`];
	if (entry.kind === "executable") {
		lines.push(`${label("Runs")}${entry.runs ?? ""}`, `${label("Default")}${entry.default ?? ""}${entry.value === entry.default ? " (in use)" : ""}`);
	} else {
		lines.push(`${label("Scripts")}${entry.scripts.join(", ")}`);
	}
	if (entry.description !== undefined) {
		const [first = "", ...wrapped] = wrap(entry.description.split(" "), TEXT_WIDTH - indent.length);
		lines.push(`${label("Description")}${first}`, ...wrapped.map(line => `${indent}${line}`));
	}
	return lines.join("\n");
}

/** `config var [<NAME> [<value>]] [--secret] [--reset]` (CONFIG-300 to CONFIG-310). */
function run_variable(
	front: FrontEnd, scripts: ScriptVariables, words: readonly string[], flags: { global: boolean; reset: boolean; secret: boolean }, session: Session,
): Outcome<CommonResponse> {
	const { settings, program } = front;
	const [name, ...values] = words;
	if (flags.global) { return refuse("Variables belong to the project and can't be in the global settings: set them without --global", { type: "invalid-setting" }); }
	if (name === undefined) {
		if (flags.reset || flags.secret) { return input_error(`--${flags.reset ? "reset" : "secret"} needs a variable: ${program} config var <NAME> --${flags.reset ? "reset" : "secret"}`); }
		const entries = variable_entries(front, session) ?? [];
		const response: VariablesResponse = { ok: true, message: `${entries.length} variable(s)`, severity: "info", variables: entries };
		return answer(response, format_variables(entries, front, session.style));
	}
	if (flags.reset && flags.secret) { return input_error("--reset and --secret don't go together"); }
	if (values.length > 1) { return input_error(`A variable takes one value; got ${values.length}. Quote a value that has spaces.`); }
	const [value] = values;
	const stored = settings.variables().find(variable => variable.name === name);
	const executable = scripts.executables.find(variable => variable.name === name);
	const done = (message: string): Outcome<CommonResponse> => answer({ ok: true, message, severity: "info" }, message);
	const written = (write: ReturnType<typeof settings.set_variable>, message: string): Outcome<CommonResponse> => {
		if (write.ok) { return done(message); }
		if (write.broken_file === true) { return input_error(write.message); }
		return refuse(write.message, { type: "invalid-name" });
	};

	if (flags.reset) {
		if (value !== undefined) { return input_error("--reset takes no value"); }
		if (executable !== undefined) { return written(settings.reset_variable(name), `Reset variable ${name} (default ${executable.default})`); }
		if (name.toUpperCase().startsWith(scripts.reserved_prefix)) { return refuse(`${name} is a system variable: ${front.backend?.id ?? "the backend"} computes it, and it can't be reset`, { type: "read-only" }); }
		return written(settings.reset_variable(name), `Reset variable ${name} (not set)`);
	}
	if (flags.secret) {
		if (value !== undefined) {
			return input_error(`--secret takes no value: a secret's value is never stored. Set it in the environment deploy runs in, or deploy asks for it on a terminal.`);
		}
		if (executable !== undefined) {
			return refuse(`${name} is a command ${front.backend?.id ?? "the backend"} runs, and can't be a secret: put a password in a secret of its own, which ${scripts.secret_scripts.join(", ")} gets`, { type: "invalid-setting" });
		}
		const was_plain = stored !== undefined && !stored.secret;
		return written(settings.set_variable(name, { secret: true }), `Set variable ${name} as a secret${was_plain ? " (its stored value removed)" : ""}`);
	}
	if (value === undefined) {
		const entry = (variable_entries(front, session) ?? []).find(candidate => candidate.name === name);
		if (entry === undefined) {
			const names = (variable_entries(front, session) ?? []).map(candidate => candidate.name);
			return refuse(`Unknown variable ${name}.${did_you_mean(name, names)} Set it with ${program} config var ${name} <value>.`, { type: "not-found" });
		}
		const response: VariablesResponse = { ok: true, message: "1 variable(s)", severity: "info", variables: [entry] };
		return answer(response, format_variable(entry, front, session.style));
	}
	if (stored?.secret === true) {
		return refuse(`${name} is a secret, whose value is never stored: ${program} config var ${name} --reset first to make it a plain variable`, { type: "invalid-setting" });
	}
	if (executable !== undefined && value.trim() === "") {
		return refuse(`${name}: must not be empty: ${program} config var ${name} --reset goes back to the default, ${executable.default}`, { type: "invalid-setting" });
	}
	if (value === "") { return refuse(`${name}: must not be empty: ${program} config var ${name} --reset removes it`, { type: "invalid-setting" }); }
	return written(settings.set_variable(name, value), `Set variable ${name} = ${value}`);
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

/**
 * A refused write: the store's message, then the setting's description and hint (CONFIG-103).
 * A refusal, not an input error: the command ran and the value is what it can't take (GEN-09).
 */
function refused_write(message: string, spec: SettingSpec, front: FrontEnd): Outcome<never> {
	const hint = hint_of(spec, front);
	const reason = `${message} — ${spec.description}`;
	return refuse(reason, { type: "invalid-setting", text: `${reason}${hint === undefined ? "" : `\n\n${hint}`}` });
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
	if (!write.ok) {
		// A file that can't be written is the configuration's problem (COM-071), not the value's.
		return write.broken_file === true ? input_error(`${write.message} — ${spec.description}`) : refused_write(write.message, spec, front);
	}
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
		const fallback = default_of(spec, key => settings.get(key));
		now = fallback === undefined ? "not set" : `default: ${fallback}`;
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

export async function run_config(
	front: FrontEnd, positionals: PositionalValues, flags: { global: boolean; reset: boolean; reload: boolean; secret?: boolean }, session: Session,
): Promise<Outcome<CommonResponse>> {
	const key = typeof positionals["key"] === "string" ? positionals["key"] : undefined;
	const raw = positionals["values"];
	const values = Array.isArray(raw) ? raw as readonly string[] : [];
	const specs = front.settings.specs;
	const program = front.program;
	const secret = flags.secret === true;

	if (flags.reload) {
		if (key !== undefined || flags.reset || flags.global || secret) { return input_error("--reload rebuilds the caches and takes no other argument"); }
		return reload(front, session);
	}
	const scripts = front.backend?.variables;
	if (key === VAR_KEY && scripts !== undefined) {
		if (front.settings.errors.length > 0) { return config_errors(front.settings.errors, front.json); }
		return run_variable(front, scripts, values, { global: flags.global, reset: flags.reset, secret }, session);
	}
	if (secret) { return input_error(`--secret is for a variable: ${program} config var <NAME> --secret`); }
	if (key === undefined) {
		if (flags.reset) { return input_error(`--reset needs a key: ${program} config <key> --reset`); }
		if (flags.global) { return input_error(`--global needs a key: ${program} config <key> <value> --global`); }
		return show(front, session);
	}
	const spec = specs.find(candidate => candidate.key === key);
	if (spec === undefined) {
		const first = front.backend === undefined ? ` Choose a backend first: ${backend_command(front)}.` : "";
		const keys = [...specs.map(candidate => candidate.key), ...front.backend?.variables === undefined ? [] : [VAR_KEY]];
		return input_error(`Unknown config field: ${key}.${did_you_mean(key, keys)} Valid fields: ${keys.join(", ")}.${first}`);
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
	const scripts = front.backend?.variables;
	if (index === 0) {
		const variables = scripts === undefined ? [] : [{ value: VAR_KEY, description: "The variables of the build, deploy and preprocess commands, and those commands" }];
		return { candidates: [...specs.map(spec => ({ value: spec.key, description: spec.description })), ...variables] };
	}
	if (prior[0] === VAR_KEY && scripts !== undefined) {
		// The commands and the project's variables, to show, change or reset; a value is the user's.
		const names = [
			...scripts.executables.map(variable => ({ value: variable.name, description: variable.description })),
			...front.settings.variables().map(variable => ({ value: variable.name })),
		];
		return index === 1 ? { candidates: names } : { candidates: [] };
	}
	const spec = specs.find(candidate => candidate.key === prior[0]);
	if (spec === undefined) { return { candidates: [] }; }
	if (spec.type === "path_list" || spec.type === "path") {
		return spec.type === "path" && index > 1 ? undefined : { candidates: [], fallback: "files" };
	}
	if (index > 1) { return undefined; }
	if (spec.key === BACKEND_KEY) { return { candidates: front.choices.map(id => ({ value: id })) }; }
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
	const scripts = front.backend?.variables;
	const variables_help = scripts === undefined ? "" : `

The ${front.backend?.id ?? ""} backend runs commands that are variables of the project's, each with a
default: ${scripts.executables.map(variable => `${variable.name} (${variable.runs}${variable.default.length <= 12 ? `, ${variable.default}` : ""})`).join(", ")}.
config var <NAME> <command> changes one, --reset goes back to the default.
The commands get variables in their environment: the system ones it computes
(${scripts.reserved_prefix}…), and the project's own. config var lists them; config var <NAME> <value>
sets one in the project's file (never --global), --reset removes it. config var
<NAME> --secret stores a name only: its value is read from the environment
${scripts.secret_scripts.join(", ")} runs in, or asked for on a terminal, and goes to ${scripts.secret_scripts.join(", ")} alone.`;
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
active backend; switching backend leaves the other's section as it is.${variables_help}`,
		examples: [
			"config", "config backend", `config backend ${front.choices[0] ?? "<id>"}`, "config <key> --reset", "config --reload",
			...scripts === undefined ? [] : ["config var BOARD_IP 192.168.2.10", "config var BOARD_PASSWORD --secret", ...scripts.executables.slice(0, 1).map(variable => `config var ${variable.name} "make overlay"`)],
		],
		group: "setup",
		positionals: [
			{ name: "key", placeholder: "key", brief: "Setting to show or change (omit for all)", optional: true },
			{ name: "values", placeholder: "value", brief: "Value to set (omit to show the setting)", optional: true, variadic: true },
		],
		flags: {
			global: { kind: "boolean", brief: "Write the global settings, not the project's" },
			reset: { kind: "boolean", brief: "Remove the setting: back to its default, or unset" },
			reload: { kind: "boolean", brief: "Rebuild what the backend caches (no key)" },
			...scripts === undefined ? {} : { secret: { kind: "boolean" as const, brief: "With var <NAME>: a secret, stored by name only" } },
		},
		asks: false,
		supported: true,
		run: (input, session) => run_config(front, input.positionals, {
			global: input.flags["global"] === true,
			reset: input.flags["reset"] === true,
			reload: input.flags["reload"] === true,
			secret: input.flags["secret"] === true,
		}, session),
		complete: (index, prior, _partial, session) => complete_config(front, index, prior, session),
	};
}
