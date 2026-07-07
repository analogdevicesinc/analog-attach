import { buildCommand } from "@stricli/core";
import {
    Ruleset,
    Property,
    PropertySuggestions,
    suggest_for_property,
    IncludeProperty
} from "attach-no-os-lib";
import {
    load_context,
    output,
    output_error,
    get_node,
    get_node_property,
    format_property_type,
    format_property_value,
    format_node_list
} from "./shared";

export const readCommand = buildCommand<
    { json?: boolean },
    [string | undefined, string | undefined, string | undefined]
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
    func: async (flags, node, property, union_member) => {
        const context = load_context();
        if (!context.ok) {
            output_error(flags, "load_failed", context.error.message);
            return;
        }

        // aa read - list all nodes
        if (!node) {
            const text = `Platform: ${context.value.minimal.platform}\n\n` + format_node_list(context.value.minimal, "Nodes:");
            const json = {
                platform: context.value.minimal.platform,
                nodes: Object.entries(context.value.minimal.symbols).map(([name, n]) => ({
                    name,
                    schema: n.$compatible
                }))
            };
            output(flags, text, json);
            return;
        }

        // aa read <node> - show node properties
        if (!property) {
            const node_result = get_node(context.value, node);
            if (!node_result.ok) {
                output_error(flags, "node_not_found", node_result.error.message);
                return;
            }

            const text = format_node_summary(node, context.value.workfile.symbols[node]);
            const json = context.value.minimal.symbols[node];
            output(flags, text, json);
            return;
        }

        // aa read <node> <property>
        const lookup = get_node_property(context.value, node, property);
        if (!lookup.ok) {
            output_error(flags, "lookup_failed", lookup.error.message);
            return;
        }

        // aa read <node> <property> <union_member>
        if (union_member) {
            if (lookup.value.property._t !== "UnionProperty") {
                output_error(flags, "not_union", `Property '${property}' is not a union type`);
                return;
            }

            const member = lookup.value.property.members.find(m => m.name === union_member);
            if (!member) {
                output_error(flags, "invalid_member", `Invalid union member '${union_member}'. Available: ${lookup.value.property.members.map(m => m.name).join(", ")}`);
                return;
            }

            const suggestions = suggest_for_property(context.value.workfile, node, property, union_member);
            const empty_suggestions: PropertySuggestions = {};
            const suggestions_value = suggestions.ok ? suggestions.value : empty_suggestions;
            const text = format_union_member_details(property, member, suggestions_value);
            const json = {
                property,
                type: "union",
                member: union_member,
                schema: member.include,
                values: suggestions_value.values ?? [],
                types: suggestions_value.types ?? []
            };
            output(flags, text, json);
            return;
        }

        // aa read <node> <property>
        const suggestions = suggest_for_property(context.value.workfile, node, property);
        if (!suggestions.ok) {
            console.log(`Warning: suggest_for_property failed: ${suggestions.error.message}`);
        }
        const suggestions_value = suggestions.ok ? suggestions.value : {};
        const text = format_property_details(lookup.value.property, suggestions_value);
        const json = format_property_json(lookup.value.property, suggestions_value);
        output(flags, text, json);
    }
});

// ------- FORMATTERS --------

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

function format_property_details(property: Property, suggestions: PropertySuggestions): string {
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
    }

    if (suggestions.values && suggestions.values.length > 0) {
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

function format_union_member_details(property: string, member: IncludeProperty, suggestions: PropertySuggestions): string {
    let out = `${property} → ${member.name}\n\n`;
    out += `  ${"Schema:".padEnd(15)}${member.include}\n`;

    if (suggestions.values && suggestions.values.length > 0) {
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

    if ((!suggestions.values || suggestions.values.length === 0) && (!suggestions.types || suggestions.types.length === 0)) {
        out += "\n  No suggestions available.\n";
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
    values?: string[];
    types?: string[];
};

function format_property_json(property: Property, suggestions: PropertySuggestions): PropertyJson {
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
                if (property.minimum !== undefined) { base.constraints.minimum = property.minimum; }
                if (property.maximum !== undefined) { base.constraints.maximum = property.maximum; }
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
            break;
        }

        case "IncludeProperty": {
            base.schema = property.include;
            break;
        }

    }

    if (suggestions.values && suggestions.values.length > 0) {
        base.values = suggestions.values;
    }

    if (suggestions.types && suggestions.types.length > 0) {
        base.types = suggestions.types;
    }

    return base;
}
