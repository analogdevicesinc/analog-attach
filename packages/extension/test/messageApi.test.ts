import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import type { WebviewPanel, Uri } from "vscode";
import {
    CatalogCommands,
    DeviceCommands,
    SessionCommands,
    TreeViewCommands,
    type CatalogDevice,
    type GetAttachedDevicesStateResponse,
    type GetDevicesResponse,
    type GetPotentialParentNodesResponse,
    type AnalogAttachRequestEnvelope,
    type AnalogAttachEmptyPayload,
    type AttachedDeviceState,
    type SetParentNodeResponse,
    type DeleteDeviceResponse,
    type GetDeviceConfigurationResponse,
    type GetDeviceTreeResponse,
    type FormElement,
    type FormObjectElement,
    type FormArrayElement,
    type UpdateDeviceConfigurationResponse,
    type ConfigTemplatePayload,
    type SetNodeActiveResponse,
} from "extension-protocol";
import {
    get_compatible_mapping,
    type CompatibleMapping,
} from "../src/utilities";
import {
    mergeDtso,
    parse_dts,
    type DtsDocument,
    type DtsNode,
} from "attach-lib";
import { PlugAndPlayWebviewController } from "../src/WebviewControllers/PlugAndPlayWebviewController";
import { AttachSession } from "../src/AttachSession/AttachSession";
import { AnalogAttachLogger } from "../src/AnalogAttachLogger";

const TEST_STORAGE_PATH = path.resolve(__dirname, "../../test");
const TEST_LINUX_BINDINGS_FOLDER = path.join(TEST_STORAGE_PATH, "schemas");
let defaultCompatibleMapping: CompatibleMapping[] = [];

