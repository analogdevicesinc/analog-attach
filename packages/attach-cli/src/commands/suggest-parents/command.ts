import { buildCommand } from "@stricli/core";
import { Attach, extract_compatible, parse_dts, suggest_parents } from "attach-lib";

import * as fs from 'node:fs';
import path from "node:path";
import { get_all_file_paths } from "../../utilities";

type Flags = {
    linux: string,
    dtSchema: string,
    context: string,
    compatible: string,
}

export const suggest_parents_command = buildCommand({
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
            context: {
                kind: "parsed",
                parse: String,
                brief: "The target dts"
            },
            compatible: {
                kind: "parsed",
                parse: String,
                brief: "Compatible string of the desired device binding"
            }
        }
    },
    docs: {
        brief: "List available devices in linux repo"
    },
    async func(flags: Flags) {
        const { linux, dtSchema, context, compatible } = flags;

        if (!fs.existsSync(context)) {
            console.log(`Missing: ${context}`);
            return;
        }
        if (!fs.existsSync(linux)) {
            console.log(`Missing: ${context}`);
            return;
        }
        if (!fs.existsSync(dtSchema)) {
            console.log(`Missing: ${context}`);
            return;
        }

        const context_content = fs.readFileSync(context, 'utf8');

        const document = (() => {
            try {
                return parse_dts(context_content);
            } catch {
                return;
            }
        })();

        if (document === undefined) {
            console.log(`Failed to parse dts ${context}`);
            return;
        }

        const binding_path = await find_binding(linux, dtSchema, compatible);

        if (binding_path === undefined) {
            console.log(`Failed to find binding for ${compatible}`);
            return;
        }

        let attach = Attach.new();

        const binding = await attach.parse_binding(binding_path, linux, dtSchema);

        if (binding === undefined) {
            console.log(`Failed to parse binding ${binding_path}`);
            return;
        }

        const parents = suggest_parents(document, binding.parsed_binding);

        console.log(JSON.stringify(parents));
    }
});

async function find_binding(linux: string, dtSchema: string, compatible_to_find: string): Promise<string | undefined> {
    const bindings_folder = path.resolve(linux, "Documentation", "devicetree", "bindings");

    if (!fs.existsSync(bindings_folder)) {
        console.log(`Missing ${bindings_folder}`);
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
            if (entry !== undefined && entry === compatible_to_find) {
                return file;
            }
        }

    }

    return;
}
