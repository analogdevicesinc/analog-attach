import { Command } from "commander";
import { Attach, DeviceTree, query_devicetree, insert_known_structures } from "attach-lib";

import * as fs from 'node:fs';

import type { LocalContext } from "../../context";
import { bigIntReplacer, find_binding } from "../../utilities";
import { load_config } from "../../config";

export function build_get_schema_command(_context: LocalContext): Command {
    return new Command("get-schema")
        .description("Get the parsed binding schema for a device")
        .requiredOption("--compatible <value>", "Compatible string of the desired device binding")
        .option("--context <value>", "The target dts")
        .option("--linux <value>", "Path to Linux repo")
        .option("--dt-schema <value>", "Path to dt-schema repo")
        .action(async (options) => {
            const config = load_config();
            const linux = options.linux ?? config.linux;
            const dtSchema = options.dtSchema ?? config.dtSchema;
            const context = options.context ?? config.context;
            const { compatible } = options;

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

            const context_content = fs.readFileSync(context, 'utf8');

            const dt = DeviceTree.new_from_string(context_content);

            if (typeof dt === 'string') {
                console.log(`Failed to parse dts ${context}: ${dt}`);
                return;
            }

            const binding_path = await find_binding(linux, dtSchema, compatible);

            if (binding_path === undefined) {
                console.log(`Failed to find binding for ${compatible}`);
                return;
            }

            let attach = Attach.new();

            let binding = await attach.parse_binding(binding_path, linux, dtSchema);

            if (binding === undefined) {
                console.log(`Failed to parse binding ${binding_path}`);
                return;
            }

            const input_data = {
                compatible: compatible
            };

            const update = attach.update_binding_by_changes(JSON.stringify(input_data, bigIntReplacer));

            if (update === undefined) {
                console.log(`Failed to update with set compatible "${compatible}" for ${binding_path}`);
                return;
            }

            binding = { parsed_binding: update.binding, patterns: binding.patterns };

            binding.parsed_binding.properties = query_devicetree(
                dt,
                binding.parsed_binding.properties,
                JSON.stringify(input_data, bigIntReplacer),
                ""
            );

            binding.parsed_binding.properties = insert_known_structures(binding.parsed_binding.properties);

            if (binding.parsed_binding.pattern_properties !== undefined) {
                for (const pattern of binding.parsed_binding.pattern_properties) {
                    pattern.properties = query_devicetree(
                        dt,
                        pattern.properties,
                        JSON.stringify(input_data, bigIntReplacer),
                        ""
                    );
                    pattern.properties = insert_known_structures(pattern.properties);
                }
            }

            console.log(JSON.stringify(binding.parsed_binding, bigIntReplacer));
        });
}
