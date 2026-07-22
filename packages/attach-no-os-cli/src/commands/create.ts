import { buildCommand, buildRouteMap } from "@stricli/core";
import fs from "node:fs";
import path from "node:path";
import {
    create_workfile,
    export_minimal,
    get_schemas_path,
    load_resolved_ruleset,
    ok,
    Result,
    scan_platforms,
    add_symbol,
    resolve_workfile_path,
    list_available_structs
} from "attach-no-os-lib";
import {
    load_context,
    save_workfile,
    output,
    output_error
} from "./shared";
import {
    filter_completions,
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

function list_available_platforms(): Result<AvailablePlatforms> {
    const schemas_path = get_schemas_path();
    if (!schemas_path.ok) {
        return schemas_path;
    }

    const platforms_path = path.join(schemas_path.value, "platforms");
    const result = scan_platforms(platforms_path);
    if (!result.ok) {
        return result;
    }

    const available_platforms = Object.entries(result.value).map(([name, manifest]) => ({
        name: name,
        description: manifest.description ?? "No description available"
    }));

    return ok({ available_platforms });
}

const createWorkfileCommand = buildCommand<
    { platform?: string; json?: boolean },
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
                kind: "parsed", brief: "Target platform", optional: true, parse: String,
                proposeCompletions(partial: string) {
                    return filter_completions(get_platform_names(), partial);
                }
            },
            json: { kind: "boolean", brief: "Output as JSON", optional: true }
        }
    },
    func: async (flags, workfile_path_argument) => {
        const platforms = list_available_platforms();
        if (!platforms.ok) {
            output_error(flags, "cannot_list_platforms", platforms.error.message);
            return;
        }

        // No platform specified - show available platforms
        if (!flags.platform) {
            let text = "No platform specified. Available platforms:\n\n";
            for (const p of platforms.value.available_platforms) {
                text += `  ${p.name}\n`;
                for (const line of wrap_text(p.description, 76)) {
                    text += `      ${line}\n`;
                }
                text += "\n";
            }
            text += "Use: aa create workfile --platform <name>";
            output(flags, text, platforms.value);
            return;
        }

        // Validate platform
        const match = platforms.value.available_platforms.find(p => p.name === flags.platform);
        if (!match) {
            output_error(flags, "platform_mismatch", `Platform ${flags.platform} does not match the available platforms: ${platforms.value.available_platforms.map(p => p.name).join(", ")}`);
            return;
        }

        // Create workfile
        const workfile = create_workfile(flags.platform);
        if (!workfile.ok) {
            output_error(flags, "create_failed", workfile.error.message);
            return;
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
    [string | undefined, string | undefined]
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
    func: async (flags, name, schema) => {
        const context = load_context();
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
