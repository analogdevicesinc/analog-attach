import { buildCommand } from "@stricli/core";
import { Attach, extract_compatible } from "attach-lib";

import * as fs from 'node:fs';
import path from "node:path";

type Flags = {
    linux: string,
    dtSchema: string,
    includesWord: string,
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
                brief: "word to be present in device name"
            }
        }
    },
    docs: {
        brief: "List available devices in linux repo"
    },
    async func(flags: Flags) {
        const { linux, dtSchema, includesWord } = flags;

        const bindings_folder = path.resolve(linux, "Documentation", "devicetree", "bindings");

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
                if (entry !== undefined && entry.includes(includesWord)) {
                    console.log(`${entry}`);
                }
            }
        }

    }
});

function get_all_file_paths(directory: string): string[] {
    let results: string[] = [];
    const list = fs.readdirSync(directory);

    for (const file of list) {
        const filePath = path.join(directory, file);
        const stat = fs.statSync(filePath);

        if (stat && stat.isDirectory()) {
            results = [...results, ...get_all_file_paths(filePath)];
        } else {
            results.push(filePath);
        }
    }

    return results.sort(); // Sort to make hash order-independent
}