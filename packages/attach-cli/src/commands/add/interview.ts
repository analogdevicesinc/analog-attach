import * as readline from "node:readline";

import type { Suggestion } from "../../protocol/types";

/** One value of a question asked on its own line: a cell of a fixed-size array, or a pick from a list. */
export interface Entry {
    /** What a value typed out is, shown in the prompt of an entry of several. */
    kind?: "number" | "string";
    /** A closed list (an enum, the nodes a phandle can name): numbered from 1, answered by its number or the value. */
    options?: Suggestion[];
    /** Several picks on one line, for an enum list of any length. */
    several?: boolean;
    /** What Enter takes: one of `options` when there are. */
    default?: string;
}

export interface Question {
    property: string;
    /** The lines under the property name: description, allowed values, suggestions. */
    details: string[];
    suggestions: Suggestion[];
    /** Ask entry by entry instead of the whole value on one line. */
    entries?: Entry[];
}

export type Answer =
    | { kind: "value"; tokens: string[] }
    | { kind: "skip" }
    | { kind: "stop" }
    | { kind: "again"; message: string };

const tokens_of = (value: string): string[] => value.split(/\s+/).filter(Boolean);
const bare = (value: string): string => value.replace(/^&/, "");

/** Enter takes the first suggestion, "-" skips, the end of input (Ctrl-D) stops. */
export function interpret_answer(line: string | undefined, suggestions: Suggestion[]): Answer {
    if (line === undefined) { return { kind: "stop" }; }
    const answer = line.trim();
    if (answer === "-") { return { kind: "skip" }; }
    const value = answer === "" ? suggestions[0]?.value : answer;
    if (value === undefined) { return { kind: "again", message: "No suggestion to take: type a value, or - to skip" }; }
    return { kind: "value", tokens: tokens_of(value) };
}

/** The option a word picks: a number counts from 1, anything else is the value typed out (a label with or without &). */
function pick_option(word: string, options: Suggestion[]): string | undefined {
    if (/^\d+$/.test(word)) { return options[Number(word) - 1]?.value; }
    return options.find(o => bare(o.value) === bare(word))?.value;
}

/** An answer to one entry: Enter takes its default, a number picks from its options, "-" skips the property. */
export function interpret_entry(line: string | undefined, entry: Entry): Answer {
    if (line === undefined) { return { kind: "stop" }; }
    const answer = line.trim();
    if (answer === "-") { return { kind: "skip" }; }
    const { options } = entry;
    const range = options === undefined ? "" : `pick 1 to ${options.length}`;
    if (answer === "") {
        if (entry.default !== undefined) { return { kind: "value", tokens: tokens_of(entry.default) }; }
        return { kind: "again", message: `No default: ${options === undefined ? "type a value" : range}, or - to skip` };
    }
    const words = tokens_of(answer);
    if (options === undefined) {
        return words.length === 1 ? { kind: "value", tokens: words } : { kind: "again", message: "One value per line" };
    }
    if (words.length > 1 && entry.several !== true) { return { kind: "again", message: `One pick: ${range}` }; }
    const picked = words.map(word => pick_option(word, options));
    if (picked.includes(undefined)) { return { kind: "again", message: `Not an option: ${range}, or type one of the values` }; }
    return { kind: "value", tokens: picked.flatMap(value => tokens_of(value ?? "")) };
}

/** The options numbered from 1, with what each one is when the display says more than the value. */
export function option_lines(options: Suggestion[]): string[] {
    const width = String(options.length).length;
    return options.map(({ value, display_string: display = value }, index) =>
        `  ${String(index + 1).padStart(width)}) ${display.startsWith(value) ? display : `${value}  ${display}`}`);
}

/** `interrupts 2/2 [3]: `: the entry's place when there are several, what it is, and what Enter takes (an option by its number). */
export function entry_prompt(property: string, entry: Entry, index: number, count: number): string {
    const place = count === 1 ? property : `${property} ${index + 1}/${count}`;
    const kind = count > 1 && entry.kind !== undefined ? ` (${entry.kind})` : "";
    const position = entry.default === undefined ? -1 : (entry.options?.findIndex(o => o.value === entry.default) ?? -1);
    const fallback = position === -1 ? entry.default : String(position + 1);
    return `${place}${kind}${fallback === undefined ? "" : ` [${fallback}]`}: `;
}

