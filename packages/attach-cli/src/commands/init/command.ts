import { buildCommand } from "@stricli/core";
import * as fs from "node:fs";
import * as path from "node:path";

type Flags = {
    linux: string;
    dtSchema: string;
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
        },
    },
    docs: {
        brief: "Create .analog-attach/config.toml with Linux and dt-schema paths",
    },
    async func(flags: Flags) {
        const { linux, dtSchema } = flags;

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

        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(config_path, `linux = ${JSON.stringify(linux)}\ndt-schema = ${JSON.stringify(dtSchema)}\n`);
        console.log(`Written: ${config_path}`);
    },
});
