import {
    effective_property,
    suggest_for_property,
    type Property,
    type PropertySuggestions,
    type Ruleset
} from "attach-no-os-lib";
import { answer, command, refuse, type Outcome, type ReadArguments, type Session } from "../../../interface/backend-interface";
import {
    column_width,
    format_node_list,
    format_property_details,
    format_property_type,
    format_property_value,
    get_any_node,
    get_node_property,
    load_context,
    root_key
} from "./shared";
import { include_target, node_origin, to_protocol_node, to_protocol_property, to_protocol_root } from "../protocol/convert";
import type { ReadProperty, ReadResponse } from "../protocol/responses";

/**
 * `read [node] [property]`: the tree, a node, or one property.
 *
 * The path is absolute from the root and the workfile is flat, so it is at most two deep:
 * no positionals is the whole tree, one names a node, two name a property of that node.
 */
export const read = command<ReadArguments, ReadResponse>({
    docs: {
        brief: "Read the workfile, a node, or a property",
        full:
            "With no arguments, prints the whole workfile.\n" +
            "With <node>, prints that node's properties. With <node> <property>, prints one property.\n" +
            "--quiet prints only the values: the node names, a node's 'property value' lines, or the\n" +
            "property's value alone."
    },
    run(arguments_, _flags, session) {
        return Promise.resolve(read_target(session, arguments_.quiet, arguments_.path, arguments_.property));
    }
});

/**
 * The workfile, a node or a property, as `read` answers. `update <node> <property>` with
 * no value reads through here too, so the two never answer differently.
 */
export function read_target(session: Session, quiet: boolean, node?: string, property?: string): Outcome<ReadResponse> {
    const context = load_context(session);
    if (!context.ok) {
        return refuse(context.error.message);
    }

    const root = root_key(context.value);

    // read: the whole tree
    if (node === undefined || node === "") {
        const { minimal, workfile } = context.value;
        const text = quiet
            ? Object.keys(minimal.symbols).join("\n")
            : format_workfile(minimal.platform, minimal.board) + format_node_list(minimal, "Nodes:");
        return answer(() => to_protocol_root(root, minimal, workfile), text);
    }

    // read <node>
    if (property === undefined || property === "") {
        const found = get_any_node(context.value, node);
        if (!found.ok) {
            return refuse(found.error.message);
        }

        const text = quiet ? format_node_values(found.value) : format_node_summary(node, found.value);
        const origin = node_origin(context.value.workfile, node);
        return answer(() => to_protocol_node(node, found.value, origin), text);
    }

    // read <node> <property>
    const lookup = get_node_property(context.value, node, property);
    if (!lookup.ok) {
        return refuse(lookup.error.message);
    }

    // The lookup's own name, not what was typed: the lib only knows the workfile's
    // spelling, and `read <node> init_param` resolves to `$init_param`.
    const suggestions = suggest_for_property(context.value.workfile, node, lookup.value.property.name);
    if (!suggestions.ok) {
        session.warn(`Warning: could not compute suggestions: ${suggestions.error.message}`);
    }

    // As the part's overrides leave it - their default, description and allowed values -
    // the same view the suggestions above and the validator use, not the bare schema.
    const effective = effective_property(context.value.workfile, node, lookup.value.property.name);
    if (!effective.ok) {
        session.warn(`Warning: could not apply overrides: ${effective.error.message}`);
    }
    const shown = effective.ok ? effective.value : lookup.value.property;

    const details: PropertySuggestions = suggestions.ok ? suggestions.value : {};
    // The same lists the text shows under Suggestions and Can create.
    const response = (): ReadProperty => ({
        ...to_protocol_property(shown),
        suggestions: {
            values: (details.values ?? []).map(value => ({ value })),
            can_create: (details.types ?? []).map(value => ({ value })),
        },
    });
    return answer(response, quiet ? quiet_value(shown) : format_property_details(shown, details, session.program));
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