suite("Analog Attach Message API", () => {
    suiteSetup(async function () {
        this.timeout("20000ms");

        const binding_path = path.resolve(__dirname, "../../test/schemas");
        const storage_path = path.resolve(__dirname, "../../test");

        const linux_path = path.resolve(__dirname, "../../test/linux");
        const dt_schema_path = path.resolve(__dirname, "../../test/dt-schema");

        defaultCompatibleMapping = await get_compatible_mapping(binding_path, linux_path, dt_schema_path);
        assert.ok(
            defaultCompatibleMapping.length > 0,
            "Failed to load compatible mappings for tests"
        );
    });

    test("session.getAttachedDevicesState flows through the PlugAndPlay controller", async () => {
        AnalogAttachLogger.suppressMessages(true);
        const deviceTree = createDeviceTreeFromFixture();
        const catalogDevices: CatalogDevice[] = [];
        const controller = createController(deviceTree, catalogDevices);
        const { panel, webview } = createMockPanel();

        const request = createEmptyRequest(SessionCommands.getAttachedDevicesState);
        await controller.handle_message(request, panel);

        assert.strictEqual(webview.messages.length, 1, "expected single response message");
        const response = webview.messages[0] as GetAttachedDevicesStateResponse;

        assert.strictEqual(response.type, "response");
        assert.strictEqual(response.command, SessionCommands.getAttachedDevicesState);
        assert.strictEqual(response.status, "success");
        assert.strictEqual(response.id, request.id);
        assert.ok(Date.parse(response.timestamp), "response timestamp should be ISO8601");
        assert.strictEqual(response.error, undefined);

        const expectedPayloadPath = path.resolve(__dirname, "../../test/test_results/attached-device-state.json");
        const expectedPayload = JSON.parse(fs.readFileSync(expectedPayloadPath, "utf8")) as { data: AttachedDeviceState[] };

        const normalizeState = (state: AttachedDeviceState) => {
            const { deviceUID: _deviceUID, parentNode, alias, ...rest } = state;
            const normalized: any = {
                ...rest,
                parentNode: { name: parentNode.name },
            };
            if (alias !== undefined && alias !== null && alias !== "") {
                normalized.alias = alias;
            }
            return normalized;
        };

        const stableKey = (state: ReturnType<typeof normalizeState>) => ({
            compatible: state.compatible,
            name: state.name,
            alias: state.alias ?? "",
            parentName: state.parentNode.name,
        });

        const actualStates = response.payload.data.map((element) => normalizeState(element));
        const expectedStates = expectedPayload.data.map((element) => normalizeState(element));

        const remainingActual = [...actualStates];
        for (const expected of expectedStates) {
            const expectedKey = stableKey(expected);
            const matchIndex = remainingActual.findIndex((candidate) => {
                const candidateKey = stableKey(candidate);
                return candidateKey.compatible === expectedKey.compatible
                    && candidateKey.name === expectedKey.name
                    && candidateKey.alias === expectedKey.alias
                    && candidateKey.parentName === expectedKey.parentName;
            });

            assert.ok(matchIndex !== -1, `Missing expected device state: ${JSON.stringify(expectedKey)}`);
            const [matched] = remainingActual.splice(matchIndex, 1);
            assert.deepStrictEqual(matched, expected);
        }

        assert.strictEqual(remainingActual.length, 0, `Unexpected extra device states: ${remainingActual.length}`);
    });

    test("catalog.getDevices returns catalog payload assembled by the backend", async () => {
        AnalogAttachLogger.suppressMessages(true);
        const deviceTree = createDeviceTreeFromFixture();
        deviceTree.root.children.push(
            {
                name: "i2c-mock-parent",
                unit_addr: undefined,
                _uuid: crypto.randomUUID(),
                properties: [],
                children: [],
                labels: [],
                deleted: false,
                modified_by_user: true,
                created_by_user: true,
            },
            {
                name: "spi-mock-parent",
                unit_addr: undefined,
                _uuid: crypto.randomUUID(),
                properties: [],
                children: [],
                labels: [],
                deleted: false,
                modified_by_user: true,
                created_by_user: true,
            }
        );
        const controller = createController(deviceTree);
        const { panel, webview } = createMockPanel();

        const request = createEmptyRequest(CatalogCommands.getDevices);
        await controller.handle_message(request, panel);

        assert.strictEqual(webview.messages.length, 1, "expected single response message");
        const response = webview.messages[0] as GetDevicesResponse;

        assert.strictEqual(response.type, "response");
        assert.strictEqual(response.command, CatalogCommands.getDevices);
        assert.strictEqual(response.status, "success");
        assert.strictEqual(response.id, request.id);
        assert.ok(Date.parse(response.timestamp), "response timestamp should be ISO8601");
        assert.strictEqual(response.error, undefined);

        const ad7124 = response.payload.devices.find((device) => device.deviceId === "adi,ad7124-4");
        assert.notStrictEqual(ad7124, undefined, "expected AD7124 entry in the catalog response");
    });

    test("device.getPotentialParentNodes lists eligible nodes for a catalog device", async () => {
        AnalogAttachLogger.suppressMessages(true);
        const deviceTree = createDeviceTreeFromFixture();
        const controller = createController(deviceTree);
        const { panel, webview } = createMockPanel();

        const request = createRequest(DeviceCommands.getPotentialParentNodes, {
            deviceId: "adi,ad7124-4",
        });
        await controller.handle_message(request, panel);

        assert.strictEqual(webview.messages.length, 1, "expected single response message");
        const response = webview.messages[0] as GetPotentialParentNodesResponse;

        assert.strictEqual(response.type, "response");
        assert.strictEqual(response.command, DeviceCommands.getPotentialParentNodes);
        assert.strictEqual(response.status, "success");
        assert.strictEqual(response.id, request.id);
        assert.ok(Date.parse(response.timestamp), "response timestamp should be ISO8601");
        assert.strictEqual(response.error, undefined);

        const ids = response.payload.potentialParentNodes.map((node) => node.name);
        assert.ok(
            ids.every((id) => id.includes("spi") || id.includes("i2c")),
            "expected only SPI/I2C nodes to be returned"
        );
    });

    test("get_compatible_mapping parses adi,ad7124 variants from bindings", async function () {
        AnalogAttachLogger.suppressMessages(true);
        this.timeout("20000ms");

        const binding_path = path.resolve(__dirname, '../../test/schemas/iio/adc');
        const storage_path = path.resolve(__dirname, '../../test');

        const linux_path = path.resolve(__dirname, "../../test/linux");
        const dt_schema_path = path.resolve(__dirname, "../../test/dt-schema");

        const mapping = await get_compatible_mapping(binding_path, linux_path, dt_schema_path);
        const ad7124Mappings = mapping.filter((entry) => entry.compatible_string.startsWith("adi,ad7124"));

        console.log("Found AD7124 compatible mappings:", ad7124Mappings);
        assert.ok(
            ad7124Mappings.some((entry) => entry.compatible_string === "adi,ad7124-8"),
            "expected compatible mapping to include adi,ad7124-8"
        );
        assert.ok(
            ad7124Mappings.some((entry) => entry.compatible_string === "adi,ad7124-4"),
            "expected compatible mapping to include adi,ad7124-4"
        );
    });

    test("device.getConfiguration returns a template for an attached ad7124-8 device", async function () {
        AnalogAttachLogger.suppressMessages(true);
        this.timeout("20000ms");

        const binding_path = path.resolve(__dirname, '../../test/schemas/iio/adc');
        const storage_path = path.resolve(__dirname, '../../test');

        const linux_path = path.resolve(__dirname, "../../test/linux");
        const dt_schema_path = path.resolve(__dirname, "../../test/dt-schema");

        const compatibleMapping = await get_compatible_mapping(binding_path, linux_path, dt_schema_path);
        const hasAd7124 = compatibleMapping.some((entry) => entry.compatible_string === "adi,ad7124-8");
        if (!hasAd7124) {
            console.warn("Skipping ad7124-8 configuration test: compatible mapping did not include adi,ad7124-8.");
            this.skip();
        }

        const deviceTree = createDeviceTreeFromFixture();
        const controller = createController(deviceTree, undefined, compatibleMapping, storage_path, binding_path);
        const { panel, webview } = createMockPanel();

        const parentLookupRequest = createRequest(DeviceCommands.getPotentialParentNodes, {
            deviceId: "adi,ad7124-8",
        });
        await controller.handle_message(parentLookupRequest, panel);
        const parentLookupResponse = webview.messages.pop() as GetPotentialParentNodesResponse;
        const parentNode = parentLookupResponse.payload.potentialParentNodes[0];
        assert.ok(parentNode, "expected at least one potential parent");

        const attachRequest = createRequest(DeviceCommands.setParentNode, {
            deviceId: "adi,ad7124-8",
            parentNode: parentNode,
        });
        await controller.handle_message(attachRequest, panel);
        const attachResponse = webview.messages.pop() as SetParentNodeResponse;
        const deviceUID = attachResponse.payload.deviceUID;
        assert.ok(deviceUID, "expected device UID after attaching device");

        const request = createRequest(DeviceCommands.getConfiguration, { deviceUID });
        await controller.handle_message(request, panel);

        assert.strictEqual(webview.messages.length, 1, "expected single response message");
        const response = webview.messages.pop() as GetDeviceConfigurationResponse;
        // NOTE: Only for manual debugging
        // console.log("device.getConfiguration response", JSON.stringify(response, undefined, 2));

        assert.strictEqual(response.type, "response");
        assert.strictEqual(response.command, DeviceCommands.getConfiguration);
        assert.strictEqual(response.status, "success");
        assert.strictEqual(response.id, request.id);
        assert.ok(Date.parse(response.timestamp), "response timestamp should be ISO8601");
        assert.strictEqual(response.error, undefined);

        const config = response.payload.deviceConfiguration.config;
        assert.ok(Array.isArray(config.config), "expected configuration to include form elements");
        assert.ok(
            Array.isArray(config.channelRegexes) && config.channelRegexes.length > 0,
            "expected configuration to expose channel regexes when pattern properties are available"
        );
        assert.ok(
            config.channelRegexes?.some((pattern) => pattern.includes("channel")),
            "expected channel regex to contain the channel pattern"
        );

        assert.notStrictEqual(config.alias, undefined, "expected configuration to expose alias field");
        assert.ok(
            config.config.some((element) => element.key === "compatible"),
            "expected configuration to expose compatible property"
        );
        const compatibleElement = config.config.find((element) => element.key === "compatible");
        const compatValue = (compatibleElement as any)?.setValue;
        if (Array.isArray(compatValue)) {
            assert.strictEqual(
                compatValue[0],
                "adi,ad7124-8",
                "expected compatible property to be populated with the attached device id"
            );
        } else {
            assert.strictEqual(
                compatValue,
                "adi,ad7124-8",
                "expected compatible property to be populated with the attached device id"
            );
        }
    });

    test("device.updateConfiguration returns channel configuration for valid channel names", async function () {
        AnalogAttachLogger.suppressMessages(true);
        this.timeout("20000ms");

        const binding_path = path.resolve(__dirname, '../../test/schemas/iio/adc');
        const storage_path = path.resolve(__dirname, '../../test');

        const linux_path = path.resolve(__dirname, "../../test/linux");
        const dt_schema_path = path.resolve(__dirname, "../../test/dt-schema");

        const compatibleMapping = await get_compatible_mapping(binding_path, linux_path, dt_schema_path);
        const hasAd7124 = compatibleMapping.some((entry) => entry.compatible_string === "adi,ad7124-8");
        if (!hasAd7124) {
            console.warn("Skipping ad7124-8 channel configuration test: compatible mapping did not include adi,ad7124-8.");
            this.skip();
        }

        const deviceTree = createDeviceTreeFromFixture();
        const controller = createController(deviceTree, undefined, compatibleMapping, storage_path, binding_path);
        const { panel, webview } = createMockPanel();

        const parentLookupRequest = createRequest(DeviceCommands.getPotentialParentNodes, {
            deviceId: "adi,ad7124-8",
        });
        await controller.handle_message(parentLookupRequest, panel);
        const parentLookupResponse = webview.messages.pop() as GetPotentialParentNodesResponse;
        const parentNode = parentLookupResponse.payload.potentialParentNodes[0];
        assert.ok(parentNode, "expected at least one potential parent");

        const attachRequest = createRequest(DeviceCommands.setParentNode, {
            deviceId: "adi,ad7124-8",
            parentNode: parentNode,
        });
        await controller.handle_message(attachRequest, panel);
        const attachResponse = webview.messages.pop() as SetParentNodeResponse;
        const deviceUID = attachResponse.payload.deviceUID;
        assert.ok(deviceUID, "expected device UID after attaching device");

        const initialConfig = await requestDeviceConfig(controller, panel, webview, deviceUID);
        const parentNodeConfig = initialConfig.config.parentNode;

        const updateRequest = createRequest(DeviceCommands.updateConfiguration, {
            deviceUID,
            config: {
                parentNode: parentNodeConfig,
                config: [
                    {
                        type: "FormObject",
                        key: "channel@0",
                        required: false,
                        channelName: "channel@0",
                        config: [
                            {
                                type: "FormArray",
                                key: "reg",
                                required: true,
                                setValue: [0],
                            },
                            {
                                type: "FormArray",
                                key: "diff-channels",
                                required: true,
                                setValue: [0, 1],
                            },
                        ],
                    } as FormObjectElement,
                ],
                ...(initialConfig.config.channelRegexes
                    ? { channelRegexes: initialConfig.config.channelRegexes }
                    : {}),
            },
        });
        await controller.handle_message(updateRequest, panel);

        assert.strictEqual(webview.messages.length, 1, "expected single response message");
        const updateResponse = webview.messages.pop() as UpdateDeviceConfigurationResponse;

        assert.strictEqual(updateResponse.type, "response");
        assert.strictEqual(updateResponse.command, DeviceCommands.updateConfiguration);
        assert.strictEqual(updateResponse.status, "success");

        const updatedConfig = updateResponse.payload.deviceConfiguration.config;
        const createdChannel = updatedConfig.config.find(
            (element) => element.type === "FormObject" && (element as FormObjectElement).channelName === "channel@0"
        ) as FormObjectElement | undefined;

        assert.ok(createdChannel, "expected channel configuration to be returned for matching channel name");
        assert.ok(
            Array.isArray(createdChannel.config) && createdChannel.config.length > 0,
            "expected generated channel configuration to include pattern properties"
        );
    });

    test("device.updateConfiguration removes channels missing from the payload", async function () {
        AnalogAttachLogger.suppressMessages(true);
        this.timeout("20000ms");

        const hasAd7124 = defaultCompatibleMapping.some((entry) => entry.compatible_string === "adi,ad7124-8");
        if (!hasAd7124) {
            console.warn("Skipping channel removal test: compatible mapping did not include adi,ad7124-8.");
            this.skip();
        }

        const deviceTree = createDeviceTreeFromFixture();
        const { controller, attachSession } = createControllerAndSession(deviceTree, undefined, defaultCompatibleMapping);
        const { panel, webview } = createMockPanel();

        const parentLookupRequest = createRequest(DeviceCommands.getPotentialParentNodes, {
            deviceId: "adi,ad7124-8",
        });
        await controller.handle_message(parentLookupRequest, panel);
        const parentLookupResponse = webview.messages.pop() as GetPotentialParentNodesResponse;
        const parentNode = parentLookupResponse.payload.potentialParentNodes[0];
        assert.ok(parentNode, "expected at least one potential parent");

        const attachRequest = createRequest(DeviceCommands.setParentNode, {
            deviceId: "adi,ad7124-8",
            parentNode: parentNode,
        });
        await controller.handle_message(attachRequest, panel);
        const attachResponse = webview.messages.pop() as SetParentNodeResponse;
        const deviceUID = attachResponse.payload.deviceUID;
        assert.ok(deviceUID, "expected device UID after attaching device");

        const deviceNode = attachSession.find_node_by_uuid(deviceUID);
        assert.ok(deviceNode, `cannot find device node with uid: ${deviceUID}`);
        deviceNode.children.push({
            name: "channel",
            labels: [],
            unit_addr: "0",
            _uuid: crypto.randomUUID(),
            properties: [
                {
                    name: "reg",
                    value: {
                        components: [
                            {
                                kind: "array",
                                elements: [
                                    {
                                        item: {
                                            kind: "number",
                                            value: BigInt(0),
                                            labels: [],
                                        },
                                    }
                                ],
                                labels: []
                            }
                        ]
                    },
                    labels: [],
                    deleted: false,
                    modified_by_user: true,
                },
                {
                    name: "diff-channels",
                    modified_by_user: true,
                    labels: [],
                    deleted: false
                },
                {
                    name: "diff-channels",
                    labels: [],
                    deleted: false,
                    modified_by_user: true
                },
            ],
            children: [],
            deleted: false,
            modified_by_user: true,
            created_by_user: true,
        });
        deviceNode.modified_by_user = true;

        const initialConfig = await requestDeviceConfig(controller, panel, webview, deviceUID);
        const channelElement = findElementByKey(initialConfig.config.config, "channel@0");
        assert.ok(channelElement, "expected channel to be present before removal");

        const removalConfig = structuredClone(initialConfig);
        removalConfig.config.config = removalConfig.config.config.filter((element) => element.key !== "channel@0");

        const updateRequest = createRequest(DeviceCommands.updateConfiguration, {
            deviceUID,
            config: removalConfig.config,
        });
        await controller.handle_message(updateRequest, panel);
        webview.messages.pop() as UpdateDeviceConfigurationResponse;

        const refreshedConfig = await requestDeviceConfig(controller, panel, webview, deviceUID);
        const removedChannel = findElementByKey(refreshedConfig.config.config, "channel@0");
        assert.strictEqual(removedChannel, undefined, "expected removed channel to stay deleted");

        const refreshedNode = attachSession.find_node_by_uuid(deviceUID);
        assert.ok(refreshedNode, `cannot find node with uid ${deviceUID}`);
        const existingChannelNode = refreshedNode.children.find(
            (child) => attachSession.buildNodeSegment(child) === "channel@0"
        );
        assert.strictEqual(existingChannelNode, undefined, "expected channel child node removed from device tree");
    });

    test("device.setNodeActive command works with nodes containing unit addresses", async function () {
        AnalogAttachLogger.suppressMessages(true);
        this.timeout("20000ms");

        const initialDtsContent = `/dts-v1/;

/ {
    soc {
        gpio@12340000 {
            status = "okay";
            compatible = "brcm,bcm2835-gpio", "brcm,bcm2711-gpio";
        };

        i2c1: i2c@7e804000 {
            status = "okay";
            compatible = "brcm,bcm2711-i2c", "brcm,bcm2835-i2c";
        };
    };
};`;

        const deviceTree = parse_dts(initialDtsContent, false);
        const { controller, attachSession } = createControllerAndSession(deviceTree, undefined, defaultCompatibleMapping);
        const { panel, webview } = createMockPanel();

        // Test 1: Set node active to false using name without unit address
        const gpioNode = findNodeByNameAndUnit(deviceTree.root, "gpio", "12340000");
        assert.ok(gpioNode, "expected gpio node in tree");
        const setInactiveRequest = createRequest(DeviceCommands.setNodeActive, {
            uuid: gpioNode._uuid,
            active: false,
        });
        await controller.handle_message(setInactiveRequest, panel);
        const setInactiveResponse = webview.messages.pop() as SetNodeActiveResponse;
        assert.strictEqual(setInactiveResponse.status, "success", "expected setNodeActive to succeed");
        const inactiveUid = (setInactiveResponse.payload as any).uid ?? (setInactiveResponse.payload as any).uuid;
        assert.ok(inactiveUid, "expected UID");
        assert.strictEqual(setInactiveResponse.payload.active, false, "expected active to be false");

        // Verify the node actually has status="disabled"
        const deviceTreeAfterDisable = attachSession.get_device_tree();
        const socNode = deviceTreeAfterDisable.root.children.find(child => child.name === "soc");
        assert.ok(socNode, "expected to find soc node");
        const gpioNodeAfterDisable = socNode.children.find(child => child.name === "gpio");
        assert.ok(gpioNodeAfterDisable, "expected to find gpio node");
        const statusProperty = gpioNodeAfterDisable.properties.find(property => property.name === "status");
        assert.ok(statusProperty, "expected status property to exist");
        assert.ok(statusProperty.value?.components[0], "expected status property to have value");
        assert.strictEqual((statusProperty.value.components[0] as any).value, "disabled", "expected status to be disabled");

        // Test 2: Set node active to true using full unit address
        const setActiveRequest = createRequest(DeviceCommands.setNodeActive, {
            uuid: gpioNode._uuid,
            active: true,
        });
        await controller.handle_message(setActiveRequest, panel);
        const setActiveResponse = webview.messages.pop() as SetNodeActiveResponse;
        assert.strictEqual(setActiveResponse.status, "success", "expected setNodeActive to succeed");
        const activeUid = (setActiveResponse.payload as any).uid ?? (setActiveResponse.payload as any).uuid;
        assert.ok(activeUid, "expected UID");
        assert.strictEqual(setActiveResponse.payload.active, true, "expected active to be true");

        // Verify the node now has status="okay"
        const deviceTreeAfterEnable = attachSession.get_device_tree();
        const socNodeAfter = deviceTreeAfterEnable.root.children.find(child => child.name === "soc");
        const gpioNodeAfter = socNodeAfter!.children.find(child => child.name === "gpio");
        const statusPropertyAfter = gpioNodeAfter!.properties.find(property => property.name === "status");
        assert.ok(statusPropertyAfter, "expected status property to exist after enabling");
        assert.strictEqual((statusPropertyAfter.value!.components[0] as any).value, "okay", "expected status to be okay");

        // Test 3: Test with i2c node using label reference
        // eslint-disable-next-line unicorn/prevent-abbreviations
        const i2cNode = findNodeByNameAndUnit(deviceTree.root, "i2c", "7e804000");
        assert.ok(i2cNode, "expected i2c node in tree");
        const setI2cInactiveRequest = createRequest(DeviceCommands.setNodeActive, {
            uuid: i2cNode._uuid,
            active: false,
        });
        await controller.handle_message(setI2cInactiveRequest, panel);
        const setI2cInactiveResponse = webview.messages.pop() as SetNodeActiveResponse;
        assert.strictEqual(setI2cInactiveResponse.status, "success", "expected setNodeActive on i2c to succeed");
        assert.strictEqual(setI2cInactiveResponse.payload.active, false, "expected i2c active to be false");

        // Test 4: Test error case - invalid UID
        const invalidUidRequest = createRequest(DeviceCommands.setNodeActive, {
            uuid: crypto.randomUUID() as any,
            active: true,
        });
        await controller.handle_message(invalidUidRequest, panel);
        const invalidUidResponse = webview.messages.pop() as SetNodeActiveResponse;
        assert.strictEqual(invalidUidResponse.status, "error", "expected setNodeActive with invalid UID to fail");
        assert.ok(invalidUidResponse.error, "expected error to be present");
        assert.ok(invalidUidResponse.error.message.length > 0, "expected error message about node not found");

        // Test 5: Test root node
        const setRootInactiveRequest = createRequest(DeviceCommands.setNodeActive, {
            uuid: deviceTree.root._uuid,
            active: false,
        });
        await controller.handle_message(setRootInactiveRequest, panel);
        const setRootInactiveResponse = webview.messages.pop() as SetNodeActiveResponse;
        assert.strictEqual(setRootInactiveResponse.status, "success", "expected setNodeActive on root to succeed");
        assert.strictEqual(setRootInactiveResponse.payload.active, false, "expected root active to be false");
    });

    test("device.setParentNode attaches catalog devices under selected parents", async () => {
        AnalogAttachLogger.suppressMessages(true);
        const deviceTree = createDeviceTreeFromFixture();
        const controller_and_session = createControllerAndSession(deviceTree, undefined, defaultCompatibleMapping);
        const { panel, webview } = createMockPanel();

        const deviceId = "adi,ad7124-4";
        const parentLookupRequest = createRequest(DeviceCommands.getPotentialParentNodes, {
            deviceId,
        });
        await controller_and_session.controller.handle_message(parentLookupRequest, panel);
        assert.strictEqual(webview.messages.length, 1, "expected parent lookup response");

        const parentLookupResponse = webview.messages.pop() as GetPotentialParentNodesResponse;
        const parentNode = parentLookupResponse.payload.potentialParentNodes[0];
        assert.ok(parentNode, "expected at least one potential parent");

        const setParentRequest = createRequest(DeviceCommands.setParentNode, {
            deviceId,
            parentNode,
        });
        await controller_and_session.controller.handle_message(setParentRequest, panel);

        assert.strictEqual(webview.messages.length, 1, "expected setParentNode response");
        const setParentResponse = webview.messages.pop() as SetParentNodeResponse;

        assert.strictEqual(setParentResponse.type, "response");
        assert.strictEqual(setParentResponse.command, DeviceCommands.setParentNode);
        assert.strictEqual(setParentResponse.status, "success");
        assert.ok(setParentResponse.payload.deviceUID.length > 0, "expected setParentNode to return a device UID");

        const refreshRequest = createEmptyRequest(SessionCommands.getAttachedDevicesState);
        await controller_and_session.controller.handle_message(refreshRequest, panel);
        assert.strictEqual(webview.messages.length, 1, "expected updated attached devices response");
        const refreshResponse = webview.messages[0] as GetAttachedDevicesStateResponse;

        const added_device = controller_and_session.attachSession.find_node_by_uuid(setParentResponse.payload.deviceUID);
        assert.ok(added_device !== undefined, `cannot find id of allegedly set node: ${setParentResponse.payload.deviceUID}`);

        assert.ok(
            refreshResponse.payload.data.some((device) => added_device._uuid === device.deviceUID),
            "expected attached devices list to include the newly attached catalog device"
        );
    });

    test("device.setParentNode increments unit address when attaching duplicates", async () => {
        AnalogAttachLogger.suppressMessages(true);
        const deviceTree = createDeviceTreeFromFixture();
        const { controller, attachSession } = createControllerAndSession(deviceTree, undefined, defaultCompatibleMapping);
        const { panel, webview } = createMockPanel();

        const deviceId = "adi,ad7124-4";
        const parentLookupRequest = createRequest(DeviceCommands.getPotentialParentNodes, {
            deviceId,
        });
        await controller.handle_message(parentLookupRequest, panel);
        assert.strictEqual(webview.messages.length, 1, "expected parent lookup response");
        const parentLookupResponse = webview.messages.pop() as GetPotentialParentNodesResponse;
        const parentNode = parentLookupResponse.payload.potentialParentNodes[0];
        assert.ok(parentNode, "expected at least one potential parent");

        const firstAttachRequest = createRequest(DeviceCommands.setParentNode, {
            deviceId,
            parentNode,
        });
        await controller.handle_message(firstAttachRequest, panel);
        assert.strictEqual(webview.messages.length, 1, "expected first setParentNode response");
        const treeRoot = attachSession.get_device_tree().root;
        const firstNode = findNodeByNameAndUnit(treeRoot, "ad7124-4", "0");
        assert.ok(firstNode, "expected first attached node to exist");
        assert.strictEqual(firstNode.unit_addr, "0", `expected initial unit address to be 0 but got ${firstNode.unit_addr}`);

        const secondAttachRequest = createRequest(DeviceCommands.setParentNode, {
            deviceId,
            parentNode,
        });
        await controller.handle_message(secondAttachRequest, panel);
        assert.ok(webview.messages.length > 0, "expected second setParentNode response");
        const secondNode = findNodeByNameAndUnit(treeRoot, "ad7124-4", "1");

        assert.ok(secondNode, "expected second attached node to exist");
        assert.strictEqual(secondNode.unit_addr, "1", `expected duplicate unit address to be 1 but got ${secondNode.unit_addr}`);

        const refreshRequest = createEmptyRequest(SessionCommands.getAttachedDevicesState);
        await controller.handle_message(refreshRequest, panel);
        const refreshResponse = webview.messages.pop() as GetAttachedDevicesStateResponse;
        assert.ok(refreshResponse, "expected updated attached devices response");
        const duplicates = refreshResponse.payload.data.filter((device) => device.compatible === deviceId);
        assert.strictEqual(duplicates.length, 2, "expected two attached devices with the same catalog id");
    });

    test("device.updateConfiguration moves the node when the parent changes", async () => {
        AnalogAttachLogger.suppressMessages(true);
        const deviceTree = createDeviceTreeFromFixture();
        deviceTree.root.children.push(
            {
                name: "i2c-mock-parent",
                unit_addr: undefined,
                _uuid: crypto.randomUUID(),
                properties: [],
                children: [],
                labels: [],
                modified_by_user: true,
                created_by_user: true,
                deleted: false
            },
            {
                name: "spi-mock-parent",
                unit_addr: undefined,
                _uuid: crypto.randomUUID(),
                properties: [],
                children: [],
                labels: [],
                modified_by_user: true,
                created_by_user: true,
                deleted: false
            }
        );
        const controller = createController(deviceTree, undefined, defaultCompatibleMapping);
        const { panel, webview } = createMockPanel();

        const deviceId = "adi,ad7124-4";
        const parentLookupRequest = createRequest(DeviceCommands.getPotentialParentNodes, {
            deviceId,
        });
        await controller.handle_message(parentLookupRequest, panel);
        const parentLookupResponse = webview.messages.pop() as GetPotentialParentNodesResponse;
        assert.ok(
            parentLookupResponse.payload.potentialParentNodes.length >= 2,
            "expected at least two potential parents to validate moving logic"
        );
        const [firstParent, secondParent] = parentLookupResponse.payload.potentialParentNodes;
        assert.ok(firstParent && secondParent, "expected two distinct parent nodes");

        const attachRequest = createRequest(DeviceCommands.setParentNode, {
            deviceId: deviceId,
            parentNode: firstParent,
        });
        await controller.handle_message(attachRequest, panel);
        const attachResponse = webview.messages.pop() as SetParentNodeResponse;
        const originalDeviceUID = attachResponse.payload.deviceUID;

        const configRequest = createRequest(DeviceCommands.getConfiguration, { deviceUID: originalDeviceUID });
        await controller.handle_message(configRequest, panel);
        const configResponse = webview.messages.pop() as GetDeviceConfigurationResponse | undefined;
        assert.ok(configResponse, "No response received for device.getConfiguration");
        assert.strictEqual(
            configResponse?.status,
            "success",
            `device.getConfiguration returned error: ${configResponse?.error?.message ?? "unknown error"}`
        );
        const config = configResponse.payload.deviceConfiguration.config;
        const newAlias = "moved-ad7124";
        config.alias = newAlias;

        config.parentNode = secondParent;
        const editRequest = createRequest(DeviceCommands.updateConfiguration, {
            deviceUID: originalDeviceUID,
            config,
        });
        await controller.handle_message(editRequest, panel);
        const editResponse = webview.messages.pop() as UpdateDeviceConfigurationResponse | undefined;
        assert.ok(editResponse, "No response received for device.updateConfiguration");
        assert.strictEqual(editResponse.type, "response");
        assert.strictEqual(editResponse.command, DeviceCommands.updateConfiguration);
        assert.strictEqual(
            editResponse?.status,
            "success",
            `device.updateConfiguration returned error: ${editResponse?.error?.message ?? "unknown error"}`
        );

        const refreshRequest = createEmptyRequest(SessionCommands.getAttachedDevicesState);
        await controller.handle_message(refreshRequest, panel);
        const refreshResponse = webview.messages.pop() as GetAttachedDevicesStateResponse;
        const movedDevice = refreshResponse.payload.data.find(
            (entry) => entry.deviceUID === originalDeviceUID || entry.compatible === deviceId
        );
        assert.ok(movedDevice, "expected moved device to remain in the tree");
        assert.strictEqual(
            movedDevice?.parentNode.uuid,
            secondParent.uuid,
            "expected parent node to update after move"
        );
        assert.strictEqual(
            movedDevice?.alias,
            newAlias,
            "expected alias update to apply after moving"
        );
        assert.strictEqual(
            movedDevice?.deviceUID,
            originalDeviceUID,
            "expected device UID to stay stable after move"
        );
    });

    test("device.updateConfiguration edits adxl355 configuration across multiple commands", async () => {
        AnalogAttachLogger.suppressMessages(true);
        const deviceTree = createDeviceTreeFromFixture();
        const { controller, attachSession } = createControllerAndSession(deviceTree, undefined, defaultCompatibleMapping);
        const { panel, webview } = createMockPanel();

        const deviceId = "adi,adxl355";
        const parentLookupRequest = createRequest(DeviceCommands.getPotentialParentNodes, {
            deviceId,
        });
        await controller.handle_message(parentLookupRequest, panel);
        const parentLookupResponse = webview.messages.pop() as GetPotentialParentNodesResponse;
        const parentNode = parentLookupResponse.payload.potentialParentNodes[0];
        assert.ok(parentNode, "expected at least one potential parent for adxl355");

        const attachRequest = createRequest(DeviceCommands.setParentNode, {
            deviceId: deviceId,
            parentNode: parentNode,
        });
        await controller.handle_message(attachRequest, panel);
        const attachResponse = webview.messages.pop() as SetParentNodeResponse;
        const deviceUID = attachResponse.payload.deviceUID;
        assert.ok(deviceUID, "expected device UID after attaching adxl355");

        const initialConfigResponse = await requestDeviceConfig(controller, panel, webview, deviceUID);
        const compatibleUpdatedConfig = structuredClone(initialConfigResponse);
        setGenericValue(compatibleUpdatedConfig.config.config, "compatible", ["adi,adxl359"]);
        const compatibleUpdateRequest = createRequest(DeviceCommands.updateConfiguration, {
            deviceUID: deviceUID,
            config: compatibleUpdatedConfig.config,
        });
        await controller.handle_message(compatibleUpdateRequest, panel);
        webview.messages.pop() as UpdateDeviceConfigurationResponse;

        const spirxConfigResponse = await requestDeviceConfig(controller, panel, webview, deviceUID);
        const spirxUpdatedConfig = structuredClone(spirxConfigResponse);
        setGenericValue(spirxUpdatedConfig.config.config, "spi-rx-bus-width", 2);
        const spirxUpdateRequest = createRequest(DeviceCommands.updateConfiguration, {
            deviceUID,
            config: spirxUpdatedConfig.config,
        });
        await controller.handle_message(spirxUpdateRequest, panel);
        webview.messages.pop() as UpdateDeviceConfigurationResponse;

        const node = attachSession.find_node_by_uuid(deviceUID);
        assert.ok(node !== undefined, `did not find node with UUD: ${deviceUID}`);
        const compatProperty = node.properties.find((p) => p.name === "compatible");
        let compatValue = extractStringProperty(node, "compatible");
        if (!compatValue && compatProperty?.value?.components?.[0]?.kind === "array") {
            const firstElement = compatProperty.value.components[0].elements[0];
            if (firstElement?.item.kind === "expression") {
                compatValue = firstElement.item.value;
            }
        }
        assert.strictEqual(compatValue, "adi,adxl359");
        const spi_rx = node.properties.find((p) => p.name === "spi-rx-bus-width");
        assert.ok(
            spi_rx !== undefined &&
            spi_rx.value !== undefined &&
            spi_rx.value.components[0].kind === "array" &&
            spi_rx.value.components[0].elements[0].item.kind === "number" &&
            spi_rx.value.components[0].elements[0].item.value === BigInt(2)
        );
    });

    test("device.updateConfiguration can move adxl355 and then edit fields post-move", async () => {
        AnalogAttachLogger.suppressMessages(true);
        const deviceTree = createDeviceTreeFromFixture();
        deviceTree.root.children.push(
            {
                name: "i2c-mock-parent",
                unit_addr: undefined,
                _uuid: crypto.randomUUID(),
                properties: [],
                children: [],
                labels: [],
                modified_by_user: true,
                created_by_user: true,
                deleted: false
            },
            {
                name: "spi-mock-parent",
                unit_addr: undefined,
                _uuid: crypto.randomUUID(),
                properties: [],
                children: [],
                labels: [],
                modified_by_user: true,
                created_by_user: true,
                deleted: false
            }
        );
        const { controller, attachSession } = createControllerAndSession(deviceTree, undefined, defaultCompatibleMapping);
        const { panel, webview } = createMockPanel();

        const deviceId = "adi,adxl355";
        const parentLookupRequest = createRequest(DeviceCommands.getPotentialParentNodes, { deviceId });
        await controller.handle_message(parentLookupRequest, panel);
        const parentLookupResponse = webview.messages.pop() as GetPotentialParentNodesResponse;
        const [firstParent, secondParent] = parentLookupResponse.payload.potentialParentNodes;
        assert.ok(firstParent && secondParent, "expected two parent options for move test");

        const attachRequest = createRequest(DeviceCommands.setParentNode, {
            deviceId,
            parentNode: firstParent,
        });
        await controller.handle_message(attachRequest, panel);
        const attachResponse = webview.messages.pop() as SetParentNodeResponse;
        const originalDeviceUID = attachResponse.payload.deviceUID;
        assert.ok(originalDeviceUID, "expected device UID after attaching adxl355");

        const initialConfig = await requestDeviceConfig(controller, panel, webview, originalDeviceUID);
        const moveConfig = structuredClone(initialConfig);
        moveConfig.config.parentNode = secondParent;
        const moveRequest = createRequest(DeviceCommands.updateConfiguration, {
            deviceUID: originalDeviceUID,
            config: moveConfig.config,
        });
        await controller.handle_message(moveRequest, panel);
        webview.messages.pop() as UpdateDeviceConfigurationResponse;

        const stateRequest = createEmptyRequest(SessionCommands.getAttachedDevicesState);
        await controller.handle_message(stateRequest, panel);
        const stateResponse = webview.messages.pop() as GetAttachedDevicesStateResponse;
        const movedState = stateResponse.payload.data.find(
            (entry) => entry.deviceUID === originalDeviceUID || entry.compatible === deviceId
        );
        assert.ok(movedState, "expected moved device in attached devices list");
        assert.strictEqual(
            movedState.parentNode.uuid,
            secondParent.uuid,
            "expected parent node to update after move"
        );
        const movedDeviceUID = movedState.deviceUID;

        const aliasConfig = await requestDeviceConfig(controller, panel, webview, movedDeviceUID);
        const updatedAliasConfig = structuredClone(aliasConfig);
        const newAlias = "moved-adxl355";
        updatedAliasConfig.config.alias = newAlias;
        const aliasUpdateRequest = createRequest(DeviceCommands.updateConfiguration, {
            deviceUID: movedDeviceUID,
            config: updatedAliasConfig.config,
        });
        await controller.handle_message(aliasUpdateRequest, panel);
        const aliasUpdateResponse = webview.messages.pop() as UpdateDeviceConfigurationResponse;
        assert.strictEqual(aliasUpdateResponse.status, "success");

        const node = attachSession.find_node_by_uuid(movedDeviceUID);
        assert.ok(node, "expected node to exist after move");
        assert.strictEqual(node.labels?.[0], newAlias, "expected alias to persist after move + edit");
    });

    test("device.delete removes attached catalog devices", async () => {
        AnalogAttachLogger.suppressMessages(true);
        const deviceTree = createDeviceTreeFromFixture();
        const controller = createController(deviceTree, undefined, defaultCompatibleMapping);
        const { panel, webview } = createMockPanel();

        const deviceId = "adi,ad7124-4";
        const parentLookupRequest = createRequest(DeviceCommands.getPotentialParentNodes, {
            deviceId,
        });
        await controller.handle_message(parentLookupRequest, panel);
        assert.strictEqual(webview.messages.length, 1, "expected parent lookup response");
        const parentLookupResponse = webview.messages.pop() as GetPotentialParentNodesResponse;
        const parentNode = parentLookupResponse.payload.potentialParentNodes[0];
        assert.ok(parentNode, "expected at least one potential parent");

        const setParentRequest = createRequest(DeviceCommands.setParentNode, {
            deviceId,
            parentNode,
        });
        await controller.handle_message(setParentRequest, panel);
        assert.strictEqual(webview.messages.length, 1, "expected setParentNode response");
        const setParentResponse = webview.messages.pop() as SetParentNodeResponse;
        const deviceUID = setParentResponse.payload.deviceUID;
        assert.ok(deviceUID.length > 0, "expected a device UID from setParentNode");

        const verifyAttachRequest = createEmptyRequest(SessionCommands.getAttachedDevicesState);
        await controller.handle_message(verifyAttachRequest, panel);
        assert.strictEqual(webview.messages.length, 1, "expected attached devices response after attach");
        const attachResponse = webview.messages.pop() as GetAttachedDevicesStateResponse;
        const attachedDevice = attachResponse.payload.data.find(
            (device) => device.deviceUID === deviceUID
        );
        assert.ok(
            attachedDevice,
            "expected attached devices list to include the newly attached catalog device"
        );

        const deleteRequest = createRequest(DeviceCommands.delete, {
            deviceUID,
        });
        await controller.handle_message(deleteRequest, panel);
        assert.strictEqual(webview.messages.length, 1, "expected delete response");
        const deleteResponse = webview.messages.pop() as DeleteDeviceResponse;

        assert.strictEqual(deleteResponse.type, "response");
        assert.strictEqual(deleteResponse.command, DeviceCommands.delete);
        assert.strictEqual(deleteResponse.status, "success");
        assert.strictEqual(deleteResponse.payload.deviceUID, deviceUID);

        const refreshRequest = createEmptyRequest(SessionCommands.getAttachedDevicesState);
        await controller.handle_message(refreshRequest, panel);
        assert.strictEqual(webview.messages.length, 1, "expected attached devices response");
        const refreshResponse = webview.messages.pop() as GetAttachedDevicesStateResponse;
        const deletedDeviceStillPresent = refreshResponse.payload.data.find(
            (device) => device.deviceUID === deviceUID
        );
        assert.strictEqual(
            deletedDeviceStillPresent,
            undefined,
            "expected attached devices list to exclude the deleted catalog device"
        );
    });

    test("tree.getDeviceTree contains expected soc/spi structure from rpi.prepro.dts", async () => {
        AnalogAttachLogger.suppressMessages(true);
        const deviceTree = createDeviceTreeFromFixture();
        const controller = createController(deviceTree);
        const { panel, webview } = createMockPanel();

        const request = createEmptyRequest(TreeViewCommands.getDeviceTree);
        await controller.handle_message(request, panel);

        assert.strictEqual(webview.messages.length, 1, "expected single response message");
        const response = webview.messages[0] as GetDeviceTreeResponse;

        assert.strictEqual(response.type, "response");
        assert.strictEqual(response.command, TreeViewCommands.getDeviceTree);
        assert.strictEqual(response.status, "success");

        const { deviceTree: deviceTreeElement } = response.payload;

        const rootElement = deviceTreeElement as FormObjectElement;

        // Find the soc FormObject
        const socElement = findElementByKey(rootElement.config, "soc");
        assert.ok(socElement, "expected to find 'soc' FormObject in device tree");
        assert.strictEqual(socElement.type, "FormObject", "expected soc to be FormObject");

        // Find spi inside soc
        const spiElement = findElementByKey((socElement as FormObjectElement).config, "spi");
        assert.ok(spiElement, "expected to find 'spi' FormObject inside soc");
        assert.strictEqual(spiElement.type, "FormObject", "expected spi to be FormObject");

        // Check alias
        const spiFormObject = spiElement as FormObjectElement;
        assert.strictEqual(spiFormObject.alias, "spi0", "expected spi to have alias 'spi0'");

        // Find dma-names FormArray inside spi
        const dmaNamesElement = findElementByKey(spiFormObject.config, "dma-names");
        assert.ok(dmaNamesElement, "expected to find 'dma-names' element inside spi");
        assert.strictEqual(dmaNamesElement.type, "FormArray", "expected dma-names to be FormArray");

        // Check dma-names values
        const dmaNamesArray = dmaNamesElement as FormArrayElement;
        assert.ok(Array.isArray(dmaNamesArray.setValue), "expected dma-names setValue to be array");
        assert.deepStrictEqual(dmaNamesArray.setValue, ["tx", "rx"], "expected dma-names to contain ['tx', 'rx']");

        // Test deviceUID population
        assert.ok(rootElement.deviceUID, "expected root element to expose deviceUID");
        assert.ok((socElement as FormObjectElement).deviceUID, "expected soc element to expose deviceUID");
        assert.ok(spiFormObject.deviceUID, "expected spi element to expose deviceUID");
    });

    test("device.updateConfiguration persists active flag to file (both enabled and disabled)", async function () {
        AnalogAttachLogger.suppressMessages(true);
        this.timeout("20000ms");

        // Create a temporary file for this test
        const temporaryFilePath = path.resolve(__dirname, "../../test/temp_active_flag_test.dts");
        const initialDtsContent = `/dts-v1/;

/ {
    soc {
        spi@7e204000 {
			compatible = "brcm,bcm2835-spi";
			#address-cells = <1>;
			#size-cells = <0>;
            status = "okay";
        };
    };
};`;

        try {
            // Write initial DTS content to file
            fs.writeFileSync(temporaryFilePath, initialDtsContent, "utf8");
            const deviceTree = parse_dts(initialDtsContent, false);

            // Create controller with file URI
            const { controller, attachSession } = createControllerAndSession(deviceTree, undefined, defaultCompatibleMapping);

            // Set file URI on attach session to enable auto-save
            const mockUri = { fsPath: temporaryFilePath } as any;
            (attachSession as any).file_uri = mockUri;

            const { panel, webview } = createMockPanel();

            const deviceId = "adi,ad7124-4";
            const parentLookupRequest = createRequest(DeviceCommands.getPotentialParentNodes, {
                deviceId,
            });
            await controller.handle_message(parentLookupRequest, panel);
            const parentLookupResponse = webview.messages.pop() as GetPotentialParentNodesResponse;
            const parentNode = parentLookupResponse.payload.potentialParentNodes[0];
            assert.ok(parentNode, "expected at least one potential parent");

            // Attach device
            const attachRequest = createRequest(DeviceCommands.setParentNode, {
                deviceId,
                parentNode,
            });
            await controller.handle_message(attachRequest, panel);
            const attachResponse = webview.messages.pop() as SetParentNodeResponse;
            const deviceUID = attachResponse.payload.deviceUID;
            assert.ok(deviceUID, "expected device UID after attaching device");

            // Test 1: Set active=false and verify status="disabled"
            const initialConfig = await requestDeviceConfig(controller, panel, webview, deviceUID);
            const disabledConfig = structuredClone(initialConfig);
            disabledConfig.config.active = false;

            const disableRequest = createRequest(DeviceCommands.updateConfiguration, {
                deviceUID,
                config: disabledConfig.config,
            });
            await controller.handle_message(disableRequest, panel);
            const disableResponse = webview.messages.pop() as UpdateDeviceConfigurationResponse;
            assert.strictEqual(disableResponse.status, "success");

            // Check file contents for disabled status
            let savedFileContent = fs.readFileSync(temporaryFilePath, "utf8");
            console.log("File content after setting active=false:", savedFileContent);
            assert.ok(savedFileContent.includes('status = "disabled"'), "expected status='disabled' in saved file");

            // Test 2: Set active=true and verify status="okay"
            const enabledConfig = structuredClone(disabledConfig);
            enabledConfig.config.active = true;

            const enableRequest = createRequest(DeviceCommands.updateConfiguration, {
                deviceUID,
                config: enabledConfig.config,
            });
            await controller.handle_message(enableRequest, panel);
            const enableResponse = webview.messages.pop() as UpdateDeviceConfigurationResponse;
            assert.strictEqual(enableResponse.status, "success");

            // Check file contents for enabled status
            savedFileContent = fs.readFileSync(temporaryFilePath, "utf8");
            console.log("File content after setting active=true:", savedFileContent);
            assert.ok(savedFileContent.includes('status = "okay"'), "expected status='okay' in saved file");

        } finally {
            // Clean up temp file
            try {
                fs.unlinkSync(temporaryFilePath);
            } catch (error) {
                console.warn(`Failed to clean up temp file ${temporaryFilePath}:`, error);
            }
        }
    });
});

