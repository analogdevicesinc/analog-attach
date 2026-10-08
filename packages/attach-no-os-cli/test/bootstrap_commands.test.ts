import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { run } from "@stricli/core";
import { reset_registry, set_config_path_override } from "attach-no-os-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../src/app";

// The commands that change a workfile run bootstrap after themselves. These drive the real
// commands, in a project pointed at the lib's fixtures: a jumper-wired board (otherboard),
// so a SPI device gets a GPIO chip-select pin node, and a part that can also go on I2C.

const FIXTURES = path.resolve(import.meta.dirname, "../../attach-no-os-lib/test/fixtures");

let directory: string;
let previous_directory: string;
let printed: string[];

beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "attach-noos-bootstrap-"));
    // The override is the only config read (project configs are ignored under it), so it
    // is never the user's own.
    const config = path.join(directory, "config.json");
    fs.writeFileSync(config, JSON.stringify({
        capi_path: path.join(FIXTURES, "capi"),
        module_paths: [path.join(FIXTURES, "platform"), path.join(FIXTURES, "driver-collection")].join(":"),
        board: "otherboard",
    }));
    set_config_path_override(config);
    previous_directory = process.cwd();
    process.chdir(directory);
    reset_registry();

    printed = [];
    vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
        printed.push(parts.map(String).join(" "));
    });
    vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
        printed.push(parts.map(String).join(" "));
    });
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

async function sensor(): Promise<void> {
    const created = await cli("create-workfile");
    const added = await cli("add", "test_sensor");
    if (!fs.existsSync(path.join(directory, "workfile.json"))) {
        throw new Error(`no workfile: ${created} / ${added}`);
    }
}

describe("bootstrap after each command", () => {
    it("add builds the chain and marks what it set", async () => {
        await sensor();
        const symbols = stored();
        expect(symbols["test_spi_device"]?.$auto).toContain("controller");
        expect(symbols["test_gpio_pin"]).toMatchObject({ number: 4, port_handle: "bsp_other_gpio1_cfg_handle" });
    });

    it("update switching the bus rebuilds it, deleting what nothing uses", async () => {
        await sensor();
        const text = await cli("update", "testpart_init_param", "comm_type", "TESTPART_I2C");

        const symbols = stored();
        expect(symbols["testpart_init_param"]?.comm_init).toEqual({ i2c_dev: "test_i2c_device" });
        expect(symbols["test_spi_device"]).toBeUndefined();
        expect(symbols["test_gpio_pin"]).toBeUndefined();
        expect(text).toContain("Bootstrap deleted what nothing uses any more");
    });

    it("a node the user edited is kept when it stops being used, with a hint", async () => {
        await sensor();
        await cli("update", "test_spi_device", "max_speed_hz", "2000000");
        const text = await cli("update", "testpart_init_param", "comm_type", "TESTPART_I2C");

        expect(stored()["test_spi_device"]?.max_speed_hz).toBe(2_000_000);
        expect(text).toContain("attach-noos delete test_spi_device");
    });

    it("an edited value is the user's, no longer bootstrap's", async () => {
        await sensor();
        await cli("update", "test_spi_device", "max_speed_hz", "2000000");
        expect(stored()["test_spi_device"]?.$auto).not.toContain("max_speed_hz");
    });

    it("resetting a value stores null, and bootstrap leaves it empty", async () => {
        await sensor();
        await cli("delete", "test_spi_device", "max_speed_hz");
        expect(stored()["test_spi_device"]?.max_speed_hz).toBeNull();
    });

    it("deleting the chip-select pin leaves it deleted, and drops its count", async () => {
        await sensor();
        await cli("delete", "test_gpio_pin", "--force");

        const symbols = stored();
        expect(symbols["test_gpio_pin"]).toBeUndefined();
        expect(symbols["test_spi_device"]?.cs_gpio).toBeNull();
        expect(symbols["test_spi_device"]?.cs_gpio_num).toBeUndefined();
    });

    it("deleting the root takes the chain bootstrap built with it", async () => {
        await sensor();
        await cli("delete", "test_sensor");
        expect(stored()).toEqual({});
    });

    it("with the bootstrap setting off, update changes only what it was told", async () => {
        await sensor();
        await cli("tool-config-set", "bootstrap", "false");
        await cli("update", "testpart_init_param", "comm_type", "TESTPART_I2C");

        const symbols = stored();
        expect(symbols["testpart_init_param"]?.comm_init).toEqual({ spi_dev: "test_spi_device" });
        expect(symbols["test_spi_device"]).toBeDefined();
    });
});
