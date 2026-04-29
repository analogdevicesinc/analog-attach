import * as vscode from "vscode";
import type { WebviewPanel } from "vscode";
import type {
    AnalogAttachError,
    AnalogAttachResponseEnvelope,
    AnalogAttachResponseStatus,
    GetSettingRequest,
    GetSettingResponsePayload,
    UpdateSettingRequest,
    UpdateSettingResponsePayload,
} from "extension-protocol";
import { AnalogAttachLogger } from "../AnalogAttachLogger";

/** Settings keys that webviews are allowed to read/write. */
const ALLOWED_WEBVIEW_SETTINGS = new Set(["skipDeleteConfirmation"]);

/**
 * Shared helper for handling settings get/update requests from webviews.
 * Both PlugAndPlayWebviewController and TreeConfigController delegate to this.
 */
export class WebviewSettingsHandler {
    constructor(
        private readonly postMessage: (panel: WebviewPanel, message: unknown) => void
    ) {}

    private createResponse<TCommand extends string, TPayload>(
        request: { id: string; command: TCommand },
        payload: TPayload,
        status: AnalogAttachResponseStatus = "success",
        error?: AnalogAttachError
    ): AnalogAttachResponseEnvelope<TCommand, TPayload> {
        return {
            id: request.id,
            type: "response",
            timestamp: new Date().toISOString(),
            command: request.command,
            status,
            error,
            payload,
        };
    }

    public handleGetSetting(panel: WebviewPanel, request: GetSettingRequest): void {
        if (!ALLOWED_WEBVIEW_SETTINGS.has(request.payload.key)) {
            AnalogAttachLogger.warn(`Webview attempted to read disallowed setting: ${request.payload.key}`);
            const response = this.createResponse(
                request,
                { key: request.payload.key, value: undefined } as GetSettingResponsePayload,
                "error",
                { code: "SETTING_NOT_ALLOWED", message: `Setting '${request.payload.key}' is not accessible from the webview` }
            );
            this.postMessage(panel, response);
            return;
        }
        try {
            const config = vscode.workspace.getConfiguration("analog-attach");
            const value = config.get(request.payload.key);
            const response = this.createResponse(request, { key: request.payload.key, value } as GetSettingResponsePayload);
            this.postMessage(panel, response);
        } catch (error) {
            const response = this.createResponse(
                request,
                { key: request.payload.key, value: undefined } as GetSettingResponsePayload,
                "error",
                { code: "GET_SETTING_ERROR", message: String(error) }
            );
            this.postMessage(panel, response);
        }
    }

    public async handleUpdateSetting(panel: WebviewPanel, request: UpdateSettingRequest): Promise<void> {
        if (!ALLOWED_WEBVIEW_SETTINGS.has(request.payload.key)) {
            AnalogAttachLogger.warn(`Webview attempted to write disallowed setting: ${request.payload.key}`);
            const response = this.createResponse(
                request,
                { key: request.payload.key, value: request.payload.value } as UpdateSettingResponsePayload,
                "error",
                { code: "SETTING_NOT_ALLOWED", message: `Setting '${request.payload.key}' is not writable from the webview` }
            );
            this.postMessage(panel, response);
            return;
        }
        try {
            const config = vscode.workspace.getConfiguration("analog-attach");
            await config.update(request.payload.key, request.payload.value, vscode.ConfigurationTarget.Global);
            const response = this.createResponse(
                request,
                { key: request.payload.key, value: request.payload.value } as UpdateSettingResponsePayload
            );
            this.postMessage(panel, response);
        } catch (error) {
            const response = this.createResponse(
                request,
                { key: request.payload.key, value: request.payload.value } as UpdateSettingResponsePayload,
                "error",
                { code: "UPDATE_SETTING_ERROR", message: String(error) }
            );
            this.postMessage(panel, response);
        }
    }
}
