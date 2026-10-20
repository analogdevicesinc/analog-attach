/**
 * Scalar type of a setting's value.
 *
 * These are the names attach-meta's `Config.type` uses, so a setting can be described to
 * it without a translation table. `numeric` and `bool` are still stored as strings on
 * disk — the type is a hint for editors and prompts, not a storage format.
 */
export type SettingType = "path" | "path_list" | "string" | "numeric" | "bool";

/**
 * Names an option set that has to be scanned rather than hardcoded (the schema tree for
 * platforms and boards, the templates folder for template sets). Resolved by whoever is
 * describing the setting, not here: settings must not import the scanners, because
 * codegen and the schema loaders import settings.
 */
export type SettingEnumSource = "platform" | "board" | "template";

/**
 * The question a setting answers, in the order someone sets things up: where CAPI comes
 * from, what hardware, which workfile, what `generate` makes, how it is built and flashed.
 * `config` lists the settings grouped under these, in this order.
 */
export const SETTING_CATEGORIES = ["sources", "target", "workfile", "project", "build"] as const;
export type SettingCategory = typeof SETTING_CATEGORIES[number];

export interface Setting {
	/** The configured value. The only part of a setting that lives on disk. */
	value?: string;
	description: string;
	required: boolean;
	default?: string;
	type: SettingType;
	/** The group `config` lists it under. */
	category: SettingCategory;
	/** Fixed option set, for settings whose choices are known at compile time. */
	options?: string[];
	/** Option set that must be scanned. Mutually exclusive with `options`. */
	enum_of?: SettingEnumSource;
};

export interface SettingsFile {
	/**
	 * Path to the capi checkout. Special among the module roots: it holds the interface
	 * catalog and the generic ruleset tree every other module's rulesets reference.
	 */
	capi_path: Setting;
	/**
	 * The other module roots to load rulesets from — platform backends, driver
	 * collections, middleware. A `path_list`, so one setting covers however many repos
	 * are checked out.
	 */
	module_paths: Setting;
	/** Which workfile the commands act on, now that attach-meta has no --workfile flag. */
	workfile: Setting;
	/** Board a new workfile is created for; also implies its platform. */
	board: Setting;
	/** Overrides the platform implied by `board`. */
	platform: Setting;
	/** Name of the generated project. */
	project_name: Setting;
	/** Directory of the generated project: `generate` writes it, `build`/`deploy` act on it. */
	project_path: Setting;
	template: Setting;
	build_command: Setting;
	deploy_command: Setting;
	/** Debug probe `deploy` flashes through. */
	probe: Setting;
	/** Whether `add` fills in everything that leaves no room for choice (see bootstrap/). */
	bootstrap: Setting;
	/** Whether main.c runs the parts' examples or the user's app_main() (see codegen). */
	example: Setting;
};

export function is_setting(value: unknown): value is Setting {
	if (typeof value !== "object" || value === null) {
		return false;
	}

	const object = value as Record<string, unknown>;

	if (typeof object.description !== "string") {
		return false;
	}
	if (typeof object.required !== "boolean") {
		return false;
	}
	if (object.value !== undefined && typeof object.value !== "string") {
		return false;
	}
	if (object.default !== undefined && typeof object.default !== "string") {
		return false;
	}

	return true;
}

export function is_settings_file(value: unknown): value is SettingsFile {
	if (typeof value !== "object" || value === null) {
		return false;
	}

	const object = value as Record<string, unknown>;
	// Keys a config file must already contain. Most settings are deliberately absent:
	// every setting's metadata is taken from SETTINGS_DEFAULTS on read, so a config
	// missing a key is still valid and a newly added setting cannot invalidate a file
	// that predates it. `capi_path` is here because nothing can be loaded without it, so
	// a config lacking it is a config from before the CAPI move rather than merely an
	// incomplete one, and saying so beats failing later with an empty registry.
	const required_keys: (keyof SettingsFile)[] = ["capi_path", "build_command", "deploy_command"];

	for (const key of required_keys) {
		if (!(key in object) || !is_setting(object[key])) {
			return false;
		}
	}

	return true;
}
