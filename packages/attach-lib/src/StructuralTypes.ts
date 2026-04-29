import { ResolvedProperty } from "./AttachTypes";

type AttachGenericArray = {
    _t: "array",
    minItems: number,
    maxItems: number,
    description?: string,
}

type AttachNumberArray = {
    _t: "number_array",
    minItems: number,
    maxItems: number,
    description?: string,
    minimum: bigint,
    maximum: bigint,
    typeSize?: number,
}

type AttachStringArray = {
    _t: "string_array",
    minItems: number,
    maxItems: number,
    description?: string,
    unique_items: boolean,
}

type AttachEnumArray = {
    _t: "enum_array",
    minItems: number,
    maxItems: number,
    description?: string,
    default?: any,
    enum: any[],
    enum_type: AttachEnumType,
}

export enum AttachEnumType {
    PHANDLE = "phandle",
    MACRO = "macro",
    STRING = "string",
    NUMBER = "number",
}

export type FixedIndex =
    {
        _t: "enum",
        enum: any[],
        default?: any,
        enum_type: AttachEnumType
    } |
    {
        _t: "number",
        minimum?: bigint,
        maximum?: bigint
    };

type AttachFixedIndexArray = {
    _t: "fixed_index",
    description?: string,
    prefixItems: FixedIndex[],
    minItems: number,
    maxItems: number,
}

export type AttachArray = AttachGenericArray | AttachNumberArray | AttachStringArray | AttachEnumArray | AttachFixedIndexArray;

type AttachMatrix = {
    _t: "matrix",
    minItems: number,
    maxItems: number,
    description?: string,
    values: AttachArray[],
}

type AttachBoolean = {
    _t: "boolean",
    description?: string,
}

type AttachInteger = {
    _t: "integer",
    description?: string,
    maximum?: bigint,
    minimum?: bigint,
    default?: bigint,
    typeSize?: number
}

type AttachEnumInteger = {
    _t: "enum_integer",
    description?: string,
    default?: bigint,
    enum: bigint[],
    typeSize?: number,
}

type AttachConst = {
    _t: "const",
    description?: string,
    const: any,
}

type AttachGeneric = {
    _t: "generic",
    description?: string,
}

type AttachObject = {
    _t: "object",
    description?: string,
    properties: ResolvedProperty[],
}

export type AttachType =
    AttachArray |
    AttachMatrix |
    AttachBoolean |
    AttachInteger |
    AttachEnumInteger |
    AttachConst |
    AttachGeneric |
    AttachObject;