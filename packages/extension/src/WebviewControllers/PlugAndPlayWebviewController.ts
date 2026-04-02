import * as vscode from "vscode";
import {
    suggest_parents,
    serializeBigInt,
    deserializeBigInt,
    type CellArrayElement,
    type DtsNode,
} from "attach-lib";
import {
    AnalogAttachRequestEnvelope,
    AttachedDeviceState,
    CatalogCommands,
    ConfigTemplatePayload,
    DeleteDeviceRequest,
    DeviceChannelSummary,
    DeviceCommands,
    GetAttachedDevicesStateRequest,
    GetDeviceConfigurationRequest,
    GetDeviceTreeRequest,
    GetDevicesRequest,
    GetPotentialParentNodesRequest,
    GetSettingRequest,
    FormObjectElement,
    ParentNode,
    SessionCommands,
    SettingsCommands,
    SetNodeActiveRequest,
    SetParentNodeRequest,
    TreeViewCommands,
    UpdateDeviceConfigurationRequest,
    UpdateSettingRequest,
    DeviceIdentifier,
    DeviceUID,
} from "extension-protocol";
import { AttachSession } from "../AttachSession/AttachSession";
import { WebviewControllerInterface } from "./WebviewControllerInterface";
import { AnalogAttachApiHelper, ConfigValidationError } from "./AnalogAttachApiHelper";
import { AnalogAttachLogger } from "../AnalogAttachLogger";
import { WebviewSettingsHandler } from "./WebviewSettingsHandler";
import { executeRequest, createResponse, createInternalError } from "./WebviewRequestHelper";

export class PlugAndPlayWebviewController implements WebviewControllerInterface {

    private readonly settingsHandler: WebviewSettingsHandler;

    /**
     * Create a new PlugAndPlayWebviewController instance.
     */
    public static create(attachSession: AttachSession): PlugAndPlayWebviewController {
        return new PlugAndPlayWebviewController(attachSession);
    }

    private constructor(
        private readonly attachSession: AttachSession,
        private readonly analogApiHelper: AnalogAttachApiHelper = new AnalogAttachApiHelper(attachSession),
    ) {
        this.settingsHandler = new WebviewSettingsHandler(
            (panel, message) => this.postMessage(panel, message)
        );
    }

    /**
     * Send a message to the webview with BigInt values properly serialized.
     */
    private postMessage(panel: vscode.WebviewPanel, message: unknown): void {
        panel.webview.postMessage(serializeBigInt(message));
    }

    public async handle_message(message: any, panel: vscode.WebviewPanel): Promise<void> {
        // Deserialize BigInt values from the webview message
        const deserializedMessage = deserializeBigInt(message);
        AnalogAttachLogger.debug("Plug and Play received message", deserializedMessage);

        const request = this.parseRequestEnvelope(deserializedMessage);

        if (request) {
            await this.routeRequest(panel, request);
            return;
        }

        if (message?.command === 'info') {
            vscode.window.showInformationMessage('Plug and Play: ' + message.text);
            return;
        }

        AnalogAttachLogger.warn("Plug and Play received an unknown message format", message);
    }

    private parseRequestEnvelope(message: unknown): AnalogAttachRequestEnvelope<string, unknown> | undefined {
        if (typeof message !== "object" || message === null) {
            return undefined;
        }

        const candidate = message as Record<string, unknown>;

        if (candidate["type"] !== "request") {
            return undefined;
        }

        if (typeof candidate["command"] !== "string") {
            return undefined;
        }

        if (typeof candidate["id"] !== "string" || typeof candidate["timestamp"] !== "string") {
            return undefined;
        }

        const payload = candidate["payload"];

        if (payload !== undefined && (typeof payload !== "object" || payload === null)) {
            return undefined;
        }

        return {
            id: candidate["id"] as string,
            type: "request",
            timestamp: candidate["timestamp"] as string,
            command: candidate["command"] as string,
            payload: (payload ?? {}) as Record<string, never>,
        };
    }

