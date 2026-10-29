import fs from "node:fs";
import path from "node:path";
import type { Setting, SettingsFile } from "./types";
import { DEFAULT_WORKFILE_NAME, PATH_LIST_DELIMITER, SETTINGS_DEFAULTS } from "./globals";
import type { Result } from "../ruleset_parser/result";
import { error, ok } from "../ruleset_parser/result";
import { reset_registry } from "../registry/registry";

/**
 * Where the lib reads its settings from. The lib never reads a settings file itself: the
 * program that uses it (the analog-attach CLI) owns the files, their layering and their
 * checks, and installs a view of them with `use_settings` before it calls in. The shape is
 * the part of the CLI's `SettingsView` the lib reads, declared here so the lib depends on
 * nothing of the CLI's.
 */
export interface SettingsSource {
	/**
	 * The effective value of a setting (configured, else its default), as a string. A path
	 * is absolute. Undefined when nothing is set and there is no default, and for a
	 * `path_list`.
	 */
	get(key: string): string | undefined;
	/** A `path_list` setting's entries, each absolute. Undefined when unset. */
	paths(key: string): readonly string[] | undefined;
}

let source: SettingsSource | undefined;

/** Nothing configured, only the defaults: what the lib reads until `use_settings` is called. */
function current(): SettingsSource {
	source ??= memory_settings({});
	return source;
}

/**
 * Read the settings from `view` from now on; none goes back to no settings. A new
 * source drops the registry, which is built from the module roots it names.
 */
export function use_settings(view?: SettingsSource): void {
	if (view !== source) {
		source = view;
		reset_registry();
	}
}

function defaults_of(key: string): Setting | undefined {
	return (SETTINGS_DEFAULTS as unknown as Partial<Record<string, Setting>>)[key];
}

/**
 * A source held in memory, for tests and for callers with no settings files: `values` by
 * key, a `path_list` as an array. A key it doesn't have reads as its default in
 * `SETTINGS_DEFAULTS`. A relative path (`workfile.json`, the default workfile) is resolved
 * against `root`, as the CLI resolves one against the project root.
 */
export function memory_settings(values: Readonly<Record<string, string | readonly string[]>>, root = "/"): SettingsSource {
	return {
		get(key) {
			const value = values[key];
			if (Array.isArray(value)) {
				return;
			}
			const defaults = defaults_of(key);
			const effective = typeof value === "string" ? value : defaults?.default;
			if (effective === undefined) {
				return;
			}
			return defaults?.type === "path" ? path.resolve(root, effective) : effective;
		},
		paths(key) {
			const value = values[key];
			return Array.isArray(value) ? (value as readonly string[]).map(entry => path.resolve(root, entry)) : undefined;
		},
	};
}

/** A setting's effective value as one string: a `path_list` joined like PATH. */
function read(key: keyof SettingsFile): string | undefined {
	if (SETTINGS_DEFAULTS[key].type === "path_list") {
		return current().paths(key)?.join(PATH_LIST_DELIMITER);
	}
	return current().get(key);
}

/** Every setting, its `value` the effective one. */
export function get_settings(): Result<SettingsFile> {
	const settings = {} as SettingsFile;
	for (const [key, defaults] of Object.entries(SETTINGS_DEFAULTS) as [keyof SettingsFile, Setting][]) {
		const value = read(key);
		settings[key] = value === undefined ? { ...defaults } : { ...defaults, value };
	}
	return ok(settings);
}

export function get_setting(key: keyof SettingsFile): Result<Setting> {
	const defaults = defaults_of(key);
	if (defaults === undefined) {
		return error(`Cannot find key "${key}" in settings. Available options: "${Object.keys(SETTINGS_DEFAULTS).join(", ")}"`);
	}
	const value = read(key);
	return ok(value === undefined ? { ...defaults } : { ...defaults, value });
}

/** The value, or an error naming the `config` command that sets it. */
export function get_setting_value(key: keyof SettingsFile): Result<string> {
	const setting = get_setting(key);
	if (!setting.ok) {
		return setting;
	}

	if (setting.value.value === undefined) {
		return error(`Setting "${key}" is not configured. Run: analog-attach config ${key} <value>`);
	}

	return ok(setting.value.value);
}

/** The value a command should use: what was configured, or the default. */
export function get_effective_setting_value(key: keyof SettingsFile): Result<string | undefined> {
	const setting = get_setting(key);
	if (!setting.ok) {
		return setting;
	}

	return ok(setting.value.value ?? setting.value.default);
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

/** Whether `add` asks, on a terminal, for what bootstrap leaves to the user. On unless explicitly off. */
export function interview_enabled(): boolean {
	return setting_on("interview");
}

function setting_on(key: "bootstrap" | "example" | "interview"): boolean {
	const configured = get_effective_setting_value(key);
	if (!configured.ok || configured.value === undefined) {
		return true;
	}
	return !["false", "0", "no", "off"].includes(configured.value.trim().toLowerCase());
}

/** Root of the capi checkout, which every other module's rulesets reference into. */
export function get_capi_path(): Result<string> {
	return get_setting_value("capi-path");
}

/**
 * Every module root to load rulesets from, capi first. `module-paths` is optional: capi
 * alone is a valid (if driver-less) configuration.
 */
export function get_module_roots(): Result<string[]> {
	const capi = get_capi_path();
	if (!capi.ok) {
		return capi;
	}

	const extra = (current().paths("module-paths") ?? [])
		.map(entry => entry.trim())
		.filter(entry => entry.length > 0);

	return ok([capi.value, ...extra]);
}

/**
 * Absolute path of the workfile every command acts on. The source gives it absolute (the
 * CLI resolves a relative one against the project root); a directory names the
 * conventional workfile inside it.
 */
export function get_workfile_path(): Result<string> {
	const configured = get_effective_setting_value("workfile");
	if (!configured.ok) {
		return configured;
	}
	if (configured.value === undefined) {
		return error("Setting \"workfile\" is not configured. Run: analog-attach config workfile <path>");
	}

	const resolved = path.resolve(configured.value);

	// A directory names the conventional workfile inside it, so pointing the setting at a
	// project folder works as well as pointing it at the file.
	if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
		return ok(path.join(resolved, DEFAULT_WORKFILE_NAME));
	}

	return ok(resolved);
}

if (import.meta.vitest) {
	const { test, expect, afterEach } = import.meta.vitest;

	afterEach(() => { use_settings(); });

	test("no source: nothing is configured, the defaults still read", () => {
		use_settings();
		expect(get_capi_path().ok).toBe(false);
		expect(get_effective_setting_value("probe")).toEqual({ ok: true, value: "openocd" });
		expect(bootstrap_enabled()).toBe(true);
	});

	test("memory_settings: values, defaults, paths resolved against the root, a path_list joined like PATH", () => {
		use_settings(memory_settings({ "capi-path": "/c", "module-paths": ["/m1", "m2"], bootstrap: "off" }, "/p"));
		expect(get_capi_path()).toEqual({ ok: true, value: "/c" });
		expect(get_module_roots()).toEqual({ ok: true, value: ["/c", "/m1", "/p/m2"] });
		expect(get_effective_setting_value("module-paths")).toEqual({ ok: true, value: ["/m1", "/p/m2"].join(PATH_LIST_DELIMITER) });
		expect(get_workfile_path()).toEqual({ ok: true, value: "/p/workfile.json" });
		expect(bootstrap_enabled()).toBe(false);
		expect(interview_enabled()).toBe(true);
	});
}
