import fs from "node:fs";
import {
    export_minimal,
    import_minimal,
    load_minimal_workfile,
    MinimalWorkfile,
    Property,
    PropertySuggestions,
    resolve_workfile_path,
    Result,
    Workfile,
    ok,
    error,
    RulesetStruct,
    RulesetDescriptor
} from "attach-no-os-lib";

// --- Types ---

export type WorkfileContext = {
    path: string;
    minimal: MinimalWorkfile;
    workfile: Workfile;
};

export type OutputFlags = {
    json?: boolean;
};

// --- Workfile Loading ---

export function load_context(custom_path?: string): Result<WorkfileContext> {
    const path = resolve_workfile_path(custom_path);
    if (!path) {
        return error("No workfile found in current directory");
    }

    const minimal = load_minimal_workfile(path);
    if (!minimal.ok) {
        return minimal;
    }

    const workfile = import_minimal(minimal.value);
    if (!workfile.ok) {
        return workfile;
    }

    return ok({ path, minimal: minimal.value, workfile: workfile.value });
}

// --- Workfile Saving ---

export function save_workfile(context: WorkfileContext): Result<void> {
    const minimal = export_minimal(context.workfile);
    if (!minimal.ok) {
        return minimal;
    }

    fs.writeFileSync(context.path, JSON.stringify(minimal.value, undefined, 2));
    return ok();
}

// --- Output Helpers ---

export function output(flags: OutputFlags, text: string, json: unknown): void {
    if (flags.json) {
        console.log(JSON.stringify(json, undefined, 2));
    } else {
        console.log(text);
    }
}

export function output_error(flags: OutputFlags, error_code: string, message: string): void {
    output(flags, message, { error: error_code, message });
}

// --- Node/Property Lookup ---

export type NodePropertyResult = {
    node: RulesetStruct | RulesetDescriptor;
    property: Property;
};

export function get_node_property(
    context: WorkfileContext,
    node_name: string,
    property_name: string
): Result<NodePropertyResult> {
    const node = context.workfile.symbols[node_name];
    if (!node) {
        return error(`Node '${node_name}' not found. Available: ${Object.keys(context.workfile.symbols).join(", ")}`);
    }

    if (node._t !== "RulesetStruct" && node._t !== "RulesetDescriptor") {
        return error(`Node '${node_name}' is not a struct or descriptor`);
    }

    const property = node.properties.find(p => p.name === property_name);
    if (!property) {
        return error(`Property '${property_name}' not found. Available: ${node.properties.map(p => p.name).join(", ")}`);
    }

    return ok({ node, property });
}

export function get_node(context: WorkfileContext, node_name: string): Result<RulesetStruct | RulesetDescriptor> {
    const node = context.workfile.symbols[node_name];
    if (!node) {
        return error(`Node '${node_name}' not found. Available: ${Object.keys(context.workfile.symbols).join(", ")}`);
    }

    if (node._t !== "RulesetStruct" && node._t !== "RulesetDescriptor") {
        return error(`Node '${node_name}' is not a struct or descriptor`);
    }

    return ok(node);
}

// --- Formatters ---

export function format_property_type(t: string): string {
    const map: Record<string, string> = {
        "NumberProperty": "number",
        "StringProperty": "string",
        "BooleanProperty": "boolean",
        "EnumProperty": "enum",
        "IncludeProperty": "include",
        "UnionProperty": "union",
        "ArrayProperty": "array",
        "PlatformOpsProperty": "platform_ops",
        "PlatformExtraProperty": "platform_extra",
        "RawProperty": "raw",
    };
    return map[t] ?? t;
}

export function format_property_value(property: Property): string {
    if (property.value === undefined) { return "-"; }

    if (property._t === "UnionProperty" && typeof property.value === "object") {
        const [key, value] = Object.entries(property.value)[0];
        return `${key} = ${value}`;
    }

    return String(property.value);
}

export function format_node_list(minimal: MinimalWorkfile, header?: string): string {
    const entries = Object.entries(minimal.symbols);

    if (entries.length === 0) {
        return "No nodes defined.";
    }

    let out = header ? `${header}\n\n` : "";
    for (const [name, node] of entries) {
        out += `  ${name.padEnd(18)}${node.$compatible}\n`;
    }

    return out;
}

