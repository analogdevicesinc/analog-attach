import { parse_board_description } from "./parse.js";
import { BoardBus, BoardChipSelect, BoardDescription, BoardSignal, BoardSlot } from "./types.js";

// Facts computed from a BoardDescription instead of being stored in the
// board file, so they can't drift from the slots' signals.

/** The SPI bus a slot's chip-select signals apply on, if the slot can sit on one. */
export function slot_spi_bus(board: BoardDescription, slot: BoardSlot): BoardBus | undefined {
    return board.buses.find(bus => bus.type === "spi" && slot.buses.includes(bus.name));
}

/** A slot's chip-select signals, in file order (the first is its primary `reg`). */
export function chip_select_signals(slot: BoardSlot): (BoardSignal & { reg: number })[] {
    return slot.signals.filter((signal): signal is BoardSignal & { reg: number } =>
        signal.kind === "chip-select" && signal.reg !== undefined);
}

/** The slot's primary chip select on `bus`, or undefined when `bus` is not the slot's SPI bus. */
export function slot_primary_reg(board: BoardDescription, slot: BoardSlot, bus: BoardBus): number | undefined {
    return slot_spi_bus(board, slot)?.name === bus.name ? chip_select_signals(slot)[0]?.reg : undefined;
}

/** Chip-select indexes a slot owns on `bus`. Empty unless `bus` is the slot's SPI bus. */
export function slot_chip_selects(board: BoardDescription, slot: BoardSlot, bus: BoardBus): number[] {
    return slot_spi_bus(board, slot)?.name === bus.name ? [...new Set(chip_select_signals(slot).map(signal => signal.reg))] : [];
}

/**
 * The chip selects wired on `bus`, sorted by `reg`. Signals sharing a `reg`
 * on the default GPIO are its users; a jumper alternative routing the same
 * `reg` to another GPIO is listed under `alternatives`.
 */
export function bus_chip_selects(board: BoardDescription, bus: BoardBus): BoardChipSelect[] {
    const by_reg = new Map<number, { slot: BoardSlot, signal: BoardSignal & { reg: number } }[]>();
    for (const slot of board.slots) {
        if (slot_spi_bus(board, slot)?.name !== bus.name) { continue; }
        for (const signal of chip_select_signals(slot)) {
            by_reg.set(signal.reg, [...by_reg.get(signal.reg) ?? [], { slot, signal }]);
        }
    }
    return [...by_reg.entries()].sort(([a], [b]) => a - b).map(([reg, entries]) => {
        const primary = entries.find(entry => entry.signal.connected) ?? entries[0]!;
        const on_primary = entries.filter(entry => entry.signal.gpio === primary.signal.gpio);
        const alternatives = entries.filter(entry => entry.signal.gpio !== primary.signal.gpio).map(entry => ({
            gpio: entry.signal.gpio,
            user: `${entry.slot.id}.${entry.signal.name}`,
            ...(entry.signal.jumper === undefined ? {} : { jumper: entry.signal.jumper }),
        }));
        const connected = on_primary.some(entry => entry.signal.connected);
        const jumper = connected ? undefined : on_primary.find(entry => entry.signal.jumper !== undefined)?.signal.jumper;
        return {
            reg,
            gpio: primary.signal.gpio,
            users: on_primary.map(entry => `${entry.slot.id}.${entry.signal.name}`),
            connected,
            ...(jumper === undefined ? {} : { jumper }),
            ...(alternatives.length > 0 ? { alternatives } : {}),
        };
    });
}

export type GpioUse = {
    gpio: number;
    /** `<bus>.<pin>` or `<slot>.<signal>`. */
    owner: string;
    /** False for a slot signal a jumper leaves unconnected by default. */
    connected: boolean;
};

/** Every host GPIO the board claims (bus pins and slot signals), sorted by GPIO. A GPIO shared by several signals appears once per owner. */
export function gpio_usage(board: BoardDescription): GpioUse[] {
    const uses: GpioUse[] = [
        ...board.buses.flatMap(bus => bus.pins.map(pin => ({ gpio: pin.gpio, owner: `${bus.name}.${pin.name}`, connected: true }))),
        ...board.slots.flatMap(slot => slot.signals.map(signal => ({ gpio: signal.gpio, owner: `${slot.id}.${signal.name}`, connected: signal.connected }))),
    ];
    return uses.sort((a, b) => a.gpio - b.gpio);
}

