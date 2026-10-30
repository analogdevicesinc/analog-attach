// The --json responses of the no-OS backend: the shared base shapes
// (interface/backend-responses.ts), narrowed where no-OS says more, in `NoosResponses`.

import type {
    AddResponse as BaseAddResponse,
    CommonResponse,
    ListDevicesResponse as BaseListDevicesResponse,
    MissingProperty as BaseMissingProperty,
    Node as BaseNode,
    Property as BaseProperty,
    ReadProperty as BaseReadProperty,
    Responses,
    Severity,
    Suggestion,
    SuggestResponse,
} from "../../../interface/backend-responses";

export type {
    BuildResponse,
    CommonResponse,
    DeletePreview,
    ImportResponse,
    InitResponse,
    Property,
    PropertyType,
    PropertyValue,
    Severity,
    SetupResponse,
    Suggestion,
    SuggestResponse,
    ValidationFinding,
    ValidationResponse,
} from "../../../interface/backend-responses";

/**
 * Where a node comes from: stored in the workfile (`internal`), or a board or driver
 * resource the workfile only names - a BSP config, the handle wrapping it, an ops table -
 * which is never stored (`external`).
 */
export type NodeOrigin = "internal" | "external";

/** Who set a value: the user (cleared included), or bootstrap following the rules. */
export type ValueSource = "user" | "bootstrap";

/** A property of a node, with who set its value when it has one. */
export interface NodeProperty extends BaseProperty {
    source?: ValueSource;
}

/** Reading a node always returns its full subtree. */
export interface Node extends BaseNode<NodeProperty> {
    origin: NodeOrigin;
    children: Node[];
    /** Other names for the node. None yet: always empty. */
    alias: string[];
}

/**
 * One property read on its own: the property, what its schema says of it, and what it can
 * be set to. `definition` is the schema's property type (`include`, `driver_init_param`).
 */
export interface ReadProperty extends BaseReadProperty {
    required: boolean;
    source?: ValueSource;
    definition: string;
    suggestions: { values: Suggestion[]; can_create: Suggestion[] };
}

export type ReadResponse = Node | ReadProperty;

/** `tag` groups entries for display; `key` is what `add` takes. */
export interface Device {
    tag: string;
    key: string;
}

export interface ListDevicesResponse extends BaseListDevicesResponse {
    devices: Device[];
}

export interface ListedPlatform {
    name: string;
    vendor: string;
    description?: string;
    boards: string[];
}

export interface ListedBoard {
    name: string;
    /** The chip the board carries, which is what the `platform` setting names. */
    platform?: string;
    vendor?: string;
    description?: string;
}

/** `list context`: every chip, with the boards carrying it, and every board. */
export interface ListContextResponse extends CommonResponse {
    platforms: ListedPlatform[];
    boards: ListedBoard[];
}

/**
 * `list property [node]`: the node names, or a node's property names (the base's `names`).
 * `suggestions` is what no-OS answered before, with a display string each.
 */
export interface ListPropertyResponse extends CommonResponse {
    names: string[];
    /** Deprecated: the entries of `names`, each with what it is. */
    suggestions: Suggestion[];
}

/** A required value still empty: on the added node or on one bootstrap made for it. */
export interface MissingProperty extends BaseMissingProperty {
    /** The node it belongs to. */
    node: string;
}

export interface AddResponse extends BaseAddResponse {
    missing_required: MissingProperty[];
}

export interface NoosResponses extends Responses {
    "list devices": ListDevicesResponse;
    "list context": ListContextResponse;
    "list property": ListPropertyResponse;
    "add": AddResponse;
    "read": ReadResponse;
    "update": CommonResponse | ReadResponse | SuggestResponse;
}

export function common_ok(message: string, severity: Severity = "info"): CommonResponse {
    return { ok: true, message, severity };
}
