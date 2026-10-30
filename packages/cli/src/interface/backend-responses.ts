/**
 * The --json responses of the commands, shared by the `analog-attach` front end and the
 * ecosystem backends (linux, noos). Imported by backend-interface.ts.
 *
 * See packages/cli/docs/merged-cli-design.md.
 */

// The base shapes. A backend may return a subtype (more fields, narrower types): its own
// map extends `Responses`, and its schemas in docs/spec/04-protocol extend the base ones
// with `allOf`. Where the two CLIs disagree today, the base below is a choice, marked
// ALIGN; merged-cli-design.md lists them.
//
// Optional or required: a field is required where both backends always have it, optional
// where either may lack it.
//
// Where a base renames or reshapes a field that a backend's old CLI (attach-linux,
// attach-noos) answered with, that backend's subtype keeps the old field too, `deprecated`
// in its schema, for one release.

export type Severity = "info" | "warn" | "error";

/** In every response except `read` and `validate`. `ok: false` is a refusal: the command ran and said no (exit 0, D-06). */
export interface CommonResponse {
    ok: boolean;
    message: string;
    severity: Severity;
}

export type PropertyValue = null | string | number | boolean | PropertyValue[];

export type PropertyType =
    | { kind: "number"; subtype: "int" | "float" }
    | { kind: "string" }
    | { kind: "bool" }
    | { kind: "enum"; options: { value: string | number; display_string?: string }[] }
    | { kind: "array"; items: PropertyType; min_items?: number; max_items?: number }
    | { kind: "tuple"; items: PropertyType[] };

export interface Property {
    kind: "property";
    key: string;
    type: PropertyType;
    value: PropertyValue;
}

/** A value ready for `update`, or a name ready for the command line. */
export interface Suggestion {
    value: string;
    display_string?: string;
    /** Why it is offered, or why it is not the first choice (`disabled`). */
    note?: string;
    /** The start of a name, to be typed on (`fan-`): completion adds no space after it. */
    partial?: boolean;
    /** The heading it is listed under in completion (`set`, `not set`). */
    group?: string;
}

/**
 * What a property can be set to. ALIGN: no-OS has `string[]` for both lists, Linux has
 * `Suggestion[]`; the base takes Linux's, since a plain value is a `Suggestion` with no extras.
 * ALIGN: `can_create` is optional, as on Linux, which leaves it out when nothing can be added.
 */
export interface PropertySuggestions {
    values: Suggestion[];
    can_create?: Suggestion[];
}

/**
 * A node as `read` shows it. `origin` is the backend's word for where the node lives
 * (Linux: `base` / `overlay` / `both`; no-OS: `internal` / `external`), so the base type
 * only says it is there.
 */
export interface Node<P extends Property = Property> {
    kind: "node";
    key: string;
    properties: P[];
    children: Node<P>[];
    origin: string;
    /** ALIGN: required (always `[]`) on no-OS, optional on Linux. */
    alias?: string[];
}

/** What a definition says a value may be, when it says. */
export interface PropertyConstraints {
    default?: unknown;
    minimum?: number | bigint;
    maximum?: number | bigint;
}

/**
 * One property read on its own. `source` and `definition` are in the backend's words, like
 * a node's `origin`: Linux `base` / `overlay` and the binding file; no-OS `user` /
 * `bootstrap` and the schema's property type.
 */
export interface ReadProperty extends Property {
    description?: string;
    required?: boolean;
    source?: string;
    constraints?: PropertyConstraints;
    definition?: string;
    suggestions?: PropertySuggestions;
}

export type ReadResponse = Node | ReadProperty;

/**
 * ALIGN: Linux answers `{ linux, devicetree, overlay, created }`, no-OS `{ path }`. The base
 * is the workfile and whether `init` made it; a backend adds what else it checked. Linux's
 * subtype keeps `overlay` (the same as `path`) as deprecated for one release.
 */
export interface InitResponse extends CommonResponse {
    /** The workfile, absolute. */
    path: string;
    /** False when the configured workfile already existed and was kept. */
    created: boolean;
}

export interface Device {
    /** What `add` takes: a compatible on Linux, a schema key on no-OS. */
    key: string;
    /** The group it is listed under (no-OS: `drivers`, `boards`). */
    tag?: string;
    title?: string;
}

