import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { run } from "@stricli/core";
import { get_effective_setting_value, interview_enabled, reset_registry, set_config_path_override } from "attach-no-os-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../src/app";
import { run_interview, type Asker } from "../src/commands/interview";
import { load_context } from "../src/commands/shared";

// The interview, answered by a script instead of a person: what it asks, in which order,
// and what an answer does to the workfile. The project points at the lib's fixtures.

const FIXTURES = path.resolve(import.meta.dirname, "../../attach-no-os-lib/test/fixtures");

let directory: string;
let previous_directory: string;
let printed: string[];

function configure(board: string): void {
    const config = path.join(directory, "config.json");
    fs.writeFileSync(config, JSON.stringify({
        "capi-path": path.join(FIXTURES, "capi"),
        "module-paths": [path.join(FIXTURES, "platform"), path.join(FIXTURES, "driver-collection")].join(":"),
        board,
    }));
    set_config_path_override(config);
    reset_registry();
}

beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "attach-noos-interview-"));
    configure("otherboard");
    previous_directory = process.cwd();
    process.chdir(directory);

    printed = [];
    for (const method of ["log", "error", "warn"] as const) {
        vi.spyOn(console, method).mockImplementation((...parts: unknown[]) => {
            printed.push(parts.map(String).join(" "));
        });
    }
});

afterEach(() => {
    vi.restoreAllMocks();
    process.chdir(previous_directory);
    // eslint-disable-next-line unicorn/no-useless-undefined -- clears the override
    set_config_path_override(undefined);
    reset_registry();
    fs.rmSync(directory, { recursive: true, force: true });
});

async function cli(...argv: string[]): Promise<string> {
    printed = [];
    await run(app, argv, { process });
    return printed.join("\n");
}

function stored(): Record<string, Record<string, unknown>> {
    const file = JSON.parse(fs.readFileSync(path.join(directory, "workfile.json"), "utf8")) as { symbols: Record<string, Record<string, unknown>> };
    return file.symbols;
}

/** An asker that answers from a script, and records what it was asked. */
function scripted(answers: { select?: (choices: string[]) => string, input?: string[] }): Asker & { asked: string[] } {
    const asked: string[] = [];
    const inputs = [...(answers.input ?? [])];
    return {
        asked,
        async select(message, choices) {
            asked.push(message);
            return (answers.select ?? (values => values[0] ?? ""))(choices.map(choice => choice.value));
        },
        async input(message, validate) {
            asked.push(message);
            const value = inputs.shift() ?? "";
            expect(validate(value), `${message}: ${value}`).toBe(true);
            return value;
        },
    };
}

function context() {
    const loaded = load_context();
    if (!loaded.ok) {
        throw new Error(loaded.error.message);
    }
    return loaded.value;
}

describe("the interview", () => {
    it("asks for a value nothing could fill, and the answer is the user's, saved", async () => {
        await cli("init");
        await cli("add", "test_gpio_pin");

        const ask = scripted({ input: ["4"] });
        const result = await run_interview(context(), ask);

        expect(result).toEqual({ answered: 1, skipped: 0, stopped: false });
        expect(ask.asked.some(question => question.startsWith("test_gpio0.number"))).toBe(true);
        const pin = stored()["test_gpio0"];
        expect(pin?.number).toBe(4);
        expect(pin?.$auto ?? []).not.toContain("number");
    });

    it("leaves a skipped value as it was, and asks it only once", async () => {
        await cli("init");
        await cli("add", "test_gpio_pin");

        const ask = scripted({ input: [""] });
        const result = await run_interview(context(), ask);

        expect(result).toMatchObject({ answered: 0, skipped: 1 });
        expect(ask.asked).toHaveLength(1);
        expect(stored()["test_gpio0"]?.number).toBeUndefined();
    });

    it("refuses a typed value the property cannot take, in the prompt", async () => {
        await cli("init");
        await cli("add", "test_gpio_pin");

        let validate: ((value: string) => true | string) | undefined;
        const ask: Asker = {
            select: async () => "",
            input: async (_message, check) => {
                validate = check;
                return "";
            },
        };
        await run_interview(context(), ask);
        expect(validate?.("not a number")).not.toBe(true);
        expect(validate?.("7")).toBe(true);
    });

    it("re-runs bootstrap after each answer: picking the bus settles the chip-select too", async () => {
        // twobusboard has two wired SPI buses, so the controller is a choice bootstrap stops at.
        configure("twobusboard");
        await cli("init");
        await cli("add", "eval-testpart");
        expect(stored()["testpart_spi_dev"]?.cs_gpio).toBeUndefined();

        const ask = scripted({ select: options => options.find(option => option.includes("spi2")) ?? options[0] ?? "" });
        await run_interview(context(), ask);

        const device = stored()["testpart_spi_dev"];
        expect(device?.controller).toBe("bsp_test_spi2_cfg_handle");
        // Asked once, for the bus; the chip-select followed from the wiring.
        expect(ask.asked.filter(question => question.includes("controller"))).toHaveLength(1);
        expect(device?.cs_gpio).toBe("testpart_cs_gpio");
    });

    it("asks nothing when nothing is left", async () => {
        await cli("init");
        await cli("add", "eval-testpart");
        const ask = scripted({});
        expect(await run_interview(context(), ask)).toEqual({ answered: 0, skipped: 0, stopped: false });
        expect(ask.asked).toEqual([]);
    });
});

describe("the interview setting", () => {
    it("is on by default, and can be turned off", async () => {
        expect(interview_enabled()).toBe(true);
        await cli("config", "interview", "false");
        expect(get_effective_setting_value("interview")).toEqual({ ok: true, value: "false" });
        expect(interview_enabled()).toBe(false);
    });

    it("is never used without a terminal: add only lists what is left", async () => {
        // The tests run without a TTY, as a script or a pipe would.
        await cli("init");
        const text = await cli("add", "test_gpio_pin");
        expect(text).toContain("Still yours to set");
        expect(text).not.toContain("A few things only you can tell");
    });
});
