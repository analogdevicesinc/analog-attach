import type { CommandName, Manifest } from "../protocol/manifest";
import { AnalogAttachError } from "../error";
import { runConfig } from "./config/command";
import { runWorkspace } from "./workspace/command";
import { runCrud } from "./crud/command";
import { runRestructure } from "./restructure/command";
import { runValidate } from "./validate/command";
import { runPipeline } from "./pipeline/command";

export interface CommandContext {
    manifest: Manifest;
}

export function dispatch(
    cmd: CommandName,
    positionals: readonly string[],
    flags: Record<string, unknown>,
    context: CommandContext,
): Record<string, unknown> {
    switch (cmd) {
        case "tool-config-get":
        case "tool-config-set": {
            return runConfig(cmd, positionals, flags, context);
        }
        case "create-workfile":
        case "list-devices": {
            return runWorkspace(cmd, positionals, flags, context);
        }
        case "add":
        case "read":
        case "update":
        case "delete": {
            return runCrud(cmd, positionals, flags, context);
        }
        case "move":
        case "rename":
        case "alias": {
            return runRestructure(cmd, positionals, flags, context);
        }
        case "validate": {
            return runValidate(cmd, positionals, flags, context);
        }
        case "generate":
        case "build":
        case "deploy": {
            return runPipeline(cmd, positionals, flags, context);
        }
        case "list-intelligence":
        case "suggest": {
            throw new Error("intelligence commands are handled directly in main");
        }
        default: {
            throw new AnalogAttachError("input", `unknown command: ${cmd as string}`);
        }
    }
}

export function buildExtraArguments(positionals: readonly string[], flags: Record<string, unknown>): string[] {
    const arguments_: string[] = [...positionals];
    for (const [key, value] of Object.entries(flags)) {
        if (typeof value === "boolean") {
            if (value) {
                arguments_.push(`--${key}`);
            }
        } else if (typeof value === "string") {
            arguments_.push(`--${key}`, value);
        } else if (Array.isArray(value)) {
            arguments_.push(`--${key}`);
            for (const item of value) {
                if (typeof item === "string") {
                    arguments_.push(item);
                }
            }
        }
    }
    return arguments_;
}
