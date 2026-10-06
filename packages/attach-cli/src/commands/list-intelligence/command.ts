import { Command } from "commander";

import type { LocalContext } from "../../context";
import { respond } from "../../protocol/output";
import type { ListIntelligenceResponse } from "../../protocol/types";

/**
 * Every `suggest` kind with its arguments: the output of `list-intelligence`,
 * and the source of the `suggest <kind>` completion.
 */
export const INTELLIGENCE_KINDS: ListIntelligenceResponse["intelligence"] = [
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
        description: "Lists every property a node's binding declares, each labelled `set` (already present on the node) and/or `required`. Works for nodes with their own `compatible` and for pattern-matched child nodes (e.g. channel@0) whose schema is defined by the parent binding's patternProperties. Use to discover which properties can or must be configured on a device node before setting them.",
        args: [
            {
                name: "node",
                description: "Node reference (one or more segments, spaces act as path separators): bare label (imu1), absolute path (/soc/spi@7e204000/imu@0), label/child (spi0/imu@0 or spi0 imu@0), multi-segment path (soc spi@7e204000 imu@0)",
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
                description: "Node reference to list children and properties of; omit to list top-level overlay entry points. One or more segments, spaces act as path separators: bare label (imu1), absolute path (/soc/spi@7e204000/imu@0), label/child (spi0/imu@0 or spi0 imu@0), multi-segment path (soc spi@7e204000 imu@0)",
                required: false,
                kind: "node-ref",
            },
        ],
    },
    {
        kind: "children",
        description: "Lists the child nodes of a node, from the base devicetree and the overlay merged (navigate only sees the overlay). Use to build a node path segment by segment, e.g. for `add --to` / `move --to`.",
        args: [
            {
                name: "node",
                description: "Node reference (one or more segments, spaces act as path separators): bare label (spi0), absolute path (/soc/spi@7e204000), label/child (spi0/adc@0 or spi0 adc@0)",
                required: true,
                kind: "node-ref",
            },
        ],
    },
    {
        kind: "type",
        description: "Reports the expected value type of a single property (number, string, bool, enum with its options, or array/tuple of those) resolved from the node's binding. Works for nodes with their own `compatible` and for pattern-matched child nodes whose schema comes from the parent binding's patternProperties. Use before calling set-prop to learn the exact value format a property accepts. The response includes an optional `description` field — read it when present, as it explains the property's purpose and valid values and helps you configure it correctly.",
        args: [
            {
                name: "prop",
                description: "Property reference (one or more segments, spaces act as path separators): bare label (imu1/reg), absolute path (/soc/spi@7e204000/imu@0/reg), label/child (spi0/imu@0/reg or spi0 imu@0 reg), multi-segment path (soc spi@7e204000 imu@0 reg)",
                required: true,
                kind: "prop-ref",
            },
        ],
    },
    {
        kind: "value",
        description: "Suggests concrete, ready-to-paste `update --with` values for one property, drawn from the configured context layers — today the add-on board description (`config-get board`), e.g. the chip selects for `reg`, the board's interrupt line for `interrupts`, its reset line for `reset-gpios`, or the full `cs-gpios` list on the bus node itself. The slot is inferred from the node's parent bus and `reg`; set `reg` first to narrow it. Call before `update --with` when a board is configured. If the message says `ambiguous`, ask the user which slot the device is plugged into instead of guessing, and pick the suggestions labelled with that slot. Empty with an info message when no board is configured. Interrupt trigger types and reset polarity come from the peripheral, so choose among the offered macros from the device's datasheet/binding.",
        args: [
            {
                name: "prop",
                description: "Property reference (one or more segments, spaces act as path separators): bare label (imu1/reg), absolute path (/soc/spi@7e204000/imu@0/reg), label/child (spi0/imu@0/reg or spi0 imu@0 reg), multi-segment path (soc spi@7e204000 imu@0 reg)",
                required: true,
                kind: "prop-ref",
            },
        ],
    },
    {
        kind: "board-slot",
        description: "Lists the slots (ports/connectors) of the configured add-on board (`config-get board`), each with its bus, chip select and wired signals. With a compatible string, only the slots whose bus can host that device. Use before `add` when a board is configured: present the slots to the user, ask which one the device is plugged into, then `add --to <bus>` and set `reg` to that slot's chip select. Fails with a missing-config error when no board is configured.",
        args: [
            {
                name: "compatible",
                description: "Compatible string of the device, to keep only slots it can attach to",
                required: false,
            },
        ],
    },
];

export function build_list_intelligence_command(context: LocalContext): Command {
    return new Command("list-intelligence")
        .description("List available suggestion kinds for tab-completion and smart suggestions")
        .action(async () => {
            const response: ListIntelligenceResponse = {
                ok: true,
                message: `${INTELLIGENCE_KINDS.length} intelligence kinds available`,
                severity: "info",
                intelligence: INTELLIGENCE_KINDS,
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
