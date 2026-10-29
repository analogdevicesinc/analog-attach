import * as fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { create_noos_fixture, type NoosFixture } from "../testing/fixture";

// The commands that change a workfile run bootstrap after themselves. These drive the real
// commands through the front end's `main`, in a project pointed at the lib's fixtures: a
// jumper-wired board (otherboard), so a SPI device gets a GPIO chip-select pin node, and a
// part that can also go on I2C. (main.test.ts has add's chain and delete's reset.)

let fixture: NoosFixture;

beforeEach(() => {
    fixture = create_noos_fixture();
    fixture.settings();
});

afterEach(() => {
    fixture.remove();
});

/** A run that must exit 0: what it printed. */
async function cli(...argv: string[]): Promise<{ stdout: string; stderr: string }> {
    const result = await fixture.run(argv);
    expect(result.code, `${argv.join(" ")}: ${result.stderr}`).toBe(0);
    return result;
}

describe("bootstrap after each command", () => {
    it("update switching the bus rebuilds it, deleting what nothing uses", async () => {
        await fixture.sensor();
        const { stdout } = await cli("update", "testpart_ip", "comm_type", "TESTPART_I2C");

        const symbols = fixture.stored();
        expect(symbols["testpart_ip"]?.["comm_init"]).toEqual({ i2c_dev: "testpart_i2c_dev" });
        expect(symbols["testpart_spi_dev"]).toBeUndefined();
        expect(symbols["testpart_cs_gpio"]).toBeUndefined();
        expect(stdout).toContain("Bootstrap deleted what nothing uses any more");
    });

    it("a node the user edited is kept when it stops being used, with a hint", async () => {
        await fixture.sensor();
        await cli("update", "testpart_spi_dev", "max_speed_hz", "2000000");
        const { stdout } = await cli("update", "testpart_ip", "comm_type", "TESTPART_I2C");

        expect(fixture.stored()["testpart_spi_dev"]?.["max_speed_hz"]).toBe(2_000_000);
        expect(stdout).toContain("analog-attach delete testpart_spi_dev");
    });

    it("an edited value is the user's, no longer bootstrap's", async () => {
        await fixture.sensor();
        await cli("update", "testpart_spi_dev", "max_speed_hz", "2000000");
        expect(fixture.stored()["testpart_spi_dev"]?.["$auto"]).not.toContain("max_speed_hz");
    });

    it("deleting the chip-select pin leaves it deleted, and drops its count", async () => {
        await fixture.sensor();
        await cli("delete", "testpart_cs_gpio", "--force");

        const symbols = fixture.stored();
        expect(symbols["testpart_cs_gpio"]).toBeUndefined();
        expect(symbols["testpart_spi_dev"]?.["cs_gpio"]).toBeNull();
        expect(symbols["testpart_spi_dev"]?.["cs_gpio_num"]).toBeUndefined();
    });

    it("deleting the eval board leaves the part as a bare one", async () => {
        await cli("init");
        await cli("add", "testpart");
        const bare = fixture.stored();
        fs.rmSync(path.join(fixture.project, "workfile.json"));

        await fixture.sensor();
        await cli("delete", "eval_testpart");
        expect(fixture.stored()).toEqual(bare);
    });

    it("a link to a node already in the workfile is reported, not only what was created", async () => {
        await cli("init");
        await cli("add", "test_spi_device");
        const { stdout } = await cli("add", "testpart");
        // The unused SPI device is reused: the connection is the only trace of it.
        expect(stdout).toMatch(/> testpart_ip\.comm_init\.spi_dev\s+test_spi_device0 \(already in the workfile\)/);
    });

    it("a required value with nothing to fill it from is listed as the user's to set", async () => {
        await cli("init");
        const { stdout } = await cli("add", "test_gpio_pin");
        expect(stdout).toContain("Still yours to set");
        expect(stdout).toMatch(/! test_gpio0\.number\s+number\s+Pin number within its port/);
        expect(stdout).toContain("analog-attach update test_gpio0 number <value>");
        // A value bootstrap offers options for is a choice, listed there and not again.
        expect(stdout).not.toMatch(/! test_gpio0\.port_handle/);
    });

    it("a schema added by itself is numbered, not named after its type", async () => {
        await cli("init");
        await cli("add", "test_gpio_pin");
        await cli("add", "test_gpio_pin");
        await cli("add", "test_gpio_pin", "--name", "led");
        const names = Object.keys(fixture.stored());
        expect(names).toEqual(expect.arrayContaining(["test_gpio0", "test_gpio1", "led"]));
        expect(names).not.toContain("test_gpio_pin");
    });

    it("read names each field's type as the schema writes it, in its own column", async () => {
        await fixture.sensor();
        const { stdout } = await cli("read", "testpart_cfg");
        expect(stdout).toMatch(/extra\s+driver_init_param\s+testpart_ip/);
        expect(stdout).toMatch(/ops\s+driver_ops\s+testpart_ops/);
        expect(stdout).not.toContain("DriverInitParameterProperty");
    });

    it("a bare part, with no eval board, is not wired and says why", async () => {
        await cli("init");
        const { stdout } = await cli("add", "testpart");
        expect(fixture.stored()["testpart_spi_dev"]?.["cs_gpio"]).toBeUndefined();
        expect(stdout).toContain("no eval board carries this testpart");
        // With two SPI buses on otherboard the controller is still a choice, so which board
        // pins the bus is on is not known yet either.
        expect(stdout).not.toContain("Its bus is on");
    });

    it("with the bootstrap setting off, update changes only what it was told", async () => {
        await fixture.sensor();
        await cli("config", "bootstrap", "false");
        await cli("update", "testpart_ip", "comm_type", "TESTPART_I2C");

        const symbols = fixture.stored();
        expect(symbols["testpart_ip"]?.["comm_init"]).toEqual({ spi_dev: "testpart_spi_dev" });
        expect(symbols["testpart_spi_dev"]).toBeDefined();
    });
});
