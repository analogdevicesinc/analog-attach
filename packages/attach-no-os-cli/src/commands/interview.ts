import { styleText } from "node:util";
import { input, select } from "@inquirer/prompts";
import { set_value, suggest_for_property } from "attach-no-os-lib";
import type { BootstrapReport, OpenChoice, Property, Workfile } from "attach-no-os-lib";
import { ELEMENT_SEPARATOR, parse_property_value } from "../protocol/convert";
import { run_bootstrap, still_needed, type StillNeeded } from "./bootstrap_run";
import { format_property_type, save_workfile, type WorkfileContext } from "./shared";

/**
 * The interview: what bootstrap cannot decide, asked on a terminal after `add`.
 *
 * It asks one thing at a time - a choice bootstrap stopped at, then a required value
 * nothing could fill - and runs bootstrap again after each answer, since one answer can
 * settle others (picking the controller settles the chip-select too). An answer goes
 * through the same parser and the same set_value as `update`, so it is the user's value
 * from then on, and the workfile is saved after each one: stopping (Ctrl+C) keeps what was
 * answered. Anything can be skipped; what is left is reported as before.
 */

/** How a question is put: on the terminal, or by a test. */
export interface Asker {
    select(message: string, choices: { name: string, value: string }[]): Promise<string>;
    input(message: string, validate: (value: string) => true | string): Promise<string>;
}

export const terminal_asker: Asker = {
    select: (message, choices) => select({ message, choices, pageSize: 12 }),
    input: (message, validate) => input({ message, validate }),
};

export interface InterviewResult {
    answered: number;
    skipped: number;
    /** Stopped with Ctrl+C; what was answered is saved. */
    stopped: boolean;
}

type Item =
    | { kind: "choice", choice: OpenChoice }
    | { kind: "value", needed: StillNeeded };

const SKIP = "\u0000skip";
const TYPE = "\u0000type";
/** A bound on the rounds, against a value that keeps coming back however it is answered. */
const MOST_ROUNDS = 200;

function key_of(item: Item): string {
    return item.kind === "choice"
        ? `${item.choice.node}.${item.choice.property}${item.choice.member === undefined ? "" : `.${item.choice.member}`}`
        : `${item.needed.node}.${item.needed.property.name}`;
}

const NO_REPORT: BootstrapReport = { revised: [], filled: [], linked: [], chip_selects: [], wiring: [], choices: [], deleted: [], dangling: [] };

/** What is still open: bootstrap's choices first, then the values left to the user. */
function open_items(workfile: Workfile): Item[] {
    const ran = run_bootstrap(workfile);
    const report = ran.ok && ran.value !== undefined ? ran.value : NO_REPORT;
    return [
        ...report.choices.filter(choice => choice.options.length > 0).map(choice => ({ kind: "choice", choice }) as Item),
        ...still_needed(report, workfile).map(needed => ({ kind: "value", needed }) as Item),
    ];
}

function property_of(workfile: Workfile, node: string, name: string): Property | undefined {
    const ruleset = workfile.symbols[node];
    return ruleset?._t === "RulesetStruct" || ruleset?._t === "RulesetDescriptor"
        ? ruleset.properties.find(candidate => candidate.name === name)
        : undefined;
}

/** Set one answer the way `update` does: parsed against the property, owned by the user. */
function apply(workfile: Workfile, node: string, name: string, raw: string): string | undefined {
    const property = property_of(workfile, node, name);
    if (property === undefined) {
        return `'${node}' has no property '${name}'`;
    }
    const parsed = parse_property_value(raw, property);
    if (!parsed.ok) {
        return parsed.error.message;
    }
    const set = set_value(workfile, node, name, parsed.value);
    return set.ok ? undefined : set.error.message;
}

async function ask_value(ask: Asker, workfile: Workfile, needed: StillNeeded): Promise<string | undefined> {
    const { node, property } = needed;
    const about = needed.reason ?? (property.description.trim() || "required");
    const message = `${node}.${property.name} (${format_property_type(property._t)}): ${about}`;
    const validate = (value: string): true | string => {
        if (value.trim() === "") {
            return true;
        }
        const parsed = parse_property_value(value.trim(), property);
        return parsed.ok ? true : parsed.error.message;
    };

    const suggested = suggest_for_property(workfile, node, property.name);
    const values = suggested.ok ? suggested.value.values ?? [] : [];
    if (values.length > 0) {
        const picked = await ask.select(message, [
            ...values.map(value => ({ name: value, value })),
            { name: "Type a value…", value: TYPE },
            { name: "Skip for now", value: SKIP },
        ]);
        if (picked === SKIP) {
            return undefined;
        }
        if (picked !== TYPE) {
            return picked;
        }
    }
    const typed = await ask.input(`${message} (empty to skip)`, validate);
    return typed.trim() === "" ? undefined : typed.trim();
}

export async function run_interview(context: WorkfileContext, ask: Asker = terminal_asker): Promise<InterviewResult> {
    const workfile = context.workfile;
    const skipped = new Set<string>();
    let answered = 0;

    const first = open_items(workfile);
    if (first.length === 0) {
        return { answered: 0, skipped: 0, stopped: false };
    }
    console.log(`\n${styleText("bold", "A few things only you can tell")} ${styleText("dim", "(Ctrl+C stops; what is answered is kept)")}`);

    try {
        for (let round = 0; round < MOST_ROUNDS; round++) {
            const item = open_items(workfile).find(candidate => !skipped.has(key_of(candidate)));
            if (item === undefined) {
                break;
            }
            const key = key_of(item);

            let node: string;
            let name: string;
            let raw: string | undefined;
            if (item.kind === "choice") {
                ({ node, property: name } = item.choice);
                const picked = await ask.select(`${key}: pick one`, [
                    ...item.choice.options.map(option => ({ name: option, value: option })),
                    { name: "Skip for now", value: SKIP },
                ]);
                raw = picked === SKIP ? undefined
                    : (item.choice.member === undefined ? picked : `${item.choice.member}${ELEMENT_SEPARATOR}${picked}`);
            } else {
                ({ node } = item.needed);
                name = item.needed.property.name;
                raw = await ask_value(ask, workfile, item.needed);
            }

            if (raw === undefined) {
                skipped.add(key);
                continue;
            }
            const failed = apply(workfile, node, name, raw);
            if (failed !== undefined) {
                console.log(styleText("red", `  ${key}: ${failed}`));
                skipped.add(key);
                continue;
            }
            answered++;
            const saved = save_workfile(context);
            console.log(saved.ok ? `${styleText("green", "✓")} ${key} = ${raw}` : styleText("red", `  ${saved.error.message}`));
        }
    } catch (error) {
        if (error instanceof Error && error.name === "ExitPromptError") {
            save_workfile(context);
            return { answered, skipped: skipped.size, stopped: true };
        }
        throw error;
    }

    // The last answer's consequences, saved: bootstrap ran on it in the final round.
    save_workfile(context);
    return { answered, skipped: skipped.size, stopped: false };
}
