/* eslint-disable unicorn/no-null */
import { Command } from "commander";

import type { LocalContext } from "../../context";
import { load_config, CONFIG_REGISTRY, type AttachConfig } from "../../config";
import { respond } from "../../protocol/output";
import type { Config, ToolConfigResponse } from "../../protocol/types";

const VISIBLE_SPECS = CONFIG_REGISTRY.filter((spec) => !spec.internal);

const FIELD_TO_CONFIG_KEY: Record<string, keyof AttachConfig> = Object.fromEntries(
    VISIBLE_SPECS.map((spec) => [spec.toml, spec.key]),
);

export function build_config_get_command(context: LocalContext): Command {
    return new Command("config-get")
        .description("Get tool configuration fields")
        .argument("[fields...]", "Config field names to retrieve (omit for all)")
        .action(async (fields: string[]) => {
            const current = load_config() ?? {};

            let specs = VISIBLE_SPECS;
            if (fields.length > 0) {
                specs = specs.filter(s => fields.includes(s.toml));
            }

            const result: Config[] = specs.map(spec => {
                const key = FIELD_TO_CONFIG_KEY[spec.toml];
                const value = key !== undefined ? current[key] : undefined;
                const category = spec.env === undefined ? undefined : "environment";
                return {
                    field_name: spec.toml,
                    category,
                    description: spec.description,
                    type: spec.options !== undefined ? { options: [...spec.options] } : spec.type,
                    required: spec.required,
                    default: spec.default ?? null,
                    value: value ?? null,
                };
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
                    const spec = VISIBLE_SPECS.find(s => s.toml === c.field_name);
                    const env_suffix = spec?.env !== undefined ? ` ($${spec.env})` : "";
                    console.log(`${c.field_name}${request}${env_suffix}: ${display}`);
                }
            }
        });
}