    private async routeRequest(
        panel: vscode.WebviewPanel,
        request: AnalogAttachRequestEnvelope<string, unknown>
    ): Promise<void> {
        switch (request.command) {
            case SessionCommands.getAttachedDevicesState: {
                await this.handleGetAttachedDevicesState(panel, request as GetAttachedDevicesStateRequest);
                return;
            }
            case CatalogCommands.getDevices: {
                await this.handleGetDevices(panel, request as GetDevicesRequest);
                return;
            }
            case DeviceCommands.getPotentialParentNodes: {
                await this.handleGetPotentialParentNodes(panel, request as GetPotentialParentNodesRequest);
                return;
            }
            case DeviceCommands.setParentNode: {
                await this.handleSetParentNode(panel, request as SetParentNodeRequest);
                return;
            }
            case DeviceCommands.getConfiguration: {
                await this.handleGetConfiguration(panel, request as GetDeviceConfigurationRequest);
                return;
            }
            case DeviceCommands.updateConfiguration: {
                await this.handleUpdateConfiguration(panel, request as UpdateDeviceConfigurationRequest);
                return;
            }
            case DeviceCommands.setNodeActive: {
                await this.handleSetNodeActive(panel, request as SetNodeActiveRequest);
                return;
            }
            case DeviceCommands.delete: {
                await this.handleDeleteDevice(panel, request as DeleteDeviceRequest);
                return;
            }
            case TreeViewCommands.getDeviceTree: {
                await this.handleGetDeviceTree(panel, request as GetDeviceTreeRequest);
                return;
            }
            case SettingsCommands.getSetting: {
                this.settingsHandler.handleGetSetting(panel, request as GetSettingRequest);
                return;
            }
            case SettingsCommands.updateSetting: {
                await this.settingsHandler.handleUpdateSetting(panel, request as UpdateSettingRequest);
                return;
            }
            default: {
                AnalogAttachLogger.warn(`Unsupported request command received: ${request.command}`);
            }
        }
    }

    private async handleGetAttachedDevicesState(panel: vscode.WebviewPanel, request: GetAttachedDevicesStateRequest): Promise<void> {
        await executeRequest(
            panel,
            request,
            async () => ({ data: await this.collectAttachedDevicesState() }),
            () => ({ data: [] })
        );
    }

    private async handleGetDevices(panel: vscode.WebviewPanel, request: GetDevicesRequest): Promise<void> {
        await executeRequest(
            panel,
            request,
            () => ({ devices: this.analogApiHelper.getCatalogDevices() }),
            () => ({ devices: [] })
        );
    }

    private async handleGetPotentialParentNodes(panel: vscode.WebviewPanel, request: GetPotentialParentNodesRequest): Promise<void> {
        await executeRequest(
            panel,
            request,
            async () => ({
                potentialParentNodes: await this.collectPotentialParentNodes(request.payload.deviceId),
            }),
            async () => ({ potentialParentNodes: [] })
        );
    }

    private async handleSetParentNode(panel: vscode.WebviewPanel, request: SetParentNodeRequest): Promise<void> {
        await executeRequest(
            panel,
            request,
            async () => ({
                deviceUID: await this.analogApiHelper.setParentNode(
                    request.payload.deviceId,
                    (() => {
                        const uuid = request.payload.parentNode?.uuid;
                        if (typeof uuid !== "string" || uuid.length === 0) {
                            throw new Error("Missing parentNode.uuid in request payload");
                        }
                        return uuid;
                    })()
                ),
            }),
            () => ({ deviceUID: "" })
        );
    }

    private async handleGetConfiguration(panel: vscode.WebviewPanel, request: GetDeviceConfigurationRequest): Promise<void> {
        await executeRequest(
            panel,
            request,
            async () => ({
                deviceConfiguration: await this.analogApiHelper.buildDeviceConfiguration(request.payload.deviceUID)
            }),
            () => {
                const parentNode = this.attachSession.find_parent_node_by_uuid(request.payload.deviceUID);
                return {
                    deviceConfiguration: {
                        config: {
                            type: "DeviceConfigurationFormObject" as const,
                            config: [],
                            maxChannels: 0,
                            parentNode: parentNode
                                ? { uuid: parentNode._uuid, name: parentNode.name }
                                : { uuid: "" as DeviceUID, name: "unknown" },
                        },
                    },
                };
            }
        );
    }

