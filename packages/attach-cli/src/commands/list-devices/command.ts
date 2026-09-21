import { Command } from "commander";

import { load_config } from "../../config";
import { get_or_build_compat_index } from "../../utilities";
import { respond, input_error } from "../../protocol/output";
import type { ListDevicesResponse } from "../../protocol/types";
import type { LocalContext } from "../../context";

export function build_list_devices_command(context: LocalContext): Command {
    return new Command("list-devices")
        .description("List available devices from the compat index")
        .option("--includes-word <value>", "word to be present in device name")
        .action(async (options) => {
            const { includesWord } = options;

            const config = load_config() ?? {};

            const index = await get_or_build_compat_index(config.linux, config.dtSchema, (message) => console.error(message));

            if (index === undefined) {
                if (context.json) {
                    input_error("No compat-index.json found and linux/dt-schema not configured. Run 'attach config-set' first.");
                    return;
                }
                console.log("No compat-index.json found and linux/dt-schema not configured. Run 'attach config-set' first.");
                return;
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
