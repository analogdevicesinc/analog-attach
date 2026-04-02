import * as vscode from "vscode";
import { serializeBigInt } from "attach-lib";
import {
    AnalogAttachError,
    AnalogAttachResponseEnvelope,
    AnalogAttachResponseStatus,
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

export async function executeRequest<TCommand extends string, TPayload>(
    panel: vscode.WebviewPanel,
    request: RequestWithCommand & { command: TCommand },
    payloadFactory: () => Promise<TPayload> | TPayload,
    emptyPayloadFactory: () => Promise<TPayload> | TPayload
): Promise<void> {
    try {
        const payload = await payloadFactory();
        const response = createResponse(request, payload);
        AnalogAttachLogger.debug("AnalogAttach -> Webview response", response);
        panel.webview.postMessage(serializeBigInt(response));
    } catch (error) {
        AnalogAttachLogger.error(`Failed to process ${request.command} request`, error);
        const payload = await emptyPayloadFactory();
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
