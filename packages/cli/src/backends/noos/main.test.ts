// The no-OS backend through the front end's `main`, in the project of testing/fixture.ts.
// The topic files next to the code go further: settings.test.ts, commands.test.ts and
// commands/{bootstrap_run,interview,setup,shared}.test.ts.

import * as fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { FIXTURES, create_noos_fixture, scripted, type NoosFixture, type RunOptions, type RunResult, type Symbols } from "./testing/fixture";

let fixture: NoosFixture;
let project: string;
let home: string;

const settings = (values?: Record<string, unknown>): void => { fixture.settings(values); };
const config = (): Record<string, unknown> => fixture.config();
const stored = (): Symbols => fixture.stored();
const run = (argv: readonly string[], prompter?: RunOptions["prompter"]): Promise<RunResult> => fixture.run(argv, prompter === undefined ? {} : { prompter });
const json = (argv: readonly string[]): Promise<unknown> => fixture.json(argv);
const text = (argv: readonly string[]): Promise<string> => fixture.text(argv);
const code = (argv: readonly string[]): Promise<number> => fixture.code(argv);
const sensor = (): Promise<void> => fixture.sensor();

beforeEach(() => {
    fixture = create_noos_fixture();
    ({ project, home } = fixture);
});

afterEach(() => {
    fixture.remove();
});

describe("settings", () => {
    test("config board sets its platform with it", async () => {
        settings({ board: undefined });
        const result = await run(["config", "board", "otherboard"]);
        expect(result.code, result.stderr).toBe(0);
        expect(result.stdout).toContain("platform");
        expect(config()).toMatchObject({ board: "otherboard" });
        expect(typeof config()["platform"]).toBe("string");
        expect(await code(["config", "board", "testboard"])).toBe(0);
        expect(config()).toMatchObject({ board: "testboard", platform: "testsoc" });
    });

    test("config board refuses a board no module has", async () => {
        settings({ board: undefined });
        const result = await run(["config", "board", "nonesuch"]);
        expect(config()["board"]).toBeUndefined();
        expect(`${result.stdout}${result.stderr}`).toContain("nonesuch");
    });

    test("config capi-path refuses a folder that is not a capi checkout", async () => {
        settings();
        const result = await run(["config", "capi-path", home]);
        expect(`${result.stdout}${result.stderr}`).toContain("not a capi checkout");
        expect(config()["capi-path"]).toBe(path.join(FIXTURES, "capi"));
    });
});

describe("init and read", () => {
    test("init creates the workfile for the board, and refuses to overwrite it", async () => {
        settings();
        const created = await json(["init"]);
        expect(created).toMatchObject({ ok: true, created: true, path: path.join(project, "workfile.json") });
        expect(fs.existsSync(path.join(project, "workfile.json"))).toBe(true);
        expect(await json(["init"])).toMatchObject({ ok: false, message: expect.stringContaining("already exists") as unknown });
    });

    test("init with no board or platform says how to set one", async () => {
        settings({ board: undefined });
        const result = await run(["init"]);
        expect(result.code).toBe(0);
        expect(result.stdout).toContain("No board or platform configured");
        expect(result.stdout).toContain("analog-attach config board <name>");
    });

    test("a command with no workfile refuses, naming init", async () => {
        settings();
        expect(await json(["read"])).toMatchObject({ ok: false, message: expect.stringContaining("analog-attach init") as unknown });
        expect(await json(["validate"])).toMatchObject({ ok: false });
    });

    test("read: the root, a node, a property with its suggestions", async () => {
        settings();
        await sensor();
        const root = await json(["read"]) as { origin: string; children: { key: string; origin: string; alias: string[] }[] };
        expect(root.origin).toBe("internal");
        expect(root.children.map(child => child.key)).toContain("testpart_spi_dev");
        // Every node the workfile stores is internal, and has no alias.
        expect(root.children.every(child => child.origin === "internal" && Array.isArray(child.alias) && child.alias.length === 0)).toBe(true);
        expect(await json(["read", "testpart_spi_dev"])).toMatchObject({ origin: "internal" });

        const handle = stored()["testpart_spi_dev"]?.["controller"] as string;
        expect(await json(["read", handle])).toMatchObject({ kind: "node", origin: "external" });

        const mode = await json(["read", "testpart_spi_dev", "mode"]) as { suggestions: { values: { value: string }[]; can_create: unknown[] } };
        expect(mode.suggestions.values).toContainEqual({ value: "TEST_SPI_MODE_0" });
        expect(Array.isArray(mode.suggestions.can_create)).toBe(true);
        // update with no value reads, so it answers the same.
        expect(await json(["update", "testpart_spi_dev", "mode"])).toEqual(mode);
    });

    test("read --quiet prints only the values", async () => {
        settings();
        await sensor();
        const names = await text(["read", "--quiet"]);
        expect(names.split("\n")).toContain("testpart_spi_dev");
        const value = await text(["read", "testpart_spi_dev", "max_speed_hz", "--quiet"]);
        expect(value.trim()).toBe("1000000");
        const pin = await text(["read", "testpart_cs_gpio", "--quiet"]);
        expect(pin.split("\n")).toContain("number 4");
    });
});

