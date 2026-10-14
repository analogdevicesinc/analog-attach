import type { CommandContext } from "../dispatch";
import type { CommandName } from "../../protocol/manifest";
import { getCommand } from "../../protocol/manifest";
import { invoke } from "../../transport";
import { AnalogAttachError } from "../../error";

export function runValidate(
    _cmd: CommandName,
    positionals: readonly string[],
    _flags: Record<string, unknown>,
    context: CommandContext,
): Record<string, unknown> {
    const mapping = getCommand(context.manifest, "validate");
    if (!mapping) {
        throw new AnalogAttachError("manifest", "command 'validate' not in manifest");
    }

    const response = invoke(mapping, []);

    if (positionals.length === 0) {return response;}

    const errors = Array.isArray(response["errors"])
        ? filterByPrefix(response["errors"] as ValidationErrorLike[], positionals)
        : [];
    const warnings = Array.isArray(response["warnings"])
        ? filterByPrefix(response["warnings"] as ValidationErrorLike[], positionals)
        : [];

    return { ...response, errors, warnings };
}

interface ValidationErrorLike {
    path: string[];
    [key: string]: unknown;
}

function filterByPrefix(
    items: ValidationErrorLike[],
    prefixes: readonly string[],
): ValidationErrorLike[] {
    return items.filter(item => {
        if (item.path.length === 0) {return true;}
        if (item.path.length < prefixes.length) {return false;}
        for (const [index, prefix] of prefixes.entries()) {
            if (item.path[index] !== prefix) {return false;}
        }
        return true;
    });
}
