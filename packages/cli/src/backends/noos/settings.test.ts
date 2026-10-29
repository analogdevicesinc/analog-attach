import { SETTINGS_DEFAULTS } from "attach-no-os-lib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { create_noos_fixture, type NoosFixture } from "./testing/fixture";

// The no-OS settings as `config` shows them: the specs of settings.ts (category, required,
// default) and the options hook's scans. The front end owns the listing and the layering
// (front/config.ts, front/settings-store.ts); main.test.ts has the check hook (board takes its
// platform, capi-path must be a checkout).

interface Entry {
    field_name: string;
    category: string;
    type: unknown;
    required: boolean;
    default: string | null;
    value: unknown;
}

const CATEGORIES = ["Sources", "Target", "Workfile", "Project", "Build"];

let fixture: NoosFixture;

beforeEach(() => {
    fixture = create_noos_fixture();
});

afterEach(() => {
    fixture.remove();
});

async function entries(...key: string[]): Promise<Entry[]> {
    const { configs } = await fixture.json(["config", ...key]) as { configs: Entry[] };
    return configs;
}

async function entry(key: string): Promise<Entry | undefined> {
    const [found] = await entries(key);
    return found;
}

describe("config --json", () => {
    it("describes every setting of the lib, with both default and value", async () => {
        fixture.settings();
        const listed = await entries();
        const keys = Object.keys(SETTINGS_DEFAULTS);
        expect(listed.map(config => config.field_name).filter(name => name !== "backend").toSorted()).toEqual(keys.toSorted());
        for (const config of listed) {
            expect(config, `${config.field_name} lacks default`).toHaveProperty("default");
            expect(config, `${config.field_name} lacks value`).toHaveProperty("value");
        }
    });

    it("separates the schema default from the stored value", async () => {
        // `default` is the fallback and nothing else; `value` is what a read returns, so a set
        // value wins and an unset one falls back to the default.
        fixture.settings();
        expect(await entry("probe")).toMatchObject({ default: "openocd", value: "openocd" });
        expect(await fixture.code(["config", "probe", "jlink"])).toBe(0);
        expect(await entry("probe")).toMatchObject({ default: "openocd", value: "jlink" });
        // eslint-disable-next-line unicorn/no-null -- the protocol's null
        expect(await entry("project-name")).toMatchObject({ default: null, value: null });
    });

    it("leaves a required setting with no default reported as missing", async () => {
        // config reports a setting as missing when `required && value === null`, so this is
        // the only shape that gets a setting's hint listed as unset.
        fixture.settings({ "capi-path": undefined });
        // eslint-disable-next-line unicorn/no-null -- the protocol's null
        expect(await entry("capi-path")).toMatchObject({ required: true, default: null, value: null });
    });
});

describe("the options hook", () => {
    it("lists every configured board and chip as the setting's options", async () => {
        fixture.settings();
        const board = await entry("board") as { type: { options: string[] } };
        expect(board.type.options.toSorted()).toEqual(["otherboard", "testboard", "twobusboard"]);
        const platform = await entry("platform") as { type: { options: string[] } };
        expect(platform.type.options).toContain("testsoc");
        // A template set is a bundled name or a folder of your own: no closed list.
        expect(await entry("project-template")).toMatchObject({ type: "string" });
        expect(await entry("workfile")).toMatchObject({ type: "path" });
    });

    it("with no modules to scan, board falls back to its plain type", async () => {
        fixture.settings({ "module-paths": undefined, "board": undefined });
        expect(await entry("board")).toMatchObject({ type: "string" });
    });

    it("completes board and platform values", async () => {
        fixture.settings();
        const boards = await fixture.run(["__complete", "config", "board", ""]);
        expect(boards.stdout.split("\n")).toEqual(expect.arrayContaining(["otherboard", "testboard", "twobusboard"]));
        const platforms = await fixture.run(["__complete", "config", "platform", ""]);
        expect(platforms.stdout.split("\n")).toContain("testsoc");
    });
});

describe("config", () => {
    it("stars every required setting, and only those, and explains the star", async () => {
        fixture.settings();
        const listing = await fixture.text(["config"]);
        const lines = listing.split("\n");
        for (const [key, setting] of Object.entries(SETTINGS_DEFAULTS)) {
            const row = lines.find(line => line.slice(4).startsWith(`${key} `) || line.slice(4) === key);
            expect(row, key).toBeDefined();
            expect(row?.startsWith("  * "), key).toBe(setting.required);
        }
        expect(lines.some(line => line.trim() === "* required")).toBe(true);
    });

    it("groups the settings under their category, in the declared order", async () => {
        fixture.settings();
        const listing = await fixture.text(["config"]);
        const lines = listing.split("\n");
        // A heading is the category alone, indented two; a row is indented four after its mark.
        const headings = lines.filter(line => /^ {2}[A-Z][a-z]+$/.test(line)).map(line => line.trim());
        expect(headings.filter(heading => CATEGORIES.includes(heading))).toEqual(CATEGORIES);

        const titles: Record<string, string> = { sources: "Sources", target: "Target", workfile: "Workfile", project: "Project", build: "Build" };
        for (const [key, setting] of Object.entries(SETTINGS_DEFAULTS)) {
            const row = lines.findIndex(line => line.slice(4).startsWith(`${key} `) || line.slice(4) === key);
            const heading = lines.findLastIndex((line, index) => index < row && /^ {2}[A-Z][a-z]+$/.test(line));
            expect(lines[heading]?.trim(), key).toBe(titles[setting.category]);
        }
    });
});
