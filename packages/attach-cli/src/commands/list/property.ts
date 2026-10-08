import type { LocalContext } from "../../context";
import { run_internal_list } from "./internal";

export async function list_property(context_: LocalContext, arguments_: string[]): Promise<void> {
    if (arguments_.length === 0) {
        if (context_.json) {
            const { input_error } = await import("../../protocol/output");
            input_error("path is required for list property");
        } else {
            console.log("Missing: path (list property <path> [property])");
        }
        return;
    }

    await arguments_.length === 1
        ? run_internal_list(context_, ["node-prop", arguments_[0]!])
        : run_internal_list(context_, ["type", arguments_[0]!, arguments_[1]!]);
}
