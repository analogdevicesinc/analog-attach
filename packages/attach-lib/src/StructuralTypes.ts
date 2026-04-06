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

export function is_attach_array(object: AttachType): object is AttachArray {

    switch (object._t) {
        case "array":
        case "number_array":
        case "string_array":
        case "enum_array":
        case "fixed_index":
            {
                return true;
            }
        case "matrix":
        case "integer":
        case "object":
        case "boolean":
        case "enum_integer":
        case "const":
        case "generic":
            {
                return false;
            }
        default:
            {
                const _x: never = object;
                throw new Error("Failed exhaustive check!");
            }
    }
}

export function to_attach_array(resolved_property: ResolvedProperty): AttachArray | undefined {

    if (is_attach_array(resolved_property.value)) {
        return resolved_property.value;
    }

    return undefined;
}

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