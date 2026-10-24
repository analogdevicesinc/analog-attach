import * as readline from "node:readline";

import type { Suggestion } from "../../protocol/types";

/** One value of a question asked on its own line: a cell of a fixed-size array, or a pick from a list. */
export interface Entry {
    /** What a value typed out is, shown in the prompt of an entry of several. */
    kind?: "number" | "string";
    /** A closed list (an enum, the nodes a phandle can name): lettered a, b, … (`pick_code`), answered by its letter or the value. */
    options?: Suggestion[];
    /** Several picks on one line, for an enum list of any length. */
    several?: boolean;
    /** What Enter takes: one of `options` when there are. */
    default?: string;
    /** What this entry is called in a row's prompt (`controller`, `line`, `flags`). */
    label?: string;
    /** The value names a node (a phandle): shown as `&label` in the value so far. */
    reference?: boolean;
    /** The entries that follow once this one is answered (its answer shapes them: a gpio controller's `#gpio-cells`); they replace the ones after it. */
    after?: (answer: string) => Entry[];
}

/** A property of several rows, each asked as `entries` are: a fixed count, or one row and then "another?" up to `max_rows`. */
export interface Rows {
    min_rows: number;
    max_rows?: number;
}

export interface Question {
    property: string;
    /** The lines under the property name: description, allowed values, suggestions. */
    details: string[];
    suggestions: Suggestion[];
    /** Ask entry by entry instead of the whole value on one line. */
    entries?: Entry[];
    /** `entries` is one row of this many: asked again for each row, the first entry defaulting to the previous row's answer. */
    rows?: Rows;
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

/** The letter code of the option at `index`: a … z, then aa, ab, … az, ba, … as a spreadsheet counts its columns. */
export function pick_code(index: number): string {
    let code = "";
    for (let rest = index + 1; rest > 0; rest = Math.floor((rest - 1) / 26)) {
        code = String.fromCodePoint(97 + ((rest - 1) % 26)) + code;
    }
    return code;
}

/** The option index a pick code names (the inverse of `pick_code`); undefined for a word that is not lower-case letters. */
export function code_index(word: string): number | undefined {
    if (!/^[a-z]+$/.test(word)) { return undefined; }
    let rest = 0;
    for (const letter of word) { rest = rest * 26 + (letter.codePointAt(0)! - 96); }
    return rest - 1;
}

/** `pick a to f`, or `pick a` for a lone option. */
const pick_range = (count: number): string => count === 1 ? `pick ${pick_code(0)}` : `pick ${pick_code(0)} to ${pick_code(count - 1)}`;

/**
 * The option a word picks. A pick code in range is always a pick; anything
 * else must be the value typed out: a number, a label with or without `&`
 * (`&ab` for a label that looks like a code), a string in quotes (`"a"`).
 */
function pick_option(word: string, options: Suggestion[]): string | undefined {
    const index = code_index(word);
    if (index !== undefined && index < options.length) { return options[index]?.value; }
    const unquoted = word.replace(/^"(.*)"$/, "$1");
    return options.find(o => bare(o.value) === bare(unquoted))?.value;
}

/** An answer to one entry: Enter takes its default, a letter picks from its options, "-" skips the property. */
export function interpret_entry(line: string | undefined, entry: Entry): Answer {
    if (line === undefined) { return { kind: "stop" }; }
    const answer = line.trim();
    if (answer === "-") { return { kind: "skip" }; }
    const { options } = entry;
    const range = options === undefined ? "" : pick_range(options.length);
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
    if (picked.includes(undefined)) { return { kind: "again", message: `Not an option: ${range}, or type one of the values (&label or "text" for one that looks like a letter)` }; }
    return { kind: "value", tokens: picked.flatMap(value => tokens_of(value ?? "")) };
}

/** The options lettered a, b, …, with what each one is when the display says more than the value. */
export function option_lines(options: Suggestion[]): string[] {
    const width = pick_code(options.length - 1).length;
    return options.map(({ value, display_string: display = value }, index) =>
        `  ${pick_code(index).padStart(width)}) ${display.startsWith(value) ? display : `${value}  ${display}`}`);
}

/** `interrupts 2/2 [3]: `: the entry's place when there are several, what it is, and what Enter takes (an option by its letter). */
export function entry_prompt(property: string, entry: Entry, index: number, count: number): string {
    const place = count === 1 ? property : `${property} ${index + 1}/${count}`;
    const kind = count > 1 && entry.kind !== undefined ? ` (${entry.kind})` : "";
    const position = entry.default === undefined ? -1 : (entry.options?.findIndex(o => o.value === entry.default) ?? -1);
    const fallback = position === -1 ? entry.default : pick_code(position);
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

/** The terminal rows `line` takes, its colour codes left out. */
export function screen_rows(line: string, columns: number): number {
    const width = line.replaceAll(/\u001B\[[0-9;]*m/g, "").length;
    return Math.max(1, Math.ceil(width / Math.max(1, columns)));
}

/**
 * A readline over the interview's streams: lines from it (answers typed ahead are kept), with the prompt echoed for
 * piped input. On a terminal `mark` starts counting the rows written (every write ends a line, and so does an
 * answer), and `erase` takes them off the screen again.
 */
function open_prompt(io: InterviewIO, complete: (line: string) => string[]): {
    write(text: string): void;
    read_line(prompt: string): Promise<string | undefined>;
    mark(): void;
    erase(): void;
    close(): void;
} {
    const rl = readline.createInterface({
        input: io.input,
        output: io.output,
        terminal: io.terminal,
        completer: (line: string): [string[], string] => [complete(line), line],
    });
    // Ctrl-C ends the interview like Ctrl-D.
    rl.on("SIGINT", () => { rl.close(); });
    const reader = line_reader(rl);
    let marked: number | undefined;
    // A pty can report 0 columns.
    const columns = (): number => (io.output as { columns?: number }).columns || 80;
    const count = (text: string): void => {
        if (marked === undefined) { return; }
        for (const line of text.replace(/\n$/, "").split("\n")) { marked += screen_rows(line, columns()); }
    };
    const write = (text: string): void => { io.output.write(text); count(text); };
    const read_line = async (prompt: string): Promise<string | undefined> => {
        // Piped answers can outlive the input stream: readline is closed but lines are still queued.
        if (reader.closed()) { io.output.write(prompt); } else { rl.setPrompt(prompt); rl.prompt(); }
        const line = await reader.next();
        // A terminal echoes what was typed; piped input doesn't.
        if (!io.terminal && line !== undefined) { io.output.write(`${line}\n`); }
        count(`${prompt}${line ?? ""}`);
        return line;
    };
    const mark = (): void => { if (io.terminal) { marked = 0; } };
    const erase = (): void => {
        if (marked !== undefined && marked > 0) { io.output.write(`\u001B[${marked}A\r\u001B[J`); }
        marked = undefined;
    };
    return { write, read_line, mark, erase, close: () => { rl.close(); } };
}

/** An answered entry: what was typed or picked, and the entry it answers. */
export interface Cell {
    token: string;
    entry: Entry;
}

/** The value as the property would read: `<&gpio 5 GPIO_ACTIVE_HIGH>, <&gpio 6 …>` for cell rows, `"a", "b"` for strings. */
export function format_cells(rows: Cell[][]): string {
    const cells = rows.flat();
    if (cells.length > 0 && cells.every(cell => cell.entry.kind === "string")) { return cells.map(cell => `"${cell.token}"`).join(", "); }
    const shown = (cell: Cell): string => cell.entry.reference === true && !cell.token.startsWith("&") ? `&${cell.token}` : cell.token;
    return rows.map(row => `<${row.map(cell => shown(cell)).join(" ")}>`).join(", ");
}

/** The value line of a question asked in place: what is answered so far, nothing before the first answer. */
function value_line(property: string, rows: Cell[][], note?: string): string | undefined {
    const answered = rows.filter(row => row.length > 0);
    if (answered.length === 0) { return undefined; }
    return `  ${property} = ${format_cells(answered)};${note === undefined ? "" : `  (${note})`}`;
}

/** A question of more than one entry, which a terminal asks in place under the value so far. */
const several_entries = (entries: Entry[]): boolean => entries.length > 1 || entries.some(entry => entry.after !== undefined);

/** Ask for each missing property in turn and apply the answers. */
export async function run_interview(missing: string[], steps: InterviewSteps, io: InterviewIO): Promise<InterviewResult> {
    const result: InterviewResult = { set: [], skipped: [], stopped: false };
    if (missing.length === 0) { return result; }

    let completions: string[] = [];
    const { write, read_line, mark, erase, close } = open_prompt(io, line => completions.filter(c => c.startsWith(line)));
    /**
     * One value per entry, each on its own line; a wrong answer asks that entry again. An answered entry can reshape
     * the ones after it. With `shown` (a terminal), each entry is asked under the line `shown` gives for the cells so
     * far, and its lines are erased once it is answered, so the next entry is asked on the same lines.
     */
    const ask_row = async (
        entries_of_row: Entry[],
        prompt_of: (entry: Entry, index: number, count: number) => string,
        carried?: string,
        shown?: (cells: Cell[]) => string | undefined,
    ): Promise<Exclude<Answer, { kind: "value" }> | { kind: "value"; tokens: string[]; cells: Cell[] }> => {
        let entries = entries_of_row;
        const cells: Cell[] = [];
        for (let index = 0; index < entries.length; index++) {
            const listed = entries[index]!;
            // The first entry of a later row takes the previous row's answer on Enter.
            const entry = index === 0 && carried !== undefined && listed.options?.some(o => o.value === carried) === true ? { ...listed, default: carried } : listed;
            completions = entry.options?.map(o => o.value) ?? [];
            if (shown !== undefined) {
                mark();
                const line = shown(cells);
                if (line !== undefined) { write(`${line}\n`); }
            }
            if (entry.options !== undefined) { for (const line of option_lines(entry.options)) { write(`${line}\n`); } }
            for (;;) {
                const answer = interpret_entry(await read_line(prompt_of(entry, index, entries.length)), entry);
                if (answer.kind === "again") { write(`${answer.message}\n`); continue; }
                if (answer.kind !== "value") { return answer; }
                cells.push(...answer.tokens.map(token => ({ token, entry })));
                if (entry.after !== undefined) { entries = [...entries.slice(0, index + 1), ...entry.after(answer.tokens[0] ?? "")]; }
                break;
            }
            if (shown !== undefined) { erase(); }
        }
        return { kind: "value", tokens: cells.map(cell => cell.token), cells };
    };
    /** "another?" after a row: Enter is done, y adds one. */
    const ask_another = async (property: string): Promise<boolean | undefined> => {
        for (;;) {
            const line = await read_line(`${property}: another row? (y adds one, Enter = done) `);
            if (line === undefined) { return undefined; }
            const answer = line.trim().toLowerCase();
            if (answer === "" || answer === "n" || answer === "-") { return false; }
            if (answer === "y" || answer === "yes") { return true; }
            write("Answer y for another row, or Enter when done\n");
        }
    };
    const ask_entries = async (property: string, entries: Entry[]): Promise<Answer> => {
        const in_place = io.terminal && several_entries(entries);
        const answer = await ask_row(entries, (entry, index, count) => entry_prompt(property, entry, index, count), undefined, in_place ? cells => value_line(property, [cells]) : undefined);
        if (answer.kind !== "value") { return answer; }
        const line = in_place ? value_line(property, [answer.cells]) : undefined;
        if (line !== undefined) { write(`${line}\n`); }
        return { kind: "value", tokens: answer.tokens };
    };
    /** The rows of a property, comma-separated in the tokens: every row of a fixed count, else the minimum and "another?" up to the maximum. */
    const ask_rows = async (property: string, entries: Entry[], rows: Rows): Promise<Answer> => {
        const { min_rows, max_rows } = rows;
        const fixed = max_rows !== undefined && max_rows === min_rows ? max_rows : undefined;
        const answered: Cell[][] = [];
        const progress = (): string | undefined => fixed === undefined ? undefined : `${answered.length}/${fixed} rows`;
        const shown = io.terminal ? (cells: Cell[]) => value_line(property, [...answered, cells], progress()) : undefined;
        for (let row = 1; ; row++) {
            const place = max_rows === 1 ? property : `${property} row ${row}${fixed === undefined ? "" : `/${fixed}`}`;
            const answer = await ask_row(entries, (entry) => entry_prompt(entry.label === undefined ? place : `${place} ${entry.label}`, entry, 0, 1), answered.at(-1)?.[0]?.token, shown);
            if (answer.kind !== "value") { return answer; }
            answered.push(answer.cells);
            if (max_rows !== undefined && row >= max_rows) { break; }
            if (row >= min_rows) {
                if (shown !== undefined) {
                    mark();
                    const line = shown([]);
                    if (line !== undefined) { write(`${line}\n`); }
                }
                const more = await ask_another(property);
                if (more === undefined) { return { kind: "stop" }; }
                if (shown !== undefined) { erase(); }
                if (!more) { break; }
            }
        }
        const line = shown === undefined ? undefined : value_line(property, answered);
        if (line !== undefined) { write(`${line}\n`); }
        return { kind: "value", tokens: answered.flatMap((cells, index) => {
            const tokens = cells.map(cell => cell.token);
            return index < answered.length - 1 ? [...tokens.slice(0, -1), `${tokens.at(-1) ?? ""},`] : tokens;
        }) };
    };

    const count = missing.length === 1 ? "1 required property" : `${missing.length} required properties`;
    write(`${count} to set (Enter takes the default, a letter picks an option, - skips, Ctrl-D stops)\n`);
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
                    answer = question.rows === undefined ? await ask_entries(property, question.entries) : await ask_rows(property, question.entries, question.rows);
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
        close();
    }
}

/** The question that comes before the node exists: where it goes. */
export interface ParentQuestion {
    /** The line above the list. */
    title: string;
    /** The valid parents, lettered a, b, …: the value is what `--parent` takes (label, or path), the display the path. Enter takes the first. */
    options: Suggestion[];
    /** What Tab completes a typed label or path to, segment by segment. */
    complete(line: string): string[];
    /** A message when the identifier names no node, checked as `--parent` is. */
    check(identifier: string): string | undefined;
}

/** An answer to the parent question: Enter takes the first parent, a letter picks one, anything else is a label or path to check; `-` isn't accepted (a parent is needed). */
export function interpret_parent(line: string | undefined, options: Suggestion[]): Answer {
    if (line === undefined) { return { kind: "stop" }; }
    const answer = line.trim();
    const range = pick_range(options.length);
    if (answer === "-") { return { kind: "again", message: `A parent is needed: ${range}, or type a label or path` }; }
    if (answer === "") {
        const first = options[0]?.value;
        return first === undefined ? { kind: "again", message: "Type a label or path" } : { kind: "value", tokens: [first] };
    }
    const words = tokens_of(answer);
    const [word] = words;
    if (words.length !== 1 || word === undefined) { return { kind: "again", message: "A parent is one label or path" }; }
    const index = code_index(word);
    const picked = index === undefined ? undefined : options[index]?.value;
    // A path is one token; spi0/ is spi0.
    return { kind: "value", tokens: [picked ?? (word === "/" ? word : word.replace(/\/$/, ""))] };
}

/** Ask where the node goes. The parent as `--parent` takes it, or undefined when the question was stopped (Ctrl-D, Ctrl-C): nothing is added then. */
export async function ask_parent(question: ParentQuestion, io: InterviewIO): Promise<string | undefined> {
    const { write, read_line, close } = open_prompt(io, line => question.complete(line));
    try {
        write(`${question.title} (Enter takes ${pick_code(0)}, a letter picks, or type a label or path, Ctrl-D stops)\n`);
        for (const line of option_lines(question.options)) { write(`${line}\n`); }
        const first = question.options[0];
        const entry: Entry = { options: question.options, ...(first === undefined ? {} : { default: first.value }) };
        for (;;) {
            const answer = interpret_parent(await read_line(entry_prompt("parent", entry, 0, 1)), question.options);
            if (answer.kind === "stop") {
                if (io.terminal) { write("\n"); }
                return undefined;
            }
            if (answer.kind === "again") {
                write(`${answer.message}\n`);
                continue;
            }
            const identifier = answer.kind === "value" ? answer.tokens[0] : undefined;
            if (identifier === undefined) { continue; } // `-` never gets here: interpret_parent asks again
            const problem = question.check(identifier);
            if (problem === undefined) { return identifier; }
            write(`${problem}\n`);
        }
    } finally {
        close();
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
            "3 required properties to set (Enter takes the default, a letter picks an option, - skips, Ctrl-D stops)",
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
        expect(printed.split("\n")[0]).toBe("1 required property to set (Enter takes the default, a letter picks an option, - skips, Ctrl-D stops)");
    });

    test("run_interview — nothing missing asks nothing", async () => {
        const input = new PassThrough();
        const output = new PassThrough();
        input.end();
        const steps: InterviewSteps = { ask: () => { throw new Error("asked"); }, apply: () => { throw new Error("applied"); } };
        expect(await run_interview([], steps, { input, output, terminal: false })).toEqual({ set: [], skipped: [], stopped: false });
    });

    const NOT_AN_OPTION = (range: string): string => `Not an option: ${range}, or type one of the values (&label or "text" for one that looks like a letter)`;
    const irq_types: Entry = { options: [{ value: "IRQ_TYPE_NONE" }, { value: "IRQ_TYPE_EDGE_RISING" }, { value: "IRQ_TYPE_EDGE_FALLING" }], default: "IRQ_TYPE_NONE" };

    test("pick_code and code_index — a … z, then aa … az, ba …, and back", () => {
        expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(index => pick_code(index))).toEqual(["a", "b", "z", "aa", "ab", "az", "ba", "zz", "aaa"]);
        expect(["a", "b", "z", "aa", "ab", "az", "ba", "zz", "aaa"].map(word => code_index(word))).toEqual([0, 1, 25, 26, 27, 51, 52, 701, 702]);
        for (let index = 0; index < 1500; index++) { expect(code_index(pick_code(index))).toBe(index); }
        expect(code_index("A")).toBeUndefined();
        expect(code_index("a1")).toBeUndefined();
        expect(code_index("&ab")).toBeUndefined();
        expect(code_index("")).toBeUndefined();
    });

