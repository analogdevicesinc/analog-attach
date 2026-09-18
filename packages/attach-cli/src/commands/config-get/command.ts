/* eslint-disable unicorn/no-null */
import { Command } from "commander";

import type { LocalContext } from "../../context";
import { load_config, DEFAULT_BUILD_COMMAND } from "../../config";
import { respond } from "../../protocol/output";
import type { Config, ToolConfigResponse } from "../../protocol/types";

const CONFIG_FIELDS: Config[] = [
    {
        field_name: "linux",
        description: "Path to Linux kernel source tree",
        type: "path",
        required: true,
        default: null,
        value: null,
    },
    {
        field_name: "dt-schema",
        description: "Path to dt-schema repository",
        type: "path",
        required: true,
        default: null,
        value: null,
    },
    {
        field_name: "context",
        description: "Path to target base DTS file",
        type: "path",
        required: true,
        default: null,
        value: null,
    },
    {
        field_name: "overlay",
        description: "Path to the working DTSO overlay file (workfile)",
        type: "path",
        required: false,
        default: null,
        value: null,
    },
    {
        field_name: "build-command",
        description: "dtc command used to compile the overlay; {input}/{output} are substituted with the .dtso and .dtbo paths",
        type: "string",
        required: false,
        default: DEFAULT_BUILD_COMMAND,
        value: null,
    },
    {
        field_name: "overlay-compiled",
        description: "Path to the compiled DTBO artifact (written by the build command, read by deploy)",
        type: "path",
        required: false,
        default: null,
        value: null,
    },
    {
        field_name: "deploy-ip",
        description: "IP address or hostname of the remote device to deploy to",
        type: "string",
        required: false,
        default: null,
        value: null,
    },
    {
        field_name: "deploy-user",
        description: "SSH username on the remote device",
        type: "string",
        required: false,
        default: null,
        value: null,
    },
    {
        field_name: "deploy-password",
        description: "SSH password on the remote device (stored plaintext in config.toml)",
        type: "string",
        required: false,
        default: null,
        value: null,
    },
];

const FIELD_TO_CONFIG_KEY: Record<string, keyof ReturnType<typeof load_config>> = {
    "linux": "linux",
    "dt-schema": "dtSchema",
    "context": "context",
    "overlay": "overlay",
    "build-command": "buildCommand",
    "overlay-compiled": "overlayCompiled",
    "deploy-ip": "deployIp",
    "deploy-user": "deployUser",
    "deploy-password": "deployPassword",
};

export function build_config_get_command(context: LocalContext): Command {
    return new Command("config-get")
        .description("Get tool configuration fields")
        .argument("[fields...]", "Config field names to retrieve (omit for all)")
        .action(async (fields: string[]) => {
            const current = load_config();

            let configs = CONFIG_FIELDS;
            if (fields.length > 0) {
                configs = configs.filter(c => fields.includes(c.field_name));
            }

            const result: Config[] = configs.map(c => {
                const key = FIELD_TO_CONFIG_KEY[c.field_name];
                const value = key === undefined ? undefined : current[key];
                return { ...c, value: value ?? null };
            });

            const response: ToolConfigResponse = {
                ok: true,
                message: `${result.length} config field(s)`,
                severity: "info",
                configs: result,
            };

            if (context.json) {
                respond(response);
            } else {
                for (const c of result) {
                    const display = c.value === null ? "(not set)" : c.value;
                    const request = c.required ? " [required]" : "";
                    console.log(`${c.field_name}${request}: ${display}`);
                }
            }
        });
}
