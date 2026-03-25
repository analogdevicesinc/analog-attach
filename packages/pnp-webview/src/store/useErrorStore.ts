import { create } from 'zustand';
import type { DeviceUID } from '../../../extension-protocol/src/api-commands/payloads';

interface ErrorStoreState {
    // Map from device UID to number of errors
    deviceErrors: Map<DeviceUID, number>;

    // Actions
    setDeviceErrors: (deviceUID: DeviceUID, errorCount: number) => void;
    getDeviceErrors: (deviceUID: DeviceUID) => number;
}

export const useErrorStore = create<ErrorStoreState>((set, get) => ({
    deviceErrors: new Map<DeviceUID, number>(),

    setDeviceErrors: (deviceUID: DeviceUID, errorCount: number) => {
        set((state) => {
            const newErrors = new Map(state.deviceErrors);
            newErrors.set(deviceUID, errorCount);
            return { deviceErrors: newErrors };
        });
    },

    getDeviceErrors: (deviceUID: DeviceUID) => {
        return get().deviceErrors.get(deviceUID) ?? 0;
    },
}));
