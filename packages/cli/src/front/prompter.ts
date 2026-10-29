// The `Prompter` a session gets on a terminal, on @inquirer/prompts (D-08). `select`,
// `confirm`, `checkbox` and `search` are inquirer's own; `input` is a custom prompt, since
// inquirer's has no Tab completion. Ctrl-C and Ctrl-D stop any of them with
// `PromptCancelled`, which the front end prints with exit 130 when nothing catches it.

import {
    createPrompt, isEnterKey, isTabKey, makeTheme, useKeypress, usePrefix, useState,
    type KeypressEvent, type Status,
} from "@inquirer/core";
import { checkbox, confirm, search, select } from "@inquirer/prompts";
import { PromptCancelled, type Choice, type Prompter, type RawTerminal } from "../interface/backend-interface";

/** The longest prefix every word shares. */
export function common_prefix(words: readonly string[]): string {
    const [first, ...rest] = words;
    if (first === undefined) { return ""; }
    let length = first.length;
    for (const word of rest) {
        let index = 0;
        while (index < length && index < word.length && word[index] === first[index]) { index += 1; }
        length = index;
    }
    return first.slice(0, length);
}

/**
 * What Tab does to the line: one candidate that extends it replaces it; several extend it to
 * what they share and are listed under the prompt; none leave it as it is. Candidates that
 * don't start with what is typed are ignored.
 */
export function complete_line(typed: string, candidates: readonly string[]): { line: string; shown: readonly string[] } {
    const matches = [...new Set(candidates.filter(candidate => candidate.startsWith(typed)))];
    if (matches.length === 0) { return { line: typed, shown: [] }; }
    if (matches.length === 1) { return { line: matches[0]!, shown: [] }; }
    return { line: common_prefix(matches), shown: matches };
}

interface CompletingInputConfig {
    message: string;
    default?: string;
    validate?(answer: string): true | string;
    complete?(partial: string): Promise<string[]>;
}

/** A line prompt with a default, a validation that asks again, and Tab completion. */
const completing_input = createPrompt<string, CompletingInputConfig>((config, done) => {
    const theme = makeTheme({});
    const [status, set_status] = useState<Status>("idle");
    const [value, set_value] = useState("");
    const [error, set_error] = useState<string | undefined>();
    const [shown, set_shown] = useState<readonly string[]>([]);
    const prefix = usePrefix({ status, theme });

    useKeypress(async (key: KeypressEvent, rl) => {
        if (status !== "idle") { return; }
        if (isEnterKey(key)) {
            const answer = value === "" ? config.default ?? "" : value;
            const verdict = config.validate === undefined ? true : config.validate(answer);
            if (verdict === true) {
                set_value(answer);
                set_status("done");
                done(answer);
                return;
            }
            // Enter cleared readline's line: put the answer back to be fixed.
            rl.write(value);
            set_error(verdict);
            return;
        }
        if (isTabKey(key)) {
            // Readline has inserted the tab itself.
            const typed = rl.line.replaceAll("\t", "");
            const next = config.complete === undefined ? { line: typed, shown: [] } : complete_line(typed, await config.complete(typed));
            rl.clearLine(0);
            rl.write(next.line);
            set_value(next.line);
            set_shown(next.shown);
            set_error();
            return;
        }
        set_value(rl.line);
        set_error();
        set_shown([]);
    });

    const message = theme.style.message(config.message, status);
    const fallback = config.default !== undefined && config.default !== "" && value === "" && status !== "done"
        ? theme.style.defaultAnswer(config.default)
        : undefined;
    const answer = status === "done" ? theme.style.answer(value) : value;
    const line = [prefix, message, fallback, answer].filter(part => part !== undefined && part !== "").join(" ");
    const below = error === undefined ? shown.join("  ") : theme.style.error(error);
    return [line, below === "" ? undefined : below];
});

/** Ctrl-C (inquirer's `ExitPromptError`), or the Ctrl-D abort of `ask`. */
function is_stop(error: unknown, ctrl_d: AbortSignal): boolean {
    if (!(error instanceof Error)) { return false; }
    return error.name === "ExitPromptError" || (error.name === "AbortPromptError" && ctrl_d.aborted);
}

interface KeyInfo { ctrl?: boolean; name?: string }

export interface PrompterStreams {
    input: NodeJS.ReadStream;
    output: NodeJS.WriteStream;
}

/** The inquirer prompter on `streams`. `terminal` only when both are TTYs (COM-012). */
/** inquirer's choices are mutable. */
function choices<T>(list: readonly Choice<T>[]): { name: string; value: T; description?: string; disabled?: boolean | string }[] {
    return list.map(choice => ({ ...choice }));
}

export function create_prompter(streams: PrompterStreams): Prompter {
    const { input, output } = streams;

    // Readline closes on Ctrl-D without settling an inquirer prompt, so Ctrl-D aborts it.
    const ask = async <T>(run: (context: { input: NodeJS.ReadStream; output: NodeJS.WriteStream; signal: AbortSignal }) => Promise<T>): Promise<T> => {
        const ctrl_d = new AbortController();
        const on_key = (_text: unknown, key?: KeyInfo): void => {
            if (key?.ctrl === true && key.name === "d") { ctrl_d.abort(); }
        };
        input.on("keypress", on_key);
        try {
            return await run({ input, output, signal: ctrl_d.signal });
        } catch (error) {
            if (is_stop(error, ctrl_d.signal)) { throw new PromptCancelled(); }
            throw error;
        } finally {
            input.removeListener("keypress", on_key);
        }
    };

    const terminal: RawTerminal | undefined = input.isTTY === true && output.isTTY === true ? { input, output } : undefined;

    return {
        select: question => ask(context => select({
            message: question.message,
            choices: choices(question.choices),
            default: question.default,
            pageSize: question.page_size,
        }, context)),
        input: question => ask(context => completing_input({
            message: question.message,
            default: question.default,
            validate: question.validate,
            complete: question.complete,
        }, context)),
        confirm: question => ask(context => confirm({ message: question.message, default: question.default }, context)),
        checkbox: question => ask(context => checkbox({
            message: question.message,
            choices: choices(question.choices),
            required: question.required,
        }, context)),
        search: question => ask(context => search({
            message: question.message,
            source: async (term, { signal }) => choices(await question.source(term ?? "", signal)),
        }, context)),
        terminal,
    };
}

