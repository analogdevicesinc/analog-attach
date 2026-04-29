import { create } from 'zustand';
import type { DeviceGroupData } from './types';
import { CatalogCommands } from 'extension-protocol';
import type { GetDevicesResponse, CatalogDevice } from 'extension-protocol';
import { useVscodeStore } from 'attach-ui-lib';

interface DeviceState {
    // State
    deviceGroups: DeviceGroupData[];
    isLoading: boolean;
    error: string | undefined;

    // Actions
    loadDevices: () => Promise<void>;
    reset: () => void;
}

const initialState = {
    deviceGroups: [],
    isLoading: false,
    error: undefined,
};

export const useDeviceStore = create<DeviceState>((set) => ({
    ...initialState,

    loadDevices: async () => {
        set({ isLoading: true, error: undefined });

        try {
            // Get devices from backend using new API
            const response = await useVscodeStore.getState().sendRequest<GetDevicesResponse>({
                command: CatalogCommands.getDevices,
                payload: {},
            });

            if (response.command === CatalogCommands.getDevices) {
                if (response.status === "error") {
                    const errorMessage = response.error?.message || 'Failed to load devices from backend';
                    console.error('Failed to load devices:', errorMessage);
                    set({ deviceGroups: [], isLoading: false, error: errorMessage });
                    return;
                }

                if (response.status === "success" && response.payload?.devices) {
                    // Group devices by group (empty string = ungrouped)
                    const groups = new Map<string | undefined, CatalogDevice[]>();
                    for (const device of response.payload.devices) {
                        // Convert empty string group to undefined for consistency
                        const group = device.group === "" ? undefined : device.group;
                        if (!groups.has(group)) {
                            groups.set(group, []);
                        }
                        groups.get(group)!.push(device);
                    }

                    const deviceGroups: DeviceGroupData[] = [...groups.entries()].map(
                        ([group, devices]) => ({
                            group,
                            devices: devices.map(d => ({
                                ...d,
                                group: d.group === "" ? undefined : d.group
                            })) as CatalogDevice[]
                        })
                    );

                    set({ deviceGroups, isLoading: false, error: undefined });
                } else {
                    // No devices returned
                    set({ deviceGroups: [], isLoading: false, error: undefined });
                }
            } else {
                throw new Error('Unexpected response type from backend');
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Failed to load devices from backend';
            console.error('Failed to load devices:', error);
            set({ deviceGroups: [], isLoading: false, error: errorMessage });
        }
    },

    reset: () => set(initialState),
}));
