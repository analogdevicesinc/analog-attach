import type { CommonResponse, Suggestion, Types, PropertyValue } from "./types";

export interface TypeDescription {
    type: Types;
    display: string;
    min_items?: number;
    max_items?: number;
    minimum?: number;
    maximum?: number;
    default?: PropertyValue;
    const?: PropertyValue;
}

export interface PropertyDescription {
    name: string;
    description?: string;
    type: TypeDescription;
    required: boolean;
    set?: boolean;
    suggestions?: Suggestion[];
}

export interface ChildNodeDescription {
    pattern: string;
    name: string;
    description?: string;
    properties: PropertyDescription[];
}

export interface DeviceDescription {
    compatible: string;
    title?: string;
    description?: string;
    binding: string;
    properties: PropertyDescription[];
    children: ChildNodeDescription[];
}

export interface ListNamesResponse extends CommonResponse {
    names: string[];
}

export interface DeviceDescriptionResponse extends CommonResponse {
    device: DeviceDescription;
}

export interface PropertyDescriptionResponse extends CommonResponse {
    property: PropertyDescription;
}

export type ListDeviceResponse = ListNamesResponse | DeviceDescriptionResponse;
export type ListPropertyResponse = ListNamesResponse | PropertyDescriptionResponse;
