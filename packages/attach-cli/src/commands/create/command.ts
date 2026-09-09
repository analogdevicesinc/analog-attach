import { Command } from "commander";

import * as fs from 'node:fs';

import type { LocalContext } from "../../context";
import { find_binding } from "../../utilities";
import { load_config } from "../../config";

export function build_create_command(_ctx: LocalContext): Command {
    return new Command("create")
        .description("Create dtso of the node with set compatible")
        .requiredOption("--compatible <value>", "Compatible string of the desired device binding")
        .option("--parent <value>", "Parent node label or path (e.g. spi0 or /soc/spi@...)")
        .option("--label <value>", "Label to attach to the new node (e.g. imu1), for later reference as &label")
        .option("--output <value>", "Output file path; prints to stdout if omitted")
        .option("--linux <value>", "Path to Linux repo")
        .option("--dt-schema <value>", "Path to dt-schema repo")
        .action(async (options) => {
            const config = load_config();
            const linux = options.linux ?? config.linux;
            const dtSchema = options.dtSchema ?? config.dtSchema;
            const { compatible, parent, label, output } = options;

            if (linux === undefined) {
                console.log("Missing: --linux (no config.toml found)");
                return;
            }

            if (dtSchema === undefined) {
                console.log("Missing: --dt-schema (no config.toml found)");
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
        ${label === undefined ? "" : `${label}: `}${compatible} {
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
        });
}
