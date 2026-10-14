import type { CommandContext } from "../dispatch";
import type { CommandName } from "../../protocol/manifest";
import { getCommand } from "../../protocol/manifest";
import { invoke } from "../../transport";
import { AnalogAttachError } from "../../error";

export function runRestructure(
    cmd: CommandName,
    positionals: readonly string[],
    flags: Record<string, unknown>,
    context: CommandContext,
): Record<string, unknown> {
    switch (cmd) {
        case "move": {
            return runMove(positionals, flags, context);
        }
        case "rename": {
            return runRename(positionals, flags, context);
        }
        case "alias": {
            return runAlias(positionals, flags, context);
        }
        default: {
            throw new AnalogAttachError("input", `unexpected restructure command: ${cmd}`);
        }
    }
}

function getArrayFlag(flags: Record<string, unknown>, key: string): string[] {
    const value = flags[key];
    if (!Array.isArray(value)) {return [];}
    return value.filter((v): v is string => typeof v === "string");
}

function pushArrayFlag(arguments_: string[], flag: string, values: string[]): void {
    if (values.length === 0) {return;}
    arguments_.push(`--${flag}`, ...values);
}

function runMove(
    positionals: readonly string[],
    flags: Record<string, unknown>,
    context: CommandContext,
): Record<string, unknown> {
    const mapping = getCommand(context.manifest, "move");
    if (!mapping) {
        throw new AnalogAttachError("manifest", "command 'move' not in manifest — tool does not support move");
    }

    const arguments_ = [...positionals];
    const destination = getArrayFlag(flags, "to");
    pushArrayFlag(arguments_, "to", destination);

    return invoke(mapping, arguments_);
}

function runRename(
    positionals: readonly string[],
    flags: Record<string, unknown>,
    context: CommandContext,
): Record<string, unknown> {
    const mapping = getCommand(context.manifest, "rename");
    if (!mapping) {
        throw new AnalogAttachError("manifest", "command 'rename' not in manifest — tool does not support rename");
    }

    const arguments_ = [...positionals];
    const to = flags["to"];
    if (typeof to === "string") {
        arguments_.push("--to", to);
    }

    return invoke(mapping, arguments_);
}

function runAlias(
    positionals: readonly string[],
    flags: Record<string, unknown>,
    context: CommandContext,
): Record<string, unknown> {
    const mapping = getCommand(context.manifest, "alias");
    if (!mapping) {
        throw new AnalogAttachError("manifest", "command 'alias' not in manifest — tool does not support aliases");
    }

    const arguments_ = [...positionals];
    const withValue = flags["with"];
    const removeValue = flags["remove"];

    if (typeof withValue === "string") {
        arguments_.push("--with", withValue);
    } else if (typeof removeValue === "string") {
        arguments_.push("--remove", removeValue);
    }

    return invoke(mapping, arguments_);
}
