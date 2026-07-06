import { buildCommand } from "@stricli/core";
import fs from "node:fs";
import {
    export_minimal,
    get_symbol,
    import_minimal,
    load_minimal_workfile,
    MinimalWorkfile,
    Property,
    rename_symbol,
    resolve_workfile_path,
    set_value,
    suggest_for_property
} from "attach-no-os-lib";

export const updateCommand = buildCommand<
    { json?: boolean; rename?: string },
    [string | undefined, string | undefined, string | undefined, string | undefined]
>({
    docs: { brief: "Update a node property or rename a node" },
    parameters: {
        positional: {
            kind: "tuple",
            parameters: [
                { placeholder: "node", brief: "Node name", optional: true, parse: String },
                { placeholder: "property", brief: "Property name", optional: true, parse: String },
                { placeholder: "value", brief: "Value (or union member)", optional: true, parse: String },
                { placeholder: "union_value", brief: "Value for union member", optional: true, parse: String }
            ]
        },
        flags: {
            json: { kind: "boolean", brief: "Output as JSON", optional: true },
            rename: { kind: "parsed", brief: "Rename node to this name", optional: true, parse: String }
        }
    },
    func: async (flags, node, property, value, union_value) => {
        const workfile_path = resolve_workfile_path();
        if (!workfile_path) {
            const message = "No workfile found in current directory";
            if (flags.json) {
                console.log(JSON.stringify({ error: "no_workfile", message }));
            } else {
                console.log(message);
            }
            return;
        }

        const minimal = load_minimal_workfile(workfile_path);
        if (!minimal.ok) {
            if (flags.json) {
                console.log(JSON.stringify({ error: "load_failed", message: minimal.error.message }));
            } else {
                console.log(minimal.error.message);
            }
            return;
        }

        const workfile = import_minimal(minimal.value);
        if (!workfile.ok) {
            if (flags.json) {
                console.log(JSON.stringify({ error: "import_failed", message: workfile.error.message }));
            } else {
                console.log(workfile.error.message);
            }
            return;
        }

        // aa update - list nodes
        if (!node) {
            if (flags.json) {
                console.log(JSON.stringify({
                    nodes: Object.entries(minimal.value.symbols).map(([name, n]) => ({
                        name,
                        schema: n.$compatible
                    }))
                }, undefined, 2));
            } else {
                console.log(format_node_list(minimal.value));
            }
            return;
        }

        // Check node exists
        const symbol = get_symbol(workfile.value, node);
        if (!symbol.ok) {
            if (flags.json) {
                console.log(JSON.stringify({ error: "node_not_found", node, available: Object.keys(minimal.value.symbols) }));
            } else {
                console.log(`Node '${node}' not found. Available: ${Object.keys(minimal.value.symbols).join(", ")}`);
            }
            return;
        }

        // aa update <node> --rename <new_name>
        if (flags.rename) {
            const result = rename_symbol(workfile.value, node, flags.rename);
            if (!result.ok) {
                if (flags.json) {
                    console.log(JSON.stringify({ error: "rename_failed", message: result.error.message }));
                } else {
                    console.log(result.error.message);
                }
                return;
            }

            const updated = export_minimal(result.value);
            if (!updated.ok) {
                if (flags.json) {
                    console.log(JSON.stringify({ error: "export_failed", message: updated.error.message }));
                } else {
                    console.log(updated.error.message);
                }
                return;
            }

            fs.writeFileSync(workfile_path, JSON.stringify(updated.value, undefined, 2));

            if (flags.json) {
                console.log(JSON.stringify({ renamed: { from: node, to: flags.rename } }, undefined, 2));
            } else {
                console.log(`Renamed ${node} to ${flags.rename}`);
            }
            return;
        }

        // aa update <node> - list properties
        if (!property) {
            if (symbol.value._t !== "RulesetStruct") {
                console.log(`Node ${node} is not a struct`);
                return;
            }

            if (flags.json) {
                console.log(JSON.stringify({
                    node,
                    properties: symbol.value.properties.map(p => ({
                        name: p.name,
                        type: format_property_type(p._t),
                        value: p.value
                    }))
                }, undefined, 2));
            } else {
                console.log(format_property_list(node, symbol.value.properties));
            }
            return;
        }

        // Check property exists
        if (symbol.value._t !== "RulesetStruct") {
            console.log(`Node ${node} is not a struct`);
            return;
        }

        const property_ = symbol.value.properties.find(p => p.name === property);
        if (!property_) {
            if (flags.json) {
                console.log(JSON.stringify({
                    error: "property_not_found",
                    property,
                    available: symbol.value.properties.map(p => p.name)
                }));
            } else {
                console.log(`Property '${property}' not found. Available: ${symbol.value.properties.map(p => p.name).join(", ")}`);
            }
            return;
        }

        // aa update <node> <property> - show suggestions
        if (!value) {
            const suggestions = suggest_for_property(workfile.value, node, property);
            if (flags.json) {
                console.log(JSON.stringify({
                    property,
                    type: format_property_type(property_._t),
                    current: property_.value,
                    suggestions: suggestions.ok ? suggestions.value : []
                }, undefined, 2));
            } else {
                console.log(format_suggestions(property_, suggestions.ok ? suggestions.value : []));
            }
            return;
        }

        // Handle union type
        if (property_._t === "UnionProperty") {
            const member = property_.members.find(m => m.name === value);
            if (!member) {
                if (flags.json) {
                    console.log(JSON.stringify({
                        error: "invalid_union_member",
                        member: value,
                        available: property_.members.map(m => m.name)
                    }));
                } else {
                    console.log(`Invalid union member '${value}'. Available: ${property_.members.map(m => m.name).join(", ")}`);
                }
                return;
            }

            // aa update <node> <property> <union_member> - set union member with null value
            const union_obj = { [value]: union_value ?? null };
            const result = set_value(workfile.value, node, property, union_obj);
            if (!result.ok) {
                if (flags.json) {
                    console.log(JSON.stringify({ error: "set_failed", message: result.error.message }));
                } else {
                    console.log(result.error.message);
                }
                return;
            }

            const updated = export_minimal(workfile.value);
            if (!updated.ok) {
                if (flags.json) {
                    console.log(JSON.stringify({ error: "export_failed", message: updated.error.message }));
                } else {
                    console.log(updated.error.message);
                }
                return;
            }

            fs.writeFileSync(workfile_path, JSON.stringify(updated.value, undefined, 2));

            if (flags.json) {
                console.log(JSON.stringify({ updated: { node, property, member: value, value: union_value ?? null } }, undefined, 2));
            } else {
                const display_value = union_value ?? "(none)";
                console.log(`Set ${node}.${property} = ${value}: ${display_value}`);
            }
            return;
        }

        // aa update <node> <property> <value> - set non-union value
        const parsed_value = parse_value(value, property_);
        const result = set_value(workfile.value, node, property, parsed_value);
        if (!result.ok) {
            if (flags.json) {
                console.log(JSON.stringify({ error: "set_failed", message: result.error.message }));
            } else {
                console.log(result.error.message);
            }
            return;
        }

        const updated = export_minimal(workfile.value);
        if (!updated.ok) {
            if (flags.json) {
                console.log(JSON.stringify({ error: "export_failed", message: updated.error.message }));
            } else {
                console.log(updated.error.message);
            }
            return;
        }

        fs.writeFileSync(workfile_path, JSON.stringify(updated.value, undefined, 2));

        if (flags.json) {
            console.log(JSON.stringify({ updated: { node, property, value: parsed_value } }, undefined, 2));
        } else {
            console.log(`Set ${node}.${property} = ${parsed_value}`);
        }
    }
});

