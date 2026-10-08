import { Command } from "commander";
import type { LocalContext } from "../../context";
import { run_suggest } from "../suggest/command";

export async function run_internal_list(context: LocalContext, arguments_: string[]): Promise<void> {
    await run_suggest(context, arguments_);
}

export function build_internal_list_command(context: LocalContext): Command {
    return new Command("__list")
        .description("Internal: run a suggestion kind (used by shell completion)")
        .argument("[args...]", "kind followed by kind-specific args")
        .action(async (arguments_: string[]) => {
            await run_internal_list(context, arguments_);
        });
}