    test("interpret_entry — a letter picks an option, a value can be typed out, Enter takes the default", () => {
        expect(interpret_entry("c", irq_types)).toEqual({ kind: "value", tokens: ["IRQ_TYPE_EDGE_FALLING"] });
        expect(interpret_entry("IRQ_TYPE_EDGE_RISING", irq_types)).toEqual({ kind: "value", tokens: ["IRQ_TYPE_EDGE_RISING"] });
        expect(interpret_entry("", irq_types)).toEqual({ kind: "value", tokens: ["IRQ_TYPE_NONE"] });
        expect(interpret_entry(" - ", irq_types)).toEqual({ kind: "skip" });
        expect(interpret_entry(undefined, irq_types)).toEqual({ kind: "stop" });
    });

    test("interpret_entry — a number is always a value, never a pick; a label with or without &", () => {
        const references: Entry = { options: [{ value: "0" }, { value: "1" }, { value: "3" }] };
        expect(interpret_entry("3", references)).toEqual({ kind: "value", tokens: ["3"] });
        expect(interpret_entry("1", references)).toEqual({ kind: "value", tokens: ["1"] });
        expect(interpret_entry("a", references)).toEqual({ kind: "value", tokens: ["0"] });
        expect(interpret_entry("2", references)).toEqual({ kind: "again", message: NOT_AN_OPTION("pick a to c") });
        expect(interpret_entry("&gpio", { options: [{ value: "gicv2" }, { value: "gpio" }] })).toEqual({ kind: "value", tokens: ["gpio"] });
        expect(interpret_entry("gpio", { options: [{ value: "gicv2" }, { value: "gpio" }] })).toEqual({ kind: "value", tokens: ["gpio"] });
    });

