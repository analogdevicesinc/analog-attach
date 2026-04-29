import * as vscode from "vscode";
import { WebviewPanel, Webview } from "vscode";
import { serializeBigInt, deserializeBigInt } from "attach-lib";
import { WebviewControllerInterface } from "../WebviewControllers/WebviewControllerInterface";
import {
    AnalogAttachApiRequest,
    AnalogAttachError,
    AnalogAttachResponseEnvelope,
    AnalogAttachResponseStatus,
    TreeViewCommands,
    CatalogCommands,
    DeviceCommands,
    type GetDevicesRequest,
    type GetDevicesResponsePayload,
    type SetParentNodeRequest,
    type SetParentNodeResponsePayload,
    type GetDeviceConfigurationRequest,
    type GetDeviceConfigurationResponsePayload,
    type UpdateDeviceConfigurationRequest,
    type UpdateDeviceConfigurationResponsePayload,
    type DeleteDeviceRequest,
    type DeleteDeviceResponsePayload,
    type DeviceUID,
    type ConfigTemplatePayload,
    type GetDeviceTreeRequest,
    type GetDeviceTreeResponsePayload,
    type FormObjectElement,
    type SetNodeActiveRequest,
    type SetNodeActiveResponsePayload,
    SettingsCommands,
    type GetSettingRequest,
    type UpdateSettingRequest,
} from "extension-protocol";

import { AttachSession } from "../AttachSession/AttachSession";
import { AnalogAttachApiHelper, ConfigValidationError } from "./AnalogAttachApiHelper";
import { AnalogAttachLogger } from "../AnalogAttachLogger";
import { WebviewSettingsHandler } from "./WebviewSettingsHandler";

export class TreeConfigController implements WebviewControllerInterface {

    private readonly attach_session: AttachSession;
    private readonly apiHelper: AnalogAttachApiHelper;
    private readonly settingsHandler: WebviewSettingsHandler;

    // FIXME: Remove this, it is a small safety check so the app does not crash
    // in case it is sent a different message (legacy api)
    private isAnalogAttachRequest(message: unknown): message is AnalogAttachApiRequest {
        if (typeof message !== "object" || message === null) {
            return false;
        }

        const candidate = message as Record<string, unknown>;

        return candidate["type"] === "request"
            && typeof candidate["command"] === "string"
            && typeof candidate["id"] === "string"
            && typeof candidate["timestamp"] === "string";
    }

    /**
     * Create a new TreeConfigController instance for a specific AttachSession.
     */
    public static createForSession(attach_session: AttachSession): TreeConfigController {
        return new TreeConfigController(attach_session);
    }

    private constructor(
        attach_session: AttachSession
    ) {
        this.attach_session = attach_session;
        this.apiHelper = new AnalogAttachApiHelper(attach_session);
        this.settingsHandler = new WebviewSettingsHandler(
            (panel, message) => this.postMessage(panel, message)
        );
    }

    /**
     * Send a message to the webview with BigInt values properly serialized.
     */
    private postMessage(panel: WebviewPanel, message: unknown): void {
        panel.webview.postMessage(serializeBigInt(message));
    }

    /**
     * Push the latest device tree to the webview without waiting for a frontend request.
     */
    public pushDeviceTreeUpdate(panel: WebviewPanel): void {
        const deviceTree = this.apiHelper.buildDeviceTreeFormElement();
        const isDtso = this.attach_session.is_dtso_session();

        const updateMessage: AnalogAttachResponseEnvelope<typeof TreeViewCommands.getDeviceTree, GetDeviceTreeResponsePayload> = {
            id: this.generateMessageId(),
            type: "response",
            timestamp: new Date().toISOString(),
            command: TreeViewCommands.getDeviceTree,
            status: "success",
            payload: {
                deviceTree,
                isReadOnly: false,
                isDtso,
            },
        };

        this.postMessage(panel, updateMessage);
    }

    public async handle_message(message: any, panel: WebviewPanel): Promise<void> {
        // Deserialize BigInt values from the webview message
        const deserializedMessage = deserializeBigInt(message);

        if (this.isAnalogAttachRequest(deserializedMessage)) {
            AnalogAttachLogger.debug("TreeConfigController received request", { command: message.command, id: message.id });
            await this.handleAnalogAttachRequest(deserializedMessage as AnalogAttachApiRequest, panel);
            return;
        }

        AnalogAttachLogger.warn("TreeConfigController received unsupported message", message);
    }

