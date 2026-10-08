import type { LocalContext } from "../../context";
import { run_internal_list } from "./internal";

export async function list_value(context_: LocalContext, arguments_: string[]): Promise<void> {
    if (arguments_.length < 2) {
        if (context_.json) {
            const { input_error } = await import("../../protocol/output");
            input_error("path and property are required for list value");
        } else {
            console.log("Missing: path and property (list value <path> <property>)");
        }
        return;
    }
    await run_internal_list(context_, ["value", arguments_[0]!, arguments_[1]!]);
}
