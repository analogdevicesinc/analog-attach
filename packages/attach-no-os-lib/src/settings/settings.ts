import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { Setting, SettingsFile } from "./types";
import {
	DEFAULT_SYSTEM_CONFIG_FILENAME,
	DEFAULT_SYSTEM_CONFIG_PATH,
	DEFAULT_WORKFILE_NAME,
	LOCAL_CONFIG_FILENAME,
	PATH_LIST_DELIMITER,
	SETTINGS_DEFAULTS
} from "./globals";
import type { Result} from "../ruleset_parser/result";
import { error, ok } from "../ruleset_parser/result";

let config_path_override: string | undefined;

// NOTE: This function is mainly for tests. Overriding the path also switches project-local
// config discovery off, so a test's config is the only config: otherwise a
// `.analog-attach.json` anywhere above the working directory would leak into it.
export function set_config_path_override(path: string | undefined): void {
	config_path_override = path;
}

export function get_settings_file_path(): string {
	if (config_path_override !== undefined) {
		return config_path_override;
	}
	return path.join(os.homedir(), DEFAULT_SYSTEM_CONFIG_PATH, DEFAULT_SYSTEM_CONFIG_FILENAME);
}

/**
 * Nearest project-local config at or above `start`, if any.
 *
 * Walking upward means a command run from a subdirectory of a project still finds that
 * project's settings, which is the same reason git looks for `.git` this way.
 */
export function find_local_config_path(start?: string): string | undefined {
	if (config_path_override !== undefined) {
		return undefined;
	}

	let directory = path.resolve(start ?? process.cwd());
	for (;;) {
		const candidate = path.join(directory, LOCAL_CONFIG_FILENAME);
		if (fs.existsSync(candidate)) {
			return candidate;
		}

		const parent = path.dirname(directory);
		if (parent === directory) {
			return undefined;
		}
		directory = parent;
	}
}

/**
 * Values held in one config file, keyed by setting name.
 *
 * Two on-disk shapes are accepted per key: a bare string (`"board": "max32690evkit"`,
 * what a project-local file is written as) and the historical full setting object
 * (`{"value": ..., "description": ..., ...}`). Only the value is taken from either —
 * every other field is owned by SETTINGS_DEFAULTS — so a config written by an older
 * version keeps working and cannot pin a stale description or default.
 */
function read_values(file_path: string): Result<Record<string, string>> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(fs.readFileSync(file_path, "utf8"));
	} catch (error_) {
		return error(`Malformed settings file at ${file_path}: ${String(error_)}`);
	}

	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		return error(`Malformed settings file at ${file_path}: expected a JSON object`);
	}

	const values: Record<string, string> = {};
	for (const [key, entry] of Object.entries(parsed as Record<string, unknown>)) {
		if (typeof entry === "string") {
			values[key] = entry;
			continue;
		}

		if (typeof entry === "object" && entry !== null) {
			const value = (entry as Record<string, unknown>).value;
			if (typeof value === "string") {
				values[key] = value;
			}
			continue;
		}

		return error(`Malformed settings file at ${file_path}: setting "${key}" is neither a string nor an object`);
	}

	return ok(values);
}

export interface SettingsSources {
	/** Always defined, whether or not the file exists yet. */
	global: string;
	/** The project-local config that shadowed it, if one was found. */
	local?: string;
}

export function get_settings_sources(): SettingsSources {
	const local = find_local_config_path();
	const global = get_settings_file_path();
	return local === undefined ? { global } : { global, local };
}

/**
 * Every setting, with values resolved from the project-local config first and the global
 * config second.
 *
 * A missing config file is not an error: attach-meta calls `tool-config-get` before
 * anything has been configured (that is how `init` learns what to ask for), so an
 * unconfigured machine has to describe its settings rather than refuse to. Only a file
 * that exists and cannot be read is an error.
 */
