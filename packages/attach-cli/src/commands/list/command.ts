import { Command } from "commander";
import type { LocalContext } from "../../context";
import { respond, respond_fail, input_error } from "../../protocol/output";
import type { ListIntelligenceResponse } from "../../protocol/types";
import { list_device } from "./device";
import { list_property } from "./property";
import { list_value } from "./value";
import { list_parent, list_slot } from "./placement";

export const LIST_KINDS = [
    { kind: "device", summary: "Device bindings by compatible string", args: "[compatible]" },
    { kind: "property", summary: "Properties of a node from its binding", args: "<path> [property]" },
    { kind: "value", summary: "Concrete values for a property", args: "<path> <property>" },
    { kind: "parent", summary: "Valid parent buses for a device", args: "<compatible>" },
    { kind: "slot", summary: "Board slots (requires board config)", args: "[compatible]" },
] as const;

export function build_list_command(context: LocalContext): Command {
    const list = new Command("list")
        .description("List device bindings, properties, values, parents or slots")
        .argument("[kind]", "What to list: device, property, value, parent, slot")
        .argument("[args...]", "Kind-specific arguments")
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
                case "slot": {
                    await list_slot(context, arguments_);
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
