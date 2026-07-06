export type Setting = {
	value?: string;
	description: string;
	required: boolean;
	default?: string;
};

export type SettingsFile = {
	no_os_path: Setting;
	build_command: Setting;
	deploy_command: Setting;
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
	const required_keys: (keyof SettingsFile)[] = ["no_os_path", "build_command", "deploy_command"];

	for (const key of required_keys) {
		if (!(key in object) || !is_setting(object[key])) {
			return false;
		}
	}

	return true;
}
