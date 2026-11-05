import { DeviceTree } from "../DeviceTree.js";
import { DeviceTreeOverlay } from "../DeviceTreeOverlay.js";
import { number_property } from "../nodes/Access.js";
import { type CellArrayElement, type DTNode, type DTProperty, is_dt_flag } from "../syntax/AST.js";
import { PropertyBuilder } from "../build/PropertyBuilder.js";
import { address_cells_of } from "../nodes/UnitAddress.js";

/** Two enabled siblings whose `reg` claims the same address. */
export interface RegConflict {
    parent_path: string;
    /** The two nodes' full names (name@unit), in tree order. */
    nodes: [string, string];
    /** The first address both claim. */
    address: bigint;
    /** Whether the overlay adds each node or sets its reg or status; false means its claim comes from the base tree. */
    in_overlay: [boolean, boolean];
}

/** The chip selects an SPI controller's node names: 0 to `count - 1`. */
export interface ChipSelects {
    count: number;
    /**
     * Whether they are all it has: its `num-cs` says so. Without it the driver's own count may be larger than the
     * `cs-gpios` entries, and the chip selects past them have no line of the tree.
     */
    bounded: boolean;
}

/** An enabled device whose chip select is past the ones its controller names (`chip_selects_of`). */
export interface ChipSelectOverflow {
    parent_path: string;
    /** The device's full name (name@unit). */
    node: string;
    chip_select: bigint;
    /** The controller's chip selects. */
    chip_selects: ChipSelects;
    /** Whether the overlay adds the node or sets its reg or status; false means its claim comes from the base tree. */
    in_overlay: boolean;
}

export interface RegEntry {
    address: bigint;
    size: bigint;
}

const join_cells = (cells: bigint[]): bigint => cells.reduce((result, cell) => (result << 32n) | cell, 0n);

/**
 * The (address, size) entries of a `reg`, read with the parent's cell counts.
 * Undefined when it doesn't decode: a flag, a phandle or expression cell, a
 * cell count that doesn't divide, or a parent without addresses.
 */
export function reg_entries(reg: DTProperty, address_cells: number, size_cells: number): RegEntry[] | undefined {
    if (is_dt_flag(reg.value) || address_cells === 0) { return undefined; }
    const values: bigint[] = [];
    for (const value of reg.value) {
        if (value.kind !== "array") { return undefined; }
        for (const element of value.elements) {
            if (element.kind !== "number") { return undefined; }
            values.push(element.value & 0xFF_FF_FF_FFn);
        }
    }
    const width = address_cells + size_cells;
    if (values.length === 0 || values.length % width !== 0) { return undefined; }

    const entries: RegEntry[] = [];
    for (let index = 0; index < values.length; index += width) {
        entries.push({
            address: join_cells(values.slice(index, index + address_cells)),
            size: join_cells(values.slice(index + address_cells, index + width)),
        });
    }
    return entries;
}

/** Whether the node is operational: no status, or "okay" / "ok". */
export function is_active(node: DTNode): boolean {
    const status = node.properties.find(p => p.name === "status");
    if (status === undefined || is_dt_flag(status.value)) { return true; }
    const first = status.value[0];
    return first?.kind === "string" && (first.value === "okay" || first.value === "ok");
}

/**
 * Enabled siblings with clashing `reg`, over base and overlay merged, in the
 * whole tree. Without size cells (SPI chip selects, I2C addresses) equal
 * addresses clash; with them, ranges that overlap. Buses are checked whatever
 * their own status: a bus is often enabled later, and its devices clash then.
 */
export function reg_conflicts(overlay: DeviceTreeOverlay): RegConflict[] {
    const conflicts: RegConflict[] = [];
    const walk = (path: string): void => {
        conflicts.push(...sibling_reg_conflicts(overlay, path));
        for (const name of overlay.effective_children(path).keys()) {
            walk(path === "/" ? `/${name}` : `${path}/${name}`);
        }
    };
    walk("/");
    return conflicts;
}

