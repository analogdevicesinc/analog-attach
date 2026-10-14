import type { CommandContext } from "../dispatch";
import type { CommandName } from "../../protocol/manifest";
import { getCommand } from "../../protocol/manifest";
import { invoke } from "../../transport";
import { AnalogAttachError } from "../../error";

export function runConfig(
    cmd: CommandName,
    positionals: readonly string[],
    _flags: Record<string, unknown>,
    context: CommandContext,
): Record<string, unknown> {
    const mapping = getCommand(context.manifest, cmd);
    if (!mapping) {
        throw new AnalogAttachError("manifest", `command '${cmd}' not in manifest`);
    }

    const extraArguments: string[] = [];

    if (cmd === "tool-config-get") {
        extraArguments.push(...positionals);
    } else if (cmd === "tool-config-set") {
        if (positionals.length < 2) {
            throw new AnalogAttachError("input", "tool-config-set requires <field> <value>");
        }
        extraArguments.push(...positionals);
    }

    return invoke(mapping, extraArguments);
}
