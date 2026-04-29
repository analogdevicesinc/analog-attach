import assert from "node:assert";
import path from "node:path";
import type { DtsDocument } from "attach-lib";
import type { ConfigTemplatePayload } from "extension-protocol";
import { AttachSession } from "../src/AttachSession/AttachSession";

const TEST_STORAGE_PATH = path.resolve(__dirname, "../../test");
const TEST_LINUX_BINDINGS_FOLDER = path.join(TEST_STORAGE_PATH, "schemas");

/**
 * Temporary smoke test to display the JSON produced by configPayloadToAttachLibJson.
 * Run with the compiled tests to inspect the console output.
 */
suite("configPayloadToAttachLibJson printer (temp)", () => {
    test("prints converted JSON", () => {
        const attachSession = new (AttachSession as unknown as {
            new(
                subsystems: string[],
                compatible_mapping: unknown[],
                storage_path: string,
                device_tree: DtsDocument,
                linux_bindings_folder: string,
                schema_cache: unknown,
                label_map: Map<string, string>
            ): AttachSession;
        })([], [], TEST_STORAGE_PATH, createEmptyDocument(), TEST_LINUX_BINDINGS_FOLDER, {}, new Map());

        const sampleConfig: ConfigTemplatePayload["config"] = {
            type: "DeviceConfigurationFormObject",
            alias: "imu0",
            parentNode: { uuid: "1111-1111-1111-1111-1111", name: "spi" },
            channelRegexes: ["^channel@([0-9]|1[0-5])$"],
            config: [
                {
                    type: "FormArray",
                    key: "compatible",
                    required: true,
                    setValue: ["adi,ad7124-8"],
                },
                {
                    type: "Generic",
                    key: "reg",
                    inputType: "number",
                    required: true,
                    setValue: 0,
                },
                {
                    type: "FormObject",
                    key: "channel@0",
                    required: false,
                    channelName: "channel@0",
                    config: [
                        {
                            type: "Generic",
                            key: "differential",
                            inputType: "number",
                            required: false,
                            setValue: 1,
                        },
                    ],
                },
            ],
        };

        const json = attachSession.configPayloadToAttachLibJson(sampleConfig);
        const expected = {
            compatible: ["adi,ad7124-8"],
            reg: 0,
            "channel@0": {
                differential: 1,
            },
        };

        // Console output for manual inspection
        console.log("configPayloadToAttachLibJson output:", JSON.stringify(json));
        assert.deepStrictEqual(json, expected);
    });
});

function createEmptyDocument(): DtsDocument {
    return {
        memreserves: [],
        root: {
            name: "/",
            unit_addr: undefined,
            _uuid: crypto.randomUUID(),
            properties: [],
            children: [],
            labels: [],
            deleted: false,
            modified_by_user: true,
            created_by_user: true,
        },
        unresolved_overlays: []
    };
}
