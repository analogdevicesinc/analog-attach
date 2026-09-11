import { buildCommand } from "@stricli/core";
import { set_value } from "attach-no-os-lib";
import type { AttachContext } from "./shared";
import {
    load_context,
    save_workfile,
    output,
    output_error,
    get_node,
    get_node_property,
    resolve_property_name,
    format_property_value
} from "./shared";
import {
    prior_positionals,
    filter_completions,
    get_node_names,
    get_property_names,
    get_value_suggestions,
    get_union_value_suggestions
} from "../completion/completion";
import { ELEMENT_SEPARATOR, READONLY_KEYS, RESERVED_PREFIX, parse_property_value } from "../protocol/convert";
import { common_ok } from "../protocol/responses";

type UpdateFlags = {
    json?: boolean;
    with?: string;
};

/**
 * `aa update <node> <property> --with <value>` — set one property.
 *
 * The protocol's `update` is an upsert: an unknown property is inserted. Ours cannot be.
 * A node's properties come from its schema, which is the C struct it generates — a property
 * that is not in the schema is a field that does not exist — so an unknown name is refused
 * with the list of names that do exist.
 *
 * `--with` is a raw string by protocol, and none of the type information survives the trip,
 * so parsing it back into a number, an enum member or a union is entirely our job (see
 * parse_property_value).
 */
export const updateCommand = buildCommand<
    UpdateFlags,
    [string | undefined, string | undefined, string | undefined, string | undefined],
    AttachContext
>({
    docs: {
        brief: "Set a property on a node",
        fullDescription:
            "Sets <property> on <node>. The value can be given with --with or as a positional.\n" +
            `A union takes '<member>${ELEMENT_SEPARATOR}<value>' (or two positionals), an array a comma-separated list.\n` +
            `A property whose name starts with '${RESERVED_PREFIX}' can be written without it: init_param means ${RESERVED_PREFIX}init_param.`
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
                },
                {
                    placeholder: "value", brief: "Value to set (or a union member)", optional: true, parse: String,
                    proposeCompletions(partial: string) {
                        const [node, property] = prior_positionals(this, 1);
                        return filter_completions(get_value_suggestions(node, property), partial);
                    }
                },
                {
                    placeholder: "union_value", brief: "Value for the union member named before it", optional: true, parse: String,
                    proposeCompletions(partial: string) {
                        const [node, property, member] = prior_positionals(this, 1);
                        return filter_completions(get_union_value_suggestions(node, property, member), partial);
                    }
                }
            ]
        },
        flags: {
            json: { kind: "boolean", brief: "Output as JSON", optional: true },
            with: {
                kind: "parsed",
                brief: "Value to set, as one string",
                optional: true,
                parse: String,
                proposeCompletions(partial: string) {
                    const [node, property] = prior_positionals(this, 1);
                    return filter_completions(get_value_suggestions(node, property), partial);
                }
            }
        }
    },
    func: async (flags: UpdateFlags, node, property, value, union_value) => {
        if (!node || !property) {
            output_error(
                flags,
                "Nothing to update: pass <node> <property> --with <value>. " +
                "Use 'aa read' to see the nodes and 'aa read <node>' to see their properties."
            );
            return;
        }

        const context = load_context();
        if (!context.ok) {
            output_error(flags, context.error.message);
            return;
        }

        if (READONLY_KEYS.has(property)) {
            output_error(flags, `'${property}' describes the node rather than configuring it, and cannot be set`);
            return;
        }

        const owner = get_node(context.value, node);
        if (!owner.ok) {
            output_error(flags, owner.error.message);
            return;
        }

        // What the user typed, spelled the way the workfile spells it: `init_param` for
        // `$init_param`. Everything below uses this, not `property`.
        const resolved = resolve_property_name(owner.value, property);

        // The upsert half of the protocol's update: refused, with the names that would work.
        if (!owner.value.properties.some(candidate => candidate.name === resolved)) {
            output_error(
                flags,
                `'${node}' has no property '${property}', and one cannot be added: its properties are ` +
                `fixed by its schema (${owner.value.$id}). Available: ` +
                owner.value.properties.map(candidate => candidate.name).join(", ")
            );
            return;
        }

        const lookup = get_node_property(context.value, node, resolved);
        if (!lookup.ok) {
            output_error(flags, lookup.error.message);
            return;
        }

        // `--with` wins; the positional form is the human shorthand. Two positionals for a
        // union ('<member> <value>') fold into the one string the parser expects.
        const raw = flags.with ?? (
            value !== undefined && union_value !== undefined
                ? `${value}${ELEMENT_SEPARATOR}${union_value}`
                : value
        );

        if (raw === undefined) {
            output_error(
                flags,
                `No value given for '${node}.${property}'. Pass --with <value>; ` +
                `'aa read ${node} ${property}' lists what it accepts.`
            );
            return;
        }

        const parsed = parse_property_value(raw, lookup.value.property);
        if (!parsed.ok) {
            output_error(flags, parsed.error.message);
            return;
        }

        const updated = set_value(context.value.workfile, node, resolved, parsed.value);
        if (!updated.ok) {
            output_error(flags, updated.error.message);
            return;
        }

        const saved = save_workfile(context.value);
        if (!saved.ok) {
            output_error(flags, saved.error.message);
            return;
        }

        const message = `Set ${node}.${resolved} = ${format_property_value(lookup.value.property)}`;
        output(flags, message, common_ok(message));
    }
});
