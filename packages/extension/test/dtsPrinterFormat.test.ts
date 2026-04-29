import assert from "node:assert";
import path from "node:path";
import {
    DeviceCommands,
    type AnalogAttachRequestEnvelope,
    type UpdateDeviceConfigurationRequest,
    type ConfigTemplatePayload,
    type FormElement,
} from "extension-protocol";
import { printDts, type DtsDocument, type DtsNode } from "attach-lib";
import { PlugAndPlayWebviewController } from "../src/WebviewControllers/PlugAndPlayWebviewController";
import { AttachSession } from "../src/AttachSession/AttachSession";
import type { WebviewPanel } from "vscode";

class MockWebview {
    public messages: unknown[] = [];
    public async postMessage(message: unknown): Promise<boolean> {
        this.messages.push(message);
        return true;
    }
}

suite("Message API -> DTS printer formatting", () => {
    test("applies matrix/arrays via message API and prints expected DTS syntax", async () => {
        const { controller, attachSession } = createControllerAndSessionWithStubbedBinding();
        const { panel, webview } = createMockPanel();
        const deviceTree = attachSession.get_device_tree();
        const rootNode = deviceTree.root;
        const deviceNode = rootNode.children[0];
        assert.ok(deviceNode, "expected test device node");

        const configPayload: ConfigTemplatePayload["config"] = {
            type: "DeviceConfigurationFormObject",
            parentNode: { uuid: rootNode._uuid, name: rootNode.name },
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
            "\t\tnumber-array = <1 2 3>;",
            '\t\tstring-array = "aa", "bb";',
            "\t\tmatrix = <1 2 3 4>, <1 2 3 4>;",
            "\t};",
            "};",
            "",
        ].join("\n");

        assert.strictEqual(printed, expected);
    });
});

function buildTestElements(): FormElement[] {
    return [
        {
            type: "Generic",
            key: "simple-number",
            inputType: "number",
            required: false,
            setValue: 1,
        },
        {
            type: "FormArray",
            key: "number-array",
            required: false,
            setValue: [1, 2, 3],
        },
        {
            type: "FormArray",
            key: "string-array",
            required: false,
            setValue: ["aa", "bb"],
        },
        {
            type: "FormMatrix",
            key: "matrix",
            required: false,
            setValue: [
                [1, 2, 3, 4],
                [1, 2, 3, 4],
            ],
        },
    ];
}

function createMockPanel(): { panel: { webview: MockWebview }; webview: MockWebview } {
    const webview = new MockWebview();
    const panel = { webview };
    return { panel, webview };
}

function createControllerAndSessionWithStubbedBinding(): {
    controller: PlugAndPlayWebviewController;
    attachSession: AttachSession;
} {
    const device_tree = createDeviceTree();
    const attachSession = new (AttachSession as unknown as {
        new(
            subsystems: string[],
            compatible_mapping: unknown[],
            storage_path: string,
            device_tree: DtsDocument,
            linux_bindings_folder: string,
            label_map: Map<string, string>,
            file_uri?: unknown
        ): AttachSession;
    })([], [], path.resolve(__dirname, "../../test"), device_tree, "", new Map());

    // Stub binding resolution to allow updateConfiguration without real bindings
    (attachSession as any).buildFormElementsForNode = async () => ({
        binding: { properties: [] },
        requiredKeys: new Set<string>(),
        patterns: [],
        errors: [],
    });

    const controller = PlugAndPlayWebviewController.create(attachSession);
    return { controller, attachSession };
}

function createDeviceTree(): DtsDocument {
    const deviceNode: DtsNode = {
        name: "device",
        unit_addr: undefined,
        _uuid: crypto.randomUUID(),
        properties: [],
        children: [],
        labels: [],
        deleted: false,
        created_by_user: true,
        modified_by_user: true,
    };

    return {
        memreserves: [],
        root: {
            name: "/",
            unit_addr: undefined,
            _uuid: crypto.randomUUID(),
            properties: [],
            children: [deviceNode],
            labels: [],
            deleted: false,
            created_by_user: true,
            modified_by_user: true,
        },
        unresolved_overlays: []
    };
}