    test("interpret_entry — past z the codes go aa, ab, …; &ab and \"a\" are values that look like codes", () => {
        const many: Entry = { options: Array.from({ length: 30 }, (_, index) => ({ value: `opt${index}` })) };
        expect(interpret_entry("z", many)).toEqual({ kind: "value", tokens: ["opt25"] });
        expect(interpret_entry("aa", many)).toEqual({ kind: "value", tokens: ["opt26"] });
        expect(interpret_entry("ad", many)).toEqual({ kind: "value", tokens: ["opt29"] });
        expect(interpret_entry("ae", many)).toEqual({ kind: "again", message: NOT_AN_OPTION("pick a to ad") });
        const lookalikes: Entry = { options: [{ value: "x" }, { value: "a" }, { value: "ab" }] };
        expect(interpret_entry("a", lookalikes)).toEqual({ kind: "value", tokens: ["x"] });
        expect(interpret_entry('"a"', lookalikes)).toEqual({ kind: "value", tokens: ["a"] });
        expect(interpret_entry("&ab", lookalikes)).toEqual({ kind: "value", tokens: ["ab"] });
        // Out of range, a code is the value typed out if it is one, else not an option.
        expect(interpret_entry("ab", { options: [{ value: "x" }, { value: "ab" }] })).toEqual({ kind: "value", tokens: ["ab"] });
        expect(interpret_entry("ac", { options: [{ value: "x" }, { value: "ab" }] })).toEqual({ kind: "again", message: NOT_AN_OPTION("pick a to b") });
    });

