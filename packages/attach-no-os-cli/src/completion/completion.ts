import {
    list_available_structs,
    import_minimal,
    suggest_for_property,
    scan_platforms,
    get_schemas_path,
    MinimalWorkfile,
} from "attach-no-os-lib";
import fs from "node:fs";
import path from "node:path";

type CompletionContext = {
    words: string[];
    current: string;
};

function parse_completion_line(line: string): CompletionContext {
    // line is like "aa update acc" or "aa update accel "
    // Split by spaces, keeping track of whether line ends with space
    const trimmed = line.trim();
    const parts = trimmed.split(/\s+/).filter(Boolean);

    // Remove the command name (aa)
    parts.shift();

    // If line ends with space, user is starting a new word
    const ends_with_space = line.endsWith(" ");

    if (ends_with_space) {
        return { words: parts, current: "" };
    } else {
        // User is typing the last word
        const current = parts.pop() ?? "";
        return { words: parts, current };
    }
}

function filter_completions(suggestions: string[], partial: string): string[] {
    if (!partial) return suggestions;
    return suggestions.filter(s => s.startsWith(partial));
}

function load_workfile_for_completion(): MinimalWorkfile | null {
    const workfile_path = path.join(process.cwd(), "workfile.json");
    if (!fs.existsSync(workfile_path)) {
        return null;
    }
    try {
        const content = fs.readFileSync(workfile_path, "utf8");
        return JSON.parse(content) as MinimalWorkfile;
    } catch {
        return null;
    }
}

const COMMANDS = ["config", "create", "read", "update", "delete", "validate", "generate", "build", "deploy", "completion"];
const CREATE_SUBCOMMANDS = ["workfile", "node"];
const CONFIG_KEYS = ["no_os_path", "build_command", "deploy_command"];

export function get_completions(line: string): string[] {
    const ctx = parse_completion_line(line);
    const { words, current } = ctx;

    // aa <TAB> - complete command
    if (words.length === 0) {
        return filter_completions(COMMANDS, current);
    }

    const command = words[0];

    switch (command) {
        case "config":
            return complete_config(words.slice(1), current);
        case "create":
            return complete_create(words.slice(1), current);
        case "read":
            return complete_read(words.slice(1), current);
        case "update":
            return complete_update(words.slice(1), current);
        case "delete":
            return complete_delete(words.slice(1), current);
        case "completion":
            return complete_completion(words.slice(1), current);
        default:
            return [];
    }
}

function complete_config(words: string[], current: string): string[] {
    // aa config <TAB> - show keys
    if (words.length === 0) {
        return filter_completions(CONFIG_KEYS, current);
    }
    // aa config <key> <TAB> - no completion for values
    return [];
}

function complete_create(words: string[], current: string): string[] {
    // aa create <TAB> - show subcommands
    if (words.length === 0) {
        return filter_completions(CREATE_SUBCOMMANDS, current);
    }

    const subcommand = words[0];

    if (subcommand === "workfile") {
        // aa create workfile --platform <TAB>
        if (words.includes("--platform")) {
            const platform_index = words.indexOf("--platform");
            if (platform_index === words.length - 1) {
                // --platform is last word, completing platform name
                return filter_completions(get_platform_names(), current);
            }
        }
        // aa create workfile <TAB> - suggest --platform
        if (words.length === 1) {
            return filter_completions(["--platform"], current);
        }
        return [];
    }

    if (subcommand === "node") {
        // aa create node <TAB> - no completion for name
        // aa create node <name> <TAB> - complete schema paths
        if (words.length === 2) {
            return filter_completions(get_schema_paths(), current);
        }
        return [];
    }

    return [];
}

function complete_read(words: string[], current: string): string[] {
    // aa read <TAB> - show node names
    if (words.length === 0) {
        return filter_completions(get_node_names(), current);
    }
    // aa read <node> <TAB> - show property names
    if (words.length === 1) {
        return filter_completions(get_property_names(words[0]), current);
    }
    return [];
}

function complete_update(words: string[], current: string): string[] {
    // aa update <TAB> - show node names
    if (words.length === 0) {
        return filter_completions(get_node_names(), current);
    }
    // aa update <node> <TAB> - show property names
    if (words.length === 1) {
        return filter_completions(get_property_names(words[0]), current);
    }
    // aa update <node> <prop> <TAB> - show suggestions
    if (words.length === 2) {
        return filter_completions(get_value_suggestions(words[0], words[1]), current);
    }
    // aa update <node> <prop> <union_member> <TAB> - show suggestions for union value
    if (words.length === 3) {
        return filter_completions(get_union_value_suggestions(words[0], words[1], words[2]), current);
    }
    return [];
}

function complete_delete(words: string[], current: string): string[] {
    // aa delete <TAB> - show node names
    if (words.length === 0) {
        return filter_completions(get_node_names(), current);
    }
    return [];
}

function complete_completion(words: string[], current: string): string[] {
    if (words.length === 0) {
        return filter_completions(["install", "uninstall"], current);
    }
    return [];
}

// --- Data fetchers ---

function get_node_names(): string[] {
    const minimal = load_workfile_for_completion();
    if (!minimal?.symbols) return [];
    return Object.keys(minimal.symbols);
}

function get_property_names(node_name: string): string[] {
    const minimal = load_workfile_for_completion();
    if (!minimal) return [];

    const result = import_minimal(minimal);
    if (!result.ok) return [];

    const symbol = result.value.symbols[node_name];
    if (!symbol || symbol._t !== "RulesetStruct") return [];

    return symbol.properties
        .filter(p => !p.disabled)
        .map(p => p.name);
}

function get_value_suggestions(node_name: string, property_name: string): string[] {
    const minimal = load_workfile_for_completion();
    if (!minimal) return [];

    const result = import_minimal(minimal);
    if (!result.ok) return [];

    const suggestions = suggest_for_property(result.value, node_name, property_name);
    if (!suggestions.ok) return [];

    return suggestions.value.values ?? [];
}

function get_union_value_suggestions(node_name: string, property_name: string, member_name: string): string[] {
    const minimal = load_workfile_for_completion();
    if (!minimal) return [];

    const result = import_minimal(minimal);
    if (!result.ok) return [];

    const symbol = result.value.symbols[node_name];
    if (!symbol || symbol._t !== "RulesetStruct") return [];

    const property = symbol.properties.find(p => p.name === property_name);
    if (!property || property._t !== "UnionProperty") return [];

    const member = property.members.find(m => m.name === member_name);
    if (!member) return [];

    // Get suggestions for this union member (it's an include property)
    const member_suggestions = suggest_for_property(result.value, node_name, property_name);
    if (!member_suggestions.ok) return [];

    // For unions, we need suggestions for the member's include
    // This requires looking up symbols that match the member's include type
    const values: string[] = [];
    for (const [name, sym] of Object.entries(result.value.symbols)) {
        if (sym.$id === member.include) {
            values.push(name);
        }
    }

    return values;
}

function get_platform_names(): string[] {
    const schemas_path = get_schemas_path();
    if (!schemas_path.ok) return [];

    const platforms_path = path.join(schemas_path.value, "platforms");
    const result = scan_platforms(platforms_path);
    if (!result.ok) return [];

    return Object.keys(result.value);
}

function get_schema_paths(): string[] {
    const minimal = load_workfile_for_completion();
    if (!minimal) return [];

    const result = import_minimal(minimal);
    if (!result.ok) return [];

    const available = list_available_structs(result.value);
    if (!available.ok) return [];

    return [
        ...available.value.devices,
        ...available.value.noos,
        ...available.value.platform,
    ];
}
