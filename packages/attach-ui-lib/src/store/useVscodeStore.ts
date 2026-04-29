import { create } from 'zustand';
import { deserializeBigInt, serializeBigInt } from 'attach-lib/browser';
import type { VsCodeApi } from '../vscode';
import type {
    AnalogAttachRequestEnvelope,
    AnalogAttachResponseEnvelope,
    AnalogAttachApiResponse,
} from 'extension-protocol';

// Initialize VS Code API once
let vscodeApi: VsCodeApi | undefined;

function getVsCodeApi(): VsCodeApi {
    if (!vscodeApi && globalThis.window !== undefined && globalThis.window.acquireVsCodeApi) {
        vscodeApi = globalThis.window.acquireVsCodeApi();
    }
    return vscodeApi as VsCodeApi;
}

interface PendingRequest {
    messageId: string;
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
}

interface VscodeState {
    // State
    vscode: VsCodeApi | null;
    isConnected: boolean;
    pendingRequests: Map<string, PendingRequest>;
    onMessage: (handler: (event: MessageEvent) => void) => () => void;

    // Actions
    initialize: () => void;
    postMessage: (message: any) => void;
    sendRequest: <TResponse extends AnalogAttachApiResponse = AnalogAttachApiResponse>(
        request: {
            command: string;
            payload?: unknown;
        },
        timeout?: number
    ) => Promise<TResponse>;
    setState: (state: any) => void;
    getState: () => any;
    cleanup: () => void;
}

// Helper function to generate unique message ID
function generateMessageId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

// Helper function to get current timestamp
function getCurrentTimestamp(): string {
    return new Date().toISOString();
}

export const useVscodeStore = create<VscodeState>((set, get) => {
    // Registry for broadcast subscribers
    const subscribers = new Set<(event: MessageEvent) => void>();

    const onMessage = (event: MessageEvent) => {
        const data = deserializeBigInt(event.data);

        // Handle new API response envelope format
        if (data && typeof data === 'object') {
            // Check for AnalogAttachResponseEnvelope format
            if (
                'id' in data &&
                'type' in data &&
                data.type === 'response' &&
                'timestamp' in data &&
                'command' in data &&
                'payload' in data &&
                'status' in data
            ) {
                const response = data as AnalogAttachResponseEnvelope<string, unknown>;
                const state = get();
                const pending = state.pendingRequests.get(response.id);
                if (pending) {
                    clearTimeout(pending.timeout);
                    const newPendingRequests = new Map(state.pendingRequests);
                    newPendingRequests.delete(response.id);
                    set({ pendingRequests: newPendingRequests });
                    pending.resolve(response);
                }
            }
        }

        // Fan out all messages to subscribers (notifications, etc.)
        subscribers.forEach((subscriber) => {
            try {
                subscriber(event);
            } catch (error) {
                console.error("Message subscriber threw", error);
            }
        });
    };

    return {
        vscode: null,
        isConnected: false,
        pendingRequests: new Map(),
        onMessage: (onMessageHandler: (event: MessageEvent) => void) => {
            subscribers.add(onMessageHandler);
            return () => subscribers.delete(onMessageHandler);
        },

        initialize: () => {
            const vscode = getVsCodeApi();
            if (vscode) {
                globalThis.window.addEventListener('message', onMessage);
                set({ vscode, isConnected: true });
            }
        },

        postMessage: (message) => {
            const state = get();
            // Serialize BigInt values before sending to avoid JSON serialization errors
            state.vscode?.postMessage(serializeBigInt(message));
        },

        sendRequest: <TResponse extends AnalogAttachApiResponse = AnalogAttachApiResponse>(
            request: {
                command: string;
                payload?: unknown;
            },
            timeout = 50000
        ): Promise<TResponse> => {
            return new Promise((resolve, reject) => {
                const state = get();

                if (!state.vscode) {
                    reject(new Error('VS Code API not initialized'));
                    return;
                }

                // Generate id and timestamp for the request envelope
                const messageId = generateMessageId();
                const timestamp = getCurrentTimestamp();

                // Create the request envelope with id and timestamp
                const requestEnvelope: AnalogAttachRequestEnvelope<string, unknown> = {
                    id: messageId,
                    type: 'request',
                    timestamp,
                    command: request.command,
                    payload: request.payload ?? {},
                };

                const timeoutId = setTimeout(() => {
                    const currentState = get();
                    const newPendingRequests = new Map(currentState.pendingRequests);
                    newPendingRequests.delete(messageId);
                    set({ pendingRequests: newPendingRequests });
                    reject(new Error('Request timeout'));
                }, timeout);

                const newPendingRequests = new Map(state.pendingRequests);
                newPendingRequests.set(messageId, {
                    messageId,
                    resolve: resolve as (value: any) => void,
                    reject,
                    timeout: timeoutId,
                });

                set({ pendingRequests: newPendingRequests });

                // Send the request envelope with BigInt values serialized
                state.vscode.postMessage(serializeBigInt(requestEnvelope));
            });
        },

        setState: (state) => {
            const currentState = get();
            currentState.vscode?.setState(state);
        },

        getState: () => {
            const state = get();
            return state.vscode?.getState();
        },

        cleanup: () => {
            const state = get();
            // Clear all pending timeouts
            state.pendingRequests.forEach((request) => {
                clearTimeout(request.timeout);
            });

            if (state.isConnected) {
                globalThis.window.removeEventListener('message', onMessage);
            }

            subscribers.clear();

            set({
                pendingRequests: new Map(),
                isConnected: false,
            });
        },
    };
});
