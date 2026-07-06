import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { is_settings_file, Setting, SettingsFile } from "./types";
import { DEFAULT_SYSTEM_CONFIG_FILENAME, DEFAULT_SYSTEM_CONFIG_PATH, SCHEMAS_SUBPATH } from "./globals";
import { Result, error, ok } from "../ruleset_parser/result";

let config_path_override: string | undefined;

// NOTE: This function is mainly for tests
export function set_config_path_override(path: string | undefined): void {
	config_path_override = path;
}

export function get_settings_file_path(): string {
	if (config_path_override !== undefined) {
		return config_path_override;
	}
	return path.join(os.homedir(), DEFAULT_SYSTEM_CONFIG_PATH, DEFAULT_SYSTEM_CONFIG_FILENAME);
}

export function get_settings(): Result<SettingsFile> {
	const config_path = get_settings_file_path();
	if (!fs.existsSync(config_path)) {
		return error(`No global config. Filepath ${config_path} does not exist`);
	}

	const content = fs.readFileSync(config_path, "utf8");
	const parsed = JSON.parse(content);
	if (!is_settings_file(parsed)) {
		return error(`Malformed settings file at: ${config_path}`);
	}

	return ok(parsed);
}

export function set_settings(settings: SettingsFile): Result<undefined> {
	const config_path = get_settings_file_path();
	const config_directory = path.dirname(config_path);

	if (!fs.existsSync(config_directory)) {
		fs.mkdirSync(config_directory, { recursive: true });
	}

	fs.writeFileSync(config_path, JSON.stringify(settings, undefined, 2), "utf8");
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
		return error(`Setting "${key}" has no value set`);
	}

	return ok(setting.value.value);
}

export function set_setting_value(key: keyof SettingsFile, value?: string): Result<undefined> {
	const data = get_settings();
	if (!data.ok) {
		return data;
	}

	const settings = data.value;

	if (!(key in settings)) {
		return error(`Unknown key: ${key}`);
	}

	settings[key].value = value;
	return set_settings(settings);
}

export function reset_setting_value(key: keyof SettingsFile): Result<undefined> {
	return set_setting_value(key);
}

export function get_schemas_path(): Result<string> {
	const result = get_setting_value("no_os_path");
	if (!result.ok) {
		return result;
	}
	return ok(path.join(result.value, SCHEMAS_SUBPATH));
}

const DEFAULT_WORKFILE_NAME = "workfile.json";

export function resolve_workfile_path(workfile_path?: string): string | undefined {
	if (!workfile_path) {
		return `./${DEFAULT_WORKFILE_NAME}`;
	}

	if (workfile_path.endsWith("/") || (fs.existsSync(workfile_path) && fs.statSync(workfile_path).isDirectory())) {
		return workfile_path.endsWith("/") ? `${workfile_path}${DEFAULT_WORKFILE_NAME}` : `${workfile_path}/${DEFAULT_WORKFILE_NAME}`;
	}

	// Custom filename provided - not supported
	return undefined;
}
