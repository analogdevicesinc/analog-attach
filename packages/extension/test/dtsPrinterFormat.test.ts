import assert from "node:assert";
import {
    DeviceCommands,
    type AnalogAttachRequestEnvelope,
    type UpdateDeviceConfigurationRequest,
    type ConfigTemplatePayload,
    type FormElement,
} from "extension-protocol";
import { printDts } from "attach-lib";
import { PlugAndPlayWebviewController } from "../src/WebviewControllers/PlugAndPlayWebviewController";
import type { WebviewPanel } from "vscode";
import {
    createTestAttachSession,
    createEmptyDocument,
    createTestNode,
} from "./testUtilities";

class MockWebview {
    public messages: unknown[] = [];
    public async postMessage(message: unknown): Promise<boolean> {
        this.messages.push(message);
        return true;
    }
}

function createMockPanel(): { panel: { webview: MockWebview }; webview: MockWebview } {
    const webview = new MockWebview();
    const panel = { webview };
    return { panel, webview };
}

suite("Message API -> DTS printer formatting", () => {
    test("applies matrix/arrays via message API and prints expected DTS syntax", async () => {
        const deviceTree = createEmptyDocument();
        const deviceNode = createTestNode({
            name: "device",
        });
        deviceTree.root.children.push(deviceNode);

        const attachSession = createTestAttachSession({ deviceTree });

        // Stub binding resolution to allow updateConfiguration without real bindings
        (attachSession as any).buildFormElementsForNode = async () => ({
            binding: { properties: [] },
            requiredKeys: new Set<string>(),
            patterns: [],
            errors: [],
        });

        const controller = PlugAndPlayWebviewController.create(attachSession);
        const { panel, webview } = createMockPanel();

        const configPayload: ConfigTemplatePayload["config"] = {
            type: "DeviceConfigurationFormObject",
            parentNode: { uuid: deviceTree.root._uuid, name: deviceTree.root.name },
            config: buildTestElements(),
        };

        const request: AnalogAttachRequestEnvelope<
            (typeof DeviceCommands)["updateConfiguration"],
            UpdateDeviceConfigurationRequest["payload"]
        > = {
            id: "update",
            type: "request",
            timestamp: new Date().toISOString(),
            command: DeviceCommands.updateConfiguration,
            payload: {
                deviceUID: deviceNode._uuid,
                config: configPayload
            },
        };

        await controller.handle_message(request, panel as unknown as WebviewPanel);
        webview.messages.pop(); // ignore response details

        const printed = printDts(attachSession.get_device_tree());
        const expected = [
            "/dts-v1/;",
            "/ {",
            "\tdevice {",
            "\t\tsimple-number = <1>;",
            "\t\thex-number = <3735928559>;",
            '\t\ttext-value = "hello-world";',
            '\t\tdropdown-value = "option-a";',
            "\t\tflag-enabled;",
            "\t\tnumber-array = <1 2 3>;",
            '\t\tstring-array = "aa", "bb";',
            "\t\tmatrix = <1 2 3 4>, <1 2 3 4>;",
            "\t\tcustom-number = <42>;",
            '\t\tcustom-text = "custom-value";',
            "\t\tcustom-flag;",
            "\t\tphandle-ref = <&some_label>;",
            "\t};",
            "};",
            "",
        ].join("\n");

        assert.strictEqual(printed, expected);
    });
});

function buildTestElements(): FormElement[] {
    return [
        // Generic number
        {
            type: "Generic",
            key: "simple-number",
            inputType: "number",
            required: false,
            setValue: 1,
        },
        // Generic number (hex format)
        {
            type: "Generic",
            key: "hex-number",
            inputType: "number",
            required: false,
            setValue: 0xDE_AD_BE_EF,
        },
        // Generic text
        {
            type: "Generic",
            key: "text-value",
            inputType: "text",
            required: false,
            setValue: "hello-world",
        },
        // Generic dropdown
        {
            type: "Generic",
            key: "dropdown-value",
            inputType: "dropdown",
            required: false,
            setValue: "option-a",
        },
        // Flag (boolean property)
        {
            type: "Flag",
            key: "flag-enabled",
            required: false,
            setValue: true,
        },
        // FormArray with numbers
        {
            type: "FormArray",
            key: "number-array",
            required: false,
            setValue: [1, 2, 3],
        },
        // FormArray with strings
        {
            type: "FormArray",
            key: "string-array",
            required: false,
            setValue: ["aa", "bb"],
        },
        // FormMatrix
        {
            type: "FormMatrix",
            key: "matrix",
            required: false,
            setValue: [
                [1, 2, 3, 4],
                [1, 2, 3, 4],
            ],
        },
        // Custom number
        {
            type: "Generic",
            key: "custom-number",
            inputType: "custom-number",
            required: false,
            setValue: 42,
        },
        // Custom text
        {
            type: "Generic",
            key: "custom-text",
            inputType: "custom",
            required: false,
            setValue: "custom-value",
        },
        // Custom flag
        {
            type: "Generic",
            key: "custom-flag",
            inputType: "custom-flag",
            required: false,
            setValue: true,
        },
        // Custom phandle reference
        {
            type: "Generic",
            key: "phandle-ref",
            inputType: "custom-phandle",
            required: false,
            setValue: "some_label",
        },
    ];
}
