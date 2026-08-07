import { buildCommand } from "@stricli/core";
import { COMMANDS, PROTOCOL_VERSION, TOOL_DESCRIPTION, TOOL_NAME, TOOL_VERSION } from "../protocol";
import { output } from "./shared";

export const discoveryCommand = buildCommand<{ json?: boolean }, []>({
    docs: { brief: "Report the commands this tool supports (attach-meta protocol)" },
    parameters: {
        positional: { kind: "tuple", parameters: [] },
        flags: {
            json: { kind: "boolean", brief: "Output as JSON", optional: true }
        }
    },
    func: async (flags) => {
        const response = {
            protocol_version: PROTOCOL_VERSION,
            tool_name: TOOL_NAME,
            tool_version: TOOL_VERSION,
            description: TOOL_DESCRIPTION,
            commands: COMMANDS,
        };

        output(flags, format_discovery(), response);
    }
});

function format_discovery(): string {
    let out = `${TOOL_NAME} ${TOOL_VERSION}  (protocol ${PROTOCOL_VERSION})\n`;
    out += `${TOOL_DESCRIPTION}\n\n`;

    out += `  ${"Key".padEnd(18)}${"Runs".padEnd(22)}Description\n`;
    out += `  ${"─".repeat(74)}\n`;

    for (const [key, entry] of Object.entries(COMMANDS)) {
        const runs = entry.supported ? `aa ${entry.argv.join(" ")}` : "-";
        const marker = entry.supported ? "  " : "! ";
        out += `${marker}${key.padEnd(18)}${runs.padEnd(22)}${entry.description}\n`;
    }

    out += "\n! = not supported by this engine";
    return out;
}
