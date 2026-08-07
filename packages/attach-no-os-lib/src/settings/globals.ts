import path from "node:path";
import type { SettingsFile } from "./types";

// Template set codegen renders with when `template_set` is unset. Declared before
// SETTINGS_DEFAULTS so the defaults can name it; kept in this module (not in
// codegen/template_sets.ts) so settings never imports codegen, which imports
// settings back.
export const DEFAULT_TEMPLATE_SET = "no-os";

export const SETTINGS_DEFAULTS: SettingsFile = {
	no_os_path: {
		description: "Path to the root of the no-OS repository",
		required: true,
	},
	build_command: {
		description: "Command to run at the base of the project at the 'build' step",
		required: false,
		default: "make"
	},
	deploy_command: {
		description: "Command to run at the base of the project at the 'deploy' step",
		required: false,
		default: "make run"
	},
	template_set: {
		description: "Template set used by codegen: a folder name under codegen/templates, or a path to your own template folder",
		required: false,
		default: DEFAULT_TEMPLATE_SET
	}
};

export const SCHEMAS_SUBPATH = "schemas";

export const DEFAULT_SYSTEM_CONFIG_PATH = path.join(".config", "analog-attach");
export const DEFAULT_SYSTEM_CONFIG_FILENAME = "config.json";
