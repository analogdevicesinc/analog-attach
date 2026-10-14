import type { CommandContext } from "../dispatch";
import { buildExtraArguments } from "../dispatch";
import type { CommandName } from "../../protocol/manifest";
import { getCommand } from "../../protocol/manifest";
import { invoke } from "../../transport";
import { AnalogAttachError } from "../../error";

export function runCrud(
    cmd: CommandName,
    positionals: readonly string[],
    flags: Record<string, unknown>,
    context: CommandContext,
): Record<string, unknown> {
    const mapping = getCommand(context.manifest, cmd);
    if (!mapping) {
        throw new AnalogAttachError("manifest", `command '${cmd}' not in manifest`);
    }

    const extraArguments = buildExtraArguments(positionals, flags);
    return invoke(mapping, extraArguments);
}
