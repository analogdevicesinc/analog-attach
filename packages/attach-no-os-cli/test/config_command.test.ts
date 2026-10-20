import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { run } from "@stricli/core";
import { get_effective_setting_value, reset_registry, set_config_path_override } from "attach-no-os-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../src/app";

// `config` reads with a key alone (or none) and writes with a value too. These drive the
// real command against a throwaway config pointed at the lib's fixtures.

const FIXTURES = path.resolve(import.meta.dirname, "../../attach-no-os-lib/test/fixtures");

let directory: string;
let previous_directory: string;
let printed: string[];

beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "attach-noos-config-"));
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

function configured(key: "board" | "platform" | "project_name"): string | undefined {
    const value = get_effective_setting_value(key);
    return value.ok ? value.value : undefined;
}

describe("config", () => {
    it("with no key lists every setting", async () => {
        const out = await cli("config");
        expect(out).toContain("* board");
        expect(out).toContain("project_name");
        expect(out).toContain("* required:");
    });

    it("with a key alone shows that setting and how to set it, and changes nothing", async () => {
        const out = await cli("config", "board");
        expect(out).toContain("Value:        otherboard");
        expect(out).toContain("attach-noos config board <value>");
        expect(configured("board")).toBe("otherboard");
    });

    it("with a key and a value writes it", async () => {
        const out = await cli("config", "project_name", "demo");
        expect(out).toContain("Set 'project_name' to 'demo'");
        expect(configured("project_name")).toBe("demo");
    });

    it("with --reset clears it", async () => {
        await cli("config", "project_name", "demo");
        const out = await cli("config", "project_name", "--reset");
        expect(out).toContain("Cleared 'project_name'");
        expect(configured("project_name")).toBeUndefined();
    });

    it("keeps board and platform agreeing on a write", async () => {
        await cli("config", "board", "testboard");
        expect(configured("board")).toBe("testboard");
        expect(configured("platform")).toBe("testsoc");
    });

    it("refuses an unknown key", async () => {
        expect(await cli("config", "no_such_key")).toContain("Unknown setting: no_such_key");
    });

    it("refuses a value and --reset together, writing nothing", async () => {
        expect(await cli("config", "project_name", "demo", "--reset")).toContain("not both");
        expect(configured("project_name")).toBeUndefined();
    });

    it("refuses --reset or --local without a key", async () => {
        expect(await cli("config", "--reset")).toContain("need a setting");
        expect(await cli("config", "--local")).toContain("need a setting");
    });

    it("refuses --local on a read, since nothing is written", async () => {
        expect(await cli("config", "board", "--local")).toContain("--local only applies when writing");
    });
});