// Helper function to find element by key at one level
function findElementByKey(elements: FormElement[], key: string): FormElement | undefined {
    for (const element of elements) {
        if (element.key === key) {
            return element;
        }
    }
    return undefined;
}

function findNodeByNameAndUnit(root: DtsNode, name: string, unit_addr?: string): DtsNode | undefined {
    const matches = root.name === name && (unit_addr === undefined || root.unit_addr === unit_addr);
    if (matches) {
        return root;
    }
    for (const child of root.children) {
        const hit = findNodeByNameAndUnit(child, name, unit_addr);
        if (hit) {
            return hit;
        }
    }
    return undefined;
}

function createController(
    deviceTree: DtsDocument,
    catalogDevices?: CatalogDevice[],
    compatibleMappingOverride: CompatibleMapping[] = defaultCompatibleMapping,
    storagePath = TEST_STORAGE_PATH,
    linuxBindingsFolder = TEST_LINUX_BINDINGS_FOLDER
): PlugAndPlayWebviewController {
    return createControllerAndSession(
        deviceTree,
        catalogDevices,
        compatibleMappingOverride,
        storagePath,
        linuxBindingsFolder
    ).controller;
}

function createControllerAndSession(
    deviceTree: DtsDocument,
    catalogDevices?: CatalogDevice[],
    compatibleMappingOverride: CompatibleMapping[] = defaultCompatibleMapping,
    storagePath = TEST_STORAGE_PATH,
    linuxBindingsFolder = TEST_LINUX_BINDINGS_FOLDER
): { controller: PlugAndPlayWebviewController; attachSession: AttachSession } {
    const catalogSource = catalogDevices ?? loadMockCatalogDevices();
    const mappingSource = compatibleMappingOverride ?? defaultCompatibleMapping;
    const compatibleMapping: CompatibleMapping[] = (mappingSource.length > 0
        ? mappingSource
        : catalogSource.map((device) => ({
            compatible_string: device.deviceId,
            binding_path: resolveBindingPath(
                device.deviceId,
                linuxBindingsFolder,
                device.group ?? "misc"
            ),
        }))).map((entry) => ({ ...entry }));


    const linux_path = path.resolve(__dirname, "../../test/linux");
    const dt_schema_path = path.resolve(__dirname, "../../test/dt-schema");

    const attachSession = AttachSession.createTestSession(
        [],
        compatibleMapping,
        storagePath,
        deviceTree,
        linuxBindingsFolder,
        linux_path,
        dt_schema_path,
        new Map()
    );

    return {
        controller: PlugAndPlayWebviewController.create(attachSession),
        attachSession,
    };
}

