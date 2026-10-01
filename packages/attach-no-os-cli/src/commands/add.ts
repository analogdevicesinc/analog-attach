import path from "node:path";
import { buildCommand } from "@stricli/core";
import {
    add_symbol,
    bootstrap,
    bootstrap_enabled,
    driver_root,
    list_available_structs,
    list_drivers,
    format_number_in,
    load_resolved_ruleset_for_board,
    validate_workfile,
} from "attach-no-os-lib";
import type { BootstrapReport, FilledValue, Workfile } from "attach-no-os-lib";
import { filter_completions, get_node_names, get_schema_paths } from "../completion/completion";
import { common_ok, type AddResponse } from "../protocol/responses";
import { load_context, output, output_error, root_key, save_workfile, type WorkfileContext } from "./shared";

type AddFlags = {
    json?: boolean;
    key?: string;
    name?: string;
    to?: string[];
};

/**
 * `attach-noos add <schema> [--name <node>]` — create a node.
 *
 * The schema is the protocol's positional device key, the one aa-meta's base schema marks
 * `x-positional`. `--key` is kept as a second spelling of the same argument because that is
 * how every script in this repository writes it; the two must not disagree.
 *
 * The protocol allows `--name` on its own, with the tool inventing the key. We cannot: a
 * node here is an instance of a schema, and nothing but the caller knows which schema was
 * meant. So a name-only add is refused with a pointer at `list-devices` rather than guessed
 * at.
 *
 * `--to` is the protocol's parent path (a variadic array flag). It is accepted and must
 * name the root, because the workfile is a flat symbol table: every node is a root-level
 * node.
 *
 * The key may also be a DRIVER name (`add adxl355`). That adds the driver's root - the
 * generic handle it is reached through (a capi_accel_sensor) - named after the driver, and
 * the `bootstrap` setting (on by default) then builds everything below it that leaves no
 * room for choice.
 */
