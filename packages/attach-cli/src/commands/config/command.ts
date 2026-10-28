/* eslint-disable unicorn/no-null */
import { Command } from "commander";
import * as fs from "node:fs";
import { stringify } from "smol-toml";

import type { LocalContext } from "../../context";
import { reload_caches } from "../../config/rebuild";
import { parse_settings, read_settings, reset_setting, save_settings, setting_spec, SETTINGS, setup_hint, type SettingSpec, type Settings } from "../../config/settings";
import { format_config_errors, linux_tree_problem, report_config_errors } from "../../config/workspace";
import { respond, respond_fail } from "../../protocol/output";
import type { Config, ToolConfigResponse } from "../../protocol/types";
import { creation_problem } from "../../workfile";

interface ConfigOptions {
    reset?: boolean;
    reload?: boolean;
}

export function build_config_command(context: LocalContext): Command {
    return new Command("config")
        .description("Show the configuration, or set or reset one field")
        .argument("[key]", "Config field name (omit for all)")
        .argument("[value]", "Value to set")
        .option("--reset", "Remove the field from config.toml: back to its default, or unset")
        .option("--reload", "Rebuild the binding index and validation.json from the Linux tree (no key)")
        .addHelpText("after", `
Fields:
  linux                       Kernel source tree (setting it builds the binding caches)
  devicetree                  Target base DTS file
  overlay                     Working DTSO overlay file
  overlay-syntax              Output syntax: fragment (default) or label
  preprocess-command          C preprocessor command template
  deploy-ip                   Remote device IP or hostname
  deploy-user                 SSH username
  deploy-password             SSH password

Examples:
  $ attach-linux config
  $ attach-linux config overlay
  $ attach-linux config linux /path/to/linux
  $ attach-linux config overlay-syntax label
  $ attach-linux config overlay-syntax --reset

Setting linux also builds the compat index and validation.json from its
bindings (about 40 s for the kernel tree). --reload rebuilds them: run it
after the bindings change; commands only warn when the caches look out of
date.
  $ attach-linux config --reload`)
        .action(async (key: string | undefined, value: string | undefined, options: ConfigOptions) => {
            if (options.reload === true) {
                if (key !== undefined || options.reset === true) {
                    fail(context, "--reload rebuilds the caches and takes no other argument");
                    return;
                }
                await reload(context);
                return;
            }

            if (key === undefined) {
                if (options.reset === true) {
                    fail(context, "--reset needs a key: attach-linux config <key> --reset");
                    return;
                }
                show(context, SETTINGS);
                return;
            }

            const spec = setting_spec(key);
            if (spec === undefined) {
                fail(context, `Unknown config field: ${key}. Valid fields: ${SETTINGS.map(s => s.key).join(", ")}`);
                return;
            }

            if (options.reset === true) {
                if (value !== undefined) {
                    fail(context, "--reset takes no value");
                    return;
                }
                reset(context, spec);
                return;
            }

            if (value === undefined) {
                show(context, [spec]);
                return;
            }
            await set(context, spec, value);
        });
}

function fail(context: LocalContext, message: string): void {
    if (context.json) { respond_fail({ ok: false, message, severity: "error" }); } else { console.log(message); }
}

function done(context: LocalContext, message: string): void {
    if (context.json) { respond({ ok: true, message, severity: "info" }); } else { console.log(message); }
}

/** Show `specs` with their values; needs the settings to load. */
function show(context: LocalContext, specs: readonly SettingSpec[]): void {
    const settings = read_settings();
    if (!settings.ok) {
        report_config_errors(context, settings.errors);
        return;
    }

    const rows = specs.map(spec => ({ spec, config: config_entry(spec, settings.value) }));
    const response: ToolConfigResponse = {
        ok: true,
        message: `${rows.length} config field(s)`,
        severity: "info",
        configs: rows.map(row => row.config),
    };
    if (context.json) {
        respond(response);
        return;
    }

    const unset = new Set<string>();
    for (const { spec, config: c } of rows) {
        const required_tag = c.required ? " [required]" : "";
        let display: string;
        if (c.value === null) {
            display = "(not set)";
        } else if (c.value === c.default) {
            display = `${c.value} (default)`;
        } else {
            display = String(c.value);
        }
        console.log(`${c.field_name}${required_tag}: ${display}`);
        const options = typeof spec.kind === "string" ? "" : ` [${spec.kind.options.join(" | ")}]`;
        console.log(`  ${spec.description}${options}`);
        console.log("");
        if (c.value === null && c.required) { unset.add(spec.key); }
    }
    if (unset.size > 0) {
        console.log("");
        console.log(setup_hint([...unset]));
    }
}

