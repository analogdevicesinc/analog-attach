import path from "node:path";
import {
    IIO_TEMPLATE_SET,
    add_symbol,
    attach_eval_board,
    driver_iio_root,
    driver_root,
    driver_root_for,
    find_eval_board_module,
    get_effective_setting_value,
    interview_enabled,
    list_available_structs,
    list_drivers,
    load_resolved_ruleset_for_board,
    pin_driver,
    suggest_for_property,
    validate_workfile,
} from "attach-no-os-lib";
import type { BootstrapReport, LinkedReference, Workfile } from "attach-no-os-lib";
import {
    answer,
    command,
    input_error,
    refuse,
    type AddArguments,
    type FlagSpecs,
    type InteractiveSession,
    type Outcome,
    type Session,
} from "../../../interface/backend-interface";
import { common_ok, type AddResponse, type MissingProperty } from "../protocol/responses";
import { describe_bootstrap, run_bootstrap, still_needed } from "./bootstrap_run";
import { run_interview } from "./interview";
import { load_context, save_workfile, type WorkfileContext } from "./shared";

const ADD_FLAGS = {
    as: {
        kind: "values",
        brief: "For a driver with several interfaces (ad74413r: adc, dac): which to add, comma-separated or repeated for several on one chip",
        placeholder: "interface",
    },
} as const satisfies FlagSpecs;

/**
 * `add <schema> [--name <node>]`: create a node.
 *
 * A node is an instance of a schema, and nothing but the caller knows which schema was
 * meant, so `--name` on its own is refused with a pointer at `list devices` rather than
 * guessed at. The workfile is flat, so there is no parent to name: every node is at the root.
 *
 * The key may also be a DRIVER name (`add adxl355`). That adds the driver's root - the
 * generic handle it is reached through (a capi_accel_sensor) - named after the driver, and
 * the `bootstrap` setting (on by default) then builds everything below it that leaves no
 * room for choice.
 */
export const add = command<AddArguments, AddResponse, typeof ADD_FLAGS>({
    flags: ADD_FLAGS,
    docs: {
        brief: "Add a node to the workfile",
        full:
            "Creates a node from a schema. <schema> is the device key (see 'list devices');\n" +
            "--name is what the node is called in the workfile,\n" +
            "defaulting to its kind, numbered (capi_gpio_pin: gpio0, gpio1). <schema> can also be\n" +
            "a driver name (adxl355), which adds the handle the part is used through.\n" +
            "With the 'bootstrap' setting on (the default), everything below the new node that\n" +
            "leaves no room for choice is then filled in, and what is left is shown. With the\n" +
            "'interview' setting on (the default), on a terminal, what is left is then asked for;\n" +
            "--quiet lists it instead.",
        placeholders: { device: "schema" },
    },
    run(arguments_, flags, session) {
        return run_add(arguments_, flags.as ?? [], session);
    }
});