export function get_settings(): Result<SettingsFile> {
	const sources = get_settings_sources();

	const values: Record<string, string> = {};
	for (const file_path of [sources.global, sources.local]) {
		if (file_path === undefined || !fs.existsSync(file_path)) {
			continue;
		}

		const read = read_values(file_path);
		if (!read.ok) {
			return read;
		}

		// Later files win, and `local` comes last: a project overrides the global config.
		Object.assign(values, read.value);
	}

	const settings = {} as SettingsFile;
	for (const [key, defaults] of Object.entries(SETTINGS_DEFAULTS) as [keyof SettingsFile, Setting][]) {
		settings[key] = key in values ? { ...defaults, value: values[key] } : { ...defaults };
	}

	return ok(settings);
}

/** Writes the global config. Kept in the historical full-object shape. */
export function set_settings(settings: SettingsFile): Result<undefined> {
	return write_config(get_settings_file_path(), settings);
}

function write_config(config_path: string, contents: unknown): Result<undefined> {
	const config_directory = path.dirname(config_path);

	if (!fs.existsSync(config_directory)) {
		fs.mkdirSync(config_directory, { recursive: true });
	}

	fs.writeFileSync(config_path, JSON.stringify(contents, undefined, 2), "utf8");
	return ok();
}

export function get_setting(key: keyof SettingsFile): Result<Setting> {
	const settings = get_settings();
	if (!settings.ok) {
		return settings;
	}

	if (!(key in settings.value)) {
		return error(`Cannot find key "${key}" in settings. Available options: "${Object.keys(settings.value).join(", ")}"`);
	}

	return ok(settings.value[key]);
}

export function get_setting_value(key: keyof SettingsFile): Result<string> {
	const setting = get_setting(key);
	if (!setting.ok) {
		return setting;
	}

	if (setting.value.value === undefined) {
		return error(`Setting "${key}" is not configured. Run: attach-noos config ${key} <value>`);
	}

	return ok(setting.value.value);
}

/**
 * The value a command should actually use: what was configured, or the built-in default.
 *
 * This is also the value reported as attach-meta's `Config.default`, because `Config` has
 * no field for a current value — see the note on `Config` in the CLI's protocol types.
 */
export function get_effective_setting_value(key: keyof SettingsFile): Result<string | undefined> {
	const setting = get_setting(key);
	if (!setting.ok) {
		return setting;
	}

	return ok(setting.value.value ?? setting.value.default);
}

export interface SetSettingOptions {
	/**
	 * Write to a project-local config, creating `.analog-attach.json` in the current
	 * directory if none was found above it. Without this, a local config is still
	 * preferred when one already exists — otherwise setting a value in a project would
	 * write to the global config and be shadowed by the local one immediately.
	 */
	local?: boolean;
}

/** The config file a write lands in, and what the other one contributes beneath it. */
export interface ConfigLayers {
	/** The file set_setting_value() writes, given the same options. */
	target: string,
	/** The values that file holds now. */
	values: Record<string, string>,
	/** Where `beneath` comes from: the global config, when the target is the local one. */
	beneath_path?: string,
	/** Values from that file the target overrides key by key, and that stay in effect where
	 * the target sets nothing - clearing a key in the target does not clear them. */
	beneath: Record<string, string>,
}

/**
 * Both config layers as a write with these options sees them. A setting that has to agree
 * with another (a board and the platform it carries) is checked against the effective
 * values a write would leave, which is the target's values over `beneath`.
 */
export function config_layers(options: SetSettingOptions = {}): Result<ConfigLayers> {
	const local_path = find_local_config_path();
	const global_path = get_settings_file_path();

	const read = (file_path: string): Result<Record<string, string>> =>
		fs.existsSync(file_path) ? read_values(file_path) : ok({});

	if (local_path === undefined && !options.local) {
		const values = read(global_path);
		return values.ok ? ok({ target: global_path, values: values.value, beneath: {} }) : values;
	}

	const target = local_path ?? path.join(process.cwd(), LOCAL_CONFIG_FILENAME);
	const values = read(target);
	if (!values.ok) {
		return values;
	}
	const beneath = read(global_path);
	if (!beneath.ok) {
		return beneath;
	}
	return ok({ target, values: values.value, beneath_path: global_path, beneath: beneath.value });
}

