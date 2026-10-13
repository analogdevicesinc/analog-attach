import * as fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { DeviceTree } from "attach-lib";

import type { LocalContext } from "./context";
import { load_config, check_config, check_failure_message, DEFAULT_PREPROCESS_COMMAND, type AttachConfig, type Checked, type ParsedConfig } from "./config";
import { input_error, diagnostic } from "./protocol/output";
import { substitute_command, is_tool_available } from "./utilities";

/**
 * Run the C preprocessor on a DTS file, writing the result to
 * `.attach-linux/preprocessed.dts`. Returns the preprocessed path on
 * success or `{ error }` on failure. Cheap enough to run on every
 * invocation — avoids staleness problems.
 */
export function preprocess_context(
    context_path: string,
    linux: string | undefined,
    template?: string,
): string | { error: string } {
    const command_template = template ?? DEFAULT_PREPROCESS_COMMAND;

    if (command_template.includes("{linux}") && linux === undefined) {
        return { error: "preprocess-command uses {linux} but linux is not set (export ATTACH_LINUX=<path>)" };
    }

    const tool = command_template.trim().split(/\s+/)[0] ?? "";
    if (!is_tool_available(`${tool} --version`)) {
        return { error: `${tool} not found on PATH (needed to preprocess ${context_path})` };
    }

    const directory = path.join(process.cwd(), ".attach-linux");
    fs.mkdirSync(directory, { recursive: true });
    const output = path.join(directory, "preprocessed.dts");

    try {
        execSync(
            substitute_command(command_template, {
                input: context_path,
                output,
                ...(linux === undefined ? {} : { linux }),
            }),
            { stdio: "pipe" },
        );
    } catch (error) {
        const stderr = (error as { stderr?: Buffer }).stderr?.toString() ?? String(error);
        return { error: `preprocessing ${context_path} failed:\n${stderr}` };
    }

    return output;
}

/**
 * Load the config and verify the required fields, emitting the standard
 * diagnostics (missing env var / missing field / missing path) and returning
 * undefined on any failure. On success returns the narrowed required values,
 * the full config, and the parsed representations of `devicetree` and `board`
 * (when those fields were among the required set).
 *
 * When `"devicetree"` is among the required fields the base DTS is
 * automatically preprocessed (via cpp) and the returned `values.devicetree`
 * and `parsed.devicetree` reflect the preprocessed file.
 */
export function resolve_config<K extends keyof AttachConfig>(
    context: LocalContext,
    required: readonly K[],
): { values: Checked<K>; config: AttachConfig; parsed: ParsedConfig } | undefined {
    const config = load_config() ?? {};

    const checked = check_config(config, required);
    if (!checked.ok) {
        const message = check_failure_message(checked);
        if (context.json) { input_error(message.json); }
        else { console.log(message.human); }
        return undefined;
    }

    const values = checked.values;
    const parsed = checked.parsed;

    if ((required as readonly string[]).includes("devicetree") && "devicetree" in values) {
        const preprocessed = preprocess_context(
            (values as Record<string, string>)["devicetree"]!,
            config.linux,
            config.preprocessCommand,
        );

        if (typeof preprocessed === "string") {
            const dt = DeviceTree.new_from_string(fs.readFileSync(preprocessed, "utf8"));
            if (typeof dt === "string") {
                if (context.json) { input_error(`Failed to parse preprocessed dts: ${dt}`); }
                else { console.log(`Failed to parse preprocessed dts: ${dt}`); }
                return undefined;
            }
            (values as Record<string, string>)["devicetree"] = preprocessed;
            parsed.devicetree = dt;
        } else {
            if (context.json) { diagnostic(preprocessed.error); }
            else { console.error(preprocessed.error); }
        }
    }

    return { values, config, parsed };
}