describe("list", () => {
    test("list devices, filtered", async () => {
        settings();
        await run(["init"]);
        const all = await json(["list", "devices"]) as { devices: { key: string; tag: string }[] };
        expect(all.devices).toContainEqual({ tag: "eval boards", key: "eval-testpart" });
        const filtered = await json(["list", "devices", "eval-"]) as { devices: { key: string }[] };
        expect(filtered.devices.every(device => device.key.includes("eval-"))).toBe(true);
    });

    test("list context: the chips with the boards carrying them", async () => {
        settings();
        const listed = await json(["list", "context"]) as { platforms: { boards: string[] }[]; boards: { name: string }[] };
        expect(listed.boards.map(board => board.name)).toContain("otherboard");
        expect(listed.platforms.some(platform => platform.boards.includes("otherboard"))).toBe(true);
        expect(await text(["list", "context"])).toMatch(/\d+ boards? on \d+ chips?/);
    });

    test("list property: the nodes, then a node's properties with their marks", async () => {
        settings();
        await sensor();
        const nodes = await json(["list", "property"]) as { names: string[] };
        expect(nodes.names).toContain("testpart_spi_dev");
        expect(await text(["list", "property", "testpart_spi_dev"])).toMatch(/max_speed_hz\s+number\s+required, set/);
        expect(await code(["list", "property", "testpart_spi_dev", "mode"])).toBe(2);
    });

    test("list value and update --suggest list the same values, and change nothing", async () => {
        settings();
        await sensor();
        const before = stored();
        const listed = await json(["list", "value", "testpart_spi_dev", "mode"]);
        expect(listed).toMatchObject({ suggestions: expect.arrayContaining([{ value: "TEST_SPI_MODE_0" }]) as unknown });
        expect(await json(["update", "testpart_spi_dev", "mode", "--suggest"])).toEqual(listed);
        expect(stored()).toEqual(before);
        expect(await json(["list", "value", "testpart_spi_dev", "nonsense"])).toMatchObject({ ok: false, message: expect.stringContaining("has no property 'nonsense'") as unknown });
    });
});

describe("add, update, delete, rename", () => {
    test("add builds the chain and lists what is left", async () => {
        settings();
        await run(["init"]);
        const added = await json(["add", "eval-testpart"]) as { ok: boolean; key: string; path: string[]; missing_required: unknown[] };
        expect(added).toMatchObject({ ok: true, key: "eval-testpart", path: ["testpart"] });
        expect(Array.isArray(added.missing_required)).toBe(true);
        expect(stored()["testpart_cs_gpio"]).toMatchObject({ number: 4, port_handle: "bsp_other_gpio1_cfg_handle" });
        // What bootstrap set is marked as its own.
        expect(stored()["testpart_spi_dev"]?.["$auto"]).toContain("controller");
    });

    test("add of a schema lists the required value nothing could fill", async () => {
        settings();
        await run(["init"]);
        const added = await json(["add", "test_gpio_pin"]) as { path: string[]; missing_required: { node: string; property: string }[] };
        expect(added.path).toEqual(["test_gpio0"]);
        expect(added.missing_required).toContainEqual(expect.objectContaining({ node: "test_gpio0", property: "number" }));
    });

    test("add refuses an unknown schema, and needs one (exit 2)", async () => {
        settings();
        await run(["init"]);
        expect(await json(["add", "nonesuch"])).toMatchObject({ ok: false, message: expect.stringContaining("Unknown schema 'nonesuch'") as unknown });
        const bare = await run(["add", "--name", "x"]);
        expect(bare.code).toBe(2);
        expect(bare.stderr).toContain("without a schema");
        const as_schema = await run(["add", "test_gpio_pin", "--as", "adc"]);
        expect(as_schema.code).toBe(2);
    });

    test("update sets a value; a value the property can't take is an input error", async () => {
        settings();
        await sensor();
        expect(await json(["update", "testpart_spi_dev", "max_speed_hz", "2000000"])).toMatchObject({ ok: true });
        expect(stored()["testpart_spi_dev"]?.["max_speed_hz"]).toBe(2_000_000);
        const bad = await run(["update", "testpart_spi_dev", "max_speed_hz", "fast"]);
        expect(bad.code).toBe(2);
        expect(await json(["update", "testpart_spi_dev", "nonsense", "1"])).toMatchObject({ ok: false });
        expect(await code(["update"])).toBe(2);
    });

    test("delete previews a referenced node, and --force deletes it", async () => {
        settings();
        await sensor();
        const preview = await json(["delete", "testpart_cs_gpio"]) as { ok: boolean; node_count: number; severity: string };
        expect(preview).toMatchObject({ ok: true, node_count: 1, severity: "warn" });
        expect(stored()["testpart_cs_gpio"]).toBeDefined();
        expect(await json(["delete", "testpart_cs_gpio", "--force"])).toMatchObject({ ok: true });
        expect(stored()["testpart_cs_gpio"]).toBeUndefined();
    });

    test("delete <node> <property> resets one value", async () => {
        settings();
        await sensor();
        expect(await json(["delete", "testpart_spi_dev", "max_speed_hz"])).toMatchObject({ ok: true, message: "Reset testpart_spi_dev.max_speed_hz" });
        expect(stored()["testpart_spi_dev"]?.["max_speed_hz"]).toBeNull();
    });

    test("rename keeps the references", async () => {
        settings();
        await sensor();
        expect(await text(["rename", "testpart_cs_gpio", "cs_pin"])).toContain("Renamed 'testpart_cs_gpio' to 'cs_pin'");
        expect(stored()["testpart_spi_dev"]?.["cs_gpio"]).toBe("cs_pin");
    });

    test("validate: an empty errors list is the success", async () => {
        settings();
        await sensor();
        const validation = await json(["validate"]) as { errors: unknown[]; warnings: unknown[] };
        expect(Array.isArray(validation.errors)).toBe(true);
        expect(Array.isArray(validation.warnings)).toBe(true);
    });
});

