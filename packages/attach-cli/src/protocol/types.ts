export type Severity = "info" | "warn" | "error";

export interface CommonResponse {
    ok: boolean;
    message: string;
    severity: Severity;
}

export interface Config {
    field_name: string;
    category?: string;
    description: string;
    type: "numeric" | "string" | "bool" | "path" | ConfigEnum;
    required: boolean;
    default: string | number | boolean | null;
}

export interface ConfigEnum {
    options: (string | number)[];
}

export interface ToolConfigResponse extends CommonResponse {
    configs: Config[];
}

export interface CreateWorkfileResponse extends CommonResponse {
    path: string;
}

export interface Device {
    tag: string;
    key: string;
}

export interface ListDevicesResponse extends CommonResponse {
    devices: Device[];
}

export interface AddResponse extends CommonResponse {
    key: string;
    path: string[];
}

export type PropertyValue = null | string | number | boolean | PropertyValue[];

export type Types =
    | { kind: "number"; subtype: "int" | "float" }
    | { kind: "string" }
    | { kind: "bool" }
    | { kind: "enum"; options: { value: string | number; display_string?: string }[] }
    | { kind: "array"; items: Types }
    | { kind: "tuple"; items: Types[] };

export interface Property {
    kind: "property";
    key: string;
    type: Types;
    value: PropertyValue;
}

export interface Node {
    kind: "node";
    key: string;
    properties: Property[];
    children: Node[];
    alias?: string[];
}

export type ReadResponse = Node | Property;

export interface DeletePreview extends CommonResponse {
    node_count: number;
    property_count: number;
    paths: string[][];
}

export type DeleteResponse = CommonResponse | DeletePreview;

export interface ValidationError {
    kind: "generic";
    path: string[];
    message: string;
}

export interface ValidationResponse {
    errors: ValidationError[];
    warnings: ValidationError[];
}

export interface IntelligenceArgument {
    name: string;
    description: string;
    required: boolean;
    kind?: string;
}

export interface Intelligence {
    kind: string;
    args: IntelligenceArgument[];
}

export interface ListIntelligenceResponse extends CommonResponse {
    intelligence: Intelligence[];
}

export interface Suggestion {
    value: string;
    display_string?: string;
}

export interface SuggestResponse extends CommonResponse {
    suggestions: Suggestion[];
}
