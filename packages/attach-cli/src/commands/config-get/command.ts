/* eslint-disable unicorn/no-null */
import { Command } from "commander";

import type { LocalContext } from "../../context";
import { read_settings, SETTINGS } from "../../config/settings";
import { report_config_errors } from "../../config/workspace";
import { respond } from "../../protocol/output";
import type { Config, ToolConfigResponse } from "../../protocol/types";

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
  preprocess-command          C preprocessor command template
  deploy-ip                   Remote device IP or hostname
  deploy-user                 SSH username
  deploy-password             SSH password

Examples:
  $ attach-linux config-get
  $ attach-linux config-get overlay deploy-ip`)
        .action(async (fields: string[]) => {
            const settings = read_settings();
            if (!settings.ok) {
                report_config_errors(context, settings.errors);
                return;
            }

            const specs = fields.length > 0 ? SETTINGS.filter(s => fields.includes(s.key)) : SETTINGS;

            const rows = specs.map(spec => ({
                spec,
                config: {
                    field_name: spec.key,
                    category: spec.env === undefined ? undefined : "environment",
                    description: spec.description,
                    type: typeof spec.kind === "string" ? spec.kind : { options: [...spec.kind.options] },
                    required: spec.required,
                    default: spec.default ?? null,
                    value: settings.value[spec.field] ?? null,
                } satisfies Config,
            }));
            const result: Config[] = rows.map(row => row.config);

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
                for (const { spec, config: c } of rows) {
                    const required_tag = c.required ? " [required]" : "";
                    const environment_suffix = spec.env === undefined ? "" : ` ($${spec.env})`;
                    let display: string;
                    if (c.value === null) {
                        display = "(not set)";
                    } else if (c.value === c.default) {
                        display = `${c.value} (default)`;
                    } else {
                        display = String(c.value);
                    }
                    console.log(`${c.field_name}${required_tag}${environment_suffix}: ${display}`);
                    const options = typeof spec.kind === "string" ? "" : ` [${spec.kind.options.join(" | ")}]`;
                    console.log(`  ${spec.description}${options}`);
                    console.log("");
                    if (c.value === null && c.required && spec.hint !== undefined && !hints.includes(spec.hint)) {
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
