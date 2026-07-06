import { buildCommand } from "@stricli/core";
import {
    MinimalWorkfile,
    Ruleset,
    Workfile,
    Property,
    suggest_for_union,
    suggest_for_include,
    load_minimal_workfile,
    import_minimal,
    resolve_workfile_path,
    IncludeProperty
} from "attach-no-os-lib";

export const readCommand = buildCommand<
    { json?: boolean },
    [string | undefined, string | undefined, string | undefined]  // node, property, union_member
>({
    docs: { brief: "Read workfile, node, or property" },
    parameters: {
        positional: {
            kind: "tuple",
            parameters: [
                { placeholder: "node", brief: "Node name", optional: true, parse: String },
                { placeholder: "property", brief: "Property name", optional: true, parse: String },
                { placeholder: "union_member", brief: "Union member name", optional: true, parse: String }
            ]
        },
        flags: {
            json: { kind: "boolean", brief: "Output as JSON", optional: true }
        }
    },
    func: async (flags, node: string | undefined, property: string | undefined, union_member: string | undefined) => {
        // Load workfile
        const workfile_path = resolve_workfile_path();
        if (!workfile_path) {
            console.log("No workfile found in current directory");
            return;
        }

        const minimal = load_minimal_workfile(workfile_path);
        if (!minimal.ok) {
            console.log(minimal.error.message);
            return;
        }

        const workfile = import_minimal(minimal.value);
        if (!workfile.ok) {
            console.log(workfile.error.message);
            return;
        }

        // aa read - list all nodes
        if (!node) {
            if (flags.json) {
                console.log(JSON.stringify({
                    platform: minimal.value.platform,
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

        // aa read <node> - show node properties
        if (node && !property) {
            if (!Object.keys(minimal.value.symbols).includes(node)) {
                const message = `Node ${node} is not defined in the workfile. Available nodes: ${Object.keys(minimal.value.symbols).join(", ")}`;
                if (flags.json) {
                    console.log(JSON.stringify({ message }, undefined, 2));
                } else {
                    console.log(message);
                }
                return;
            }

            const selected_node = minimal.value.symbols[node];
            if (flags.json) {
                console.log(JSON.stringify(selected_node, undefined, 2));
            } else {
                console.log(format_node_summary(node, workfile.value.symbols[node]));
            }

            return;
        }

        if (node && property) {
            if (!Object.keys(workfile.value.symbols).includes(node)) {
                const message = `Node ${node} is not defined in the workfile. Available nodes: ${workfile.value.symbols}`;
                if (flags.json) {
                    console.log(JSON.stringify({ message }, undefined, 2));
                } else {
                    console.log(message);
                }
                return;
            }

            const selected_node = workfile.value.symbols[node];
            if (selected_node._t !== "RulesetStruct") {
                console.log(`Selected node ${node} has the wrong type (${workfile.value.symbols[node]._t}) instead of RulesetStruct`);
                return;
            }

            const selected_property = selected_node.properties.find(p => p.name === property);
            if (selected_property === undefined) {
                console.log(`Cannot find property '${property}' in the property list of the rulesets: ${selected_node.properties.map(p => p.name).join(", ")}`);
                return;
            }

            // aa read <node> <property> <union_member> - show union member details
            if (union_member) {
                if (selected_property._t !== "UnionProperty") {
                    console.log(`Property '${property}' is not a union type`);
                    return;
                }

                const member = selected_property.members.find(m => m.name === union_member);
                if (!member) {
                    console.log(`Invalid union member '${union_member}'. Available: ${selected_property.members.map(m => m.name).join(", ")}`);
                    return;
                }

                const suggestions = suggest_for_union(workfile.value, selected_property, union_member);
                if (flags.json) {
                    console.log(JSON.stringify({
                        property,
                        type: "union",
                        member: union_member,
                        schema: member.include,
                        suggestions: suggestions.ok ? suggestions.value : []
                    }, undefined, 2));
                } else {
                    console.log(format_union_member_details(property, member, suggestions.ok ? suggestions.value : []));
                }
                return;
            }

            if (flags.json) {
                console.log(format_property_json(selected_property, workfile.value));
            } else {
                console.log(format_property_details(selected_property, workfile.value));
            }

            return;
        }
    }
});

// ------- FORMATTERS --------

// aa read - list all nodes
function format_node_list(minimal: MinimalWorkfile): string {
    let out = `Platform: ${minimal.platform}\n\n`;
    out += "Nodes:\n";

    const entries = Object.entries(minimal.symbols);
    if (entries.length === 0) {
        out += "  (none)\n";
        return out;
    }

    for (const [name, node] of entries) {
        out += `  ${name.padEnd(18)}${node.$compatible}\n`;
    }

    return out;
}

// aa read <node> - show node properties
function format_node_summary(name: string, ruleset: Ruleset): string {
    if (ruleset._t !== "RulesetStruct") {
        return `${name} is not a struct`;
    }

    let out = `${name}\n`;
    out += `  ${ruleset.$id}\n`;
    if (ruleset.$description) {
        out += `  ${ruleset.$description}\n`;
    }
    out += "\n";

    out += `  ${"Property".padEnd(20)}${"Type".padEnd(18)}${"Value".padEnd(18)}\n`;
    out += `  ${"─".repeat(56)}\n`;

    for (const property of ruleset.properties) {
        const required = property.required ? "* " : "  ";
        const type = format_property_type(property._t);
        const value = format_property_value(property);

        out += `${required}${property.name.padEnd(20)}${type.padEnd(18)}${value}\n`;
    }

    out += "\n* = required";
    return out;
}

// aa read <node> <property> - show property details
function format_property_details(property: Property, workfile: Workfile): string {
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

    // Type-specific details
    switch (property._t) {
        case "NumberProperty": {
            if (property.minimum !== undefined || property.maximum !== undefined) {
                out += "\n  Constraints:\n";
                if (property.minimum !== undefined) {out += `    ${"minimum".padEnd(12)}${property.minimum}\n`;}
                if (property.maximum !== undefined) {out += `    ${"maximum".padEnd(12)}${property.maximum}\n`;}
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

            // Add suggestions if a member is selected
            if (selectedMember && property.value) {
                const suggestions = suggest_for_union(workfile, property, selectedMember);
                if (suggestions.ok && suggestions.value.length > 0) {
                    out += "\n  Suggestions:\n";
                    for (const s of suggestions.value) {
                        out += `    • ${s}\n`;
                    }
                }
            }
            break;
        }

        case "IncludeProperty": {
            const includeSuggestions = suggest_for_include(workfile, property);
            if (includeSuggestions.ok && includeSuggestions.value.length > 0) {
                out += "\n  Suggestions:\n";
                for (const s of includeSuggestions.value) {
                    out += `    • ${s}\n`;
                }
            }
            break;
        }

        case "BooleanProperty": {
            out += "\n  Options:\n";
            out += `    ${property.value === true ? "●" : "○"} true${property.value === true ? "  (current)" : ""}\n`;
            out += `    ${property.value === false ? "●" : "○"} false${property.value === false ? "  (current)" : ""}\n`;
            break;
        }
    }

    return out;
}

type PropertyJson = {
    name: string;
    type: string;
    required: boolean;
    value: unknown;
    default?: unknown;
    description?: string;
    constraints?: { minimum?: number; maximum?: number };
    options?: (string | number)[];
    members?: { name: string; schema: string }[];
    schema?: string;
    suggestions?: string[];
};

function format_property_json(property: Property, workfile: Workfile): PropertyJson {
    const base: PropertyJson = {
        name: property.name,
        type: format_property_type(property._t),
        required: property.required ?? false,
        value: property.value,
    };

    if ("default" in property && property.default !== undefined) {
        base.default = property.default;
    }

    if (property.description) {
        base.description = property.description;
    }

    switch (property._t) {
        case "NumberProperty": {
            if (property.minimum !== undefined || property.maximum !== undefined) {
                base.constraints = {};
                if (property.minimum !== undefined) {base.constraints.minimum = property.minimum;}
                if (property.maximum !== undefined) {base.constraints.maximum = property.maximum;}
            }
            break;
        }

        case "EnumProperty": {
            base.options = property.values;
            break;
        }

        case "UnionProperty": {
            base.members = property.members.map(m => ({
                name: m.name,
                schema: m.include
            }));

            if (property.value) {
                const selectedMember = Object.keys(property.value)[0];
                const suggestions = suggest_for_union(workfile, property, selectedMember);
                if (suggestions.ok && suggestions.value.length > 0) {
                    base.suggestions = suggestions.value;
                }
            }
            break;
        }

        case "IncludeProperty": {
            base.schema = property.include;
            const includeSuggestions = suggest_for_include(workfile, property);
            if (includeSuggestions.ok && includeSuggestions.value.length > 0) {
                base.suggestions = includeSuggestions.value;
            }
            break;
        }

        default:
    }

    return base;
}

// aa read <node> <property> <union_member> - show union member details
function format_union_member_details(property: string, member: IncludeProperty, suggestions: string[]): string {
    let out = `${property} → ${member.name}\n\n`;
    out += `  ${"Schema:".padEnd(15)}${member.include}\n`;

    if (suggestions.length > 0) {
        out += "\n  Suggestions:\n";
        for (const s of suggestions) {
            out += `    • ${s}\n`;
        }
    } else {
        out += "\n  No suggestions available.\n";
    }

    return out;
}

// Helpers
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
    if (property.value === undefined) {return "-";}

    if (property._t === "UnionProperty" && typeof property.value === "object") {
        const [key, value] = Object.entries(property.value)[0];
        return `${key} = ${value}`;
    }

    return String(property.value);
}
