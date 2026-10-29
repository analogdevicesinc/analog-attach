import * as fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { create_noos_fixture, type NoosFixture } from "./testing/fixture";

// The no-OS commands driven as a person types them, through the front end's `main`: `list`
// without a kind, `update` that reads, a `rename` without its new name, `build`'s artifact,
// the exit codes, `import` and the backend's skill. The project points at the lib's fixtures,
// as main.test.ts's does; the commands main.test.ts covers are not repeated here.

let fixture: NoosFixture;

beforeEach(() => {
    fixture = create_noos_fixture();
    fixture.settings();
});

afterEach(() => {
    fixture.remove();
});

function workfile(): string {
    return path.join(fixture.project, "workfile.json");
}

describe("list", () => {
    it("names the kinds when given none", async () => {
        const result = await fixture.run(["list"]);
        expect(result.code).toBe(0);
        for (const kind of ["devices", "context", "property", "value"]) {
            expect(result.stdout).toContain(`analog-attach list ${kind}`);
        }
    });
});

describe("update and read", () => {
    it("reads the property when update is given no value", async () => {
        await fixture.sensor();
        const read = await fixture.text(["read", "testpart_spi_dev", "max_speed_hz"]);
        expect(await fixture.text(["update", "testpart_spi_dev", "max_speed_hz"])).toBe(read);
        expect(await fixture.text(["update", "testpart_spi_dev", "max_speed_hz", "--quiet"])).toBe("1000000\n");
    });
});

describe("rename", () => {
    it("needs the new name: an input error", async () => {
        await fixture.sensor();
        const result = await fixture.run(["rename", "testpart_cs_gpio"]);
        expect(result.code).toBe(2);
        expect(result.stderr).toContain("Expected argument for name");
        expect(fixture.stored()["testpart_cs_gpio"]).toBeDefined();
    });
});

describe("build", () => {
    it("reports where the build artifact is, also when build-command does the build", async () => {
        await fixture.sensor();
        const project = path.join(fixture.base, "app");
        fs.mkdirSync(path.join(project, "build"), { recursive: true });
        fs.writeFileSync(path.join(project, "CMakePresets.json"), JSON.stringify({ version: 6, configurePresets: [{ name: "otherboard" }] }));
        fs.writeFileSync(path.join(project, "CMakeLists.txt"), "project(demo_app)\n");
        fs.writeFileSync(path.join(project, "build", "demo_app.elf"), "");
        expect(await fixture.code(["config", "project-path", project])).toBe(0);
        expect(await fixture.code(["config", "build-command", "true"])).toBe(0);

        const built = await fixture.json(["build"]) as { ok: boolean; path?: string };
        expect(built.ok).toBe(true);
        expect(built.path).toBe(path.join(project, "build", "demo_app.elf"));
    });
});

describe("exit codes", () => {
    it("are 0 when the command ran, with or without --json, whatever it found", async () => {
        await fixture.sensor();
        expect(await fixture.code(["delete", "testpart_spi_dev", "max_speed_hz"])).toBe(0);
        for (const argv of [
            ["validate"], ["--json", "validate"],
            ["read", "no_such_node"], ["--json", "read", "no_such_node"],
            ["update", "testpart_spi_dev", "nonsense", "1"],
            ["add", "no_such_schema"],
        ]) {
            expect(await fixture.code(argv), argv.join(" ")).toBe(0);
        }
    });
});

/** A loadable workfile outside the project, and none in it. */
async function exported(): Promise<string> {
    await fixture.sensor();
    const copy = path.join(fixture.base, "elsewhere.json");
    fs.copyFileSync(workfile(), copy);
    fs.rmSync(workfile());
    return copy;
}

describe("import", () => {

    it("copies a workfile that loads to where the workfile setting points", async () => {
        const source = await exported();
        expect(await fixture.text(["import", source])).toContain("Imported a workfile for board otherboard");
        expect(fs.readFileSync(workfile(), "utf8")).toBe(fs.readFileSync(source, "utf8"));
        expect(fixture.stored()["testpart_spi_dev"]).toBeDefined();

        fs.rmSync(workfile());
        expect(await fixture.json(["import", source])).toMatchObject({ ok: true, path: workfile(), source });
    });

    it("never overwrites a workfile", async () => {
        const source = await exported();
        expect(await fixture.code(["init"])).toBe(0);
        const before = fs.readFileSync(workfile(), "utf8");
        expect(await fixture.text(["import", source])).toContain("A workfile already exists");
        expect(fs.readFileSync(workfile(), "utf8")).toBe(before);
    });

    it("refuses a file that does not load here, copying nothing", async () => {
        const source = path.join(fixture.base, "foreign.json");
        fs.writeFileSync(source, JSON.stringify({ platform: "othersoc", symbols: { x: { $compatible: "no_such_schema" } } }));
        expect(await fixture.text(["import", source])).toContain(`Cannot import '${source}'`);
        expect(fs.existsSync(workfile())).toBe(false);
    });

    it("refuses a missing file, and the workfile onto itself", async () => {
        const missing = path.join(fixture.base, "missing.json");
        expect(await fixture.text(["import", missing])).toContain("No workfile at");
        await fixture.sensor();
        expect(await fixture.text(["import", workfile()])).toContain("is already the workfile");
    });
});

describe("skill", () => {
    it("installs the no-OS skill for Claude Code, refuses to overwrite it without --force, and removes it", async () => {
        const installed = path.join(fixture.home, ".claude", "skills", "analog-attach-noos", "SKILL.md");
        const install = async (...flags: string[]): Promise<number> => {
            const result = await fixture.run(["skill", "install", "analog-attach-noos", ...flags], { claude_installed: true });
            return result.code;
        };
        expect(await install()).toBe(0);
        expect(fs.readFileSync(installed, "utf8")).toMatch(/^---\nname: analog-attach-noos\n/);

        const again = await fixture.run(["skill", "install", "analog-attach-noos"], { claude_installed: true });
        expect(`${again.stdout}${again.stderr}`).toContain("already installed");
        expect(await install("--force")).toBe(0);

        expect(await fixture.code(["skill", "uninstall", "analog-attach-noos"])).toBe(0);
        expect(fs.existsSync(path.dirname(installed))).toBe(false);
    });

    it("names the skills there are for one it does not have", async () => {
        const result = await fixture.run(["skill", "install", "linux"], { claude_installed: true });
        expect(result.code).toBe(2);
        expect(result.stderr).toContain("Unknown skill: linux. Skills of the noos backend: analog-attach-noos");
    });
});
