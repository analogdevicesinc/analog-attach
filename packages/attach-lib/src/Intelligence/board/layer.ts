import { readFileSync } from "node:fs";
import { ParsedBinding, ResolvedProperty } from "../../Attach/AttachTypes.js";
import { DeviceTree } from "../../Devicetree/index.js";
import { parent_path_string } from "../parents.js";
import { cell_extract_first_value, is_gpio_property, INTERRUPT_MACROS } from "../query.js";
import {
    IntelligenceLayer,
    NodePlacement,
    PlacementSuggestion,
    PropertyContext,
    SuggestedCell,
    ValueSuggestion,
} from "../layers/types.js";
import { bus_at_path, resolve_bus_paths, slot_chip_selects, SlotInference, slots_for_placement, slots_on_bus } from "./slots.js";
import { BoardBus, BoardDescription, BoardSignal, BoardSlot, SignalKind } from "./types.js";
import { parse_board_description } from "./parse.js";

function interrupt_macros(signal: BoardSignal): string[] {
    switch (signal.active) {
        case "low": { return ["IRQ_TYPE_LEVEL_LOW", "IRQ_TYPE_EDGE_FALLING"]; }
        case "high": { return ["IRQ_TYPE_LEVEL_HIGH", "IRQ_TYPE_EDGE_RISING"]; }
        case undefined: { return INTERRUPT_MACROS.filter(m => m.name !== "IRQ_TYPE_NONE").map(m => m.name); }
    }
}

function gpio_flag_macros(signal: BoardSignal, unknown_order: string[]): string[] {
    switch (signal.active) {
        case "low": { return ["GPIO_ACTIVE_LOW"]; }
        case "high": { return ["GPIO_ACTIVE_HIGH"]; }
        case undefined: { return unknown_order; }
    }
}

function gpio_signal_kinds(property: string): SignalKind[] {
    const stripped = property.replace(/^[^,]*,/, "").replace(/-gpios?$/, "");
    const tokens = stripped.split("-");
    if (tokens.some(t => /^n?(reset|rst)(b|n)?$/.test(t))) { return ["reset"]; }
    if (tokens.some(t => /^n?(irq|int\d*|intr|interrupt|d?rdy|ready|alert|busy)$/.test(t))) { return ["interrupt", "gpio"]; }
    return ["gpio"];
}

function connected_signals(slots: BoardSlot[], kind: SignalKind): { slot: BoardSlot, signal: BoardSignal }[] {
    return slots.flatMap(slot => slot.signals
        .filter(signal => signal.kind === kind && signal.connected)
        .map(signal => ({ slot, signal })));
}

/** One-line human summary of a slot, e.g. "spi_pmod1 — spi0 reg 0; int GPIO19, reset GPIO21". */
export function describe_slot(board: BoardDescription, slot: BoardSlot): string {
    const bus = board.buses.find(b => b.name === slot.bus);
    const primary = slot.reg !== undefined && bus !== undefined && bus.chip_selects.length > 0
        ? `${slot.bus} reg ${slot.reg}`
        : slot.bus;
    const alternative = slot.alt_bus === undefined
        ? ""
        : ` or ${slot.alt_bus}${slot.selected_by === undefined ? "" : ` (${slot.selected_by})`}`;
    const signals = slot.signals.map(signal => {
        const reg = signal.reg === undefined ? "" : ` (reg ${signal.reg})`;
        const connected = signal.connected ? "" : " (not connected)";
        return `${signal.name} GPIO${signal.gpio}${reg}${connected}`;
    });
    return `${slot.id} — ${primary}${alternative}${signals.length > 0 ? `; ${signals.join(", ")}` : ""}`;
}

