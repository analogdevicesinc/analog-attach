import { buildCommand } from "@stricli/core";
import {
    Ruleset,
    PropertySuggestions,
    suggest_for_property
} from "attach-no-os-lib";
import type { AttachContext } from "./shared";
import {
    load_context,
    output,
    output_error,
    get_any_node,
    get_node_property,
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
import { include_target, to_protocol_node, to_protocol_property, to_protocol_root } from "../protocol/convert";
import { read_failure } from "../protocol/responses";

/**
 * `aa read [node] [property]` — the tree, a node, or one property.
 *
 * The path is absolute from the root and the workfile is flat, so it is at most two deep:
 * no positionals is the whole tree, one names a node, two name a property of that node.
 */
export const readCommand = buildCommand<
    { json?: boolean },
    [string | undefined, string | undefined],
    AttachContext
>({
    docs: {
        brief: "Read the workfile, a node, or a property",
        fullDescription:
            "With no arguments, prints the whole workfile.\n" +
            "With <node>, prints that node's properties. With <node> <property>, prints one property."
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
            json: { kind: "boolean", brief: "Output as JSON", optional: true }
        }
    },
    func: async (flags, node, property) => {
        const context = load_context();
        if (!context.ok) {
            output_error(flags, context.error.message, { response: read_failure(context.error.message) });
            return;
        }

        const root = root_key(context.value);

        // aa read — the whole tree
        if (!node) {
            const text = format_workfile(context.value.minimal.platform, context.value.minimal.board)
                + format_node_list(context.value.minimal, "Nodes:");
            output(flags, text, to_protocol_root(root, context.value.minimal, context.value.workfile));
            return;
        }

        // aa read <node>
        if (!property) {
            const found = get_any_node(context.value, node);
            if (!found.ok) {
                output_error(flags, found.error.message, { response: read_failure(found.error.message) });
                return;
            }

            output(flags, format_node_summary(node, found.value), to_protocol_node(node, found.value));
            return;
        }

        // aa read <node> <property>
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

        const details: PropertySuggestions = suggestions.ok ? suggestions.value : {};
        output(
            flags,
            format_property_details(lookup.value.property, details),
            to_protocol_property(lookup.value.property)
        );
    }
});

// ------- FORMATTERS --------

function format_workfile(platform?: string, board?: string): string {
    let out = `Platform: ${platform ?? "-"}\n`;
    if (board) {
        out += `Board:    ${board}\n`;
    }
    return `${out}\n`;
}

function format_node_summary(name: string, ruleset: Ruleset): string {
    let out = `${name}\n`;
    out += `  ${ruleset.$id}\n`;
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

    out += `  ${"Property".padEnd(20)}${"Type".padEnd(18)}${"Value".padEnd(18)}\n`;
    out += `  ${"─".repeat(56)}\n`;

    for (const property of ruleset.properties) {
        const required = property.required ? "* " : "  ";
        const type = format_property_type(property._t);
        const value = property._t === "IncludeProperty" && property.value === undefined
            ? `(${include_target(property)})`
            : format_property_value(property);

        out += `${required}${property.name.padEnd(20)}${type.padEnd(18)}${value}\n`;
    }

    out += "\n* = required";
    return out;
}
