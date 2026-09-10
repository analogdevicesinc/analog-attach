import { Command } from "commander";
import * as fs from "node:fs";
import path from "node:path";

import type { LocalContext } from "../../context";
import { save_config } from "../../config";
import { respond } from "../../protocol/output";

export function build_create_workfile_command(context: LocalContext): Command {
    return new Command("create-workfile")
        .description("Create a new workfile (DTSO overlay)")
        .option("--name <value>", "Output filename (default: overlay.dtso)")
        .action(async (options) => {
            const filename: string = options.name ?? "overlay.dtso";

            const dtso = String.raw`/dts-v1/;
/plugin/;

/ {
};
`;

            const output_path = path.resolve(process.cwd(), filename);
            fs.writeFileSync(output_path, dtso);

            save_config({ overlay: output_path });

            if (context.json) {
                respond({ ok: true, message: `Created workfile`, severity: "info", path: output_path });
            } else {
                console.log(`Wrote ${output_path}`);
            }
        });
}
