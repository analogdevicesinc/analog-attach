import { ResolvedProperty } from "../Bindings/ParsedBinding.js";
import { AttachEnumType, is_open, type Cell, type List } from "../Bindings/StructuralTypes.js";
import { DeviceTree, DTNode, get_full_node_name, number_property, type AddressCells, type LocatedNode } from "../Devicetree/index.js";
import { chip_selects_of, type ChipSelects } from "../Devicetree/RegConflicts.js";
import { NodePlacement, PropertyContext, ValueSuggestion } from "./layers/types.js";

/** What a node's `reg` depends on: its parent's cells, and the chip selects of an SPI controller. */
export type RegBus = {
    cells: AddressCells;
    /** When the parent is an SPI controller whose node names its chip selects. */
    chip_selects?: ChipSelects;
};

/**
 * The node's parent in the context devicetree: the placement's parent, else the
 * first node whose full name is `parent_name`.
 */
export function context_parent(context: PropertyContext): LocatedNode | undefined {
    const dt = context.devicetree;
    if (context.placement !== undefined) {
        const node = dt.node_at(context.placement.parent_path);
        return node === undefined ? undefined : { node, path: context.placement.parent_path };
    }
    if (context.parent_name === undefined) { return undefined; }
    return dt.as_stream().filter(({ node }) => get_full_node_name(node) === context.parent_name).toArray()[0];
}

/** `#address-cells` / `#size-cells`, 1 and 0 when unset, as `address_cells_of` reads them. */
function cells_of(node: DTNode): AddressCells {
    return {
        address: Number(number_property(node, "#address-cells") ?? 1n),
        size: Number(number_property(node, "#size-cells") ?? 0n),
    };
}

/** `chip_selects_of` the controller, its GPIO providers looked up in `devicetree`. */
export function chip_select_count(devicetree: DeviceTree, controller: DTNode): ChipSelects | undefined {
    return chip_selects_of(controller, provider => {
        const located = devicetree.locate(provider);
        return located === undefined ? undefined : number_property(located.node, "#gpio-cells");
    });
}

/** The one value a binding gives a cell count: its `const` (a one-option enum) or its default. */
function pinned_count(definition: ResolvedProperty | undefined): bigint | undefined {
    if (definition?.value._t !== "scalar") { return undefined; }
    const { cell } = definition.value;
    const only = cell._t === "enum" && cell.enum.length === 1 ? cell.enum[0] : undefined;
    const count = only ?? definition.value.default;
    return typeof count === "bigint" ? count : undefined;
}

/**
 * The `#address-cells` / `#size-cells` a node gives its children: the ones its
 * data (`node_data_json`) sets, else the ones its binding pins, else 1 and 0.
 */
export function own_cells(properties: ResolvedProperty[], data: string): AddressCells {
    const parsed: Record<string, unknown> = JSON.parse(data);
    const count = (name: string, fallback: bigint): number => {
        const set = parsed[name];
        const value = Array.isArray(set) ? set[0] : set;
        if (typeof value === "number" || typeof value === "bigint") { return Number(value); }
        return Number(pinned_count(properties.find(p => p.key === name)) ?? fallback);
    };
    return { address: count("#address-cells", 1n), size: count("#size-cells", 0n) };
}

/**
 * The bus of the node in `context`: `context.parent_cells` when the consumer
 * gives them (the node's own, for its child nodes), else its parent's. Undefined
 * when the parent isn't known.
 */
export function reg_bus(context: PropertyContext): RegBus | undefined {
    if (context.parent_cells !== undefined) { return { cells: context.parent_cells }; }
    const parent = context_parent(context);
    if (parent === undefined) { return undefined; }
    const cells = cells_of(parent.node);
    const chip_selects = cells.address === 1 && cells.size === 0 ? chip_select_count(context.devicetree, parent.node) : undefined;
    return chip_selects === undefined ? { cells } : { cells, chip_selects };
}

