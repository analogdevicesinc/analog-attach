import path from "node:path";
import { SettingsFile } from "./types";

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
	}
};

export const SCHEMAS_SUBPATH = "schemas";

export const DEFAULT_SYSTEM_CONFIG_PATH = path.join(".config", "analog-attach");
export const DEFAULT_SYSTEM_CONFIG_FILENAME = "config.json";
