import { Command } from "commander";
import * as fs from "node:fs";
import { stringify } from "smol-toml";

import type { LocalContext } from "../../context";
import { parse_settings, read_settings, save_settings, setting_spec, TOML_SETTINGS } from "../../config/settings";
import { format_config_errors } from "../../config/workspace";
import { respond, respond_fail } from "../../protocol/output";

export function build_config_set_command(context: LocalContext): Command {
    return new Command("config-set")
        .description("Set a configuration field")
        .argument("<field>", "Config field name")
        .argument("<value>", "Value to set")
        .addHelpText("after", `
Settable fields:
  overlay, overlay-syntax, preprocess-command,
  deploy-ip, deploy-user, deploy-password

  linux and devicetree are set via environment variables:
    export ATTACH_LINUX=/path/to/linux
    export ATTACH_DEVICETREE=/path/to/base.dts

Examples:
  $ attach-linux config-set overlay overlay.dtso
  $ attach-linux config-set overlay-syntax label
  $ attach-linux config-set deploy-ip 192.168.1.10`)
        .action(async (field: string, value: string) => {
            const fail = (message: string): void => {
                if (context.json) {
                    respond_fail({ ok: false, message, severity: "error" });
                } else {
                    console.log(message);
                }
            };

            const spec = setting_spec(field);
            if (spec?.env !== undefined) {
                fail(`${field} is read from the environment, not config.toml: export ${spec.env}=${JSON.stringify(value)}`);
                return;
            }
            if (spec === undefined) {
                fail(`Unknown config field: ${field}. Valid fields: ${TOML_SETTINGS.map(s => s.key).join(", ")}`);
                return;
            }

            // The rest of the file may be invalid (config-set is how it gets fixed), but it must be TOML.
            const current = read_settings();
            const syntax_error = current.ok ? undefined : current.errors.find(error => error.field === "config.toml");
            if (syntax_error !== undefined) {
                fail(syntax_error.message);
                return;
            }

            // Parse the value exactly as loading config.toml would.
            const parsed = parse_settings(stringify({ [field]: value }), {});
            if (!parsed.ok) {
                fail(format_config_errors(parsed.errors).human);
                return;
            }
            const parsed_value = parsed.value[spec.field] ?? value;
            if (spec.kind === "path" && !fs.existsSync(parsed_value)) {
                fail(`${field}: ${parsed_value} does not exist`);
                return;
            }

            save_settings({ [field]: parsed_value });

            if (context.json) {
                respond({ ok: true, message: `Set ${field} = ${value}`, severity: "info" });
            } else {
                console.log(`Set ${field} = ${value}`);
            }
        });
}