export const addCommand = buildCommand<AddFlags, [string | undefined]>({
    docs: {
        brief: "Add a node to the workfile",
        fullDescription:
            "Creates a node from a schema. <schema> is the device key (see 'attach-noos list-devices')\n" +
            "and may also be given as --key; --name is what the node is called in the workfile,\n" +
            "defaulting to the schema's own name. <schema> can also be a driver name (adxl355),\n" +
            "which adds the handle the part is used through.\n" +
            "With the 'bootstrap' setting on (the default), everything below the new node that\n" +
            "leaves no room for choice is then filled in, and what is left is shown."
    },
    parameters: {
        positional: {
            kind: "tuple",
            parameters: [
                {
                    placeholder: "schema",
                    brief: "Schema to instantiate (see: attach-noos list-devices)",
                    optional: true,
                    parse: String,
                    proposeCompletions(partial: string) {
                        return filter_completions(get_schema_paths(), partial);
                    }
                }
            ]
        },
        flags: {
            key: {
                kind: "parsed",
                brief: "Schema to instantiate, as a flag instead of the positional",
                optional: true,
                parse: String,
                proposeCompletions(partial: string) {
                    return filter_completions(get_schema_paths(), partial);
                }
            },
            name: {
                kind: "parsed",
                brief: "Name for the new node (default: the schema's own name)",
                optional: true,
                parse: String
            },
            to: {
                kind: "parsed",
                brief: "Parent path; only the root is accepted, since the workfile is flat",
                optional: true,
                variadic: true,
                parse: String,
                proposeCompletions(partial: string) {
                    return filter_completions(get_node_names(), partial);
                }
            },
            json: { kind: "boolean", brief: "Output as JSON", optional: true }
        }
    },
    func: async (flags: AddFlags, positional_key?: string) => {
        const context = load_context();
        if (!context.ok) {
            output_error(flags, context.error.message);
            return;
        }

        // One argument, two spellings. Silently preferring one would make a typo in the
        // other look like it had been honoured.
        if (positional_key !== undefined && flags.key !== undefined && positional_key !== flags.key) {
            output_error(
                flags,
                `Two different schemas given: '${positional_key}' and --key '${flags.key}'. Pass one.`
            );
            return;
        }

        const key = positional_key ?? flags.key;

        if (key === undefined) {
            output_error(
                flags,
                flags.name === undefined
                    ? "Nothing to add: pass <schema> (see: attach-noos list-devices)"
                    : `Cannot add '${flags.name}' without a schema: a node is an instance of a schema, ` +
                      "and there is no default schema. See: attach-noos list-devices"
            );
            return;
        }

        // A flat symbol table has exactly one place to put a node. Refusing a parent is
        // better than accepting one and silently ignoring it.
        const root = root_key(context.value);
        const parent = (flags.to ?? []).filter(segment => segment !== "");
        if (parent.length > 1 || (parent.length === 1 && parent[0] !== root)) {
            output_error(
                flags,
                `'${parent.join(" ")}' cannot hold a node: this workfile is flat, so every node lives at the root ('${root}')`
            );
            return;
        }

        const available = list_available_structs(context.value.workfile);
        if (!available.ok) {
            output_error(flags, available.error.message);
            return;
        }

        // A schema wins over a driver of the same name; a driver is only the shorthand.
        let schema = key;
        let default_node_name = default_name(key);
        if (!available.value.all.includes(key)) {
            const drivers = list_drivers();
            const is_driver = drivers.ok && drivers.value.some(driver => driver.name === key);
            if (!is_driver) {
                output_error(flags, `Unknown schema '${key}'. See: attach-noos list-devices`);
                return;
            }
            const root = driver_root(key);
            if (!root.ok) {
                output_error(flags, root.error.message);
                return;
            }
            schema = root.value;
            default_node_name = key;
        }

        const name = flags.name ?? unique_name(default_node_name, context.value);
        if (context.value.workfile.symbols[name]) {
            output_error(flags, `'${name}' already exists. Pass --name to choose another name.`);
            return;
        }

        // The board is passed because `key` may name one of its own peripherals, which are
        // scoped to the selected board rather than globally unique.
        const ruleset = load_resolved_ruleset_for_board(schema, context.value.workfile.board);
        if (!ruleset.ok) {
            output_error(flags, ruleset.error.message);
            return;
        }

        const changed = add_symbol(context.value.workfile, name, ruleset.value);
        if (!changed.ok) {
            output_error(flags, changed.error.message);
            return;
        }

        context.value.workfile = changed.value;

        let report: BootstrapReport | undefined;
        if (bootstrap_enabled()) {
            const ran = bootstrap(context.value.workfile);
            if (!ran.ok) {
                output_error(flags, `Added '${name}', but bootstrap failed: ${ran.error.message}`);
                return;
            }
            report = ran.value;
        }

        const saved = save_workfile(context.value);
        if (!saved.ok) {
            output_error(flags, saved.error.message);
            return;
        }

        const validation = validate_workfile(context.value.workfile);
        const errors = validation.errors.filter(entry => entry.severity === "error").length;
        const left = `${String(errors)} problem${errors === 1 ? "" : "s"} left`;

        const what = schema === key ? key : `${schema}, for driver ${key}`;
        const created = report === undefined ? 0 : report.linked.filter(link => link.created && !link.hidden).length;
        const message = report === undefined
            ? `Added '${name}' (${what})`
            : `Added '${name}' (${what}) and ${String(created)} node${created === 1 ? "" : "s"} below it; ` +
              (validation.valid ? "the workfile is valid" : `${left} - run: attach-noos validate`);

        const response: AddResponse = {
            ...common_ok(message),
            key,
            path: [name]
        };

        const text = [
            `Added '${name}' (${what})`,
            `  ${context.value.path}`,
            ...(report === undefined ? [] : describe_bootstrap(report, context.value.workfile)),
            "",
            validation.valid ? "The workfile is valid." : `${left}. Run: attach-noos validate`,
        ];
        output(flags, text.join("\n"), response);
    }
});

/** `devices/ad7124/ad7124_init_param.yaml` → `ad7124_init_param`. */
function default_name(key: string): string {
    return path.basename(key, path.extname(key));
}

function unique_name(base: string, context: WorkfileContext): string {
    if (!context.workfile.symbols[base]) {
        return base;
    }

    for (let index = 1; ; index++) {
        const candidate = `${base}_${index}`;
        if (!context.workfile.symbols[candidate]) {
            return candidate;
        }
    }
}

/** A value as the schema writes it: a number in its format, anything else as JSON. */
function show(value: unknown, format: FilledValue["format"]): string {
    return typeof value === "number" ? format_number_in(value, format) : JSON.stringify(value);
}

