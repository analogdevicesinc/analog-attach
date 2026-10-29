import { rename_symbol } from "attach-no-os-lib";
import { answer, command, refuse, type RenameArguments } from "../../../interface/backend-interface";
import { load_context, save_workfile } from "./shared";
import { common_ok, type CommonResponse } from "../protocol/responses";

/**
 * `rename <node> <new-name>`: rename a node.
 *
 * Renaming a node rewrites every reference to it, which is why this is a command of its own
 * rather than a delete-and-re-add: the references are the part that would be lost. Only
 * nodes are renamed: a property's name is a field of the C struct the node generates, and
 * its schema decides it.
 */
export const rename = command<RenameArguments, CommonResponse>({
    docs: {
        brief: "Rename a node",
        full: "Renames <node> to <name>, rewriting every reference to it."
    },
    run({ path: node, name }, _flags, session) {
        const context = load_context(session);
        if (!context.ok) {
            return Promise.resolve(refuse(context.error.message));
        }

        const renamed = rename_symbol(context.value.workfile, node, name);
        if (!renamed.ok) {
            return Promise.resolve(refuse(renamed.error.message));
        }

        context.value.workfile = renamed.value;

        const saved = save_workfile(context.value);
        if (!saved.ok) {
            return Promise.resolve(refuse(saved.error.message));
        }

        const message = `Renamed '${node}' to '${name}'`;
        return Promise.resolve(answer(common_ok(message), message));
    }
});
