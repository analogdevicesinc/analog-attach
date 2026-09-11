import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020";
import { SETTINGS_DEFAULTS, type SettingsFile } from "attach-no-os-lib";
import { describe, expect, it } from "vitest";
import { to_config } from "../src/commands/config";

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
        const config = to_config("no_os_path", SETTINGS_DEFAULTS.no_os_path);

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