export type ExclusionSide = {
    slot: string;
    /** `<slot>.<signal>` reference of the signal on the shared GPIO. */
    signal: string;
    /** Set when the conflict only exists while the slot sits on this bus (a chip select of a multi-bus slot). */
    bus?: string;
};

export type SlotExclusion = {
    gpio: number;
    /** The two sides, in board-file order. */
    sides: [ExclusionSide, ExclusionSide];
};

/**
 * Pairs of slots that can't be populated together because they share a
 * connected chip select: both devices would answer on it. Other shared lines
 * (e.g. one reset wired to two slots) don't exclude; see `shared_with`.
 */
export function exclusive_slots(board: BoardDescription): SlotExclusion[] {
    const side = (slot: BoardSlot, signal: BoardSignal): ExclusionSide => {
        const bus = signal.kind === "chip-select" && slot.buses.length > 1 ? slot_spi_bus(board, slot)?.name : undefined;
        return { slot: slot.id, signal: `${slot.id}.${signal.name}`, ...(bus === undefined ? {} : { bus }) };
    };
    const exclusions: SlotExclusion[] = [];
    for (const [index, a] of board.slots.entries()) {
        for (const b of board.slots.slice(index + 1)) {
            for (const sa of a.signals.filter(s => s.connected && s.kind === "chip-select")) {
                const sb = b.signals.find(s => s.connected && s.kind === "chip-select" && s.gpio === sa.gpio);
                if (sb === undefined) { continue; }
                exclusions.push({ gpio: sa.gpio, sides: [side(a, sa), side(b, sb)] });
            }
        }
    }
    return exclusions;
}

/**
 * The slots `slot_id` excludes, each with the shared GPIO and, when the
 * conflict is bus-dependent on that side, the bus it applies on. With `bus`,
 * only conflicts that hold while `slot_id` sits on `bus` are returned.
 */
export function exclusions_of(board: BoardDescription, slot_id: string, bus?: string): { slot: string, gpio: number, bus?: string }[] {
    return exclusive_slots(board).flatMap(({ gpio, sides }) => {
        const own = sides.find(s => s.slot === slot_id);
        const other = sides.find(s => s.slot !== slot_id);
        if (own === undefined || other === undefined) { return []; }
        if (bus !== undefined && own.bus !== undefined && own.bus !== bus) { return []; }
        return [{ slot: other.slot, gpio, ...(other.bus === undefined ? {} : { bus: other.bus }) }];
    });
}

export type SharedLine = {
    /** `<slot>.<signal>` reference of the other signal on the same GPIO. */
    owner: string;
    connected: boolean;
    jumper?: string;
};

