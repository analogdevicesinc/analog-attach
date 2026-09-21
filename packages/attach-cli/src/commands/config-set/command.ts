import { Command } from "commander";

import type { LocalContext } from "../../context";
import { save_config, CONFIG_REGISTRY, type FieldSpec } from "../../config";
import { respond, respond_fail } from "../../protocol/output";

const SETTABLE_FIELDS: Map<string, FieldSpec> = new Map(
    CONFIG_REGISTRY.filter((spec) => !spec.internal).map((spec) => [spec.toml, spec]),
);

export function build_config_set_command(context: LocalContext): Command {
    return new Command("config-set")
        .description("Set a tool configuration field")
        .argument("<field>", "Config field name")
        .argument("<value>", "Value to set")
        .action(async (field: string, value: string) => {
            const spec = SETTABLE_FIELDS.get(field);

            if (spec === undefined) {
                const valid = [...SETTABLE_FIELDS.keys()].join(", ");
                if (context.json) {
                    respond_fail({ ok: false, message: `Unknown config field: ${field}. Valid fields: ${valid}`, severity: "error" });
                } else {
                    console.log(`Unknown config field: ${field}. Valid fields: ${valid}`);
                }
                return;
            }

            const validation_error = spec.validate?.(value);
            if (validation_error !== undefined) {
                const message = `Invalid ${field}: ${validation_error}`;
                if (context.json) {
                    respond_fail({ ok: false, message, severity: "error" });
                } else {
                    console.log(message);
                }
                return;
            }

            save_config({ [spec.key]: value });

            if (context.json) {
                respond({ ok: true, message: `Set ${field} = ${value}`, severity: "info" });
            } else {
                console.log(`Set ${field} = ${value}`);
            }
        });
}
