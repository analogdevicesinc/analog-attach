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
    filter_completions,
    get_node_names
} from "../completion/completion";

export const deleteCommand = buildCommand<
    { json?: boolean; reset?: string },
    [string | undefined]
>({
    docs: { brief: "Delete a node or reset a property" },
    parameters: {
        positional: {
            kind: "tuple",
            parameters: [
                {
                    placeholder: "node", brief: "Node name", optional: true, parse: String,
                    proposeCompletions(partial: string) {
                        return filter_completions(get_node_names(), partial);
                    }
                }
            ]
        },
        flags: {
            json: { kind: "boolean", brief: "Output as JSON", optional: true },
            reset: { kind: "parsed", brief: "Property to reset", optional: true, parse: String }
        }
    },
    func: async (flags, node) => {
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

        // aa delete <node> --reset <property>
        if (flags.reset) {
            const lookup = get_node_property(context.value, node, flags.reset);
            if (!lookup.ok) {
                output_error(flags, "property_not_found", lookup.error.message);
                return;
            }

            const result = set_value(context.value.workfile, node, flags.reset);
            if (!result.ok) {
                output_error(flags, "reset_failed", result.error.message);
                return;
            }

            const save = save_workfile(context.value);
            if (!save.ok) {
                output_error(flags, "save_failed", save.error.message);
                return;
            }

            output(flags, `Reset ${node}.${flags.reset}`, { reset: { node, property: flags.reset } });
            return;
        }

        // aa delete <node>
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
