// Printing an `Outcome` and the exit status of each kind (D-06). A backend never touches
// stdout or stderr: it returns an `Outcome`, and only the side that is printed is forced
// (`Lazy` response under `--json`, the `Render` otherwise).

import { PromptCancelled, type Lazy, type Outcome, type Style } from "../interface/backend-interface";

export const EXIT_OK = 0;
export const EXIT_CRASH = 1;
export const EXIT_INPUT_ERROR = 2;
export const EXIT_CANCELLED = 130;

/** What output is written to: `process.stdout` / `process.stderr`, or a test's capture. */
export interface OutputStream {
    isTTY?: boolean;
    write(chunk: string): boolean;
}

export interface OutputStreams {
    stdout: OutputStream;
    stderr: OutputStream;
}

/** `JSON.stringify` replacer for DTS cell arrays, which are `bigint` (attach-cli's `bigIntReplacer`). */
export function big_int_replacer(_key: string, value: unknown): unknown {
    return typeof value === "bigint" ? Number(value) : value;
}

/** The value of a `Lazy`, calling its thunk (and awaiting it) when it is one. */
export async function force<T>(lazy: Lazy<T>): Promise<T> {
    return typeof lazy === "function" ? await (lazy as () => T | Promise<T>)() : lazy;
}

export interface PrintOptions {
    /** `--json`: the response is printed, as one line. Otherwise the text. */
    json: boolean;
    style: Style;
    streams: OutputStreams;
}

function print_line(stream: OutputStream, text: string): void {
    stream.write(`${text}\n`);
}

/** Print `outcome` and give its exit status. */
export async function print_outcome(outcome: Outcome<unknown>, options: PrintOptions): Promise<number> {
    const { json, style, streams } = options;
    switch (outcome.kind) {
        case "answer":
        case "refused": {
            if (json) {
                const response: unknown = outcome.kind === "answer" ? await force(outcome.response) : outcome.response;
                print_line(streams.stdout, JSON.stringify(response, big_int_replacer));
            } else {
                const text = outcome.text(style);
                if (text !== "") { print_line(streams.stdout, text); }
            }
            return EXIT_OK;
        }
        case "input-error": {
            print_line(streams.stderr, outcome.message);
            return EXIT_INPUT_ERROR;
        }
        case "cancelled": {
            print_line(streams.stdout, outcome.message);
            return EXIT_CANCELLED;
        }
    }
}