export function format_property_list(node_name: string, properties: Property[]): string {
    let out = `${node_name} properties:\n\n`;
    out += `  ${"Property".padEnd(20)}${"Type".padEnd(14)}${"Value"}\n`;
    out += `  ${"─".repeat(50)}\n`;

    for (const p of properties) {
        const type = format_property_type(p._t);
        const value = format_property_value(p);
        out += `  ${p.name.padEnd(20)}${type.padEnd(14)}${value}\n`;
    }

    return out;
}

export function format_property_details(property: Property, suggestions: PropertySuggestions): string {
    let out = `${property.name}\n\n`;

    out += `  ${"Type:".padEnd(15)}${format_property_type(property._t)}\n`;
    out += `  ${"Required:".padEnd(15)}${property.required ? "yes" : "no"}\n`;
    out += `  ${"Value:".padEnd(15)}${format_property_value(property) || "(not set)"}\n`;

    if ("default" in property && property.default !== undefined) {
        out += `  ${"Default:".padEnd(15)}${property.default}\n`;
    }

    if (property.description) {
        out += `  ${"Description:".padEnd(15)}${property.description}\n`;
    }

    switch (property._t) {
        case "NumberProperty": {
            if (property.minimum !== undefined || property.maximum !== undefined) {
                out += "\n  Constraints:\n";
                if (property.minimum !== undefined) { out += `    ${"minimum".padEnd(12)}${property.minimum}\n`; }
                if (property.maximum !== undefined) { out += `    ${"maximum".padEnd(12)}${property.maximum}\n`; }
            }
            break;
        }

        case "EnumProperty": {
            out += "\n  Options:\n";
            for (const value of property.values) {
                const current = property.value === value;
                const marker = current ? "●" : "○";
                const suffix = current ? "  (current)" : "";
                out += `    ${marker} ${value}${suffix}\n`;
            }
            break;
        }

        case "UnionProperty": {
            out += "\n  Members:\n";
            const selectedMember = property.value ? Object.keys(property.value)[0] : undefined;
            for (const member of property.members) {
                const selected = member.name === selectedMember;
                const marker = selected ? "●" : "○";
                const suffix = selected ? "  (selected)" : "";
                out += `    ${marker} ${member.name.padEnd(12)}${member.include}${suffix}\n`;
            }
            break;
        }

        case "BooleanProperty": {
            out += "\n  Options:\n";
            out += `    ${property.value === true ? "●" : "○"} true${property.value === true ? "  (current)" : ""}\n`;
            out += `    ${property.value === false ? "●" : "○"} false${property.value === false ? "  (current)" : ""}\n`;
            break;
        }

        case "ArrayProperty": {
            out += `  ${"Max size:".padEnd(15)}${property.size}\n`;
            out += "\n  Format: comma-separated values\n";
            out += `    aa update <node> ${property.name} value1,value2,value3\n`;
            break;
        }

        case "RawProperty": {
            // Raw values are emitted to the generated code byte-for-byte, so the
            // user must type the exact C token. String literals need quotes that
            // survive the shell (which strips bare ""), hence the escaping hint.
            out += "\n  Format: written to generated code verbatim (exactly as typed)\n";
            out += `    aa update <node> ${property.name} &my_handle       -> &my_handle\n`;
            out += `    aa update <node> ${property.name} '\"some text\"'    -> \"some text\"\n`;
            out += "  To emit a C string literal, keep the quotes: use '\"...\"' or \\\"...\\\"\n";
            break;
        }
    }

    // Enums (and booleans) already list every possible value in their Options
    // block above, so repeating them under Suggestions is just noise.
    const options_shown = property._t === "EnumProperty" || property._t === "BooleanProperty";
    if (!options_shown && suggestions.values && suggestions.values.length > 0) {
        out += "\n  Suggestions:\n";
        for (const value of suggestions.values) {
            out += `    • ${value}\n`;
        }
    }

    if (suggestions.types && suggestions.types.length > 0) {
        out += "\n  Can create:\n";
        for (const type of suggestions.types) {
            out += `    + ${type}\n`;
        }
    }

    return out;
}
