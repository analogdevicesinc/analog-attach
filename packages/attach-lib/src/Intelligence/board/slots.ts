import { readFileSync } from "node:fs";
import { DeviceTree } from "../../Devicetree/index.js";
import { NodePlacement } from "../layers/types.js";
import { BoardBus, BoardDescription, BoardSlot } from "./types.js";
import { parse_board_description } from "./parse.js";

/** Map each board bus name to the absolute path of its node in `devicetree`. Unresolvable buses are omitted. */
export function resolve_bus_paths(board: BoardDescription, devicetree: DeviceTree): Map<string, string> {
    const paths = new Map<string, string>();
    for (const bus of board.buses) {
        const reference = devicetree.get_node_by_label({ kind: "label", labels: [], name: bus.node.slice(1) });
        if (reference !== undefined) {
            paths.set(bus.name, reference.full_path.path);
        }
    }
    return paths;
}

/** The board bus whose host node is at `path`, if any. */
export function bus_at_path(board: BoardDescription, bus_paths: Map<string, string>, path: string): BoardBus | undefined {
    return board.buses.find(bus => bus_paths.get(bus.name) === path);
}

/** Slots that can sit on `bus`, either by default or through their alternative bus. */
export function slots_on_bus(board: BoardDescription, bus: BoardBus): BoardSlot[] {
    return board.slots.filter(slot => slot.bus === bus.name || slot.alt_bus === bus.name);
}

/** Chip-select indexes a slot owns on `bus`: its primary `reg` plus its chip-select signals. */
export function slot_chip_selects(slot: BoardSlot, bus: BoardBus): number[] {
    if (slot.bus !== bus.name) { return []; }
    return [
        ...(slot.reg === undefined ? [] : [slot.reg]),
        ...slot.signals.filter(signal => signal.kind === "chip-select" && signal.reg !== undefined).map(signal => signal.reg!),
    ];
}

export type SlotInference = {
    /** The board bus the node's parent is, or undefined when the parent is not a board bus. */
    bus: BoardBus | undefined;
    /** Candidate slots, in board-file order. */
    slots: BoardSlot[];
    /** True when exactly one slot remains. */
    narrowed: boolean;
    /** Set when the bus has chip selects, `reg` is defined, but no chip_selects entry has that reg. */
    unwired_reg?: bigint;
};

/**
 * Infer which slot(s) a node belongs to from its parent bus and `reg`. On a
 * chip-select addressed bus a `reg` narrows to the slots owning that chip
 * select; when `reg` is absent or matches nothing every slot on the bus stays
 * a candidate. Stateless: nothing beyond the tree itself is consulted.
 */
export function slots_for_placement(
    board: BoardDescription,
    bus_paths: Map<string, string>,
    placement: NodePlacement,
): SlotInference {
    const bus = bus_at_path(board, bus_paths, placement.parent_path);
    if (bus === undefined) {
        return { bus, slots: [], narrowed: false };
    }

    const on_bus = slots_on_bus(board, bus);
    const reg = placement.reg;
    const matching = reg === undefined || bus.chip_selects.length === 0
        ? []
        : on_bus.filter(slot => slot_chip_selects(slot, bus).includes(Number(reg)));

    const slots = matching.length > 0 ? matching : on_bus;

    const unwired_reg = reg !== undefined && bus.chip_selects.length > 0 && matching.length === 0
        && !bus.chip_selects.some(cs => cs.reg === Number(reg))
        ? reg
        : undefined;

    return { bus, slots, narrowed: slots.length === 1, ...(unwired_reg === undefined ? {} : { unwired_reg }) };
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;
    const PMD_RPI_INTZ_FIXTURE = readFileSync(new URL("../../../test/fixtures/board/pmd-rpi-intz.yaml", import.meta.url), "utf8");
    const RPI_BASE_FIXTURE = readFileSync(new URL("../../../test/fixtures/board/rpi-base.dts", import.meta.url), "utf8");

    const board = parse_board_description(PMD_RPI_INTZ_FIXTURE);
    if (typeof board === "string") { throw new TypeError(board); }
    const devicetree = DeviceTree.new_from_string(RPI_BASE_FIXTURE);
    if (typeof devicetree === "string") { throw new TypeError(devicetree); }
    const bus_paths = resolve_bus_paths(board, devicetree);

    const spi0 = "/soc/spi@7e204000";
    // eslint-disable-next-line unicorn/prevent-abbreviations
    const i2c1 = "/soc/i2c@7e804000";
    const at = (parent_path: string, reg?: bigint): NodePlacement => ({
        node_path: `${parent_path}/dev`, parent_path, siblings: [], ...(reg === undefined ? {} : { reg }),
    });
    const ids = (inference: SlotInference) => inference.slots.map(slot => slot.id);

    test("resolve_bus_paths — maps bus labels to base-tree paths", () => {
        expect(bus_paths).toStrictEqual(new Map([["spi0", spi0], ["i2c1", i2c1]]));
    });

    test("slots_for_placement — spi0 reg 0 is shared by spi_pmod1 and quikeval", () => {
        const inference = slots_for_placement(board, bus_paths, at(spi0, 0n));
        expect(ids(inference)).toStrictEqual(["spi_pmod1", "quikeval"]);
        expect(inference.narrowed).toBe(false);
    });

    test("slots_for_placement — spi0 reg 2 narrows to spi_pmod1 via its CS2 signal", () => {
        const inference = slots_for_placement(board, bus_paths, at(spi0, 2n));
        expect(ids(inference)).toStrictEqual(["spi_pmod1"]);
        expect(inference.narrowed).toBe(true);
    });

    test("slots_for_placement — spi0 without reg keeps every spi0 slot", () => {
        expect(ids(slots_for_placement(board, bus_paths, at(spi0)))).toStrictEqual(["spi_pmod1", "spi_pmod2", "quikeval"]);
    });

    test("slots_for_placement — i2c1 is ambiguous, quikeval included through alt_bus", () => {
        const inference = slots_for_placement(board, bus_paths, at(i2c1, 0x48n));
        expect(ids(inference)).toStrictEqual(["i2c_pmod1", "i2c_pmod2", "quikeval", "psm"]);
        expect(inference.narrowed).toBe(false);
    });

    test("slots_for_placement — a parent that is not a board bus yields no slots", () => {
        const inference = slots_for_placement(board, bus_paths, at("/soc/spi@7e215080", 0n));
        expect(inference.bus).toBeUndefined();
        expect(inference.slots).toStrictEqual([]);
    });

    test("slots_for_placement — unwired_reg is set for reg 7 and unset for reg 2", () => {
        const unwired = slots_for_placement(board, bus_paths, at(spi0, 7n));
        expect(unwired.unwired_reg).toBe(7n);
        expect(unwired.slots.length).toBeGreaterThan(0);

        const wired = slots_for_placement(board, bus_paths, at(spi0, 2n));
        expect(wired.unwired_reg).toBeUndefined();
    });
}
