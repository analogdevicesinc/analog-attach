import { Command } from "commander";
import { Attach, DeviceTree, suggest_parents } from "attach-lib";

import * as fs from 'node:fs';

import type { LocalContext } from "../../context";
import { find_binding } from "../../utilities";
import { load_config } from "../../config";

export function build_suggest_parents_command(_context: LocalContext): Command {
    return new Command("suggest-parents")
        .description("Suggest valid parent nodes for a device in a DTS context")
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

            const attach = Attach.new();

            const binding = await attach.parse_binding(binding_path, linux, dtSchema);

            if (binding === undefined) {
                console.log(`Failed to parse binding ${binding_path}`);
                return;
            }

            const parents = suggest_parents(dt, binding.parsed_binding);

            console.log(JSON.stringify(parents));
        });
}
