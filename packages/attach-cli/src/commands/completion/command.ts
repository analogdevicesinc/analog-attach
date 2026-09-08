import { buildCommand } from "@stricli/core";
import * as fs from "node:fs";
import * as path from "node:path";

import type { LocalContext } from "../../context";

function get_completions_dir(): string {
    const cli_path = fs.realpathSync(process.argv[1] ?? __filename);
    return path.resolve(path.dirname(cli_path), "..", "completions");
}

type Flags = {
    shell: string;
}

export const completion_command = buildCommand({
    parameters: {
        positional: {
            kind: "tuple" as const,
            parameters: [
                {
                    parse: String,
                    brief: "Shell to generate completions for (bash, zsh)",
                    placeholder: "shell",
                },
            ],
        },
    },
    docs: {
        brief: "Generate shell completion script",
    },
    func(this: LocalContext, _flags: Flags, shell: string) {
        const files: Record<string, string> = {
            zsh: "zsh.zsh",
        };

        const filename = files[shell];
        if (filename === undefined) {
            console.error(`Unknown shell: ${shell}. Supported: ${Object.keys(files).join(", ")}`);
            return;
        }

        const script_path = path.join(get_completions_dir(), filename);
        if (!fs.existsSync(script_path)) {
            console.error(`Completion script not found: ${script_path}`);
            return;
        }

        console.log(fs.readFileSync(script_path, "utf8"));
    },
});
