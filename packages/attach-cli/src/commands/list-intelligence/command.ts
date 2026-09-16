import { Command } from "commander";

import type { LocalContext } from "../../context";
import { respond } from "../../protocol/output";
import type { ListIntelligenceResponse } from "../../protocol/types";

export function build_list_intelligence_command(context: LocalContext): Command {
    return new Command("list-intelligence")
        .description("List available suggestion kinds for tab-completion and smart suggestions")
        .action(async () => {
            const response: ListIntelligenceResponse = {
                ok: true,
                message: "4 intelligence kinds available",
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
                    {
                        kind: "node-prop",
                        args: [
                            {
                                name: "node",
                                description: "Node reference (one or more segments, spaces act as path separators): bare label (imu1), &label (&imu1), absolute path (/soc/spi@7e204000/imu@0), &{path} (&{/soc/spi@7e204000/imu@0}), label/child (spi0/imu@0 or spi0 imu@0), multi-segment path (soc spi@7e204000 imu@0)",
                                required: true,
                                kind: "node-ref",
                            },
                        ],
                    },
                    {
                        kind: "type",
                        args: [
                            {
                                name: "prop",
                                description: "Property reference (one or more segments, spaces act as path separators): bare label (imu1/reg), &label (&imu1/reg), absolute path (/soc/spi@7e204000/imu@0/reg), &{path} (&{/soc/spi@7e204000/imu@0/reg}), label/child (spi0/imu@0/reg or spi0 imu@0 reg), multi-segment path (soc spi@7e204000 imu@0 reg)",
                                required: true,
                                kind: "prop-ref",
                            },
                        ],
                    },
                ],
            };

            if (context.json) {
                respond(response);
            } else {
                for (const index of response.intelligence) {
                    const arguments_desc = index.args.map(a => `${a.name}${a.required ? "" : "?"}`).join(", ");
                    console.log(`${index.kind}(${arguments_desc})`);
                }
            }
        });
}
