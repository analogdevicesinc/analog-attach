import { buildCommand } from "@stricli/core";
import { rename_symbol } from "attach-no-os-lib";
import type { AttachContext } from "./shared";
import { load_context, output, output_error, save_workfile } from "./shared";
import {
    prior_positionals,
    filter_completions,
    get_node_names,
    get_property_names
} from "../completion/completion";
import { common_ok } from "../protocol/responses";

type RenameFlags = {
    json?: boolean;
    to?: string;
};

/**
 * `attach-noos rename <node> --to <name>` — rename a node.
 *
 * Renaming a node rewrites every reference to it, which is why this is a command of its own
 * rather than a delete-and-re-add: the references are the part that would be lost.
 *
 * A property cannot be renamed. Its name is a field name in the C struct the node's schema
 * describes, so a different name is a different field — which is what the refusal says.
 */
export const renameCommand = buildCommand<
    RenameFlags,
    [string | undefined, string | undefined],
    AttachContext
>({
    docs: {
        brief: "Rename a node",
        fullDescription: "Renames <node> to --to, rewriting every reference to it. Properties cannot be renamed."
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
                {
                    placeholder: "property", brief: "Property (accepted, but properties cannot be renamed)", optional: true, parse: String,
                    proposeCompletions(partial: string) {
                        const [node] = prior_positionals(this, 1);
                        return filter_completions(get_property_names(node), partial);
                    }
                }
            ]
        },
        flags: {
            json: { kind: "boolean", brief: "Output as JSON", optional: true },
            to: { kind: "parsed", brief: "New name", optional: true, parse: String }
        }
    },
    func: async (flags: RenameFlags, node, property) => {
        if (!node) {
            output_error(flags, "Nothing to rename: pass <node> --to <name>");
            return;
        }

        if (!flags.to) {
            output_error(flags, `No new name for '${node}': pass --to <name>`);
            return;
        }

        if (property) {
            output_error(
                flags,
                `'${property}' cannot be renamed: a property name is a field of the C struct '${node}' `
                + "generates, and its schema decides what those fields are called."
            );
            return;
        }

        const context = load_context();
        if (!context.ok) {
            output_error(flags, context.error.message);
            return;
        }

        const renamed = rename_symbol(context.value.workfile, node, flags.to);
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

        const message = `Renamed '${node}' to '${flags.to}'`;
        output(flags, message, common_ok(message));
    }
});
