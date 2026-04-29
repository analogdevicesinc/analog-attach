import { create } from 'zustand';
import { SessionCommands, DeviceCommands } from 'extension-protocol';
import type { AttachedDeviceState, DeviceChannelSummary } from 'extension-protocol';
import type { GetAttachedDevicesStateResponse, GetDeviceConfigurationResponse, UpdateDeviceConfigurationResponse, SetNodeActiveResponse } from 'extension-protocol';
import type { ConfigTemplatePayload, DeviceUID, DeviceConfigurationFormObject, FormElement, FormObjectElement } from '../../../extension-protocol/src/api-commands/payloads';
import { useVscodeStore } from 'attach-ui-lib';
import { useParentNodeStore } from './useParentNodeStore';
import { useErrorStore } from './useErrorStore';



export type EditableDeviceConfiguration = {
    deviceUID: DeviceUID;
    payload: ConfigTemplatePayload;
};

export type ChannelToDelete = {
    deviceUID: DeviceUID;
    channelName: string;
    channelAlias?: string;
};


interface DeviceInstanceState {
    // State
    deviceInstances: AttachedDeviceState[];
    isLoading: boolean;
    error: string | undefined;
    EditableDeviceInstance: EditableDeviceConfiguration | undefined;
    deviceToDelete: AttachedDeviceState | undefined;
    channelToDelete: ChannelToDelete | undefined;

    // Channel state
    isCreatingChannel: boolean;
    channelParentDeviceUID: DeviceUID | undefined;
    editingChannelName: string | undefined;

    // Actions
    setError: (error: string | undefined) => void;
    loadDeviceInstances: () => Promise<void>;
    setEditableDeviceInstance: (config: EditableDeviceConfiguration | undefined) => void;
    loadDeviceConfiguration: (deviceUID: DeviceUID) => Promise<void>;
    setDeviceActive: (deviceUID: DeviceUID, active: boolean) => Promise<void>;
    setIsExpanded: (deviceUID: DeviceUID, isExpanded: boolean) => void;
    expandAllDevices: (isExpanded: boolean) => void;
    setDeviceToDelete: (device: AttachedDeviceState | undefined) => void;
    setChannelToDelete: (channel: ChannelToDelete | undefined) => void;
    updateFormElementValue: (elementKey: string, newValue: unknown, parentKey?: string) => void;
    updateDeviceConfiguration: (config: DeviceConfigurationFormObject) => Promise<void>;
    updateCustomProperty: (oldKey?: string, newKey?: string, newValue?: string | boolean) => void;
    deleteCustomProperty: (key: string) => void;
    reset: () => void;

    // Channel actions
    startCreatingChannel: (deviceUID: DeviceUID) => Promise<void>;
    cancelChannelCreation: () => void;
    addChannelToDevice: (deviceUID: DeviceUID, channelName: string, alias?: string) => Promise<void>;
    startEditingChannel: (deviceUID: DeviceUID, channelName: string) => Promise<void>;
    deleteChannelFromDevice: (deviceUID: DeviceUID, channelName: string) => Promise<void>;
    updateChannelAlias: (channelName: string, alias: string) => void;
    updateDeviceAlias: (alias: string) => void;
}

const initialState = {
    deviceInstances: [],
    isLoading: false,
    error: undefined,
    EditableDeviceInstance: undefined,
    deviceToDelete: undefined,
    channelToDelete: undefined,
    isCreatingChannel: false,
    channelParentDeviceUID: undefined,
    editingChannelName: undefined,
};

// Helper function to extract channels from configuration
function extractChannelsFromConfig(config: DeviceConfigurationFormObject): DeviceChannelSummary[] {
    return config.config
        .filter((element): element is FormObjectElement =>
            element.type === 'FormObject' && 'channelName' in element && !!element.channelName
        )
        .map((channelElement) => ({
            name: channelElement.channelName!,
            alias: channelElement.alias || '',
            hasErrors: channelElement.config.some(configElement => !!configElement.error)
        }));
}

/**
 * Recursively count the number of FormElements in the configuration that have an error property defined.
 */
function countConfigErrors(elements: FormElement[]): number {
    let count = 0;

    function isChannelElement(element: FormElement): element is FormObjectElement {
        return element.type === 'FormObject' && 'channelName' in element && !!element.channelName;
    }

    for (const element of elements) {
        if (!isChannelElement(element) && element.error) {
            count++;
        }
    }
    return count;
}