/** The clashes among the children of one node (see `reg_conflicts`). */
export function sibling_reg_conflicts(overlay: DeviceTreeOverlay, parent_path: string): RegConflict[] {
    const cells = address_cells_of(overlay, parent_path);
    const child_path = (name: string): string => parent_path === "/" ? `/${name}` : `${parent_path}/${name}`;

    const claims: { name: string; entries: RegEntry[] }[] = [];
    for (const [name, child] of overlay.effective_children(parent_path)) {
        if (!is_active(child)) { continue; }
        const reg = child.properties.find(p => p.name === "reg");
        const entries = reg === undefined ? undefined : reg_entries(reg, cells.address, cells.size);
        if (entries !== undefined) { claims.push({ name, entries }); }
    }

    const conflicts: RegConflict[] = [];
    for (const [index, a] of claims.entries()) {
        for (const b of claims.slice(index + 1)) {
            const address = shared_address(a.entries, b.entries, cells.size > 0);
            if (address === undefined) { continue; }
            conflicts.push({
                parent_path,
                nodes: [a.name, b.name],
                address,
                in_overlay: [changes_claim(overlay, child_path(a.name)), changes_claim(overlay, child_path(b.name))],
            });
        }
    }
    return conflicts;
}

/**
 * Enabled devices whose chip select is past the ones their controller names
 * (`chip_selects_of`), in the whole tree: past its `num-cs`, or without one,
 * with no entry in its `cs-gpios`. Controllers with neither aren't checked:
 * how many chip selects they have is up to the driver.
 */
export function chip_select_overflows(overlay: DeviceTreeOverlay): ChipSelectOverflow[] {
    const overflows: ChipSelectOverflow[] = [];
    const walk = (path: string): void => {
        overflows.push(...sibling_chip_select_overflows(overlay, path));
        for (const name of overlay.effective_children(path).keys()) {
            walk(path === "/" ? `/${name}` : `${path}/${name}`);
        }
    };
    walk("/");
    return overflows;
}

/** The overflows among the children of one controller (see `chip_select_overflows`). */
export function sibling_chip_select_overflows(overlay: DeviceTreeOverlay, parent_path: string): ChipSelectOverflow[] {
    const controller = overlay.effective_node(parent_path);
    const gpio_cells = (provider: string): bigint | undefined => {
        const located = overlay.get_base_dts()?.locate(provider);
        const node = located === undefined ? undefined : overlay.effective_node(located.path);
        return node === undefined ? undefined : number_property(node, "#gpio-cells");
    };
    const chip_selects = controller === undefined ? undefined : chip_selects_of(controller, gpio_cells);
    if (chip_selects === undefined) { return []; }

    const cells = address_cells_of(overlay, parent_path);
    const child_path = (name: string): string => parent_path === "/" ? `/${name}` : `${parent_path}/${name}`;

    const overflows: ChipSelectOverflow[] = [];
    for (const [name, child] of overlay.effective_children(parent_path)) {
        if (!is_active(child)) { continue; }
        const reg = child.properties.find(p => p.name === "reg");
        const entries = reg === undefined ? undefined : reg_entries(reg, cells.address, cells.size);
        const entry = entries?.find(candidate => candidate.address >= BigInt(chip_selects.count));
        if (entry === undefined) { continue; }
        overflows.push({ parent_path, node: name, chip_select: entry.address, chip_selects, in_overlay: changes_claim(overlay, child_path(name)) });
    }
    return overflows;
}

/**
 * The chip selects an SPI controller's node names, as Linux's SPI core counts
 * them: the larger of `num-cs` (the driver's count, when it reads it) and the
 * entries of `cs-gpios` (where a `<0>` entry is a native chip select), bounded
 * by `num-cs` only. `gpio_cells` is as in `gpio_specifier_count`. Undefined when
 * the controller has neither, or a `cs-gpios` whose entries can't be counted:
 * the count is then the driver's alone.
 */
