import { buildCommand } from "@stricli/core";
import { Attach, extract_compatible } from "attach-lib";

import path from "node:path";
import * as fs from 'node:fs';

import { get_all_file_paths } from "../../utilities";

type Flags = {
    linux: string,
    dtSchema: string,
    includesWord?: string,
}

export const list_devices_command = buildCommand({
    parameters: {
        flags: {
            linux: {
                kind: "parsed",
                parse: String,
                brief: "Path to Linux repo"
            },
            dtSchema: {
                kind: "parsed",
                parse: String,
                brief: "Path to dt-schema repo"
            },
            includesWord: {
                kind: "parsed",
                parse: String,
                brief: "word to be present in device name",
                optional: true
            }
        }
    },
    docs: {
        brief: "List available devices in linux repo"
    },
    async func(flags: Flags) {
        const { linux, dtSchema, includesWord } = flags;

        if (!fs.existsSync(linux)) {
            console.log(`Missing: ${linux}`);
            return;
        }

        if (!fs.existsSync(dtSchema)) {
            console.log(`Missing: ${dtSchema}`);
            return;
        }

        const bindings_folder = path.resolve(linux, "Documentation", "devicetree", "bindings");

        if (!fs.existsSync(bindings_folder)) {
            console.log(`Missing: ${bindings_folder}`);
            return;
        }

        const all_files = get_all_file_paths(bindings_folder);
        const yaml_files = all_files.filter(file => file.endsWith(".yaml"));

        for (const file of yaml_files) {

            const attach = Attach.new();
            const binding = await attach.parse_binding(file, linux, dtSchema);

            if (binding === undefined) {
                continue;
            }

            const compatible = extract_compatible(binding.parsed_binding);

            if (compatible === undefined) {
                continue;
            }

            for (const entry of compatible) {
                // TODO fix why entry could be undefined
                // arm/actions.yaml
                if (entry !== undefined) {
                    if (includesWord !== undefined && entry.includes(includesWord)) {
                        console.log(`${entry}`);
                    } else if (includesWord === undefined) {
                        console.log(`${entry}`);
                    }
                }
            }
        }

    }
});