/** A number cell no larger than `maximum`; any other cell as it is. */
function at_most(cell: Cell, maximum: bigint): Cell {
    if (cell._t !== "number" || (cell.maximum !== undefined && cell.maximum <= maximum)) { return cell; }
    return { ...cell, maximum };
}

/** The list with each of its number cells no larger than `maximum`. */
function list_at_most(list: List, maximum: bigint): List {
    return { ...list, item: Array.isArray(list.item) ? list.item.map(cell => at_most(cell, maximum)) : at_most(list.item, maximum) };
}

/**
 * A `reg` the binding leaves open, as rows of the parent's `#address-cells` +
 * `#size-cells` uint32 cells. Under an SPI controller with a `num-cs`, a chip
 * select below its count, also in a `reg` the binding types (spi-peripheral-props'
 * 0 to 256); any other typed `reg` is kept.
 */
function refine_reg(property: ResolvedProperty, bus: RegBus | undefined): void {
    const value = property.value;
    if (property.key !== "reg" || bus === undefined || bus.cells.address === 0) { return; }
    if (value._t !== "list" && value._t !== "matrix") { return; }

    const last = bus.chip_selects?.bounded === true ? BigInt(bus.chip_selects.count - 1) : undefined;
    if (!is_open(value)) {
        if (last === undefined) { return; }
        property.value = value._t === "list" ? list_at_most(value, last) : { ...value, rows: value.rows.map(row => list_at_most(row, last)) };
        return;
    }

    const width = bus.cells.address + bus.cells.size;
    const cell: Cell = { _t: "number", minimum: 0n, maximum: last ?? 0xFF_FF_FF_FFn };
    property.value = {
        _t: "matrix",
        ...(value.minItems === undefined ? {} : { minItems: value.minItems }),
        ...(value.maxItems === undefined ? {} : { maxItems: value.maxItems }),
        ...(value.description === undefined ? {} : { description: value.description }),
        rows: [{ _t: "list", item: cell, minItems: width, maxItems: width }],
    };
}

/**
 * `refine_reg` over a node's properties, `bus` being the node's and `own` the
 * cells it gives its children: a child node the binding names (a `node`
 * property) reads its `reg` with them.
 */
export function refine_regs(properties: ResolvedProperty[], bus: RegBus | undefined, own: AddressCells): void {
    for (const property of properties) {
        if (property.value._t === "node") {
            refine_regs(property.value.properties, { cells: own }, own_cells(property.value.properties, "{}"));
        } else {
            refine_reg(property, bus);
        }
    }
}

/**
 * `reg` matching the node's unit address (`channel@1` → `<1>`, `temp@48` →
 * `<0x48>`): by devicetree convention the first `reg` cell is the unit
 * address. Only single-cell unit addresses are handled.
 */
function unit_address_reg(node_path: string): ValueSuggestion | undefined {
    const name = node_path.slice(node_path.lastIndexOf("/") + 1);
    const unit = /@([0-9a-fA-F]+)$/.exec(name)?.[1];
    if (unit === undefined) { return undefined; }
    const value = BigInt(`0x${unit}`);
    return {
        rows: [[value]],
        display: `${value < 10n ? value : `0x${unit}`} — matches the unit address of ${name}`,
        source: "devicetree",
    };
}

/**
 * The values of `reg`: the node's unit address, then, under an SPI controller
 * whose node names its chip selects (`num-cs`, `cs-gpios`), the free ones and
 * the ones its siblings use (noted `in use by <sibling>`), in order. A chip
 * select the unit address names isn't repeated: the unit address one carries
 * its note, or, past them, `no cs-gpios entry` (as `chip_select_overflows`
 * reports it) or `past the controller's <n> chip selects` (`num-cs`).
 */