/** One device in full: what `list devices <filter>` adds when the filter names exactly one. */
export interface DeviceDescription {
    key: string;
    title?: string;
    description?: string;
    properties: PropertyDescription[];
}

/**
 * ALIGN: no-OS answers `devices: Device[]`, Linux `names: string[]`, or `device` alone when
 * `list devices <compatible>` names one. With C-04's `list devices [filter]`, the base is
 * no-OS's list, plus `device` when the filter names exactly one device (Linux's field, so
 * the description keeps its name; no-OS may leave it out). Linux's subtype keeps `names`
 * (the keys of `devices`) as deprecated for one release, and its `device` adds
 * `compatible`, `binding` and `children`.
 */
export interface ListDevicesResponse extends CommonResponse {
    devices: Device[];
    device?: DeviceDescription;
}

/**
 * What a workfile can be made for. No-OS: the platforms and boards. Linux (C-05, not built
 * yet): the .dts files of the tree. Nothing is common but the response, so the base has no
 * fields and each backend says what it lists.
 */
export type ListContextResponse = CommonResponse;

export interface PropertyDescription {
    name: string;
    description?: string;
    type: PropertyType;
    /** As the type is printed: `number[2]`, `enum`. */
    display: string;
    required: boolean;
    set?: boolean;
    default?: PropertyValue;
    suggestions?: Suggestion[];
}

/**
 * ALIGN: no-OS answers `list property [node]` with `suggestions: Suggestion[]` (the node
 * names, or a node's property names), Linux `list property <path> [property]` with
 * `names: string[]` or one `property: PropertyDescription`. The base is Linux's.
 */
export type ListPropertyResponse =
    | (CommonResponse & { names: string[] })
    | (CommonResponse & { property: PropertyDescription });

export interface SuggestResponse extends CommonResponse {
    suggestions: Suggestion[];
}

export interface MissingProperty {
    property: string;
    description?: string;
    suggestions: Suggestion[];
}

export interface AddResponse extends CommonResponse {
    key: string;
    path: string[];
    /** Required properties the node still lacks, in the order to set them; `[]` when none. ALIGN: required, as on Linux. */
    missing_required: MissingProperty[];
}

export interface ImportResponse extends CommonResponse {
    /** The new workfile, absolute; it is now the configured one. */
    path: string;
    /** What it was made from, absolute. */
    source: string;
}

/** `update` sets a value (`CommonResponse`), creates a child node, or reads when given no value. */
export type UpdateResponse =
    | CommonResponse
    | (CommonResponse & { path: string[]; missing_required: MissingProperty[] })
    | ReadResponse;

/** Without `--force`, a delete that reaches more than its target only says what it would remove. */
export interface DeletePreview extends CommonResponse {
    node_count: number;
    property_count: number;
    paths: string[][];
}

export type DeleteResponse = CommonResponse | DeletePreview;

export interface ValidationFinding {
    kind: "generic";
    /** `[]`: the workfile as a whole. */
    path: string[];
    message: string;
}

/** No `ok`: an empty `errors` is the success. */
export interface ValidationResponse {
    errors: ValidationFinding[];
    warnings: ValidationFinding[];
}

export interface BuildResponse extends CommonResponse {
    /** The artifact, when there is one. */
    path?: string;
}

export type DeployResponse = CommonResponse;

/** The response of each shared command. A backend's own map extends it with subtypes. */
export interface Responses {
    "init": InitResponse;
    "list devices": ListDevicesResponse;
    "list context": ListContextResponse;
    "list property": ListPropertyResponse;
    "list value": SuggestResponse;
    "add": AddResponse;
    "import": ImportResponse;
    "read": ReadResponse;
    "update": UpdateResponse;
    "delete": DeleteResponse;
    "rename": CommonResponse;
    "validate": ValidationResponse;
    "build": BuildResponse;
    "deploy": DeployResponse;
}

export interface SetupResponse extends CommonResponse {
    /** The settings it wrote. */
    saved: string[];
    /** Whether `init` can run now; the bare `analog-attach` runs it when so (C-01). */
    ready: boolean;
}
