/**
 * Scalar type of a setting's value.
 *
 * These are the names analog-attach's setting specs use (`config --json` lists them), so
 * a setting can be described to it without a translation table. `numeric` and `bool` are still stored as strings on
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
	"capi-path": Setting;
	/**
	 * The other module roots to load rulesets from — platform backends, driver
	 * collections, middleware. A `path_list`, so one setting covers however many repos
	 * are checked out.
	 */
	"module-paths": Setting;
	/** Which workfile the commands act on: they have no --workfile flag. */
	workfile: Setting;
	/** Board a new workfile is created for; also implies its platform. */
	board: Setting;
	/** Overrides the platform implied by `board`. */
	platform: Setting;
	/** Name of the generated project. */
	"project-name": Setting;
	/** Directory of the generated project: `generate` writes it, `build`/`deploy` act on it. */
	"project-path": Setting;
	"project-template": Setting;
	"build-command": Setting;
	"deploy-command": Setting;
	/** Debug probe `deploy` flashes through. */
	probe: Setting;
	/** Whether `add` fills in everything that leaves no room for choice (see bootstrap/). */
	bootstrap: Setting;
	/** Whether `add`, on a terminal, asks for what bootstrap leaves to the user. */
	interview: Setting;
	/** Whether main.c runs the parts' examples or the user's app_main() (see codegen). */
	example: Setting;
};
