#!/usr/bin/env node
import * as fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { AnalogAttachError, errorEnvelope } from "../error";
import type { CommandName } from "../protocol/manifest";
import { COMMAND_NAMES, getCommand, parseManifest } from "../protocol/manifest";
import { baseSchema, effectiveSchema } from "../protocol/base-schema";
import { loadConfig, findTool } from "../config";
import type { AppConfig } from "../config";
import { loadVerified } from "../manifest-store";
import { parseCommandArguments } from "../dynargs";
import { validateInput } from "../schema";
import { dispatch } from "../commands/dispatch";
import type { CommandContext } from "../commands/dispatch";
import { renderResponse } from "../render";
import { runComplete, generateCompletionScript } from "../complete";
import { runInit } from "../commands/init/command";
import { runIntelligence } from "../commands/intelligence/command";
import { StdinPrompter, ScriptedPrompter, isInteractive } from "../prompt";
import type { Prompter } from "../prompt";
import { loadSchemaFile } from "../schema";

const argv = process.argv.slice(2);

if (argv[0] === "__complete") {
    const dashDash = argv.indexOf("--");
    const words = dashDash === -1 ? argv.slice(1) : argv.slice(dashDash + 1);
    try {
        const [config, configPath] = loadConfig();
        runComplete(words, config, configPath);
    } catch { /* completions should never crash */ }
    process.exit(0);
}

const jsonIndex = argv.indexOf("--json");
const jsonMode = jsonIndex !== -1;
if (jsonMode) {argv.splice(jsonIndex, 1);}

const verboseIndex = argv.indexOf("--verbose");
const verbose = verboseIndex !== -1;
if (verbose) {argv.splice(verboseIndex, 1);}

if (argv.length === 0) {
    process.stderr.write("analog-attach: no command provided — try --help\n");
    process.exit(2);
}

const commandString = argv[0]!;
const rest = argv.slice(1);

switch (commandString) {
    case "completion": {
        handleCompletion(rest);
        process.exit(0);
        break;
    }
    case "schema": {
        handleSchema(rest);
        process.exit(0);
        break;
    }
    case "init": {
        const result = handleInit(rest);
        exitWithResult("tool-config-get", result, jsonMode);
        break;
    }
    case "list-intelligence":
    case "suggest": {
        const result = handleIntelligence(commandString as CommandName, rest);
        exitWithResult(commandString as CommandName, result, jsonMode);
        break;
    }
    default: {
        break;
    }
}

const cmd = COMMAND_NAMES.find(c => c === commandString) as CommandName | undefined;
if (!cmd) {
    process.stderr.write(`analog-attach: unknown command '${commandString}'\n`);
    process.exit(2);
}

let config: AppConfig;
let configPath: string;
try {
    [config, configPath] = loadConfig();
} catch (error) {
    exitError(
        new AnalogAttachError("internal", `config error: ${(error as Error).message}`),
        jsonMode,
    );
}

const toolName = config!.meta.default_tool;
if (!toolName) {
    process.stderr.write("analog-attach: no tool specified — set default_tool in .analog-attach.toml\n");
    process.exit(2);
}

const tool = findTool(config!, toolName);
if (!tool) {
    exitError(
        new AnalogAttachError("manifest", `tool '${toolName}' not found in config`),
        jsonMode,
    );
}

let manifest;
try {
    manifest = loadVerified(tool!, config!, configPath!).manifest;
} catch (error) {
    if (error instanceof AnalogAttachError) {exitError(error, jsonMode);}
    exitError(new AnalogAttachError("internal", (error as Error).message), jsonMode);
}

const mapping = getCommand(manifest!, cmd);
if (!mapping) {
    exitError(
        new AnalogAttachError("manifest", `tool '${toolName}' does not support '${cmd}'`),
        jsonMode,
    );
}

let parsed;
try {
    parsed = parseCommandArguments(cmd, mapping!, rest);
} catch (error) {
    if (error instanceof AnalogAttachError) {exitError(error, jsonMode);}
    exitError(new AnalogAttachError("input", (error as Error).message), jsonMode);
}

const helpRequested = parsed!.flagsJson["help"] === true;
if (!helpRequested) {
    const effSchema = effectiveSchema(cmd, mapping!.args);
    const validationFlags = { ...parsed!.flagsJson };
    injectXPositionals(cmd, parsed!.positionals, validationFlags);
    try {
        validateInput(effSchema, validationFlags);
    } catch (error) {
        if (error instanceof AnalogAttachError) {exitError(error, jsonMode);}
        exitError(new AnalogAttachError("input", (error as Error).message), jsonMode);
    }
}

