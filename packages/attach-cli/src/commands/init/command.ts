import { Command } from "commander";
import * as fs from "node:fs";
import path from "node:path";

import type { LocalContext } from "../../context";

export function build_init_command(_context: LocalContext): Command {
    return new Command("init")
        .description("Create .analog-attach/config.toml with Linux and dt-schema paths")
        .requiredOption("--linux <value>", "Path to Linux repo")
        .requiredOption("--dt-schema <value>", "Path to dt-schema repo")
        .option("--context <value>", "Path to the target DTS file")
        .action((options) => {
            const { linux, dtSchema, context } = options;

            const directory = path.join(process.cwd(), ".analog-attach");
            const config_path = path.join(directory, "config.toml");

            if (!fs.existsSync(linux)) {
                console.log(`Missing: ${linux}`);
                return;
            }

            if (!fs.existsSync(dtSchema)) {
                console.log(`Missing: ${dtSchema}`);
                return;
            }

            if (context !== undefined && !fs.existsSync(context)) {
                console.log(`Missing: ${context}`);
                return;
            }

            fs.mkdirSync(directory, { recursive: true });

            let content = `linux = ${JSON.stringify(linux)}\ndt-schema = ${JSON.stringify(dtSchema)}\n`;
            if (context !== undefined) {
                content += `context = ${JSON.stringify(context)}\n`;
            }

            fs.writeFileSync(config_path, content);
            console.log(`Written: ${config_path}`);
        });
}
