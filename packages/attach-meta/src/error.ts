export type ErrorKind = "input" | "manifest" | "transport" | "protocol" | "internal";

export class AnalogAttachError extends Error {
    readonly kind: ErrorKind;

    constructor(kind: ErrorKind, message: string) {
        super(message);
        this.kind = kind;
        this.name = "AnalogAttachError";
    }

    exitCode(): number {
        return this.kind === "protocol" ? 1 : 2;
    }
}

export interface ErrorEnvelope {
    ok: false;
    error: string;
    category: ErrorKind;
}

export function errorEnvelope(error: AnalogAttachError): ErrorEnvelope {
    return {
        ok: false,
        error: `${error.kind} error: ${error.message}`,
        category: error.kind,
    };
}
