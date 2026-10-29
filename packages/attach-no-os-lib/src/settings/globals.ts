import path from "node:path";
import type { SettingsFile } from "./types";

// Template set codegen renders with when `project-template` is unset. Declared before
// SETTINGS_DEFAULTS so the defaults can name it; kept in this module (not in
// codegen/template_sets.ts) so settings never imports codegen, which imports
// settings back.
export const DEFAULT_TEMPLATE_SET = "capi";

/** The template set of an app that serves its devices over IIO: `add <driver>` picks IIO roots for it. */
export const IIO_TEMPLATE_SET = "capi-iio";

/**
 * Separator for a `path_list` setting. The OS path delimiter, so the setting reads and
 * edits like `PATH` does on the platform it is written on.
 */
export const PATH_LIST_DELIMITER = path.delimiter;

/** Debug probe `deploy` drives when `probe` is unset. */
export const DEFAULT_PROBE = "openocd";
export const PROBE_OPTIONS = ["openocd", "jlink"];

/** Workfile the commands act on when `workfile` is unset, resolved against the project root. */
export const DEFAULT_WORKFILE_NAME = "workfile.json";

/**
 * Every configurable setting, with the metadata used to describe it (to a human, and to
 * analog-attach's `config` as a setting spec). Only `value` is ever read back from disk —
 * everything here is owned by this file, so a description or a default can be corrected
 * without migrating anybody's config.
 *
 * `required: true` is not just documentation: analog-attach's `config` marks the required
 * settings and prints the hint of each one that has no value and no default.
 */
export const SETTINGS_DEFAULTS: SettingsFile = {
	"capi-path": {
		description: "Path to the root of the capi repository",
		required: true,
		type: "path",
		category: "sources",
	},
	// Every other module root. Rulesets name each other by bare C symbol, so a reference
	// reaches across repos without anybody declaring a dependency — which only works if
	// the repos holding those symbols are listed here. CAPI's own resolver cannot supply
	// this: it runs at CMake configure time from a project that does not exist yet when
	// AA is the thing generating it.
	"module-paths": {
		description: "Module repositories to load rulesets from (platform backends, driver collections)",
		required: false,
		type: "path_list",
		category: "sources",
	},
	// The commands have no --workfile flag, so the workfile a command acts on has to come
	// from config. Stored relative by default so it follows whichever directory you are
	// working in, which is also what makes a single global config usable across projects.
	workfile: {
		description: "Workfile the commands act on, relative to the project root unless absolute",
		required: true,
		type: "path",
		default: DEFAULT_WORKFILE_NAME,
		category: "workfile",
	},
	board: {
		description: "Board a new workfile targets; setting it also sets 'platform' to the chip it carries",
		required: true,
		type: "string",
		enum_of: "board",
		category: "target",
	},
	platform: {
		description: "Chip a new workfile targets, for a chip with no board of its own; setting it clears a 'board' that carries another chip",
		required: false,
		type: "string",
		enum_of: "platform",
		category: "target",
	},
	"project-name": {
		description: "Name of the generated project (unset: the name of the workfile's directory)",
		required: false,
		type: "string",
		category: "project",
	},
	"project-path": {
		description: "Directory of the generated project: 'generate' writes it, 'build' and 'deploy' act on it (unset: out/<project-name>)",
		required: false,
		type: "path",
		category: "project",
	},
	"project-template": {
		description: "Template set used by codegen: a folder name under codegen/templates, or a path to your own template folder",
		required: false,
		type: "string",
		default: DEFAULT_TEMPLATE_SET,
		enum_of: "template",
		category: "project",
	},
	// CAPI builds with CMake and Kconfig from inside the project directory
	// (`cmake --preset <board>`), which needs a configure step rather than one command.
	// So these are escape hatches: set one to take over the step entirely, leave it unset
	// to let `analog-attach build`/`analog-attach deploy` drive CMake.
	"build-command": {
		description: "Override the 'build' step with this command, run at the base of the project (unset: drive CMake directly)",
		required: false,
		type: "string",
		category: "build",
	},
	"deploy-command": {
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
	// A setting rather than a flag, like `workfile`. `required: false` with a default keeps
	// it out of the required settings `config` reports as unset.
	bootstrap: {
		description: "After 'add', fill in every value and node that leaves no room for choice (true/false)",
		required: false,
		type: "bool",
		default: "true",
		options: ["true", "false"],
		category: "workfile",
	},
	// The counterpart of bootstrap, for what it cannot decide: on a terminal, `add` asks for
	// the choices and the values left to the user. Never in --json or a pipe.
	interview: {
		description: "After 'add', on a terminal, ask for the choices and values bootstrap leaves to you (true/false)",
		required: false,
		type: "bool",
		default: "true",
		options: ["true", "false"],
		category: "workfile",
	},
	example: {
		description: "Have the generated main.c run each part's example (true), or your own app_main() in src/app.c (false)",
		required: false,
		type: "bool",
		default: "true",
		options: ["true", "false"],
		category: "project",
	},
};