export interface InterviewSteps {
    /** What to show for a property. Asked right before the question, so earlier answers count. */
    ask(property: string): Promise<Question>;
    /** Write the answer; a failure re-asks the same question. */
    apply(property: string, tokens: string[]): Promise<{ ok: boolean; lines: string[] }>;
}

export interface InterviewIO {
    input: NodeJS.ReadableStream;
    output: NodeJS.WritableStream;
    /** A real terminal echoes the answers itself and gets tab completion. */
    terminal: boolean;
}

export interface InterviewResult {
    set: string[];
    skipped: string[];
    stopped: boolean;
}

/** Ask for each missing property in turn and apply the answers. */
export async function run_interview(missing: string[], steps: InterviewSteps, io: InterviewIO): Promise<InterviewResult> {
    const result: InterviewResult = { set: [], skipped: [], stopped: false };
    if (missing.length === 0) { return result; }

    let completions: string[] = [];
    const rl = readline.createInterface({
        input: io.input,
        output: io.output,
        terminal: io.terminal,
        completer: (line: string): [string[], string] => [completions.filter(c => c.startsWith(line)), line],
    });
    // Ctrl-C ends the interview like Ctrl-D.
    rl.on("SIGINT", () => { rl.close(); });
    const reader = line_reader(rl);
    const write = (text: string): void => { io.output.write(text); };
    const read_line = async (prompt: string): Promise<string | undefined> => {
        // Piped answers can outlive the input stream: readline is closed but lines are still queued.
        if (reader.closed()) { write(prompt); } else { rl.setPrompt(prompt); rl.prompt(); }
        const line = await reader.next();
        // A terminal echoes what was typed; piped input doesn't.
        if (!io.terminal && line !== undefined) { write(`${line}\n`); }
        return line;
    };
    /** Each entry on its own line; a wrong answer asks that entry again. */
    const ask_entries = async (property: string, entries: Entry[]): Promise<Answer> => {
        const tokens: string[] = [];
        for (const [index, entry] of entries.entries()) {
            completions = entry.options?.map(o => o.value) ?? [];
            if (entry.options !== undefined) { for (const line of option_lines(entry.options)) { write(`${line}\n`); } }
            for (;;) {
                const answer = interpret_entry(await read_line(entry_prompt(property, entry, index, entries.length)), entry);
                if (answer.kind === "again") { write(`${answer.message}\n`); continue; }
                if (answer.kind !== "value") { return answer; }
                tokens.push(...answer.tokens);
                break;
            }
        }
        return { kind: "value", tokens };
    };

    const count = missing.length === 1 ? "1 required property" : `${missing.length} required properties`;
    write(`${count} to set (Enter takes the first suggestion, a number picks an option, - skips, Ctrl-D stops)\n`);
    try {
        for (const [index, property] of missing.entries()) {
            for (;;) {
                const question = await steps.ask(property);
                completions = question.suggestions.map(s => s.value);
                write(`\n[${index + 1}/${missing.length}] ${property}\n`);
                for (const line of question.details) { write(`${line}\n`); }
                let answer: Answer;
                if (question.entries === undefined) {
                    const first = question.suggestions[0]?.value;
                    answer = interpret_answer(await read_line(first === undefined ? `${property}: ` : `${property} [${first}]: `), question.suggestions);
                } else {
                    answer = await ask_entries(property, question.entries);
                }
                if (answer.kind === "stop") {
                    if (io.terminal) { write("\n"); }
                    result.stopped = true;
                    return result;
                }
                if (answer.kind === "skip") {
                    result.skipped.push(property);
                    break;
                }
                if (answer.kind === "again") {
                    write(`${answer.message}\n`);
                    continue;
                }
                const applied = await steps.apply(property, answer.tokens);
                for (const line of applied.lines) { write(`${line}\n`); }
                if (applied.ok) {
                    result.set.push(property);
                    break;
                }
            }
        }
        return result;
    } finally {
        rl.close();
    }
}

