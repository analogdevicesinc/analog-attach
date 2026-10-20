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
    value: string | number | boolean | null;
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

export interface AddResponse extends CommonResponse {
    key: string;
    path: string[];
    /** Required properties the node still lacks, in the order to set them (dependencies first). */
    missing_required: MissingProperty[];
    /** With --from-example: the references in the copied node that name nothing in the base or overlay. */
    unresolved?: UnresolvedEntry[];
}

export interface UnresolvedEntry {
    path: string[];
    property: string;
    /** As written: `&label` or `&{/path}`. */
    reference: string;
}

export interface MissingProperty {
    property: string;
    description?: string;
    /** Values ready for `update`, as in `list value`. */
    suggestions: Suggestion[];
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

export type ReadResponse =
    | (Node & { missing_required?: string[] })
    | (Property & { description?: string; suggestions?: Suggestion[] });

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
    description: string;
    args: IntelligenceArgument[];
}

export interface ListOverlayResponse extends CommonResponse {
    /** Compatible ones first, then unknown, then incompatible. */
    overlays: OverlayDescription[];
}

export interface OverlayDescription {
    /** The file name, which `import` takes. */
    name: string;
    /** Absolute path. */
    path: string;
    /** How the overlay's root compatible fits the base's. */
    fit: "compatible" | "incompatible" | "unknown";
    reason: string;
}

export interface ListIntelligenceResponse extends CommonResponse {
    intelligence: Intelligence[];
}

export interface Suggestion {
    value: string;
    display_string?: string;
    note?: string;
    /** The start of a name, to be typed on (a binding pattern's stem, e.g. `fan-`). */
    partial?: boolean;
}

export interface SuggestResponse extends CommonResponse {
    suggestions: Suggestion[];
}

export interface TypeResponse extends CommonResponse {
    type: Types;
    description?: string;
    /** Concrete values offered by intelligence layers, ready for `update`. */
    suggestions?: Suggestion[];
}

export interface BuildResponse extends CommonResponse {
    path: string;
}

export interface DeployResponse extends CommonResponse {
    host: string;
    remote_path: string;
}
