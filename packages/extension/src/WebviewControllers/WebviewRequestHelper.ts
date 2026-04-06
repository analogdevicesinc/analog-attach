import * as vscode from "vscode";
import { serializeBigInt } from "attach-lib";
import {
    AnalogAttachError,
    AnalogAttachResponseEnvelope,
    AnalogAttachResponseStatus,
    InternalErrorPayload,
} from "extension-protocol";
import { AnalogAttachLogger } from "../AnalogAttachLogger";

interface RequestWithCommand {
    id?: string;
    command: string;
}

export function generateMessageId(): string {
    return Math.random().toString(36).slice(2, 11);
}

export function createInternalError(error: unknown): AnalogAttachError {
    return {
        code: "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : String(error),
    };
}

/**
 * Create an InternalErrorPayload for fatal errors.
 * Use this instead of returning partial/broken response payloads.
 */
export function createInternalErrorPayload(): InternalErrorPayload {
    return { type: "InternalError" };
}

export function createResponse<TCommand extends string, TPayload>(
    request: RequestWithCommand & { command: TCommand },
    payload: TPayload,
    status: AnalogAttachResponseStatus = "success",
    error?: AnalogAttachError
): AnalogAttachResponseEnvelope<TCommand, TPayload> {
    return {
        id: request.id ?? generateMessageId(),
        type: "response",
        timestamp: new Date().toISOString(),
        command: request.command,
        status,
        error,
        payload,
    };
}

/**
 * Execute a request and send a response to the webview.
 *
 * On success, calls `payloadFactory` and sends the result.
 * On error, sends `InternalErrorPayload` by default, or calls `errorPayloadFactory` if provided.
 */
export async function executeRequest<TCommand extends string, TPayload>(
    panel: vscode.WebviewPanel,
    request: RequestWithCommand & { command: TCommand },
    payloadFactory: () => Promise<TPayload> | TPayload,
    errorPayloadFactory?: () => Promise<TPayload | InternalErrorPayload> | (TPayload | InternalErrorPayload)
): Promise<void> {
    try {
        const payload = await payloadFactory();
        const response = createResponse(request, payload);
        AnalogAttachLogger.debug("AnalogAttach -> Webview response", response);
        panel.webview.postMessage(serializeBigInt(response));
    } catch (error) {
        AnalogAttachLogger.error(`Failed to process ${request.command} request`, error);

        // Display error with vscode message
        vscode.window.showErrorMessage("Analog Attach: An internal error has occurred. Please check the integrity of the file.");

        const payload = errorPayloadFactory
            ? await errorPayloadFactory()
            : createInternalErrorPayload();
        const errorResponse = createResponse(
            request,
            payload,
            "error",
            createInternalError(error)
        );
        AnalogAttachLogger.debug("AnalogAttach -> Webview response", errorResponse);
        panel.webview.postMessage(serializeBigInt(errorResponse));
    }
}