describe("on a terminal", () => {
    test("add asks for what is left, and the answer is the user's", async () => {
        settings({ interview: "true" });
        await run(["init"]);
        const prompter = scripted(["4"]);
        const result = await run(["add", "test_gpio_pin"], prompter);
        expect(result.code, result.stderr).toBe(0);
        expect(prompter.asked.some(question => question.startsWith("test_gpio0.number"))).toBe(true);
        expect(result.stdout).toContain("Added 'test_gpio0'");
        expect(result.stdout).toContain("test_gpio0.number = 4");
        expect(stored()["test_gpio0"]?.["number"]).toBe(4);
        // The answer is the user's, not bootstrap's.
        expect(stored()["test_gpio0"]?.["$auto"] ?? []).not.toContain("number");
    });

    test("stopping the interview keeps the node, and exits 0", async () => {
        settings({ interview: "true" });
        await run(["init"]);
        const result = await run(["add", "test_gpio_pin"], scripted([]));
        expect(result.code).toBe(0);
        expect(result.stdout).toContain("Stopped.");
        expect(stored()["test_gpio0"]).toBeDefined();
    });

    test("add --quiet lists what is left instead of asking", async () => {
        settings({ interview: "true" });
        await run(["init"]);
        const prompter = scripted([]);
        const result = await run(["add", "test_gpio_pin", "--quiet"], prompter);
        expect(result.code).toBe(0);
        expect(prompter.asked).toEqual([]);
        expect(result.stdout).toContain("Still yours to set");
    });

    test("the bare run asks for the board, then runs init", async () => {
        settings({ board: undefined });
        const prompter = scripted(["otherboard", true]);
        const result = await run([], prompter);
        expect(result.code, result.stderr).toBe(0);
        expect(prompter.asked).toEqual(["Which board?", "Create workfile.json for otherboard?"]);
        expect(config()).toMatchObject({ board: "otherboard" });
        expect(result.stdout).toContain("Created a workfile for board otherboard");
        expect(fs.existsSync(path.join(project, "workfile.json"))).toBe(true);
    });

    test("the bare run stopped at a prompt exits 130, what was answered saved", async () => {
        settings({ board: undefined });
        const result = await run([], scripted(["otherboard"]));
        expect(result.code).toBe(130);
        expect(config()).toMatchObject({ board: "otherboard" });
        expect(fs.existsSync(path.join(project, "workfile.json"))).toBe(false);
    });
});

describe("help and completion", () => {
    test("--help lists generate and the backend's words", async () => {
        settings();
        const result = await run(["--help"]);
        expect(result.code).toBe(0);
        expect(result.stdout).toContain("generate");
    });

    test("completion offers node names and a node's properties", async () => {
        settings();
        await sensor();
        const nodes = await run(["__complete", "read", ""]);
        expect(nodes.stdout).toContain("testpart_spi_dev");
        const properties = await run(["__complete", "read", "testpart_spi_dev", ""]);
        expect(properties.stdout).toContain("max_speed_hz");
    });
});