/** What bootstrap did, for a person: the nodes it made, the values it chose, the wiring, and where it stopped. */
function describe_bootstrap(report: BootstrapReport, workfile: Workfile): string[] {
    const lines: string[] = [];
    if (report.revised.length > 0) {
        lines.push("", "Bootstrap brought its own values in line with the current rules:");
        for (const revision of report.revised) {
            const at = `${revision.node}.${revision.property}`.padEnd(32);
            lines.push(revision.value === undefined
                ? `  - ${at} ${show(revision.previous, revision.format)} (no longer applies, removed)`
                : `  * ${at} ${show(revision.previous, revision.format)} -> ${show(revision.value, revision.format)}`);
        }
    }

    if (report.deleted.length > 0) {
        lines.push("", "Bootstrap deleted what nothing uses any more:");
        for (const name of report.deleted) {
            lines.push(`  x ${name}`);
        }
    }
    for (const name of report.dangling) {
        lines.push("", `'${name}' is no longer used, but holds values you set, so it was kept.`,
            `  Delete it with: attach-noos delete ${name}`);
    }

    const created = report.linked.filter(link => link.created && !link.hidden);
    const hidden = report.linked.filter(link => link.hidden);

    if (created.length > 0 || hidden.length > 0 || report.filled.length > 0) {
        lines.push("", "Bootstrap filled in what leaves no room for choice:");
    }
    for (const link of created) {
        const at = `${link.node}.${link.property}${link.member === undefined ? "" : `.${link.member}`}`;
        lines.push(`  + ${link.target.padEnd(32)} (${link.symbol}) for ${at}`);
    }
    // Hidden nodes are named once each: several references can share one.
    for (const target of new Set(hidden.map(link => link.target))) {
        lines.push(`  ~ ${target.padEnd(32)} (from the board/driver, not stored)`);
    }
    for (const fill of report.filled) {
        const value = typeof fill.value === "number" ? format_number_in(fill.value, fill.format) : String(fill.value);
        lines.push(`  = ${`${fill.node}.${fill.property}`.padEnd(32)} ${value} (${fill.from})`);
    }

    for (const decision of report.chip_selects) {
        const chip_select = decision.chip_select;
        let how = "unresolved";
        if (chip_select.kind === "native") {
            how = `native line ${String(chip_select.native_cs)} of ${chip_select.peripheral}`;
        } else if (chip_select.kind === "gpio") {
            how = `GPIO ${chip_select.gpio.port} pin ${String(chip_select.gpio.number)} (${chip_select.at.connector} pin ${chip_select.at.pin})`;
        }
        lines.push("", `Chip-select for ${decision.device}: ${how}`);
    }

    for (const wiring of report.wiring) {
        const bus = wiring.peripheral === undefined ? wiring.interface.toUpperCase() : `${wiring.interface.toUpperCase()} (${wiring.peripheral})`;
        if (wiring.connections.length > 0) {
            lines.push("", `Wire ${wiring.part} to ${workfile.board ?? "the board"} over ${bus}:`);
            for (const connection of wiring.connections) {
                const from = `${connection.from.connector} pin ${connection.from.pin} (${connection.role})`;
                lines.push(`  ${from.padEnd(24)} -> ${connection.to.connector} pin ${connection.to.pin}`);
            }
        } else {
            lines.push("", `Wiring ${wiring.part} over ${bus}:`);
        }
        for (const problem of wiring.problems) {
            lines.push(`  ! ${problem}`);
        }
    }

    if (report.choices.length > 0) {
        lines.push("", "Bootstrap stopped at what is a choice - pick one each:");
        for (const choice of report.choices) {
            const at = `${choice.node}.${choice.property}${choice.member === undefined ? "" : `.${choice.member}`}`;
            const options = choice.options.length === 0 ? "nothing configured provides one" : choice.options.join(" | ");
            lines.push(`  ? ${at.padEnd(32)} ${options}`);
        }
        const [first] = report.choices;
        if (first !== undefined && first.options.length > 0) {
            const value = first.member === undefined ? first.options[0] : `${first.member} ${first.options[0]}`;
            lines.push(`  e.g. attach-noos update ${first.node} ${first.property} ${value}`);
        }
    }

    return lines;
}
