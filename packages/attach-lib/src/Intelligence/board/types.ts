// A board description records how an add-on board (HAT, cape, shield, …)
// wires peripherals to its host: which bus each slot sits on, which chip
// selects exist, and which host GPIOs carry interrupt/reset/gpio lines.
// Plain arrays/objects throughout so it serialises to JSON unchanged.

export const SIGNAL_KINDS = ["interrupt", "reset", "chip-select", "gpio"] as const;
export type SignalKind = typeof SIGNAL_KINDS[number];

export type BoardSignal = {
    /** Key in the slot's `signals` map, e.g. "int". */
    name: string;
    kind: SignalKind;
    /** Line offset on the board's `gpio_controller`. */
    gpio: number;
    /** Chip-select index on the slot's bus (chip-select signals only). */
    reg?: number;
    /** False when a jumper leaves the line unconnected by default. */
    connected: boolean;
    /** Known line polarity; when absent it depends on the peripheral. */
    active?: "high" | "low";
    open_drain: boolean;
};

export type BoardChipSelect = {
    reg: number;
    gpio: number;
    /** `<slot>.<signal>` references of the slots that use this chip select. */
    users: string[];
};

export type BoardBus = {
    /** Key in the `buses` map, e.g. "spi0". */
    name: string;
    /** Label reference to the host node, e.g. "&spi0". */
    node: string;
    /** Sorted by `reg`. Non-empty marks a chip-select addressed (SPI) bus. */
    chip_selects: BoardChipSelect[];
    reserved_addresses: { address: number, description: string }[];
};

export type BoardSlot = {
    /** Key in the `slots` map, e.g. "spi_pmod1". */
    id: string;
    /** Name of the bus (key in `buses`) the slot sits on by default. */
    bus: string;
    /** Name of an alternative bus the slot can be switched to. */
    alt_bus?: string;
    /** What selects the alternative bus (e.g. a switch reference). */
    selected_by?: string;
    /** Primary chip select on `bus`, when that bus is chip-select addressed. */
    reg?: number;
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
    // Informational sections, carried through untouched for humans and AI readers.
    constraints: string[];
    gpio_usage: Record<string, string>;
    free_gpios: number[];
    conflicting_overlays: Record<string, number[]>;
};
