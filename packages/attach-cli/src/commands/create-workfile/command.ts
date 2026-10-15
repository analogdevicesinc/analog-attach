import { Command } from "commander";
import * as fs from "node:fs";
import path from "node:path";

import type { LocalContext } from "../../context";
import { read_settings } from "../../config/settings";
import { report_config_errors } from "../../config/workspace";
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
An existing file is never overwritten.

Examples:
  $ attach-linux create-workfile
  $ attach-linux create-workfile my-overlay`)
        .action(async (name) => {
            const filename: string = name === undefined
                ? next_workfile_name()
                : (name.endsWith(".dtso") ? name : `${name}.dtso`);

            if (fs.existsSync(path.resolve(filename))) {
                const message = `${filename} already exists; use it with 'config-set overlay ${filename}' or pick another name`;
                if (context.json) { respond_fail({ ok: false, message, severity: "error" }); }
                else { console.log(message); }
                return;
            }

            const settings = read_settings();
            if (!settings.ok) {
                report_config_errors(context, settings.errors);
                return;
            }

            const result = create_workfile(filename);

            if (context.json) {
                respond({
                    ok: true,
                    message: result.message.replace(/^Wrote /, "Created workfile "),
                    severity: "info",
                    path: result.path,
                } satisfies CreateWorkfileResponse);
            } else {
                console.log(result.message);
            }
        });
}

