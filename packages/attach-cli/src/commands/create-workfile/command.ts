import { buildCommand } from "@stricli/core";
import * as fs from "node:fs";
import path from "node:path";

import type { LocalContext } from "../../context";
import { load_config, save_config } from "../../config";
import { find_binding } from "../../utilities";
import { respond, respond_fail, input_error } from "../../protocol/output";

type Flags = {
    compatible?: string;
    parent?: string;
    label?: string;
    linux?: string;
    dtSchema?: string;
};

export const create_workfile_command = buildCommand({
    parameters: {
        flags: {
            compatible: {
                kind: "parsed",
                parse: String,
                brief: "Compatible string of the desired device binding",
                optional: true,
            },
            parent: {
                kind: "parsed",
                parse: String,
                brief: "Parent node label or path (e.g. spi0 or /soc/spi@...)",
                optional: true,
            },
            label: {
                kind: "parsed",
                parse: String,
                brief: "Label to attach to the new node",
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
        },
    },
    docs: {
        brief: "Create a new workfile (DTSO overlay)",
    },
    async func(this: LocalContext, flags: Flags) {
        const config = load_config();
        const linux = flags.linux ?? config.linux;
        const dtSchema = flags.dtSchema ?? config.dtSchema;
        const { compatible, parent, label } = flags;

        if (linux === undefined) {
            if (this.json) { input_error("Missing: linux (not configured)"); return; }
            console.log("Missing: --linux (no config.toml found)");
            return;
        }

        if (dtSchema === undefined) {
            if (this.json) { input_error("Missing: dt-schema (not configured)"); return; }
            console.log("Missing: --dt-schema (no config.toml found)");
            return;
        }

        if (!fs.existsSync(linux)) {
            if (this.json) { input_error(`Missing: ${linux}`); return; }
            console.log(`Missing: ${linux}`);
            return;
        }

        if (!fs.existsSync(dtSchema)) {
            if (this.json) { input_error(`Missing: ${dtSchema}`); return; }
            console.log(`Missing: ${dtSchema}`);
            return;
        }

        if (compatible !== undefined) {
            const binding = await find_binding(linux, dtSchema, compatible);
            if (binding === undefined) {
                if (this.json) {
                    respond_fail({ ok: false, message: `Failed to find binding for ${compatible}`, severity: "error" });
                } else {
                    console.log(`Failed to find binding for ${compatible}`);
                }
                return;
            }
        }

        const target_reference = (() => {
            if (parent === undefined) {return `/`;}
            if (parent.startsWith("/")) {return `&{${parent}}`;}
            return `&${parent}`;
        })();

        const node_name = compatible ?? "node";
        const label_prefix = label === undefined ? "" : `${label}: `;

        const dtso = String.raw`/dts-v1/;
/plugin/;

${target_reference} {
        ${label_prefix}${node_name} {${compatible === undefined ? "" : `\n            compatible = "${compatible}";`}
        };
};
`;

        const directory = path.join(process.cwd(), ".analog-attach");
        fs.mkdirSync(directory, { recursive: true });

        const output_path = path.resolve(directory, "overlay.dtso");
        fs.writeFileSync(output_path, dtso);

        save_config({ overlay: output_path });

        if (this.json) {
            respond({ ok: true, message: `Created workfile`, severity: "info", path: output_path });
        } else {
            console.log(`Wrote ${output_path}`);
        }
    },
});
