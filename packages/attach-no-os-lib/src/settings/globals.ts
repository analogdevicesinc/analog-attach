import path from "node:path";
import type { SettingsFile } from "./types";

// Template set codegen renders with when `template_set` is unset. Declared before
// SETTINGS_DEFAULTS so the defaults can name it; kept in this module (not in
// codegen/template_sets.ts) so settings never imports codegen, which imports
// settings back.
export const DEFAULT_TEMPLATE_SET = "capi";

/**
 * Separator for a `path_list` setting. The OS path delimiter, so the setting reads and
 * edits like `PATH` does on the platform it is written on.
 */
export const PATH_LIST_DELIMITER = path.delimiter;

/** Debug probe `deploy` drives when `probe` is unset. */
export const DEFAULT_PROBE = "openocd";
export const PROBE_OPTIONS = ["openocd", "jlink"];

/** Workfile the commands act on when `workfile` is unset, resolved against the cwd. */
export const DEFAULT_WORKFILE_NAME = "workfile.json";

/**
 * Every configurable setting, with the metadata used to describe it (to a human, and to
 * attach-meta as a `Config`). Only `value` is ever read back from disk — everything here
 * is owned by this file, so a description or a default can be corrected without
 * migrating anybody's config.
 *
 * `required: true` is not just documentation: attach-meta's `init` prompts for exactly
 * the required settings that have no value and no default, so marking a setting required
 * puts it in the first-run questionnaire.
 */
export const SETTINGS_DEFAULTS: SettingsFile = {
	capi_path: {
		description: "Path to the root of the capi repository",
		required: true,
		type: "path",
		category: "paths",
	},
	// Every other module root. Rulesets name each other by bare C symbol, so a reference
	// reaches across repos without anybody declaring a dependency — which only works if
	// the repos holding those symbols are listed here. CAPI's own resolver cannot supply
	// this: it runs at CMake configure time from a project that does not exist yet when
	// AA is the thing generating it.
	module_paths: {
		description: "Module repositories to load rulesets from (platform backends, driver collections), separated like PATH",
		required: false,
		type: "path_list",
		category: "paths",
	},
	// attach-meta has no --workfile flag: it forwards nothing but the arguments its own
	// schema defines, so the workfile a command acts on has to come from config. Stored
	// relative by default so it follows whichever directory you are working in, which is
	// also what makes a single global config usable across projects.
	workfile: {
		description: "Workfile the commands act on, relative to the current directory unless absolute",
		required: true,
		type: "path",
		default: DEFAULT_WORKFILE_NAME,
		category: "workspace",
	},
	board: {
		description: "Board a new workfile targets; also decides its platform",
		required: true,
		type: "string",
		enum_of: "board",
		category: "workspace",
	},
	platform: {
		description: "Platform to use instead of the one implied by 'board'",
		required: false,
		type: "string",
		enum_of: "platform",
		category: "workspace",
	},
	project_name: {
		description: "Name of the generated project (unset: the name of the workfile's directory)",
		required: false,
		type: "string",
		category: "project",
	},
	output_path: {
		description: "Directory 'generate' writes the project into",
		required: false,
		type: "path",
		default: ".",
		category: "project",
	},
	project_path: {
		description: "Project directory 'build' and 'deploy' act on (unset: <output_path>/<project_name>)",
		required: false,
		type: "path",
		category: "project",
	},
	template_set: {
		description: "Template set used by codegen: a folder name under codegen/templates, or a path to your own template folder",
		required: false,
		type: "string",
		default: DEFAULT_TEMPLATE_SET,
		enum_of: "template_set",
		category: "project",
	},
	// CAPI builds with CMake and Kconfig from inside the project directory
	// (`cmake --preset <board>`), which needs a configure step rather than one command.
	// So these are escape hatches: set one to take over the step entirely, leave it unset
	// to let `attach-noos build`/`attach-noos deploy` drive CMake.
	build_command: {
		description: "Override the 'build' step with this command, run at the base of the project (unset: drive CMake directly)",
		required: false,
		type: "string",
		category: "build",
	},
	deploy_command: {
		description: "Override the 'deploy' step with this command, run at the base of the project (unset: build the CMake flash target)",
		required: false,
		type: "string",
		category: "build",
	},
	probe: {
		description: "Debug probe 'deploy' flashes through",
		required: false,
		type: "string",
		default: DEFAULT_PROBE,
		options: PROBE_OPTIONS,
		category: "build",
	},
};

export const DEFAULT_SYSTEM_CONFIG_PATH = path.join(".config", "analog-attach");
export const DEFAULT_SYSTEM_CONFIG_FILENAME = "config.json";

/**
 * Project-local config, searched for upward from the current directory. Mirrors how
 * attach-meta keeps its own `.attach-meta.toml` per directory: settings that belong to
 * one project (which board, which project name) go here and shadow the global config,
 * so switching projects is a `cd` rather than a series of `tool-config-set` calls.
 */
export const LOCAL_CONFIG_FILENAME = ".analog-attach.json";
