// A board description records how an add-on board (HAT, cape, shield, …)
// wires peripherals to its host: which bus(es) each slot sits on and which
// host GPIOs carry its chip-select/interrupt/reset/gpio lines. Anything
// derivable from that (a bus's chip-select table, GPIO usage, slots that
// exclude each other) is computed, not stored — see derived.ts.
// Plain arrays/objects throughout so it serialises to JSON unchanged.

export const SIGNAL_KINDS = ["interrupt", "reset", "chip-select", "gpio"] as const;
export type SignalKind = typeof SIGNAL_KINDS[number];

export const BUS_TYPES = ["spi", "i2c"] as const;
export type BusType = typeof BUS_TYPES[number];

export type BoardSignal = {
    /** Key in the slot's `signals` map, e.g. "int". */
    name: string;
    kind: SignalKind;
    /** Line offset on the board's `gpio_controller`. */
    gpio: number;
    /** Chip-select index on the slot's SPI bus (chip-select signals only). */
    reg?: number;
    /** False when a jumper leaves the line unconnected by default. */
    connected: boolean;
    /** The jumper that connects the line, e.g. "JP17". */
    jumper?: string;
    /** Known line polarity; when absent it depends on the peripheral. */
    active?: "high" | "low";
    open_drain: boolean;
};

/** A chip select of a bus, derived from the slots' chip-select signals. */
export type BoardChipSelect = {
    reg: number;
    /** The GPIO wired by default (the first connected user's, else the first user's). */
    gpio: number;
    /** `<slot>.<signal>` references of the slots that use this chip select on `gpio`. */
    users: string[];
    /** False when every user's line is left unconnected by default. */
    connected: boolean;
    /** The jumper that connects it, when it isn't connected by default. */
    jumper?: string;
    /** Same `reg` routed to another GPIO by a jumper (only the `cs-gpios` entry changes). */
    alternatives?: { gpio: number, user: string, jumper?: string }[];
};

export type BoardBus = {
    /** Key in the `buses` map, e.g. "spi0". */
    name: string;
    /** Label reference to the host node, e.g. "&spi0". Defaults to `&<name>`. */
    node: string;
    type: BusType;
    /** Host GPIOs the bus lines use, e.g. `{ name: "sclk", gpio: 11 }`, in file order. */
    pins: { name: string, gpio: number }[];
    reserved_addresses: { address: number, description: string }[];
};

export type BoardSlot = {
    /** Key in the `slots` map, e.g. "spi_pmod1". */
    id: string;
    /** Names of the buses (keys in `buses`) the slot can sit on; the first is the default. */
    buses: string[];
    /** What selects between `buses` (e.g. a switch reference), when there are several. */
    selected_by?: string;
    /** Label reference to the soldered-on device occupying the slot, a node of the board's `overlay`. */
    onboard?: string;
    /** Chip-select signals apply on the slot's SPI bus; the first one is the slot's primary `reg`. */
    signals: BoardSignal[];
};

export type BoardDescription = {
    schema_version: number;
    board: string;
    host?: string;
    /** Label reference to the host GPIO controller, e.g. "&gpio". */
    gpio_controller: string;
    buses: BoardBus[];
    slots: BoardSlot[];
    /** Overlay shipped with the board for its onboard devices, as written: a path relative to the board file. */
    overlay?: string;
    /** Free-form advice for humans and AI readers. */
    notes: string[];
};
