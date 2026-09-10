import { Command } from "commander";
import { Attach, DeviceTree, suggest_parents } from "attach-lib";
import * as fs from "node:fs";

import type { LocalContext } from "../../context";
import { load_config } from "../../config";
import { load_compat_index, save_compat_index } from "../../config";
import { find_binding, is_compat_index_stale, build_compat_index } from "../../utilities";
import { respond, respond_fail, input_error } from "../../protocol/output";

export function build_suggest_command(context: LocalContext): Command {
    return new Command("suggest")
        .description("Provide suggestions for a given intelligence kind")
        .argument("[args...]", "kind followed by kind-specific args")
        .action(async (arguments_: string[]) => {
            const kind = arguments_[0];

            if (kind === undefined) {
                if (context.json) { input_error("kind is required"); return; }
                console.log("Missing: kind (first positional argument)");
                return;
            }

            switch (kind) {
                case "parent": {
                    await suggest_parent(context, arguments_.slice(1));
                    return;
                }
                case "device-key": {
                    await suggest_device_key(context, arguments_.slice(1));
                    return;
                }
                default: {
                    if (context.json) {
                        respond_fail({ ok: false, message: `Unknown suggestion kind: ${kind}`, severity: "error" });
                    } else {
                        console.log(`Unknown suggestion kind: ${kind}`);
                    }
                    return;
                }
            }
        });
}

async function suggest_parent(context_: LocalContext, arguments_: string[]): Promise<void> {
    const compatible = arguments_[0];
    if (compatible === undefined) {
        if (context_.json) { input_error("compatible string is required for parent suggestions"); return; }
        console.log("Missing: compatible string");
        return;
    }

    const config = load_config();
    const linux = config.linux;
    const dtSchema = config.dtSchema;
    const context = config.context;

    if (linux === undefined || dtSchema === undefined || context === undefined) {
        if (context_.json) { input_error("Tool config incomplete: linux, dt-schema, and context must be set"); return; }
        console.log("Missing config: linux, dt-schema, and context must be set");
        return;
    }

    if (!fs.existsSync(context) || !fs.existsSync(linux) || !fs.existsSync(dtSchema)) {
        if (context_.json) { input_error("Configured path does not exist"); return; }
        console.log("One or more configured paths do not exist");
        return;
    }

    const context_content = fs.readFileSync(context, "utf8");
    const dt = DeviceTree.new_from_string(context_content);

    if (typeof dt === "string") {
        if (context_.json) { input_error(`Failed to parse dts: ${dt}`); return; }
        console.log(`Failed to parse dts ${context}: ${dt}`);
        return;
    }

    const binding_path = await find_binding(linux, dtSchema, compatible);
    if (binding_path === undefined) {
        if (context_.json) {
            respond({ ok: true, message: `No binding found for ${compatible}`, severity: "warn", suggestions: [] });
        } else {
            console.log(`Failed to find binding for ${compatible}`);
        }
        return;
    }

    const attach = Attach.new();
    const binding = await attach.parse_binding(binding_path, linux, dtSchema);

    if (binding === undefined) {
        if (context_.json) {
            respond_fail({ ok: false, message: `Failed to parse binding ${binding_path}`, severity: "error" });
        } else {
            console.log(`Failed to parse binding ${binding_path}`);
        }
        return;
    }

    const parents = suggest_parents(dt, binding.parsed_binding);

    if (context_.json) {
        const suggestions = parents.map(p => ({
            value: p.label ?? p.path.join("/"),
            display_string: p.path.join("/"),
        }));
        respond({ ok: true, message: `Found ${suggestions.length} valid parents`, severity: "info", suggestions });
    } else {
        console.log(JSON.stringify(parents));
    }
}

async function suggest_device_key(context: LocalContext, arguments_: string[]): Promise<void> {
    const filter = arguments_[0];

    let index = load_compat_index();
    if (index === undefined) {
        if (context.json) { input_error("No compat-index.json found. Run init or config-set first."); return; }
        console.log("No compat-index.json found. Run 'attach init' first.");
        return;
    }

    const config = load_config();
    if (config.linux !== undefined && config.dtSchema !== undefined && is_compat_index_stale(index, config.linux, config.dtSchema)) {
        const entries = await build_compat_index(config.linux, config.dtSchema);
        save_compat_index(entries);
        index = { generated_at: Date.now(), entries };
    }

    const entries = Object.keys(index.entries);
    const matching = filter === undefined
        ? entries
        : entries.filter(entry => entry.includes(filter));

    if (context.json) {
        const suggestions = matching.map(entry => ({ value: entry }));
        respond({ ok: true, message: `Found ${suggestions.length} devices`, severity: "info", suggestions });
    } else {
        for (const entry of matching) {
            console.log(entry);
        }
    }
}
