import { buildCommand } from "@stricli/core";
import { filter_completions, get_node_names } from "../completion/completion";
import type { AttachContext } from "./shared";
import { output_error } from "./shared";

type MoveFlags = {
    json?: boolean;
    to?: string[];
};

/**
 * `aa move` — always refused.
 *
 * There is nowhere to move a node to: the workfile is a flat symbol table, so every node
 * already sits at the root and a node's place in it carries no meaning. What a move is
 * usually reaching for is a *reference* — which node points at which — and that is set with
 * `aa update`.
 *
 * The command exists so it can say so. Leaving it out of the manifest instead makes
 * attach-meta emulate a move with read → add → update → delete `--force`, which rebuilds the
 * node under a parent we would reject and then deletes the original: a half-rewritten
 * workfile in place of an error message.
 *
 * Both the source path and `--to` are variadic, matching aa-meta's base schema, so any path
 * it forwards reaches the refusal instead of a stricli usage error — which would be reported
 * as a transport failure rather than the answer it is.
 */
export const moveCommand = buildCommand<MoveFlags, string[], AttachContext>({
    docs: {
        brief: "Not supported: the workfile is flat",
        fullDescription:
            "Nodes have no parents to move between — every node lives at the root.\n" +
            "To change which node references another, set the referencing property with 'aa update'."
    },
    parameters: {
        positional: {
            kind: "array",
            parameter: {
                placeholder: "path",
                brief: "Path of the node to move",
                parse: String,
                proposeCompletions(partial: string) {
                    return filter_completions(get_node_names(), partial);
                }
            }
        },
        flags: {
            json: { kind: "boolean", brief: "Output as JSON", optional: true },
            to: {
                kind: "parsed",
                brief: "Destination parent path",
                optional: true,
                variadic: true,
                parse: String,
                proposeCompletions(partial: string) {
                    return filter_completions(get_node_names(), partial);
                }
            }
        }
    },
    func: async (flags: MoveFlags, ...path: string[]) => {
        const target = path.length > 0 ? `'${path.join(" ")}'` : "a node";
        output_error(
            flags,
            `Cannot move ${target}: this workfile is a flat symbol table, so every node lives at the root `
            + "and has no parent to move between. To change which node references another, set the "
            + "referencing property: aa update <node> <property> --with <target>"
        );
    }
});
