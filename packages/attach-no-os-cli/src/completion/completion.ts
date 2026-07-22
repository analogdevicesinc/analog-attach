import {
    list_available_structs,
    import_minimal,
    suggest_for_property,
    scan_platforms,
    get_schemas_path,
    get_settings,
    SettingsFile,
    MinimalWorkfile,
} from "attach-no-os-lib";
import type { ApplicationContext } from "@stricli/core";
import fs from "node:fs";
import path from "node:path";

// Context passed to stricli's proposeCompletions. It carries the raw input
// words so per-parameter proposeCompletions hooks can read the positionals the
// user already typed (a hook's `this` is this object; stricli does not hand it
// the sibling positionals directly).
export type CompletionContext = ApplicationContext & { completionInputs?: readonly string[] };

/**
 * Positional arguments already typed for the current command.
 *
 * `prefix_len` is the number of route words used to reach the command
 * (1 for top-level commands like `read`, 2 for subcommands like `create node`).
 * The currently-typing token (last word) and any flags are excluded, leaving
 * only the completed positionals before the cursor.
 */
export function prior_positionals(context: CompletionContext, prefix_length: number): string[] {
    const after = (context.completionInputs ?? []).slice(prefix_length);
    return after.slice(0, -1).filter(word => !word.startsWith("-"));
}

export function filter_completions(suggestions: string[], partial: string): string[] {
    if (!partial) {
        return suggestions;
    }
    return suggestions.filter(s => s.startsWith(partial));
}

function load_workfile_for_completion(): MinimalWorkfile | undefined {
    const workfile_path = path.join(process.cwd(), "workfile.json");
    if (!fs.existsSync(workfile_path)) {
        return;
    }
    try {
        const content = fs.readFileSync(workfile_path, "utf8");
        return JSON.parse(content) as MinimalWorkfile;
    } catch {
        return;
    }
}

// --- Data fetchers ---

export function get_node_names(): string[] {
    const minimal = load_workfile_for_completion();
    if (!minimal?.symbols) {
        return [];
    }
    return Object.keys(minimal.symbols);
}

export function get_property_names(node_name: string): string[] {
    const minimal = load_workfile_for_completion();
    if (!minimal) {
        return [];
    }

    const result = import_minimal(minimal);
    if (!result.ok) {
        return [];
    }

    const symbol = result.value.symbols[node_name];
    // Both structs and descriptors carry properties (a descriptor's single init_param).
    if (!symbol || (symbol._t !== "RulesetStruct" && symbol._t !== "RulesetDescriptor")) {
        return [];
    }

    return symbol.properties.filter(p => !p.disabled).map(p => p.name);
}

export function get_value_suggestions(node_name: string, property_name: string): string[] {
    const minimal = load_workfile_for_completion();
    if (!minimal) {
        return [];
    }

    const result = import_minimal(minimal);
    if (!result.ok) {
        return [];
    }

    const suggestions = suggest_for_property(result.value, node_name, property_name);
    if (!suggestions.ok) {
        return [];
    }

    return suggestions.value.values ?? [];
}

export function get_union_value_suggestions(node_name: string, property_name: string, member_name: string): string[] {
    const minimal = load_workfile_for_completion();
    if (!minimal) {
        return [];
    }

    const result = import_minimal(minimal);
    if (!result.ok) {
        return [];
    }

    // The lib resolves the union member's include type and returns the matching symbols.
    const suggestions = suggest_for_property(result.value, node_name, property_name, member_name);
    if (!suggestions.ok) {
        return [];
    }

    return suggestions.value.values ?? [];
}

export function get_config_keys(): string[] {
    const settings = get_settings();
    if (!settings.ok) {
        return [];
    }
    return Object.keys(settings.value);
}

export function get_config_value_suggestions(key: string): string[] {
    const settings = get_settings();
    if (!settings.ok) {
        return [];
    }

    const setting = settings.value[key as keyof SettingsFile];
    if (!setting) {
        return [];
    }

    // Suggest the current value, falling back to the default, so the user can
    // tab it in and edit rather than retype it from scratch.
    const suggestion = setting.value ?? setting.default;
    return suggestion ? [suggestion] : [];
}

export function get_platform_names(): string[] {
    const schemas_path = get_schemas_path();
    if (!schemas_path.ok) {
        return [];
    }

    const platforms_path = path.join(schemas_path.value, "platforms");
    const result = scan_platforms(platforms_path);
    if (!result.ok) {
        return [];
    }

    return Object.keys(result.value);
}

export function get_schema_paths(): string[] {
    const minimal = load_workfile_for_completion();
    if (!minimal) {
        return [];
    }

    const result = import_minimal(minimal);
    if (!result.ok) {
        return [];
    }

    const available = list_available_structs(result.value);
    if (!available.ok) {
        return [];
    }

    return [
        ...available.value.devices,
        ...available.value.noos,
        ...available.value.platform,
    ];
}
