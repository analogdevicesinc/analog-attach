/* eslint-disable unicorn/no-null */
import { Command } from "commander";

import type { LocalContext } from "../../context";
import { load_config } from "../../config";
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
];

const FIELD_TO_CONFIG_KEY: Record<string, keyof ReturnType<typeof load_config>> = {
    "linux": "linux",
    "dt-schema": "dtSchema",
    "context": "context",
    "overlay": "overlay",
};

export function build_config_get_command(ctx: LocalContext): Command {
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

            if (ctx.json) {
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