async function run_add(arguments_: AddArguments, as: readonly string[], session: Session): Promise<Outcome<AddResponse>> {
    const { device: key, name: requested } = arguments_;
    const { program } = session;
    if (key === undefined) {
        return input_error(
            requested === undefined
                ? `Nothing to add: pass <schema> (see: ${program} list devices)`
                : `Cannot add '${requested}' without a schema: a node is an instance of a schema, ` +
                  `and there is no default schema. See: ${program} list devices`
        );
    }

    const context = load_context(session);
    if (!context.ok) {
        return refuse(context.error.message);
    }

    const available = list_available_structs(context.value.workfile);
    if (!available.ok) {
        return refuse(available.error.message);
    }

    // A schema wins over a driver of the same name; a driver is only the shorthand.
    let schema = key;
    let default_node_name = default_name(key);
    // What `add` was given a name of: a driver, or an eval board carrying one.
    let driver = key;
    let eval_board: string | undefined;
    const interfaces = as.flatMap(entry => entry.split(",")).map(entry => entry.trim()).filter(entry => entry !== "");
    if (interfaces.length > 0 && available.value.all.includes(key)) {
        return input_error(`--as picks a driver's interface, and '${key}' is a schema, not a driver`);
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
            return refuse(`Unknown schema '${key}'. See: ${program} list devices`);
        }
        // Served over IIO (template capi-iio): the driver's IIO device is the root,
        // and it inits the part itself, so the generic handle is not added at all.
        const template_set = get_effective_setting_value("project-template");
        const iio = template_set.ok && template_set.value === IIO_TEMPLATE_SET;
        const [first_interface] = interfaces;
        let root;
        if (iio) {
            root = driver_iio_root(driver);
        } else {
            root = first_interface === undefined ? driver_root(driver) : driver_root_for(driver, first_interface);
        }
        if (!root.ok) {
            return refuse(root.error.message);
        }
        schema = root.value;
        // Named after the side too when one is picked, so ADC and DAC never collide.
        default_node_name = first_interface === undefined ? driver : `${driver}_${first_interface}`;
    }

    // A schema added by itself is one more of its kind: numbered, not named after its type
    // (`add capi_gpio_pin` gives gpio0, then gpio1), so the C never reads
    // `struct capi_gpio_pin capi_gpio_pin`. Drivers and eval boards keep their own names.
    const name = requested ?? (available.value.all.includes(key)
        ? numbered_name(short_name(default_node_name), context.value)
        : unique_name(default_node_name, context.value));
    if (context.value.workfile.symbols[name] !== undefined) {
        return refuse(`'${name}' already exists. Pass --name to choose another name.`);
    }

    // The board is passed because `key` may name one of its own peripherals, which are
    // scoped to the selected board rather than globally unique.
    const ruleset = load_resolved_ruleset_for_board(schema, context.value.workfile.board);
    if (!ruleset.ok) {
        return refuse(ruleset.error.message);
    }

    const changed = add_symbol(context.value.workfile, name, ruleset.value);
    if (!changed.ok) {
        return refuse(changed.error.message);
    }

    context.value.workfile = changed.value;

    // Named by its driver: say which part it is now, so nothing below it is guessed.
    const pinned_links: LinkedReference[] = [];
    if (schema !== key) {
        const pinned = pin_driver(context.value.workfile, name, driver);
        if (!pinned.ok) {
            return refuse(pinned.error.message);
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
            return refuse(side.error.message);
        }
        const side_name = unique_name(`${driver}_${interface_}`, context.value);
        const side_ruleset = load_resolved_ruleset_for_board(side.value, context.value.workfile.board);
        if (!side_ruleset.ok) {
            return refuse(side_ruleset.error.message);
        }
        const side_added = add_symbol(context.value.workfile, side_name, side_ruleset.value);
        if (!side_added.ok) {
            return refuse(side_added.error.message);
        }
        const side_pinned = pin_driver(context.value.workfile, side_name, driver, chip);
        if (!side_pinned.ok) {
            return refuse(side_pinned.error.message);
        }
        pinned_links.push(...side_pinned.value);
        sides.push(side_name);
    }

    // On an eval board: its node carries the part, and its pinout is what wires it.
    let eval_node: string | undefined;
    if (eval_board !== undefined) {
        const attached = attach_eval_board(context.value.workfile, eval_board, name);
        if (!attached.ok) {
            return refuse(attached.error.message);
        }
        eval_node = attached.value;
    }

    const ran = run_bootstrap(context.value.workfile);
    if (!ran.ok) {
        return refuse(`Added '${name}', but bootstrap failed: ${ran.error.message}`);
    }
    // What add itself linked comes first: it is what the rest was built on.
    const report = ran.value === undefined ? undefined : { ...ran.value, linked: [...pinned_links, ...ran.value.linked] };

    const saved = save_workfile(context.value);
    if (!saved.ok) {
        return refuse(saved.error.message);
    }

    const validation = validate_workfile(context.value.workfile);
    const errors = validation.errors.filter(entry => entry.severity === "error").length;
    const left = `${String(errors)} problem${errors === 1 ? "" : "s"} left`;

    const what = schema === key ? key : `${schema}, for driver ${driver}`;
    const created = report === undefined ? 0 : report.linked.filter(link => link.created && !link.hidden).length;
    const message = report === undefined
        ? `Added '${name}' (${what})`
        : `Added '${name}' (${what}) and ${String(created)} node${created === 1 ? "" : "s"} below it; ` +
          (validation.valid ? "the workfile is valid" : `${left} - run: ${program} validate`);

    // Built now, before an interview changes the workfile: it is the state the message describes.
    const made = new Set([name, ...sides, ...(eval_node === undefined ? [] : [eval_node]), ...(report?.linked ?? []).filter(link => link.created).map(link => link.target)]);
    const missing = report === undefined ? [] : missing_required(report, context.value.workfile).filter(entry => made.has(entry.node));
    const response = (): AddResponse => ({
        ...common_ok(message),
        key,
        path: [name],
        missing_required: missing,
    });

    const lines = [
        `Added '${name}' (${what})`,
        ...sides.map(side => `Added '${side}' on the same chip`),
        ...(eval_node === undefined ? [] : [`On eval board '${eval_node}' (${eval_board ?? ""})`]),
        `  ${context.value.path}`,
        ...(report === undefined ? [] : describe_bootstrap(report, context.value.workfile, program)),
        "",
        validation.valid ? "The workfile is valid." : `${left}. Run: ${program} validate`,
    ];

    // On a terminal, ask for what is left rather than only listing it. Never in --json or
    // a pipe: a script or a tool sets those values with update.
    if (session.prompter === undefined || !interview_enabled()) {
        return answer(response, lines.join("\n"));
    }
    const interactive: InteractiveSession = { ...session, prompter: session.prompter };
    for (const line of lines) {
        session.say(line);
    }
    const asked = await run_interview(context.value, interactive);
    if (asked.answered === 0 && !asked.stopped) {
        return answer(response, "");
    }
    const after = validate_workfile(context.value.workfile);
    const remaining = after.errors.filter(entry => entry.severity === "error").length;
    const status = after.valid
        ? "The workfile is valid."
        : `${String(remaining)} problem${remaining === 1 ? "" : "s"} left. Run: ${program} validate`;
    return answer(response, `\n${asked.stopped ? "Stopped. " : ""}${status}`);
}

