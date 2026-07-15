import { buildCommand } from "@stricli/core";
import {
    remove_symbol,
    set_value
} from "attach-no-os-lib";
import {
    load_context,
    save_workfile,
    output,
    output_error,
    get_node,
    get_node_property,
    format_node_list
} from "./shared";
import {
    prior_positionals,
    filter_completions,
    get_node_names,
    get_property_names,
    get_value_suggestions
} from "../completion/completion";

export const deleteCommand = buildCommand<
    { json?: boolean; yes?: boolean },
    [string | undefined, string | undefined, string | undefined]
>({
    docs: { brief: "Delete a node, or reset a property or union member" },
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
                    placeholder: "property", brief: "Property to reset", optional: true, parse: String,
                    proposeCompletions(partial: string) {
                        const [node] = prior_positionals(this, 1);
                        return filter_completions(get_property_names(node), partial);
                    }
                },
                {
                    placeholder: "member", brief: "Union member to reset", optional: true, parse: String,
                    proposeCompletions(partial: string) {
                        const [node, property] = prior_positionals(this, 1);
                        return filter_completions(get_value_suggestions(node, property), partial);
                    }
                }
            ]
        },
        flags: {
            json: { kind: "boolean", brief: "Output as JSON", optional: true },
            yes: { kind: "boolean", brief: "Confirm node deletion (required to delete a node)", optional: true }
        }
    },
    func: async (flags, node, property, member) => {
        const context = load_context();
        if (!context.ok) {
            output_error(flags, "load_failed", context.error.message);
            return;
        }

        // aa delete - list deletable nodes
        if (!node) {
            const text = format_node_list(context.value.minimal, "Nodes that can be deleted:") + "\nUse: aa delete <node>";
            const json = {
                nodes: Object.entries(context.value.minimal.symbols).map(([name, n]) => ({
                    name,
                    schema: n.$compatible
                }))
            };
            output(flags, text, json);
            return;
        }

        // Check node exists
        const node_result = get_node(context.value, node);
        if (!node_result.ok) {
            output_error(flags, "node_not_found", node_result.error.message);
            return;
        }

        // aa delete <node> <property> [member] - reset a property or union member
        if (property) {
            const lookup = get_node_property(context.value, node, property);
            if (!lookup.ok) {
                output_error(flags, "property_not_found", lookup.error.message);
                return;
            }

            // aa delete <node> <property> <member> - reset a single union member
            if (member) {
                if (lookup.value.property._t !== "UnionProperty") {
                    output_error(flags, "not_a_union", `Property '${property}' is not a union; omit the member to reset it`);
                    return;
                }

                const union_member = lookup.value.property.members.find(m => m.name === member);
                if (!union_member) {
                    output_error(flags, "invalid_union_member", `Invalid union member '${member}'. Available: ${lookup.value.property.members.map(m => m.name).join(", ")}`);
                    return;
                }

                // eslint-disable-next-line unicorn/no-null
                const result = set_value(context.value.workfile, node, property, { [member]: null });
                if (!result.ok) {
                    output_error(flags, "reset_failed", result.error.message);
                    return;
                }

                const save = save_workfile(context.value);
                if (!save.ok) {
                    output_error(flags, "save_failed", save.error.message);
                    return;
                }

                output(flags, `Reset ${node}.${property} member ${member}`, { reset: { node, property, member } });
                return;
            }

            // aa delete <node> <property> - reset the whole property
            const result = set_value(context.value.workfile, node, property);
            if (!result.ok) {
                output_error(flags, "reset_failed", result.error.message);
                return;
            }

            const save = save_workfile(context.value);
            if (!save.ok) {
                output_error(flags, "save_failed", save.error.message);
                return;
            }

            output(flags, `Reset ${node}.${property}`, { reset: { node, property } });
            return;
        }

        // aa delete <node> - delete the node (requires --yes)
        if (!flags.yes) {
            output_error(flags, "confirmation_required", `This will delete node '${node}'. Re-run with --yes to confirm.`);
            return;
        }

        const result = remove_symbol(context.value.workfile, node);
        if (!result.ok) {
            output_error(flags, "delete_failed", result.error.message);
            return;
        }

        const save = save_workfile(context.value);
        if (!save.ok) {
            output_error(flags, "save_failed", save.error.message);
            return;
        }

        output(flags, `Deleted node ${node}`, { deleted: node });
    }
});
