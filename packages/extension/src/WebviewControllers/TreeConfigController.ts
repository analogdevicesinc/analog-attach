import * as vscode from "vscode";
import { WebviewPanel, Webview } from "vscode";
import { serializeBigInt, deserializeBigInt } from "attach-lib";
import { WebviewControllerInterface } from "../WebviewControllers/WebviewControllerInterface";
import {
    AnalogAttachApiRequest,
    AnalogAttachResponseEnvelope,
    TreeViewCommands,
    CatalogCommands,
    DeviceCommands,
    type GetDevicesRequest,
    type SetParentNodeRequest,
    type GetDeviceConfigurationRequest,
    type UpdateDeviceConfigurationRequest,
    type DeleteDeviceRequest,
    type DeviceUID,
    type ConfigTemplatePayload,
    type GetDeviceTreeRequest,
    type GetDeviceTreeResponsePayload,
    type FormObjectElement,
    type SetNodeActiveRequest,
    SettingsCommands,
    type GetSettingRequest,
    type UpdateSettingRequest,
} from "extension-protocol";

import { AttachSession } from "../AttachSession/AttachSession";
import { AnalogAttachApiHelper, ConfigValidationError } from "./AnalogAttachApiHelper";
import { AnalogAttachLogger } from "../AnalogAttachLogger";
import { WebviewSettingsHandler } from "./WebviewSettingsHandler";
import { executeRequest, createResponse, createInternalError, generateMessageId } from "./WebviewRequestHelper";

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
            id: generateMessageId(),
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
                await executeRequest(
                    panel,
                    request as GetDevicesRequest,
                    () => ({ devices: this.apiHelper.getCatalogDevices() }),
                    () => ({ devices: [] })
                );
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
            case DeviceCommands.delete: {
                await this.handleDeleteDevice(panel, request as DeleteDeviceRequest);
                return;
            }
            case DeviceCommands.setNodeActive: {
                await this.handleSetNodeActive(panel, request as SetNodeActiveRequest);
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
                AnalogAttachLogger.warn(`TreeConfigController received unsupported Analog Attach command: ${request.command}`);
            }
        }
    }

    private async handleSetParentNode(panel: WebviewPanel, request: SetParentNodeRequest): Promise<void> {
        await executeRequest(
            panel,
            request,
            async () => {
                const parentUUID = request.payload.parentNode?.uuid;
                if (parentUUID === undefined) {
                    throw new Error("Missing parentNode.uuid in request payload");
                }
                const deviceUID = await this.apiHelper.setParentNode(
                    request.payload.deviceId,
                    parentUUID
                );

                if (this.attach_session.has_file_uri()) {
                    await this.attach_session.save_device_tree();
                }

                return { deviceUID };
            },
            () => ({ deviceUID: "" as DeviceUID })
        );
    }

    private async handleGetConfiguration(panel: WebviewPanel, request: GetDeviceConfigurationRequest): Promise<void> {
        await executeRequest(
            panel,
            request,
            async () => ({
                deviceConfiguration: await this.apiHelper.buildDeviceConfiguration(request.payload.deviceUID)
            }),
            () => ({
                deviceConfiguration: {
                    config: {
                        type: "DeviceConfigurationFormObject" as const,
                        config: [],
                        maxChannels: 0,
                        parentNode: {
                            uuid: "" as DeviceUID,
                            name: "unknown",
                        },
                    },
                },
            })
        );
    }

    private async handleDeleteDevice(panel: WebviewPanel, request: DeleteDeviceRequest): Promise<void> {
        await executeRequest(
            panel,
            request,
            async () => {
                const deviceUID = await this.apiHelper.deleteDevice(request.payload.deviceUID);

                if (this.attach_session.has_file_uri()) {
                    await this.attach_session.save_device_tree();
                }

                return { deviceUID };
            },
            () => ({ deviceUID: "" as DeviceUID })
        );
    }

    private async handleUpdateConfiguration(
        panel: WebviewPanel,
        request: UpdateDeviceConfigurationRequest
    ): Promise<void> {
        this.apiHelper.stripErrorsFromConfig(request.payload.config);
        try {
            const parentNode = request.payload.config.parentNode;
            const { deviceUID, validationErrors } = await this.apiHelper.applyConfigurationUpdates(
                request.payload.deviceUID,
                request.payload.config,
                parentNode
            );

            if (this.attach_session.has_file_uri()) {
                await this.attach_session.save_device_tree();
            }

            const deviceConfiguration = await this.apiHelper.buildDeviceConfiguration(deviceUID);
            if (validationErrors.length > 0) {
                this.apiHelper.applyValidationErrors(deviceConfiguration, validationErrors);
            }

            const response = createResponse(request, { deviceConfiguration, deviceUID });
            AnalogAttachLogger.debug("AnalogAttach -> Webview response", response);
            this.postMessage(panel, response);
        } catch (error) {
            if (error instanceof ConfigValidationError) {
                const response = createResponse(request, {
                    deviceConfiguration: error.config,
                    deviceUID: request.payload.deviceUID
                });
                AnalogAttachLogger.debug("AnalogAttach -> Webview response (validation error)", response);
                this.postMessage(panel, response);
                return;
            }

            AnalogAttachLogger.error(`Failed to process ${request.command} request`, error);
            let deviceConfiguration: ConfigTemplatePayload;
            try {
                deviceConfiguration = await this.apiHelper.buildDeviceConfiguration(request.payload.deviceUID);
            } catch {
                deviceConfiguration = {
                    config: {
                        type: "DeviceConfigurationFormObject",
                        config: [],
                        maxChannels: 0,
                        parentNode: { uuid: "" as DeviceUID, name: "unknown" },
                    },
                };
            }
            const errorResponse = createResponse(
                request,
                { deviceConfiguration, deviceUID: request.payload.deviceUID },
                "error",
                createInternalError(error)
            );
            AnalogAttachLogger.debug("AnalogAttach -> Webview response (error)", errorResponse);
            this.postMessage(panel, errorResponse);
        }
    }

    private async handleGetDeviceTree(panel: WebviewPanel, request: GetDeviceTreeRequest): Promise<void> {
        await executeRequest(
            panel,
            request,
            () => ({
                deviceTree: this.apiHelper.buildDeviceTreeFormElement(),
                isReadOnly: false,
                isDtso: this.attach_session.is_dtso_session(),
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

    private async handleSetNodeActive(
        panel: WebviewPanel,
        request: SetNodeActiveRequest
    ): Promise<void> {
        await executeRequest(
            panel,
            request,
            async () => {
                const newActiveState = this.apiHelper.setNodeActive(
                    request.payload.uuid,
                    request.payload.active
                );

                if (this.attach_session.has_file_uri()) {
                    await this.attach_session.save_device_tree();
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
}
