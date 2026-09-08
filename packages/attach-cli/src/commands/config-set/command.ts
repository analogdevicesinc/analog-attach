import { buildCommand } from "@stricli/core";

import type { LocalContext } from "../../context";
import { save_config, type AttachConfig } from "../../config";
import { respond, respond_fail, input_error } from "../../protocol/output";

const VALID_FIELDS: Record<string, keyof AttachConfig> = {
    "linux": "linux",
    "dt-schema": "dtSchema",
    "context": "context",
    "overlay": "overlay",
};

export const config_set_command = buildCommand({
    parameters: {
        positional: {
            kind: "tuple" as const,
            parameters: [
                {
                    parse: String,
                    brief: "Config field name",
                },
                {
                    parse: String,
                    brief: "Value to set",
                },
            ],
        },
    },
    docs: {
        brief: "Set a tool configuration field",
    },
    async func(this: LocalContext, _flags: {}, field: string, value: string) {
        const config_key = VALID_FIELDS[field];

        if (config_key === undefined) {
            const valid = Object.keys(VALID_FIELDS).join(", ");
            if (this.json) {
                respond_fail({ ok: false, message: `Unknown config field: ${field}. Valid fields: ${valid}`, severity: "error" });
            } else {
                console.log(`Unknown config field: ${field}. Valid fields: ${valid}`);
            }
            return;
        }

        save_config({ [config_key]: value });

        if (this.json) {
            respond({ ok: true, message: `Set ${field} = ${value}`, severity: "info" });
        } else {
            console.log(`Set ${field} = ${value}`);
        }
    },
});