// Helper function to recursively find and update a FormElement by key
function updateFormElementInArray(
    elements: FormElement[],
    elementKey: string,
    newValue: unknown,
    parentKey?: string
): FormElement[] {
    return elements.map((element) => {
        if (parentKey) {
            // We're looking for a nested element inside a FormObject
            if (element.type === 'FormObject') {
                const formObjectElement = element as FormObjectElement;

                // Check if this is the parent we're looking for
                // For channels, match by channelName; for other FormObjects, match by key
                const isMatchingParent = formObjectElement.channelName
                    ? formObjectElement.channelName === parentKey
                    : element.key === parentKey;

                if (isMatchingParent) {
                    // Found the parent FormObject, now search inside it for the target element
                    return {
                        ...element,
                        config: updateFormElementInArray(element.config, elementKey, newValue),
                    };
                }
                // If not matching, DON'T recurse - we're looking for a specific parent
            }
        } else {
            // No parentKey, looking for element at current level
            if (element.key === elementKey) {
                // Found the target element, update its setValue
                return {
                    ...element,
                    setValue: newValue,
                } as FormElement;
            } else if (element.type === 'FormObject' && !(element as FormObjectElement).channelName) {
                // Continue searching in nested FormObjects, but skip channels
                return {
                    ...element,
                    config: updateFormElementInArray(element.config, elementKey, newValue),
                };
            }
        }
        return element;
    });
}

// Debounce timer stored outside the store to avoid serialization issues
let debounceTimer: NodeJS.Timeout | undefined;

// Helper to clear channel-related state flags
const clearChannelState = () => ({
    isCreatingChannel: false,
    editingChannelName: undefined,
    channelParentDeviceUID: undefined
});

// Helper to update a specific device in the deviceInstances array
const updateDeviceInList = (
    deviceUID: DeviceUID,
    updateFunction: (device: AttachedDeviceState) => Partial<AttachedDeviceState>
) => {
    return (state: { deviceInstances: AttachedDeviceState[] }) => ({
        deviceInstances: state.deviceInstances.map((device) =>
            device.deviceUID === deviceUID
                ? { ...device, ...updateFunction(device) }
                : device
        ),
    });
};