const context: CommandContext = { manifest: manifest! };
try {
    const response = dispatch(cmd, parsed!.positionals, parsed!.flagsJson, context);
    exitWithResult(cmd, response, jsonMode);
} catch (error) {
    if (error instanceof AnalogAttachError) {exitError(error, jsonMode);}
    exitError(new AnalogAttachError("internal", (error as Error).message), jsonMode);
}

function handleInit(arguments_: readonly string[]): Record<string, unknown> {
    if (arguments_.length === 0) {
        throw new AnalogAttachError("input", "init requires <analog_attachable> argument");
    }

    const binary = arguments_[0]!;
    const noInteractive = arguments_.includes("--no-interactive");

    let cfg: AppConfig;
    let cfgPath: string;
    try {
        [cfg, cfgPath] = loadConfig();
    } catch (error) {
        throw new AnalogAttachError("internal", `config error: ${(error as Error).message}`);
    }

    const prompter: Prompter = (noInteractive || !isInteractive())
        ? new ScriptedPrompter([])
        : new StdinPrompter();

    return runInit(binary, noInteractive, prompter, cfg, cfgPath);
}

function handleIntelligence(cmd: CommandName, arguments_: readonly string[]): Record<string, unknown> {
    let appConfig: AppConfig;
    let cfgPath: string;
    try {
        [appConfig, cfgPath] = loadConfig();
    } catch {
        appConfig = { meta: {}, tools: [] };
        cfgPath = path.join(process.cwd(), ".analog-attach.toml");
    }

    let manifest_: ReturnType<typeof loadVerified>["manifest"] | undefined;
    const tn = appConfig.meta.default_tool;
    if (tn) {
        const t = findTool(appConfig, tn);
        if (t) {
            try {
                manifest_ = loadVerified(t, appConfig, cfgPath).manifest;
            } catch { /* no manifest available */ }
        }
    }

    const toolMapping = manifest_ ? getCommand(manifest_, cmd) : undefined;
    const mapping = toolMapping ?? { argv: [], args: undefined };

    const parsedArguments = parseCommandArguments(cmd, mapping, arguments_);

    const helpRequest = parsedArguments.flagsJson["help"] === true;
    if (!helpRequest) {
        const effSchema = effectiveSchema(cmd, mapping.args);
        const valueFlags = { ...parsedArguments.flagsJson };
        injectXPositionals(cmd, parsedArguments.positionals, valueFlags);
        validateInput(effSchema, valueFlags);
    }

    return runIntelligence(cmd, parsedArguments.positionals, parsedArguments.flagsJson, manifest_);
}

function handleCompletion(arguments_: readonly string[]): void {
    if (arguments_.length === 0) {
        process.stderr.write("Usage: analog-attach completion <bash|zsh|fish>\n");
        process.exit(2);
    }
    const shell = arguments_[0]!;
    try {
        const script = generateCompletionScript(shell);
        process.stdout.write(script);
    } catch (error) {
        process.stderr.write(`analog-attach: ${(error as Error).message}\n`);
        process.exit(2);
    }
}

function handleSchema(arguments_: readonly string[]): void {
    const name = arguments_[0];
    if (!name) {
        process.stderr.write("Usage: analog-attach schema <responses|manifest>\n");
        process.exit(2);
    }
    if (name !== "responses" && name !== "manifest") {
        process.stderr.write(`analog-attach: unknown schema '${name}' — expected 'responses' or 'manifest'\n`);
        process.exit(2);
    }
    const schema = loadSchemaFile(`${name}.schema.json`);
    // eslint-disable-next-line unicorn/no-null
    process.stdout.write(JSON.stringify(schema, null, 2));
}

function exitWithResult(cmd: CommandName, response: Record<string, unknown>, json: boolean): never {
    if (response["ok"] === false) {
        renderResponse(cmd, response, json);
        process.exit(1);
    }
    renderResponse(cmd, response, json);
    process.exit(0);
}

function exitError(error: AnalogAttachError, json: boolean): never {
    const code = error.exitCode();
    if (json) {
        const envelope = errorEnvelope(error);
        // eslint-disable-next-line unicorn/no-null
        console.log(JSON.stringify(envelope, null, 2));
    } else {
        process.stderr.write(`analog-attach: ${error.message}\n`);
    }
    process.exit(code);
}

function injectXPositionals(cmd: CommandName, positionals: readonly string[], flags: Record<string, unknown>): void {
    const base = baseSchema(cmd);
    const properties = (base as Record<string, unknown>)["properties"] as Record<string, Record<string, unknown>> | undefined;
    if (!properties) {return;}

    let posIndex = 0;
    for (const [name, property] of Object.entries(properties)) {
        if (property["x-positional"] !== true) {continue;}

        if (property["type"] === "array") {
            const values = positionals.slice(posIndex);
            flags[name] = values;
            break;
        } else {
            if (posIndex < positionals.length) {
                flags[name] = positionals[posIndex];
            }
            posIndex++;
        }
    }
}
