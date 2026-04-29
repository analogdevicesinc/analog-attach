import type {
    AttachedDeviceState,
    CatalogDevice,
    ConfigTemplatePayload,
    DeviceIdentifier,
    DeviceUID,
    FileChangeNotificationPayload,
    FormElement,
    ParentNode,
} from "./payloads.js";
import type {
    AnalogAttachEmptyPayload,
    AnalogAttachNotificationEnvelope,
    AnalogAttachRequestEnvelope,
    AnalogAttachResponseEnvelope,
} from "./messages.js";

/*
+-----------------------------+
| Session Requests/Responses |
+-----------------------------+
*/

export const SessionCommands = {
    getAttachedDevicesState: "session.getAttachedDevicesState",
} as const;
export type SessionCommand = typeof SessionCommands[keyof typeof SessionCommands];

export type GetAttachedDevicesStateRequest = AnalogAttachRequestEnvelope<
    typeof SessionCommands.getAttachedDevicesState,
    AnalogAttachEmptyPayload
>;

export interface GetAttachedDevicesStateResponsePayload {
    data: AttachedDeviceState[];
}

export type GetAttachedDevicesStateResponse = AnalogAttachResponseEnvelope<
    typeof SessionCommands.getAttachedDevicesState,
    GetAttachedDevicesStateResponsePayload
>;

/*
+----------------------------+
| Catalog Requests/Responses |
+----------------------------+
*/

export const CatalogCommands = {
    getDevices: "catalog.getDevices",
} as const;
export type CatalogCommand = typeof CatalogCommands[keyof typeof CatalogCommands];

export type GetDevicesRequest = AnalogAttachRequestEnvelope<
    typeof CatalogCommands.getDevices,
    AnalogAttachEmptyPayload
>;

export interface GetDevicesResponsePayload {
    devices: CatalogDevice[];
}

export type GetDevicesResponse = AnalogAttachResponseEnvelope<
    typeof CatalogCommands.getDevices,
    GetDevicesResponsePayload
>;

/*
+---------------------------+
| Device Requests/Responses |
+---------------------------+
*/

export const DeviceCommands = {
    getPotentialParentNodes: "device.getPotentialParentNodes",
    setParentNode: "device.setParentNode",
    getConfiguration: "device.getConfiguration",
    updateConfiguration: "device.updateConfiguration",
    setNodeActive: "device.setNodeActive",
    delete: "device.delete",
} as const;
export type DeviceCommand = typeof DeviceCommands[keyof typeof DeviceCommands];

export type GetPotentialParentNodesRequest = AnalogAttachRequestEnvelope<
    typeof DeviceCommands.getPotentialParentNodes,
    {
        deviceId: DeviceIdentifier;
    }
>;

export interface GetPotentialParentNodesResponsePayload {
    potentialParentNodes: ParentNode[];
}

export type GetPotentialParentNodesResponse = AnalogAttachResponseEnvelope<
    typeof DeviceCommands.getPotentialParentNodes,
    GetPotentialParentNodesResponsePayload
>;

export type SetParentNodeRequest = AnalogAttachRequestEnvelope<
    typeof DeviceCommands.setParentNode,
    {
        deviceId: DeviceIdentifier;
        parentNode: ParentNode;
    }
>;

export interface SetParentNodeResponsePayload {
    deviceUID: DeviceUID;
}

export type SetParentNodeResponse = AnalogAttachResponseEnvelope<
    typeof DeviceCommands.setParentNode,
    SetParentNodeResponsePayload
>;

export type DeleteDeviceRequest = AnalogAttachRequestEnvelope<
    typeof DeviceCommands.delete,
    {
        deviceUID: DeviceUID;
    }
>;

export interface DeleteDeviceResponsePayload {
    deviceUID: DeviceUID;
}

export type DeleteDeviceResponse = AnalogAttachResponseEnvelope<
    typeof DeviceCommands.delete,
    DeleteDeviceResponsePayload
>;

export type GetDeviceConfigurationRequest = AnalogAttachRequestEnvelope<
    typeof DeviceCommands.getConfiguration,
    {
        deviceUID: DeviceUID;
    }
>;

export interface GetDeviceConfigurationResponsePayload {
    deviceConfiguration: ConfigTemplatePayload;
}

export type GetDeviceConfigurationResponse = AnalogAttachResponseEnvelope<
    typeof DeviceCommands.getConfiguration,
    GetDeviceConfigurationResponsePayload
>;

export type UpdateDeviceConfigurationRequest = AnalogAttachRequestEnvelope<
    typeof DeviceCommands.updateConfiguration,
    {
        deviceUID: DeviceUID;
        config: ConfigTemplatePayload["config"];
    }
>;

export interface UpdateDeviceConfigurationResponsePayload extends GetDeviceConfigurationResponsePayload {
    deviceUID?: DeviceUID;
}

