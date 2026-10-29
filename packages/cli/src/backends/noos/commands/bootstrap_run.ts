import { bootstrap, bootstrap_enabled, describe_board_pin, format_number_in, ok, validate_workfile } from "attach-no-os-lib";
import type { BootstrapReport, FilledValue, Property, Result, Workfile } from "attach-no-os-lib";
import { format_property_type } from "./shared";

/**
 * Run bootstrap after a command changed the workfile, when the `bootstrap` setting is on.
 * `referenced_before` is what was referenced before the change, so a node the change left
 * unused can be dropped. Undefined when the setting is off.
 */
export function run_bootstrap(workfile: Workfile, referenced_before?: Iterable<string>): Result<BootstrapReport | undefined> {
    if (!bootstrap_enabled()) {
        return ok();
    }
    return bootstrap(workfile, referenced_before === undefined ? {} : { referenced_before });
}

/** Free chip-select pins listed before the hint is cut short. */
const CHIP_SELECT_OPTIONS_SHOWN = 6;

/** A value as the schema writes it: a number in its format, anything else as JSON. */
function show(value: unknown, format: FilledValue["format"]): string {
    return typeof value === "number" ? format_number_in(value, format) : JSON.stringify(value);
}

/**
 * A board pin as a person finds it: its header position, and the chip pin name the board
 * prints next to it, when the pinout gives one (`J9 pin 5 (P2_0)`).
 */
function board_pin(board: string | undefined, at: { connector: string, pin: string }): string {
    const position = `${at.connector} pin ${at.pin}`;
    const described = board === undefined ? undefined : describe_board_pin(board, at);
    const mnemonic = described?.ok === true ? described.value.pin.mnemonic : undefined;
    return mnemonic === undefined || mnemonic === at.pin ? position : `${position} (${mnemonic})`;
}

/** A required value still empty, which bootstrap had nothing to fill it from. */
export interface StillNeeded {
    node: string,
    property: Property,
    /** The validator's reason, when a rule says more than "required". */
    reason?: string,
}

/**
 * Every required value still empty that is not already a choice: bootstrap has nothing to
 * go on for it (a channel number, a part with no eval board's chip-select), so it is the
 * user's to set. Read from validation, so it is the same list `validate` gives.
 */
export function still_needed(report: BootstrapReport, workfile: Workfile): StillNeeded[] {
    const offered = new Set(report.choices.map(choice => `${choice.node}.${choice.property}`));
    const found = new Map<string, StillNeeded>();
    for (const finding of validate_workfile(workfile).errors) {
        const [node = "", name = ""] = finding.path.split(".");
        const at = `${node}.${name}`;
        if (finding.severity !== "error" || name === "" || offered.has(at) || found.has(at)) {
            continue;
        }
        const ruleset = workfile.symbols[node];
        const property = ruleset?._t === "RulesetStruct" || ruleset?._t === "RulesetDescriptor"
            ? ruleset.properties.find(candidate => candidate.name === name)
            : undefined;
        // Only an empty value: an error on a value that is set is a wrong value, not a missing one.
        if (property === undefined || (property.value !== undefined && property.value !== null && property.cleared !== true)) {
            continue;
        }
        const reason = finding.message.startsWith("Required property has no value") ? undefined : finding.message;
        found.set(at, { node, property, ...(reason === undefined ? {} : { reason }) });
    }
    return [...found.values()];
}

/** What bootstrap did, for a person: the nodes it made, the values it chose, the wiring, and where it stopped. */
export function describe_bootstrap(report: BootstrapReport, workfile: Workfile, program: string): string[] {
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
            `  Delete it with: ${program} delete ${name}`);
    }

    const created = report.linked.filter(link => link.created && !link.hidden);
    const hidden = report.linked.filter(link => link.hidden);
    // A node already in the workfile, now named somewhere new: the connection is the news.
    const connected = report.linked.filter(link => !link.created && !link.hidden);

    if (created.length > 0 || hidden.length > 0 || connected.length > 0 || report.filled.length > 0) {
        lines.push("", "Bootstrap filled in defaults, values with only one option, and the nodes they need:");
    }
    for (const link of created) {
        const at = `${link.node}.${link.property}${link.member === undefined ? "" : `.${link.member}`}`;
        lines.push(`  + ${link.target.padEnd(32)} (${link.symbol}) for ${at}`);
    }
    for (const link of connected) {
        const at = `${link.node}.${link.property}${link.member === undefined ? "" : `.${link.member}`}`;
        lines.push(`  > ${at.padEnd(32)} ${link.target} (already in the workfile)`);
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
            how = `GPIO ${chip_select.gpio.port} pin ${String(chip_select.gpio.number)}, at ${board_pin(workfile.board, chip_select.at)}`;
        }
        lines.push("", `Chip-select for ${decision.device}: ${how}`);
    }

    for (const wiring of report.wiring) {
        const bus = wiring.peripheral === undefined ? wiring.interface.toUpperCase() : `${wiring.interface.toUpperCase()} (${wiring.peripheral})`;
        if (wiring.connections.length > 0) {
            lines.push("", `Wire ${wiring.part} to ${workfile.board ?? "the board"} over ${bus}:`);
            for (const connection of wiring.connections) {
                const from = `${connection.from.connector} pin ${connection.from.pin} (${connection.role})`;
                lines.push(`  ${from.padEnd(24)} -> ${board_pin(workfile.board, connection.to)}`);
            }
        } else {
            lines.push("", `Wiring ${wiring.part} over ${bus}:`);
        }
        for (const problem of wiring.problems) {
            lines.push(`  ! ${problem}`);
        }
        // A bare part: which board pins its bus is on, for the part's own pins to go to.
        const board_pins = wiring.board_pins ?? [];
        if (board_pins.length > 0) {
            lines.push(`  Its bus is on: ${board_pins.map(pin => `${pin.signal.toUpperCase()} ${board_pin(workfile.board, pin.at)}`).join(", ")}`);
        }
        const options = wiring.chip_select_options ?? [];
        if (options.length > 0) {
            const shown = options.slice(0, CHIP_SELECT_OPTIONS_SHOWN).map(option =>
                `${board_pin(workfile.board, option.at)}${option.gpio === undefined ? "" : ` = ${option.gpio.port} ${String(option.gpio.number)}`}`);
            const more = options.length > shown.length ? `, and ${String(options.length - shown.length)} more` : "";
            lines.push(
                `  Free pins for its chip-select: ${shown.join(", ")}${more}`,
                `  To use one: add a pin node, set its port_handle and number, and point ${wiring.device}.cs_gpio at it.`,
            );
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
            lines.push(`  e.g. ${program} update ${first.node} ${first.property} ${value}`);
        }
    }

    const needed = still_needed(report, workfile);
    if (needed.length > 0) {
        lines.push("", "Still yours to set - required, and nothing to fill them from:");
        for (const { node, property, reason } of needed) {
            const at = `${node}.${property.name}`;
            const about = reason ?? (property.description.trim() === "" ? "no description" : property.description.trim());
            const cleared = property.cleared === true ? " (you cleared it)" : "";
            lines.push(`  ! ${at.padEnd(32)} ${format_property_type(property._t).padEnd(8)} ${about}${cleared}`);
        }
        const [first] = needed;
        if (first !== undefined) {
            lines.push(`  e.g. ${program} update ${first.node} ${first.property.name} <value>   ('${program} read ${first.node} ${first.property.name}' says more)`);
        }
    }

    return lines;
}
