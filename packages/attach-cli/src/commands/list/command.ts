import { Command } from "commander";
import type { LocalContext } from "../../context";
import { respond, respond_fail, input_error } from "../../protocol/output";
import type { ListIntelligenceResponse } from "../../protocol/types";
import { list_device } from "./device";
import { list_property } from "./property";
import { list_value } from "./value";
import { list_parent } from "./placement";

export const LIST_KINDS = [
    { kind: "device", summary: "Device bindings by compatible string", args: "[compatible]" },
    { kind: "property", summary: "Properties of a node from its binding", args: "<path> [property]" },
    { kind: "value", summary: "Concrete values for a property", args: "<path> <property>" },
    { kind: "parent", summary: "Valid parent buses for a device", args: "<compatible>" },
] as const;

export function build_list_command(context: LocalContext): Command {
    const list = new Command("list")
        .description("List devices, properties, suggested values, possible parents")
        .argument("[kind]", "What to list: device, property, value, parent")
        .argument("[args...]", "Kind-specific arguments")
        .addHelpText("after", `
Kinds:
  device [compatible]          Device bindings by compatible string
  property <path> [property]   Properties of a node from its binding
  value <path> <property>      Suggested values for a property
  parent <compatible>          Valid parent buses for a device

Paths:
  Label:        spi0                       (a label in the base tree)
  Label-first:  spi0/adi,ad7124-8@0       (label then child segments)
  Absolute:     /soc/spi@7e204000          (full device tree path)

Examples:
  $ attach-linux list device                           All known bindings
  $ attach-linux list device adi                       Filter by prefix
  $ attach-linux list property spi0/adi,ad7124-8@0     Properties for a node
  $ attach-linux list value spi0/adi,ad7124-8@0 reg    Values for a property
  $ attach-linux list parent adi,ad7124-8              Valid parents`)
        .action(async (kind: string | undefined, arguments_: string[]) => {
            if (kind === undefined) {
                const response: ListIntelligenceResponse = {
                    ok: true,
                    message: `${LIST_KINDS.length} list kinds available`,
                    severity: "info",
                    intelligence: LIST_KINDS.map(k => ({
                        kind: k.kind,
                        description: k.summary,
                        args: [{ name: "args", description: k.args, required: false }],
                    })),
                };
                if (context.json) {
                    respond(response);
                } else {
                    for (const k of LIST_KINDS) {
                        console.log(`${k.kind} ${k.args}`);
                        console.log(`    ${k.summary}`);
                    }
                }
                return;
            }

            switch (kind) {
                case "device": {
                    await list_device(context, arguments_);
                    return;
                }
                case "property": {
                    await list_property(context, arguments_);
                    return;
                }
                case "value": {
                    await list_value(context, arguments_);
                    return;
                }
                case "parent": {
                    await list_parent(context, arguments_);
                    return;
                }
                default: {
                    const message = `Unknown list kind: ${kind}. Valid kinds: ${LIST_KINDS.map(k => k.kind).join(", ")}`;
                    if (context.json) {
                        respond_fail({ ok: false, message, severity: "error" });
                    } else {
                        console.log(message);
                    }
                }
            }
        });

    return list;
}
