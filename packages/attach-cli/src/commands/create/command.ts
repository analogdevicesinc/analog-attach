import { buildCommand } from "@stricli/core";

import * as fs from 'node:fs';
import path from "node:path";

import { get_all_file_paths } from "../../utilities";
import { Attach, extract_compatible } from "attach-lib";

type Flags = {
    linux: string,
    dtSchema: string,
    compatible: string,
    parent?: string,
    output?: string,
}

export const create_command = buildCommand({
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
            compatible: {
                kind: "parsed",
                parse: String,
                brief: "Compatible string of the desired device binding"
            },
            parent: {
                kind: "parsed",
                parse: String,
                brief: "Compatible string of the desired device binding",
                optional: true
            },
            output: {
                kind: "parsed",
                parse: String,
                brief: "Compatible string of the desired device binding",
                optional: true
            }
        }
    },
    docs: {
        brief: "Create dtso of the node with set compatible"
    },
    async func(flags: Flags) {
        const { linux, dtSchema, compatible, parent, output } = flags;

        if (!fs.existsSync(linux)) {
            console.log(`Missing: ${linux}`);
            return;
        }
        if (!fs.existsSync(dtSchema)) {
            console.log(`Missing: ${dtSchema}`);
            return;
        }

        const schema = await find_binding(linux, dtSchema, compatible);

        if (schema === undefined) {
            console.log(`Failed to find schema for ${compatible}`);
            return;
        }

        // TODO: could also check to find parent in context

        const path = (() => {
            if (parent === undefined) {
                return `/`;
            }

            if (parent.startsWith("/")) {
                return `&{${parent}}`;
            }

            return `&${parent}`;
        })();

        const dtso = String.raw`/dts-v1/;
/plugin/;

${path} {
        ${compatible} {
            compatible = "${compatible}";
        };
};
`;

        if (output === undefined) {
            console.log(dtso);
        }
        else {
            fs.writeFileSync(output, dtso);
            console.log(`Wrote ${output}`);
        }
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
            // TODO: fix why entry could be undefined
            // arm/actions.yaml
            if (entry !== undefined && entry === compatible_to_find) {
                return file;
            }
        }

    }

    return;
}
