import { Command } from "commander";
import * as fs from "node:fs";
import { stringify } from "smol-toml";

import type { LocalContext } from "../../context";
import { reload_caches } from "../../config/rebuild";
import { parse_settings, read_settings, save_settings, setting_spec, SETTINGS } from "../../config/settings";
import { format_config_errors, linux_tree_problem } from "../../config/workspace";
import { respond, respond_fail } from "../../protocol/output";

export function build_config_set_command(context: LocalContext): Command {
    return new Command("config-set")
        .description("Set a configuration field")
        .argument("<field>", "Config field name")
        .argument("<value>", "Value to set")
        .addHelpText("after", `
Settable fields:
  linux, devicetree, overlay, overlay-syntax, preprocess-command,
  deploy-ip, deploy-user, deploy-password

Setting linux also builds the compat index and validation.json from its
bindings (about 40 s for the kernel tree); 'config-get --reload' rebuilds
them later.

Examples:
  $ attach-linux config-set linux /path/to/linux
  $ attach-linux config-set devicetree /path/to/base.dts
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
            if (spec === undefined) {
                fail(`Unknown config field: ${field}. Valid fields: ${SETTINGS.map(s => s.key).join(", ")}`);
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
            const parsed = parse_settings(stringify({ [field]: value }));
            if (!parsed.ok) {
                fail(format_config_errors(parsed.errors).human);
                return;
            }
            const parsed_value = parsed.value[spec.field] ?? value;
            if (spec.kind === "path" && !fs.existsSync(parsed_value)) {
                fail(`${field}: ${parsed_value} does not exist`);
                return;
            }

            const problem = field === "linux" ? linux_tree_problem(parsed_value) : undefined;
            if (problem !== undefined) {
                fail(`${field}: ${problem}`);
                return;
            }

            save_settings({ [field]: parsed_value });
            let message = `Set ${field} = ${value}`;

            if (field === "linux") {
                const settings = read_settings();
                const reloaded = settings.ok ? await reload_caches(settings.value) : settings;
                if (!reloaded.ok) {
                    fail(`${message}, but the binding caches were not built:\n${format_config_errors(reloaded.errors).human}`);
                    return;
                }
                if (!reloaded.value.ok) {
                    fail(`${message}, but ${reloaded.value.message}\nFix the bindings and run 'attach-linux config-get --reload'.`);
                    return;
                }
                message += `; ${reloaded.value.message}`;
            }

            if (context.json) {
                respond({ ok: true, message, severity: "info" });
            } else {
                console.log(message);
            }
        });
}