    private async handleUpdateConfiguration(
        panel: vscode.WebviewPanel,
        request: UpdateDeviceConfigurationRequest
    ): Promise<void> {
        // Clear any stale field errors echoed from the UI before validation/apply
        this.analogApiHelper.stripErrorsFromConfig(request.payload.config);
        try {
            const parentNode = request.payload.config.parentNode;
            const { deviceUID, validationErrors } = await this.analogApiHelper.applyConfigurationUpdates(
                request.payload.deviceUID,
                request.payload.config,
                parentNode
            );

            // Save changes to file if session has a file URI
            if (this.attachSession.has_file_uri()) {
                await this.attachSession.save_device_tree();
            }

            const deviceConfiguration = await this.analogApiHelper.buildDeviceConfiguration(
                deviceUID,
            );
            if (validationErrors.length > 0) {
                this.analogApiHelper.applyValidationErrors(deviceConfiguration, validationErrors);
            }
            const response = createResponse(request, { deviceConfiguration, deviceUID });
            this.postMessage(panel, response);
            AnalogAttachLogger.debug("AnalogAttach -> Webview response", response);
        } catch (error) {
            if (error instanceof ConfigValidationError) {
                const errorResponse = createResponse(
                    request,
                    { deviceConfiguration: error.config, deviceUID: request.payload.deviceUID }
                );
                this.postMessage(panel, errorResponse);
                AnalogAttachLogger.debug("AnalogAttach -> Webview response", errorResponse);
                return;
            }
            AnalogAttachLogger.error(`Failed to process ${request.command} request`, error);
            let deviceConfiguration: ConfigTemplatePayload | undefined;
            try {
                deviceConfiguration = await this.analogApiHelper.buildDeviceConfiguration(request.payload.deviceUID);
            } catch {
                const parent_node = this.attachSession.find_parent_node_by_uuid(request.payload.deviceUID);
                if (parent_node === undefined) {
                    throw new Error(`Cannot find parent with UUID: ${request.payload.deviceUID}`);
                }
                deviceConfiguration = {
                    config: {
                        type: "DeviceConfigurationFormObject",
                        config: [],
                        maxChannels: 0,
                        parentNode: {
                            uuid: parent_node._uuid,
                            name: parent_node.name,
                        },
                    },
                };
            }
            const errorResponse = createResponse(
                request,
                { deviceConfiguration, deviceUID: request.payload.deviceUID },
                "error",
                createInternalError(error)
            );
            this.postMessage(panel, errorResponse);
            AnalogAttachLogger.debug("AnalogAttach -> Webview response", errorResponse);
        }
    }

    private async handleSetNodeActive(
        panel: vscode.WebviewPanel,
        request: SetNodeActiveRequest
    ): Promise<void> {
        await executeRequest(
            panel,
            request,
            async () => {
                const newActiveState = this.analogApiHelper.setNodeActive(
                    request.payload.uuid,
                    request.payload.active
                );

                if (this.attachSession.has_file_uri()) {
                    await this.attachSession.save_device_tree();
                }

                return {
                    uuid: request.payload.uuid,
                    active: newActiveState,
                };
            },
            () => ({
                uuid: request.payload.uuid,
                active: request.payload.active,
            })
        );
    }

    private async handleDeleteDevice(panel: vscode.WebviewPanel, request: DeleteDeviceRequest) {
        await executeRequest(
            panel,
            request,
            async () => ({
                deviceUID: await this.attachSession.delete_device(request.payload.deviceUID)
            }),
            () => ({ deviceUID: request.payload.deviceUID })
        );
    }

    private async handleGetDeviceTree(panel: vscode.WebviewPanel, request: GetDeviceTreeRequest): Promise<void> {
        await executeRequest(
            panel,
            request,
            () => ({
                deviceTree: this.analogApiHelper.buildDeviceTreeFormElement(),
                isReadOnly: false, // TODO: Implement read-only detection
                isDtso: this.attachSession.is_dtso_session(),
            }),
            () => ({
                deviceTree: {
                    type: "FormObject",
                    key: "root",
                    required: false,
                    config: [],
                } as FormObjectElement,
                isReadOnly: true,
                isDtso: false,
            })
        );
    }

