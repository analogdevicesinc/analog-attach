import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { run } from "@stricli/core";
import { reset_registry, set_config_path_override } from "attach-no-os-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../src/app";

// The reshaped commands, driven as a person types them: `list <kind>`, `update` that reads or
// suggests, `read --quiet`, a positional `rename`, and `completion` for three shells. The
// project points at the lib's fixtures, as bootstrap_commands.test.ts does.

const FIXTURES = path.resolve(import.meta.dirname, "../../attach-no-os-lib/test/fixtures");

let directory: string;
let previous_directory: string;
let previous_home: string | undefined;
let printed: string[];

beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "attach-noos-commands-"));
    const config = path.join(directory, "config.json");
    fs.writeFileSync(config, JSON.stringify({
        "capi-path": path.join(FIXTURES, "capi"),
        "module-paths": [path.join(FIXTURES, "platform"), path.join(FIXTURES, "driver-collection")].join(":"),
        board: "otherboard",
    }));
    set_config_path_override(config);
    previous_directory = process.cwd();
    process.chdir(directory);
    // Completion installs under the home directory: this one, never the user's.
    previous_home = process.env.HOME;
    process.env.HOME = path.join(directory, "home");
    reset_registry();

    printed = [];
    vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
        printed.push(parts.map(String).join(" "));
    });
    vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
        printed.push(parts.map(String).join(" "));
    });
    // stricli writes its own help straight to stdout, not through console.log.
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
        printed.push(String(chunk).trimEnd());
        return true;
    });
});

afterEach(() => {
    vi.restoreAllMocks();
    process.chdir(previous_directory);
    process.env.HOME = previous_home;
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

async function sensor(): Promise<void> {
    await cli("init");
    await cli("add", "eval-testpart");
}

function stored(): Record<string, Record<string, unknown>> {
    const file = JSON.parse(fs.readFileSync(path.join(directory, "workfile.json"), "utf8")) as { symbols: Record<string, Record<string, unknown>> };
    return file.symbols;
}

describe("list <kind>", () => {
    it("lists the kinds when given none", async () => {
        const text = await cli("list");
        for (const kind of ["devices", "context", "property", "value"]) {
            expect(text).toContain(`attach-noos list ${kind}`);
        }
    });

    it("lists the devices, filtered by a positional", async () => {
        await cli("init");
        const all = await cli("list", "devices");
        expect(all).toContain("eval-testpart");
        const filtered = await cli("list", "devices", "eval-");
        expect(filtered).toContain("eval-testpart");
        expect(filtered).not.toContain("testpart_init_param");
    });

    it("lists the chips with the boards carrying them", async () => {
        const text = await cli("list", "context");
        expect(text).toContain("otherboard");
        expect(text).toMatch(/\d+ boards? on \d+ chips?/);
    });

    it("lists the nodes, or one node's properties with their marks", async () => {
        await sensor();
        expect((await cli("list", "property")).split("\n")).toContain("testpart_spi_dev");
        expect(await cli("list", "property", "testpart_spi_dev")).toMatch(/max_speed_hz\s+number\s+required, set/);
    });

    it("lists the values a property can take", async () => {
        await sensor();
        expect(await cli("list", "value", "testpart_spi_dev", "mode")).toContain("TEST_SPI_MODE_0");
    });

    it("refuses a property the node does not have", async () => {
        await sensor();
        expect(await cli("list", "value", "testpart_spi_dev", "nonsense")).toContain("has no property 'nonsense'");
    });
});

describe("update and read", () => {
    it("reads the property when update is given no value", async () => {
        await sensor();
        const read = await cli("read", "testpart_spi_dev", "max_speed_hz");
        expect(await cli("update", "testpart_spi_dev", "max_speed_hz")).toBe(read);
        expect(await cli("update", "testpart_spi_dev", "max_speed_hz", "--quiet")).toBe("1000000");
    });

    it("lists what a property can be set to with --suggest, and changes nothing", async () => {
        await sensor();
        const before = stored();
        expect(await cli("update", "testpart_spi_dev", "mode", "--suggest")).toContain("TEST_SPI_MODE_0");
        expect(stored()).toEqual(before);
    });

    it("prints only the values with read --quiet", async () => {
        await sensor();
        expect((await cli("read", "--quiet")).split("\n")).toContain("testpart_spi_dev");
        expect(await cli("read", "testpart_spi_dev", "max_speed_hz", "--quiet")).toBe("1000000");
        expect((await cli("read", "testpart_cs_gpio", "--quiet")).split("\n")).toContain("number 4");
    });
});

describe("rename", () => {
    it("takes the new name as a positional and keeps references", async () => {
        await sensor();
        expect(await cli("rename", "testpart_cs_gpio", "cs_pin")).toContain("Renamed 'testpart_cs_gpio' to 'cs_pin'");
        expect(stored()["testpart_spi_dev"]?.cs_gpio).toBe("cs_pin");
    });

    it("asks for the new name when it is missing", async () => {
        await sensor();
        expect(await cli("rename", "testpart_cs_gpio")).toContain("No new name for 'testpart_cs_gpio'");
    });
});

describe("completion", () => {
    it("prints each shell's script, and refuses an unknown shell", async () => {
        expect(await cli("completion", "bash")).toContain("complete -o nosort -F _attach_noos_complete attach-noos");
        expect(await cli("completion", "fish")).toContain("complete -c attach-noos");
        expect(await cli("completion", "zsh")).toContain("#compdef attach-noos");
        expect(await cli("completion", "tcsh")).toContain("Unknown shell 'tcsh'");
    });

    it("installs for the user and uninstalls, changing nothing else", async () => {
        const home = process.env.HOME ?? "";
        expect(await cli("completion", "fish", "--install")).toContain("Installed the fish completion");
        const installed = path.join(home, ".config/fish/completions/attach-noos.fish");
        expect(fs.readFileSync(installed, "utf8")).toContain("complete -c attach-noos");
        expect(await cli("completion", "fish", "--uninstall")).toContain("Removed the fish completion");
        expect(fs.existsSync(installed)).toBe(false);
        expect(await cli("completion", "fish", "--uninstall")).toContain("nothing to remove");
    });

    it("refuses --install and --uninstall together", async () => {
        expect(await cli("completion", "bash", "--install", "--uninstall")).toContain("not both");
    });
});
