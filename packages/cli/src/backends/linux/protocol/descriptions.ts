// The Linux subtypes of the `list` responses (interface/backend-responses.ts has the shared ones).

import type {
    DeviceDescription as BaseDeviceDescription,
    ListDevicesResponse as BaseListDevicesResponse,
    PropertyDescription,
} from "../../../interface/backend-responses";
import type { CommonResponse, Suggestion, Types } from "./types";

export type { Device, PropertyDescription } from "../../../interface/backend-responses";

export interface ChildNodeDescription {
    pattern: string;
    /** The pattern's literal start, `channel@N` for `^channel@([0-9]|1[0-5])$`. */
    name: string;
    description?: string;
    properties: PropertyDescription[];
}

/** A device binding: the shared description (`key` is the compatible), plus where it comes from and its child-node patterns. */
export interface DeviceDescription extends BaseDeviceDescription {
    compatible: string;
    /** The binding YAML, absolute. */
    binding: string;
    children: ChildNodeDescription[];
}

/** `list devices [filter]`: the compatibles the filter matches, and the device it names, when it names one. */
export interface ListDevicesResponse extends BaseListDevicesResponse {
    device?: DeviceDescription;
    /** @deprecated The keys of `devices`, kept for one release. */
    names: string[];
}

/** `list property <path>`: the names of what the node's binding allows. */
export interface ListPropertyNamesResponse extends CommonResponse {
    /** Each property's name, then the regex of each property pattern and child-node pattern. */
    names: string[];
    /** @deprecated The same entries with their marks (`compatible (set, required)`), kept for one release. */
    suggestions: Suggestion[];
}

/** `list property <path> <property>`: what the binding says about the property. */
export interface ListPropertyTypeResponse extends CommonResponse {
    property: PropertyDescription;
    /** @deprecated `property.type`, kept for one release. */
    type: Types;
    /** @deprecated `property.description`, kept for one release. */
    description?: string;
    /** @deprecated `property.suggestions`, kept for one release. */
    suggestions?: Suggestion[];
}

export type ListPropertyResponse = ListPropertyNamesResponse | ListPropertyTypeResponse;
