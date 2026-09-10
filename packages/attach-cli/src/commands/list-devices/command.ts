import { Command } from "commander";

import { load_compat_index, load_config, save_compat_index } from "../../config";
import { is_compat_index_stale, build_compat_index } from "../../utilities";
import { respond, input_error } from "../../protocol/output";
import type { ListDevicesResponse } from "../../protocol/types";
import type { LocalContext } from "../../context";

export function build_list_devices_command(context: LocalContext): Command {
    return new Command("list-devices")
        .description("List available devices from the compat index")
        .option("--includes-word <value>", "word to be present in device name")
        .action(async (options) => {
            const { includesWord } = options;

            let index = load_compat_index();

            if (index === undefined) {
                if (context.json) {
                    input_error("No compat-index.json found. Run config-set first.");
                    return;
                }
                console.log("No compat-index.json found. Run 'attach init' first.");
                return;
            }

            const config = load_config();

            if (
                config.linux !== undefined &&
                config.dtSchema !== undefined &&
                is_compat_index_stale(index, config.linux, config.dtSchema)
            ) {
                console.error("compat-index.json is stale, rebuilding...");

                const entries = await build_compat_index(config.linux, config.dtSchema);
                const compat_index_path = save_compat_index(entries);

                console.error(`Written: ${compat_index_path}`);
                index = { generated_at: Date.now(), entries };
            }

            const matching = Object.keys(index.entries).filter(
                entry => includesWord === undefined || entry.includes(includesWord)
            );

            if (context.json) {
                const devices = matching.map(entry => ({ tag: entry, key: entry }));
                const response: ListDevicesResponse = {
                    ok: true,
                    message: `Found ${devices.length} devices`,
                    severity: "info",
                    devices,
                };
                respond(response);
                return;
            }

            for (const entry of matching) {
                console.log(entry);
            }
        });
}
