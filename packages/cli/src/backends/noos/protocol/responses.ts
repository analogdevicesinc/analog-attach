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
import type { ErrorType } from "../../../interface/error-types";

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

/** The node or the property, with `ok`, `message` and `severity` alongside (GEN-08). */
export type ReadResponse = CommonResponse & (Node | ReadProperty);

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

/** A board pin: its header position (`J9`, `5`), and the chip pin name the board prints next to it (`P2_0`). */
export interface BoardPinAt {
    connector: string;
    pin: string;
    chip_pin?: string;
}

/**
 * How one part is wired to the board over one bus, as bootstrap worked it out: each pin of the
 * part (on its eval board) to the board pin it goes to. What `Wire <part> to <board> over <bus>:`
 * prints in human mode.
 */
export interface Wiring {
    /** The part, by its eval board (`eval-adxl355-pmdz`). */
    part: string;
    /** The bus device node (`adxl355_spi_dev`). */
    device: string;
    /** The bus, as the part's pin roles name it: spi, i2c. */
    interface: string;
    /** The board bus its lines land on (`bsp_spi1_cfg`), when they agree on one. */
    peripheral?: string;
    connections: { role: string, from: { connector: string, pin: string }, to: BoardPinAt }[];
    /** Wiring that doesn't add up, or that the board alone can't decide. */
    problems: string[];
    /** A bare part (no eval board): the board pins of its bus, for the part's own pins to go to. */
    board_pins?: { signal: string, at: BoardPinAt }[];
    /** When the chip-select isn't settled: free board pins that could carry it. */
    chip_select_options?: { at: BoardPinAt, gpio?: { port: string, number: number } }[];
}

/** How a SPI device's chip-select is driven: a native line of the bus, a GPIO, or not yet. */
export type ChipSelectWiring =
    | { device: string, kind: "native", peripheral: string, native_cs: number, at: BoardPinAt }
    | { device: string, kind: "gpio", gpio: { port: string, number: number }, at: BoardPinAt, pin_node?: string }
    | { device: string, kind: "unwired", reason: string };

export interface AddResponse extends BaseAddResponse {
    missing_required: MissingProperty[];
    /** The wiring bootstrap worked out for what was added; [] when it wired nothing. */
    wiring: Wiring[];
    chip_selects: ChipSelectWiring[];
}

/** update that set a value: the wiring when bootstrap rewired a bus (a comm_type change, say). */
export interface UpdateSetResponse extends CommonResponse {
    wiring?: Wiring[];
    chip_selects?: ChipSelectWiring[];
}

export interface NoosResponses extends Responses {
    "list devices": ListDevicesResponse;
    "list context": ListContextResponse;
    "list property": ListPropertyResponse;
    "add": AddResponse;
    "read": ReadResponse;
    "update": UpdateSetResponse | ReadResponse | SuggestResponse;
}

/** A success; a warning carries its `error_type` (GEN-17). */
export function common_ok(message: string, severity: Severity = "info", error_type?: ErrorType): CommonResponse {
    return { ok: true, message, severity, ...(error_type === undefined ? {} : { error_type }) };
}
