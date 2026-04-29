/**
 * Shared message envelopes for the Analog Attach API defined in
 * {@link ../../../../src/MessageAPI/MessageAPI.md}.
 */
export type AnalogAttachMessageType = "request" | "response" | "notification";

export type AnalogAttachEmptyPayload = Record<string, never>;

export interface AnalogAttachMessageEnvelope<
    TCommand extends string,
    TType extends AnalogAttachMessageType,
    TPayload
> {
    id: string;
    type: TType;
    timestamp: string;
    command: TCommand;
    payload: TPayload;
}

export interface AnalogAttachRequestEnvelope<
    TCommand extends string,
    TPayload
> extends AnalogAttachMessageEnvelope<TCommand, "request", TPayload> { }

export interface AnalogAttachNotificationEnvelope<
    TCommand extends string,
    TPayload
> extends AnalogAttachMessageEnvelope<TCommand, "notification", TPayload> { }

export type AnalogAttachResponseStatus = "success" | "error";

export interface AnalogAttachError {
    code: string;
    message: string;
    details?: string;
}

export interface AnalogAttachResponseEnvelope<
    TCommand extends string,
    TPayload
> extends AnalogAttachMessageEnvelope<TCommand, "response", TPayload> {
    status: AnalogAttachResponseStatus;
    error?: AnalogAttachError;
}