export function chip_selects_of(controller: DTNode, gpio_cells: (provider: string) => bigint | undefined): ChipSelects | undefined {
    const declared = number_property(controller, "num-cs");
    const cs_gpios = controller.properties.find(p => p.name === "cs-gpios");
    const lines = cs_gpios === undefined ? undefined : gpio_specifier_count(cs_gpios, gpio_cells);
    if (cs_gpios !== undefined && lines === undefined) { return undefined; }
    if (declared === undefined && lines === undefined) { return undefined; }
    const count = Math.max(Number(declared ?? 0n), lines ?? 0);
    return count === 0 ? undefined : { count, bounded: declared !== undefined };
}

/**
 * How many entries a GPIO specifier list has: a phandle followed by its
 * provider's `#gpio-cells`, or a lone 0 (in `cs-gpios`, the controller's own
 * chip select). `gpio_cells` gives the `#gpio-cells` of the provider a phandle
 * names (its label, or its path). Undefined when a provider or its cell count
 * is unknown.
 */
function gpio_specifier_count(property: DTProperty, gpio_cells: (provider: string) => bigint | undefined): number | undefined {
    if (is_dt_flag(property.value)) { return undefined; }
    const elements: CellArrayElement[] = [];
    for (const value of property.value) {
        if (value.kind !== "array") { return undefined; }
        elements.push(...value.elements);
    }

    let count = 0;
    let index = 0;
    while (index < elements.length) {
        const element = elements[index];
        if (element?.kind === "number" && element.value === 0n) {
            index += 1;
        } else if (element?.kind === "label" || element?.kind === "path") {
            const cells = gpio_cells(element.kind === "label" ? element.name : element.path);
            if (cells === undefined) { return undefined; }
            index += 1 + Number(cells);
        } else {
            return undefined;
        }
        count += 1;
    }
    return count;
}

/**
 * Whether the overlay adds the node or sets its reg or status, the only ways
 * it can make the node clash. A base node the overlay only adds children to
 * (pin groups under gpio) keeps the clashes it has in the base.
 */
function changes_claim(overlay: DeviceTreeOverlay, path: string): boolean {
    const found = overlay.find_node(path);
    if (found === undefined) { return false; }
    return !found.is_in_base || found.node.properties.some(p => p.name === "reg" || p.name === "status");
}

/** The first address two regs both claim. A size of 0 still claims its address. */
function shared_address(a: RegEntry[], b: RegEntry[], ranges: boolean): bigint | undefined {
    for (const x of a) {
        for (const y of b) {
            if (!ranges) {
                if (x.address === y.address) { return x.address; }
                continue;
            }
            const x_end = x.address + (x.size > 0n ? x.size : 1n);
            const y_end = y.address + (y.size > 0n ? y.size : 1n);
            // eslint-disable-next-line unicorn/prefer-math-min-max -- bigint
            if (x.address < y_end && y.address < x_end) { return x.address > y.address ? x.address : y.address; }
        }
    }
    return undefined;
}

