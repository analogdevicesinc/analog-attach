import { buildCommand, buildRouteMap } from "@stricli/core";
import fs from "node:fs";
import {
    create_workfile,
    export_minimal,
    load_resolved_ruleset,
    get_setting_value,
    PlatformSpecs,
    resolve_platform_from_board,
    add_symbol,
    resolve_workfile_path,
    list_available_structs
} from "attach-no-os-lib";
import type { AttachContext } from "./shared";
import {
    load_context,
    save_workfile,
    get_platform_specs,
    output,
    output_error
} from "./shared";
import {
    filter_completions,
    get_board_names,
    get_platform_names,
    get_schema_paths
} from "../completion/completion";

// --- Create Workfile ---

type AvailablePlatforms = {
    available_platforms: { name: string; description: string }[];
};

/**
 * Wrap text to the given width on word boundaries.
 * Returns one string per line (never empty; a blank input yields [""]).
 */
function wrap_text(text: string, width: number): string[] {
    const words = text.trim().split(/\s+/);
    const lines: string[] = [];
    let current = "";

    for (const word of words) {
        if (current.length === 0) {
            current = word;
        } else if (current.length + 1 + word.length <= width) {
            current += ` ${word}`;
        } else {
            lines.push(current);
            current = word;
        }
    }
    lines.push(current);

    return lines;
}

function describe_platforms(specs: PlatformSpecs): AvailablePlatforms {
    const available_platforms = Object.entries(specs).map(([name, manifest]) => ({
        name: name,
        description: manifest.description ?? "No description available"
    }));

    return { available_platforms };
}

const createWorkfileCommand = buildCommand<
    { platform?: string; board?: string; json?: boolean },
    [string | undefined]
>({
    docs: { brief: "Create a new workfile" },
    parameters: {
        positional: {
            kind: "tuple",
            parameters: [
                { placeholder: "workfile", brief: "Path for new workfile", optional: true, parse: String }
            ]
        },
        flags: {
            platform: {
                kind: "parsed",
                brief: "Target platform; only needed without a board (linux, mbed, max32662)",
                optional: true,
                parse: String,
                proposeCompletions(partial: string) {
                    return filter_completions(get_platform_names(), partial);
                }
            },
            board: {
                kind: "parsed",
                brief: "no-OS board to build for; sets the platform on its own (see: aa list boards)",
                optional: true,
                parse: String,
                proposeCompletions(partial: string) {
                    return filter_completions(get_board_names(), partial);
                }
            },
            json: { kind: "boolean", brief: "Output as JSON", optional: true }
        }
    },
    func: async (flags, workfile_path_argument) => {
        const specs = get_platform_specs();
        if (!specs.ok) {
            output_error(flags, "cannot_list_platforms", specs.error.message);
            return;
        }
        const platforms = describe_platforms(specs.value);

        // Nothing to go on: name the board flag first, since a board is what a user
        // has on the bench and it settles the platform on its own.
        if (flags.platform === undefined && flags.board === undefined) {
            let text = "No board or platform specified.\n\n";
            text += "Use: aa create workfile --board <name>       (see: aa list boards)\n";
            text += "     aa create workfile --platform <name>    (no board yet, or a platform with no boards)\n\n";
            text += "Available platforms:\n\n";
            for (const p of platforms.available_platforms) {
                text += `  ${p.name}\n`;
                for (const line of wrap_text(p.description, 76)) {
                    text += `      ${line}\n`;
                }
                text += "\n";
            }
            output(flags, text.trimEnd(), platforms);
            return;
        }

        // The board is the primary axis: it names its own platform, so --platform only
        // has to be given for the platforms that have no boards at all (linux, mbed,
        // max32662) or to create a workfile before the board is decided.
        let platform_name = flags.platform;
        let board_name: string | undefined;

        if (flags.board !== undefined) {
            const noos_path = get_setting_value("no_os_path");
            if (!noos_path.ok) {
                output_error(flags, "config_missing", "no_os_path is not configured. Run: aa config no_os_path <path>");
                return;
            }

            const resolved = resolve_platform_from_board(noos_path.value, flags.board, specs.value);
            if (!resolved.ok) {
                output_error(flags, "board_unresolved", resolved.error.message);
                return;
            }

            if (platform_name !== undefined && platform_name !== resolved.value.platform) {
                output_error(
                    flags,
                    "platform_mismatch",
                    `Board '${flags.board}' belongs to platform ${resolved.value.platform}, not ${platform_name}`
                );
                return;
            }

            platform_name = resolved.value.platform;
            board_name = resolved.value.board.name;
        }

        // Can only fail on --platform: a derived platform came out of `specs` already.
        const match = platforms.available_platforms.find(p => p.name === platform_name);
        if (!match) {
            output_error(flags, "platform_mismatch", `Platform ${platform_name} does not match the available platforms: ${platforms.available_platforms.map(p => p.name).join(", ")}`);
            return;
        }

        const workfile = create_workfile(platform_name);
        if (!workfile.ok) {
            output_error(flags, "create_failed", workfile.error.message);
            return;
        }

        // Recorded so the board travels with the workfile; `aa generate --board` still
        // overrides it, which is what makes building the same design for a second
        // board a one-flag change.
        if (board_name !== undefined) {
            workfile.value.board = board_name;
        }

        const minimal_workfile = export_minimal(workfile.value);
        if (!minimal_workfile.ok) {
            output_error(flags, "export_failed", minimal_workfile.error.message);
            return;
        }

        const workfile_path = resolve_workfile_path(workfile_path_argument);
        if (!workfile_path) {
            output_error(flags, "custom_filename_not_supported", "Custom workfile name not supported yet. Use a directory path or omit the path (current directory selected)");
            return;
        }

        fs.writeFileSync(workfile_path, JSON.stringify(minimal_workfile.value, undefined, 2));
        output(flags, `${workfile_path} created successfully.`, { ok: true, message: `${workfile_path} created successfully.` });
    }
});

