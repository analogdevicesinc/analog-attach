import { UUID } from "node:crypto";

/**
 * Data structures described in {@link ../../../../src/MessageAPI/MessageAPI.md}.
 */
export interface CatalogDevice {
    deviceId: string;
    name: string;
    description: string;
    group?: string;
}

export interface ParentNode {
    uuid: DeviceUID;
    name: string;
    // TODO: Maybe add an option like governmentName
}

export interface DeviceChannelSummary {
    name: string;
    alias: string;
    hasErrors: boolean;
}

export interface AttachedDeviceState {
    type: "AttachedDeviceState";
    compatible: string;
    deviceUID: DeviceUID;
    name: string;
    alias?: string;
    active?: boolean;
    isExpanded?: boolean;
    hasErrors: boolean;
    hasChannels: boolean;
    parentNode: ParentNode;
    maxChannels?: number;
    channels: DeviceChannelSummary[];
}
export type DeviceIdentifier = string;
export type DeviceUID = UUID;

export type FileChangeSource = "external" | "extension";

export interface FileChangeNotificationPayload {
    filePath: string;
    changeSource: FileChangeSource;
}

export interface NumericRangeValidation {
    type: "NumericRangeValidation";
    minValue?: bigint;
    maxValue?: bigint;
}

export interface DropdownValidation {
    type: "DropdownValidation";
    list: Array<string | bigint | boolean>;
}

export interface ArrayBaseValidation {
    minLength?: number;
    maxLength?: number;
}

export interface ArrayNumberValidation extends ArrayBaseValidation {
    type: "ArrayNumberValidation";
    minValue?: bigint;
    maxValue?: bigint;
}

export interface ArrayStringValidation extends ArrayBaseValidation {
    type: "ArrayStringValidation";
    enum?: Array<string | string[]>;
    enumType?: EnumValueType;
}

export type HyperlinkItem = {
    type: "HyperlinkItem";
    name: string;
    gotoUID?: DeviceUID; // if it is undefined, then it cannot be resolved
}

export interface ArrayHyperlinkValidation extends ArrayBaseValidation {
    type: "ArrayHyperlinkValidation";
    enum?: HyperlinkItem[];
}

export type ArrayValidation = ArrayNumberValidation | ArrayStringValidation | ArrayHyperlinkValidation;

export type EnumValueType = "macro" | "string" | "phandle" | "number";

export type MixedArrayStringList = { type: "StringList", enum: string[], enumType?: EnumValueType }
export type MixedArrayNumberList = { type: "NumberList", enum: number[] }
export type MixedArrayNumber = { type: "Number", minValue?: bigint, maxValue?: bigint }
export type MixedTypeValidation = MixedArrayNumber | MixedArrayStringList | MixedArrayNumberList;

export interface ArrayMixedTypeValidation {
    type: "ArrayMixedTypeValidation";
    minPrefixItems: number;
    maxPrefixItems: number;
    prefixItems: MixedTypeValidation[];
}

export interface MatrixValidation {
    minRows?: number;
    maxRows?: number;
    definition: ArrayValidation | ArrayMixedTypeValidation;
}

export interface ConfigurationItemError {
    code: string;
    message: string;
    details?: string;
}

interface BaseFormElement {
    key: string;
    required: boolean;
    description?: string;
    deprecated?: boolean;
    error?: ConfigurationItemError;
}

export interface FlagFormElement extends BaseFormElement {
    type: "Flag";
    setValue?: boolean;
    defaultValue?: boolean;
}

export interface GenericFormElement extends BaseFormElement {
    type: "Generic";
    inputType: "dropdown" | "number" | "text" | "custom" | "custom-flag" | "custom-number" | "custom-phandle";
    setValue?: unknown;
    defaultValue?: unknown;
    validationType?: NumericRangeValidation | DropdownValidation;
}

export interface FormArrayElement extends BaseFormElement {
    type: "FormArray";
    setValue?: unknown[];
    defaultValue?: unknown[];
    validationType?: ArrayValidation | ArrayMixedTypeValidation;
}

export interface FormMatrixElement extends BaseFormElement {
    type: "FormMatrix",
    setValue?: unknown[][];
    defaultValue?: unknown[][];
    validationType?: MatrixValidation;
}

export interface FormObjectElement extends BaseFormElement {
    type: "FormObject";
    config: FormElement[];
    alias?: string;
    active?: boolean;

    // FIXME: Rename this to "name" so it makes sense in the deviceTree message
    // This name has to match one of the regexes provided in the DeviceConfiguration
    channelName?: string;

    // Optional device UID for tree view elements
    deviceUID?: DeviceUID;
}

export type FormElement =
    FlagFormElement |
    GenericFormElement |
    FormArrayElement |
    FormMatrixElement |
    FormObjectElement;

export interface DeviceConfigurationFormObject {
    type: "DeviceConfigurationFormObject";
    alias?: string;
    active?: boolean; // Used for initial read only
    maxChannels?: number;
    config: FormElement[];

    // NOTE: If provided and different from the current parent, the backend
    // will move the node first.
    parentNode: ParentNode;

    // If defined, the current device can have channels if they match the regexes
    channelRegexes?: string[];

    // If defined, this is a list of regexes that match the channelRegexes property
    // to display as a dropdown
    generatedChannelRegexEntries?: string[];

    // In case attach-lib does not find a specific item to connect an error to,
    // this will be the field they are added to
    genericErrors?: ConfigurationItemError[];
}

export interface DeviceConfiguration {
    config: DeviceConfigurationFormObject;
}

export type ConfigTemplatePayload = DeviceConfiguration;
