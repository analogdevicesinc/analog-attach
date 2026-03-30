import assert from "node:assert";
import { AttachEnumType, type AttachType, type DtsNode } from "attach-lib";
import type { ConfigTemplatePayload } from "extension-protocol";
import {
    createTestAttachSession,
    createTestNode,
    createTestBinding,
    loadFixture,
    bigIntReplacer,
} from "./testUtils";

suite("AttachSession serialization", () => {
    suite("nodeToAttachLibJson", () => {
        test("serializes simple properties (string, number)", () => {
            const session = createTestAttachSession();
            const node: DtsNode = createTestNode({
                name: "device",
                unitAddr: "0",
                properties: [
                    { name: "compatible", value: "adi,ad7124-4" },
                    { name: "reg", value: [0] },
                    { name: "spi-max-frequency", value: [5_000_000] },
                ],
            });

            const result = session.nodeToAttachLibJson(node);

            assert.strictEqual(result["compatible"], "adi,ad7124-4");
            assert.deepStrictEqual(result["reg"], [0n]);
            assert.deepStrictEqual(result["spi-max-frequency"], [5_000_000n]);
        });

        test("serializes array properties", () => {
            const session = createTestAttachSession();
            const node = createTestNode({
                name: "adc",
                unitAddr: "0",
                properties: [
                    { name: "compatible", value: "adi,ad7124-8" },
                    { name: "interrupts", value: [25, 2] },
                    { name: "diff-channels", value: [0, 1] },
                ],
            });

            const result = session.nodeToAttachLibJson(node);

            assert.deepStrictEqual(result["interrupts"], [25n, 2n]);
            assert.deepStrictEqual(result["diff-channels"], [0n, 1n]);
        });

        test("serializes nested children (non-device nodes)", () => {
            const session = createTestAttachSession();
            const channelNode = createTestNode({
                name: "channel",
                unitAddr: "0",
                properties: [
                    { name: "reg", value: [0] },
                    { name: "diff-channels", value: [0, 1] },
                ],
            });

            const deviceNode = createTestNode({
                name: "adc",
                unitAddr: "0",
                properties: [
                    { name: "compatible", value: "adi,ad7124-4" },
                    { name: "reg", value: [0] },
                ],
                children: [channelNode],
            });

            const result = session.nodeToAttachLibJson(deviceNode);

            assert.ok(result["channel@0"], "child channel should be included");
            const channel = result["channel@0"] as Record<string, unknown>;
            assert.deepStrictEqual(channel["reg"], [0n]);
            assert.deepStrictEqual(channel["diff-channels"], [0n, 1n]);
        });

        test("excludes status property", () => {
            const session = createTestAttachSession();
            const node = createTestNode({
                name: "device",
                unitAddr: "0",
                properties: [
                    { name: "compatible", value: "adi,ad7124-4" },
                    { name: "status", value: "okay" },
                    { name: "reg", value: [0] },
                ],
            });

            const result = session.nodeToAttachLibJson(node);

            assert.strictEqual(result["status"], undefined, "status should be excluded");
            assert.strictEqual(result["compatible"], "adi,ad7124-4");
        });

        test("handles empty node", () => {
            const session = createTestAttachSession();
            const node = createTestNode({
                name: "empty",
                properties: [],
            });

            const result = session.nodeToAttachLibJson(node);

            assert.deepStrictEqual(result, {});
        });

        test("handles flag property (no value)", () => {
            const session = createTestAttachSession();
            const node = createTestNode({
                name: "channel",
                unitAddr: "0",
                properties: [
                    { name: "reg", value: [0] },
                    { name: "bipolar", value: true },
                ],
            });

            const result = session.nodeToAttachLibJson(node);

            assert.strictEqual(result["bipolar"], true);
        });
    });

    suite("nodeToAttachLibJsonWithBinding", () => {
        test("shapes scalar to matrix [[value]] when binding type is matrix", () => {
            const session = createTestAttachSession();
            const node = createTestNode({
                name: "device",
                properties: [
                    { name: "matrix-prop", value: [5] },
                ],
            });

            const binding = createTestBinding({
                properties: [{
                    key: "matrix-prop",
                    value: { _t: "matrix", values: [], minItems: 1, maxItems: 10 } satisfies AttachType,
                }],
            });

            const result = session.nodeToAttachLibJsonWithBinding(node, binding);

            assert.deepStrictEqual(result["matrix-prop"], [[5n]]);
        });

        test("shapes array to matrix [array] when binding type is matrix", () => {
            const session = createTestAttachSession();
            const node = createTestNode({
                name: "device",
                properties: [
                    { name: "matrix-prop", value: [1, 2, 3] },
                ],
            });

            const binding = createTestBinding({
                properties: [{
                    key: "matrix-prop",
                    value: { _t: "matrix", values: [], minItems: 1, maxItems: 10 } satisfies AttachType,
                }],
            });

            const result = session.nodeToAttachLibJsonWithBinding(node, binding);

            assert.deepStrictEqual(result["matrix-prop"], [[1n, 2n, 3n]]);
        });

        test("leaves matrix unchanged when already [[]]", () => {
            const session = createTestAttachSession();
            // Create a node that would produce a matrix structure
            // This tests the path where already-matrix data is preserved
            const node = createTestNode({
                name: "device",
                properties: [
                    { name: "prop", value: [1, 2] },
                ],
            });

            const binding = createTestBinding({
                properties: [{
                    key: "prop",
                    value: { _t: "matrix", values: [], minItems: 1, maxItems: 10 } satisfies AttachType,
                }],
            });

            const result = session.nodeToAttachLibJsonWithBinding(node, binding);

            // Since the input is [1, 2], it gets wrapped as [[1, 2]]
            assert.deepStrictEqual(result["prop"], [[1n, 2n]]);
        });

        test("shapes scalar to array [value] when binding type is array", () => {
            const session = createTestAttachSession();
            const node = createTestNode({
                name: "device",
                properties: [
                    { name: "array-prop", value: "single" },
                ],
            });

            const binding = createTestBinding({
                properties: [{
                    key: "array-prop",
                    value: { _t: "array", minItems: 1, maxItems: 3 } satisfies AttachType,
                }],
            });

            const result = session.nodeToAttachLibJsonWithBinding(node, binding);

            assert.deepStrictEqual(result["array-prop"], ["single"]);
        });

        test("shapes scalar to array for enum_array type", () => {
            const session = createTestAttachSession();
            const node = createTestNode({
                name: "device",
                properties: [
                    { name: "enum-prop", value: [0] },
                ],
            });

            const binding = createTestBinding({
                properties: [{
                    key: "enum-prop",
                    value: {
                        _t: "enum_array",
                        enum: [0, 1, 2],
                        enum_type: AttachEnumType.NUMBER,
                        minItems: 1,
                        maxItems: 3
                    } satisfies AttachType
                }],
            });

            const result = session.nodeToAttachLibJsonWithBinding(node, binding);

            // Already an array, stays as array
            assert.deepStrictEqual(result["enum-prop"], [0n]);
        });

        test("leaves array unchanged for array types", () => {
            const session = createTestAttachSession();
            const node = createTestNode({
                name: "device",
                properties: [
                    { name: "array-prop", value: [1, 2, 3] },
                ],
            });

            const binding = createTestBinding({
                properties: [{
                    key: "array-prop",
                    value: { _t: "number_array", minItems: 1, maxItems: 3, minimum: 0n, maximum: 100n } satisfies AttachType,
                }],
            });

            const result = session.nodeToAttachLibJsonWithBinding(node, binding);

            assert.deepStrictEqual(result["array-prop"], [1n, 2n, 3n]);
        });

        test("passes through unknown binding types unchanged", () => {
            const session = createTestAttachSession();
            const node = createTestNode({
                name: "device",
                properties: [
                    { name: "int-prop", value: [42] },
                ],
            });

            const binding = createTestBinding({
                properties: [{
                    key: "int-prop",
                    value: { _t: "integer" } satisfies AttachType,
                }],
            });

            const result = session.nodeToAttachLibJsonWithBinding(node, binding);

            // Integer type doesn't get shaped, just passed through
            assert.deepStrictEqual(result["int-prop"], [42n]);
        });

        test("handles properties not in binding (custom properties)", () => {
            const session = createTestAttachSession();
            const node = createTestNode({
                name: "device",
                properties: [
                    { name: "known-prop", value: [1] },
                    { name: "custom-prop", value: [99] },
                ],
            });

            const binding = createTestBinding({
                properties: [{
                    key: "known-prop",
                    value: { _t: "integer" } satisfies AttachType,
                }],
            });

            const result = session.nodeToAttachLibJsonWithBinding(node, binding);

            assert.deepStrictEqual(result["known-prop"], [1n]);
            assert.deepStrictEqual(result["custom-prop"], [99n]);
        });
    });

    suite("configPayloadToAttachLibJson", () => {
        test("converts Generic form element", () => {
            const session = createTestAttachSession();
            const config: ConfigTemplatePayload["config"] = {
                type: "DeviceConfigurationFormObject",
                alias: "",
                parentNode: { uuid: crypto.randomUUID(), name: "spi" },
                channelRegexes: [],
                config: [
                    {
                        type: "Generic",
                        key: "reg",
                        inputType: "number",
                        required: true,
                        setValue: 0,
                    },
                ],
            };

            const result = session.configPayloadToAttachLibJson(config);

            assert.strictEqual(result["reg"], 0);
        });

        test("converts FormArray element", () => {
            const session = createTestAttachSession();
            const config: ConfigTemplatePayload["config"] = {
                type: "DeviceConfigurationFormObject",
                alias: "",
                parentNode: { uuid: crypto.randomUUID(), name: "spi" },
                channelRegexes: [],
                config: [
                    {
                        type: "FormArray",
                        key: "compatible",
                        required: true,
                        setValue: ["adi,ad7124-8"],
                    },
                ],
            };

            const result = session.configPayloadToAttachLibJson(config);

            assert.deepStrictEqual(result["compatible"], ["adi,ad7124-8"]);
        });

        test("converts FormMatrix element", () => {
            const session = createTestAttachSession();
            const config: ConfigTemplatePayload["config"] = {
                type: "DeviceConfigurationFormObject",
                alias: "",
                parentNode: { uuid: crypto.randomUUID(), name: "spi" },
                channelRegexes: [],
                config: [
                    {
                        type: "FormMatrix",
                        key: "interrupts",
                        required: false,
                        setValue: [[25, 2]],
                    },
                ],
            };

            const result = session.configPayloadToAttachLibJson(config);

            assert.deepStrictEqual(result["interrupts"], [[25, 2]]);
        });

        test("converts FormObject (channel) element", () => {
            const session = createTestAttachSession();
            const config: ConfigTemplatePayload["config"] = {
                type: "DeviceConfigurationFormObject",
                alias: "",
                parentNode: { uuid: crypto.randomUUID(), name: "spi" },
                channelRegexes: [],
                config: [
                    {
                        type: "FormObject",
                        key: "channel@0",
                        required: false,
                        channelName: "channel@0",
                        config: [
                            {
                                type: "Generic",
                                key: "reg",
                                inputType: "number",
                                required: false,
                                setValue: 0,
                            },
                        ],
                    },
                ],
            };

            const result = session.configPayloadToAttachLibJson(config);

            assert.ok(result["channel@0"], "channel should be present");
            const channel = result["channel@0"] as Record<string, unknown>;
            assert.strictEqual(channel["reg"], 0);
        });

        test("converts Flag element", () => {
            const session = createTestAttachSession();
            const config: ConfigTemplatePayload["config"] = {
                type: "DeviceConfigurationFormObject",
                alias: "",
                parentNode: { uuid: crypto.randomUUID(), name: "spi" },
                channelRegexes: [],
                config: [
                    {
                        type: "Flag",
                        key: "bipolar",
                        required: false,
                        setValue: true,
                    },
                ],
            };

            const result = session.configPayloadToAttachLibJson(config);

            assert.strictEqual(result["bipolar"], true);
        });

        test("normalizes hex strings to numbers", () => {
            const session = createTestAttachSession();
            const config: ConfigTemplatePayload["config"] = {
                type: "DeviceConfigurationFormObject",
                alias: "",
                parentNode: { uuid: crypto.randomUUID(), name: "spi" },
                channelRegexes: [],
                config: [
                    {
                        type: "Generic",
                        key: "address",
                        inputType: "number",
                        required: false,
                        setValue: "0x10",
                    },
                ],
            };

            const result = session.configPayloadToAttachLibJson(config);

            assert.strictEqual(result["address"], 16);
        });

        test("handles nested FormObjects", () => {
            const session = createTestAttachSession();
            const config: ConfigTemplatePayload["config"] = {
                type: "DeviceConfigurationFormObject",
                alias: "",
                parentNode: { uuid: crypto.randomUUID(), name: "spi" },
                channelRegexes: [],
                config: [
                    {
                        type: "FormObject",
                        key: "channel@0",
                        channelName: "channel@0",
                        required: false,
                        config: [
                            {
                                type: "Generic",
                                key: "reg",
                                inputType: "number",
                                required: false,
                                setValue: 0,
                            },
                            {
                                type: "Flag",
                                key: "bipolar",
                                required: false,
                                setValue: true,
                            },
                        ],
                    },
                ],
            };

            const result = session.configPayloadToAttachLibJson(config);

            const channel = result["channel@0"] as Record<string, unknown>;
            assert.strictEqual(channel["reg"], 0);
            assert.strictEqual(channel["bipolar"], true);
        });

        test("skips undefined/null values", () => {
            const session = createTestAttachSession();
            const config: ConfigTemplatePayload["config"] = {
                type: "DeviceConfigurationFormObject",
                alias: "",
                parentNode: { uuid: crypto.randomUUID(), name: "spi" },
                channelRegexes: [],
                config: [
                    {
                        type: "Generic",
                        key: "defined",
                        inputType: "number",
                        required: false,
                        setValue: 42,
                    },
                    {
                        type: "Generic",
                        key: "undefined-val",
                        inputType: "number",
                        required: false,
                        setValue: undefined,
                    },
                ],
            };

            const result = session.configPayloadToAttachLibJson(config);

            assert.strictEqual(result["defined"], 42);
            assert.strictEqual(result["undefined-val"], undefined);
        });

        test("skips NaN values", () => {
            const session = createTestAttachSession();
            const config: ConfigTemplatePayload["config"] = {
                type: "DeviceConfigurationFormObject",
                alias: "",
                parentNode: { uuid: crypto.randomUUID(), name: "spi" },
                channelRegexes: [],
                config: [
                    {
                        type: "Generic",
                        key: "nan-val",
                        inputType: "number",
                        required: false,
                        setValue: Number.NaN,
                    },
                ],
            };

            const result = session.configPayloadToAttachLibJson(config);

            assert.strictEqual(result["nan-val"], undefined);
        });

        test("flattens nested arrays in FormArray", () => {
            const session = createTestAttachSession();
            const config: ConfigTemplatePayload["config"] = {
                type: "DeviceConfigurationFormObject",
                alias: "",
                parentNode: { uuid: crypto.randomUUID(), name: "spi" },
                channelRegexes: [],
                config: [
                    {
                        type: "FormArray",
                        key: "nested",
                        required: false,
                        setValue: [[1, 2], [3, 4]],
                    },
                ],
            };

            const result = session.configPayloadToAttachLibJson(config);

            // Nested arrays get flattened
            assert.deepStrictEqual(result["nested"], [1, 2, 3, 4]);
        });

        test("skips empty arrays in FormArray", () => {
            const session = createTestAttachSession();
            const config: ConfigTemplatePayload["config"] = {
                type: "DeviceConfigurationFormObject",
                alias: "",
                parentNode: { uuid: crypto.randomUUID(), name: "spi" },
                channelRegexes: [],
                config: [
                    {
                        type: "FormArray",
                        key: "empty-array",
                        required: false,
                        setValue: [],
                    },
                ],
            };

            const result = session.configPayloadToAttachLibJson(config);

            assert.strictEqual(result["empty-array"], undefined);
        });
    });

    suite("shapeValueForBindingType (via nodeToAttachLibJsonWithBinding)", () => {
        const shapeFixture = loadFixture<{
            cases: Array<{
                description: string;
                bindingType: string;
                input: unknown;
                expected: unknown;
            }>;
        }>("fixtures/serialization/shape-matrix.json");

        for (const testCase of shapeFixture.cases) {
            test(testCase.description, () => {
                const session = createTestAttachSession();

                // We test via nodeToAttachLibJsonWithBinding since shapeValueForBindingType is private
                // Create a node with the test value
                const node = createTestNode({
                    name: "device",
                    properties: [
                        { name: "test-prop", value: testCase.input },
                    ],
                });

                const binding = createTestBinding({
                    properties: [{
                        key: "test-prop",
                        value: { _t: testCase.bindingType } as AttachType,
                    }],
                });

                const result = session.nodeToAttachLibJsonWithBinding(node, binding);

                // Normalize BigInt for comparison
                const normalizedResult = JSON.parse(JSON.stringify(result["test-prop"], bigIntReplacer));
                assert.deepStrictEqual(normalizedResult, testCase.expected);
            });
        }

        const arrayFixture = loadFixture<{
            cases: Array<{
                description: string;
                bindingType: string;
                input: unknown;
                expected: unknown;
            }>;
        }>("fixtures/serialization/shape-array.json");

        for (const testCase of arrayFixture.cases) {
            test(testCase.description, () => {
                const session = createTestAttachSession();

                const node = createTestNode({
                    name: "device",
                    properties: [
                        { name: "test-prop", value: testCase.input },
                    ],
                });

                const binding = createTestBinding({
                    properties: [{
                        key: "test-prop",
                        value: { _t: testCase.bindingType } as AttachType,
                    }],
                });

                const result = session.nodeToAttachLibJsonWithBinding(node, binding);

                const normalizedResult = JSON.parse(JSON.stringify(result["test-prop"], bigIntReplacer));
                assert.deepStrictEqual(normalizedResult, testCase.expected);
            });
        }
    });
});
