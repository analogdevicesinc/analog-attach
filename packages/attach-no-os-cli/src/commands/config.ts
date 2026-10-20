import { buildCommand } from "@stricli/core";
import {
    SETTINGS_DEFAULTS,
    SETTING_CATEGORIES,
    Setting,
    SettingEnumSource,
    SettingsFile,
    board_peripheral_kinds,
    get_settings,
    get_settings_sources,
    is_target_setting,
    list_boards,
    set_setting_value,
    set_target_setting
} from "attach-no-os-lib";
import {
    prior_positionals,
    filter_completions,
    get_config_keys,
    get_config_value_suggestions,
    setting_options
} from "../completion/completion";
import { common_ok, type Config, type ConfigType, type ToolConfigResponse } from "../protocol/responses";
import { output, output_error } from "./shared";

type ConfigFlags = { json?: boolean; local?: boolean; reset?: boolean };

// --- config ---

export const configCommand = buildCommand<ConfigFlags, [string | undefined, string | undefined]>({
    docs: {
        brief: "Show or change CLI settings",
        fullDescription:
            "config                  shows every setting\n" +
            "config <key>            shows one setting, and the values it can take\n" +
            "config <key> <value>    sets it\n" +
            "config <key> --reset    clears it\n" +
            "Values are read from the project-local config (.analog-attach.json, searched for\n" +
            "upward from the current directory) and then from the global config. A write goes to\n" +
            "the project-local config when there is one, or with --local; to the global one otherwise."
    },
    parameters: {
        positional: {
            kind: "tuple",
            parameters: [
                {
                    placeholder: "key",
                    brief: "Setting to show or change (omit to show all of them)",
                    optional: true,
                    parse: String,
                    proposeCompletions(partial: string) {
                        return filter_completions(get_config_keys(), partial);
                    }
                },
                {
                    placeholder: "value",
                    brief: "Value to write (omit to show the setting)",
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
                brief: "When writing: write the project-local config, creating it here if there is none",
                optional: true
            },
            reset: { kind: "boolean", brief: "Clear <key> instead of writing a value", optional: true }
        }
    },
    func: async (flags: ConfigFlags, key?: string, value?: string) => {
        if (key === undefined) {
            if (flags.reset || flags.local) {
                output_error(flags, "--reset and --local need a setting: attach-noos config <key> [<value>] [--reset] [--local]");
                return;
            }
            show_settings(flags);
            return;
        }

        if (!(key in SETTINGS_DEFAULTS)) {
            output_error(flags, `Unknown setting: ${key}. Available: ${Object.keys(SETTINGS_DEFAULTS).join(", ")}`);
            return;
        }
        const field = key as keyof SettingsFile;

        if (flags.reset && value !== undefined) {
            output_error(flags, `Give '${key}' a value or --reset, not both.`);
            return;
        }

        if (value === undefined && !flags.reset) {
            if (flags.local) {
                output_error(flags, `--local only applies when writing: attach-noos config ${key} <value> --local`);
                return;
            }
            show_settings(flags, field);
            return;
        }

        write_setting(flags, field, flags.reset ? undefined : value);
    }
});

/** Every setting, or the one named. */
function show_settings(flags: ConfigFlags, field?: keyof SettingsFile): void {
    const settings = get_settings();
    if (!settings.ok) {
        output_error(flags, settings.error.message);
        return;
    }

    const selected = field === undefined ? Object.keys(settings.value) as (keyof SettingsFile)[] : [field];
    const configs = selected.map(name => to_config(name, settings.value[name]));

    const response: ToolConfigResponse = {
        ...common_ok(`${configs.length} setting${configs.length === 1 ? "" : "s"}`),
        configs
    };

    output(flags, format_configs(settings.value, selected), response);
}

/** Write one setting, or clear it with value undefined. */
function write_setting(flags: ConfigFlags, field: keyof SettingsFile, value: string | undefined): void {
    // A board and its platform are one choice: writing either keeps the other agreeing.
    if (is_target_setting(field)) {
        const written = set_target_setting(field, value, { local: flags.local });
        if (!written.ok) {
            output_error(flags, written.error.message);
            return;
        }
        const parts = Object.entries(written.value.changed).map(([name, changed]) =>
            changed === undefined ? `cleared '${name}'` : `set '${name}' to '${changed}'`);
        const said = parts.join(" and ");
        const reason = written.value.reason === undefined ? "" : ` (${written.value.reason})`;
        const message = `${said.charAt(0).toUpperCase()}${said.slice(1)}${reason}`;
        output(flags, message, common_ok(message));
        return;
    }

    const written = set_setting_value(field, value, { local: flags.local });
    if (!written.ok) {
        output_error(flags, written.error.message);
        return;
    }

    const message = value === undefined ? `Cleared '${field}'` : `Set '${field}' to '${value}'`;
    output(flags, message, common_ok(message));
}

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
        category: setting.category,
        description: setting.description,
        type: config_type(setting),
        required: setting.required,
        default: setting.default ?? null,
        value: setting.value ?? setting.default ?? null
    };
    /* eslint-enable unicorn/no-null */
}