// --- Create Node ---

const DISPLAY_MAX_IDS = 5;

type AvailableStructs = {
    devices: string[];
    noos: string[];
    platform: string[];
};

function format_available_structs(structs: AvailableStructs, platform?: string): string {
    let out = "Available schemas:\n\n";

    const format_section = (title: string, items: string[]) => {
        out += `  ${title}:\n`;
        const show = items.slice(0, DISPLAY_MAX_IDS);
        if (show.length === 0) {
            out += `    (none)\n\n`;
            return;
        }
        for (const item of show) {
            out += `    ${item}\n`;
        }
        if (items.length > DISPLAY_MAX_IDS) {
            out += `    ... (${items.length - DISPLAY_MAX_IDS} more)\n`;
        }
        out += "\n";
    };

    format_section("Devices", structs.devices);
    format_section("No-OS", structs.noos);
    format_section(`Platform${platform ? ` (${platform})` : ""}`, structs.platform);

    out += "Use: aa create node <name> <schema>\n";
    out += "Filter: aa create node --filter <term>";

    return out;
}

const createNodeCommand = buildCommand<
    { json?: boolean; filter?: string },
    [string | undefined, string | undefined],
    AttachContext
>({
    docs: { brief: "Create a new node" },
    parameters: {
        positional: {
            kind: "tuple",
            parameters: [
                { placeholder: "name", brief: "Node name", optional: true, parse: String },
                {
                    placeholder: "schema", brief: "Schema path", optional: true, parse: String,
                    proposeCompletions(partial: string) {
                        return filter_completions(get_schema_paths(), partial);
                    }
                }
            ]
        },
        flags: {
            filter: { kind: "parsed", brief: "Filter available schemas", optional: true, parse: String },
            json: { kind: "boolean", brief: "Output as JSON", optional: true },
        }
    },
    func: async function (flags, name, schema) {
        const context = load_context(this.workfile_path);
        if (!context.ok) {
            output_error(flags, "load_failed", context.error.message);
            return;
        }

        // Get available structs from lib
        const available = list_available_structs(context.value.workfile);
        if (!available.ok) {
            output_error(flags, "list_structs_failed", available.error.message);
            return;
        }

        const structs: AvailableStructs = {
            devices: available.value.devices,
            noos: available.value.noos,
            platform: available.value.platform
        };

        // No schema specified - show available schemas
        if (!schema) {
            let filtered = structs;
            if (flags.filter) {
                filtered = {
                    devices: structs.devices.filter(id => id.includes(flags.filter!)),
                    noos: structs.noos.filter(id => id.includes(flags.filter!)),
                    platform: structs.platform.filter(id => id.includes(flags.filter!))
                };
            }

            const text = format_available_structs(filtered, context.value.minimal.platform);
            output(flags, text, { ...filtered, selected_platform: context.value.minimal.platform });
            return;
        }

        if (!name) {
            output_error(flags, "missing_name", "Node name is required when specifying a schema");
            return;
        }

        if (flags.filter) {
            output_error(flags, "invalid_flags", "Cannot use the --filter flag when specifying a name and schema");
            return;
        }

        // Validate schema exists
        const all_schemas = [...structs.devices, ...structs.noos, ...structs.platform];
        if (!all_schemas.includes(schema)) {
            output_error(flags, "unknown_schema", `Unknown schema "${schema}", please check the list again`);
            return;
        }

        // Load and add the ruleset
        const ruleset = load_resolved_ruleset(schema);
        if (!ruleset.ok) {
            output_error(flags, "load_ruleset_failed", ruleset.error.message);
            return;
        }

        const changed = add_symbol(context.value.workfile, name, ruleset.value);
        if (!changed.ok) {
            output_error(flags, "add_symbol_failed", changed.error.message);
            return;
        }

        context.value.workfile = changed.value;

        const save = save_workfile(context.value);
        if (!save.ok) {
            output_error(flags, "save_failed", save.error.message);
            return;
        }

        output(flags, `${name} symbol created successfully to ${context.value.path}.`, { ok: true, message: `${name} symbol created successfully.` });
    }
});

export const createCommand = buildRouteMap({
    routes: {
        workfile: createWorkfileCommand,
        node: createNodeCommand,
    },
    docs: {
        brief: "Create workfile or node",
    },
});
