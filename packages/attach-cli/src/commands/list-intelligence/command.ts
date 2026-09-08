import { buildCommand } from "@stricli/core";

import type { LocalContext } from "../../context";
import { respond } from "../../protocol/output";
import type { ListIntelligenceResponse } from "../../protocol/types";

export const list_intelligence_command = buildCommand({
    parameters: {},
    docs: {
        brief: "List available suggestion kinds for tab-completion and smart suggestions",
    },
    async func(this: LocalContext) {
        const response: ListIntelligenceResponse = {
            ok: true,
            message: "2 intelligence kinds available",
            severity: "info",
            intelligence: [
                {
                    kind: "parent",
                    args: [
                        {
                            name: "compatible",
                            description: "Compatible string of the device",
                            required: true,
                        },
                    ],
                },
                {
                    kind: "device-key",
                    args: [
                        {
                            name: "filter",
                            description: "Word to filter device names by",
                            required: false,
                        },
                    ],
                },
            ],
        };

        if (this.json) {
            respond(response);
        } else {
            for (const index of response.intelligence) {
                const arguments_desc = index.args.map(a => `${a.name}${a.required ? "" : "?"}`).join(", ");
                console.log(`${index.kind}(${arguments_desc})`);
            }
        }
    },
});