// Helper to trigger debounced configuration update
const triggerDebouncedConfigUpdate = (get: () => DeviceInstanceState) => {
    if (debounceTimer) {
        clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(() => {
        const currentState = get();
        if (currentState.EditableDeviceInstance) {
            void currentState.updateDeviceConfiguration(currentState.EditableDeviceInstance.payload.config);
        }
        debounceTimer = undefined;
    }, 400); // 400ms debounce delay
};

export const useDeviceInstanceStore = create<DeviceInstanceState>((set, get) => ({
    ...initialState,

    setError: (error) =>
        set({ error, isLoading: false }),

    loadDeviceInstances: async () => {
        set({ isLoading: true, error: undefined });

        try {
            // Preserve existing states before reloading
            const currentState = get();
            const activeStateMap = new Map<DeviceUID, boolean>();
            const expandedStateMap = new Map<DeviceUID, boolean>();
            const maxChannelsMap = new Map<DeviceUID, number>();
            for (const device of currentState.deviceInstances) {
                activeStateMap.set(device.deviceUID, device.active ?? true);
                expandedStateMap.set(device.deviceUID, device.isExpanded ?? false);
                if (device.maxChannels) {
                    maxChannelsMap.set(device.deviceUID, device.maxChannels);
                }
            }

            // Get device instances from backend using new API
            const response = await useVscodeStore.getState().sendRequest<GetAttachedDevicesStateResponse>({
                command: SessionCommands.getAttachedDevicesState,
                payload: {},
            });

            if (response.command === SessionCommands.getAttachedDevicesState) {
                if (response.status === "error") {
                    const errorMessage = response.error?.message || 'Failed to load device instances from backend';
                    console.error('Failed to load device instances:', errorMessage);
                    set({ deviceInstances: [], isLoading: false, error: errorMessage });
                    return;
                }

                if (response.status === "success" && response.payload?.data) {
                    const deviceInstances: AttachedDeviceState[] = response.payload.data.map((device: AttachedDeviceState) => {
                        // Preserve existing active state if available, otherwise use backend value, default to true
                        const preservedActive = activeStateMap.get(device.deviceUID);
                        const active = preservedActive === undefined ? (device.active ?? true) : preservedActive;
                        // Preserve existing isExpanded state if available, otherwise use backend value, default to false
                        const preservedExpanded = expandedStateMap.get(device.deviceUID);
                        const isExpanded = preservedExpanded === undefined ? (device.isExpanded ?? false) : preservedExpanded;
                        // Preserve maxChannels if we've loaded config before (backend sends 0 or current count)
                        const preservedMaxChannels = maxChannelsMap.get(device.deviceUID);
                        const maxChannels = preservedMaxChannels ?? device.maxChannels;

                        return {
                            type: "AttachedDeviceState",
                            compatible: device.compatible,
                            deviceUID: device.deviceUID,
                            name: device.name,
                            alias: device.alias,
                            active,
                            isExpanded,
                            hasChannels: device.hasChannels,
                            /**
                             * Note: We do not rely on this field from backend, instead we compute errors from configuration
                             */
                            hasErrors: device.hasErrors,
                            parentNode: {
                                uuid: device.parentNode.uuid,
                                name: device.parentNode.name,
                            },
                            maxChannels,
                            channels: device.channels.map(ch => ({
                                name: ch.name,
                                alias: ch.alias,
                                hasErrors: ch.hasErrors,
                            })),
                        };
                    });

                    // Create a map to group devices by name
                    const devicesByName = new Map<string, AttachedDeviceState[]>();
                    for (const device of deviceInstances) {
                        const group = devicesByName.get(device.name);
                        if (group) {
                            group.push(device);
                        } else {
                            devicesByName.set(device.name, [device]);
                        }
                    }

                    // Process groups with duplicate names to make them unique for display
                    for (const group of devicesByName.values()) {
                        if (group.length > 1) {
                            // Sort by ID for deterministic ordering
                            group.sort((a, b) => a.deviceUID.localeCompare(b.deviceUID));
                            // Update names in place with an index
                            for (const [index, device] of group.entries()) {
                                device.name = device.name + (index >= 1 ? ` (${index})` : '');
                            }
                        }
                    }

                    set({ deviceInstances: deviceInstances, isLoading: false, error: undefined });

                    // Load parent nodes for all device instances using the ParentNodeStore.
                    // Force reload when we already had devices (i.e., this is a re-sync after
                    // an external change) so the cached UUIDs are refreshed.
                    const isReload = currentState.deviceInstances.length > 0;
                    const parentNodeStore = useParentNodeStore.getState();
                    for (const deviceInstance of deviceInstances) {
                        await parentNodeStore.loadParentNodes(deviceInstance.compatible, isReload);
                    }
                } else {
                    // No device instances returned
                    set({ deviceInstances: [], isLoading: false, error: undefined });
                }
            } else {
                throw new Error('Unexpected response type from backend');
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Failed to load device instances from backend';
            console.error('Failed to load device instances:', error);
            set({ deviceInstances: [], isLoading: false, error: errorMessage });
        }
    },

    setEditableDeviceInstance: (config) =>
        set({ EditableDeviceInstance: config }),

    setDeviceActive: async (deviceUID: DeviceUID, active: boolean) => {
        // Store original state for potential rollback
        const originalInstances = get().deviceInstances;

        // Optimistic update - update local state immediately
        set(updateDeviceInList(deviceUID, () => ({ active })));

        try {
            // Skip backend call when not connected (mock mode)
            if (!useVscodeStore.getState().isConnected) {
                console.warn('VS Code API not initialized, skipping setNodeActive backend call');
                return;
            }

            console.log('setDeviceActive', deviceUID, active);
            // Send request to backend
            const response = await useVscodeStore.getState().sendRequest<SetNodeActiveResponse>({
                command: DeviceCommands.setNodeActive,
                payload: {
                    uuid: deviceUID,
                    active: active,
                },
            });

            if (response.command === DeviceCommands.setNodeActive) {
                if (response.status === "error") {
                    const errorMessage = response.error?.message || 'Failed to set device active state';
                    console.error('Failed to set device active state:', errorMessage);
                    // Revert to original state on error
                    set({ deviceInstances: originalInstances, error: errorMessage });
                    return;
                }

                // Success - state is already updated optimistically
                if (response.status === "success") {
                    set({ error: undefined });
                }
            } else {
                throw new Error('Unexpected response type from backend');
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Failed to set device active state';
            console.error('Failed to set device active state:', error);
            // Revert to original state on error
            set({ deviceInstances: originalInstances, error: errorMessage });
        }
    },

    setIsExpanded: (deviceUID: DeviceUID, isExpanded: boolean) => {
        console.log('setIsExpanded', deviceUID, isExpanded);
        set(updateDeviceInList(deviceUID, () => ({ isExpanded })));
    },

    expandAllDevices: (isExpanded: boolean) => {
        set((state) => ({
            deviceInstances: state.deviceInstances.map((device) =>
                device.hasChannels ? { ...device, isExpanded } : device
            ),
        }));
    },

    setDeviceToDelete: (device) =>
        set({ deviceToDelete: device }),

    setChannelToDelete: (channel) =>
        set({ channelToDelete: channel }),

    loadDeviceConfiguration: async (deviceUID: DeviceUID) => {
        set({ isLoading: true, error: undefined });

        try {
            // Get device configuration from backend using new API
            const response = await useVscodeStore.getState().sendRequest<GetDeviceConfigurationResponse>({
                command: DeviceCommands.getConfiguration,
                payload: {
                    deviceUID: deviceUID,
                },
            });

            console.log(" >> GetDeviceConfiguration Response:", response);

            if (response.command === DeviceCommands.getConfiguration) {
                if (response.status === "error") {
                    const errorMessage = response.error?.message || 'Failed to load device configuration from backend';
                    console.error('Failed to load device configuration:', errorMessage);
                    set({
                        EditableDeviceInstance: undefined,
                        isLoading: false,
                        error: errorMessage,
                        ...clearChannelState()
                    });
                    return;
                }

                if (response.status === "success" && response.payload?.deviceConfiguration) {
                    const config = response.payload.deviceConfiguration.config;
                    const configErrors = countConfigErrors(config.config);
                    const channels = extractChannelsFromConfig(config);

                    set({
                        EditableDeviceInstance: {
                            deviceUID: deviceUID,
                            payload: response.payload.deviceConfiguration,
                        },
                        isLoading: false,
                        error: undefined,
                        ...clearChannelState()
                    });

                    // Update the error store with the error count
                    useErrorStore.getState().setDeviceErrors(deviceUID, configErrors);

                    // Update the device instance's channels and maxChannels
                    const maxChannels = (config.generatedChannelRegexEntries ?? []).length;
                    set(updateDeviceInList(deviceUID, () => ({
                        channels: channels,
                        maxChannels: maxChannels
                    })));
                } else {
                    set({
                        EditableDeviceInstance: undefined,
                        isLoading: false,
                        error: 'No configuration data returned from backend',
                        ...clearChannelState()
                    });
                }
            } else {
                throw new Error('Unexpected response type from backend');
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Failed to load configuration from backend';
            console.error('Failed to load configuration:', error);
            set({
                EditableDeviceInstance: undefined,
                isLoading: false,
                error: errorMessage,
                ...clearChannelState()
            });
        }
    },

    updateFormElementValue: (elementKey: string, newValue: unknown, parentKey?: string) => {
        const state = get();
        if (!state.EditableDeviceInstance) {
            return;
        }

        const updatedConfig = {
            ...state.EditableDeviceInstance.payload.config,
            config: updateFormElementInArray(
                state.EditableDeviceInstance.payload.config.config,
                elementKey,
                newValue,
                parentKey
            ),
        };

        const updatedEditableInstance: EditableDeviceConfiguration = {
            ...state.EditableDeviceInstance,
            payload: {
                ...state.EditableDeviceInstance.payload,
                config: updatedConfig,
            },
        };

        set({ EditableDeviceInstance: updatedEditableInstance });

        // Trigger debounced update
        triggerDebouncedConfigUpdate(get);
    },

    updateCustomProperty: (oldKey?: string, newKey?: string, newValue?: string | boolean) => {
        const state = get();
        if (!state.EditableDeviceInstance) {
            console.warn('Cannot update custom property: no editable device instance');
            return;
        }

        let filteredConfig = state.EditableDeviceInstance.payload.config.config;
        if (oldKey) {
            filteredConfig = state.EditableDeviceInstance.payload.config.config.filter(element => element.key !== oldKey);
        }

        const isFlagProperty = typeof newValue === 'boolean' || newValue === undefined;

        // Create the new custom form element; mark flags explicitly so the FE renders correctly
        const customElement: FormElement = {
            key: newKey,
            type: 'Generic',
            inputType: isFlagProperty ? 'custom-flag' : 'custom',
            required: false,
            setValue: isFlagProperty ? (newValue ?? true) : newValue,
        } as FormElement;

        const updatedConfig = {
            ...state.EditableDeviceInstance.payload.config,
            config: [...filteredConfig, customElement],
        };

        const updatedEditableInstance: EditableDeviceConfiguration = {
            ...state.EditableDeviceInstance,
            payload: {
                ...state.EditableDeviceInstance.payload,
                config: updatedConfig,
            },
        };

        set({ EditableDeviceInstance: updatedEditableInstance });

        // Trigger debounced update
        triggerDebouncedConfigUpdate(get);
    },

    deleteCustomProperty: (key: string) => {
        const state = get();
        if (!state.EditableDeviceInstance) {
            console.warn('Cannot delete custom property: no editable device instance');
            return;
        }

        const updatedConfig = {
            ...state.EditableDeviceInstance.payload.config,
            config: state.EditableDeviceInstance.payload.config.config.filter(element => element.key !== key),
        };

        const updatedEditableInstance: EditableDeviceConfiguration = {
            ...state.EditableDeviceInstance,
            payload: {
                ...state.EditableDeviceInstance.payload,
                config: updatedConfig,
            },
        };

        set({ EditableDeviceInstance: updatedEditableInstance });

        // Trigger debounced update
        triggerDebouncedConfigUpdate(get);
    },

    updateDeviceConfiguration: async (config: DeviceConfigurationFormObject) => {
        const state = get();
        if (!state.EditableDeviceInstance) {
            console.warn('Cannot update configuration: no editable device instance');
            return;
        }

        try {
            // Only use mock data when VS Code backend is not available
            if (!useVscodeStore.getState().isConnected) {
                console.warn('VS Code API not initialized, skipping configuration update');
                return;
            }
            console.log(" >> UpdateDeviceConfiguration Request:", config);

            const response = await useVscodeStore.getState().sendRequest<UpdateDeviceConfigurationResponse>({
                command: DeviceCommands.updateConfiguration,
                payload: {
                    deviceUID: state.EditableDeviceInstance.deviceUID,
                    config: config,
                },
            });

            console.log("<< UpdateDeviceConfiguration Response:", response);

            if (response.command === DeviceCommands.updateConfiguration) {
                if (response.status === "error") {
                    const errorMessage = response.error?.message || 'Failed to update device configuration';
                    console.error('Failed to update device configuration:', errorMessage);
                    set({ error: errorMessage });
                    return;
                }

                if (response.status === "success" && response.payload?.deviceConfiguration) {
                    const updatedDeviceUID = response.payload.deviceUID ?? state.EditableDeviceInstance.deviceUID;
                    const updatedConfig = response.payload.deviceConfiguration.config;

                    // Extract channels from the updated configuration
                    const updatedChannels = extractChannelsFromConfig(updatedConfig);

                    // Update EditableDeviceInstance with the response from backend
                    set({
                        EditableDeviceInstance: {
                            deviceUID: updatedDeviceUID,
                            payload: response.payload.deviceConfiguration,
                        },
                        error: undefined,
                    });
                    // Check for any validation errors in the entire configuration
                    const configErrors = countConfigErrors(updatedConfig.config);

                    // Update the error store with the error count
                    useErrorStore.getState().setDeviceErrors(updatedDeviceUID, configErrors);

                    // Also update deviceInstances with the new parent/UID, alias, channels, and maxChannels
                    const maxChannels = (updatedConfig.generatedChannelRegexEntries ?? []).length;
                    set(updateDeviceInList(state.EditableDeviceInstance.deviceUID, (device) => ({
                        deviceUID: updatedDeviceUID,
                        parentNode: updatedConfig.parentNode ?? device.parentNode,
                        alias: updatedConfig.alias ?? device.alias,
                        channels: updatedChannels,
                        maxChannels: maxChannels || device.maxChannels,
                    })));
                } else {
                    set({ error: 'No configuration data returned from backend' });
                }
            } else {
                throw new Error('Unexpected response type from backend');
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Failed to update configuration';
            console.error('Failed to update configuration:', error);
            set({ error: errorMessage });
        }
    },

    reset: () => {
        // Clear debounce timer on reset
        if (debounceTimer) {
            clearTimeout(debounceTimer);
            debounceTimer = undefined;
        }
        set({ ...initialState });
        useParentNodeStore.getState().reset();
    },

    // Channel actions implementation
    startCreatingChannel: async (deviceUID: DeviceUID) => {
        // Load device configuration to get channelRegexes
        await get().loadDeviceConfiguration(deviceUID);
        set({
            isCreatingChannel: true,
            channelParentDeviceUID: deviceUID,
            editingChannelName: undefined
        });
    },

    cancelChannelCreation: () => {
        set({
            EditableDeviceInstance: undefined,
            ...clearChannelState()
        });
    },

    addChannelToDevice: async (deviceUID: DeviceUID, channelName: string, alias?: string) => {
        const state = get();
        if (!state.EditableDeviceInstance || state.EditableDeviceInstance.deviceUID !== deviceUID) {
            throw new Error('No device configuration loaded for the specified device');
        }

        // Create new channel FormObjectElement
        const newChannel: FormObjectElement = {
            type: 'FormObject',
            key: channelName,
            channelName: channelName,
            alias: alias,
            required: false,
            config: [] // Empty config for new channels
        };

        // Add channel to config array
        const updatedConfig: DeviceConfigurationFormObject = {
            ...state.EditableDeviceInstance.payload.config,
            config: [...state.EditableDeviceInstance.payload.config.config, newChannel]
        };

        // Update device configuration
        await state.updateDeviceConfiguration(updatedConfig);

        // Reload device list to get updated channels
        await state.loadDeviceInstances();

        // Expand the channel list for this device to show the newly created channel
        get().setIsExpanded(deviceUID, true);

        // Switch to edit mode for the new channel
        set({
            isCreatingChannel: false,
            editingChannelName: channelName
        });
    },

    startEditingChannel: async (deviceUID: DeviceUID, channelName: string) => {
        // Load device configuration
        await get().loadDeviceConfiguration(deviceUID);

        set({
            isCreatingChannel: false,
            editingChannelName: channelName,
            channelParentDeviceUID: deviceUID
        });
    },

    deleteChannelFromDevice: async (deviceUID: DeviceUID, channelName: string) => {
        const state = get();

        // Load device configuration if not already loaded
        if (!state.EditableDeviceInstance || state.EditableDeviceInstance.deviceUID !== deviceUID) {
            await state.loadDeviceConfiguration(deviceUID);
        }

        const currentState = get();
        if (!currentState.EditableDeviceInstance) {
            throw new Error('No device configuration loaded');
        }

        // Remove channel from config array
        const updatedConfig: DeviceConfigurationFormObject = {
            ...currentState.EditableDeviceInstance.payload.config,
            config: currentState.EditableDeviceInstance.payload.config.config.filter(
                (element) => !(element.type === 'FormObject' && (element as FormObjectElement).channelName === channelName)
            )
        };

        // Update device configuration
        await currentState.updateDeviceConfiguration(updatedConfig);

        // Reload device list
        await currentState.loadDeviceInstances();

        // Close sidebar if we were editing this channel
        if (currentState.editingChannelName === channelName) {
            set({
                EditableDeviceInstance: undefined,
                ...clearChannelState()
            });
        }
    },

    updateChannelAlias: (channelName: string, alias: string) => {
        console.log('updateChannelAlias', channelName, alias);
        const state = get();
        if (!state.EditableDeviceInstance) {
            return;
        }

        // Update the alias in the channel's FormObjectElement
        const updatedConfig = {
            ...state.EditableDeviceInstance.payload.config,
            config: state.EditableDeviceInstance.payload.config.config.map((element) => {
                if (element.type === 'FormObject' && (element as FormObjectElement).channelName === channelName) {
                    return {
                        ...element,
                        alias: alias
                    } as FormObjectElement;
                }
                return element;
            })
        };

        set({
            EditableDeviceInstance: {
                ...state.EditableDeviceInstance,
                payload: {
                    ...state.EditableDeviceInstance.payload,
                    config: updatedConfig
                }
            }
        });

        // Trigger debounced update
        triggerDebouncedConfigUpdate(get);
    },

    updateDeviceAlias: (alias: string) => {
        const state = get();
        if (!state.EditableDeviceInstance) {
            return;
        }

        const updatedConfig = {
            ...state.EditableDeviceInstance.payload.config,
            alias,
        };

        set({
            EditableDeviceInstance: {
                ...state.EditableDeviceInstance,
                payload: {
                    ...state.EditableDeviceInstance.payload,
                    config: updatedConfig,
                },
            },
        });

        // Trigger debounced update — same pattern as updateChannelAlias
        triggerDebouncedConfigUpdate(get);
    },
}));
