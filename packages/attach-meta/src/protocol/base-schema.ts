import * as fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { CommandName } from "./manifest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function findSchemasDirectory(): string {
    for (const candidate of [
        path.resolve(__dirname, "..", "schemas", "command_base_schemas"),
        path.resolve(__dirname, "..", "src", "schemas", "command_base_schemas"),
    ]) {
        if (fs.existsSync(candidate)) {return candidate;}
    }
    throw new Error("command_base_schemas directory not found");
}

let schemasDirectory: string | undefined;

const cache = new Map<CommandName, Record<string, unknown>>();

function loadSchema(cmd: CommandName): Record<string, unknown> {
    schemasDirectory ??= findSchemasDirectory();
    const filePath = path.join(schemasDirectory, `${cmd}.schema.json`);
    const content = fs.readFileSync(filePath, "utf8");
    return JSON.parse(content) as Record<string, unknown>;
}

export function baseSchema(cmd: CommandName): Record<string, unknown> {
    let schema = cache.get(cmd);
    if (schema === undefined) {
        schema = loadSchema(cmd);
        cache.set(cmd, schema);
    }
    return schema;
}

export function effectiveSchema(
    cmd: CommandName,
    toolArguments?: Record<string, unknown>,
): Record<string, unknown> {
    const base = baseSchema(cmd);
    if (toolArguments !== undefined) {
        return { allOf: [base, toolArguments] };
    }
    return base;
}
