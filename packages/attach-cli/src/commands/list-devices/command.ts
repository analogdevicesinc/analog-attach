import { buildCommand } from "@stricli/core";

import { load_compat_index, load_config, save_compat_index } from "../../config";
import { is_compat_index_stale, build_compat_index } from "../../utilities";

type Flags = {
    includesWord?: string,
}

export const list_devices_command = buildCommand({
    parameters: {
        flags: {
            includesWord: {
                kind: "parsed",
                parse: String,
                brief: "word to be present in device name",
                optional: true
            },
        }
    },
    docs: {
        brief: "List available devices from the compat index"
    },
    async func(flags: Flags) {
        const { includesWord } = flags;

        let index = load_compat_index();

        if (index === undefined) {
            console.log("No compat-index.json found. Run 'attach init' first.");
            return;
        }

        const config = load_config();

        if (
            config.linux !== undefined &&
            config.dtSchema !== undefined &&
            is_compat_index_stale(index, config.linux, config.dtSchema)
        ) {
            console.log("compat-index.json is stale, rebuilding...");

            const entries = await build_compat_index(config.linux, config.dtSchema);
            const compat_index_path = save_compat_index(entries);

            console.log(`Written: ${compat_index_path}`);
            index = { generated_at: Date.now(), entries };
        }

        for (const entry of Object.keys(index.entries)) {
            if (includesWord === undefined || entry.includes(includesWord)) {
                console.log(entry);
            }
        }
    }
});