function message_of(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * Run a command and print how it ended. A `PromptCancelled` that reaches here means nothing
 * was written: its message on stdout, exit 130. Any other throw is a crash: its message on
 * stderr, exit 1. A throw while forcing the response or rendering the text counts the same.
 */
export async function run_outcome(run: () => Promise<Outcome<unknown>>, options: PrintOptions): Promise<number> {
    try {
        return await print_outcome(await run(), options);
    } catch (error) {
        if (error instanceof PromptCancelled) {
            print_line(options.streams.stdout, error.message);
            return EXIT_CANCELLED;
        }
        print_line(options.streams.stderr, message_of(error));
        return EXIT_CRASH;
    }
}

/** A stream that keeps what is written, for tests. */
export interface CapturedStream extends OutputStream {
    readonly text: string;
}

export function capture_stream(tty = false): CapturedStream {
    let written = "";
    return {
        isTTY: tty,
        write(chunk: string) { written += chunk; return true; },
        get text() { return written; },
    };
}

if (import.meta.vitest) {
    const { test, expect, describe } = import.meta.vitest;
    const { answer, refuse, input_error, cancelled } = await import("../interface/backend-interface");
    const { create_style } = await import("./session");
    const { create_fake_backend } = await import("./testing/fake-backend");

    const run = async (json: boolean, body: () => Promise<Outcome<unknown>>): Promise<{ code: number; stdout: string; stderr: string }> => {
        const stdout = capture_stream();
        const stderr = capture_stream();
        const code = await run_outcome(body, { json, style: create_style(false), streams: { stdout, stderr } });
        return { code, stdout: stdout.text, stderr: stderr.text };
    };

    describe("exit status and stream per outcome kind", () => {
        test("answer - exit 0, the response as one JSON line, or the text", async () => {
            const outcome = answer({ ok: true, message: "Added", severity: "info", cells: [1n, 2n] }, "Added adc@0");
            expect(await run(true, () => Promise.resolve(outcome))).toEqual({ code: 0, stdout: `{"ok":true,"message":"Added","severity":"info","cells":[1,2]}\n`, stderr: "" });
            expect(await run(false, () => Promise.resolve(outcome))).toEqual({ code: 0, stdout: "Added adc@0\n", stderr: "" });
        });

        test("answer - an empty text prints nothing", async () => {
            expect(await run(false, () => Promise.resolve(answer({ ok: true }, "")))).toEqual({ code: 0, stdout: "", stderr: "" });
        });

        test("refused - exit 0, the ok: false response, or the text", async () => {
            const outcome = refuse("No such node: spi9", { text: "Cannot read spi9" });
            expect(await run(true, () => Promise.resolve(outcome))).toEqual({ code: 0, stdout: `{"ok":false,"message":"No such node: spi9","severity":"error"}\n`, stderr: "" });
            expect(await run(false, () => Promise.resolve(outcome))).toEqual({ code: 0, stdout: "Cannot read spi9\n", stderr: "" });
        });

        test("input-error - stderr, exit 2, in both modes", async () => {
            for (const json of [true, false]) {
                expect(await run(json, () => Promise.resolve(input_error("Unknown macro FOO")))).toEqual({ code: 2, stdout: "", stderr: "Unknown macro FOO\n" });
            }
        });

        test("cancelled - stdout, exit 130, in both modes", async () => {
            for (const json of [true, false]) {
                expect(await run(json, () => Promise.resolve(cancelled("Setup cancelled.")))).toEqual({ code: 130, stdout: "Setup cancelled.\n", stderr: "" });
            }
        });

        test("a thrown PromptCancelled is exit 130 on stdout; any other throw is exit 1 on stderr", async () => {
            for (const json of [true, false]) {
                expect(await run(json, () => Promise.reject(new PromptCancelled()))).toEqual({ code: 130, stdout: "Cancelled.\n", stderr: "" });
                expect(await run(json, () => Promise.reject(new Error("boom")))).toEqual({ code: 1, stdout: "", stderr: "boom\n" });
            }
        });
    });

    describe("laziness", () => {
        test("a JSON run never calls the Render; a text run never calls the response thunk", async () => {
            let rendered = 0;
            let built = 0;
            const outcome = answer(() => { built += 1; return Promise.resolve({ ok: true }); }, () => { rendered += 1; return "text"; });
            expect(await run(true, () => Promise.resolve(outcome))).toMatchObject({ stdout: `{"ok":true}\n` });
            expect([built, rendered]).toEqual([1, 0]);
            expect(await run(false, () => Promise.resolve(outcome))).toMatchObject({ stdout: "text\n" });
            expect([built, rendered]).toEqual([1, 1]);
        });

        test("the Render gets the session's style", async () => {
            const stdout = capture_stream();
            await print_outcome(answer({}, style => style.bold("x")), { json: false, style: create_style(true), streams: { stdout, stderr: capture_stream() } });
            expect(stdout.text).toBe("\u001B[1mx\u001B[22m\n");
        });

        test("a throw while forcing the response is a crash", async () => {
            const outcome = answer(() => { throw new Error("lazy boom"); }, "never");
            expect(await run(true, () => Promise.resolve(outcome))).toEqual({ code: 1, stdout: "", stderr: "lazy boom\n" });
        });
    });

    test("the fake backend's commands end with each kind", async () => {
        const { backend, counters } = create_fake_backend();
        const session = {} as Parameters<NonNullable<typeof backend.commands.read>["run"]>[2];
        const codes: number[] = [];
        for (const [json, body] of [
            [true, () => backend.commands.read!.run({ quiet: false }, {}, session)],
            [false, () => backend.commands.delete!.run({ force: false }, {}, session)],
            [false, () => backend.commands.rename!.run({ path: "a", name: "b" }, {}, session)],
            [false, () => backend.commands.update!.run({ values: [], quiet: false }, {}, session)],
            [false, () => backend.commands.add!.run({ quiet: false }, {}, session)],
            [false, () => backend.commands.validate!.run({}, {}, session)],
        ] as const) {
            const { code } = await run(json, body);
            codes.push(code);
        }
        expect(codes).toEqual([0, 0, 2, 130, 130, 1]);
        expect(counters).toEqual({ read_response: 1, read_render: 0 });
    });
}