if (import.meta.vitest) {
    /* eslint-disable unicorn/numeric-separators-style */
    const { test, expect } = import.meta.vitest;

    const setup = (base_source: string, overlay_source: string): DeviceTreeOverlay => {
        const base = DeviceTree.new_from_string(`/dts-v1/;\n/ {\n${base_source}\n};`);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DeviceTreeOverlay.new_from_string(`/dts-v1/;\n/plugin/;\n\n${overlay_source}`, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }
        return overlay;
    };

    const spi = (children: string): string => `\tsoc {\n\t\tspi0: spi@7e204000 {\n\t\t\t#address-cells = <1>;\n\t\t\t#size-cells = <0>;\n${children}\n\t\t};\n\t};`;

    const cells = (...values: bigint[]): DTProperty => PropertyBuilder.build_cell_array()
        .with_cells(...values)
        .with_name("reg")
        .build();

    test("reg_entries — splits reg into address/size pairs", () => {
        expect(reg_entries(cells(0x10n, 0x100n, 0x400n, 0x10n), 1, 1)).toEqual([{ address: 0x10n, size: 0x100n }, { address: 0x400n, size: 0x10n }]);
        expect(reg_entries(cells(0x1n, 0x2n, 0x100n), 2, 1)).toEqual([{ address: 0x1_0000_0002n, size: 0x100n }]);
        expect(reg_entries(cells(3n), 1, 0)).toEqual([{ address: 3n, size: 0n }]);
    });

    test("reg_entries — a reg that doesn't decode is undefined", () => {
        expect(reg_entries(cells(1n, 2n, 3n), 1, 1)).toBeUndefined();
        expect(reg_entries(cells(1n), 0, 0)).toBeUndefined();
        expect(reg_entries(PropertyBuilder.build_flag().set_flag().with_name("reg").build(), 1, 0)).toBeUndefined();
    });

    const node = (status?: string): DTNode => {
        const tree = DeviceTree.new_from_string(`/dts-v1/;\n/ {\n\tn {${status === undefined ? "" : ` status = "${status}";`} };\n};`);
        if (typeof tree === "string") { throw new TypeError(tree); }
        const found = tree.node_at("/n");
        if (found === undefined) { throw new TypeError("no /n"); }
        return found;
    };

    test("is_active — status absent, okay or ok", () => {
        expect(is_active(node())).toBe(true);
        expect(is_active(node("okay"))).toBe(true);
        expect(is_active(node("ok"))).toBe(true);
        expect(is_active(node("disabled"))).toBe(false);
        expect(is_active(node("reserved"))).toBe(false);
    });

    test("reg_conflicts — an overlay device on a taken chip select", () => {
        const overlay = setup(spi("\t\t\tspidev@0 { reg = <0>; };"), "&spi0 {\n\tadc@0 { reg = <0>; };\n};");
        expect(reg_conflicts(overlay)).toEqual([
            { parent_path: "/soc/spi@7e204000", nodes: ["spidev@0", "adc@0"], address: 0n, in_overlay: [false, true] },
        ]);
    });

    test("reg_conflicts — the unit address doesn't matter, reg does", () => {
        const overlay = setup(spi("\t\t\tspidev@0 { reg = <0>; };"), "&spi0 {\n\tadc@1 { reg = <0>; };\n\tadc@2 { reg = <2>; };\n};");
        expect(reg_conflicts(overlay).map(c => c.nodes)).toEqual([["spidev@0", "adc@1"]]);
    });

    test("reg_conflicts — overlapping MMIO ranges", () => {
        const overlay = setup(
            "\t#address-cells = <1>;\n\t#size-cells = <1>;\n\tuart@1000 { reg = <0x1000 0x100>; };\n\ttimer@2000 { reg = <0x2000 0x100>; };",
            "&{/} {\n\tdma@1080 { reg = <0x1080 0x10>; };\n\tpwm@1100 { reg = <0x1100 0x10>; };\n};",
        );
        expect(reg_conflicts(overlay)).toEqual([
            { parent_path: "/", nodes: ["uart@1000", "dma@1080"], address: 0x1080n, in_overlay: [false, true] },
        ]);
    });

    test("reg_conflicts — a disabled base node never conflicts", () => {
        const overlay = setup(spi("\t\t\tspidev@0 { reg = <0>; status = \"disabled\"; };"), "&spi0 {\n\tadc@0 { reg = <0>; };\n};");
        expect(reg_conflicts(overlay)).toEqual([]);
    });

    test("reg_conflicts — a base node the overlay disables doesn't count", () => {
        const overlay = setup(spi("\t\t\tspidev0: spidev@0 { reg = <0>; };"), "&spidev0 {\n\tstatus = \"disabled\";\n};\n\n&spi0 {\n\tadc@0 { reg = <0>; };\n};");
        expect(reg_conflicts(overlay)).toEqual([]);
    });

    test("reg_conflicts — a disabled base node the overlay enables does", () => {
        const overlay = setup(spi("\t\t\tspidev0: spidev@0 { reg = <0>; status = \"disabled\"; };"), "&spidev0 {\n\tstatus = \"okay\";\n};\n\n&spi0 {\n\tadc@0 { reg = <0>; };\n};");
        expect(reg_conflicts(overlay).map(c => ({ nodes: c.nodes, in_overlay: c.in_overlay }))).toEqual([
            { nodes: ["spidev@0", "adc@0"], in_overlay: [true, true] },
        ]);
    });

    test("reg_conflicts — a base node the overlay only adds a child to stays on the base side", () => {
        const overlay = setup(
            "\t#address-cells = <1>;\n\t#size-cells = <1>;\n\tgpio: gpio@1000 { reg = <0x1000 0x100>; };\n\tgpiomem { reg = <0x1000 0x1000>; };",
            "&gpio {\n\tpins { brcm,pins = <19>; };\n};",
        );
        expect(reg_conflicts(overlay).map(c => c.in_overlay)).toEqual([[false, false]]);
    });

    test("reg_conflicts — a base node whose reg the overlay sets is on the overlay side", () => {
        const overlay = setup(
            "\t#address-cells = <1>;\n\t#size-cells = <1>;\n\tgpio: gpio@1000 { reg = <0x1000 0x100>; };\n\tgpiomem { reg = <0x2000 0x1000>; };",
            "&gpio {\n\treg = <0x2000 0x100>;\n};",
        );
        expect(reg_conflicts(overlay).map(c => c.in_overlay)).toEqual([[true, false]]);
    });

    test("reg_conflicts — children of a disabled controller are checked too", () => {
        const overlay = setup(spi("\t\t\tspidev@0 { reg = <0>; };"), "&spi0 {\n\tstatus = \"disabled\";\n\tadc@0 { reg = <0>; };\n};");
        expect(reg_conflicts(overlay).map(c => c.nodes)).toEqual([["spidev@0", "adc@0"]]);
    });

    test("reg_conflicts — nested buses; sibling_reg_conflicts checks one bus", () => {
        const overlay = setup(
            spi("\t\t\tspidev@0 { reg = <0>; };"),
            "&spi0 {\n\tadc@1 {\n\t\treg = <1>;\n\t\t#address-cells = <1>;\n\t\t#size-cells = <0>;\n\t\tchannel@0 { reg = <0>; };\n\t\tchannel@1 { reg = <0>; };\n\t};\n};",
        );
        expect(reg_conflicts(overlay).map(c => [c.parent_path, ...c.nodes])).toEqual([
            ["/soc/spi@7e204000/adc@1", "channel@0", "channel@1"],
        ]);
        expect(sibling_reg_conflicts(overlay, "/soc/spi@7e204000")).toEqual([]);
        expect(sibling_reg_conflicts(overlay, "/soc/spi@7e204000/adc@1")).toHaveLength(1);
    });

    const cs_base = (cs_gpios: string): string => `\tgpio: gpio@7e200000 { gpio-controller; #gpio-cells = <2>; };\n\tsoc {\n\t\tspi0: spi@7e204000 {\n\t\t\t#address-cells = <1>;\n\t\t\t#size-cells = <0>;\n${cs_gpios}\n\t\t\tspidev@0 { reg = <0>; };\n\t\t};\n\t};`;

    test("chip_select_overflows — a chip select past the cs-gpios entries", () => {
        const overlay = setup(cs_base("\t\t\tcs-gpios = <&gpio 8 1>, <&gpio 7 1>;"), "&spi0 {\n\tadc@1 { reg = <1>; };\n\tadc@2 { reg = <2>; };\n};");
        expect(chip_select_overflows(overlay)).toEqual([
            { parent_path: "/soc/spi@7e204000", node: "adc@2", chip_select: 2n, chip_selects: { count: 2, bounded: false }, in_overlay: true },
        ]);
    });

    test("chip_select_overflows — entries in one cell array, and 0 for a native chip select", () => {
        const one_array = setup(cs_base("\t\t\tcs-gpios = <&gpio 8 1 &gpio 7 1>;"), "&spi0 {\n\tadc@2 { reg = <2>; };\n};");
        expect(chip_select_overflows(one_array).map(o => o.chip_selects.count)).toEqual([2]);
        const native = setup(cs_base("\t\t\tcs-gpios = <0>, <&gpio 7 1>, <0>;"), "&spi0 {\n\tadc@2 { reg = <2>; };\n};");
        expect(chip_select_overflows(native)).toEqual([]);
    });

    test("chip_select_overflows — the overlay's own cs-gpios counts", () => {
        const overlay = setup(cs_base("\t\t\tcs-gpios = <&gpio 8 1>, <&gpio 7 1>;"), "&spi0 {\n\tcs-gpios = <&gpio 8 1>, <&gpio 7 1>, <&gpio 6 1>;\n\tadc@2 { reg = <2>; };\n};");
        expect(chip_select_overflows(overlay)).toEqual([]);
    });

    test("chip_select_overflows — nothing without cs-gpios or with an unknown provider", () => {
        expect(chip_select_overflows(setup(cs_base(""), "&spi0 {\n\tadc@5 { reg = <5>; };\n};"))).toEqual([]);
        expect(chip_select_overflows(setup(cs_base("\t\t\tcs-gpios = <&nowhere 8 1>;"), "&spi0 {\n\tadc@5 { reg = <5>; };\n};"))).toEqual([]);
    });

    const at_2_and_3 = (declared: string, cs_gpios: string) => setup(cs_base(`${declared}${cs_gpios}`), "&spi0 {\n\tadc@2 { reg = <2>; };\n\tadc@3 { reg = <3>; };\n};");

    test("chip_select_overflows — num-cs counts the chip selects past the cs-gpios entries, and bounds them", () => {
        // num-cs = <3> over one cs-gpios entry: chip select 2 is native, 3 is past them
        expect(chip_select_overflows(at_2_and_3("\t\t\tnum-cs = <3>;\n", "\t\t\tcs-gpios = <&gpio 8 1>;"))).toEqual([
            { parent_path: "/soc/spi@7e204000", node: "adc@3", chip_select: 3n, chip_selects: { count: 3, bounded: true }, in_overlay: true },
        ]);
        // num-cs alone, and three cs-gpios entries over num-cs = <2>
        expect(chip_select_overflows(at_2_and_3("\t\t\tnum-cs = <3>;", "")).map(o => o.node)).toEqual(["adc@3"]);
        expect(chip_select_overflows(at_2_and_3("\t\t\tnum-cs = <2>;\n", "\t\t\tcs-gpios = <&gpio 8 1>, <&gpio 7 1>, <&gpio 6 1>;")).map(o => o.node)).toEqual(["adc@3"]);
        // a cs-gpios that can't be counted leaves the count to the driver
        expect(chip_select_overflows(at_2_and_3("\t\t\tnum-cs = <2>;\n", "\t\t\tcs-gpios = <&nowhere 8 1>;"))).toEqual([]);
    });

    test("chip_select_overflows — a disabled device doesn't count", () => {
        const overlay = setup(cs_base("\t\t\tcs-gpios = <&gpio 8 1>;"), "&spi0 {\n\tadc@1 { reg = <1>; status = \"disabled\"; };\n};");
        expect(chip_select_overflows(overlay)).toEqual([]);
    });
}