if (import.meta.vitest) {
    const { test, expect, describe } = import.meta.vitest;
    const { PassThrough } = await import("node:stream");

    describe("complete_line", () => {
        test("one candidate replaces the line", () => {
            expect(complete_line("sp", ["spi0/"])).toEqual({ line: "spi0/", shown: [] });
        });

        test("several extend the line to what they share and are listed", () => {
            expect(complete_line("s", ["spi0/", "spi1/", "serial0/"])).toEqual({ line: "s", shown: ["spi0/", "spi1/", "serial0/"] });
            expect(complete_line("sp", ["spi0/", "spi1/"])).toEqual({ line: "spi", shown: ["spi0/", "spi1/"] });
        });

        test("candidates that don't start with what is typed are ignored, duplicates once", () => {
            expect(complete_line("i2c", ["spi0/", "i2c1/", "i2c1/"])).toEqual({ line: "i2c1/", shown: [] });
            expect(complete_line("x", ["spi0/"])).toEqual({ line: "x", shown: [] });
            expect(complete_line("", [])).toEqual({ line: "", shown: [] });
        });
    });

    const stream = (tty: boolean): NodeJS.ReadStream & NodeJS.WriteStream => Object.assign(new PassThrough(), { isTTY: tty }) as unknown as NodeJS.ReadStream & NodeJS.WriteStream;
    const pause = (): Promise<void> => new Promise(resolve => { setTimeout(resolve, 20); });

    const streams = (): { input: NodeJS.ReadStream; output: NodeJS.WriteStream; type(text: string): Promise<void> } => {
        const input = new PassThrough() as unknown as NodeJS.ReadStream;
        const output = new PassThrough() as unknown as NodeJS.WriteStream;
        (output as unknown as InstanceType<typeof PassThrough>).resume();
        return {
            input, output,
            async type(text) { (input as unknown as InstanceType<typeof PassThrough>).write(text); await pause(); },
        };
    };

    test("common_prefix", () => {
        expect(common_prefix([])).toBe("");
        expect(common_prefix(["abc"])).toBe("abc");
        expect(common_prefix(["abc", "abd", "ab"])).toBe("ab");
        expect(common_prefix(["abc", "x"])).toBe("");
    });

    test("terminal - only when input and output are both TTYs", () => {
        expect(create_prompter({ input: stream(false), output: stream(true) }).terminal).toBeUndefined();
        expect(create_prompter({ input: stream(true), output: stream(false) }).terminal).toBeUndefined();
        const input = stream(true);
        const output = stream(true);
        expect(create_prompter({ input, output }).terminal).toEqual({ input, output });
    });

    describe("input, driven through streams", () => {
        test("Tab completes what is typed; Enter answers", async () => {
            const io = streams();
            const asked: string[] = [];
            const answer = create_prompter(io).input({
                message: "Parent",
                complete: partial => { asked.push(partial); return Promise.resolve(["spi0/", "spi1/"]); },
            });
            await pause();
            await io.type("s");
            await io.type("\t");
            await io.type("0/adc");
            await io.type("\r");
            expect(await answer).toBe("spi0/adc");
            expect(asked).toEqual(["s"]);
        });

        test("Enter on nothing takes the default; a refused answer is asked again", async () => {
            const io = streams();
            const answer = create_prompter(io).input({ message: "Name", default: "adc", validate: text => text.includes("@") ? true : "needs a unit address" });
            await pause();
            await io.type("\r");
            await io.type("@0\r");
            expect(await answer).toBe("@0");

            const fallback = streams();
            const taken = create_prompter(fallback).input({ message: "Name", default: "adc" });
            await pause();
            await fallback.type("\r");
            expect(await taken).toBe("adc");
        });

        test("Ctrl-C and Ctrl-D cancel", async () => {
            for (const key of ["\u0003", "\u0004"]) {
                const io = streams();
                const answer = create_prompter(io).input({ message: "Name" });
                const settled = answer.then(() => "answered", (error: unknown) => error);
                await pause();
                await io.type(key);
                expect(await settled).toBeInstanceOf(PromptCancelled);
            }
        });
    });

    test("is_stop - Ctrl-C always, an abort only when Ctrl-D caused it", () => {
        const idle = new AbortController();
        const pressed = new AbortController();
        pressed.abort();
        const named = (name: string): Error => Object.assign(new Error("x"), { name });
        expect(is_stop(named("ExitPromptError"), idle.signal)).toBe(true);
        expect(is_stop(named("AbortPromptError"), idle.signal)).toBe(false);
        expect(is_stop(named("AbortPromptError"), pressed.signal)).toBe(true);
        expect(is_stop(new Error("boom"), pressed.signal)).toBe(false);
        expect(is_stop("ExitPromptError", pressed.signal)).toBe(false);
    });
}
