import { buildCommand } from "@stricli/core";
import {
    Property,
    Ruleset,
    PropertySuggestions,
    effective_property,
    suggest_for_property
} from "attach-no-os-lib";
import type { AttachContext } from "./shared";
import {
    load_context,
    output,
    output_error,
    get_any_node,
    get_node_property,
    column_width,
    format_property_type,
    format_property_value,
    format_node_list,
    format_property_details,
    root_key
} from "./shared";
import {
    prior_positionals,
    filter_completions,
    get_node_names,
    get_property_names
} from "../completion/completion";
import { include_target, node_origin, to_protocol_node, to_protocol_property, to_protocol_root } from "../protocol/convert";
import { read_failure, type ReadProperty } from "../protocol/responses";

/**
 * `attach-noos read [node] [property]` — the tree, a node, or one property.
 *
 * The path is absolute from the root and the workfile is flat, so it is at most two deep:
 * no positionals is the whole tree, one names a node, two name a property of that node.
 */
export type ReadFlags = {
    json?: boolean;
    quiet?: boolean;
};

export const readCommand = buildCommand<
    ReadFlags,
    [string | undefined, string | undefined],
    AttachContext
>({
    docs: {
        brief: "Read the workfile, a node, or a property",
        fullDescription:
            "With no arguments, prints the whole workfile.\n" +
            "With <node>, prints that node's properties. With <node> <property>, prints one property.\n" +
            "--quiet prints only the values: the node names, a node's 'property value' lines, or the\n" +
            "property's value alone."
    },
    parameters: {
        positional: {
            kind: "tuple",
            parameters: [
                {
                    placeholder: "node", brief: "Node name", optional: true, parse: String,
                    proposeCompletions(partial: string) {
                        return filter_completions(get_node_names(), partial);
                    }
                },
                {
                    placeholder: "property", brief: "Property name", optional: true, parse: String,
                    proposeCompletions(partial: string) {
                        const [node] = prior_positionals(this, 1);
                        return filter_completions(get_property_names(node), partial);
                    }
                }
            ]
        },
        flags: {
            json: { kind: "boolean", brief: "Output as JSON", optional: true },
            quiet: { kind: "boolean", brief: "Print only the values, without details", optional: true }
        }
    },
    func: async (flags, node, property) => {
        read_target(flags, node, property);
    }
});

/**
 * Print the workfile, a node or a property, as `read` does. `update <node> <property>` with
 * no value reads through here too, so the two never answer differently.
 */
export function read_target(flags: ReadFlags, node?: string, property?: string): void {
    const context = load_context();
    if (!context.ok) {
        output_error(flags, context.error.message, { response: read_failure(context.error.message) });
        return;
    }

    const root = root_key(context.value);

    // attach-noos read — the whole tree
    if (!node) {
        const text = flags.quiet === true
            ? Object.keys(context.value.minimal.symbols).join("\n")
            : format_workfile(context.value.minimal.platform, context.value.minimal.board)
                + format_node_list(context.value.minimal, "Nodes:");
        output(flags, text, to_protocol_root(root, context.value.minimal, context.value.workfile));
        return;
    }

    // attach-noos read <node>
    if (!property) {
        const found = get_any_node(context.value, node);
        if (!found.ok) {
            output_error(flags, found.error.message, { response: read_failure(found.error.message) });
            return;
        }

        const text = flags.quiet === true ? format_node_values(found.value) : format_node_summary(node, found.value);
        output(flags, text, to_protocol_node(node, found.value, node_origin(context.value.workfile, node)));
        return;
    }

    // attach-noos read <node> <property>
    const lookup = get_node_property(context.value, node, property);
    if (!lookup.ok) {
        output_error(flags, lookup.error.message, { response: read_failure(lookup.error.message) });
        return;
    }

    // The lookup's own name, not what was typed: the lib only knows the workfile's
    // spelling, and `read <node> init_param` resolves to `$init_param`.
    const suggestions = suggest_for_property(context.value.workfile, node, lookup.value.property.name);
    if (!suggestions.ok) {
        // stderr: stdout carries the --json body that consumers parse.
        console.warn(`Warning: could not compute suggestions: ${suggestions.error.message}`);
    }

    // As the part's overrides leave it - their default, description and allowed values -
    // the same view the suggestions above and the validator use, not the bare schema.
    const effective = effective_property(context.value.workfile, node, lookup.value.property.name);
    if (!effective.ok) {
        console.warn(`Warning: could not apply overrides: ${effective.error.message}`);
    }
    const shown = effective.ok ? effective.value : lookup.value.property;

    const details: PropertySuggestions = suggestions.ok ? suggestions.value : {};
    // The same lists the text shows under Suggestions and Can create.
    const response: ReadProperty = {
        ...to_protocol_property(shown),
        suggestions: { values: details.values ?? [], can_create: details.types ?? [] },
    };
    output(
        flags,
        flags.quiet === true ? quiet_value(shown) : format_property_details(shown, details),
        response
    );
}

// ------- FORMATTERS --------

/** A value alone, for --quiet: empty when unset or cleared. */
function quiet_value(property: Property): string {
    return property.value === undefined || property.value === null ? "" : format_property_value(property);
}

/** `property value` per line, for --quiet on a node. */
function format_node_values(ruleset: Ruleset): string {
    if (ruleset._t !== "RulesetStruct" && ruleset._t !== "RulesetDescriptor") {
        return "";
    }
    return ruleset.properties.map(property => `${property.name} ${quiet_value(property)}`.trimEnd()).join("\n");
}

function format_workfile(platform?: string, board?: string): string {
    let out = `Platform: ${platform ?? "-"}\n`;
    if (board) {
        out += `Board:    ${board}\n`;
    }
    return `${out}\n`;
}

function format_node_summary(name: string, ruleset: Ruleset): string {
    let out = `${name}\n`;
    out += `  ${ruleset.$symbol}\n`;
    if (ruleset.$description) {
        out += `  ${ruleset.$description}\n`;
    }

    // An extern is a name for a symbol the library already defines, so there is no property
    // table to print - what the user wants to see is the C symbol and the type it satisfies.
    if (ruleset._t === "RulesetExtern") {
        out += `\n  ${"Symbol:".padEnd(15)}${ruleset.$symbol}\n`;
        out += `  ${"Provides:".padEnd(15)}${ruleset.$provides}\n`;
        return out + "\n  Defined by the library; nothing to configure.";
    }

    if (ruleset._t !== "RulesetStruct" && ruleset._t !== "RulesetDescriptor") {
        return `${name} is not a struct or descriptor`;
    }

    out += "\n";

    const name_width = column_width("Property", ruleset.properties.map(property => property.name));
    const type_width = column_width("Type", ruleset.properties.map(property => format_property_type(property._t)));
    out += `  ${"Property".padEnd(name_width)}${"Type".padEnd(type_width)}Value\n`;
    out += `  ${"─".repeat(name_width + type_width + 18)}\n`;

    for (const property of ruleset.properties) {
        const required = property.required ? "* " : "  ";
        const type = format_property_type(property._t);
        let value = property._t === "IncludeProperty" && property.value === undefined
            ? `(${include_target(property)})`
            : format_property_value(property);
        if (property.cleared === true) {
            value = "- (cleared)";
        } else if (property.auto === true) {
            value = `${value} (auto)`;
        }

        out += `${required}${property.name.padEnd(name_width)}${type.padEnd(type_width)}${value}\n`;
    }

    out += "\n* = required   (auto) = set by bootstrap   (cleared) = you set it to nothing";
    return out;
}
