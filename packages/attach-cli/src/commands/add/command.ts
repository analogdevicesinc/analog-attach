import { buildCommand } from "@stricli/core";
import { mergeDtso, parse_dts, parseDtso, printDtso, search_node_in_dts } from "attach-lib";

import * as fs from 'node:fs';

import { find_binding } from "../../utilities";
import { load_config } from "../../config";

type Flags = {
    compatible?: string,
    name?: string,
    parent?: string,
    overlay: string,
    context?: string,
    linux?: string,
    dtSchema?: string,
}

export const add_command = buildCommand({
    parameters: {
        flags: {
            compatible: {
                kind: "parsed",
                parse: String,
                brief: "Compatible string of the device binding to add",
                optional: true,
            },
            name: {
                kind: "parsed",
                parse: String,
                brief: "Node name (e.g. channel@0); defaults to --compatible",
                optional: true,
            },
            parent: {
                kind: "parsed",
                parse: String,
                brief: "Parent node label, path, or existing node name (e.g. spi0 or adi,ad7124-8)",
                optional: true,
            },
            overlay: {
                kind: "parsed",
                parse: String,
                brief: "dtso"
            },
            context: {
                kind: "parsed",
                parse: String,
                brief: "The target dts",
                optional: true,
            },
            linux: {
                kind: "parsed",
                parse: String,
                brief: "Path to Linux repo",
                optional: true,
            },
            dtSchema: {
                kind: "parsed",
                parse: String,
                brief: "Path to dt-schema repo",
                optional: true,
            },
        }
    },
    docs: {
        brief: "Add a new node to an existing dtso"
    },
    async func(flags: Flags) {
        const config = load_config();
        const linux = flags.linux ?? config.linux;
        const dtSchema = flags.dtSchema ?? config.dtSchema;
        const context = flags.context ?? config.context;
        const { compatible, name, parent, overlay: input } = flags;

        if (compatible === undefined && name === undefined) {
            console.log("Missing: --compatible or --name (at least one is required)");
            return;
        }

        if (linux === undefined) {
            console.log("Missing: --linux (no config.toml found)");
            return;
        }

        if (dtSchema === undefined) {
            console.log("Missing: --dt-schema (no config.toml found)");
            return;
        }

        if (context === undefined) {
            console.log("Missing: --context (no config.toml found)");
            return;
        }

        if (!fs.existsSync(context)) {
            console.log(`Missing: ${context}`);
            return;
        }

        if (!fs.existsSync(linux)) {
            console.log(`Missing: ${linux}`);
            return;
        }

        if (!fs.existsSync(dtSchema)) {
            console.log(`Missing: ${dtSchema}`);
            return;
        }

        if (!fs.existsSync(input)) {
            console.log(`Missing: ${input} (use "create" to generate a new overlay first)`);
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

        const input_content = fs.readFileSync(input, 'utf8');

        const input_document = (() => {
            try {
                return parseDtso(input_content);
            } catch (error) {
                console.log(`${error}`);
                return;
            }
        })();

        if (input_document === undefined) {
            console.log(`Failed to parse dtso ${input}`);
            return;
        }

        if (compatible !== undefined) {
            const binding_path = await find_binding(linux, dtSchema, compatible);

            if (binding_path === undefined) {
                console.log(`Failed to find binding for ${compatible}`);
                return;
            }
        }

        const node_name = name ?? compatible!;

        const input_document_merged = mergeDtso(document, input_content, true);

        const target = (() => {
            if (parent === undefined) {
                return "/";
            }

            const searched_parent = search_node_in_dts(input_document_merged, parent);

            const resolved = searched_parent === undefined ? parent : searched_parent.parent;

            return resolved.startsWith("/") ? `&{${resolved}}` : `&${resolved}`;
        })();

        const dtso_fragment = String.raw`/dts-v1/;
/plugin/;

${target} {
        ${node_name} {
            ${compatible === undefined ? "" : `compatible = "${compatible}";`}
        };
};
`;

        const merged_with_new = mergeDtso(input_document_merged, dtso_fragment, true);

        fs.writeFileSync(input, printDtso(merged_with_new));
        console.log(`Added ${node_name} to ${input}`);
    }
});