export type UpdateDeviceConfigurationResponse = AnalogAttachResponseEnvelope<
    typeof DeviceCommands.updateConfiguration,
    UpdateDeviceConfigurationResponsePayload
>;

export type SetNodeActiveRequest = AnalogAttachRequestEnvelope<
    typeof DeviceCommands.setNodeActive,
    {
        uuid: DeviceUID;
        active: boolean;
    }
>;

export interface SetNodeActiveResponsePayload {
    uuid: DeviceUID;
    active: boolean;
}

export type SetNodeActiveResponse = AnalogAttachResponseEnvelope<
    typeof DeviceCommands.setNodeActive,
    SetNodeActiveResponsePayload
>;

/*
+--------------------------------+
| Tree View Requests/Responses   |
+--------------------------------+
*/

export const TreeViewCommands = {
    getDeviceTree: "tree.getDeviceTree",
} as const;
export type TreeViewCommand = typeof TreeViewCommands[keyof typeof TreeViewCommands];

export type GetDeviceTreeRequest = AnalogAttachRequestEnvelope<
    typeof TreeViewCommands.getDeviceTree,
    AnalogAttachEmptyPayload
>;

export interface GetDeviceTreeResponsePayload {
    deviceTree: FormElement;
    isReadOnly: boolean;
    isDtso: boolean;
}

export type GetDeviceTreeResponse = AnalogAttachResponseEnvelope<
    typeof TreeViewCommands.getDeviceTree,
    GetDeviceTreeResponsePayload
>;

/*
+--------------------------+
| Event Notifications Only |
+--------------------------+
*/

export const EventCommands = {
    fileChanged: "event.fileChanged",
} as const;
export type EventCommand = typeof EventCommands[keyof typeof EventCommands];

export type FileChangedNotification = AnalogAttachNotificationEnvelope<
    typeof EventCommands.fileChanged,
    FileChangeNotificationPayload
>;

/*
+-------------------------------+
| Navigation Notifications Only |
+-------------------------------+
*/

export const NavigationCommands = {
    navigateBack: "navigation.back",
    navigateForward: "navigation.forward",
} as const;
export type NavigationCommand = typeof NavigationCommands[keyof typeof NavigationCommands];

export type NavigateBackNotification = AnalogAttachNotificationEnvelope<
    typeof NavigationCommands.navigateBack,
    AnalogAttachEmptyPayload
>;

export type NavigateForwardNotification = AnalogAttachNotificationEnvelope<
    typeof NavigationCommands.navigateForward,
    AnalogAttachEmptyPayload
>;

/*
+-------------------------------+
| Settings Requests/Responses   |
+-------------------------------+
*/

export const SettingsCommands = {
    getSetting: "settings.get",
    updateSetting: "settings.update",
} as const;
export type SettingsCommand = typeof SettingsCommands[keyof typeof SettingsCommands];

export type GetSettingRequest = AnalogAttachRequestEnvelope<
    typeof SettingsCommands.getSetting,
    {
        key: string;
    }
>;

export interface GetSettingResponsePayload {
    key: string;
    value: unknown;
}

export type GetSettingResponse = AnalogAttachResponseEnvelope<
    typeof SettingsCommands.getSetting,
    GetSettingResponsePayload
>;

export type UpdateSettingRequest = AnalogAttachRequestEnvelope<
    typeof SettingsCommands.updateSetting,
    {
        key: string;
        value: unknown;
    }
>;

export interface UpdateSettingResponsePayload {
    key: string;
    value: unknown;
}

export type UpdateSettingResponse = AnalogAttachResponseEnvelope<
    typeof SettingsCommands.updateSetting,
    UpdateSettingResponsePayload
>;

/*
+------------------------+
| Aggregated API Typings |
+------------------------+
*/

export type AnalogAttachApiRequest =
    | GetAttachedDevicesStateRequest
    | GetDevicesRequest
    | GetPotentialParentNodesRequest
    | SetParentNodeRequest
    | DeleteDeviceRequest
    | GetDeviceConfigurationRequest
    | UpdateDeviceConfigurationRequest
    | SetNodeActiveRequest
    | GetDeviceTreeRequest
    | GetSettingRequest
    | UpdateSettingRequest;

export type AnalogAttachApiResponse =
    | GetAttachedDevicesStateResponse
    | GetDevicesResponse
    | GetPotentialParentNodesResponse
    | SetParentNodeResponse
    | DeleteDeviceResponse
    | GetDeviceConfigurationResponse
    | UpdateDeviceConfigurationResponse
    | SetNodeActiveResponse
    | GetDeviceTreeResponse
    | GetSettingResponse
    | UpdateSettingResponse;

export type AnalogAttachApiNotification =
    | FileChangedNotification
    | NavigateBackNotification
    | NavigateForwardNotification;
