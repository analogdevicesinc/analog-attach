import { buildCommand } from "@stricli/core";
import * as fs from "node:fs";
import * as path from "node:path";

type Flags = {
    linux: string;
    dtSchema: string;
    context?: string;
};

export const init_command = buildCommand({
    parameters: {
        flags: {
            linux: {
                kind: "parsed",
                parse: String,
                brief: "Path to Linux repo",
            },
            dtSchema: {
                kind: "parsed",
                parse: String,
                brief: "Path to dt-schema repo",
            },
            context: {
                kind: "parsed",
                parse: String,
                brief: "Path to the target DTS file",
                optional: true,
            },
        },
    },
    docs: {
        brief: "Create .analog-attach/config.toml with Linux and dt-schema paths",
    },
    async func(flags: Flags) {
        const { linux, dtSchema, context } = flags;

        const dir = path.join(process.cwd(), ".analog-attach");
        const config_path = path.join(dir, "config.toml");

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

        fs.mkdirSync(dir, { recursive: true });

        let content = `linux = ${JSON.stringify(linux)}\ndt-schema = ${JSON.stringify(dtSchema)}\n`;
        if (context !== undefined) {
            content += `context = ${JSON.stringify(context)}\n`;
        }

        fs.writeFileSync(config_path, content);
        console.log(`Written: ${config_path}`);
    },
});
