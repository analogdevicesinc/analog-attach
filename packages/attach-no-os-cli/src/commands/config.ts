import { buildCommand } from "@stricli/core";
import {
    SETTINGS_DEFAULTS,
    Setting,
    SettingEnumSource,
    SettingsFile,
    get_settings,
    get_settings_sources,
    list_template_sets,
    set_setting_value
} from "attach-no-os-lib";
import {
    prior_positionals,
    filter_completions,
    get_board_names,
    get_config_keys,
    get_config_value_suggestions,
    get_platform_names
} from "../completion/completion";
import { common_ok, type Config, type ConfigType, type ToolConfigResponse } from "../protocol/responses";
import { output, output_error } from "./shared";

type ConfigGetFlags = { json?: boolean };
type ConfigSetFlags = { json?: boolean; local?: boolean; reset?: boolean };

// --- tool-config-get ---

export const toolConfigGetCommand = buildCommand<ConfigGetFlags, string[]>({
    docs: {
        brief: "Show CLI settings",
        fullDescription:
            "Shows every setting, or only the named ones.\n" +
            "Values are read from the project-local config (.analog-attach.json, searched for\n" +
            "upward from the current directory) and then from the global config."
    },
    parameters: {
        positional: {
            kind: "array",
            parameter: {
                placeholder: "field",
                brief: "Setting to show (default: all of them)",
                parse: String,
                proposeCompletions(partial: string) {
                    return filter_completions(get_config_keys(), partial);
                }
            }
        },
        flags: {
            json: { kind: "boolean", brief: "Output as JSON", optional: true }
        }
    },
    func: async (flags: ConfigGetFlags, ...fields: string[]) => {
        const settings = get_settings();
        if (!settings.ok) {
            output_error(flags, settings.error.message);
            return;
        }

        const unknown = fields.filter(field => !(field in settings.value));
        if (unknown.length > 0) {
            output_error(
                flags,
                `Unknown setting${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}. ` +
                `Available: ${Object.keys(settings.value).join(", ")}`
            );
            return;
        }

        const selected = (fields.length > 0 ? fields : Object.keys(settings.value)) as (keyof SettingsFile)[];
        const configs = selected.map(field => to_config(field, settings.value[field]));

        const response: ToolConfigResponse = {
            ...common_ok(`${configs.length} setting${configs.length === 1 ? "" : "s"}`),
            configs
        };

        output(flags, format_configs(settings.value, selected), response);
    }
});

// --- tool-config-set ---

export const toolConfigSetCommand = buildCommand<ConfigSetFlags, [string, string | undefined]>({
    docs: {
        brief: "Set a CLI setting",
        fullDescription:
            "Writes <field> = <value>.\n" +
            "The project-local config is written when one exists at or above the current\n" +
            "directory, or when --local is given; the global config otherwise."
    },
    parameters: {
        positional: {
            kind: "tuple",
            parameters: [
                {
                    placeholder: "field",
                    brief: "Setting to write",
                    parse: String,
                    proposeCompletions(partial: string) {
                        return filter_completions(get_config_keys(), partial);
                    }
                },
                {
                    placeholder: "value",
                    brief: "Value to write (omit with --reset to clear it)",
                    optional: true,
                    parse: String,
                    proposeCompletions(partial: string) {
                        const [field] = prior_positionals(this, 1);
                        return filter_completions(get_config_value_suggestions(field), partial);
                    }
                }
            ]
        },
        flags: {
            json: { kind: "boolean", brief: "Output as JSON", optional: true },
            local: {
                kind: "boolean",
                brief: "Write the project-local config, creating it here if there is none",
                optional: true
            },
            reset: { kind: "boolean", brief: "Clear the setting instead of writing a value", optional: true }
        }
    },
    func: async (flags: ConfigSetFlags, field: string, value?: string) => {
        if (!(field in SETTINGS_DEFAULTS)) {
            output_error(
                flags,
                `Unknown setting: ${field}. Available: ${Object.keys(SETTINGS_DEFAULTS).join(", ")}`
            );
            return;
        }

        const key = field as keyof SettingsFile;

        if (value === undefined && !flags.reset) {
            output_error(flags, `No value given for '${field}'. Pass one, or use --reset to clear it.`);
            return;
        }

        const written = set_setting_value(key, flags.reset ? undefined : value, { local: flags.local });
        if (!written.ok) {
            output_error(flags, written.error.message);
            return;
        }

        const message = flags.reset
            ? `Cleared '${field}'`
            : `Set '${field}' to '${value}'`;

        output(flags, message, common_ok(message));
    }
});