function createMockPanel(): { panel: WebviewPanel; webview: MockWebview } {
    const webview = new MockWebview();
    const panel = { webview } as unknown as WebviewPanel;
    return { panel, webview };
}

async function requestDeviceConfig(
    controller: PlugAndPlayWebviewController,
    panel: WebviewPanel,
    webview: MockWebview,
    deviceUID: string
): Promise<ConfigTemplatePayload> {
    const request = createRequest(DeviceCommands.getConfiguration, { deviceUID });
    await controller.handle_message(request, panel);
    const response = webview.messages.pop() as GetDeviceConfigurationResponse;
    return response.payload.deviceConfiguration;
}

function setGenericValue(elements: FormElement[], key: string, value: unknown): void {
    for (const element of elements) {
        if (element.type === "FormObject") {
            setGenericValue(element.config, key, value);
            continue;
        }

        if (element.key === key) {
            if (element.type === "Generic") {
                element.setValue = value;
                return;
            }
            if (element.type === "FormArray") {
                element.setValue = Array.isArray(value) ? value : [value];
                return;
            }
        }
    }
    throw new Error(`Generic form element with key "${key}" not found in configuration`);
}

function setFlagValue(elements: FormElement[], key: string, value: boolean): void {
    for (const element of elements) {
        if (element.type === "FormObject") {
            setFlagValue(element.config, key, value);
            continue;
        }

        if (element.type === "Flag" && element.key === key) {
            element.setValue = value;
            return;
        }
    }
    throw new Error(`Flag form element with key "${key}" not found in configuration`);
}

