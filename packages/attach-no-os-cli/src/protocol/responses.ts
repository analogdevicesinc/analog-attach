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
 * Composed into every response except ReadResponse and ValidationResponse. `ok` is the
 * only semantic gate: attach-meta exits 1 when it is false, but the process itself must
 * still exit 0 (a non-zero exit is a *transport* error, which is a different, louder
 * failure mode owned by attach-meta).
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
 * `additionalProperties: false` — there is nowhere to put `description`, `required`,
 * `default`, or numeric bounds. That information reaches the user through `suggest`
 * and through the human (non-`--json`) rendering instead.
 */
export interface Property {
    kind: "property";
    key: string;
    type: PropertyType;
    value: PropertyValue;
}

/** Reading a node always returns its full subtree. */
export interface Node {
    kind: "node";
    key: string;
    properties: Property[];
    children: Node[];
    /** Omitted: we do not declare `alias` in the manifest. */
    alias?: string[];
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
 * success signal. We always validate the whole workfile; attach-meta filters by path.
 */
export interface ValidationResponse {
    errors: ValidationError[];
    warnings: ValidationError[];
}

export interface IntelligenceArg {
    name: string;
    description: string;
    required: boolean;
    /** A suggest kind, so completion can recurse into this argument. */
    kind?: string;
}

export interface Intelligence {
    kind: string;
    args: IntelligenceArg[];
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

// --- Constructors ---

export function common_ok(message: string, severity: Severity = "info"): CommonResponse {
    return { ok: true, message, severity };
}

export function common_error(message: string): CommonResponse {
    return { ok: false, message, severity: "error" };
}

/**
 * What we send when a `read` fails.
 *
 * ReadResponse is `oneOf [Node, Property]`, both closed, so a failed read has no
 * schema-legal shape. attach-meta does not validate responses against the schema; it
 * looks for `ok` to decide its own exit code. So a CommonResponse here degrades
 * gracefully (the user gets the message and a non-zero attach-meta exit) instead of
 * looking like an empty node.
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