    test("interpret_entry — wrong answers ask again", () => {
        expect(interpret_entry("d", irq_types)).toEqual({ kind: "again", message: NOT_AN_OPTION("pick a to c") });
        expect(interpret_entry("4", irq_types)).toEqual({ kind: "again", message: NOT_AN_OPTION("pick a to c") });
        expect(interpret_entry("a b", irq_types)).toEqual({ kind: "again", message: "One pick: pick a to c" });
        expect(interpret_entry("", { options: [{ value: "a" }] })).toEqual({ kind: "again", message: "No default: pick a, or - to skip" });
        expect(interpret_entry("", { kind: "number" })).toEqual({ kind: "again", message: "No default: type a value, or - to skip" });
        expect(interpret_entry("1 2", { kind: "number" })).toEqual({ kind: "again", message: "One value per line" });
    });

    test("interpret_entry — a list of any length takes several picks", () => {
        expect(interpret_entry("b IRQ_TYPE_NONE", { ...irq_types, several: true })).toEqual({ kind: "value", tokens: ["IRQ_TYPE_EDGE_RISING", "IRQ_TYPE_NONE"] });
    });

    test("option_lines — lettered, aligned to the longest code, with what the display adds", () => {
        const options: Suggestion[] = [
            { value: "gicv2", display_string: "gicv2 — inherited" },
            { value: "aon_intr", display_string: "disabled" },
            ...Array.from({ length: 28 }, (_, index) => ({ value: `o${index + 2}` })),
        ];
        expect(option_lines(options).slice(0, 3)).toEqual(["   a) gicv2 — inherited", "   b) aon_intr  disabled", "   c) o2"]);
        expect(option_lines(options).at(-1)).toBe("  ad) o29");
        expect(option_lines(options.slice(0, 3))).toEqual(["  a) gicv2 — inherited", "  b) aon_intr  disabled", "  c) o2"]);
    });