export function describe_placement(board: BoardDescription, slot: BoardSlot, bus_name: string): string {
    if (slot.alt_bus === undefined || bus_name === slot.bus) {
        const bus = board.buses.find(b => b.name === slot.bus);
        const bus_part = slot.reg !== undefined && bus !== undefined && bus.chip_selects.length > 0
            ? `${slot.bus} reg ${slot.reg}`
            : slot.bus;
        const switch_note = slot.alt_bus === undefined
            ? ""
            : ` (${slot.selected_by ?? "switch"} selects ${slot.alt_bus} instead)`;
        const gpio = slot.signals.filter(s => s.kind === "gpio" && s.connected).map(s => `GPIO${s.gpio}`).join(", ");
        return `${slot.id} — ${bus_part}${switch_note}${gpio ? `; gpio ${gpio}` : ""}`;
    }
    const switch_note = slot.selected_by === undefined ? "" : ` via ${slot.selected_by}`;
    const gpio = slot.signals.filter(s => s.kind === "gpio" && s.connected).map(s => `GPIO${s.gpio}`).join(", ");
    return `${slot.id} — ${bus_name}${switch_note}${gpio ? `; gpio ${gpio}` : ""}`;
}

export type BoardLayer = IntelligenceLayer & {
    readonly board: BoardDescription;
    /** Which slot(s) the node at `placement` belongs to. */
    infer_slots(devicetree: DeviceTree, placement: NodePlacement): SlotInference;
    /** The board bus whose host node is at `node_path`, if any. */
    bus_of_node(devicetree: DeviceTree, node_path: string): BoardBus | undefined;
};

function effective_interrupt_parent(context: PropertyContext, placement: NodePlacement, devicetree: DeviceTree): string | undefined {
    // First check data (set by the overlay)
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(context.data); } catch { /* empty */ }

    const from_data = parsed["interrupt-parent"];
    if (typeof from_data === "string") { return from_data; }
    if (Array.isArray(from_data) && from_data.length > 0 && typeof from_data[0] === "string") { return from_data[0]; }

    // Walk base-tree ancestors for an inherited interrupt-parent
    let path = placement.parent_path;
    while (path.length > 0) {
        const reference = devicetree.get_node_by_path({ kind: "path", labels: [], path });
        if (reference !== undefined) {
            const node = devicetree.deref_node(reference);
            if (node !== undefined) {
                const property = node.properties.find(p => p.name === "interrupt-parent");
                if (property !== undefined) {
                    const value = cell_extract_first_value(property);
                    return typeof value === "string" ? value : undefined;
                }
            }
        }
        if (path === "/") { break; }
        const last = path.lastIndexOf("/");
        path = last <= 0 ? "/" : path.slice(0, last);
    }
    return;
}

/**
 * Layer 3: knowledge from a board description (HAT, cape, shield, …). Given a
 * node's placement it infers the slot(s) the node sits in and offers the
 * board's wiring as concrete values. It never narrows what a binding allows:
 * a user can always wire a peripheral differently.
 */