function config_type(setting: Setting): ConfigType {
    const options = setting_options(setting);

    // An enum with nothing in it would be a field no value can satisfy, and the option
    // sets are scanned (a board list needs capi_path), so an unscannable one degrades to
    // the underlying scalar type rather than to an empty choice.
    if (options && options.length > 0) {
        return { options };
    }

    // `path_list` is ours, not part of attach-meta's `Config.type` vocabulary, so it is
    // reported as a path. The delimiter is in the setting's description, which is the only
    // place a prompt could learn it anyway; claiming a type attach-meta does not define
    // would make the manifest invalid for the sake of a hint it cannot use.
    if (setting.type === "path_list") {
        return "path";
    }

    return setting.type;
}

/**
 * Every board, with what makes one a fit: the chip it carries, and the peripheral kinds its
 * board.yml declares - a part on a SPI bus needs a board that declares `spi`.
 */
function describe_boards(current?: string): string[] {
    const boards = list_boards();
    if (!boards.ok) {
        return [`  (${boards.error.message})`];
    }

    const width = Math.max(...boards.value.map(board => board.name.length));
    return boards.value.map(board => {
        const kinds = board_peripheral_kinds(board.name);
        const declared = kinds.ok && kinds.value.length > 0 ? kinds.value.join(", ") : "no board.yml peripherals";
        const marker = board.name === current ? "●" : "○";
        return `  ${marker} ${board.name.padEnd(width)}  ${(board.soc ?? "?").padEnd(9)}  ${declared}`;
    });
}

/** Why a scanned option set is empty: the scan's own error, or where it looked. */
function empty_scan_reason(source: SettingEnumSource): string {
    if (source === "board") {
        const boards = list_boards();
        if (!boards.ok) {
            return boards.error.message;
        }
    }
    const what = source === "template" ? "template sets" : `${source}s`;
    return `no ${what} in the configured modules. Set capi_path and module_paths ` +
        "(attach-noos config capi_path <dir>; attach-noos config module_paths <dirs>)";
}

// --- Formatters ---

/** Options listed before the human rendering truncates. */
const OPTIONS_SHOWN = 15;

/** Marks a required setting in the list, explained by REQUIRED_LEGEND under it. */
const REQUIRED_MARK = "*";
const REQUIRED_LEGEND = `${REQUIRED_MARK} required: a command that needs it fails while it has no value (configured or default)`;

export function format_configs(settings: SettingsFile, selected: (keyof SettingsFile)[]): string {
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

    // As wide as the longest value: paths are long, and a fixed width ran them into Source.
    const width = Math.max(22, ...selected.map(field => (settings[field].value ?? settings[field].default ?? "-").length)) + 2;
    out += `    ${"Setting".padEnd(16)}${"Value".padEnd(width)}Source\n`;
    out += `  ${"─".repeat(2 + 16 + width + 18)}\n`;

    // Grouped by the question each setting answers, in the order someone sets things up.
    // Within a group, the settings keep their declared order.
    let first = true;
    for (const category of SETTING_CATEGORIES) {
        const fields = selected.filter(field => settings[field].category === category);
        if (fields.length === 0) {
            continue;
        }
        out += `${first ? "" : "\n"}  ${category}\n`;
        first = false;
        for (const field of fields) {
            const setting = settings[field];
            const value = setting.value ?? setting.default ?? "-";
            const source = setting_source(setting);
            const mark = setting.required ? REQUIRED_MARK : " ";
            out += `  ${mark} ${field.padEnd(16)}${value.padEnd(width)}${source}\n`;
        }
    }

    if (selected.some(field => settings[field].required)) {
        out += `\n  ${REQUIRED_LEGEND}\n`;
    }

    return out;
}

/** Where a setting's value comes from, for the Source column. */
function setting_source(setting: Setting): string {
    if (setting.value !== undefined) {
        return "configured";
    }
    if (setting.default !== undefined) {
        return "default";
    }
    return setting.required ? "unset (required)" : "unset";
}

function format_setting(field: string, setting: Setting): string {
    let out = `${field}\n\n`;
    out += `  ${"Value:".padEnd(14)}${setting.value ?? "(not set)"}\n`;
    out += `  ${"Default:".padEnd(14)}${setting.default ?? "-"}\n`;
    out += `  ${"Required:".padEnd(14)}${setting.required ? "yes" : "no"}\n`;
    out += `  ${"Type:".padEnd(14)}${setting.type}\n`;
    out += `  ${"Category:".padEnd(14)}${setting.category}\n`;
    out += `  ${"Description:".padEnd(14)}${setting.description}\n`;

    const options = setting_options(setting);
    if (options && options.length > 0) {
        out += "\n  Options:\n";
        if (field === "board") {
            // Each board with its chip and what its board.yml declares, so the choice can be
            // made from here.
            out += describe_boards(setting.value).map(line => `  ${line}\n`).join("");
        } else {
            // A scanned option set can be long, so the human listing is truncated.
            // `config --json` still carries all of them.
            const shown = options.slice(0, OPTIONS_SHOWN);
            for (const option of shown) {
                const marker = setting.value === option ? "●" : "○";
                out += `    ${marker} ${option}\n`;
            }
            if (options.length > shown.length) {
                out += `    … ${options.length - shown.length} more\n`;
            }
        }
    } else if (setting.enum_of !== undefined) {
        // A scanned set that came up empty is a configuration gap, not a free-form setting.
        out += `\n  Options:      none found: ${empty_scan_reason(setting.enum_of)}\n`;
    }

    out += `\n  Set it with:  attach-noos config ${field} <value>\n`;
    return out;
}
