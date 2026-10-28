import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020";
import {
    PATH_LIST_DELIMITER,
    SETTINGS_DEFAULTS,
    SETTING_CATEGORIES,
    reset_registry,
    set_config_path_override,
    set_settings,
    type SettingsFile
} from "attach-no-os-lib";
import { afterEach, describe, expect, it } from "vitest";
import { format_configs, to_config } from "../src/commands/config";
import { setting_options } from "../src/completion/completion";

/**
 * attach-meta deserializes each `Config` into a struct with no serde defaults, so a
 * response missing one member is not a partly-usable config: `from_value` fails, `init`
 * silently reads the config as complete, and the first command runs without the settings
 * it needs. That failure is invisible from this side, which is why the shape is asserted
 * against attach-meta's own schema instead of a hand-written expectation.
 *
 * The schema lives in the attach-meta repository. Without that checkout next door the
 * schema-shaped assertions are skipped and only what we can state alone is checked.
 */
const RESPONSES_SCHEMA_PATH = find_responses_schema();

function find_responses_schema(): string | undefined {
    const candidates = [
        process.env.AA_META_RESPONSES_SCHEMA,
        path.resolve(import.meta.dirname, "../../../../aa-meta/docs/schemas/responses.schema.json"),
        path.resolve(os.homedir(), "adi/aa-meta/docs/schemas/responses.schema.json"),
    ];

    return candidates.find((candidate): candidate is string =>
        candidate !== undefined && fs.existsSync(candidate));
}

function all_configs() {
    const fields = Object.keys(SETTINGS_DEFAULTS) as (keyof SettingsFile)[];
    return fields.map(field => to_config(field, SETTINGS_DEFAULTS[field]));
}

describe("to_config", () => {
    it("describes every setting with both default and value", () => {
        for (const config of all_configs()) {
            expect(config, `${config.field_name} lacks default`).toHaveProperty("default");
            expect(config, `${config.field_name} lacks value`).toHaveProperty("value");
        }
    });

    it("separates the schema default from the stored value", () => {
        // `default` is the fallback and nothing else; `value` is what a read would return,
        // so a set value wins and an unset one falls back to the default.
        const spec = { description: "d", required: true, type: "path" as const, default: "fallback" };

        expect(to_config("workfile", spec)).toMatchObject({ default: "fallback", value: "fallback" });
        expect(to_config("workfile", { ...spec, value: "chosen" })).toMatchObject({
            default: "fallback",
            value: "chosen",
        });
        // eslint-disable-next-line unicorn/no-null
        expect(to_config("workfile", { ...spec, default: undefined })).toMatchObject({ value: null });
    });

    it("leaves a required setting with no default reported as missing", () => {
        // init's missing_fields is `required && value === null`, so this is the only shape
        // that makes attach-meta prompt for a setting on first run.
        const config = to_config("capi-path", SETTINGS_DEFAULTS["capi-path"]);

        expect(config.required).toBe(true);
        // eslint-disable-next-line unicorn/no-null
        expect(config.value).toBe(null);
    });

    it.skipIf(RESPONSES_SCHEMA_PATH === undefined)(
        "matches attach-meta's Config schema for every setting",
        () => {
            const schema = JSON.parse(fs.readFileSync(RESPONSES_SCHEMA_PATH!, "utf8")) as object;
            const ajv = new Ajv2020({ strict: false });
            ajv.addSchema(schema);
            const validate = ajv.getSchema("attach-meta/responses#/$defs/Config");
            expect(validate, "responses.schema.json has no $defs/Config").toBeDefined();

            for (const config of all_configs()) {
                const valid = validate!(config);
                expect(valid, `${config.field_name}: ${ajv.errorsText(validate!.errors)}`).toBe(true);
            }
        },
    );
});

describe("setting_options", () => {
    const fixtures = path.resolve(import.meta.dirname, "../../attach-no-os-lib/test/fixtures");
    let config_directory: string | undefined;

    afterEach(() => {
        // eslint-disable-next-line unicorn/no-useless-undefined -- clears the override
        set_config_path_override(undefined);
        reset_registry();
        if (config_directory !== undefined) {
            fs.rmSync(config_directory, { recursive: true, force: true });
            config_directory = undefined;
        }
    });

    it("returns a fixed option set as written", () => {
        expect(setting_options(SETTINGS_DEFAULTS.bootstrap)).toEqual(["true", "false"]);
        expect(setting_options(SETTINGS_DEFAULTS.workfile)).toBeUndefined();
    });

    it("lists every configured board, not only the workfile's chip", () => {
        config_directory = fs.mkdtempSync(path.join(os.tmpdir(), "attach-no-os-cli-test-"));
        set_config_path_override(path.join(config_directory, "config.json"));
        set_settings({
            ...SETTINGS_DEFAULTS,
            "capi-path": { ...SETTINGS_DEFAULTS["capi-path"], value: path.join(fixtures, "capi") },
            "module-paths": {
                ...SETTINGS_DEFAULTS["module-paths"],
                value: [path.join(fixtures, "platform"), path.join(fixtures, "driver-collection")].join(PATH_LIST_DELIMITER),
            },
        });
        reset_registry();

        expect(setting_options(SETTINGS_DEFAULTS.board)?.sort()).toEqual(["otherboard", "testboard", "twobusboard"]);
    });
});

describe("format_configs", () => {
    const all = Object.keys(SETTINGS_DEFAULTS) as (keyof SettingsFile)[];
    const required = all.filter(field => SETTINGS_DEFAULTS[field].required);

    afterEach(() => {
        // eslint-disable-next-line unicorn/no-useless-undefined -- clears the override
        set_config_path_override(undefined);
    });

    it("stars every required setting, and only those, and explains the star", () => {
        set_config_path_override(path.join(os.tmpdir(), "aa-format-configs", "config.json"));
        const lines = format_configs(SETTINGS_DEFAULTS, all).split("\n");

        expect(required.length).toBeGreaterThan(0);
        for (const field of all) {
            const row = lines.find(line => line.slice(4).startsWith(`${field} `));
            expect(row, field).toBeDefined();
            expect(row!.startsWith("  * "), field).toBe(SETTINGS_DEFAULTS[field].required === true);
        }
        expect(lines.some(line => line.trim().startsWith("* required:"))).toBe(true);
    });

    it("groups the settings under their category, in the declared order", () => {
        set_config_path_override(path.join(os.tmpdir(), "aa-format-configs", "config.json"));
        const lines = format_configs(SETTINGS_DEFAULTS, all).split("\n");

        // A heading is the category alone, indented two; a row is indented four after its mark.
        const headings = lines.filter(line => /^ {2}[a-z]+$/.test(line)).map(line => line.trim());
        expect(headings).toEqual([...SETTING_CATEGORIES]);

        for (const field of all) {
            const row = lines.findIndex(line => line.slice(4).startsWith(`${field} `));
            const heading = lines.findLastIndex((line, index) => index < row && /^ {2}[a-z]+$/.test(line));
            expect(lines[heading].trim(), field).toBe(SETTINGS_DEFAULTS[field].category);
        }
    });

    it("leaves the legend out when no listed setting is required", () => {
        set_config_path_override(path.join(os.tmpdir(), "aa-format-configs", "config.json"));
        const optional = all.filter(field => !SETTINGS_DEFAULTS[field].required).slice(0, 2);

        expect(format_configs(SETTINGS_DEFAULTS, optional)).not.toContain("* required:");
    });
});