function config_entry(spec: SettingSpec, settings: Settings): Config {
    return {
        field_name: spec.key,
        category: undefined,
        description: spec.description,
        type: typeof spec.kind === "string" ? spec.kind : { options: [...spec.kind.options] },
        required: spec.required,
        default: spec.default ?? null,
        value: settings[spec.field] ?? null,
    };
}

/** The config.toml syntax error, if any: the rest of the file may be invalid (setting is how it gets fixed), but it must be TOML. */
function toml_syntax_error(): string | undefined {
    const current = read_settings();
    return current.ok ? undefined : current.errors.find(error => error.field === "config.toml")?.message;
}

async function set(context: LocalContext, spec: SettingSpec, value: string): Promise<void> {
    const field = spec.key;
    const syntax_error = toml_syntax_error();
    if (syntax_error !== undefined) {
        fail(context, syntax_error);
        return;
    }

    // Parse the value exactly as loading config.toml would.
    const parsed = parse_settings(stringify({ [field]: value }));
    if (!parsed.ok) {
        fail(context, format_config_errors(parsed.errors).human);
        return;
    }
    const parsed_value = parsed.value[spec.field] ?? value;
    // The overlay may name a file `init` has yet to create, in a directory that exists.
    const missing = spec.kind === "path" && !fs.existsSync(parsed_value);
    if (missing && field !== "overlay") {
        fail(context, `${field}: ${parsed_value} does not exist`);
        return;
    }
    const not_creatable = missing ? creation_problem(parsed_value) : undefined;
    if (not_creatable !== undefined) {
        fail(context, `${field}: ${not_creatable}`);
        return;
    }

    const problem = field === "linux" ? linux_tree_problem(parsed_value) : undefined;
    if (problem !== undefined) {
        fail(context, `${field}: ${problem}`);
        return;
    }

    save_settings({ [field]: parsed_value });
    let message = `Set ${field} = ${value}`;
    if (missing) { message += ` (not created yet: 'attach-linux init' creates it)`; }

    if (field === "linux") {
        const settings = read_settings();
        const reloaded = settings.ok ? await reload_caches(settings.value) : settings;
        if (!reloaded.ok) {
            fail(context, `${message}, but the binding caches were not built:\n${format_config_errors(reloaded.errors).human}`);
            return;
        }
        if (!reloaded.value.ok) {
            fail(context, `${message}, but ${reloaded.value.message}\nFix the bindings and run 'attach-linux config --reload'.`);
            return;
        }
        message += `; ${reloaded.value.message}`;
    }
    done(context, message);
}

function reset(context: LocalContext, spec: SettingSpec): void {
    const syntax_error = toml_syntax_error();
    if (syntax_error !== undefined) {
        fail(context, syntax_error);
        return;
    }
    reset_setting(spec.key);
    done(context, `Reset ${spec.key} (${spec.default === undefined ? "not set" : `default: ${spec.default}`})`);
}

async function reload(context: LocalContext): Promise<void> {
    const settings = read_settings();
    if (!settings.ok) {
        report_config_errors(context, settings.errors);
        return;
    }
    const reloaded = await reload_caches(settings.value);
    if (!reloaded.ok) {
        report_config_errors(context, reloaded.errors);
    } else if (reloaded.value.ok) {
        done(context, context.json ? reloaded.value.message : "Rebuilt the binding index and validation.json.");
    } else {
        fail(context, reloaded.value.message);
    }
}
