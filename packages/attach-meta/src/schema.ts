import * as fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { AnalogAttachError } from "./error.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function findSchemasDirectory(): string {
    for (const candidate of [
        path.resolve(__dirname, "../schemas"),
        path.resolve(__dirname, "../src/schemas"),
    ]) {
        if (fs.existsSync(candidate)) {return candidate;}
    }
    throw new AnalogAttachError("internal", "schemas directory not found");
}

let _schemasDirectory: string | undefined;
function schemasDirectory(): string {
    _schemasDirectory ??= findSchemasDirectory();
    return _schemasDirectory;
}

export function loadSchemaFile(relativePath: string): Record<string, unknown> {
    const full = path.join(schemasDirectory(), relativePath);
    return JSON.parse(fs.readFileSync(full, "utf8")) as Record<string, unknown>;
}

const ajv = new Ajv2020({ allErrors: true, strict: false });

let _manifestValidator: ReturnType<typeof ajv.compile> | undefined;

function manifestValidator() {
    if (!_manifestValidator) {
        const schema = loadSchemaFile("manifest.schema.json");
        _manifestValidator = ajv.compile(schema);
    }
    return _manifestValidator;
}

export function validateManifest(manifestJson: Record<string, unknown>): void {
    const validate = manifestValidator();
    if (!validate(manifestJson)) {
        const errors = (validate.errors ?? [])
            .map(error_ => `${error_.message ?? "unknown"} at ${error_.instancePath}`)
            .join("\n  ");
        throw new AnalogAttachError(
            "manifest",
            `manifest meta-schema validation failed:\n  ${errors}`,
        );
    }

    checkNoRequiredInArguments(manifestJson);
    checkNoCompletionFlagShadowsCommand(manifestJson);
}

function checkNoRequiredInArguments(manifest: Record<string, unknown>): void {
    const commands = manifest["commands"] as Record<string, Record<string, unknown>> | undefined;
    if (!commands) {return;}

    for (const [cmdName, mapping] of Object.entries(commands)) {
        const arguments_ = mapping["args"] as Record<string, unknown> | undefined;
        if (arguments_?.["required"] !== undefined) {
            throw new AnalogAttachError(
                "manifest",
                `command '${cmdName}' declares a top-level 'required' in args — tool-declared args may only add optional properties`,
            );
        }
    }
}

function checkNoCompletionFlagShadowsCommand(manifest: Record<string, unknown>): void {
    const commands = manifest["commands"] as Record<string, Record<string, unknown>> | undefined;
    if (!commands) {return;}

    for (const [cmdName, mapping] of Object.entries(commands)) {
        const arguments_ = mapping["args"] as Record<string, unknown> | undefined;
        const properties = arguments_?.["properties"] as Record<string, unknown> | undefined;
        if (properties && cmdName in properties) {
            throw new AnalogAttachError(
                "manifest",
                `command '${cmdName}' declares a flag named '${cmdName}' — flag names must not equal their command name (reserved for positional completion)`,
            );
        }
    }
}

export function validateInput(schema: Record<string, unknown>, input: Record<string, unknown>): void {
    let validate: ReturnType<typeof ajv.compile>;
    try {
        validate = ajv.compile(schema);
    } catch (error) {
        throw new AnalogAttachError(
            "input",
            `failed to compile input schema: ${(error as Error).message}`,
        );
    }

    if (!validate(input)) {
        const errors = (validate.errors ?? [])
            .map(error_ => `${error_.message ?? "unknown"}`)
            .join("\n  ");
        throw new AnalogAttachError(
            "input",
            `input validation failed:\n  ${errors}`,
        );
    }
}
