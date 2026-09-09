import { Command } from "commander";

import type { LocalContext } from "../../context";
import { save_config, type AttachConfig } from "../../config";
import { respond, respond_fail } from "../../protocol/output";

const VALID_FIELDS: Record<string, keyof AttachConfig> = {
    "linux": "linux",
    "dt-schema": "dtSchema",
    "context": "context",
    "overlay": "overlay",
};

export function build_config_set_command(ctx: LocalContext): Command {
    return new Command("config-set")
        .description("Set a tool configuration field")
        .argument("<field>", "Config field name")
        .argument("<value>", "Value to set")
        .action(async (field: string, value: string) => {
            const config_key = VALID_FIELDS[field];

            if (config_key === undefined) {
                const valid = Object.keys(VALID_FIELDS).join(", ");
                if (ctx.json) {
                    respond_fail({ ok: false, message: `Unknown config field: ${field}. Valid fields: ${valid}`, severity: "error" });
                } else {
                    console.log(`Unknown config field: ${field}. Valid fields: ${valid}`);
                }
                return;
            }

            save_config({ [config_key]: value });

            if (ctx.json) {
                respond({ ok: true, message: `Set ${field} = ${value}`, severity: "info" });
            } else {
                console.log(`Set ${field} = ${value}`);
            }
        });
}
