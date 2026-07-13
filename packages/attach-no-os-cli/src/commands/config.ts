import { buildCommand } from "@stricli/core";
import {
    Setting,
    SettingsFile,
    get_setting_value,
    get_settings,
    set_setting_value,
    ok,
    Result,
    get_settings_file_path
} from "attach-no-os-lib";

export const configCommand = buildCommand<{ json?: boolean; reset?: boolean }, [string | undefined, string | undefined]>({
	docs: {
		brief: "Manage CLI settings",
	},
	parameters: {
		positional: {
			kind: "tuple",
			parameters: [
				{ placeholder: "key", brief: "Settings key", optional: true, parse: String },
				{ placeholder: "value", brief: "Value to set", optional: true, parse: String }
			]
		},
		flags: {
			json: {
				kind: "boolean",
				brief: "Output as JSON",
				optional: true
			},
			reset: {
				kind: "boolean",
				brief: "",
				optional: true
			}
		}
	},
	func: async (flags: { json?: boolean, reset?: boolean }, key, value) => {
		if (!key) {
			const data = get_config_list();
			if (!data.ok) {
				console.log(data.error);
				return;
			}

			if (flags.json) {
				console.log(JSON.stringify(data.value, undefined, 2));
			} else {
				console.log(format_config_list(data.value));
			}
		}
	
		if (key && !value) {
			const data = get_settings();
			if (!data.ok) {
				console.log(data.error);
				return;
			}

			const setting = data.value;

			switch (key) {
				case "no_os_path": {
					if (flags.json) {
						console.log(JSON.stringify(setting.no_os_path, undefined, 2));
					} else {
						console.log(format_single_config(key, setting.no_os_path));
					}
					break;
				}
				case "build_command": {
					if (flags.json) {
						console.log(JSON.stringify(setting.build_command, undefined, 2));
					} else {
						console.log(format_single_config(key, setting.build_command));
					}
					break;
				}
				case "deploy_command": {
					if (flags.json) {
						console.log(JSON.stringify(setting.deploy_command, undefined, 2));
					} else {
						console.log(format_single_config(key, setting.deploy_command));
					}
					break;
				}
				default: {
					console.warn(`Unknown setting: ${value}`);
				}
			}
		}

		if (key && value) {
			const data = get_config_list();
			if (!data.ok) {
				console.log(data.error);
				return;
			}

			switch (key) {
				case "no_os_path":
				case "build_command":
				case "deploy_command":{
					key_value_set(key, value, flags);
					break;
				}
				default: {
					console.warn(`Unknown setting: ${value}`);
					break;
				}
			}
		}
	}
});

function key_value_set(key: keyof SettingsFile, value: string, flags: { json?: boolean, reset?: boolean }) {
	const result = set_setting_value(key, value);
	if (!result.ok) {
		console.log(result.error);
		return;
	}

	const readback = get_setting_value(key);
	if (!readback.ok) {
		console.log(readback.error);
		return;
	}

	if (flags.json) {
		console.log(JSON.stringify(readback.value, undefined, 2));
	} else {
		console.log(`Value: ${readback.value}`);
	}
	return;
}

type ConfigListOutput = {
	config_file: string;
	settings: SettingsFile;
};

// Formatter
function format_single_config(key: string, setting: Setting): string {
		const value = setting.value ?? "-";
		const _default = setting.default ?? "-";
		const required = setting.required ? "yes" : "no";
		const description = setting.description ?? "-";

		return `${key.padEnd(20)}
	${"Value".padEnd(20)}: ${value}
	${"Required".padEnd(20)}: ${required}
	${"Description".padEnd(20)}: ${description}
	${"Default".padEnd(20)}: ${_default}\n`;
}

function format_config_list(data: ConfigListOutput): string {
	let out = `Config: ${data.config_file}\n\n`;
	for (const [key, setting] of Object.entries(data.settings)) {
		const value = setting.value ?? setting.default ?? "-";
		const required = setting.required ? " (required)" : "";
		out += ` ${setting.required ? "* " : "  "}${key.padEnd(20)} ${value.padEnd(10)} ${required.padEnd(10)}\n`;
	}
	return out;
}

function get_config_list(): Result<ConfigListOutput> {
	const settings = get_settings();
	if (!settings.ok) {
		return settings;
	}

	return ok({
		config_file: get_settings_file_path(),
		settings: settings.value,
	});
}
