import { create } from 'zustand';
import { DeviceCommands } from 'extension-protocol';
import type {
    GetDeviceConfigurationResponse,
    GetDeviceConfigurationRequest,
    UpdateDeviceConfigurationResponse,
    UpdateDeviceConfigurationRequest,
    SetNodeActiveRequest,
    SetNodeActiveResponse,
    DeviceUID,
    DeviceConfigurationFormObject,
    FormElement,
    FormObjectElement,
    GenericFormElement
} from 'extension-protocol';
import { useVscodeStore } from 'attach-ui-lib';
import { useNodesStore } from './useNodesStore';

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
                // Check if this is the parent we're looking for
                const isMatchingParent = element.key === parentKey;
                if (isMatchingParent) {
                    return {
                        ...element,
                        config: updateFormElementInArray(element.config, elementKey, newValue),
                    };
                }
            }
        } else {
            // No parentKey, looking for element at current level
            if (element.key === elementKey) {
                return { ...element, setValue: newValue } as FormElement;
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

// Helper function to handle configuration API errors
const handleConfigurationError = (error: unknown, operation: string, set: (state: Partial<DeviceConfigurationState>) => void) => {
    const errorMessage = error instanceof Error ? error.message : `Failed to ${operation}`;
    console.error(`Failed to ${operation}:`, error);
    set({ error: errorMessage });
};

interface DeviceConfigurationState {
    // State
    configuration?: DeviceConfigurationFormObject;
    currentDeviceUID?: DeviceUID;
    isLoading: boolean;
    error?: string;

    // Actions
    getConfiguration: (deviceUID: DeviceUID) => Promise<void>;
    updateConfiguration: (deviceUID: DeviceUID, config: DeviceConfigurationFormObject) => Promise<void>;
    updateFormElementValue: (elementKey: string, newValue: unknown, parentKey?: string) => void;
    updateCustomProperty: (oldKey?: string, newKey?: string, newValue?: string | boolean | number, propertyType?: string) => void;
    deleteCustomProperty: (key: string) => void;
    setDeviceActive: (uuid: DeviceUID, active: boolean) => Promise<void>;
    updateDeviceAlias: (newAlias: string) => Promise<void>;
    clearConfiguration: () => void;
    setError: (error?: string) => void;
    reset: () => void;
}

const initialState = {
    configuration: undefined,
    currentDeviceUID: undefined,
    isLoading: false,
    error: undefined,
    hasUnsavedChanges: false,
};

// Helper to trigger debounced configuration update
const triggerDebouncedConfigUpdate = (get: () => DeviceConfigurationState) => {
    if (debounceTimer) {
        clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(async () => {
        const currentState = get();
        if (currentState.configuration && currentState.currentDeviceUID) {
            await currentState.updateConfiguration(currentState.currentDeviceUID, currentState.configuration);
            // Reload nodes to reflect changes in the tree view
            await useNodesStore.getState().loadNodes();
        }
        debounceTimer = undefined;
    }, 400); // 400ms debounce delay
};

export const useDeviceConfigurationStore = create<DeviceConfigurationState>((set, get) => ({
    ...initialState,

    getConfiguration: async (deviceUID: DeviceUID) => {
        if (!deviceUID) {
            console.warn('No deviceUID provided, cannot load configuration');
            set({ configuration: undefined, currentDeviceUID: undefined });
            return;
        }

        // Check if we already have the configuration for this device
        const state = get();
        if (state.currentDeviceUID === deviceUID && state.configuration) {
            console.log('Configuration already loaded for deviceUID:', deviceUID);
            return;
        }

        set({ isLoading: true, error: undefined });

        try {
            if (!useVscodeStore.getState().isConnected) {
                console.warn('VS Code API not initialized, cannot get configuration');
                set({ configuration: undefined, currentDeviceUID: undefined, isLoading: false });
                return;
            }

            console.log('[DeviceConfig] getConfiguration ->', { deviceUID });

            const response = await useVscodeStore.getState().sendRequest<GetDeviceConfigurationResponse>({
                command: DeviceCommands.getConfiguration,
                payload: { deviceUID }
            } as GetDeviceConfigurationRequest);

            console.log('[DeviceConfig] getConfiguration <-', response);

            if (response.command === DeviceCommands.getConfiguration) {
                if (response.status === "success" && response.payload?.deviceConfiguration) {
                    console.log('Device configuration loaded successfully');
                    set({
                        configuration: response.payload.deviceConfiguration.config,
                        currentDeviceUID: deviceUID,
                        isLoading: false,
                        error: undefined,
                    });
                    return;
                }

                if (response.status === "error") {
                    const errorMessage = response.error?.message || 'Failed to load device configuration';
                    console.error('Backend error:', errorMessage);
                    set({
                        error: errorMessage,
                        configuration: undefined,
                        currentDeviceUID: undefined,
                        isLoading: false
                    });
                    return;
                }
            }

            throw new Error('Unexpected response format from backend');

        } catch (error) {
            handleConfigurationError(error, 'load device configuration', set);
            set({ configuration: undefined, currentDeviceUID: undefined, isLoading: false });
        }
    },

    updateConfiguration: async (deviceUID: DeviceUID, config: DeviceConfigurationFormObject) => {
        if (!deviceUID) {
            console.error('No deviceUID provided, cannot update configuration');
            set({ error: 'Cannot update: no device UID provided' });
            return;
        }

        try {
            if (!useVscodeStore.getState().isConnected) {
                console.warn('VS Code API not initialized, cannot update configuration');
                return;
            }

            console.log('[DeviceConfig] updateConfiguration ->', { deviceUID, config });

            const response = await useVscodeStore.getState().sendRequest<UpdateDeviceConfigurationResponse>({
                command: DeviceCommands.updateConfiguration,
                payload: {
                    deviceUID,
                    config
                }
            } as UpdateDeviceConfigurationRequest);

            console.log('[DeviceConfig] updateConfiguration <-', response);

            if (response.command === DeviceCommands.updateConfiguration) {
                if (response.status === "success") {
                    console.log('Configuration updated successfully', response.payload);
                    // Update local configuration state with backend response if provided
                    const updatedConfig = response.payload?.deviceConfiguration?.config || config;
                    set({
                        configuration: updatedConfig,
                        currentDeviceUID: deviceUID,
                        error: undefined
                    });
                    return;
                }

                if (response.status === "error") {
                    const errorMessage = response.error?.message || 'Failed to update configuration';
                    console.error('Backend error:', errorMessage);
                    set({ error: errorMessage });
                    return;
                }
            }

            throw new Error('Unexpected response format from backend');

        } catch (error) {
            handleConfigurationError(error, 'update configuration', set);
        }
    },

    updateFormElementValue: (elementKey: string, newValue: unknown, parentKey?: string) => {
        const state = get();
        if (!state.configuration) {
            return;
        }

        const updatedConfig = {
            ...state.configuration,
            config: updateFormElementInArray(
                state.configuration.config,
                elementKey,
                newValue,
                parentKey
            ),
        };

        set({
            configuration: updatedConfig,
        });

        // Trigger debounced update to backend
        triggerDebouncedConfigUpdate(get);
    },

    /**
     * Update or create a custom property in the device configuration
     * @param oldKey provide the old key if the property gets renamed
     * @param newKey provide the new key for the property, also when creating a new one
     * @param newValue provide the new value for the property
     * @returns 
     */
    updateCustomProperty: (oldKey?: string, newKey?: string, newValue?: string | boolean | number, propertyType?: string) => {
        const state = get();
        if (!state.configuration) {
            console.warn('Cannot update custom property: no configuration loaded');
            return;
        }

        let filteredConfig = state.configuration.config;
        if (oldKey) {
            filteredConfig = state.configuration.config.filter(element => element.key !== oldKey);
        }

        // Determine inputType based on propertyType
        const getInputType = () => {
            switch (propertyType) {
                case 'flag': return 'custom-flag';
                case 'number': return 'custom-number';
                case 'phandle': return 'custom-phandle';
                case 'text':
                default: return 'custom';
            }
        };

        const isFlagProperty = propertyType === 'flag';

        // Create the new custom form element; mark flags explicitly so the FE renders correctly
        const customElement = {
            key: newKey,
            type: 'Generic',
            inputType: getInputType(),
            required: false,
            setValue: isFlagProperty ? (newValue ?? true) : newValue,
        } as GenericFormElement;

        const updatedConfig = {
            ...state.configuration,
            config: [...filteredConfig, customElement],
        };

        set({
            configuration: updatedConfig,
        });

        // Trigger debounced update to backend
        triggerDebouncedConfigUpdate(get);
    },

    deleteCustomProperty: (key: string) => {
        const state = get();
        if (!state.configuration) {
            console.warn('Cannot delete custom property: no configuration loaded');
            return;
        }

        const updatedConfig = {
            ...state.configuration,
            config: state.configuration.config.filter(element => element.key !== key),
        };

        set({
            configuration: updatedConfig,
        });

        // Trigger debounced update to backend
        triggerDebouncedConfigUpdate(get);
    },

    setDeviceActive: async (uuid: DeviceUID, active: boolean) => {
        try {
            const vscodeStore = useVscodeStore.getState();

            if (!vscodeStore.isConnected) {
                console.warn('VS Code API not initialized, cannot set device active state');
                set({ error: 'Cannot set device active state: VS Code API not connected' });
                return;
            }

            console.log('Setting device active state for uuid:', uuid, 'active:', active);

            const response = await vscodeStore.sendRequest<SetNodeActiveResponse>({
                command: DeviceCommands.setNodeActive,
                payload: { uuid, active }
            } as SetNodeActiveRequest);

            if (response.command === DeviceCommands.setNodeActive) {
                if (response.status === "success") {
                    console.log('Device active state updated successfully');
                    const currentConfig = get().configuration;
                    if (currentConfig) {
                        set({
                            error: undefined, configuration: {
                                ...currentConfig,
                                active: active
                            }
                        });
                    } else {
                        set({ error: undefined });
                    }
                    return;
                }

                if (response.status === "error") {
                    const errorMessage = response.error?.message || 'Failed to set device active state';
                    console.error('Backend error:', errorMessage);
                    set({ error: errorMessage });
                    return;
                }
            }

            throw new Error('Unexpected response format from backend');

        } catch (error) {
            handleConfigurationError(error, 'set device active state', set);
        }
    },

    updateDeviceAlias: async (newAlias: string) => {
        const state = get();
        const nodesStore = useNodesStore.getState();
        if (!state.configuration || !state.currentDeviceUID) {
            console.warn('Cannot update device alias: no configuration loaded');
            return;
        }

        const updatedConfig = {
            ...state.configuration,
            alias: newAlias,
        };

        set({
            configuration: updatedConfig,
        });

        // Use updateNode instead of selectNode to preserve the existing node reference
        // in the tree. selectNode with a spread object breaks reference equality used
        // by findPathToNode, causing selectedNodePath to become undefined and the view
        // to reset to the empty state after loadNodes() is called in the debounce.
        if (nodesStore.selectedNode) {
            nodesStore.updateNode(nodesStore.selectedNode, {
                label: newAlias || (nodesStore.selectedNode.data as { key?: string }).key || nodesStore.selectedNode.label,
            });
        }

        // Trigger debounced update to backend
        triggerDebouncedConfigUpdate(get);
    },

    clearConfiguration: () => {
        if (debounceTimer) {
            clearTimeout(debounceTimer);
            debounceTimer = undefined;
        }
        set({ configuration: undefined, currentDeviceUID: undefined, error: undefined });
    },

    setError: (error?: string) => {
        set({ error });
    },

    reset: () => {
        if (debounceTimer) {
            clearTimeout(debounceTimer);
            debounceTimer = undefined;
        }
        set(initialState);
    },
}));
