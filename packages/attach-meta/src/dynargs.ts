import type { CommandName, CommandMapping } from "./protocol/manifest";
import { baseSchema } from "./protocol/base-schema";
import { AnalogAttachError } from "./error";

export interface ParsedInput {
    flagsJson: Record<string, unknown>;
    positionals: string[];
}

export function collectFlagNames(cmd: CommandName, toolArguments: Record<string, unknown> | undefined): string[] {
    const base = baseSchema(cmd);
    const flags: string[] = [];
    const baseProperties = (base as Record<string, unknown>)["properties"] as Record<string, Record<string, unknown>> | undefined;
    if (baseProperties) {
        for (const [name, property] of Object.entries(baseProperties)) {
            if (property["x-positional"] !== true) {
                flags.push(name);
            }
        }
    }
    if (toolArguments) {
        const toolProperties = (toolArguments as Record<string, unknown>)["properties"] as Record<string, unknown> | undefined;
        if (toolProperties) {
            for (const key of Object.keys(toolProperties)) {
                if (!flags.includes(key)) {
                    flags.push(key);
                }
            }
        }
    }
    return flags;
}

export function flagTypeInSchema(name: string, cmd: CommandName, toolArguments: Record<string, unknown> | undefined): string | undefined {
    const base = baseSchema(cmd);
    return flagType(name, base, toolArguments);
}

export function parseCommandArguments(cmd: CommandName, mapping: CommandMapping, rawArguments: readonly string[]): ParsedInput {
    const base = baseSchema(cmd);
    const toolArguments = mapping.args;

    if (toolArguments) {
        const baseProperties = (base as Record<string, unknown>)["properties"] as Record<string, unknown> | undefined;
        const toolProperties = (toolArguments as Record<string, unknown>)["properties"] as Record<string, unknown> | undefined;
        if (baseProperties && toolProperties) {
            for (const key of Object.keys(toolProperties)) {
                if (key in baseProperties) {
                    throw new AnalogAttachError("manifest", `tool arg '--${key}' collides with a protocol flag`);
                }
            }
        }
    }

    const flags: Record<string, unknown> = {};
    const positionals: string[] = [];

    let index = 0;
    while (index < rawArguments.length) {
        const argument = rawArguments[index]!;
        if (argument.startsWith("--")) {
            const flagName = argument.slice(2);
            if (flagName === "") {
                index++;
                positionals.push(...rawArguments.slice(index));
                break;
            }

            const isBool = isBooleanFlag(flagName, base, toolArguments);
            const isArray = isArrayFlag(flagName, base, toolArguments);

            if (isBool) {
                flags[flagName] = true;
            } else if (isArray) {
                const values: string[] = [];
                index++;
                while (index < rawArguments.length && !rawArguments[index]!.startsWith("--")) {
                    values.push(rawArguments[index]!);
                    index++;
                }
                if (values.length === 0) {
                    throw new AnalogAttachError("input", `flag '--${flagName}' requires at least one value`);
                }
                flags[flagName] = values;
                continue;
            } else if (index + 1 < rawArguments.length) {
                index++;
                flags[flagName] = rawArguments[index];
            } else {
                throw new AnalogAttachError("input", `flag '--${flagName}' requires a value`);
            }
        } else {
            positionals.push(argument);
        }
        index++;
    }

    return { flagsJson: flags, positionals };
}

function flagType(name: string, base: Record<string, unknown>, toolArguments: Record<string, unknown> | undefined): string | undefined {
    const baseProperties = (base as Record<string, unknown>)["properties"] as Record<string, Record<string, unknown>> | undefined;
    if (baseProperties?.[name]?.["x-positional"] === true) {
        return undefined;
    }
    for (const schema of [base, toolArguments]) {
        if (!schema) {continue;}
        const properties = (schema as Record<string, unknown>)["properties"] as Record<string, Record<string, unknown>> | undefined;
        const type_ = properties?.[name]?.["type"] as string | undefined;
        if (type_) {return type_;}
    }
    return undefined;
}

function isBooleanFlag(name: string, base: Record<string, unknown>, toolArguments: Record<string, unknown> | undefined): boolean {
    return flagType(name, base, toolArguments) === "boolean";
}

function isArrayFlag(name: string, base: Record<string, unknown>, toolArguments: Record<string, unknown> | undefined): boolean {
    return flagType(name, base, toolArguments) === "array";
}
