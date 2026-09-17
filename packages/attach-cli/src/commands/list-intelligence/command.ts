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
                message: "5 intelligence kinds available",
                severity: "info",
                intelligence: [
                    {
                        kind: "parent",
                        description: "Suggests base-tree nodes a device with the given compatible string can legally attach under (e.g. the SPI/I2C bus or controller matching the binding's bus type). Use when deciding where to place a new device before adding it, or to answer \"which node should this device hang off of?\".",
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
                        description: "Lists known compatible strings from the binding compatibility index, optionally narrowed by a substring filter. Use to discover or confirm the exact compatible string for a device before adding it or asking for its parents. Only relevant for device nodes that carry a `compatible` property. Bare structural subnodes — channels, aliases, bus sub-nodes — have no compatible string and must be added with `add --name <node-name> --to <parent>` only; do not fetch a device-key for them.",
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
                        description: "Lists every property a node's binding declares, each labelled `set` (already present on the node) and/or `required`. The node must have a `compatible` value with a resolvable binding. Use to discover which properties can or must be configured on a device node before setting them.",
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
                        kind: "navigate",
                        description: "Explores the overlay's structure: lists a node's child nodes and its properties so you can drill deeper. With no node it lists the overlay's top-level fragment targets (entry points). Unlike node-prop it works without a binding and shows children, so use it to walk the tree; use node-prop when you specifically want the full set of binding-declared (including unset) properties.",
                        args: [
                            {
                                name: "node",
                                description: "Node reference to list children and properties of; omit to list top-level overlay entry points. One or more segments, spaces act as path separators: bare label (imu1), &label (&imu1), absolute path (/soc/spi@7e204000/imu@0), &{path} (&{/soc/spi@7e204000/imu@0}), label/child (spi0/imu@0 or spi0 imu@0), multi-segment path (soc spi@7e204000 imu@0)",
                                required: false,
                                kind: "node-ref",
                            },
                        ],
                    },
                    {
                        kind: "type",
                        description: "Reports the expected value type of a single property (number, string, bool, enum with its options, or array/tuple of those) resolved from the node's binding. Use before calling set-prop to learn the exact value format a property accepts.",
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
                    console.log(`    ${index.description}`);
                }
            }
        });
}
