/* eslint-disable unicorn/no-null */
import { Command } from "commander";

import type { LocalContext } from "../../context";
import { load_config, CONFIG_REGISTRY, type AttachConfig } from "../../config";
import { respond } from "../../protocol/output";
import type { Config, ToolConfigResponse } from "../../protocol/types";

const SETTABLE_SPECS = CONFIG_REGISTRY.filter((spec) => !spec.internal);

const CONFIG_FIELDS: Config[] = SETTABLE_SPECS.map((spec) => ({
    field_name: spec.toml,
    description: spec.description,
    type: spec.type,
    required: spec.required,
    default: spec.default ?? null,
    value: null,
}));

const FIELD_TO_CONFIG_KEY: Record<string, keyof AttachConfig> = Object.fromEntries(
    SETTABLE_SPECS.map((spec) => [spec.toml, spec.key]),
);

export function build_config_get_command(context: LocalContext): Command {
    return new Command("config-get")
        .description("Get tool configuration fields")
        .argument("[fields...]", "Config field names to retrieve (omit for all)")
        .action(async (fields: string[]) => {
            const current = load_config() ?? {};

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