export function board_layer(board: BoardDescription): BoardLayer {
    const name = `board:${board.board}`;
    const controller = board.gpio_controller.slice(1);

    const suggestion = (rows: SuggestedCell[][], display: string, slots?: string[], note?: string): ValueSuggestion => ({
        rows,
        display,
        source: name,
        ...(slots !== undefined && slots.length > 0 ? { slots } : {}),
        ...(note === undefined ? {} : { note }),
    });

    const bus_node_values = (property: string, bus_name: string): ValueSuggestion[] => {
        const bus = board.buses.find(b => b.name === bus_name);
        if (bus === undefined || property !== "cs-gpios" || bus.chip_selects.length === 0) { return []; }

        const cs_map = new Map(bus.chip_selects.map(cs => [cs.reg, cs]));
        const max_reg = Math.max(...bus.chip_selects.map(cs => cs.reg));
        const rows: SuggestedCell[][] = [];
        const display_parts: string[] = [];
        const gaps: number[] = [];

        for (let reg = 0; reg <= max_reg; reg++) {
            const cs = cs_map.get(reg);
            if (cs === undefined) {
                rows.push([0n]);
                display_parts.push("<0>");
                gaps.push(reg);
            } else {
                rows.push([{ label: controller }, BigInt(cs.gpio), { macro: "GPIO_ACTIVE_LOW" }]);
                display_parts.push(`GPIO${cs.gpio}`);
            }
        }

        const note = gaps.length > 0
            ? gaps.map(g => `CS${g} not wired (<0> placeholder)`).join("; ")
            : undefined;
        return [suggestion(rows, `${bus.chip_selects.length} chip selects — ${display_parts.join(", ")}`, undefined, note)];
    };

    const device_values = (property: string, inference: SlotInference, placement: NodePlacement, context: PropertyContext): ValueSuggestion[] => {
        const { bus, slots } = inference;
        if (bus === undefined) { return []; }

        if (property === "reg") {
            return bus.chip_selects.map(cs => {
                const taken_by = placement.siblings.find(sibling => sibling.reg === BigInt(cs.reg));
                const owners = board.slots.filter(slot => slot_chip_selects(slot, bus).includes(cs.reg)).map(s => s.id);
                return suggestion(
                    [[BigInt(cs.reg)]],
                    `${cs.reg} — GPIO${cs.gpio} (${cs.users.join(", ")})${taken_by === undefined ? "" : `, in use by ${taken_by.name}`}`,
                    owners.length > 0 ? owners : undefined,
                    taken_by === undefined ? undefined : `in use by ${taken_by.name}`,
                );
            });
        }

        if (property === "interrupts" || property === "interrupts-extended") {
            const prefix: SuggestedCell[] = property === "interrupts" ? [] : [{ label: controller }];

            // If interrupts (not interrupts-extended), check if the effective
            // interrupt-parent is the board controller. If not, warn the user.
            let int_parent_note: string | undefined;
            if (property === "interrupts") {
                const effective = effective_interrupt_parent(context, placement, context.devicetree);
                if (effective !== undefined && effective !== controller) {
                    int_parent_note = `needs interrupt-parent = <&${controller}> (currently <&${effective}>); set it first`;
                }
            }

            return connected_signals(slots, "interrupt").flatMap(({ slot, signal }) =>
                interrupt_macros(signal).map(macro => {
                    const base_note = signal.open_drain ? "open-drain line: needs a pull-up" : undefined;
                    const combined = [int_parent_note, base_note].filter(Boolean).join("; ") || undefined;
                    return suggestion(
                        [[...prefix, BigInt(signal.gpio), { macro }]],
                        `${property === "interrupts" ? "" : `${controller} `}${signal.gpio} ${macro} — ${slot.id}.${signal.name}`,
                        [slot.id],
                        combined,
                    );
                }));
        }

        if (property === "interrupt-parent") {
            const interrupt_slots = [...new Set(connected_signals(slots, "interrupt").map(({ slot }) => slot.id))];
            if (interrupt_slots.length === 0) { return []; }
            return [suggestion([[{ label: controller }]], `${controller} — interrupt lines of ${interrupt_slots.join(", ")}`)];
        }

        if (is_gpio_property(property)) {
            const kinds = gpio_signal_kinds(property);
            const low_first = kinds[0] === "reset" || kinds[0] === "interrupt";
            const unknown_order = low_first ? ["GPIO_ACTIVE_LOW", "GPIO_ACTIVE_HIGH"] : ["GPIO_ACTIVE_HIGH", "GPIO_ACTIVE_LOW"];
            return kinds.flatMap(kind =>
                connected_signals(slots, kind).flatMap(({ slot, signal }) =>
                    gpio_flag_macros(signal, unknown_order).map(macro => suggestion(
                        [[{ label: controller }, BigInt(signal.gpio), { macro }]],
                        `${controller} ${signal.gpio} ${macro} — ${slot.id}.${signal.name}`,
                        [slot.id],
                        signal.open_drain ? "open-drain line: needs a pull-up" : undefined,
                    ))));
        }

        return [];
    };

    const layer: BoardLayer = {
        name,
        board,

        infer_slots(devicetree, placement) {
            return slots_for_placement(board, resolve_bus_paths(board, devicetree), placement);
        },

        bus_of_node(devicetree, node_path) {
            return bus_at_path(board, resolve_bus_paths(board, devicetree), node_path);
        },

        suggest_values(property: string, context: PropertyContext, lower: ValueSuggestion[]): ValueSuggestion[] {
            const placement = context.placement;
            if (placement === undefined) { return lower; }

            const bus_paths = resolve_bus_paths(board, context.devicetree);
            const own_bus = bus_at_path(board, bus_paths, placement.node_path);
            if (own_bus !== undefined) {
                return [...lower, ...bus_node_values(property, own_bus.name)];
            }

            const inference = slots_for_placement(board, bus_paths, placement);
            return [...lower, ...device_values(property, inference, placement, context)];
        },

        refine_properties(properties: ResolvedProperty[], context: PropertyContext): ResolvedProperty[] {
            if (context.placement === undefined) { return properties; }

            const bus_paths = resolve_bus_paths(board, context.devicetree);
            const own_bus = bus_at_path(board, bus_paths, context.placement.node_path);
            const inference = own_bus === undefined ? slots_for_placement(board, bus_paths, context.placement) : undefined;

            const suggest_one = (property: string, lower: ValueSuggestion[]): ValueSuggestion[] => {
                if (own_bus !== undefined) { return [...lower, ...bus_node_values(property, own_bus.name)]; }
                return [...lower, ...device_values(property, inference!, context.placement!, context)];
            };

            return properties.map(property => {
                const lower = (property.suggestions ?? []).filter(s => s.source !== name);
                const suggestions = suggest_one(property.key, lower);
                return suggestions.length === lower.length ? property : { ...property, suggestions };
            });
        },

        suggest_placement(_binding: ParsedBinding, devicetree: DeviceTree, lower: PlacementSuggestion[]): PlacementSuggestion[] {
            const bus_paths = resolve_bus_paths(board, devicetree);
            return lower.flatMap(candidate => {
                const path = parent_path_string(candidate.parent);
                const bus = bus_at_path(board, bus_paths, path);
                if (bus === undefined) { return [candidate]; }

                const entries: PlacementSuggestion[] = [];
                for (const slot of slots_on_bus(board, bus)) {
                    if (slot.bus === bus.name) {
                        const reg = bus.chip_selects.length > 0 ? slot.reg : undefined;
                        entries.push({
                            parent: candidate.parent,
                            ...(reg === undefined ? {} : { reg: BigInt(reg) }),
                            slot: slot.id,
                            display: describe_placement(board, slot, bus.name),
                            source: name,
                        });
                    }
                    if (slot.alt_bus === bus.name) {
                        entries.push({
                            parent: candidate.parent,
                            slot: slot.id,
                            display: describe_placement(board, slot, bus.name),
                            source: name,
                        });
                    }
                }
                return entries.length > 0 ? entries : [candidate];
            });
        },
    };

    return layer;
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;
    const PMD_RPI_INTZ_FIXTURE = readFileSync(new URL("../../../test/fixtures/board/pmd-rpi-intz.yaml", import.meta.url), "utf8");
    const RPI_BASE_FIXTURE = readFileSync(new URL("../../../test/fixtures/board/rpi-base.dts", import.meta.url), "utf8");

    const board = parse_board_description(PMD_RPI_INTZ_FIXTURE);
    if (typeof board === "string") { throw new TypeError(board); }
    const devicetree = DeviceTree.new_from_string(RPI_BASE_FIXTURE);
    if (typeof devicetree === "string") { throw new TypeError(devicetree); }
    const layer = board_layer(board);

    const spi0 = "/soc/spi@7e204000";
    // eslint-disable-next-line unicorn/prevent-abbreviations
    const i2c1 = "/soc/i2c@7e804000";
    const context = (parent_path: string, reg?: bigint, siblings: NodePlacement["siblings"] = []): PropertyContext => ({
        devicetree,
        data: "{}",
        placement: { node_path: `${parent_path}/dev@0`, parent_path, siblings, ...(reg === undefined ? {} : { reg }) },
    });
    const values = (property: string, context_: PropertyContext) => layer.suggest_values!(property, context_, []);

    test("board_layer — reg on spi0 lists every chip select and marks those in use", () => {
        const result = values("reg", context(spi0, undefined, [{ name: "adc@0", reg: 0n }]));
        expect(result.map(s => s.rows)).toStrictEqual([[[0n]], [[1n]], [[2n]], [[3n]], [[4n]], [[5n]]]);
        expect(result[0]?.display).toBe("0 — GPIO8 (spi_pmod1.cs1, quikeval.cs), in use by adc@0");
        expect(result[0]?.note).toBe("in use by adc@0");
        expect(result[2]).toStrictEqual({ rows: [[2n]], display: "2 — GPIO20 (spi_pmod1.cs2)", source: "board:PMD-RPI-INTZ", slots: ["spi_pmod1"] });
        expect(result[0]?.slots).toStrictEqual(["spi_pmod1", "quikeval"]);
    });

    test("board_layer — reg under i2c is left to the device", () => {
        expect(values("reg", context(i2c1))).toStrictEqual([]);
    });

    test("board_layer — interrupts follow the inferred slot", () => {
        const result = values("interrupts", context(spi0, 2n));
        expect(result.map(s => s.display)).toStrictEqual([
            "19 IRQ_TYPE_EDGE_RISING — spi_pmod1.int",
            "19 IRQ_TYPE_EDGE_FALLING — spi_pmod1.int",
            "19 IRQ_TYPE_EDGE_BOTH — spi_pmod1.int",
            "19 IRQ_TYPE_LEVEL_HIGH — spi_pmod1.int",
            "19 IRQ_TYPE_LEVEL_LOW — spi_pmod1.int",
        ]);
        expect(result[1]?.rows).toStrictEqual([[19n, { macro: "IRQ_TYPE_EDGE_FALLING" }]]);
    });

    test("board_layer — a known-polarity interrupt only offers matching trigger types", () => {
        const result = values("interrupts-extended", context(i2c1)).filter(s => s.slots?.includes("psm"));
        expect(result.map(s => s.rows)).toStrictEqual([
            [[{ label: "gpio" }, 4n, { macro: "IRQ_TYPE_LEVEL_LOW" }]],
            [[{ label: "gpio" }, 4n, { macro: "IRQ_TYPE_EDGE_FALLING" }]],
        ]);
        expect(result[0]?.note).toBe("open-drain line: needs a pull-up");
    });

    test("board_layer — interrupt-parent points at the board's gpio controller", () => {
        expect(values("interrupt-parent", context(spi0, 1n))).toStrictEqual([
            { rows: [[{ label: "gpio" }]], display: "gpio — interrupt lines of spi_pmod2", source: "board:PMD-RPI-INTZ" },
        ]);
    });

    test("board_layer — reset-gpios offers the reset line, active-low first", () => {
        expect(values("reset-gpios", context(spi0, 1n)).map(s => s.rows)).toStrictEqual([
            [[{ label: "gpio" }, 12n, { macro: "GPIO_ACTIVE_LOW" }]],
            [[{ label: "gpio" }, 12n, { macro: "GPIO_ACTIVE_HIGH" }]],
        ]);
    });

    test("board_layer — other *-gpios use gpio-kind signals and skip unconnected lines", () => {
        expect(values("enable-gpios", context(i2c1)).map(s => s.display)).toStrictEqual([
            "gpio 22 GPIO_ACTIVE_HIGH — quikeval.gpio",
            "gpio 22 GPIO_ACTIVE_LOW — quikeval.gpio",
        ]);
    });

    test("board_layer — cs-gpios on the bus node lists every chip select in reg order", () => {
        const result = values("cs-gpios", { devicetree, data: "{}", placement: { node_path: spi0, parent_path: "/soc", siblings: [] } });
        expect(result).toHaveLength(1);
        expect(result[0]?.rows.map(row => row[1])).toStrictEqual([8n, 7n, 20n, 18n, 5n, 6n]);
        expect(result[0]?.rows[0]).toStrictEqual([{ label: "gpio" }, 8n, { macro: "GPIO_ACTIVE_LOW" }]);
    });

    test("board_layer — nodes off board buses and missing placements pass lower results through", () => {
        const lower = [{ rows: [[1n]], display: "1", source: "low" }];
        expect(layer.suggest_values!("reg", context("/soc/spi@7e215080", 0n), lower)).toStrictEqual(lower);
        expect(layer.suggest_values!("reg", { devicetree, data: "{}" }, lower)).toStrictEqual(lower);
    });

    test("board_layer — refine_properties attaches suggestions without touching the schema", () => {
        const properties: ResolvedProperty[] = [
            { key: "reset-gpios", value: { _t: "generic" } },
            { key: "spi-max-frequency", value: { _t: "generic" } },
        ];
        const refined = layer.refine_properties!(properties, context(spi0, 0n));
        expect(refined[0]?.value).toStrictEqual({ _t: "generic" });
        expect(refined[0]?.suggestions?.map(s => s.slots)).toStrictEqual([["spi_pmod1"], ["spi_pmod1"]]);
        expect(refined[1]).toBe(properties[1]);
    });

    test("board_layer — suggest_placement expands board buses into slots, one row per (slot, bus)", () => {
        const lower: PlacementSuggestion[] = [
            { parent: { path: ["/", "soc", "spi@7e204000"], label: "spi0" }, display: "spi0", source: "devicetree" },
            { parent: { path: ["/", "soc", "spi@7e215080"], label: "spi1" }, display: "spi1", source: "devicetree" },
        ];
        const result = layer.suggest_placement!({ required_properties: [], properties: [], examples: [] }, devicetree, lower);
        expect(result.map(s => [s.slot, s.reg])).toStrictEqual([
            ["spi_pmod1", 0n],
            ["spi_pmod2", 1n],
            ["quikeval", 0n],
            [undefined, undefined],
        ]);
        expect(result[0]?.display).toBe("spi_pmod1 — spi0 reg 0");
    });

    test("board_layer — suggest_placement lists dual-bus slot once per bus", () => {
        const lower: PlacementSuggestion[] = [
            { parent: { path: ["/", "soc", "spi@7e204000"], label: "spi0" }, display: "spi0", source: "devicetree" },
            { parent: { path: ["/", "soc", "i2c@7e804000"], label: "i2c1" }, display: "i2c1", source: "devicetree" },
        ];
        const result = layer.suggest_placement!({ required_properties: [], properties: [], examples: [] }, devicetree, lower);
        const quikeval_entries = result.filter(s => s.slot === "quikeval");
        expect(quikeval_entries).toHaveLength(2);
        expect(quikeval_entries[0]?.reg).toBe(0n);
        expect(quikeval_entries[0]?.display).toContain("spi0 reg 0");
        expect(quikeval_entries[0]?.display).toContain("SW1 selects i2c1 instead");
        expect(quikeval_entries[1]?.reg).toBeUndefined();
        expect(quikeval_entries[1]?.display).toContain("i2c1 via SW1");
    });

    test("board_layer — cs-gpios with gaps emits <0> rows and a note", () => {
        const gapped_fixture = PMD_RPI_INTZ_FIXTURE
            .replace(/      2: \{gpio: 20, user: spi_pmod1\.cs2\}\n/, "")
            .replace(/      4: \{gpio: 5,  user: spi_pmod2\.cs2\}\n/, "")
            .replace(/      5: \{gpio: 6,  user: spi_pmod2\.cs3\}\n/, "");
        const gapped_board = parse_board_description(gapped_fixture);
        if (typeof gapped_board === "string") { throw new TypeError(gapped_board); }
        const gapped_layer = board_layer(gapped_board);
        const result = gapped_layer.suggest_values!("cs-gpios", { devicetree, data: "{}", placement: { node_path: spi0, parent_path: "/soc", siblings: [] } }, []);
        expect(result).toHaveLength(1);
        expect(result[0]!.rows).toStrictEqual([
            [{ label: "gpio" }, 8n, { macro: "GPIO_ACTIVE_LOW" }],
            [{ label: "gpio" }, 7n, { macro: "GPIO_ACTIVE_LOW" }],
            [0n],
            [{ label: "gpio" }, 18n, { macro: "GPIO_ACTIVE_LOW" }],
        ]);
        expect(result[0]!.display).toContain("<0>");
        expect(result[0]!.note).toContain("CS2 not wired");
    });

    test("board_layer — bundled board cs-gpios has no gaps and no note", () => {
        const result = values("cs-gpios", { devicetree, data: "{}", placement: { node_path: spi0, parent_path: "/soc", siblings: [] } });
        expect(result).toHaveLength(1);
        expect(result[0]!.note).toBeUndefined();
    });

    test("board_layer — interrupt-parent note present when inherited from a non-board controller", () => {
        // The RPI base fixture has a GIC interrupt-controller at the SoC level.
        // When the node's data doesn't set interrupt-parent, the inherited one
        // (gic) differs from the board controller (gpio), so the note fires.
        const gic_dt = DeviceTree.new_from_string(`/dts-v1/;
/ {
    soc {
        interrupt-parent = <&gic>;
        gic: interrupt-controller@ff841000 {
            interrupt-controller;
            #interrupt-cells = <3>;
        };
        gpio: gpio@7e200000 {
            compatible = "brcm,bcm2711-gpio";
            gpio-controller;
            #gpio-cells = <2>;
            interrupt-controller;
            #interrupt-cells = <2>;
        };
        spi0: spi@7e204000 {
            compatible = "brcm,bcm2835-spi";
            #address-cells = <1>;
            #size-cells = <0>;
        };
    };
};`);
        if (typeof gic_dt === "string") { throw new TypeError(gic_dt); }
        const gic_layer = board_layer(board);
        const gic_context: PropertyContext = {
            devicetree: gic_dt,
            data: "{}",
            placement: { node_path: "/soc/spi@7e204000/dev@0", parent_path: "/soc/spi@7e204000", reg: 0n, siblings: [] },
        };
        const result = gic_layer.suggest_values!("interrupts", gic_context, []);
        expect(result.length).toBeGreaterThan(0);
        expect(result[0]?.note).toContain("needs interrupt-parent");
        expect(result[0]?.note).toContain("gic");
    });

    test("board_layer — rdy-gpios at spi0 reg 2 gives interrupt line first (LOW then HIGH)", () => {
        const result = values("rdy-gpios", context(spi0, 2n));
        expect(result.map(s => s.display)).toStrictEqual([
            "gpio 19 GPIO_ACTIVE_LOW — spi_pmod1.int",
            "gpio 19 GPIO_ACTIVE_HIGH — spi_pmod1.int",
        ]);
    });

    test("board_layer — rdy-gpios at spi0 reg 0: GPIO19 (int) comes before GPIO22 (gpio)", () => {
        const result = values("rdy-gpios", context(spi0, 0n));
        const gpios = result.map(s => s.rows[0]![1]);
        expect(gpios[0]).toBe(19n);
        const gpio22_index = gpios.indexOf(22n);
        expect(gpio22_index).toBeGreaterThan(0);
    });

    test("board_layer — irq-gpios on i2c1 includes psm.alert with open-drain note", () => {
        const result = values("irq-gpios", context(i2c1));
        const psm = result.filter(s => s.slots?.includes("psm"));
        expect(psm.length).toBeGreaterThan(0);
        expect(psm[0]?.note).toBe("open-drain line: needs a pull-up");
    });

    test("board_layer — nreset-gpios gives only the reset line", () => {
        const result = values("nreset-gpios", context(spi0, 1n));
        expect(result.every(s => s.slots?.includes("spi_pmod2"))).toBe(true);
        expect(result[0]?.rows[0]![1]).toBe(12n);
    });

    test("board_layer — interrupt-parent note absent when data has interrupt-parent: gpio", () => {
        const gpio_context: PropertyContext = {
            devicetree,
            data: JSON.stringify({ "interrupt-parent": "gpio" }),
            placement: { node_path: "/soc/spi@7e204000/dev@0", parent_path: "/soc/spi@7e204000", reg: 0n, siblings: [] },
        };
        const result = layer.suggest_values!("interrupts", gpio_context, []);
        expect(result.length).toBeGreaterThan(0);
        for (const s of result) {
            expect(s.note ?? "").not.toContain("needs interrupt-parent");
        }
    });

    test("board_layer — refine_properties is idempotent", () => {
        const ctx = context(spi0, 0n);
        const props: ResolvedProperty[] = [{ key: "reg", value: { _t: "number" } }];
        const once = layer.refine_properties!(props, ctx);
        const twice = layer.refine_properties!(once, ctx);
        expect(twice).toStrictEqual(once);
    });

    test("board_layer — suggest_placement keeps a board bus with no slots", () => {
        const slotless_board = parse_board_description(`
schema_version: 3
board: SLOTLESS
gpio_controller: "&gpio"
buses:
  i2c1:
    node: "&i2c1"
slots: {}
`);
        if (typeof slotless_board === "string") { throw new TypeError(slotless_board); }
        const slotless_layer = board_layer(slotless_board);
        const lower: PlacementSuggestion[] = [
            { parent: { path: ["/", "soc", "i2c@7e804000"], label: "i2c1" }, display: "i2c1", source: "devicetree" },
        ];
        const result = slotless_layer.suggest_placement!({ required_properties: [], properties: [], examples: [] }, devicetree, lower);
        expect(result).toHaveLength(1);
        expect(result[0]?.parent.label).toBe("i2c1");
    });
}
