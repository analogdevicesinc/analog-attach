// The Linux backend's --json responses: the shared shapes of interface/backend-responses.ts,
// and the Linux subtypes (more fields, narrower types) in `LinuxResponses`.

import type {
    BuildResponse as BaseBuildResponse,
    CommonResponse,
    InitResponse as BaseInitResponse,
    PropertyConstraints,
    PropertySuggestions,
    PropertyType,
    PropertyValue,
    Responses,
    Suggestion,
    SuggestResponse,
} from "../../../interface/backend-responses";
import type { ListContextResponse, ListDevicesResponse, ListPropertyResponse } from "./descriptions";

export type { CommonResponse, PropertyConstraints, PropertySuggestions, PropertyValue, Severity, Suggestion, SuggestResponse } from "../../../interface/backend-responses";

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

/** A command whose workspace doesn't load (COM-071): a refusal that names each problem. */
export interface ConfigRefusal extends CommonResponse {
    ok: false;
    errors: { field: string; kind: "missing" | "invalid" | "unknown"; message: string; description?: string }[];
    hints: string[];
}

export interface ToolConfigResponse extends CommonResponse {
    configs: Config[];
}

/** `init`: the workspace it set up. `path` and `created` are the shared ones. */
export interface InitResponse extends BaseInitResponse {
    linux: string;
    devicetree: string;
    /** @deprecated The workfile, absolute: the same as `path`, kept for one release. */
    overlay: string;
}

export interface AddResponse extends CommonResponse {
    key: string;
    path: string[];
    /** What the node started from: `required`, `example:<N>` or `overlay:<name>`. */
    template: string;
    /** Required properties the node still lacks, in the order to set them (dependencies first). */
    missing_required: MissingProperty[];
    /** With --template example:<N> or overlay:<name>: the references in the copied node that name nothing in the base or overlay. */
    unresolved?: UnresolvedEntry[];
}

/** `update <path> <child-name>` when it creates the child node. */
/** `update`: a property set, a child node created (`UpdateChildResponse`), a read (`ReadResponse`), or the values `--suggest` lists (`ListValueResponse`). */
export type UpdateResponse = CommonResponse | UpdateChildResponse | ReadResponse | ListValueResponse;

/** `list value` (and `update --suggest`): the values, then the providers the user can add instead, when there are any. */
export interface ListValueResponse extends SuggestResponse {
    can_create?: Suggestion[];
}

export interface UpdateChildResponse extends CommonResponse {
    path: string[];
    /** Required properties the child still lacks, in the order to set them. */
    missing_required: MissingProperty[];
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

/** `min_items` / `max_items` of an array: how many values (cells) the binding allows, when it says: value arrays, and interrupts once the interrupt-parent is known. */
export type Types = PropertyType;

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

/** Where a value `read` shows is set: the base devicetree, or the overlay (which may override the base). */
export type ValueSource = "base" | "overlay";

export interface ReadProperty extends Property {
    source: ValueSource;
}

/**
 * A node as the base and the overlay together have it. `origin` is "internal"
 * when the overlay adds or changes it, "external" when only the base has it.
 * A child the overlay doesn't reach is a base node given by its name and
 * labels only, with no properties or children: `read` on its path shows the
 * rest.
 */
export interface ReadNode extends Omit<Node, "properties" | "children"> {
    properties: ReadProperty[];
    children: ReadNode[];
    origin: "internal" | "external";
}

/**
 * `read` without a path: the overlay's fragments' content as written, under `/`.
 * Every node is the workfile's (`origin: "internal"`), its values unmarked.
 */
export interface OverlayNode extends Omit<Node, "children"> {
    children: OverlayNode[];
    origin: "internal";
}

/** One property read on its own: what the binding says of it, when the node has a binding. */
export interface ReadPropertyDetails extends ReadProperty {
    description?: string;
    required?: boolean;
    constraints?: PropertyConstraints;
    /** The binding file the property's definition comes from (`adi,ad7124.yaml`). */
    definition?: string;
    suggestions?: PropertySuggestions;
}

/** The node or the property, with `ok`, `message` and `severity` alongside (GEN-08). */
export type ReadResponse = CommonResponse & (ReadNode | OverlayNode | ReadPropertyDetails);

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

export interface ValidationResponse extends CommonResponse {
    errors: ValidationError[];
    warnings: ValidationError[];
    /** With `--full`: the merged tree's findings on what the overlay doesn't touch, left out. */
    base_findings?: number;
}

export interface ListOverlayResponse extends CommonResponse {
    /** Compatible ones first, then unknown, then incompatible; within each, overlays with the compatible itself before those with another of its binding (`matched`). */
    overlays: OverlayDescription[];
}

export interface ImportResponse extends CommonResponse {
    /** The new workfile, now the configured overlay. */
    path: string;
    /** The imported overlay source. */
    source: string;
    /** The overlay configured before, which the new workfile replaces as the configured one (the file is kept). */
    replaced?: string;
    /** How the overlay's root compatible fits the base's, as in `list overlay`. */
    fit: "compatible" | "incompatible" | "unknown";
    reason: string;
    /** The fragments whose target names no node of the base or the overlay. */
    unresolved_targets: UnresolvedTargetEntry[];
    /** The references in the fragments that name nothing in the base or overlay. */
    unresolved: UnresolvedEntry[];
}

export interface UnresolvedTargetEntry {
    /** The fragment's node name, e.g. `fragment@0`. */
    fragment: string;
    property: "target" | "target-path";
    /** The label (without `&`) or the path. */
    target: string;
}

export interface OverlayDescription {
    /** The file name, which `import` takes. */
    name: string;
    /** Absolute path. */
    path: string;
    /** How the overlay's root compatible fits the base's. */
    fit: "compatible" | "incompatible" | "unknown";
    reason: string;
    /** Only when the overlay doesn't add the asked compatible itself: the other compatible of the same binding it adds. */
    matched?: string;
}

export interface TypeResponse extends CommonResponse {
    type: Types;
    description?: string;
    /** Concrete values offered by intelligence layers, ready for `update`. */
    suggestions?: Suggestion[];
}

export interface BuildResponse extends BaseBuildResponse {
    /** The compiled `.dtbo` (the `.dtb` with output `full`), absolute: always after dtc, after `build-command` only when it wrote one there. */
    path?: string;
    /** With output `full`, after dtc: the full devicetree source compiled into `path`, absolute. */
    source?: string;
}

export interface DeployResponse extends CommonResponse {
    /** `deploy-ip`; absent when `deploy-command` deployed. */
    host?: string;
    /** `/boot/overlays/`, or `/boot/devicetree.dtb` with output `full`; absent when `deploy-command` deployed. */
    remote_path?: string;
}

/** The Linux backend's responses: the shared map, with the Linux subtypes of the commands ported so far. */
export interface LinuxResponses extends Responses {
    "init": InitResponse;
    "list devices": ListDevicesResponse;
    "list context": ListContextResponse;
    "list property": ListPropertyResponse;
    "list value": ListValueResponse;
    "add": AddResponse;
    "import": ImportResponse;
    "read": ReadResponse;
    "update": UpdateResponse;
    "delete": DeleteResponse;
    "validate": ValidationResponse;
    "build": BuildResponse;
    "deploy": DeployResponse;
}
