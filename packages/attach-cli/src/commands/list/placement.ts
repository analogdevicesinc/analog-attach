import type { LocalContext } from "../../context";
import { run_internal_list } from "./internal";

export async function list_parent(context_: LocalContext, arguments_: string[]): Promise<void> {
    if (arguments_.length === 0) {
        if (context_.json) {
            const { input_error } = await import("../../protocol/output");
            input_error("compatible string is required for list parent");
        } else {
            console.log("Missing: compatible (list parent <compatible>)");
        }
        return;
    }
    await run_internal_list(context_, ["parent", arguments_[0]!]);
}

export async function list_slot(context_: LocalContext, arguments_: string[]): Promise<void> {
    await run_internal_list(context_, ["board-slot", ...(arguments_.length > 0 ? [arguments_[0]!] : [])]);
}
