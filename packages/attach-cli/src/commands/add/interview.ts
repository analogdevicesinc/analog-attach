import * as readline from "node:readline";

import type { Suggestion } from "../../protocol/types";

export interface Question {
    property: string;
    /** The lines under the property name: description, allowed values, suggestions. */
    details: string[];
    suggestions: Suggestion[];
}

export type Answer =
    | { kind: "value"; tokens: string[] }
    | { kind: "skip" }
    | { kind: "stop" }
    | { kind: "again"; message: string };

/** Enter takes the first suggestion, "-" skips, the end of input (Ctrl-D) stops. */
export function interpret_answer(line: string | undefined, suggestions: Suggestion[]): Answer {
    if (line === undefined) { return { kind: "stop" }; }
    const answer = line.trim();
    if (answer === "-") { return { kind: "skip" }; }
    const value = answer === "" ? suggestions[0]?.value : answer;
    if (value === undefined) { return { kind: "again", message: "No suggestion to take: type a value, or - to skip" }; }
    return { kind: "value", tokens: value.split(/\s+/).filter(Boolean) };
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

    const count = missing.length === 1 ? "1 required property" : `${missing.length} required properties`;
    write(`${count} to set (Enter takes the first suggestion, - skips, Ctrl-D stops)\n`);
    try {
        for (const [index, property] of missing.entries()) {
            for (;;) {
                const question = await steps.ask(property);
                completions = question.suggestions.map(s => s.value);
                write(`\n[${index + 1}/${missing.length}] ${property}\n`);
                for (const line of question.details) { write(`${line}\n`); }
                const first = question.suggestions[0]?.value;
                const prompt = first === undefined ? `${property}: ` : `${property} [${first}]: `;
                // Piped answers can outlive the input stream: readline is closed but lines are still queued.
                if (reader.closed()) { write(prompt); } else { rl.setPrompt(prompt); rl.prompt(); }
                const line = await reader.next();
                // A terminal echoes what was typed; piped input doesn't.
                if (!io.terminal && line !== undefined) { write(`${line}\n`); }

                const answer = interpret_answer(line, question.suggestions);
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
            "3 required properties to set (Enter takes the first suggestion, - skips, Ctrl-D stops)",
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
        expect(printed.split("\n")[0]).toBe("1 required property to set (Enter takes the first suggestion, - skips, Ctrl-D stops)");
    });

    test("run_interview — nothing missing asks nothing", async () => {
        const input = new PassThrough();
        const output = new PassThrough();
        input.end();
        const steps: InterviewSteps = { ask: () => { throw new Error("asked"); }, apply: () => { throw new Error("applied"); } };
        expect(await run_interview([], steps, { input, output, terminal: false })).toEqual({ set: [], skipped: [], stopped: false });
    });
}