    private parseArrayElement(element: CellArrayElement): unknown {
        const { item } = element;

        switch (item.kind) {
            case "number":
            case "u64": {
                return Number(item.value);
            }
            case "ref": {
                return item.ref.kind === "label" ? item.ref.name : item.ref.path;
            }
            case "expression": {
                return item.value;
            }
            default: {
                return undefined;
            }
        }
    }

    private async collectAttachedDevicesState(): Promise<AttachedDeviceState[]> {
        const document = this.attachSession.get_device_tree();
        const devices: AttachedDeviceState[] = [];
        const bindingPatternCache = new Map<string, boolean>();

        const visit = async (node: DtsNode): Promise<void> => {
            for (const child of node.children) {
                if (this.isUserManagedDeviceNode(child)) {
                    const hasChannels = await this.deviceHasChannelPattern(child, bindingPatternCache);
                    devices.push(this.buildDeviceState(child, hasChannels));
                }
                await visit(child);
            }
        };

        await visit(document.root);
        return devices;
    }

    private async deviceHasChannelPattern(node: DtsNode, cache: Map<string, boolean>): Promise<boolean> {
        const compatible = this.extractFirstCompatibleValue(node);
        if (!compatible) {
            return false;
        }

        if (cache.has(compatible)) {
            return cache.get(compatible) ?? false;
        }

        try {
            const bindings_and_patterns = await this.attachSession.get_binding_for_compatible(compatible, "");
            const hasPattern = Boolean(bindings_and_patterns?.patterns.length);
            cache.set(compatible, hasPattern);
            return hasPattern;
        } catch (error) {
            AnalogAttachLogger.warn(`Failed to resolve binding for ${compatible}`, error);
            cache.set(compatible, false);
            return false;
        }
    }

    private async collectPotentialParentNodes(_deviceId: DeviceIdentifier): Promise<ParentNode[]> {
        const document = this.attachSession.get_device_tree();
        const nodes: ParentNode[] = [];

        const binding = await this.attachSession.get_binding_for_compatible(_deviceId, "{}");

        if (binding === undefined) {
            AnalogAttachLogger.error("Could not find potential parents for:", _deviceId);
            return [];
        }

        const suggestions = suggest_parents(
            document,
            binding.parsed_binding
        );

        for (const suggestion of suggestions) {

            // FIXME: overhead
            const name = suggestion.label ?? suggestion.path.at(-1) ?? "/";
            const path = `/${this.sanitizePath(suggestion.path).join("/")}`;
            const uuid = this.attachSession.path_to_uuid(path);

            if (uuid === undefined) {
                console.warn(`Cannot find UUID for path ${path}`);
                continue;
            }

            nodes.push({
                uuid,
                name,
            });
        }

        return nodes.sort((left, right) => left.name.localeCompare(right.name));
    }

    private isUserManagedDeviceNode(node: DtsNode): boolean {
        if (node.created_by_user !== true) {
            return false;
        }

        return this.isDeviceNode(node);
    }

    private isDeviceNode(node: DtsNode): boolean {
        return node.properties.some((property) => property.name === "compatible" && property.value !== undefined);
    }

    private buildDeviceState(node: DtsNode, hasChannels: boolean): AttachedDeviceState {
        const compatible = this.extractFirstCompatibleValue(node) ?? node.name;
        const channels = this.buildChannelSummaries(node, hasChannels);
        const alias = this.getNodeAlias(node);
        const isActive = this.isNodeActive(node);
        const parentNode = this.getParentNodeFor(node);
        const deviceUID = node._uuid;
        const name = this.buildDeviceDisplayName(node, compatible);

        return {
            type: "AttachedDeviceState",
            compatible,
            deviceUID,
            name,
            alias: alias.length > 0 ? alias : undefined,
            active: isActive,
            hasErrors: false,
            hasChannels,
            parentNode,
            maxChannels: channels.length,
            channels,
        };
    }

