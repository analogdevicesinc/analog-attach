import { buildCommand } from "@stricli/core";
import { rename_symbol } from "attach-no-os-lib";
import type { AttachContext } from "./shared";
import { load_context, output, output_error, save_workfile } from "./shared";
import { filter_completions, get_node_names } from "../completion/completion";
import { common_ok } from "../protocol/responses";

type RenameFlags = {
    json?: boolean;
};

/**
 * `attach-noos rename <node> <new-name>` — rename a node.
 *
 * Renaming a node rewrites every reference to it, which is why this is a command of its own
 * rather than a delete-and-re-add: the references are the part that would be lost. Only
 * nodes are renamed: a property's name is a field of the C struct the node generates, and
 * its schema decides it.
 */
export const renameCommand = buildCommand<
    RenameFlags,
    [string | undefined, string | undefined],
    AttachContext
>({
    docs: {
        brief: "Rename a node",
        fullDescription: "Renames <node> to <new-name>, rewriting every reference to it."
    },
    parameters: {
        positional: {
            kind: "tuple",
            parameters: [
                {
                    placeholder: "node", brief: "Node to rename", optional: true, parse: String,
                    proposeCompletions(partial: string) {
                        return filter_completions(get_node_names(), partial);
                    }
                },
                { placeholder: "new-name", brief: "Its new name", optional: true, parse: String }
            ]
        },
        flags: {
            json: { kind: "boolean", brief: "Output as JSON", optional: true }
        }
    },
    func: async (flags: RenameFlags, node, new_name) => {
        if (!node) {
            output_error(flags, "Nothing to rename: pass <node> <new-name>");
            return;
        }

        if (!new_name) {
            output_error(flags, `No new name for '${node}': pass it after the node`);
            return;
        }

        const context = load_context();
        if (!context.ok) {
            output_error(flags, context.error.message);
            return;
        }

        const renamed = rename_symbol(context.value.workfile, node, new_name);
        if (!renamed.ok) {
            output_error(flags, renamed.error.message);
            return;
        }

        context.value.workfile = renamed.value;

        const saved = save_workfile(context.value);
        if (!saved.ok) {
            output_error(flags, saved.error.message);
            return;
        }

        const message = `Renamed '${node}' to '${new_name}'`;
        output(flags, message, common_ok(message));
    }
});
