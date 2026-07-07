import { buildCommand } from "@stricli/core";
import {
    Property,
    PropertySuggestions,
    rename_symbol,
    set_value,
    suggest_for_property
} from "attach-no-os-lib";
import {
    load_context,
    save_workfile,
    output,
    output_error,
    get_node,
    get_node_property,
    format_property_type,
    format_property_list,
    format_suggestions
} from "./shared";

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
        const context = load_context();
        if (!context.ok) {
            output_error(flags, "load_failed", context.error.message);
            return;
        }

        // aa update - list nodes
        if (!node) {
            const text = "Nodes:\n\n" + Object.entries(context.value.minimal.symbols)
                .map(([name, n]) => `  ${name.padEnd(18)}${n.$compatible}`)
                .join("\n") + "\n\nUse: aa update <node> <property> <value>";
            const json = {
                nodes: Object.entries(context.value.minimal.symbols).map(([name, n]) => ({
                    name,
                    schema: n.$compatible
                }))
            };
            output(flags, text, json);
            return;
        }

        // aa update <node> --rename <new_name>
        if (flags.rename) {
            const result = rename_symbol(context.value.workfile, node, flags.rename);
            if (!result.ok) {
                output_error(flags, "rename_failed", result.error.message);
                return;
            }

            context.value.workfile = result.value;
            const save = save_workfile(context.value);
            if (!save.ok) {
                output_error(flags, "save_failed", save.error.message);
                return;
            }

            output(flags, `Renamed ${node} to ${flags.rename}`, { renamed: { from: node, to: flags.rename } });
            return;
        }

        // aa update <node> - list properties
        if (!property) {
            const node_result = get_node(context.value, node);
            if (!node_result.ok) {
                output_error(flags, "node_not_found", node_result.error.message);
                return;
            }

            const text = format_property_list(node, node_result.value.properties) + "\nUse: aa update <node> <property> [value]";
            const json = {
                node,
                properties: node_result.value.properties.map(p => ({
                    name: p.name,
                    type: format_property_type(p._t),
                    value: p.value
                }))
            };
            output(flags, text, json);
            return;
        }

        // Check property exists
        const lookup = get_node_property(context.value, node, property);
        if (!lookup.ok) {
            output_error(flags, "lookup_failed", lookup.error.message);
            return;
        }

        // aa update <node> <property> - show suggestions
        if (!value) {
            const suggestions = suggest_for_property(context.value.workfile, node, property);
            const empty_suggestions: PropertySuggestions = {};
            const suggestions_value = suggestions.ok ? suggestions.value : empty_suggestions;
            const text = format_suggestions(lookup.value.property, suggestions_value);
            const json = {
                property,
                type: format_property_type(lookup.value.property._t),
                current: lookup.value.property.value,
                suggestions: suggestions_value.values ?? [],
                types: suggestions_value.types ?? []
            };
            output(flags, text, json);
            return;
        }

        // Handle union type
        if (lookup.value.property._t === "UnionProperty") {
            const member = lookup.value.property.members.find(m => m.name === value);
            if (!member) {
                output_error(flags, "invalid_union_member", `Invalid union member '${value}'. Available: ${lookup.value.property.members.map(m => m.name).join(", ")}`);
                return;
            }

            // eslint-disable-next-line unicorn/no-null
            const union_object = { [value]: union_value ?? null };
            const result = set_value(context.value.workfile, node, property, union_object);
            if (!result.ok) {
                output_error(flags, "set_failed", result.error.message);
                return;
            }

            const save = save_workfile(context.value);
            if (!save.ok) {
                output_error(flags, "save_failed", save.error.message);
                return;
            }

            const display_value = union_value ?? "(none)";
            output(flags, `Set ${node}.${property} = ${value}: ${display_value}`, {
                // eslint-disable-next-line unicorn/no-null
                updated: { node, property, member: value, value: union_value ?? null }
            });
            return;
        }

        // aa update <node> <property> <value> - set non-union value
        const parsed_value = parse_value(value, lookup.value.property);
        const result = set_value(context.value.workfile, node, property, parsed_value);
        if (!result.ok) {
            output_error(flags, "set_failed", result.error.message);
            return;
        }

        const save = save_workfile(context.value);
        if (!save.ok) {
            output_error(flags, "save_failed", save.error.message);
            return;
        }

        output(flags, `Set ${node}.${property} = ${parsed_value}`, {
            updated: { node, property, value: parsed_value }
        });
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
        case "ArrayProperty": {
            return value.split(",").map(v => v.trim()).filter(v => v.length > 0);
        }
        default: {
            return value;
        }
    }
}