/**
 * Lines from readline, buffered: answers typed (or piped) ahead arrive while
 * the next question is still being prepared. Undefined once input ends.
 */
function line_reader(rl: readline.Interface): { next(): Promise<string | undefined>; closed(): boolean } {
    const queue: string[] = [];
    let waiting: ((line?: string) => void) | undefined;
    let closed = false;
    rl.on("line", (line: string) => {
        if (waiting === undefined) { queue.push(line); return; }
        const resolve = waiting;
        waiting = undefined;
        resolve(line);
    });
    rl.on("close", () => {
        closed = true;
        waiting?.();
        waiting = undefined;
    });
    return {
        next: () => {
            const line = queue.shift();
            if (line !== undefined || closed) { return Promise.resolve(line); }
            return new Promise(resolve => { waiting = resolve; });
        },
        closed: () => closed,
    };
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;
    const { PassThrough } = await import("node:stream");

    const suggestions: Suggestion[] = [{ value: "gicv2", display_string: "gicv2 — inherited" }, { value: "gpio" }];

    test("interpret_answer — Enter takes the first suggestion, - skips, end of input stops", () => {
        expect(interpret_answer("", suggestions)).toEqual({ kind: "value", tokens: ["gicv2"] });
        expect(interpret_answer("  -  ", suggestions)).toEqual({ kind: "skip" });
        expect(interpret_answer(undefined, suggestions)).toEqual({ kind: "stop" });
    });

    test("interpret_answer — an answer is split into value tokens", () => {
        expect(interpret_answer(" 19  IRQ_TYPE_EDGE_FALLING ", [])).toEqual({ kind: "value", tokens: ["19", "IRQ_TYPE_EDGE_FALLING"] });
        expect(interpret_answer("0 1, 2 3", [])).toEqual({ kind: "value", tokens: ["0", "1,", "2", "3"] });
        expect(interpret_answer("", [{ value: "<0 1>" }])).toEqual({ kind: "value", tokens: ["<0", "1>"] });
    });

    test("interpret_answer — Enter without a suggestion asks again", () => {
        expect(interpret_answer("", [])).toEqual({ kind: "again", message: "No suggestion to take: type a value, or - to skip" });
    });

    /** Run an interview over fake streams with the answers already typed. */
    const interview = async (answers: string[], apply_ok: (property: string, tokens: string[]) => boolean = () => true) => {
        const input = new PassThrough();
        const output = new PassThrough();
        let printed = "";
        output.on("data", (chunk: Buffer) => { printed += chunk.toString(); });
        const asked: string[] = [];
        const applied: string[] = [];
        const steps: InterviewSteps = {
            ask: (property) => {
                asked.push(property);
                return Promise.resolve({ property, details: [`  about ${property}`], suggestions: property === "interrupt-parent" ? suggestions : [] });
            },
            apply: (property, tokens) => {
                const ok = apply_ok(property, tokens);
                if (ok) { applied.push(`${property}=${tokens.join(" ")}`); }
                return Promise.resolve({ ok, lines: [ok ? `Set ${property}` : `${property}: bad value`] });
            },
        };
        input.end(answers.map(answer => `${answer}\n`).join(""));
        const result = await run_interview(["interrupt-parent", "interrupts", "spi-max-frequency"], steps, { input, output, terminal: false });
        return { result, printed, asked, applied };
    };

    test("run_interview — asks in order, Enter takes the suggestion, - skips", async () => {
        const { result, applied, printed } = await interview(["", "19 IRQ_TYPE_EDGE_FALLING", "-"]);
        expect(applied).toEqual(["interrupt-parent=gicv2", "interrupts=19 IRQ_TYPE_EDGE_FALLING"]);
        expect(result).toEqual({ set: ["interrupt-parent", "interrupts"], skipped: ["spi-max-frequency"], stopped: false });
        expect(printed).toBe([
            "3 required properties to set (Enter takes the first suggestion, a number picks an option, - skips, Ctrl-D stops)",
            "",
            "[1/3] interrupt-parent",
            "  about interrupt-parent",
            "interrupt-parent [gicv2]: ",
            "Set interrupt-parent",
            "",
            "[2/3] interrupts",
            "  about interrupts",
            "interrupts: 19 IRQ_TYPE_EDGE_FALLING",
            "Set interrupts",
            "",
            "[3/3] spi-max-frequency",
            "  about spi-max-frequency",
            "spi-max-frequency: -",
            "",
        ].join("\n"));
    });

    test("run_interview — a rejected answer asks the same question again", async () => {
        const { result, asked, printed } = await interview(["gpio", "banana", "19 2", "-"], (property, tokens) => property !== "interrupts" || tokens[0] !== "banana");
        expect(result.set).toEqual(["interrupt-parent", "interrupts"]);
        expect(asked).toEqual(["interrupt-parent", "interrupts", "interrupts", "spi-max-frequency"]);
        expect(printed).toContain("interrupts: banana\ninterrupts: bad value\n\n[2/3] interrupts\n");
    });

    test("run_interview — end of input stops and keeps what was set", async () => {
        const { result } = await interview(["gpio"]);
        expect(result).toEqual({ set: ["interrupt-parent"], skipped: [], stopped: true });
    });

    test("run_interview — one missing property is singular", async () => {
        const input = new PassThrough();
        const output = new PassThrough();
        let printed = "";
        output.on("data", (chunk: Buffer) => { printed += chunk.toString(); });
        input.end("-\n");
        const steps: InterviewSteps = { ask: (property) => Promise.resolve({ property, details: [], suggestions: [] }), apply: () => { throw new Error("applied"); } };
        await run_interview(["regulator-name"], steps, { input, output, terminal: false });
        expect(printed.split("\n")[0]).toBe("1 required property to set (Enter takes the first suggestion, a number picks an option, - skips, Ctrl-D stops)");
    });

    test("run_interview — nothing missing asks nothing", async () => {
        const input = new PassThrough();
        const output = new PassThrough();
        input.end();
        const steps: InterviewSteps = { ask: () => { throw new Error("asked"); }, apply: () => { throw new Error("applied"); } };
        expect(await run_interview([], steps, { input, output, terminal: false })).toEqual({ set: [], skipped: [], stopped: false });
    });

    const irq_types: Entry = { options: [{ value: "IRQ_TYPE_NONE" }, { value: "IRQ_TYPE_EDGE_RISING" }, { value: "IRQ_TYPE_EDGE_FALLING" }], default: "IRQ_TYPE_NONE" };

    test("interpret_entry — a number picks an option from 1, a value can be typed out, Enter takes the default", () => {
        expect(interpret_entry("3", irq_types)).toEqual({ kind: "value", tokens: ["IRQ_TYPE_EDGE_FALLING"] });
        expect(interpret_entry("IRQ_TYPE_EDGE_RISING", irq_types)).toEqual({ kind: "value", tokens: ["IRQ_TYPE_EDGE_RISING"] });
        expect(interpret_entry("", irq_types)).toEqual({ kind: "value", tokens: ["IRQ_TYPE_NONE"] });
        expect(interpret_entry(" - ", irq_types)).toEqual({ kind: "skip" });
        expect(interpret_entry(undefined, irq_types)).toEqual({ kind: "stop" });
    });

    test("interpret_entry — a number is always a pick, even among numbers; a label with or without &", () => {
        const references: Entry = { options: [{ value: "0" }, { value: "1" }, { value: "3" }] };
        expect(interpret_entry("3", references)).toEqual({ kind: "value", tokens: ["3"] });
        expect(interpret_entry("1", references)).toEqual({ kind: "value", tokens: ["0"] });
        expect(interpret_entry("0", references)).toEqual({ kind: "again", message: "Not an option: pick 1 to 3, or type one of the values" });
        expect(interpret_entry("&gpio", { options: [{ value: "gicv2" }, { value: "gpio" }] })).toEqual({ kind: "value", tokens: ["gpio"] });
    });

    test("interpret_entry — wrong answers ask again", () => {
        expect(interpret_entry("4", irq_types)).toEqual({ kind: "again", message: "Not an option: pick 1 to 3, or type one of the values" });
        expect(interpret_entry("1 2", irq_types)).toEqual({ kind: "again", message: "One pick: pick 1 to 3" });
        expect(interpret_entry("", { options: [{ value: "a" }] })).toEqual({ kind: "again", message: "No default: pick 1 to 1, or - to skip" });
        expect(interpret_entry("", { kind: "number" })).toEqual({ kind: "again", message: "No default: type a value, or - to skip" });
        expect(interpret_entry("1 2", { kind: "number" })).toEqual({ kind: "again", message: "One value per line" });
    });

    test("interpret_entry — a list of any length takes several picks", () => {
        expect(interpret_entry("2 IRQ_TYPE_NONE", { ...irq_types, several: true })).toEqual({ kind: "value", tokens: ["IRQ_TYPE_EDGE_RISING", "IRQ_TYPE_NONE"] });
    });

    test("option_lines — numbered from 1, aligned, with what the display adds", () => {
        const options: Suggestion[] = [
            { value: "gicv2", display_string: "gicv2 — inherited" },
            { value: "aon_intr", display_string: "disabled" },
            ...Array.from({ length: 8 }, (_, index) => ({ value: `o${index + 2}` })),
        ];
        expect(option_lines(options).slice(0, 3)).toEqual(["   1) gicv2 — inherited", "   2) aon_intr  disabled", "   3) o2"]);
        expect(option_lines(options).at(-1)).toBe("  10) o9");
    });

    test("entry_prompt — the place among several, what a typed value is, the default (an option by number)", () => {
        expect(entry_prompt("interrupts", { kind: "number" }, 0, 2)).toBe("interrupts 1/2 (number): ");
        expect(entry_prompt("interrupts", { ...irq_types, default: "IRQ_TYPE_EDGE_FALLING" }, 1, 2)).toBe("interrupts 2/2 [3]: ");
        expect(entry_prompt("diff-channels", { kind: "number", default: "0" }, 0, 2)).toBe("diff-channels 1/2 (number) [0]: ");
        expect(entry_prompt("interrupt-parent", { options: [{ value: "gpio" }] }, 0, 1)).toBe("interrupt-parent: ");
    });

    test("run_interview — entry by entry: a wrong entry is asked again on its own, then the tokens are applied together", async () => {
        const input = new PassThrough();
        const output = new PassThrough();
        let printed = "";
        output.on("data", (chunk: Buffer) => { printed += chunk.toString(); });
        const applied: string[] = [];
        const steps: InterviewSteps = {
            ask: (property) => Promise.resolve({ property, details: ["  about it"], suggestions: [], entries: [{ kind: "number" }, irq_types] }),
            apply: (property, tokens) => { applied.push(`${property}=${tokens.join(" ")}`); return Promise.resolve({ ok: true, lines: ["Set it"] }); },
        };
        input.end("25\n9\n3\n");
        const result = await run_interview(["interrupts"], steps, { input, output, terminal: false });
        expect(result.set).toEqual(["interrupts"]);
        expect(applied).toEqual(["interrupts=25 IRQ_TYPE_EDGE_FALLING"]);
        expect(printed.split("\n").slice(2)).toEqual([
            "[1/1] interrupts",
            "  about it",
            "interrupts 1/2 (number): 25",
            "  1) IRQ_TYPE_NONE",
            "  2) IRQ_TYPE_EDGE_RISING",
            "  3) IRQ_TYPE_EDGE_FALLING",
            "interrupts 2/2 [1]: 9",
            "Not an option: pick 1 to 3, or type one of the values",
            "interrupts 2/2 [1]: 3",
            "Set it",
            "",
        ]);
    });

    const diff_channels = async (answers: string) => {
        const input = new PassThrough();
        const output = new PassThrough();
        const steps: InterviewSteps = {
            ask: (property) => Promise.resolve({ property, details: [], suggestions: [], entries: [{ kind: "number" }, { kind: "number" }] }),
            apply: () => { throw new Error("applied"); },
        };
        input.end(answers);
        return run_interview(["diff-channels"], steps, { input, output, terminal: false });
    };

    test("run_interview — - on any entry skips the property, Ctrl-D stops", async () => {
        expect(await diff_channels("0\n-\n")).toEqual({ set: [], skipped: ["diff-channels"], stopped: false });
        expect(await diff_channels("0\n")).toEqual({ set: [], skipped: [], stopped: true });
    });
}
