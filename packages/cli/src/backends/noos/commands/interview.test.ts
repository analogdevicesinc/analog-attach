import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { create_noos_fixture, interviewer, type NoosFixture } from "../testing/fixture";

// The interview `add` runs on a terminal, answered by a script instead of a person: what it
// asks, in which order, and what an answer does to the workfile. The project points at the
// lib's fixtures. (main.test.ts has an answered value, a stopped interview and add --quiet.)

let fixture: NoosFixture;

beforeEach(() => {
    fixture = create_noos_fixture();
    fixture.settings({ interview: "true" });
});

afterEach(() => {
    fixture.remove();
});

describe("the interview", () => {
    it("leaves a skipped value as it was, and asks it only once", async () => {
        expect(await fixture.code(["init"])).toBe(0);
        const ask = interviewer({ input: [""] });
        const result = await fixture.run(["add", "test_gpio_pin"], { prompter: ask });

        expect(result.code, result.stderr).toBe(0);
        expect(ask.asked).toHaveLength(1);
        expect(ask.asked[0]).toMatch(/^test_gpio0\.number/);
        expect(fixture.stored()["test_gpio0"]?.["number"]).toBeUndefined();
    });

    it("refuses a typed value the property cannot take, in the prompt", async () => {
        expect(await fixture.code(["init"])).toBe(0);
        const ask = interviewer({ input: [""] });
        await fixture.run(["add", "test_gpio_pin"], { prompter: ask });

        const [validate] = ask.validators;
        expect(validate?.("not a number")).not.toBe(true);
        expect(validate?.("7")).toBe(true);
        expect(validate?.("")).toBe(true);
    });

    it("re-runs bootstrap after each answer: picking the bus settles the chip-select too", async () => {
        // twobusboard has two wired SPI buses, so the controller is a choice bootstrap stops at.
        fixture.settings({ interview: "true", board: "twobusboard" });
        expect(await fixture.code(["init"])).toBe(0);
        const ask = interviewer({ select: options => options.find(option => option.includes("spi2")) ?? options[0] ?? "" });
        const result = await fixture.run(["add", "eval-testpart"], { prompter: ask });
        expect(result.code, result.stderr).toBe(0);

        const device = fixture.stored()["testpart_spi_dev"];
        expect(device?.["controller"]).toBe("bsp_test_spi2_cfg_handle");
        // Asked once, for the bus; the chip-select followed from the wiring.
        expect(ask.asked.filter(question => question.includes("controller"))).toHaveLength(1);
        expect(device?.["cs_gpio"]).toBe("testpart_cs_gpio");
    });

    it("asks nothing when nothing is left", async () => {
        expect(await fixture.code(["init"])).toBe(0);
        const ask = interviewer();
        const result = await fixture.run(["add", "eval-testpart"], { prompter: ask });
        expect(result.code, result.stderr).toBe(0);
        expect(ask.asked).toEqual([]);
        expect(result.stdout).not.toContain("A few things only you can tell");
    });
});

describe("the interview setting", () => {
    it("is on by default, and can be turned off", async () => {
        fixture.settings({ interview: undefined });
        expect(await fixture.code(["init"])).toBe(0);
        const on = interviewer();
        await fixture.run(["add", "test_gpio_pin"], { prompter: on });
        expect(on.asked).toHaveLength(1);

        expect(await fixture.code(["config", "interview", "false"])).toBe(0);
        expect(fixture.config()).toMatchObject({ interview: "false" });
        const off = interviewer();
        const result = await fixture.run(["add", "test_gpio_pin"], { prompter: off });
        expect(off.asked).toEqual([]);
        expect(result.stdout).toContain("Still yours to set");
    });

    it("is never used without a terminal: add only lists what is left", async () => {
        // No prompter: the run is off a terminal, as a script or a pipe would be.
        expect(await fixture.code(["init"])).toBe(0);
        const result = await fixture.run(["add", "test_gpio_pin"]);
        expect(result.stdout).toContain("Still yours to set");
        expect(result.stdout).not.toContain("A few things only you can tell");
    });
});