// ------- HELPERS --------

function parse_value(value: string, property: Property): unknown {
    switch (property._t) {
        case "NumberProperty": {
            return Number(value);
        }
        case "BooleanProperty": {
            return value === "true";
        }
        case "EnumProperty": {
            const number_ = Number(value);
            if (!Number.isNaN(number_) && property.values.includes(number_)) {
                return number_;
            }
            return value;
        }
        default: {
            return value;
        }
    }
}

// ------- FORMATTERS --------

function format_node_list(minimal: MinimalWorkfile): string {
    const entries = Object.entries(minimal.symbols);
    if (entries.length === 0) {
        return "No nodes to update.";
    }

    let out = "Nodes:\n\n";
    for (const [name, node] of entries) {
        out += `  ${name.padEnd(18)}${node.$compatible}\n`;
    }
    out += "\nUse: aa update <node> <property> <value>";
    return out;
}

function format_property_list(node: string, properties: Property[]): string {
    let out = `${node} properties:\n\n`;
    out += `  ${"Property".padEnd(20)}${"Type".padEnd(14)}${"Value"}\n`;
    out += `  ${"─".repeat(50)}\n`;

    for (const p of properties) {
        const type = format_property_type(p._t);
        const value = format_property_value(p);
        out += `  ${p.name.padEnd(20)}${type.padEnd(14)}${value}\n`;
    }

    out += "\nUse: aa update <node> <property> [value]";
    return out;
}

function format_suggestions(property: Property, suggestions: string[]): string {
    let out = `${property.name}\n\n`;
    out += `  Type:    ${format_property_type(property._t)}\n`;
    out += `  Current: ${format_property_value(property)}\n`;

    if (suggestions.length > 0) {
        out += "\n  Suggestions:\n";
        for (const s of suggestions) {
            out += `    • ${s}\n`;
        }
    }

    return out;
}

function format_property_type(t: string): string {
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
        "CallbackFunctionProperty": "callback",
        "CallbackContextProperty": "callback_ctx",
    };
    return map[t] ?? t;
}

function format_property_value(property: Property): string {
    if (property.value === undefined) { return "-"; }

    if (property._t === "UnionProperty" && typeof property.value === "object") {
        const [key, value] = Object.entries(property.value)[0];
        return `${key} = ${value}`;
    }

    return String(property.value);
}
