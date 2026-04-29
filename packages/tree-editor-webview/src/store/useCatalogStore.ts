import { create } from 'zustand';
import { CatalogCommands } from 'extension-protocol';
import type { GetDevicesResponse, CatalogDevice } from 'extension-protocol';
import { useVscodeStore } from 'attach-ui-lib';


interface CatalogState {
    // State
    devices: CatalogDevice[];
    isLoading: boolean;
    error: string | undefined;

    // Actions
    loadDevices: () => Promise<void>;
    reset: () => void;
}

const initialState = {
    devices: [],
    isLoading: false,
    error: undefined,
};

export const useCatalogStore = create<CatalogState>((set, get) => ({
    ...initialState,

    loadDevices: async () => {
        // Skip if already loaded or currently loading
        const state = get();
        if (state.devices.length > 0 || state.isLoading) {
            return;
        }
        set({ isLoading: true, error: undefined });
        try {
            if (!useVscodeStore.getState().isConnected) {
                console.warn('VS Code API not initialized, using empty list for development');
                set({ devices: [], isLoading: false, error: undefined });
                return;
            }
            const response = await useVscodeStore.getState().sendRequest<GetDevicesResponse>({
                command: CatalogCommands.getDevices,
                payload: {},
            });
            console.log('Response received:', response);

            if (response.command === CatalogCommands.getDevices) {
                if (response.status === "error") {
                    const errorMessage = response.error?.message || 'Failed to load devices from backend';
                    console.error('Failed to load devices:', errorMessage);
                    set({ devices: [], isLoading: false, error: errorMessage });
                    return;
                }

                if (response.status === "success" && response.payload?.devices) {
                    console.log('Devices loaded successfully:', response.payload.devices);
                    set({ devices: response.payload.devices, isLoading: false, error: undefined });
                } else {
                    set({ devices: [], isLoading: false, error: undefined });
                }
            } else {
                throw new Error('Unexpected response type from backend');
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Failed to load devices from backend';
            console.error('Failed to load devices:', error);
            set({ devices: [], isLoading: false, error: errorMessage });
        }
    },

    reset: () => set(initialState),
}));