function extractStringProperty(node: DtsNode, propertyName: string): string | undefined {
    const property = node.properties.find((entry) => entry.name === propertyName);
    if (!property?.value) {
        return undefined;
    }

    for (const component of property.value.components) {
        if (component.kind === "string") {
            return component.value;
        }
    }

    return undefined;
}

function createDeviceTreeFromFixture(): DtsDocument {
    // NOTE: If the basic parse_dts and mergeDtso functions fail, this test
    // is also expected to fail, obviously
    const fixturePath = path.resolve(__dirname, "../../test/dts_source/rpi.prepro.dts");
    const source = fs.readFileSync(fixturePath, "utf8");
    const baseDocument = parse_dts(source, false);
    return mergeDtso(baseDocument, USER_DEVICE_OVERLAY);
}

const USER_DEVICE_OVERLAY = String.raw`/dts-v1/;
/plugin/;

&spi0 {
    imu0: my-device@0 {
        compatible = "adi,my-device";
        status = "okay";

        chan0: channel0 {
            status = "okay";
        };
    };
};
`;

class MockWebview {
    public readonly messages: unknown[] = [];

    public async postMessage(message: unknown): Promise<boolean> {
        this.messages.push(message);
        return true;
    }
}

function createEmptyRequest<TCommand extends string>(
    command: TCommand
): AnalogAttachRequestEnvelope<TCommand, AnalogAttachEmptyPayload> {
    return createRequest(command, {} as AnalogAttachEmptyPayload);
}

