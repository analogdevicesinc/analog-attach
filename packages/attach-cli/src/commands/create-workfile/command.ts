import { Command } from "commander";
import * as fs from "node:fs";
import path from "node:path";

import type { LocalContext } from "../../context";
import { load_config, save_config } from "../../config";
import { find_binding } from "../../utilities";
import { respond, respond_fail, input_error } from "../../protocol/output";

export function build_create_workfile_command(ctx: LocalContext): Command {
    return new Command("create-workfile")
        .description("Create a new workfile (DTSO overlay)")
        .option("--compatible <value>", "Compatible string of the desired device binding")
        .option("--parent <value>", "Parent node label or path (e.g. spi0 or /soc/spi@...)")
        .option("--label <value>", "Label to attach to the new node")
        .option("--linux <value>", "Path to Linux repo")
        .option("--dt-schema <value>", "Path to dt-schema repo")
        .action(async (options) => {
            const config = load_config();
            const linux = options.linux ?? config.linux;
            const dtSchema = options.dtSchema ?? config.dtSchema;
            const { compatible, parent, label } = options;

            if (linux === undefined) {
                if (ctx.json) { input_error("Missing: linux (not configured)"); return; }
                console.log("Missing: --linux (no config.toml found)");
                return;
            }

            if (dtSchema === undefined) {
                if (ctx.json) { input_error("Missing: dt-schema (not configured)"); return; }
                console.log("Missing: --dt-schema (no config.toml found)");
                return;
            }

            if (!fs.existsSync(linux)) {
                if (ctx.json) { input_error(`Missing: ${linux}`); return; }
                console.log(`Missing: ${linux}`);
                return;
            }

            if (!fs.existsSync(dtSchema)) {
                if (ctx.json) { input_error(`Missing: ${dtSchema}`); return; }
                console.log(`Missing: ${dtSchema}`);
                return;
            }

            if (compatible !== undefined) {
                const binding = await find_binding(linux, dtSchema, compatible);
                if (binding === undefined) {
                    if (ctx.json) {
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

            if (ctx.json) {
                respond({ ok: true, message: `Created workfile`, severity: "info", path: output_path });
            } else {
                console.log(`Wrote ${output_path}`);
            }
        });
}