/** Signals of other slots wired to the same host GPIO as `signal` of `slot_id`. */
export function shared_with(board: BoardDescription, slot_id: string, signal: BoardSignal): SharedLine[] {
    return board.slots
        .filter(slot => slot.id !== slot_id)
        .flatMap(slot => slot.signals
            .filter(other => other.gpio === signal.gpio)
            .map(other => ({
                owner: `${slot.id}.${other.name}`,
                connected: other.connected,
                ...(other.jumper === undefined ? {} : { jumper: other.jumper }),
            })));
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    const board = parse_board_description(`
schema_version: 4
board: TEST-HAT
gpio_controller: "&gpio"
buses:
  spi0: {type: spi, pins: {sclk: 11}}
  i2c1: {type: i2c, pins: {sda: 2, scl: 3}}
slots:
  a:
    bus: spi0
    signals:
      cs1: {kind: chip-select, gpio: 8, reg: 0}
      cs2: {kind: chip-select, gpio: 20, reg: 2}
      int: {kind: interrupt, gpio: 19}
  b:
    bus: spi0
    signals:
      cs1: {kind: chip-select, gpio: 7, reg: 1}
  c:
    bus: [spi0, i2c1]
    selected_by: SW1
    signals:
      cs: {kind: chip-select, gpio: 8, reg: 0}
      out: {kind: gpio, gpio: 16, connected: false}
  d:
    bus: i2c1
    signals:
      out: {kind: gpio, gpio: 16, connected: false}
`);
    if (typeof board === "string") { throw new TypeError(board); }
    const spi0 = board.buses[0]!;
    // eslint-disable-next-line unicorn/prevent-abbreviations
    const i2c1 = board.buses[1]!;
    const slot = (id: string) => board.slots.find(s => s.id === id)!;

    test("bus_chip_selects — merges slot chip selects by reg, sorted", () => {
        expect(bus_chip_selects(board, spi0)).toStrictEqual([
            { reg: 0, gpio: 8, users: ["a.cs1", "c.cs"], connected: true },
            { reg: 1, gpio: 7, users: ["b.cs1"], connected: true },
            { reg: 2, gpio: 20, users: ["a.cs2"], connected: true },
        ]);
        expect(bus_chip_selects(board, i2c1)).toStrictEqual([]);
    });

    test("bus_chip_selects — a jumper alternative for the same reg is listed, not a separate chip select", () => {
        const remapped = parse_board_description(`
schema_version: 4
board: REMAP
gpio_controller: "&gpio"
buses:
  spi0: {type: spi}
slots:
  pmod:
    bus: spi0
    signals:
      cs:     {kind: chip-select, gpio: 7, reg: 1, jumper: P12}
      cs_alt: {kind: chip-select, gpio: 27, reg: 1, connected: false, jumper: P11}
`);
        if (typeof remapped === "string") { throw new TypeError(remapped); }
        expect(bus_chip_selects(remapped, remapped.buses[0]!)).toStrictEqual([
            { reg: 1, gpio: 7, users: ["pmod.cs"], connected: true, alternatives: [{ gpio: 27, user: "pmod.cs_alt", jumper: "P11" }] },
        ]);
        expect(slot_chip_selects(remapped, remapped.slots[0]!, remapped.buses[0]!)).toStrictEqual([1]);
    });

    test("slot_primary_reg / slot_chip_selects — only on the slot's SPI bus", () => {
        expect(slot_primary_reg(board, slot("a"), spi0)).toBe(0);
        expect(slot_chip_selects(board, slot("a"), spi0)).toStrictEqual([0, 2]);
        expect(slot_primary_reg(board, slot("c"), i2c1)).toBeUndefined();
        expect(slot_chip_selects(board, slot("c"), i2c1)).toStrictEqual([]);
    });

    test("gpio_usage — bus pins and signals, sorted, unconnected lines flagged", () => {
        expect(gpio_usage(board).map(use => `${use.gpio}:${use.owner}${use.connected ? "" : "?"}`)).toStrictEqual([
            "2:i2c1.sda", "3:i2c1.scl", "7:b.cs1", "8:a.cs1", "8:c.cs", "11:spi0.sclk", "16:c.out?", "16:d.out?", "19:a.int", "20:a.cs2",
        ]);
    });

    test("exclusive_slots / shared_with — a shared reset line doesn't exclude, but is reported", () => {
        const shared = parse_board_description(`
schema_version: 4
board: SHARED
gpio_controller: "&gpio"
buses:
  spi0: {type: spi}
  i2c1: {type: i2c}
slots:
  a:
    bus: spi0
    signals: {reset: {kind: reset, gpio: 26}, int: {kind: interrupt, gpio: 19}}
  b:
    bus: i2c1
    signals: {reset: {kind: reset, gpio: 26}, int: {kind: interrupt, gpio: 19, connected: false, jumper: P37}}
`);
        if (typeof shared === "string") { throw new TypeError(shared); }
        expect(exclusive_slots(shared)).toStrictEqual([]);
        const a = shared.slots[0]!;
        expect(shared_with(shared, "a", a.signals[0]!)).toStrictEqual([{ owner: "b.reset", connected: true }]);
        expect(shared_with(shared, "a", a.signals[1]!)).toStrictEqual([{ owner: "b.int", connected: false, jumper: "P37" }]);
    });

    test("exclusive_slots — a shared connected chip select excludes, an unconnected line doesn't", () => {
        expect(exclusive_slots(board)).toStrictEqual([
            { gpio: 8, sides: [{ slot: "a", signal: "a.cs1" }, { slot: "c", signal: "c.cs", bus: "spi0" }] },
        ]);
        expect(exclusions_of(board, "a")).toStrictEqual([{ slot: "c", gpio: 8, bus: "spi0" }]);
        expect(exclusions_of(board, "b")).toStrictEqual([]);
    });

    test("exclusions_of — a chip-select conflict of a multi-bus slot only holds on its spi bus", () => {
        expect(exclusions_of(board, "c", "spi0")).toStrictEqual([{ slot: "a", gpio: 8 }]);
        expect(exclusions_of(board, "c", "i2c1")).toStrictEqual([]);
    });
}