export function suggest_reg(property: string, context: PropertyContext): ValueSuggestion[] {
    const placement = context.placement;
    if (property !== "reg" || placement === undefined) { return []; }

    const unit = unit_address_reg(placement.node_path);
    const chip_selects = reg_bus(context)?.chip_selects;
    if (chip_selects === undefined) { return unit === undefined ? [] : [unit]; }
    const count = BigInt(chip_selects.count);

    const owners = new Map<bigint, string>();
    for (const sibling of placement.siblings) {
        if (sibling.reg !== undefined && !owners.has(sibling.reg)) { owners.set(sibling.reg, sibling.name); }
    }
    const in_use = (chip_select: bigint): { note?: string } => {
        const owner = owners.get(chip_select);
        if (owner !== undefined) { return { note: `in use by ${owner}` }; }
        if (chip_select < count) { return {}; }
        return { note: chip_selects.bounded ? `past the controller's ${count} chip selects` : "no cs-gpios entry" };
    };

    const unit_value = unit?.rows[0]?.[0];
    const free: ValueSuggestion[] = [];
    const used: ValueSuggestion[] = [];
    for (let chip_select = 0n; chip_select < count; chip_select++) {
        if (chip_select === unit_value) { continue; }
        const note = in_use(chip_select);
        if (note.note === undefined) {
            free.push({ rows: [[chip_select]], display: `${chip_select} — free chip select`, source: "devicetree" });
        } else {
            used.push({ rows: [[chip_select]], display: `${chip_select}`, source: "devicetree", ...note });
        }
    }
    return [...(unit === undefined ? [] : [{ ...unit, ...(typeof unit_value === "bigint" ? in_use(unit_value) : {}) }]), ...free, ...used];
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    const dts = (source: string) => {
        const dt = DeviceTree.new_from_string(source);
        if (typeof dt === "string") { throw new TypeError(dt); }
        return dt;
    };
    const devicetree = dts(`/dts-v1/;
/ {
    gpio: gpio@7e200000 {
        compatible = "brcm,bcm2711-gpio";
        gpio-controller;
        #gpio-cells = <2>;
    };
    soc {
        #address-cells = <1>;
        #size-cells = <1>;
        spi0: spi@7e204000 {
            #address-cells = <1>;
            #size-cells = <0>;
            cs-gpios = <&gpio 8 1>, <0>, <&gpio 7 1>;
        };
        spi1: spi@7e215080 {
            #address-cells = <1>;
            #size-cells = <0>;
            num-cs = <4>;
            cs-gpios = <&gpio 18 1>;
        };
        spi2: spi@7e2150c0 {
            #address-cells = <1>;
            #size-cells = <0>;
        };
        spi3: spi@7e215100 {
            #address-cells = <1>;
            #size-cells = <0>;
            num-cs = <2>;
            cs-gpios = <&gpio 4 1>, <&gpio 5 1>, <&gpio 6 1>;
        };
        wide@1000 {
            #address-cells = <2>;
            #size-cells = <2>;
        };
    };
};`);

    const open_reg = (): ResolvedProperty => ({ key: "reg", value: { _t: "matrix", minItems: 1, maxItems: 2, rows: [{ _t: "list", item: { _t: "any" } }] } });
    const refined = (context: Omit<PropertyContext, "devicetree" | "data">, property: ResolvedProperty = open_reg(), data = "{}") => {
        const properties = [property];
        const full: PropertyContext = { devicetree, data, ...context };
        refine_regs(properties, reg_bus(full), own_cells(properties, data));
        return properties[0]!.value;
    };
    const row = (cells: number, maximum: bigint) => ({ _t: "list", item: { _t: "number", minimum: 0n, maximum }, minItems: cells, maxItems: cells });
    const typed = (maximum: bigint): ResolvedProperty => ({ key: "reg", value: { _t: "matrix", minItems: 1, maxItems: 1, rows: [{ _t: "list", item: { _t: "number", minimum: 0n, maximum }, minItems: 1, maxItems: 1 }] } });
    const child = (): ResolvedProperty => ({ key: "port@0", value: { _t: "node", properties: [open_reg()] } });
    const reg_of = (value: ResolvedProperty["value"]) => value._t === "node" ? value.properties[0]!.value : undefined;
    const pinned = (key: string, value: bigint): ResolvedProperty => ({ key, value: { _t: "scalar", cell: { _t: "enum", enum: [value], enum_type: AttachEnumType.NUMBER }, default: value } });

    test("refine_regs — an open reg is rows of the parent's address + size cells", () => {
        expect(refined({ parent_name: "soc" })).toStrictEqual({ _t: "matrix", minItems: 1, maxItems: 2, rows: [row(2, 0xFF_FF_FF_FFn)] });
        expect(refined({ parent_name: "wide@1000" })).toMatchObject({ rows: [row(4, 0xFF_FF_FF_FFn)] });
        // the placement's parent before parent_name
        expect(refined({ parent_name: "soc", placement: { node_path: "/soc/wide@1000/x@0", parent_path: "/soc/wide@1000", siblings: [] } })).toMatchObject({ rows: [row(4, 0xFF_FF_FF_FFn)] });
        // an SPI controller that doesn't count its chip selects: one uint32
        expect(refined({ parent_name: "spi@7e2150c0" })).toMatchObject({ rows: [row(1, 0xFF_FF_FF_FFn)] });
        // reg.yaml's `reg`: rows of 1 to 5 whole uint32s
        const uint32_reg: ResolvedProperty = { key: "reg", value: { _t: "matrix", minItems: 1, maxItems: 2,
            rows: [{ _t: "list", item: { _t: "number", minimum: 0n, maximum: 0xFF_FF_FF_FFn }, minItems: 1, maxItems: 5, typeSize: 32 }] } };
        expect(refined({ parent_name: "soc" }, uint32_reg)).toStrictEqual({ _t: "matrix", minItems: 1, maxItems: 2, rows: [row(2, 0xFF_FF_FF_FFn)] });
    });

    test("refine_regs — no parent, or one with no addresses, leaves reg as it is", () => {
        expect(refined({})).toStrictEqual(open_reg().value);
        expect(refined({ parent_name: "no-such-node" })).toStrictEqual(open_reg().value);
        const zero = dts("/dts-v1/;\n/ { bus { #address-cells = <0>; }; };");
        const properties = [open_reg()];
        refine_regs(properties, reg_bus({ devicetree: zero, data: "{}", parent_name: "bus" }), own_cells(properties, "{}"));
        expect(properties[0]!.value).toStrictEqual(open_reg().value);
    });

    test("refine_regs — under an SPI controller with a num-cs, a chip select below the larger of it and the cs-gpios entries", () => {
        // num-cs = <4> over one cs-gpios entry
        expect(refined({ parent_name: "spi@7e215080" })).toMatchObject({ rows: [row(1, 3n)] });
        // three cs-gpios entries over num-cs = <2>
        expect(refined({ parent_name: "spi@7e215100" })).toMatchObject({ rows: [row(1, 2n)] });
        // cs-gpios alone bound nothing: the driver may have more chip selects
        expect(refined({ parent_name: "spi@7e204000" })).toMatchObject({ rows: [row(1, 0xFF_FF_FF_FFn)] });
    });

    test("refine_regs — a typed reg is kept, only narrowed to the controller's chip selects", () => {
        expect(refined({ parent_name: "spi@7e215080" }, typed(256n))).toStrictEqual(typed(3n).value);
        // tighter already
        expect(refined({ parent_name: "spi@7e215080" }, typed(1n))).toStrictEqual(typed(1n).value);
        // no num-cs, or not a chip select
        expect(refined({ parent_name: "spi@7e204000" }, typed(256n))).toStrictEqual(typed(256n).value);
        expect(refined({ parent_name: "soc" }, typed(256n))).toStrictEqual(typed(256n).value);
    });

    test("refine_regs — parent_cells come before the tree's", () => {
        expect(refined({ parent_name: "spi@7e204000", parent_cells: { address: 1, size: 1 } })).toMatchObject({ rows: [row(2, 0xFF_FF_FF_FFn)] });
    });

    test("refine_regs — a child node the binding names reads its reg with the node's own cells", () => {
        // the node's data sets them
        expect(reg_of(refined({ parent_name: "soc" }, child(), JSON.stringify({ "#address-cells": [2], "#size-cells": [0] })))).toMatchObject({ rows: [row(2, 0xFF_FF_FF_FFn)] });
        // unset: 1 and 0, not the soc's
        expect(reg_of(refined({ parent_name: "soc" }, child()))).toMatchObject({ rows: [row(1, 0xFF_FF_FF_FFn)] });
    });

    test("own_cells — the node's data, else the counts its binding pins, else 1 and 0", () => {
        const binding = [pinned("#address-cells", 2n), pinned("#size-cells", 1n)];
        expect(own_cells(binding, JSON.stringify({ "#address-cells": [3] }))).toStrictEqual({ address: 3, size: 1 });
        expect(own_cells(binding, "{}")).toStrictEqual({ address: 2, size: 1 });
        expect(own_cells([], "{}")).toStrictEqual({ address: 1, size: 0 });
    });

    const suggested = (node_path: string, siblings: NodePlacement["siblings"]) => suggest_reg("reg", {
        devicetree, data: "{}", placement: { node_path, parent_path: node_path.slice(0, node_path.lastIndexOf("/")), siblings },
    }).map(s => [s.rows, s.display, s.note]);

    test("suggest_reg — the unit address, then the free chip selects, then the ones in use", () => {
        expect(suggested("/soc/spi@7e204000/adc@1", [{ name: "spidev@0", reg: 0n }])).toStrictEqual([
            [[[1n]], "1 — matches the unit address of adc@1", undefined],
            [[[2n]], "2 — free chip select", undefined],
            [[[0n]], "0", "in use by spidev@0"],
        ]);
    });

    test("suggest_reg — a unit address in use carries the note", () => {
        expect(suggested("/soc/spi@7e204000/adc@0", [{ name: "spidev@0", reg: 0n }])[0]).toStrictEqual([[[0n]], "0 — matches the unit address of adc@0", "in use by spidev@0"]);
    });

    test("suggest_reg — a unit address past the chip selects the controller names is noted", () => {
        // three cs-gpios entries, a <0> one (a native chip select) among them
        expect(suggested("/soc/spi@7e204000/adc@3", [])[0]).toStrictEqual([[[3n]], "3 — matches the unit address of adc@3", "no cs-gpios entry"]);
        expect(suggested("/soc/spi@7e215080/adc@4", [])[0]).toStrictEqual([[[4n]], "4 — matches the unit address of adc@4", "past the controller's 4 chip selects"]);
    });

    test("suggest_reg — no chip selects without a count, nor off an SPI bus", () => {
        expect(suggested("/soc/spi@7e2150c0/adc@1", [])).toStrictEqual([[[[1n]], "1 — matches the unit address of adc@1", undefined]]);
        expect(suggested("/soc/wide@1000/mem@0", [])).toStrictEqual([[[[0n]], "0 — matches the unit address of mem@0", undefined]]);
        expect(suggested("/soc/spi@7e204000/adc", [])).toStrictEqual([
            [[[0n]], "0 — free chip select", undefined],
            [[[1n]], "1 — free chip select", undefined],
            [[[2n]], "2 — free chip select", undefined],
        ]);
        expect(suggest_reg("clocks", { devicetree, data: "{}", placement: { node_path: "/soc/spi@7e204000/adc@1", parent_path: "/soc/spi@7e204000", siblings: [] } })).toStrictEqual([]);
    });
}