    test("entry_prompt — the place among several, what a typed value is, the default (an option by letter)", () => {
        expect(entry_prompt("interrupts", { kind: "number" }, 0, 2)).toBe("interrupts 1/2 (number): ");
        expect(entry_prompt("interrupts", { ...irq_types, default: "IRQ_TYPE_EDGE_FALLING" }, 1, 2)).toBe("interrupts 2/2 [c]: ");
        expect(entry_prompt("diff-channels", { kind: "number", default: "0" }, 0, 2)).toBe("diff-channels 1/2 (number) [0]: ");
        expect(entry_prompt("interrupt-parent", { options: [{ value: "gpio" }] }, 0, 1)).toBe("interrupt-parent: ");
        expect(entry_prompt("interrupt-parent", { options: [{ value: "gicv2" }, { value: "gpio" }], default: "gicv2" }, 0, 1)).toBe("interrupt-parent [a]: ");
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
        input.end("25\n9\nc\n");
        const result = await run_interview(["interrupts"], steps, { input, output, terminal: false });
        expect(result.set).toEqual(["interrupts"]);
        expect(applied).toEqual(["interrupts=25 IRQ_TYPE_EDGE_FALLING"]);
        expect(printed.split("\n").slice(2)).toEqual([
            "[1/1] interrupts",
            "  about it",
            "interrupts 1/2 (number): 25",
            "  a) IRQ_TYPE_NONE",
            "  b) IRQ_TYPE_EDGE_RISING",
            "  c) IRQ_TYPE_EDGE_FALLING",
            "interrupts 2/2 [a]: 9",
            NOT_AN_OPTION("pick a to c"),
            "interrupts 2/2 [a]: c",
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

    // A gpio row: the controller first, whose answer gives the cells after it (two for #gpio-cells = <2>).
    const gpio_flags: Entry = { options: [{ value: "GPIO_ACTIVE_HIGH" }, { value: "GPIO_ACTIVE_LOW" }], default: "GPIO_ACTIVE_HIGH", label: "flags" };
    const gpio_row: Entry[] = [{
        options: [{ value: "gpio" }, { value: "expgpio" }],
        default: "gpio",
        label: "controller",
        reference: true,
        after: controller => controller === "gpio" ? [{ kind: "number", label: "line" }, gpio_flags] : [{ kind: "number", label: "line" }],
    }];
    /** An interview over one gpio property with `rows`, the answers already typed. */
    const gpio_interview = async (rows: { min_rows: number; max_rows?: number }, answers: string[], terminal = false) => {
        const input = new PassThrough();
        const output = new PassThrough();
        let printed = "";
        output.on("data", (chunk: Buffer) => { printed += chunk.toString(); });
        const applied: string[] = [];
        const steps: InterviewSteps = {
            ask: (property) => Promise.resolve({ property, details: [], suggestions: [], entries: gpio_row, rows }),
            apply: (property, tokens) => { applied.push(`${property}=${tokens.join(" ")}`); return Promise.resolve({ ok: true, lines: ["Set it"] }); },
        };
        input.end(answers.map(answer => `${answer}\n`).join(""));
        const result = await run_interview(["ctrl-gpios"], steps, { input, output, terminal });
        return { result, applied, printed };
    };

    test("format_cells — cell rows with references as &label, a string list quoted", () => {
        const controller: Entry = { options: [{ value: "gpio" }], reference: true };
        const line: Entry = { kind: "number" };
        const flags: Entry = { options: [{ value: "GPIO_ACTIVE_HIGH" }] };
        expect(format_cells([
            [{ token: "gpio", entry: controller }, { token: "5", entry: line }, { token: "GPIO_ACTIVE_HIGH", entry: flags }],
            [{ token: "&expgpio", entry: controller }, { token: "2", entry: line }],
        ])).toBe("<&gpio 5 GPIO_ACTIVE_HIGH>, <&expgpio 2>");
        expect(format_cells([[{ token: "25", entry: line }, { token: "IRQ_TYPE_EDGE_FALLING", entry: flags }]])).toBe("<25 IRQ_TYPE_EDGE_FALLING>");
        const name: Entry = { kind: "string" };
        expect(format_cells([[{ token: "ref", entry: name }, { token: "mclk", entry: name }]])).toBe('"ref", "mclk"');
    });

    test("screen_rows — a line longer than the terminal wraps, colour codes take no room", () => {
        expect(screen_rows("", 80)).toBe(1);
        expect(screen_rows("x".repeat(80), 80)).toBe(1);
        expect(screen_rows("x".repeat(81), 80)).toBe(2);
        expect(screen_rows(`\u001B[1m${"x".repeat(80)}\u001B[0m`, 80)).toBe(1);
    });

    test("run_interview — on a terminal each entry is asked under the value so far and erased once answered", async () => {
        const { applied, printed } = await gpio_interview({ min_rows: 2, max_rows: 2 }, ["", "1", "", "", "2", ""], true);
        expect(applied).toEqual(["ctrl-gpios=gpio 1 GPIO_ACTIVE_HIGH, gpio 2 GPIO_ACTIVE_HIGH"]);
        // Row 1: the controller (two options and the prompt), then the line under the value so far, then the flags.
        expect(printed).toContain("\u001B[3A\r\u001B[J  ctrl-gpios = <&gpio>;  (0/2 rows)\n");
        expect(printed).toContain("\u001B[2A\r\u001B[J  ctrl-gpios = <&gpio 1>;  (0/2 rows)\n");
        expect(printed).toContain("  ctrl-gpios = <&gpio 1 GPIO_ACTIVE_HIGH>;  (1/2 rows)\n");
        expect(printed).toContain("  ctrl-gpios = <&gpio 1 GPIO_ACTIVE_HIGH>, <&gpio 2 GPIO_ACTIVE_HIGH>;\nSet it\n");
        // Piped, nothing is erased.
        const piped = await gpio_interview({ min_rows: 2, max_rows: 2 }, ["", "1", "", "", "2", ""]);
        expect(piped.printed).not.toContain("\u001B[");
    });

    /** What a terminal shows for one question of `entries`, the answers already typed. */
    const on_terminal = async (entries: Entry[], answers: string) => {
        const input = new PassThrough();
        const output = new PassThrough();
        let printed = "";
        output.on("data", (chunk: Buffer) => { printed += chunk.toString(); });
        const steps: InterviewSteps = {
            ask: (property) => Promise.resolve({ property, details: [], suggestions: [], entries }),
            apply: () => Promise.resolve({ ok: true, lines: ["Set it"] }),
        };
        input.end(answers);
        await run_interview(["prop"], steps, { input, output, terminal: true });
        return printed;
    };

    test("run_interview — any question of several entries is asked in place on a terminal, a single one is not", async () => {
        const pair = await on_terminal([{ kind: "number" }, { kind: "number" }], "0\n17\n");
        expect(pair).toContain("\u001B[1A\r\u001B[J  prop = <0>;\n");
        expect(pair).toContain("\u001B[2A\r\u001B[J  prop = <0 17>;\nSet it\n");
        const single = await on_terminal([{ options: [{ value: "a1" }, { value: "a2" }] }], "b\n");
        expect(single).not.toContain("prop = ");
        expect(single).not.toContain("\u001B[J");
    });

    test("run_interview — one row: the controller's answer gives the cells that follow", async () => {
        const { applied, printed } = await gpio_interview({ min_rows: 1, max_rows: 1 }, ["", "5", "b"]);
        expect(applied).toEqual(["ctrl-gpios=gpio 5 GPIO_ACTIVE_LOW"]);
        expect(printed).toContain("ctrl-gpios controller [a]: \n");
        expect(printed).toContain("ctrl-gpios line: 5\n");
        expect(printed).toContain("ctrl-gpios flags [a]: b\n");
        // The other controller has a single cell: its row has no flags.
        const expgpio = await gpio_interview({ min_rows: 1, max_rows: 1 }, ["b", "7"]);
        expect(expgpio.applied).toEqual(["ctrl-gpios=expgpio 7"]);
    });

    test("run_interview — a fixed row count asks every row without \"another?\", the later rows' controller defaulting to the previous one", async () => {
        const { applied, printed } = await gpio_interview({ min_rows: 2, max_rows: 2 }, ["b", "1", "", "2"]);
        expect(applied).toEqual(["ctrl-gpios=expgpio 1, expgpio 2"]);
        expect(printed).toContain("ctrl-gpios row 1/2 controller [a]: b\n");
        expect(printed).toContain("ctrl-gpios row 2/2 controller [b]: \n");
        expect(printed).not.toContain("another");
    });

    test("run_interview — an unsized property asks a row, then another? until Enter", async () => {
        const { applied, printed } = await gpio_interview({ min_rows: 1 }, ["", "5", "b", "y", "", "6", "", ""]);
        expect(applied).toEqual(["ctrl-gpios=gpio 5 GPIO_ACTIVE_LOW, gpio 6 GPIO_ACTIVE_HIGH"]);
        expect(printed).toContain("ctrl-gpios: another row? (y adds one, Enter = done) y\n");
        expect(printed).toContain("ctrl-gpios row 2 controller [a]: \n");
        expect(printed.endsWith("ctrl-gpios: another row? (y adds one, Enter = done) \nSet it\n")).toBe(true);
    });

    test("run_interview — a range asks the minimum, then another? up to the maximum", async () => {
        // 2..3 rows: no question after the first, one after the second, none after the third.
        const { applied, printed } = await gpio_interview({ min_rows: 2, max_rows: 3 }, ["", "1", "", "", "2", "", "y", "", "3", ""]);
        expect(applied).toEqual(["ctrl-gpios=gpio 1 GPIO_ACTIVE_HIGH, gpio 2 GPIO_ACTIVE_HIGH, gpio 3 GPIO_ACTIVE_HIGH"]);
        expect(printed.match(/another row/g)).toHaveLength(1);
    });

    test("run_interview — a stray answer to another? asks again, - skips, Ctrl-D stops", async () => {
        const stray = await gpio_interview({ min_rows: 1 }, ["", "5", "", "maybe", ""]);
        expect(stray.applied).toEqual(["ctrl-gpios=gpio 5 GPIO_ACTIVE_HIGH"]);
        expect(stray.printed).toContain("Answer y for another row, or Enter when done\n");
        const skipped = await gpio_interview({ min_rows: 2, max_rows: 2 }, ["", "5", "", "-"]);
        expect(skipped.result).toEqual({ set: [], skipped: ["ctrl-gpios"], stopped: false });
        const stopped = await gpio_interview({ min_rows: 1 }, ["", "5", ""]);
        expect(stopped.result).toEqual({ set: [], skipped: [], stopped: true });
    });

    const parents: Suggestion[] = [
        { value: "spi", display_string: "/soc/spi@7e204000" },
        { value: "spi1", display_string: "/soc/spi@7e215080" },
        { value: "/soc/odd@0" },
    ];

    test("interpret_parent — Enter takes the first, a letter picks, a label or path is typed", () => {
        expect(interpret_parent("", parents)).toEqual({ kind: "value", tokens: ["spi"] });
        expect(interpret_parent("c", parents)).toEqual({ kind: "value", tokens: ["/soc/odd@0"] });
        // A letter out of range isn't a pick: it is a label to check.
        expect(interpret_parent("d", parents)).toEqual({ kind: "value", tokens: ["d"] });
        expect(interpret_parent("spi0", parents)).toEqual({ kind: "value", tokens: ["spi0"] });
        expect(interpret_parent("spi0/adc@0", parents)).toEqual({ kind: "value", tokens: ["spi0/adc@0"] });
        expect(interpret_parent("/soc/spi@7e204000/", parents)).toEqual({ kind: "value", tokens: ["/soc/spi@7e204000"] });
        expect(interpret_parent("/", parents)).toEqual({ kind: "value", tokens: ["/"] });
        expect(interpret_parent(undefined, parents)).toEqual({ kind: "stop" });
    });

    test("interpret_parent — a parent is needed: - and several words ask again", () => {
        expect(interpret_parent("-", parents)).toEqual({ kind: "again", message: "A parent is needed: pick a to c, or type a label or path" });
        expect(interpret_parent("a b", parents)).toEqual({ kind: "again", message: "A parent is one label or path" });
        expect(interpret_parent("", [])).toEqual({ kind: "again", message: "Type a label or path" });
    });

    /** The parent question over fake streams with the answers already typed. */
    const ask = async (answers: string[], known: string[] = ["spi", "spi1", "spi0/adc@0", "/soc/odd@0"]) => {
        const input = new PassThrough();
        const output = new PassThrough();
        let printed = "";
        output.on("data", (chunk: Buffer) => { printed += chunk.toString(); });
        const checked: string[] = [];
        const question: ParentQuestion = {
            title: "Where does adi,adxl345 go?",
            options: parents,
            complete: line => [line],
            check: identifier => {
                checked.push(identifier);
                return known.includes(identifier) ? undefined : `Couldn't find parent node ${identifier}`;
            },
        };
        input.end(answers.map(answer => `${answer}\n`).join(""));
        const parent = await ask_parent(question, { input, output, terminal: false });
        return { parent, printed, checked };
    };

    test("ask_parent — the lettered list, Enter takes the first", async () => {
        const { parent, printed } = await ask([""]);
        expect(parent).toBe("spi");
        expect(printed).toBe([
            "Where does adi,adxl345 go? (Enter takes a, a letter picks, or type a label or path, Ctrl-D stops)",
            "  a) spi  /soc/spi@7e204000",
            "  b) spi1  /soc/spi@7e215080",
            "  c) /soc/odd@0",
            "parent [a]: ",
            "",
        ].join("\n"));
    });

    test("ask_parent — a letter, a typed label, a typed path", async () => {
        const { parent: letter } = await ask(["b"]);
        const { parent: label } = await ask(["spi0/adc@0"]);
        const { parent: path } = await ask(["/soc/odd@0/"]);
        expect([letter, label, path]).toEqual(["spi1", "spi0/adc@0", "/soc/odd@0"]);
    });

    test("ask_parent — a parent that isn't there, and -, are asked again", async () => {
        const { parent, printed, checked } = await ask(["nope", "-", "b"]);
        expect(parent).toBe("spi1");
        expect(checked).toEqual(["nope", "spi1"]);
        expect(printed).toContain("parent [a]: nope\nCouldn't find parent node nope\nparent [a]: -\nA parent is needed: pick a to c, or type a label or path\nparent [a]: b\n");
    });

    test("ask_parent — Ctrl-D asks nothing more and gives no parent", async () => {
        const { parent: nothing } = await ask([]);
        const { parent: wrong } = await ask(["nope"]);
        expect([nothing, wrong]).toEqual([undefined, undefined]);
    });
}
