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
        .description("Show configuration fields and values")
        .argument("[fields...]", "Config field names to retrieve (omit for all)")
        .addHelpText("after", `
Fields:
  linux ($ATTACH_LINUX)       Kernel source tree          [required, env]
  devicetree ($ATTACH_DEVICETREE)  Target base DTS file   [required, env]
  overlay                     Working DTSO overlay file
  overlay-syntax              Output syntax: fragment (default) or label
  overlay-compiled            Compiled DTBO artifact path
  preprocess-command          C preprocessor command template
  deploy-ip                   Remote device IP or hostname
  deploy-user                 SSH username
  deploy-password             SSH password

Examples:
  $ attach-linux config-get
  $ attach-linux config-get overlay deploy-ip`)
        .action(async (fields: string[]) => {
            const current = load_config() ?? {};

            let specs = VISIBLE_SPECS;
            if (fields.length > 0) {
                specs = specs.filter(s => fields.includes(s.toml));
            }

            const result: Config[] = specs.map(spec => {
                const key = FIELD_TO_CONFIG_KEY[spec.toml];
                const value = key === undefined ? undefined : current[key];
                const category = spec.env === undefined ? undefined : "environment";
                return {
                    field_name: spec.toml,
                    category,
                    description: spec.description,
                    type: spec.options === undefined ? spec.type : { options: [...spec.options] },
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
                const hints: string[] = [];
                for (const c of result) {
                    const spec = VISIBLE_SPECS.find(s => s.toml === c.field_name);
                    const required_tag = c.required ? " [required]" : "";
                    const environment_suffix = spec?.env === undefined ? "" : ` ($${spec.env})`;
                    let display: string;
                    if (c.value === null && c.default === null) {
                        display = "(not set)";
                    } else if (c.value === null) {
                        display = `(not set, default: ${c.default})`;
                    } else {
                        display = String(c.value);
                    }
                    console.log(`${c.field_name}${required_tag}${environment_suffix}: ${display}`);
                    let desc = spec?.description ?? "";
                    if (spec?.options !== undefined && spec.options.length > 0) {
                        desc += ` [${spec.options.join(" | ")}]`;
                    }
                    if (desc !== "") {
                        console.log(`  ${desc}`);
                    }
                    console.log("");
                    if (c.value === null && c.required && spec?.hint !== undefined && !hints.includes(spec.hint)) {
                        hints.push(spec.hint);
                    }
                }
                if (hints.length > 0) {
                    console.log("");
                    for (const hint of hints) {
                        console.log(hint);
                    }
                }
            }
        });
}