// --- Config conversion ---

/**
 * One setting as attach-meta's `Config`.
 *
 * `default` is the built-in fallback and nothing else. `value` is what a caller would get
 * if it read the setting now — the configured value, or the built-in default standing in
 * for it — which is what the protocol asks for: a required field with a default must read
 * as already satisfied, or `init` would prompt for a value that is already usable.
 *
 * `null` for both means "no default, nothing set", which is exactly the state that puts
 * the field in `init`'s `missing_fields`.
 */
export function to_config(field: keyof SettingsFile, setting: Setting): Config {
    /* eslint-disable unicorn/no-null */
    return {
        field_name: field,
        ...(setting.category === undefined ? {} : { category: setting.category }),
        description: setting.description,
        type: config_type(setting),
        required: setting.required,
        default: setting.default ?? null,
        value: setting.value ?? setting.default ?? null
    };
    /* eslint-enable unicorn/no-null */
}

function config_type(setting: Setting): ConfigType {
    const options = setting.options ?? (setting.enum_of ? resolve_enum(setting.enum_of) : undefined);

    // An enum with nothing in it would be a field no value can satisfy, and the option
    // sets are scanned (a board list needs no_os_path), so an unscannable one degrades to
    // the underlying scalar type rather than to an empty choice.
    if (options && options.length > 0) {
        return { options };
    }

    return setting.type;
}

function resolve_enum(source: SettingEnumSource): string[] {
    switch (source) {
        case "board": {
            return get_board_names();
        }
        case "platform": {
            return get_platform_names();
        }
        case "template_set": {
            return list_template_sets();
        }
    }
}

// --- Formatters ---

/** Options listed before the human rendering truncates. */
const OPTIONS_SHOWN = 15;

function format_configs(settings: SettingsFile, selected: (keyof SettingsFile)[]): string {
    const sources = get_settings_sources();

    let out = `Config: ${sources.global}\n`;
    if (sources.local) {
        out += `Local:  ${sources.local}  (overrides the above)\n`;
    }
    out += "\n";

    // A single field gets the full description; a list stays scannable.
    if (selected.length === 1) {
        return out + format_setting(selected[0], settings[selected[0]]);
    }

    out += `  ${"Setting".padEnd(16)}${"Value".padEnd(24)}Source\n`;
    out += `  ${"─".repeat(58)}\n`;

    for (const field of selected) {
        const setting = settings[field];
        const value = setting.value ?? setting.default ?? "-";
        const source = setting.value === undefined
            ? (setting.default === undefined ? (setting.required ? "unset (required)" : "unset") : "default")
            : "configured";
        out += `  ${field.padEnd(16)}${value.padEnd(24)}${source}\n`;
    }

    return out;
}

function format_setting(field: string, setting: Setting): string {
    let out = `${field}\n\n`;
    out += `  ${"Value:".padEnd(14)}${setting.value ?? "(not set)"}\n`;
    out += `  ${"Default:".padEnd(14)}${setting.default ?? "-"}\n`;
    out += `  ${"Required:".padEnd(14)}${setting.required ? "yes" : "no"}\n`;
    out += `  ${"Type:".padEnd(14)}${setting.type}\n`;
    if (setting.category) {
        out += `  ${"Category:".padEnd(14)}${setting.category}\n`;
    }
    out += `  ${"Description:".padEnd(14)}${setting.description}\n`;

    const options = setting.options ?? (setting.enum_of ? resolve_enum(setting.enum_of) : undefined);
    if (options && options.length > 0) {
        // A scanned option set can be long (there are a few hundred no-OS boards), so the
        // human listing is truncated. `tool-config-get --json` still carries all of them.
        const shown = options.slice(0, OPTIONS_SHOWN);
        out += "\n  Options:\n";
        for (const option of shown) {
            const marker = setting.value === option ? "●" : "○";
            out += `    ${marker} ${option}\n`;
        }
        if (options.length > shown.length) {
            out += `    … ${options.length - shown.length} more\n`;
        }
    }

    return out;
}
