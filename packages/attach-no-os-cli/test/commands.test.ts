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

describe("JSON", () => {
    it("marks each node as stored in the workfile, or a board or driver resource", async () => {
        await sensor();
        const root = JSON.parse(await cli("read", "--json")) as { origin: string, alias: string[], children: { key: string, origin: string, alias: string[] }[] };
        expect(root.origin).toBe("internal");
        expect(root.children.every(child => child.origin === "internal" && Array.isArray(child.alias) && child.alias.length === 0)).toBe(true);

        const device = JSON.parse(await cli("read", "testpart_spi_dev", "--json")) as { origin: string };
        expect(device.origin).toBe("internal");
        const handle = stored()["testpart_spi_dev"]?.controller as string;
        const external = JSON.parse(await cli("read", handle, "--json")) as { origin: string };
        expect(external.origin).toBe("external");
    });

    it("gives a single property's suggestions, values and what can be created", async () => {
        await sensor();
        const mode = JSON.parse(await cli("read", "testpart_spi_dev", "mode", "--json")) as { suggestions: { values: string[], can_create: string[] } };
        expect(mode.suggestions.values).toContain("TEST_SPI_MODE_0");
        expect(Array.isArray(mode.suggestions.can_create)).toBe(true);
        // update with no value reads, so it answers the same.
        expect(JSON.parse(await cli("update", "testpart_spi_dev", "mode", "--json"))).toEqual(mode);
    });

    it("reports where the build artifact is, also when build-command does the build", async () => {
        await sensor();
        const project = path.join(directory, "project");
        fs.mkdirSync(path.join(project, "build"), { recursive: true });
        fs.writeFileSync(path.join(project, "CMakePresets.json"), JSON.stringify({ version: 6, configurePresets: [{ name: "otherboard" }] }));
        fs.writeFileSync(path.join(project, "CMakeLists.txt"), "project(demo_app)\n");
        fs.writeFileSync(path.join(project, "build", "demo_app.elf"), "");
        await cli("config", "project-path", project);
        await cli("config", "build-command", "true");

        const built = JSON.parse(await cli("build", "--json")) as { ok: boolean, path?: string };
        expect(built.ok).toBe(true);
        expect(built.path).toBe(path.join(project, "build", "demo_app.elf"));
    });
});

describe("exit codes", () => {
    // stricli sets the code on the process it is given; each case starts from none.
    afterEach(() => {
        process.exitCode = undefined;
    });

    it("are 0 when the command ran, with or without --json, whatever it found", async () => {
        await sensor();
        await cli("delete", "testpart_spi_dev", "max_speed_hz");
        for (const argv of [
            ["validate"], ["validate", "--json"],
            ["read", "no_such_node"], ["read", "no_such_node", "--json"],
            ["update", "testpart_spi_dev", "nonsense", "1"],
            ["add", "no_such_schema"],
        ]) {
            process.exitCode = undefined;
            await cli(...argv);
            expect(process.exitCode ?? 0, argv.join(" ")).toBe(0);
        }
    });

    it("are not 0 when the CLI cannot run the command at all", async () => {
        await cli("no_such_command");
        expect(process.exitCode).not.toBe(0);
        process.exitCode = undefined;
        await cli("read", "--no-such-flag");
        expect(process.exitCode).not.toBe(0);
    });
});

describe("import", () => {
    async function exported(): Promise<string> {
        await sensor();
        const copy = path.join(directory, "elsewhere.json");
        fs.copyFileSync(path.join(directory, "workfile.json"), copy);
        fs.rmSync(path.join(directory, "workfile.json"));
        return copy;
    }

    it("copies a workfile that loads to where the workfile setting points", async () => {
        const source = await exported();
        const text = await cli("import", source);
        expect(text).toContain("Imported a workfile for board otherboard");
        expect(fs.readFileSync(path.join(directory, "workfile.json"), "utf8")).toBe(fs.readFileSync(source, "utf8"));
        expect(stored()["testpart_spi_dev"]).toBeDefined();

        fs.rmSync(path.join(directory, "workfile.json"));
        const response = JSON.parse(await cli("import", source, "--json")) as { ok: boolean, path: string, source: string };
        expect(response).toMatchObject({ ok: true, path: path.join(directory, "workfile.json"), source });
    });

    it("never overwrites a workfile", async () => {
        const source = await exported();
        await cli("init");
        const before = fs.readFileSync(path.join(directory, "workfile.json"), "utf8");
        expect(await cli("import", source)).toContain("A workfile already exists");
        expect(fs.readFileSync(path.join(directory, "workfile.json"), "utf8")).toBe(before);
    });

    it("refuses a file that does not load here, copying nothing", async () => {
        const source = path.join(directory, "foreign.json");
        fs.writeFileSync(source, JSON.stringify({ platform: "othersoc", symbols: { x: { $compatible: "no_such_schema" } } }));
        expect(await cli("import", source)).toContain(`Cannot import '${source}'`);
        expect(fs.existsSync(path.join(directory, "workfile.json"))).toBe(false);
    });

    it("refuses a missing file, and the workfile onto itself", async () => {
        expect(await cli("import", path.join(directory, "missing.json"))).toContain("No workfile at");
        await sensor();
        expect(await cli("import", path.join(directory, "workfile.json"))).toContain("is already the workfile");
    });
});

describe("skill", () => {
    it("installs the capi skill for Claude Code, refuses to overwrite it without --force, and removes it", async () => {
        const installed = path.join(process.env.HOME ?? "", ".claude/skills/attach-noos-capi/SKILL.md");
        expect(await cli("skill", "install", "capi")).toContain("Installed the capi skill");
        expect(fs.readFileSync(installed, "utf8")).toMatch(/^---\nname: attach-noos-capi\n/);

        expect(await cli("skill", "install", "capi")).toContain("already installed");
        expect(await cli("skill", "install", "capi", "--force")).toContain("Installed the capi skill");

        expect(await cli("skill", "uninstall", "capi")).toContain("Removed the capi skill");
        expect(fs.existsSync(path.dirname(installed))).toBe(false);
        expect(await cli("skill", "uninstall", "capi")).toContain("nothing to remove");
    });

    it("names the skills there are for one it does not have", async () => {
        expect(await cli("skill", "install", "linux")).toContain("No skill called 'linux' here. Available: capi");
    });
});

