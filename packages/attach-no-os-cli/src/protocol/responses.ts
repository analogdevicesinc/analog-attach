/**
 * The attach-meta response types, mirroring aa-meta/docs/schemas/responses.schema.json.
 *
 * Every one of these is `additionalProperties: false` (or `unevaluatedProperties: false`)
 * on the aa-meta side, so a stray field is a protocol violation rather than a harmless
 * extra. That is why these are exact interfaces and not `Record<string, unknown>` — the
 * compiler is the only thing standing between us and a response attach-meta rejects.
 *
 * Two shapes deliberately have no failure variant in the schema: ReadResponse (oneOf
 * Node | Property) and ValidationResponse. See `read_failure` and `validation_failure`
 * below for what we send instead.
 */

// --- CommonResponse ---

/** Display hint for `message`. Note `warn`, not `warning` — the enum is exact. */
export type Severity = "info" | "warn" | "error";

/**
 * Composed into every response except ReadResponse and ValidationResponse. `ok` is what
 * says whether the command did what was asked: the process exits 0 either way, since it
 * ran (a non-zero exit means the CLI itself could not run the command).
 */
export interface CommonResponse {
    ok: boolean;
    message: string;
    severity: Severity;
}

// --- Property types (TYPES) ---

export type NumberSubtype = "int" | "float";

export interface NumberType { kind: "number"; subtype: NumberSubtype }
export interface StringType { kind: "string" }
export interface BoolType { kind: "bool" }

export interface EnumOption {
    value: string | number;
    display_string?: string;
}

export interface EnumType { kind: "enum"; options: EnumOption[] }

/** Variable-length, every item the same type. */
export interface ArrayType { kind: "array"; items: PropertyType }

/**
 * Fixed-length, each position independently typed. This is how a union property is
 * expressed: `[enum(member names), <type of the selected member>]`.
 */
export interface TupleType { kind: "tuple"; items: PropertyType[] }

export type PropertyType =
    | NumberType
    | StringType
    | BoolType
    | EnumType
    | ArrayType
    | TupleType;

/**
 * Note the absence of `object`: a property value can never be a JSON object. Our union
 * properties are `{member: value}` internally and so must be flattened to a tuple on
 * the way out (see src/protocol/convert.ts).
 */
export type PropertyValue = null | string | number | boolean | PropertyValue[];

/**
 * A property's name, type and value. Its description, whether it is required, its default
 * and its bounds are in the human (non-`--json`) rendering; what it can be set to comes
 * with a single property read (ReadProperty) and from `list value`.
 */
export interface Property {
    kind: "property";
    key: string;
    type: PropertyType;
    value: PropertyValue;
}

/**
 * Where a node comes from: stored in the workfile (`internal`), or a board or driver
 * resource the workfile only names - a BSP config, the handle wrapping it, an ops table -
 * which is never stored (`external`).
 */
export type NodeOrigin = "internal" | "external";

/** Reading a node always returns its full subtree. */
export interface Node {
    kind: "node";
    key: string;
    properties: Property[];
    children: Node[];
    origin: NodeOrigin;
    /** Other names for the node. None yet: always empty. */
    alias: string[];
}

/** What a property can be set to: existing values, and the kinds of node that could be created. */
export interface PropertySuggestionLists {
    values: string[];
    can_create: string[];
}

/** One property read on its own: the property, and what it can be set to. */
export interface ReadProperty extends Property {
    suggestions: PropertySuggestionLists;
}

// --- Config ---

export interface ConfigEnum {
    options: (string | number)[];
}

export type ConfigType = "numeric" | "string" | "bool" | "path" | ConfigEnum;

/**
 * A tool configuration field.
 *
 * `default` and `value` are two different things and both are required: `default` is the
 * schema-declared fallback (`null` when the field has none), `value` is what is stored
 * right now (`null` when nothing is). attach-meta's `init` derives `missing_fields` from
 * `required && value === null`, and the protocol asks a tool to pre-populate a required
 * field that has a default so `value` reads as usable from the first call — which is why
 * `value` carries the *effective* value rather than only an explicitly written one.
 *
 * Both members are non-optional on purpose: attach-meta deserializes `Config` into a
 * struct with no serde defaults, so omitting either makes the whole `tool-config-get`
 * response unparseable and `init` silently concludes the config is complete.
 */
export interface Config {
    field_name: string;
    category?: string;
    description: string;
    type: ConfigType;
    required: boolean;
    default: string | number | boolean | null;
    value: string | number | boolean | null;
}

// --- Per-command responses ---

export interface ToolConfigResponse extends CommonResponse {
    configs: Config[];
}

export interface CreateWorkfileResponse extends CommonResponse {
    /** Absolute path to the created workfile. */
    path: string;
}

export interface ImportResponse extends CommonResponse {
    /** Absolute path to the workfile it was copied to. */
    path: string;
    /** Absolute path to the file it was copied from. */
    source: string;
}

/** `tag` groups entries for display; `key` is what `add --key` takes. */
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

export type ReadResponse = Node | Property;

/**
 * Returned by `delete` without `--force` when the target is not a leaf. Nothing is
 * written; attach-meta discriminates it from a plain CommonResponse by `node_count`.
 */
export interface DeletePreview extends CommonResponse {
    node_count: number;
    property_count: number;
    paths: string[][];
}

export type DeleteResponse = CommonResponse | DeletePreview;

/** A validation finding. `path: []` means the finding is about the file as a whole. */
export interface ValidationError {
    kind: "generic";
    path: string[];
    message: string;
}

/**
 * No `ok` field, and `additionalProperties: false` — an empty `errors` array *is* the
 * success signal. The whole workfile is always validated; a caller filters by path.
 */
export interface ValidationResponse {
    errors: ValidationError[];
    warnings: ValidationError[];
}

export interface Suggestion {
    value: string;
    display_string?: string;
}

export interface SuggestResponse extends CommonResponse {
    suggestions: Suggestion[];
}

/** A build: where the artifact it produced is, when there is one. */
export interface BuildResponse extends CommonResponse {
    path?: string;
}

// --- Constructors ---

export function common_ok(message: string, severity: Severity = "info"): CommonResponse {
    return { ok: true, message, severity };
}

export function common_error(message: string): CommonResponse {
    return { ok: false, message, severity: "error" };
}

/**
 * What we send when a `read` fails: a node or a property has no way to say "not found", so
 * a failed read is a CommonResponse with `ok: false` instead of something that would look
 * like an empty node.
 */
export function read_failure(message: string): CommonResponse {
    return common_error(message);
}

/**
 * What we send when `validate` cannot even load the workfile. Unlike `read`, this one
 * *is* schema-legal: a file-level finding is exactly what `path: []` is for.
 */
export function validation_failure(message: string): ValidationResponse {
    return { errors: [{ kind: "generic", path: [], message }], warnings: [] };
}