    private extractFirstCompatibleValue(node: DtsNode): string | undefined {
        const property = node.properties.find((property) => property.name === "compatible");

        if (!property?.value) {
            return undefined;
        }

        for (const component of property.value.components) {
            if (component.kind === "string") {
                return component.value;
            }
            if (component.kind === "array") {
                for (const element of component.elements) {
                    const parsed = this.parseArrayElement(element);
                    if (typeof parsed === "string") {
                        return parsed;
                    }
                }
            }
        }

        return undefined;
    }

    private buildDeviceDisplayName(node: DtsNode, deviceId: string): string {
        if (node.name && node.name !== "/") {
            return node.name;
        }

        if (deviceId.includes("adi,")) {
            const [, suffix] = deviceId.split(",");
            if (suffix) {
                return suffix.toUpperCase();
            }
        }

        return deviceId;
    }

    private getNodeAlias(node: DtsNode): string {
        return node.labels?.[0] ?? "";
    }

    private isNodeActive(node: DtsNode): boolean {
        const status = this.extractStringProperty(node, "status");
        if (!status) {
            return true;
        }

        const normalized = status.toLowerCase();
        return normalized !== "disabled";
    }

    private extractStringProperty(node: DtsNode, propertyName: string): string | undefined {
        const property = node.properties.find((property) => property.name === propertyName);

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

    private getParentNodeFor(node: DtsNode): ParentNode {
        const parent = this.attachSession.find_parent_node_by_uuid(node._uuid);

        if (parent === undefined) {
            throw new Error(`Cannot find the parent for ${node.name}`);
        }

        return {
            uuid: parent._uuid,
            name: parent.name,
        };
    }

    private sanitizePath(path: string[]): string[] {
        return path.filter((segment) => segment && segment !== "/");
    }

    private buildChannelSummaries(node: DtsNode, hasChannelPatterns: boolean): DeviceChannelSummary[] {
        if (!hasChannelPatterns) {
            return [];
        }
        return node.children
            .filter((child) => !this.isDeviceNode(child))
            .map((child) => ({
                name: this.attachSession.buildNodeSegment(child),
                alias: this.getNodeAlias(child),
                hasErrors: false,
            }));
    }

    public get_html_for_webview(
        webview: vscode.Webview,
        nonce: string,
        local_resources: Map<string, vscode.Uri>
    ): string {

        const script_sources = local_resources.get("script");
        const media_source = local_resources.get("media");
        const codicons_source = local_resources.get("codicons");

        if (!script_sources || !media_source || !codicons_source) {
            AnalogAttachLogger.error("Missing authorized source for plug and play webview!");
            return ``;
        }

        const script_uri = webview.asWebviewUri(vscode.Uri.joinPath(script_sources, 'webview.js'));
        const styles_uri = webview.asWebviewUri(vscode.Uri.joinPath(script_sources, 'webview.css'));
        const custom_styles_uri = webview.asWebviewUri(vscode.Uri.joinPath(media_source, 'custom.css'));
        const codiconsUri = webview.asWebviewUri(vscode.Uri.joinPath(codicons_source, 'codicon.css'));

        return /*html*/`
          <!DOCTYPE html>
          <html lang="en">
          <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">

              <meta
                  http-equiv="Content-Security-Policy"
                  content="default-src 'none';
                  img-src ${webview.cspSource} https: data:;
                  style-src ${webview.cspSource} 'unsafe-inline';
                  font-src ${webview.cspSource};
                  script-src 'nonce-${nonce}';"
              />

              <link href="${styles_uri}" rel="stylesheet">
              <link href="${custom_styles_uri}" rel="stylesheet">
              <link id="vscode-codicon-stylesheet" href="${codiconsUri}" rel="stylesheet" />

              <title>Analog Attach - Plug and Play</title>

          </head>
          <body>
              <div id="root"></div>
              <script type="module" nonce="${nonce}" src="${script_uri}"></script>
          </body>
          </html>
        `;
    }

    public dispose(): void {
        // No cleanup needed for the simple plug and play controller
    }
}
