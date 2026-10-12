import path from "node:path";
import { buildCommand } from "@stricli/core";
import {
    IIO_TEMPLATE_SET,
    add_symbol,
    attach_eval_board,
    driver_iio_root,
    driver_root,
    driver_root_for,
    find_eval_board_module,
    get_effective_setting_value,
    list_available_structs,
    list_drivers,
    load_resolved_ruleset_for_board,
    pin_driver,
    validate_workfile,
} from "attach-no-os-lib";
import type { LinkedReference, Workfile } from "attach-no-os-lib";
import { filter_completions, get_node_names, get_schema_paths } from "../completion/completion";
import { common_ok, type AddResponse } from "../protocol/responses";
import { describe_bootstrap, run_bootstrap } from "./bootstrap_run";
import { load_context, output, output_error, root_key, save_workfile, type WorkfileContext } from "./shared";

type AddFlags = {
    as?: string;
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
            as: {
                kind: "parsed",
                brief: "For a driver with several interfaces (ad74413r: adc, dac): which to add, comma-separated for several on one chip",
                optional: true,
                parse: String
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
        // What `add` was given a name of: a driver, or an eval board carrying one.
        let driver = key;
        let eval_board: string | undefined;
        const interfaces = (flags.as ?? "").split(",").map(entry => entry.trim()).filter(entry => entry !== "");
        if (interfaces.length > 0 && available.value.all.includes(key)) {
            output_error(flags, `--as picks a driver's interface, and '${key}' is a schema, not a driver`);
            return;
        }
        if (!available.value.all.includes(key)) {
            const drivers = list_drivers();
            // An eval board is added through the driver it carries, then attached to it.
            const eval_module = find_eval_board_module(key);
            if (eval_module?.implements_driver !== undefined) {
                eval_board = key;
                driver = eval_module.implements_driver;
            }
            const is_driver = drivers.ok && drivers.value.some(candidate => candidate.name === driver);
            if (!is_driver) {
                output_error(flags, `Unknown schema '${key}'. See: attach-noos list-devices`);
                return;
            }
            // Served over IIO (template_set capi-iio): the driver's IIO device is the root,
            // and it inits the part itself, so the generic handle is not added at all.
            const template_set = get_effective_setting_value("template_set");
            const iio = template_set.ok && template_set.value === IIO_TEMPLATE_SET;
            const [first_interface] = interfaces;
            const root = iio
                ? driver_iio_root(driver)
                : (first_interface === undefined ? driver_root(driver) : driver_root_for(driver, first_interface));
            if (!root.ok) {
                output_error(flags, root.error.message);
                return;
            }
            schema = root.value;
            // Named after the side too when one is picked, so ADC and DAC never collide.
            default_node_name = first_interface === undefined ? driver : `${driver}_${first_interface}`;
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

        // Named by its driver: say which part it is now, so nothing below it is guessed.
        const pinned_links: LinkedReference[] = [];
        if (schema !== key) {
            const pinned = pin_driver(context.value.workfile, name, driver);
            if (!pinned.ok) {
                output_error(flags, pinned.error.message);
                return;
            }
            pinned_links.push(...pinned.value);
        }

        // The other sides asked for (`--as adc,dac`): more handles on the same chip, sharing
        // its init_param rather than describing a second part.
        const chip = chip_of(context.value.workfile, name);
        const sides: string[] = [];
        for (const interface_ of interfaces.slice(1)) {
            const side = driver_root_for(driver, interface_);
            if (!side.ok) {
                output_error(flags, side.error.message);
                return;
            }
            const side_name = unique_name(`${driver}_${interface_}`, context.value);
            const side_ruleset = load_resolved_ruleset_for_board(side.value, context.value.workfile.board);
            if (!side_ruleset.ok) {
                output_error(flags, side_ruleset.error.message);
                return;
            }
            const side_added = add_symbol(context.value.workfile, side_name, side_ruleset.value);
            if (!side_added.ok) {
                output_error(flags, side_added.error.message);
                return;
            }
            const side_pinned = pin_driver(context.value.workfile, side_name, driver, chip);
            if (!side_pinned.ok) {
                output_error(flags, side_pinned.error.message);
                return;
            }
            pinned_links.push(...side_pinned.value);
            sides.push(side_name);
        }

        // On an eval board: its node carries the part, and its pinout is what wires it.
        let eval_node: string | undefined;
        if (eval_board !== undefined) {
            const attached = attach_eval_board(context.value.workfile, eval_board, name);
            if (!attached.ok) {
                output_error(flags, attached.error.message);
                return;
            }
            eval_node = attached.value;
        }

        const ran = run_bootstrap(context.value.workfile);
        if (!ran.ok) {
            output_error(flags, `Added '${name}', but bootstrap failed: ${ran.error.message}`);
            return;
        }
        // What add itself linked comes first: it is what the rest was built on.
        const report = ran.value === undefined ? undefined : { ...ran.value, linked: [...pinned_links, ...ran.value.linked] };

        const saved = save_workfile(context.value);
        if (!saved.ok) {
            output_error(flags, saved.error.message);
            return;
        }

        const validation = validate_workfile(context.value.workfile);
        const errors = validation.errors.filter(entry => entry.severity === "error").length;
        const left = `${String(errors)} problem${errors === 1 ? "" : "s"} left`;

        const what = schema === key ? key : `${schema}, for driver ${driver}`;
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
            ...sides.map(side => `Added '${side}' on the same chip`),
            ...(eval_node === undefined ? [] : [`On eval board '${eval_node}' (${eval_board ?? ""})`]),
            `  ${context.value.path}`,
            ...(report === undefined ? [] : describe_bootstrap(report, context.value.workfile)),
            "",
            validation.valid ? "The workfile is valid." : `${left}. Run: attach-noos validate`,
        ];
        output(flags, text.join("\n"), response);
    }
});

/** The driver init_param a root's config points at: the chip it describes. */
function chip_of(workfile: Workfile, root: string): string | undefined {
    const node = workfile.symbols[root];
    const config_name = node?._t === "RulesetDescriptor" ? node.properties[0].value : undefined;
    const config = typeof config_name === "string" ? workfile.symbols[config_name] : undefined;
    const field = config?._t === "RulesetStruct"
        ? config.properties.find(property => property._t === "DriverInitParameterProperty" && typeof property.value === "string")
        : undefined;
    return typeof field?.value === "string" ? field.value : undefined;
}

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