export function set_setting_value(
	key: keyof SettingsFile,
	value?: string,
	options: SetSettingOptions = {}
): Result<undefined> {
	if (!(key in SETTINGS_DEFAULTS)) {
		return error(`Unknown key: ${key}`);
	}

	const local_path = find_local_config_path();
	if (local_path === undefined && !options.local) {
		return set_global_setting_value(key, value);
	}

	const target = local_path ?? path.join(process.cwd(), LOCAL_CONFIG_FILENAME);

	const existing: Record<string, string> = {};
	if (fs.existsSync(target)) {
		const read = read_values(target);
		if (!read.ok) {
			return read;
		}
		Object.assign(existing, read.value);
	}

	const updated = value === undefined
		? Object.fromEntries(Object.entries(existing).filter(([name]) => name !== key))
		: { ...existing, [key]: value };

	return write_config(target, updated);
}

function set_global_setting_value(key: keyof SettingsFile, value?: string): Result<undefined> {
	const data = get_settings();
	if (!data.ok) {
		return data;
	}

	const settings = data.value;
	settings[key].value = value;
	return set_settings(settings);
}

export function reset_setting_value(key: keyof SettingsFile): Result<undefined> {
	return set_setting_value(key);
}

/**
 * Whether bootstrap runs. Settings are stored as strings, so anything but an explicit
 * "false" (or "0"/"no"/"off") means on - it is the default, and a typo should not silently
 * turn it off.
 */
export function bootstrap_enabled(): boolean {
	return setting_on("bootstrap");
}

/** Whether the generated main.c runs the parts' examples. On unless explicitly off, like bootstrap. */
export function example_enabled(): boolean {
	return setting_on("example");
}

function setting_on(key: "bootstrap" | "example"): boolean {
	const configured = get_effective_setting_value(key);
	if (!configured.ok || configured.value === undefined) {
		return true;
	}
	return !["false", "0", "no", "off"].includes(configured.value.trim().toLowerCase());
}

/** Root of the capi checkout, which every other module's rulesets reference into. */
export function get_capi_path(): Result<string> {
	return get_setting_value("capi_path");
}

/**
 * Every module root to load rulesets from, capi first.
 *
 * `module_paths` is optional: capi alone is a valid (if driver-less) configuration, and
 * an empty or whitespace-only entry is dropped rather than turned into the current
 * directory, which is what `"a::b".split(path.delimiter)` would otherwise hand back.
 */
export function get_module_roots(): Result<string[]> {
	const capi = get_capi_path();
	if (!capi.ok) {
		return capi;
	}

	const configured = get_effective_setting_value("module_paths");
	if (!configured.ok) {
		return configured;
	}

	const extra = (configured.value ?? "")
		.split(PATH_LIST_DELIMITER)
		.map(entry => entry.trim())
		.filter(entry => entry.length > 0);

	return ok([capi.value, ...extra]);
}

/**
 * Absolute path of the workfile every command acts on.
 *
 * A relative `workfile` setting is resolved against the current directory, not against
 * the config file, which is what lets one global setting of `workfile.json` mean "this
 * project's workfile" in every project.
 */
export function get_workfile_path(): Result<string> {
	const configured = get_effective_setting_value("workfile");
	if (!configured.ok) {
		return configured;
	}

	const value = configured.value ?? DEFAULT_WORKFILE_NAME;
	const resolved = path.resolve(process.cwd(), value);

	// A directory names the conventional workfile inside it, so pointing the setting at a
	// project folder works as well as pointing it at the file.
	if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
		return ok(path.join(resolved, DEFAULT_WORKFILE_NAME));
	}

	return ok(resolved);
}
