/**
 * Scalar type of a setting's value.
 *
 * These are the names attach-meta's `Config.type` uses, so a setting can be described to
 * it without a translation table. `numeric` and `bool` are still stored as strings on
 * disk — the type is a hint for editors and prompts, not a storage format.
 */
export type SettingType = "path" | "string" | "numeric" | "bool";

/**
 * Names an option set that has to be scanned rather than hardcoded (the schema tree for
 * platforms and boards, the templates folder for template sets). Resolved by whoever is
 * describing the setting, not here: settings must not import the scanners, because
 * codegen and the schema loaders import settings.
 */
export type SettingEnumSource = "platform" | "board" | "template_set";

export interface Setting {
	/** The configured value. The only part of a setting that lives on disk. */
	value?: string;
	description: string;
	required: boolean;
	default?: string;
	type: SettingType;
	/** Grouping hint for display, e.g. "paths", "project", "build". */
	category?: string;
	/** Fixed option set, for settings whose choices are known at compile time. */
	options?: string[];
	/** Option set that must be scanned. Mutually exclusive with `options`. */
	enum_of?: SettingEnumSource;
};

export interface SettingsFile {
	/** Path to the no-OS checkout. Everything else is resolved relative to it. */
	no_os_path: Setting;
	/** Which workfile the commands act on, now that attach-meta has no --workfile flag. */
	workfile: Setting;
	/** Board a new workfile is created for; also implies its platform. */
	board: Setting;
	/** Overrides the platform implied by `board`. */
	platform: Setting;
	/** Name of the generated project. */
	project_name: Setting;
	/** Directory the project is generated into. */
	output_path: Setting;
	/** Directory `build`/`deploy` act on. */
	project_path: Setting;
	template_set: Setting;
	build_command: Setting;
	deploy_command: Setting;
	/** Debug probe `deploy` flashes through. */
	probe: Setting;
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
	// Keys a config file must already contain. Settings added after the first
	// release (e.g. `template_set`, `workfile`) are deliberately absent: an older
	// config on disk is still valid, and every setting's metadata is taken from
	// SETTINGS_DEFAULTS on read anyway, so a new setting cannot invalidate a file
	// that predates it.
	const required_keys: (keyof SettingsFile)[] = ["no_os_path", "build_command", "deploy_command"];

	for (const key of required_keys) {
		if (!(key in object) || !is_setting(object[key])) {
			return false;
		}
	}

	return true;
}