function createRequest<TCommand extends string, TPayload>(
    command: TCommand,
    payload: TPayload
): AnalogAttachRequestEnvelope<TCommand, TPayload> {
    return {
        id: `${command}-request`,
        type: "request",
        timestamp: new Date().toISOString(),
        command,
        payload,
    };
}

function loadMockCatalogDevices(): CatalogDevice[] {
    const catalogPath = path.resolve(
        __dirname,
        "../../../../src/MessageAPI/mocked-data/device_catalog.json"
    );

    try {
        const fileContents = fs.readFileSync(catalogPath, "utf8");
        const withoutComments = fileContents.replaceAll(/\/\*[\s\S]*?\*\//g, "");
        const parsed = JSON.parse(withoutComments) as { devices: CatalogDevice[] };
        return parsed.devices;
    } catch (error) {
        console.warn(`Failed to load mock device catalog from ${catalogPath}`, error);
        return [];
    }
}

// FIXME: idk what this is an if we need it
function resolveBindingPath(deviceId: string, linuxBindingsFolder: string, group: string): string {
    const groupFolder = path.join(linuxBindingsFolder, "iio", group);
    const variantPath = path.join(groupFolder, `${deviceId}.yaml`);
    if (fs.existsSync(variantPath)) {
        return variantPath;
    }

    // Fallback: strip variant suffix (e.g. adi,ad7124-4 -> adi,ad7124)
    const [, suffix] = deviceId.split(",");
    const baseName = suffix?.split("-")[0];
    if (baseName) {
        const baseId = `adi,${baseName}`;
        const basePath = path.join(groupFolder, `${baseId}.yaml`);
        if (fs.existsSync(basePath)) {
            return basePath;
        }
    }

    // Default to the original path if no fallback exists
    return variantPath;
}
