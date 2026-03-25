import { create } from 'zustand';
import { DeviceCommands } from 'extension-protocol';
import type { GetPotentialParentNodesResponse, ParentNode } from 'extension-protocol';
import { useVscodeStore } from 'attach-ui-lib';

interface ParentNodeState {
    // State (using Record instead of Map for serializability)
    parentNodes: Record<string, ParentNode[]>;
    isLoading: boolean;
    error: string | undefined;

    // Actions
    loadParentNodes: (deviceId: string, forceReload?: boolean) => Promise<void>;
    getParentNodes: (deviceId: string) => ParentNode[];
    reset: () => void;
}

const initialState = {
    parentNodes: {},
    isLoading: false,
    error: undefined,
};

export const useParentNodeStore = create<ParentNodeState>((set, get) => ({
    ...initialState,

    getParentNodes: (deviceId: string) => {
        const state = get();
        return state.parentNodes[deviceId] || [];
    },

    loadParentNodes: async (deviceId: string, forceReload = false) => {
        const state = get();

        // Check if parent nodes are already loaded for this device
        if (!forceReload && state.parentNodes[deviceId]) {
            console.log('Parent nodes already loaded for device:', deviceId);
            return;
        }

        set({ isLoading: true, error: undefined });

        console.log('Loading parent nodes for device:', deviceId);

        try {
            // Fetch parent nodes from backend using device.getPotentialParentNodes
            const response = await useVscodeStore.getState().sendRequest<GetPotentialParentNodesResponse>({
                command: DeviceCommands.getPotentialParentNodes,
                payload: {
                    deviceId: deviceId
                },
            });

            if (response.command === DeviceCommands.getPotentialParentNodes) {
                if (response.status === "error") {
                    const errorMessage = response.error?.message || 'Failed to load parent nodes from backend';
                    console.error('Failed to load parent nodes:', errorMessage);
                    set((currentState) => ({
                        parentNodes: {
                            ...currentState.parentNodes,
                            [deviceId]: [],
                        },
                        isLoading: false,
                        error: errorMessage,
                    }));
                    return;
                }

                if (response.status === "success" && response.payload?.potentialParentNodes) {
                    set((currentState) => ({
                        parentNodes: {
                            ...currentState.parentNodes,
                            [deviceId]: response.payload.potentialParentNodes,
                        },
                        isLoading: false,
                        error: undefined,
                    }));
                } else {
                    // No parent nodes returned
                    set((currentState) => ({
                        parentNodes: {
                            ...currentState.parentNodes,
                            [deviceId]: [],
                        },
                        isLoading: false,
                        error: undefined,
                    }));
                }
            } else {
                throw new Error('Unexpected response type from backend');
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Failed to load parent nodes from backend';
            console.error('Failed to load parent nodes:', error);
            set((currentState) => ({
                parentNodes: {
                    ...currentState.parentNodes,
                    [deviceId]: [],
                },
                isLoading: false,
                error: errorMessage,
            }));
        }
    },

    reset: () => set(initialState),
}));
