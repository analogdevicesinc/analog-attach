import assert from "node:assert";
import { AttachEnumType, type AttachType } from "attach-lib";
import { DeviceState } from "../src/WebviewControllers/DeviceState";
import {
    createTestAttachSession,
    createTestNode,
    createTestBinding,
} from "./testUtilities";

suite("DeviceState", () => {
    suite("fromNodeAndBinding", () => {
        test("extracts compatible string from node", () => {
            const session = createTestAttachSession();
            const parentNode = createTestNode({ name: "spi", unitAddr: "0" });
            const node = createTestNode({
                name: "adc",
                unitAddr: "0",
                properties: [
                    { name: "compatible", value: "adi,ad7124-4" },
                    { name: "status", value: "okay" },
                ],
            });

            const binding = createTestBinding();
            const state = DeviceState.fromNodeAndBinding(node, parentNode, binding, session);

            assert.strictEqual(state.compatible, "adi,ad7124-4");
        });

        test("extracts grouped compatible strings from node", () => {
            const session = createTestAttachSession();
            const parentNode = createTestNode({ name: "spi", unitAddr: "0" });
            const node = createTestNode({
                name: "accel",
                unitAddr: "0",
                properties: [
                    { name: "compatible", value: ["adi,adxl346", "adi,adxl345"] },
                    { name: "status", value: "okay" },
                ],
            });

            const binding = createTestBinding();
            const state = DeviceState.fromNodeAndBinding(node, parentNode, binding, session);

            assert.ok(Array.isArray(state.compatible));
            assert.deepStrictEqual(state.compatible, ["adi,adxl346", "adi,adxl345"]);
        });

        test("extracts alias from node labels", () => {
            const session = createTestAttachSession();
            const parentNode = createTestNode({ name: "spi", unitAddr: "0" });
            const node = createTestNode({
                name: "adc",
                unitAddr: "0",
                labels: ["my_adc"],
                properties: [
                    { name: "compatible", value: "adi,ad7124-4" },
                ],
            });

            const binding = createTestBinding();
            const state = DeviceState.fromNodeAndBinding(node, parentNode, binding, session);

            assert.strictEqual(state.alias, "my_adc");
        });

        test("determines active status from status property - okay", () => {
            const session = createTestAttachSession();
            const parentNode = createTestNode({ name: "spi", unitAddr: "0" });
            const node = createTestNode({
                name: "adc",
                unitAddr: "0",
                properties: [
                    { name: "compatible", value: "adi,ad7124-4" },
                    { name: "status", value: "okay" },
                ],
            });

            const binding = createTestBinding();
            const state = DeviceState.fromNodeAndBinding(node, parentNode, binding, session);

            assert.strictEqual(state.active, true);
        });

        test("determines active status from status property - disabled", () => {
            const session = createTestAttachSession();
            const parentNode = createTestNode({ name: "spi", unitAddr: "0" });
            const node = createTestNode({
                name: "adc",
                unitAddr: "0",
                properties: [
                    { name: "compatible", value: "adi,ad7124-4" },
                    { name: "status", value: "disabled" },
                ],
            });

            const binding = createTestBinding();
            const state = DeviceState.fromNodeAndBinding(node, parentNode, binding, session);

            assert.strictEqual(state.active, false);
        });

        test("defaults to active when no status property", () => {
            const session = createTestAttachSession();
            const parentNode = createTestNode({ name: "spi", unitAddr: "0" });
            const node = createTestNode({
                name: "adc",
                unitAddr: "0",
                properties: [
                    { name: "compatible", value: "adi,ad7124-4" },
                ],
            });

            const binding = createTestBinding();
            const state = DeviceState.fromNodeAndBinding(node, parentNode, binding, session);

            assert.strictEqual(state.active, true);
        });

        test("preserves property order from binding", () => {
            const session = createTestAttachSession();
            const parentNode = createTestNode({ name: "spi", unitAddr: "0" });
            const node = createTestNode({
                name: "adc",
                unitAddr: "0",
                properties: [
                    { name: "compatible", value: "adi,ad7124-4" },
                    { name: "custom-prop", value: [99] },
                    { name: "reg", value: [0] },
                ],
            });

            const binding = createTestBinding({
                properties: [
                    { key: "compatible", value: { _t: "array", minItems: 0, maxItems: 5 } satisfies AttachType },
                    { key: "reg", value: { _t: "integer" } satisfies AttachType },
                    { key: "interrupts", value: { _t: "array", minItems: 0, maxItems: 5 } satisfies AttachType },
                ],
            });

            const state = DeviceState.fromNodeAndBinding(node, parentNode, binding, session);

            const keys = [...state.properties.keys()];
            assert.strictEqual(keys[0], "compatible", "compatible should be first (from binding)");
            assert.strictEqual(keys[1], "reg", "reg should be second (from binding)");
            assert.strictEqual(keys[2], "interrupts", "interrupts from binding (no value)");
            assert.strictEqual(keys[3], "custom-prop", "custom-prop should be last (not in binding)");
        });

        test("adds custom properties after binding properties", () => {
            const session = createTestAttachSession();
            const parentNode = createTestNode({ name: "spi", unitAddr: "0" });
            const node = createTestNode({
                name: "adc",
                unitAddr: "0",
                properties: [
                    { name: "my-custom", value: [123] },
                    { name: "compatible", value: "adi,ad7124-4" },
                ],
            });

            const binding = createTestBinding({
                properties: [
                    { key: "compatible", value: { _t: "array" } as AttachType },
                ],
            });

            const state = DeviceState.fromNodeAndBinding(node, parentNode, binding, session);

            const keys = [...state.properties.keys()];
            assert.strictEqual(keys[0], "compatible");
            assert.strictEqual(keys[1], "my-custom");

            // Check that custom property is marked as custom
            const customProperty = state.properties.get("my-custom");
            assert.ok(customProperty?.isCustom);
        });

        test("creates channel states for matching children", () => {
            const session = createTestAttachSession();
            const parentNode = createTestNode({ name: "spi", unitAddr: "0" });

            const channel0 = createTestNode({
                name: "channel",
                unitAddr: "0",
                properties: [
                    { name: "reg", value: [0] },
                ],
            });
            const channel1 = createTestNode({
                name: "channel",
                unitAddr: "1",
                properties: [
                    { name: "reg", value: [1] },
                ],
            });

            const node = createTestNode({
                name: "adc",
                unitAddr: "0",
                properties: [
                    { name: "compatible", value: "adi,ad7124-4" },
                ],
                children: [channel0, channel1],
            });

            const binding = createTestBinding();
            const state = DeviceState.fromNodeAndBinding(
                node,
                parentNode,
                binding,
                session,
                ["^channel@[0-9]+$"]
            );

            assert.strictEqual(state.channels.size, 2);
            assert.ok(state.channels.has("channel@0"));
            assert.ok(state.channels.has("channel@1"));
        });

        test("compiles channel regex patterns", () => {
            const session = createTestAttachSession();
            const parentNode = createTestNode({ name: "spi", unitAddr: "0" });
            const node = createTestNode({
                name: "adc",
                unitAddr: "0",
                properties: [
                    { name: "compatible", value: "adi,ad7124-4" },
                ],
            });

            const binding = createTestBinding();
            const state = DeviceState.fromNodeAndBinding(
                node,
                parentNode,
                binding,
                session,
                ["^channel@([0-9]|1[0-5])$", "^input@[0-3]$"]
            );

            assert.ok(state.channelPatterns);
            assert.strictEqual(state.channelPatterns.length, 2);
            assert.ok(state.channelPatterns[0].test("channel@0"));
            assert.ok(state.channelPatterns[0].test("channel@15"));
            assert.ok(!state.channelPatterns[0].test("channel@16"));
            assert.ok(state.channelPatterns[1].test("input@2"));
        });

        test("handles node without compatible (custom device)", () => {
            const session = createTestAttachSession();
            const parentNode = createTestNode({ name: "spi", unitAddr: "0" });
            const node = createTestNode({
                name: "my-device",
                unitAddr: "0",
                properties: [
                    { name: "reg", value: [0] },
                ],
            });

            const state = DeviceState.fromNodeAndBinding(node, parentNode, undefined, session);

            assert.strictEqual(state.compatible, undefined, "Where did it find a compatible if none was provided?");
            assert.ok(state.properties.has("reg"), "why no reg :(");
            assert.ok(state.properties.get("reg")?.isCustom, "obviously reg should be marked custom if the whole node is custom");
        });
    });

    suite("toFormElements", () => {
        test("converts enum_integer to Generic dropdown", () => {
            const session = createTestAttachSession();
            const parentNode = createTestNode({ name: "spi", unitAddr: "0" });
            const node = createTestNode({
                name: "channel",
                unitAddr: "0",
                properties: [
                    { name: "adi,reference-select", value: [1] },
                ],
            });

            const binding = createTestBinding({
                properties: [{
                    key: "adi,reference-select",
                    value: {
                        _t: "enum_integer",
                        enum: [0n, 1n, 3n],
                        description: "Reference source",
                    } satisfies AttachType,
                }],
            });

            const state = DeviceState.fromNodeAndBinding(node, parentNode, binding, session);
            const elements = state.toFormElements(session);

            const element = elements.find(_element => _element.key === "adi,reference-select");
            assert.ok(element);
            assert.strictEqual(element.type, "Generic");
            if (element.type === "Generic") {
                assert.strictEqual(element.inputType, "dropdown");
                assert.ok(element.validationType);
                assert.strictEqual(element.validationType.type, "DropdownValidation");
            }
        });

        test("converts enum_array to FormArray with ArrayStringValidation", () => {
            const session = createTestAttachSession();
            const parentNode = createTestNode({ name: "spi", unitAddr: "0" });
            const node = createTestNode({
                name: "adc",
                unitAddr: "0",
                properties: [
                    { name: "compatible", value: "adi,ad7124-4" },
                ],
            });

            const binding = createTestBinding({
                properties: [{
                    key: "compatible",
                    value: {
                        _t: "enum_array",
                        minItems: 1,
                        maxItems: 1,
                        enum_type: AttachEnumType.STRING,
                        enum: ["adi,ad7124-4", "adi,ad7124-8"],
                    } satisfies AttachType,
                }],
            });

            const state = DeviceState.fromNodeAndBinding(node, parentNode, binding, session);
            const elements = state.toFormElements(session);

            const element = elements.find(_element => _element.key === "compatible");
            assert.ok(element, "no element with this name was created");
            assert.strictEqual(element.type, "FormArray", "incorrect element type");
            assert.ok(element.validationType, "validation does not exist");
            assert.strictEqual(element.validationType.type, "ArrayStringValidation", "validation type error");
            assert.strictEqual(element.validationType.enumType, "string", "enumType type error");
            assert.strictEqual(element.validationType.minLength, 1, "minLength invalid");
            assert.strictEqual(element.validationType.maxLength, 1, "maxLength invalid");
            assert.deepStrictEqual(element.validationType.enum, ["adi,ad7124-4", "adi,ad7124-8"], "types not forwarded correctly");
        });

        test("converts number_array to FormArray with ArrayNumberValidation", () => {
            const session = createTestAttachSession();
            const parentNode = createTestNode({ name: "spi", unitAddr: "0" });
            const node = createTestNode({
                name: "channel",
                unitAddr: "0",
                properties: [
                    { name: "diff-channels", value: [0, 1] },
                ],
            });

            const binding = createTestBinding({
                properties: [{
                    key: "diff-channels",
                    value: {
                        _t: "number_array",
                        minItems: 1,
                        maxItems: 2,
                        minimum: 0n,
                        maximum: 15n,
                    } satisfies AttachType,
                }],
            });

            const state = DeviceState.fromNodeAndBinding(node, parentNode, binding, session);
            const elements = state.toFormElements(session);

            const element = elements.find(_element => _element.key === "diff-channels");
            assert.ok(element);
            assert.strictEqual(element.type, "FormArray");
            assert.ok(element.validationType, "validation type should exist");
            assert.strictEqual(element.validationType.type, "ArrayNumberValidation", "validation type error");
            assert.equal(element.validationType.minLength, 1, "minLength not correct");
            assert.equal(element.validationType.maxLength, 2, "maxLength not correct");
            assert.equal(element.validationType.minValue, 0n, "minValue not correct");
            assert.equal(element.validationType.maxValue, 15n, "maxValue not correct");
        });

        test("converts matrix to FormMatrix", () => {
            const session = createTestAttachSession();
            const parentNode = createTestNode({ name: "spi", unitAddr: "0" });
            const node = createTestNode({
                name: "adc",
                unitAddr: "0",
                properties: [
                    { name: "interrupts", value: [25, 2] },
                ],
            });

            const binding = createTestBinding({
                properties: [{
                    key: "interrupts",
                    value: {
                        _t: "matrix",
                        values: [{
                            _t: "number_array",
                            minItems: 1,
                            maxItems: 2,
                            minimum: 1n,
                            maximum: 1000n
                        }],
                        minItems: 1,
                        maxItems: 3,
                    } satisfies AttachType,
                }],
            });

            const state = DeviceState.fromNodeAndBinding(node, parentNode, binding, session);
            const elements = state.toFormElements(session);

            const element = elements.find(_element => _element.key === "interrupts");
            assert.ok(element);
            assert.strictEqual(element.type, "FormMatrix");
            assert.ok(element.validationType, "validation type should exist");
            assert.equal(element.validationType.minRows, 1, "minRows not correct");
            assert.equal(element.validationType.maxRows, 3, "maxRows not correct");
            assert.strictEqual(element.validationType.definition.type, "ArrayNumberValidation", "validation type error");
            assert.equal(element.validationType.definition.minValue, 1n, "minValue not correct");
            assert.equal(element.validationType.definition.maxValue, 1000n, "maxValue not correct");
            assert.equal(element.validationType.definition.minLength, 1, "minLength not correct");
            assert.equal(element.validationType.definition.maxLength, 2, "maxLength not correct");
        });

        test("converts boolean to Flag", () => {
            const session = createTestAttachSession();
            const parentNode = createTestNode({ name: "spi", unitAddr: "0" });
            const node = createTestNode({
                name: "channel",
                unitAddr: "0",
                properties: [
                    { name: "bipolar", value: true },
                ],
            });

            const binding = createTestBinding({
                properties: [{
                    key: "bipolar",
                    value: {
                        _t: "boolean",
                        description: "Enable bipolar mode",
                    } as AttachType,
                }],
            });

            const state = DeviceState.fromNodeAndBinding(node, parentNode, binding, session);
            const elements = state.toFormElements(session);

            const element = elements.find(_element => _element.key === "bipolar");
            assert.ok(element, "element not found");
            assert.strictEqual(element.type, "Flag", "type not correct");
            assert.equal(element.setValue, true, "value not correct");
        });

        test("converts integer to Generic number", () => {
            const session = createTestAttachSession();
            const parentNode = createTestNode({ name: "spi", unitAddr: "0" });
            const node = createTestNode({
                name: "adc",
                unitAddr: "0",
                properties: [
                    { name: "spi-max-frequency", value: [5_000_000] },
                ],
            });

            const binding = createTestBinding({
                properties: [{
                    key: "spi-max-frequency",
                    value: {
                        _t: "integer",
                        minimum: 1_000_000n,
                        maximum: 10_000_000n,
                    } satisfies AttachType,
                }],
            });

            const state = DeviceState.fromNodeAndBinding(node, parentNode, binding, session);
            const elements = state.toFormElements(session);

            const element = elements.find(_element => _element.key === "spi-max-frequency");
            assert.ok(element);
            assert.strictEqual(element.type, "Generic");
            assert.strictEqual(element.inputType, "number");
            assert.ok(element.validationType);
            assert.strictEqual(element.validationType.type, "NumericRangeValidation", "validation type error");
            assert.equal(element.validationType.minValue, 1_000_000n, "validation minValue error");
            assert.equal(element.validationType.maxValue, 10_000_000n, "validation maxValue error");
        });

        test("converts custom properties correctly", () => {
            const session = createTestAttachSession();
            const parentNode = createTestNode({ name: "spi", unitAddr: "0" });
            const node = createTestNode({
                name: "adc",
                unitAddr: "0",
                properties: [
                    { name: "my-custom-flag", value: true },
                    { name: "my-custom-number", value: [42] },
                    { name: "my-custom-text", value: "hello" },
                ],
            });

            // No binding - all custom
            const state = DeviceState.fromNodeAndBinding(node, parentNode, undefined, session);
            const elements = state.toFormElements(session);

            const flagElement = elements.find(_element => _element.key === "my-custom-flag");
            assert.ok(flagElement);
            assert.strictEqual(flagElement.type, "Generic");
            assert.strictEqual(flagElement.inputType, "custom-flag", "flag inputType error");

            const numberElement = elements.find(_element => _element.key === "my-custom-number");
            assert.ok(numberElement);
            assert.strictEqual(numberElement.type, "Generic");
            assert.strictEqual(numberElement.inputType, "custom-number", "number inputType error");

            const textElement = elements.find(_element => _element.key === "my-custom-text");
            assert.ok(textElement);
            assert.strictEqual(textElement.type, "Generic");
            assert.strictEqual(textElement.inputType, "custom", "custom inputType error");
        });

        test("converts channels to FormObject", () => {
            const session = createTestAttachSession();
            const parentNode = createTestNode({ name: "spi", unitAddr: "0" });

            const channel0 = createTestNode({
                name: "channel",
                unitAddr: "0",
                labels: ["chan0"],
                properties: [
                    { name: "reg", value: [0] },
                ],
            });

            const node = createTestNode({
                name: "adc",
                unitAddr: "0",
                properties: [
                    { name: "compatible", value: "adi,ad7124-4" },
                ],
                children: [channel0],
            });

            const binding = createTestBinding();
            const state = DeviceState.fromNodeAndBinding(
                node,
                parentNode,
                binding,
                session,
                ["^channel@[0-9]+$"]
            );
            const elements = state.toFormElements(session);

            const channelElement = elements.find(_element => _element.key === "channel@0");
            assert.ok(channelElement);
            assert.strictEqual(channelElement.type, "FormObject");
            if (channelElement.type === "FormObject") {
                assert.strictEqual(channelElement.channelName, "channel@0");
                assert.strictEqual(channelElement.alias, "chan0");
                assert.equal(channelElement.config.length, 1, "reg should be present here");
                assert.strictEqual(channelElement.config[0].key, "reg", "property not here");
            }
        });

        test("serializes BigInt to Number when serializeForFrontend is true", () => {
            const session = createTestAttachSession();
            const parentNode = createTestNode({ name: "spi", unitAddr: "0" });
            const node = createTestNode({
                name: "adc",
                unitAddr: "0",
                properties: [
                    { name: "large-value", value: [Number.MAX_SAFE_INTEGER] },
                ],
            });

            const binding = createTestBinding({
                properties: [{
                    key: "large-value",
                    value: { _t: "integer" } satisfies AttachType,
                }],
            });

            const state = DeviceState.fromNodeAndBinding(node, parentNode, binding, session);
            const elements = state.toFormElements(session, { serializeForFrontend: true });

            const element = elements.find(_element => _element.key === "large-value");
            assert.ok(element);
            if (element.type === "Generic") {
                assert.strictEqual(typeof element.setValue, "number");
            }
        });
    });

    suite("toAttachLibJson", () => {
        test("converts properties to plain JSON", () => {
            const session = createTestAttachSession();
            const parentNode = createTestNode({ name: "spi", unitAddr: "0" });
            const node = createTestNode({
                name: "adc",
                unitAddr: "0",
                properties: [
                    { name: "compatible", value: "adi,ad7124-4" },
                    { name: "reg", value: [0] },
                ],
            });

            const state = DeviceState.fromNodeAndBinding(node, parentNode, undefined, session);
            const json = state.toAttachLibJson();

            assert.strictEqual(json["compatible"], "adi,ad7124-4");
            // DTS array properties are kept as arrays - only single-element arrays become scalars via normalizeScalar
            assert.ok("reg" in json);
            assert.equal(json["reg"], 0, "reg value not ok");
        });

        test("normalizes hex strings to numbers", () => {
            const session = createTestAttachSession();
            const parentNode = createTestNode({ name: "spi", unitAddr: "0" });
            const node = createTestNode({
                name: "adc",
                unitAddr: "0",
                properties: [],
            });

            const state = DeviceState.fromNodeAndBinding(node, parentNode, undefined, session);
            // Manually set a hex string value
            state.properties.set("hex-prop", {
                key: "hex-prop",
                value: "0x10",
                isCustom: true,
            });

            const json = state.toAttachLibJson();

            assert.strictEqual(json["hex-prop"], 16);
        });

        test("converts BigInt to Number", () => {
            const session = createTestAttachSession();
            const parentNode = createTestNode({ name: "spi", unitAddr: "0" });
            const node = createTestNode({
                name: "adc",
                unitAddr: "0",
                properties: [],
            });

            const state = DeviceState.fromNodeAndBinding(node, parentNode, undefined, session);
            // Manually set a BigInt value
            state.properties.set("large-value", {
                key: "large-value",
                value: 1_000_000n, // BigInt
                isCustom: true,
            });

            const json = state.toAttachLibJson();

            // toAttachLibJson converts BigInt to Number
            assert.strictEqual(json["large-value"], 1_000_000);
            assert.strictEqual(typeof json["large-value"], "number");
        });

        test("includes channels as nested objects", () => {
            const session = createTestAttachSession();
            const parentNode = createTestNode({ name: "spi", unitAddr: "0" });

            const channel0 = createTestNode({
                name: "channel",
                unitAddr: "0",
                properties: [
                    { name: "reg", value: [0] },
                    { name: "diff-channels", value: [0, 1] },
                ],
            });

            const node = createTestNode({
                name: "adc",
                unitAddr: "0",
                properties: [
                    { name: "compatible", value: "adi,ad7124-4" },
                ],
                children: [channel0],
            });

            const state = DeviceState.fromNodeAndBinding(
                node,
                parentNode,
                undefined,
                session,
                ["^channel@[0-9]+$"]
            );
            const json = state.toAttachLibJson();

            assert.ok(json["channel@0"]);
            const channel = json["channel@0"] as Record<string, unknown>;
            assert.ok("reg" in channel);
        });

        test("skips undefined/null values", () => {
            const session = createTestAttachSession();
            const parentNode = createTestNode({ name: "spi", unitAddr: "0" });
            const node = createTestNode({
                name: "adc",
                unitAddr: "0",
                properties: [
                    { name: "defined", value: [42] },
                ],
            });

            const state = DeviceState.fromNodeAndBinding(node, parentNode, undefined, session);
            // Add an undefined property
            state.properties.set("undefined-prop", {
                key: "undefined-prop",
                value: undefined,
                isCustom: true,
            });

            const json = state.toAttachLibJson();

            assert.ok("defined" in json);
            assert.ok(!("undefined-prop" in json));
        });
    });

    suite("syncToDtsNode", () => {
        test("updates node labels from alias", () => {
            const session = createTestAttachSession();
            const parentNode = createTestNode({ name: "spi", unitAddr: "0" });
            const node = createTestNode({
                name: "adc",
                unitAddr: "0",
                labels: [],
                properties: [
                    { name: "compatible", value: "adi,ad7124-4" },
                ],
            });

            const state = DeviceState.fromNodeAndBinding(node, parentNode, undefined, session);
            state.alias = "my_new_alias";
            state.syncToDtsNode(node, session);

            assert.deepStrictEqual(node.labels, ["my_new_alias"]);
        });

        test("updates status property", () => {
            const session = createTestAttachSession();
            const parentNode = createTestNode({ name: "spi", unitAddr: "0" });
            const node = createTestNode({
                name: "adc",
                unitAddr: "0",
                properties: [
                    { name: "compatible", value: "adi,ad7124-4" },
                    { name: "status", value: "okay" },
                ],
            });

            const state = DeviceState.fromNodeAndBinding(node, parentNode, undefined, session);
            state.active = false;
            state.syncToDtsNode(node, session);

            const statusProperty = node.properties.find(p => p.name === "status");
            assert.ok(statusProperty?.value);
            const component = statusProperty.value.components[0];
            assert.strictEqual(component.kind, "string");
            if (component.kind === "string") {
                assert.strictEqual(component.value, "disabled");
            }
        });

        test("adds new properties", () => {
            const session = createTestAttachSession();
            const parentNode = createTestNode({ name: "spi", unitAddr: "0" });
            const node = createTestNode({
                name: "adc",
                unitAddr: "0",
                properties: [
                    { name: "compatible", value: "adi,ad7124-4" },
                ],
            });

            const state = DeviceState.fromNodeAndBinding(node, parentNode, undefined, session);
            state.properties.set("new-prop", {
                key: "new-prop",
                value: [123],
                isCustom: true,
            });
            state.syncToDtsNode(node, session);

            const newProperty = node.properties.find(p => p.name === "new-prop");
            assert.ok(newProperty, "new property should be added");
        });

        test("removes deleted properties", () => {
            const session = createTestAttachSession();
            const parentNode = createTestNode({ name: "spi", unitAddr: "0" });
            const node = createTestNode({
                name: "adc",
                unitAddr: "0",
                properties: [
                    { name: "compatible", value: "adi,ad7124-4" },
                    { name: "to-be-removed", value: [99] },
                ],
            });

            const state = DeviceState.fromNodeAndBinding(node, parentNode, undefined, session);
            state.properties.delete("to-be-removed");
            state.syncToDtsNode(node, session);

            const removedProperty = node.properties.find(p => p.name === "to-be-removed");
            assert.ok(!removedProperty, "property should be removed");
        });

        test("syncs channel nodes", () => {
            const session = createTestAttachSession();
            const parentNode = createTestNode({ name: "spi", unitAddr: "0" });

            const channel0 = createTestNode({
                name: "channel",
                unitAddr: "0",
                properties: [
                    { name: "reg", value: [0] },
                ],
            });

            const node = createTestNode({
                name: "adc",
                unitAddr: "0",
                properties: [
                    { name: "compatible", value: "adi,ad7124-4" },
                ],
                children: [channel0],
            });

            const state = DeviceState.fromNodeAndBinding(
                node,
                parentNode,
                undefined,
                session,
                ["^channel@[0-9]+$"]
            );

            // Modify channel property
            const channel = state.channels.get("channel@0");
            assert.ok(channel);
            channel.properties.set("bipolar", {
                key: "bipolar",
                value: true,
                isCustom: true,
            });

            state.syncToDtsNode(node, session);

            const channelNode = node.children.find(c => c.name === "channel" && c.unit_addr === "0");
            assert.ok(channelNode);
            const bipolarProperty = channelNode.properties.find(p => p.name === "bipolar");
            assert.ok(bipolarProperty, "channel property should be synced");
        });

        test("creates new channel nodes", () => {
            const session = createTestAttachSession();
            const parentNode = createTestNode({ name: "spi", unitAddr: "0" });
            const node = createTestNode({
                name: "adc",
                unitAddr: "0",
                properties: [
                    { name: "compatible", value: "adi,ad7124-4" },
                ],
                children: [],
            });

            const state = DeviceState.fromNodeAndBinding(
                node,
                parentNode,
                undefined,
                session,
                ["^channel@[0-9]+$"]
            );

            // Add a new channel
            state.channels.set("channel@0", {
                name: "channel@0",
                properties: new Map([
                    ["reg", { key: "reg", value: [0], isCustom: false }],
                ]),
            });

            state.syncToDtsNode(node, session);

            const channelNode = node.children.find(c => c.name === "channel" && c.unit_addr === "0");
            assert.ok(channelNode, "new channel node should be created");
        });

        test("syncs grouped compatible strings to DTS node as multiple components", () => {
            const session = createTestAttachSession();
            const parentNode = createTestNode({ name: "spi", unitAddr: "0" });
            const node = createTestNode({
                name: "accel",
                unitAddr: "0",
                properties: [
                    { name: "compatible", value: "adi,adxl345" },
                ],
            });

            const state = DeviceState.fromNodeAndBinding(node, parentNode, undefined, session);

            // Set grouped compatible value (like when user selects grouped compatible from dropdown)
            state.properties.set("compatible", {
                key: "compatible",
                value: ["adi,adxl346", "adi,adxl345"],  // Grouped!
                isCustom: false,
            });

            state.syncToDtsNode(node, session);

            // Verify: compatible should have 2 string components
            const compatProperty = node.properties.find(p => p.name === "compatible");
            assert.ok(compatProperty?.value);
            assert.strictEqual(compatProperty.value.components.length, 2);
            assert.strictEqual(compatProperty.value.components[0].kind, "string");
            assert.strictEqual(compatProperty.value.components[1].kind, "string");
            if (compatProperty.value.components[0].kind === "string") {
                assert.strictEqual(compatProperty.value.components[0].value, "adi,adxl346");
            }
            if (compatProperty.value.components[1].kind === "string") {
                assert.strictEqual(compatProperty.value.components[1].value, "adi,adxl345");
            }
        });
    });

    suite("applyUpdates", () => {
        test("sets device-level property", () => {
            const session = createTestAttachSession();
            const parentNode = createTestNode({ name: "spi", unitAddr: "0" });
            const node = createTestNode({
                name: "adc",
                unitAddr: "0",
                properties: [
                    { name: "compatible", value: "adi,ad7124-4" },
                ],
            });

            const binding = createTestBinding({
                properties: [{
                    key: "spi-max-frequency",
                    value: { _t: "integer" } as AttachType,
                }],
            });

            const state = DeviceState.fromNodeAndBinding(node, parentNode, binding, session);

            state.applyUpdates([
                { action: "set", key: "spi-max-frequency", value: 5_000_000 },
            ]);

            const property = state.properties.get("spi-max-frequency");
            assert.ok(property);
            assert.strictEqual(property.value, 5_000_000);
        });

        test("deletes device-level property", () => {
            const session = createTestAttachSession();
            const parentNode = createTestNode({ name: "spi", unitAddr: "0" });
            const node = createTestNode({
                name: "adc",
                unitAddr: "0",
                properties: [
                    { name: "compatible", value: "adi,ad7124-4" },
                    { name: "to-delete", value: [123] },
                ],
            });

            const state = DeviceState.fromNodeAndBinding(node, parentNode, undefined, session);

            state.applyUpdates([
                { action: "delete", key: "to-delete" },
            ]);

            assert.ok(!state.properties.has("to-delete"));
        });

        test("sets channel property", () => {
            const session = createTestAttachSession();
            const parentNode = createTestNode({ name: "spi", unitAddr: "0" });

            const channel0 = createTestNode({
                name: "channel",
                unitAddr: "0",
                properties: [
                    { name: "reg", value: [0] },
                ],
            });

            const node = createTestNode({
                name: "adc",
                unitAddr: "0",
                properties: [
                    { name: "compatible", value: "adi,ad7124-4" },
                ],
                children: [channel0],
            });

            const state = DeviceState.fromNodeAndBinding(
                node,
                parentNode,
                undefined,
                session,
                ["^channel@[0-9]+$"]
            );

            state.applyUpdates([
                { action: "set", key: "bipolar", value: true, channelName: "channel@0" },
            ]);

            const channel = state.channels.get("channel@0");
            assert.ok(channel);
            const bipolarProperty = channel.properties.get("bipolar");
            assert.ok(bipolarProperty);
            assert.strictEqual(bipolarProperty.value, true);
        });

        test("creates new channel when setting property", () => {
            const session = createTestAttachSession();
            const parentNode = createTestNode({ name: "spi", unitAddr: "0" });
            const node = createTestNode({
                name: "adc",
                unitAddr: "0",
                properties: [
                    { name: "compatible", value: "adi,ad7124-4" },
                ],
                children: [],
            });

            const state = DeviceState.fromNodeAndBinding(
                node,
                parentNode,
                undefined,
                session,
                ["^channel@[0-9]+$"]
            );

            state.applyUpdates([
                { action: "set", key: "reg", value: [0], channelName: "channel@0" },
            ]);

            assert.ok(state.channels.has("channel@0"));
            const channel = state.channels.get("channel@0");
            assert.ok(channel?.properties.has("reg"));
        });

        test("deletes channel property", () => {
            const session = createTestAttachSession();
            const parentNode = createTestNode({ name: "spi", unitAddr: "0" });

            const channel0 = createTestNode({
                name: "channel",
                unitAddr: "0",
                properties: [
                    { name: "reg", value: [0] },
                    { name: "to-delete", value: [99] },
                ],
            });

            const node = createTestNode({
                name: "adc",
                unitAddr: "0",
                properties: [
                    { name: "compatible", value: "adi,ad7124-4" },
                ],
                children: [channel0],
            });

            const state = DeviceState.fromNodeAndBinding(
                node,
                parentNode,
                undefined,
                session,
                ["^channel@[0-9]+$"]
            );

            state.applyUpdates([
                { action: "delete", key: "to-delete", channelName: "channel@0" },
            ]);

            const channel = state.channels.get("channel@0");
            assert.ok(channel);
            assert.ok(!channel.properties.has("to-delete"));
        });
    });

    suite("property ordering", () => {
        test("preserves binding property order after updates", () => {
            const session = createTestAttachSession();
            const parentNode = createTestNode({ name: "spi", unitAddr: "0" });
            const node = createTestNode({
                name: "adc",
                unitAddr: "0",
                properties: [
                    { name: "compatible", value: "adi,ad7124-4" },
                    { name: "reg", value: [0] },
                ],
            });

            const binding = createTestBinding({
                properties: [
                    { key: "compatible", value: { _t: "array" } as AttachType },
                    { key: "reg", value: { _t: "integer" } as AttachType },
                    { key: "spi-max-frequency", value: { _t: "integer" } as AttachType },
                ],
            });

            const state = DeviceState.fromNodeAndBinding(node, parentNode, binding, session);

            // Update a property in the middle
            state.applyUpdates([
                { action: "set", key: "reg", value: [1] },
            ]);

            const keys = [...state.properties.keys()];
            assert.strictEqual(keys[0], "compatible");
            assert.strictEqual(keys[1], "reg");
            assert.strictEqual(keys[2], "spi-max-frequency");
        });

        test("custom properties appear after binding properties", () => {
            const session = createTestAttachSession();
            const parentNode = createTestNode({ name: "spi", unitAddr: "0" });
            const node = createTestNode({
                name: "adc",
                unitAddr: "0",
                properties: [
                    { name: "compatible", value: "adi,ad7124-4" },
                ],
            });

            const binding = createTestBinding({
                properties: [
                    { key: "compatible", value: { _t: "array" } as AttachType },
                    { key: "reg", value: { _t: "integer" } as AttachType },
                ],
            });

            const state = DeviceState.fromNodeAndBinding(node, parentNode, binding, session);

            // Add a custom property
            state.applyUpdates([
                { action: "set", key: "my-custom", value: [123], customType: "number" },
            ]);

            const keys = [...state.properties.keys()];
            assert.strictEqual(keys[0], "compatible");
            assert.strictEqual(keys[1], "reg");
            assert.strictEqual(keys[2], "my-custom");
        });
    });
});
