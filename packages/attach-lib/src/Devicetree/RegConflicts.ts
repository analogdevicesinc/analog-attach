import { DeviceTree } from "./Devicetree.js";
import { DeviceTreeOverlay } from "./DevicetreeOverlay.js";
import { type DTNode, type DTProperty, is_dt_flag } from "./Parser/AST.js";
import { PropertyBuilder } from "./PropertyBuilder.js";
import { address_cells_of } from "./UnitAddress.js";

/** Two enabled siblings whose `reg` claims the same address. */
export interface RegConflict {
    parent_path: string;
    /** The two nodes' full names (name@unit), in tree order. */
    nodes: [string, string];
    /** The first address both claim. */
    address: bigint;
    /** Whether each node is added or patched by the overlay; false means it comes from the base tree as is. */
    in_overlay: [boolean, boolean];
}

export interface RegEntry {
    address: bigint;
    size: bigint;
}

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

    const join = (cells: bigint[]): bigint => cells.reduce((result, cell) => (result << 32n) | cell, 0n);
    const entries: RegEntry[] = [];
    for (let index = 0; index < values.length; index += width) {
        entries.push({
            address: join(values.slice(index, index + address_cells)),
            size: join(values.slice(index + address_cells, index + width)),
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
 * whole tree. Children of disabled nodes aren't checked. Without size cells
 * (SPI chip selects, I2C addresses) equal addresses clash; with them, ranges
 * that overlap.
 */
export function reg_conflicts(overlay: DeviceTreeOverlay): RegConflict[] {
    const conflicts: RegConflict[] = [];
    const walk = (path: string): void => {
        conflicts.push(...sibling_reg_conflicts(overlay, path));
        for (const [name, child] of overlay.effective_children(path)) {
            if (is_active(child)) { walk(path === "/" ? `/${name}` : `${path}/${name}`); }
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
                in_overlay: [overlay.find_node(child_path(a.name)) !== undefined, overlay.find_node(child_path(b.name)) !== undefined],
            });
        }
    }
    return conflicts;
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
            if (x.address < y_end && y.address < x_end) { return x.address > y.address ? x.address : y.address; }
        }
    }
    return undefined;
}

if (import.meta.vitest) {
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
        .with_tagged_values(...(values.map(v => PropertyBuilder.tag_number(v)) as [never, ...never[]]))
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

    test("is_active — status absent, okay or ok", () => {
        const node = (status?: string): DTNode => {
            const tree = DeviceTree.new_from_string(`/dts-v1/;\n/ {\n\tn {${status === undefined ? "" : ` status = "${status}";`} };\n};`);
            if (typeof tree === "string") { throw new TypeError(tree); }
            const found = tree.node_at("/n");
            if (found === undefined) { throw new TypeError("no /n"); }
            return found;
        };
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

    test("reg_conflicts — children of a disabled controller are not checked", () => {
        const overlay = setup(spi("\t\t\tspidev@0 { reg = <0>; };"), "&spi0 {\n\tstatus = \"disabled\";\n\tadc@0 { reg = <0>; };\n};");
        expect(reg_conflicts(overlay)).toEqual([]);
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
}