    public get_html_for_webview(
        webview: Webview,
        nonce: string,
        local_resources: Map<string, vscode.Uri>
    ): string {

        const script_sources = local_resources.get("script");
        const media_source = local_resources.get("media");
        const codicons_source = local_resources.get("codicons");

        if (!script_sources || !media_source || !codicons_source) {
            AnalogAttachLogger.error("Missing authorized source for webview!");
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
                          img-src ${webview.cspSource} https:;
                          style-src ${webview.cspSource} 'unsafe-inline';
                          font-src ${webview.cspSource};
                          script-src 'nonce-${nonce}';"
                      />

                      <link href="${styles_uri}" rel="stylesheet">
                      <link href="${custom_styles_uri}" rel="stylesheet">
                      <link id="vscode-codicon-stylesheet" href="${codiconsUri}" rel="stylesheet" />

                      <title>Analog Attach</title>

                  </head>
                  <body>
                      <div id="root"></div>
                      <script type="module" nonce="${nonce}" src="${script_uri}"></script>
                  </body>
                  </html>
        `;

    }

    public dispose(): void {
        // No singleton cleanup needed
    }

    private async handleAnalogAttachRequest(request: AnalogAttachApiRequest, panel: WebviewPanel): Promise<void> {
        switch (request.command) {
            case CatalogCommands.getDevices: {
                const response = this.createResponse(
                    request as GetDevicesRequest,
                    { devices: this.apiHelper.getCatalogDevices() } as GetDevicesResponsePayload
                );
                this.postMessage(panel, response);
                return;
            }
            case DeviceCommands.setParentNode: {
                try {
                    const setRequest = request as SetParentNodeRequest;
                    const parentUUID = setRequest.payload.parentNode?.uuid;
                    if (parentUUID === undefined) {
                        throw new Error("Missing parentNode.uuid in request payload");
                    }
                    const deviceUID = await this.apiHelper.setParentNode(
                        setRequest.payload.deviceId,
                        parentUUID
                    );

                    // Persist newly created node if session is file-backed
                    if (this.attach_session.has_file_uri()) {
                        await this.attach_session.save_device_tree();
                    }

                    const response = this.createResponse(setRequest, { deviceUID } as SetParentNodeResponsePayload);
                    this.postMessage(panel, response);
                } catch (error) {
                    const response = this.createResponse(
                        request as SetParentNodeRequest,
                        { deviceUID: "" },
                        "error",
                        { code: "SET_PARENT_ERROR", message: String(error) }
                    );
                    this.postMessage(panel, response);
                }
                return;
            }
            case DeviceCommands.getConfiguration: {
                try {
                    const getRequest = request as GetDeviceConfigurationRequest;
                    const deviceConfiguration = await this.apiHelper.buildDeviceConfiguration(getRequest.payload.deviceUID);
                    const response = this.createResponse(
                        getRequest,
                        { deviceConfiguration } as GetDeviceConfigurationResponsePayload
                    );
                    this.postMessage(panel, response);
                } catch (error) {
                    // FIXME: Somehow i should not return the config as well
                    const response = this.createResponse(
                        request as GetDeviceConfigurationRequest,
                        {
                            deviceConfiguration: {
                                config: {
                                    type: "DeviceConfigurationFormObject",
                                    config: [],
                                    maxChannels: 0,
                                    parentNode: {
                                        uuid: crypto.randomUUID(),
                                        name: "",
                                    },
                                },
                            } as ConfigTemplatePayload,
                        } as GetDeviceConfigurationResponsePayload,
                        "error",
                        { code: "GET_CONFIG_ERROR", message: String(error) }
                    );
                    AnalogAttachLogger.error(`Failed to process ${request.command} request`, error);
                    this.postMessage(panel, response);
                }
                return;
            }
            case DeviceCommands.updateConfiguration: {
                try {
                    const updateRequest = request as UpdateDeviceConfigurationRequest;
                    const parentNode = updateRequest.payload.config.parentNode;
                    // Remove any stale field errors echoed from the UI before validation/update
                    this.apiHelper.stripErrorsFromConfig(updateRequest.payload.config);
                    const { deviceUID, validationErrors } = await this.apiHelper.applyConfigurationUpdates(
                        updateRequest.payload.deviceUID,
                        updateRequest.payload.config,
                        parentNode
                    );
                    const data = this.attach_session.configPayloadToAttachLibJson(request.payload.config);
                    const deviceConfiguration = await this.apiHelper.buildDeviceConfiguration(
                        deviceUID,
                        JSON.stringify(serializeBigInt(data)),
                        updateRequest.payload.config.config
                    );
                    if (validationErrors.length > 0) {
                        this.apiHelper.applyValidationErrors(deviceConfiguration, validationErrors);
                    }

                    if (this.attach_session.has_file_uri()) {
                        await this.attach_session.save_device_tree();
                    }

                    const response = this.createResponse(
                        updateRequest,
                        { deviceConfiguration, deviceUID } as UpdateDeviceConfigurationResponsePayload
                    );
                    AnalogAttachLogger.debug("AnalogAttach -> Webview response", response);
                    this.postMessage(panel, response);
                } catch (error) {
                    if (error instanceof ConfigValidationError) {
                        const response = this.createResponse(
                            request,
                            {
                                deviceConfiguration: error.config,
                                deviceUID: (request as UpdateDeviceConfigurationRequest).payload.deviceUID
                            }
                        );
                        AnalogAttachLogger.debug("AnalogAttach -> Webview response (validation error)", response);
                        this.postMessage(panel, response);
                        return;
                    }
                    let deviceConfiguration: ConfigTemplatePayload | undefined;
                    try {
                        deviceConfiguration = await this.apiHelper.buildDeviceConfiguration(request.payload.deviceUID);
                    } catch {
                        deviceConfiguration = {
                            config: {
                                type: "DeviceConfigurationFormObject",
                                config: [],
                                maxChannels: 0,
                                parentNode: {
                                    uuid: crypto.randomUUID(),
                                    name: "",
                                },
                            },
                        } as ConfigTemplatePayload;
                    }
                    const response = this.createResponse(
                        request as UpdateDeviceConfigurationRequest,
                        { deviceUID: (request as UpdateDeviceConfigurationRequest).payload.deviceUID },
                        "error",
                        { code: "UPDATE_CONFIG_ERROR", message: String(error) }
                    );
                    AnalogAttachLogger.error(`Failed to process ${request.command} request`, error);
                    AnalogAttachLogger.error("AnalogAttach -> Webview response (error path)", response);
                    panel.webview.postMessage(response);
                }
                return;
            }
            case DeviceCommands.delete: {
                try {
                    const deleteRequest = request as DeleteDeviceRequest;

                    const deviceUID = await this.apiHelper.deleteDevice(deleteRequest.payload.deviceUID);

                    if (this.attach_session.has_file_uri()) {
                        await this.attach_session.save_device_tree();
                    }

                    const response = this.createResponse(deleteRequest, { deviceUID } as DeleteDeviceResponsePayload);
                    this.postMessage(panel, response);
                } catch (error) {
                    const response = this.createResponse(
                        request as DeleteDeviceRequest,
                        { deviceUID: "" as DeviceUID } as DeleteDeviceResponsePayload,
                        "error",
                        { code: "DELETE_DEVICE_ERROR", message: String(error) }
                    );
                    this.postMessage(panel, response);
                }
                return;
            }
            // Idk if we need this in tree view as well, but i'd rather not have
            // discrepancies between controllers
            case DeviceCommands.setNodeActive: {
                try {
                    const setNodeActiveRequest = request;
                    AnalogAttachLogger.debug("TreeConfigController/setNodeActive:", setNodeActiveRequest);
                    const newActiveState = this.apiHelper.setNodeActive(
                        setNodeActiveRequest.payload.uuid,
                        setNodeActiveRequest.payload.active
                    );

                    // Save changes to file if session has a file URI
                    if (this.attach_session.has_file_uri()) {
                        await this.attach_session.save_device_tree();
                    }

                    const response = this.createResponse(setNodeActiveRequest, {
                        uuid: setNodeActiveRequest.payload.uuid,
                        active: newActiveState,
                    } as SetNodeActiveResponsePayload);
                    this.postMessage(panel, response);
                } catch (error) {
                    const response = this.createResponse(
                        request as SetNodeActiveRequest,
                        {
                            uuid: (request as SetNodeActiveRequest).payload.uuid,
                            active: (request as SetNodeActiveRequest).payload.active,
                        } as SetNodeActiveResponsePayload,
                        "error",
                        { code: "SET_NODE_ACTIVE_ERROR", message: String(error) }
                    );
                    AnalogAttachLogger.error(`Failed to process ${request.command} request`, error);
                    AnalogAttachLogger.error("AnalogAttach -> Webview response (setNodeActive error)", response);
                    this.postMessage(panel, response);
                }
                return;
            }
            case TreeViewCommands.getDeviceTree: {
                this.handleGetDeviceTree(panel, request as GetDeviceTreeRequest);
                return;
            }
            case DeviceCommands.setNodeActive: {
                this.handleSetNodeActive(panel, request as SetNodeActiveRequest);
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
                AnalogAttachLogger.warn(`TreeConfigController received unsupported Analog Attach command: ${request.command}`);
            }
        }
    }

    private createResponse<TCommand extends string, TPayload>(
        request: AnalogAttachApiRequest & { command: TCommand },
        payload: TPayload,
        status: AnalogAttachResponseStatus = "success",
        error?: AnalogAttachError
    ): AnalogAttachResponseEnvelope<TCommand, TPayload> {
        return {
            id: request.id ?? this.generateMessageId(),
            type: "response",
            timestamp: new Date().toISOString(),
            command: request.command,
            status,
            error,
            payload,
        };
    }

    private generateMessageId(): string {
        return Math.random().toString(36).slice(2, 11);
    }

    private handleGetDeviceTree(panel: WebviewPanel, request: GetDeviceTreeRequest): void {
        try {
            const deviceTree = this.apiHelper.buildDeviceTreeFormElement();
            const isReadOnly = false; // TODO: Add read-only detection if required
            const isDtso = this.attach_session.is_dtso_session();

            const response = this.createResponse(request, {
                deviceTree,
                isReadOnly,
                isDtso,
            } as GetDeviceTreeResponsePayload);

            this.postMessage(panel, response);
        } catch (error) {
            AnalogAttachLogger.error(`Failed to process ${request.command} request`, error);
            const errorResponse = this.createResponse(
                request,
                {
                    deviceTree: {
                        type: "FormObject",
                        key: "root",
                        required: false,
                        config: [],
                    } as FormObjectElement,
                    isReadOnly: true,
                    isDtso: false,
                },
                "error",
                { code: "TREE_BUILD_ERROR", message: "Failed to build device tree", details: error instanceof Error ? error.message : String(error) }
            );
            this.postMessage(panel, errorResponse);
        }
    }
    
    private async handleSetNodeActive(
        panel: vscode.WebviewPanel,
        request: SetNodeActiveRequest
    ): Promise<void> {
        try {
            const newActiveState = this.apiHelper.setNodeActive(
                request.payload.uuid,
                request.payload.active
            );

            // Save changes to file if session has a file URI
            if (this.attach_session.has_file_uri()) {
                await this.attach_session.save_device_tree();
            }

            const response = this.createResponse(request, {
                uid: request.payload.uuid,
                active: newActiveState,
            });
            AnalogAttachLogger.debug("AnalogAttach -> Webview response", response);
            this.postMessage(panel, response);
        } catch (error) {
            AnalogAttachLogger.error(`Failed to process ${request.command} request`, error);
            const errorResponse = this.createResponse(
                request,
                {
                    uid: request.payload.uuid,
                    active: request.payload.active,
                },
                "error",
                {
                    code: "INTERNAL_ERROR",
                    message: "Failed to set node active",
                    details: error instanceof Error ? error.message : String(error)
                }
            );
            AnalogAttachLogger.debug("AnalogAttach -> Webview response (setNodeActive error)", errorResponse);
            this.postMessage(panel, errorResponse);
        }
    }
}
