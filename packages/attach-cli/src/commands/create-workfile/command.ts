import { Command } from "commander";

import type { LocalContext } from "../../context";
import { load_config } from "../../config";
import { respond, respond_fail } from "../../protocol/output";
import type { CreateWorkfileResponse } from "../../protocol/types";
import { create_workfile, next_workfile_name } from "../../workfile";

export function build_create_workfile_command(context: LocalContext): Command {
    return new Command("create-workfile")
        .description("Create an overlay workfile")
        .argument("[name]", "Base name for the overlay file (default: overlay)")
        .addHelpText("after", `
The .dtso extension is added automatically. When the name is omitted, uses
overlay.dtso (or overlay-1.dtso, overlay-2.dtso, etc. if it already exists).

Examples:
  $ attach-linux create-workfile
  $ attach-linux create-workfile my-overlay`)
        .action(async (name) => {
            const filename: string = name === undefined
                ? next_workfile_name()
                : (name.endsWith(".dtso") ? name : `${name}.dtso`);

            const result = create_workfile(load_config() ?? {}, filename);

            if ("error" in result) {
                if (context.json) {
                    respond_fail({ ok: false, message: result.error, severity: "error" });
                } else {
                    console.log(result.error);
                }
                return;
            }

            const message = [result.message, ...result.warnings].join("; ");

            if (context.json) {
                respond({
                    ok: true,
                    message: message.replace(/^Wrote /, "Created workfile "),
                    severity: result.warnings.length > 0 ? "warn" : "info",
                    path: result.path,
                } satisfies CreateWorkfileResponse);
            } else {
                console.log(result.message);
                for (const warning of result.warnings) { console.log(warning); }
            }
        });
}