/**
 * What the workfile still needs, in the order to set them (`add` keeps what is on the nodes it made):
 * the choices bootstrap stopped at, with their options, then the required values nothing
 * could fill, with what the property suggests. The list `add` prints under "Still yours to set".
 */
function missing_required(report: BootstrapReport, workfile: Workfile): MissingProperty[] {
    const description_of = (node: string, name: string): string | undefined => {
        const ruleset = workfile.symbols[node];
        const property = ruleset?._t === "RulesetStruct" || ruleset?._t === "RulesetDescriptor"
            ? ruleset.properties.find(candidate => candidate.name === name)
            : undefined;
        const text = property?.description.trim() ?? "";
        return text === "" ? undefined : text;
    };
    const choices = report.choices.map(choice => {
        const description = description_of(choice.node, choice.property);
        return {
            node: choice.node,
            property: choice.member === undefined ? choice.property : `${choice.property}.${choice.member}`,
            ...(description === undefined ? {} : { description }),
            suggestions: choice.options.map(value => ({ value: choice.member === undefined ? value : `${choice.member} ${value}` })),
        };
    });
    const values = still_needed(report, workfile).map(({ node, property, reason }) => {
        const description = reason ?? description_of(node, property.name);
        const suggested = suggest_for_property(workfile, node, property.name);
        return {
            node,
            property: property.name,
            ...(description === undefined ? {} : { description }),
            suggestions: (suggested.ok ? suggested.value.values ?? [] : []).map(value => ({ value })),
        };
    });
    return [...choices, ...values];
}

/** The driver init_param a root's config points at: the chip it describes. */
function chip_of(workfile: Workfile, root: string): string | undefined {
    const node = workfile.symbols[root];
    const config_name = node?._t === "RulesetDescriptor" ? node.properties[0]?.value : undefined;
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

/** A schema's name, shortened as an instance of it: `capi_gpio_pin` -> `gpio`, `capi_dac_chan` -> `dac_chan`. */
function short_name(schema: string): string {
    return schema.replace(/^capi_/, "").replace(/_pin$/, "") || schema;
}

/** `base` with the lowest free number from 0: gpio0, gpio1, ...; ad7124_0 when `base` ends in a digit. */
function numbered_name(base: string, context: WorkfileContext): string {
    const separator = /\d$/.test(base) ? "_" : "";
    for (let index = 0; ; index++) {
        const candidate = `${base}${separator}${index}`;
        if (!context.workfile.symbols[candidate]) {
            return candidate;
        }
    }
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
