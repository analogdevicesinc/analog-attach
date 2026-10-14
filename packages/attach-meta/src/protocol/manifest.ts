export type CommandName =
    | "tool-config-get"
    | "tool-config-set"
    | "create-workfile"
    | "list-devices"
    | "add"
    | "read"
    | "update"
    | "delete"
    | "move"
    | "rename"
    | "alias"
    | "validate"
    | "generate"
    | "build"
    | "deploy"
    | "list-intelligence"
    | "suggest";

export const COMMAND_NAMES: readonly CommandName[] = [
    "tool-config-get",
    "tool-config-set",
    "create-workfile",
    "list-devices",
    "add",
    "read",
    "update",
    "delete",
    "move",
    "rename",
    "alias",
    "validate",
    "generate",
    "build",
    "deploy",
    "list-intelligence",
    "suggest",
] as const;

export const REQUIRED_COMMANDS: readonly CommandName[] = [
    "tool-config-get",
    "tool-config-set",
    "create-workfile",
    "list-devices",
    "add",
    "read",
    "update",
    "delete",
    "validate",
] as const;

export interface CompletionHint {
    arg: string;
    kind: string;
}

export interface CommandMapping {
    description?: string;
    argv: string[];
    args?: Record<string, unknown>;
    timeout_ms?: number;
    completions?: CompletionHint[];
}

export interface Manifest {
    protocol_version: string;
    commands: Record<string, CommandMapping>;
}

export function getCommand(manifest: Manifest, name: CommandName): CommandMapping | undefined {
    return manifest.commands[name];
}

export function parseManifest(json: string): Manifest {
    try {
        return JSON.parse(json) as Manifest;
    } catch (error) {
        throw new Error(`failed to parse manifest: ${error instanceof Error ? error.message : error}`);
    }
}
