import { Command } from "commander";
import * as fs from "node:fs";
import path from "node:path";

import type { LocalContext } from "../../context";

function get_completions_directory(): string {
    const cli_path = fs.realpathSync(process.argv[1] ?? __filename);
    return path.resolve(path.dirname(cli_path), "..", "completions");
}

export function build_completion_command(_context: LocalContext): Command {
    return new Command("completion")
        .description("Generate shell completion script")
        .argument("<shell>", "Shell to generate completions for (bash, zsh)")
        .action((shell: string) => {
            const files: Record<string, string> = {
                zsh: "zsh.zsh",
            };

            const filename = files[shell];
            if (filename === undefined) {
                console.error(`Unknown shell: ${shell}. Supported: ${Object.keys(files).join(", ")}`);
                return;
            }

            const script_path = path.join(get_completions_directory(), filename);
            if (!fs.existsSync(script_path)) {
                console.error(`Completion script not found: ${script_path}`);
                return;
            }

            console.log(fs.readFileSync(script_path, "utf8"));
        });
}
