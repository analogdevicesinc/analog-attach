import type { DTNode, DTProperty } from "./Parser/AST.js";
import { number_property } from "./Access.js";
import { NodeBuilder } from "./NodeBuilder.js";
import { PropertyBuilder } from "./PropertyBuilder.js";
import { choose_label } from "./Labels.js";
import {
    address_cells_of,
    encode_reg_address,
    ensure_address_cells,
    format_unit_address,
    next_free_unit_address,
    parse_unit_address,
} from "./UnitAddress.js";
import { DeviceTree } from "./Devicetree.js";
import { DeviceTreeOverlay } from "./DevicetreeOverlay.js";

export interface AddNodeRequest {
    /** Absolute path of the parent, in the base tree or the overlay. */
    parent_path: string;
    /** Node name, optionally with an explicit unit address (`adc` or `adc@a`). */
    name: string;
    compatible: string;
    /** Explicit label; derived from the compatible when absent. */
    label?: string;
    /**
     * Pick the lowest free unit address (and write `reg`) when `name` has none.
     * Only done under indexed parents (`#size-cells = <0>`, e.g. SPI chip
     * selects or channels); elsewhere `reg` is a memory-mapped address.
     */
    auto_address: boolean;
}

export type AddNodeNote =
    /** The explicit unit address is not hex, so no `reg` was written. */
    | { kind: "non-hex-unit"; unit: string }
    /** The parent has size cells; they were written as 0. */
    | { kind: "reg-size-zero" }
    /** The auto-picked address skipped occupied ones. */
    | { kind: "picked-address"; unit: string; occupants: { name: string; address: bigint }[] }
    /** Auto-addressing was asked for but the parent is not indexed; `reg` must be set by hand. */
    | { kind: "reg-needed" };

export type AddNodeResult =
    | { status: "added"; key: string; path: string; label: string; notes: AddNodeNote[] }
    | { status: "parent-not-found" }
    | { status: "empty-unit-address" }
    | { status: "invalid-label"; label: string }
    | { status: "label-taken"; label: string; owner: string }
    | { status: "duplicate"; key: string };

/**
 * Add a device node under `parent_path`. Nothing is written unless the result
 * is `added`; the parent gains `#address-cells`/`#size-cells` when the new node
 * has a unit address and they are missing.
 */
export function add_node(overlay: DeviceTreeOverlay, request: AddNodeRequest): AddNodeResult {
    const { parent_path, compatible } = request;

    const label = choose_label(request.label, compatible, overlay.all_labels());
    if (label.status === "invalid") { return { status: "invalid-label", label: request.label ?? "" }; }
    if (label.status === "taken") { return { status: "label-taken", label: request.label ?? "", owner: label.owner }; }

    const at = request.name.indexOf("@");
    const base_name = at === -1 ? request.name : request.name.slice(0, at);
    const explicit_unit = at === -1 ? undefined : request.name.slice(at + 1);
    if (explicit_unit === "") { return { status: "empty-unit-address" }; }

    const parent_node = overlay.effective_node(parent_path);
    if (parent_node === undefined) { return { status: "parent-not-found" }; }

    const notes: AddNodeNote[] = [];
    const effective = overlay.effective_children(parent_path);
    const cells = address_cells_of(overlay, parent_path);

    let unit = explicit_unit;
    let address: bigint | undefined;
    if (explicit_unit === undefined) {
        if (request.auto_address && !is_indexed(overlay, parent_path, parent_node)) {
            notes.push({ kind: "reg-needed" });
        } else if (request.auto_address) {
            const free = next_free_unit_address(effective, cells.address);
            address = free.address;
            unit = format_unit_address(free.address);
            if (free.address > 0n) {
                notes.push({ kind: "picked-address", unit, occupants: free.occupants });
            }
        }
    } else {
        address = parse_unit_address(explicit_unit);
        if (address === undefined) { notes.push({ kind: "non-hex-unit", unit: explicit_unit }); }
    }

    const key = unit === undefined ? base_name : `${base_name}@${unit}`;
    if (effective.has(key)) { return { status: "duplicate", key }; }

    const properties: DTProperty[] = [
        PropertyBuilder.build_string().with_value(compatible).with_name("compatible").build(),
    ];
    if (address !== undefined) {
        properties.push(encode_reg_address(address, cells.address, cells.size));
        if (cells.size > 0) { notes.push({ kind: "reg-size-zero" }); }
    }

    if (unit !== undefined) { ensure_address_cells(overlay, parent_path); }
    const parent = overlay.ensure_node(parent_path);
    if (parent === undefined) { return { status: "parent-not-found" }; }

    parent.children.push(NodeBuilder.new()
        .with_name(base_name)
        .with_unit_address(unit)
        .with_label(label.label)
        .with_properties(properties)
        .build());

    const path = `${parent_path === "/" ? "" : parent_path}/${key}`;
    return { status: "added", key, path, label: label.label, notes };
}

/**
 * Whether children of the parent are addressed by index, so the lowest free
 * address is a sensible pick: `#size-cells = <0>`, or an overlay-added parent
 * without cells, which `ensure_address_cells` gives `<0>`.
 */
function is_indexed(overlay: DeviceTreeOverlay, parent_path: string, parent_node: DTNode): boolean {
    const size_cells = number_property(parent_node, "#size-cells");
    if (size_cells !== undefined) { return size_cells === 0n; }
    return overlay.get_base_dts()?.node_at(parent_path) === undefined;
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    const base_dts = `/dts-v1/;
/ {
    #address-cells = <2>;
    soc {
        spi0: spi@7e204000 {
            #address-cells = <1>;
            #size-cells = <0>;
            spidev@0 {
                reg = <0>;
                compatible = "spidev";
            };
            spidev@1 {
                reg = <1>;
                compatible = "spidev";
            };
        };
        spi1: spi@7e205000 {
            #address-cells = <1>;
            #size-cells = <0>;
        };
        bus {
        };
    };
};`;

    const SPI0 = "/soc/spi@7e204000";
    const SPI1 = "/soc/spi@7e205000";

    const setup = (overlay_source = "/dts-v1/;\n/plugin/;\n\n&spi0 {\n};"): DeviceTreeOverlay => {
        const base = DeviceTree.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DeviceTreeOverlay.new_from_string(overlay_source, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }
        return overlay;
    };

    const request = (overrides: Partial<AddNodeRequest>): AddNodeRequest => ({
        parent_path: SPI0, name: "adi,ad7124-8", compatible: "adi,ad7124-8", auto_address: true, ...overrides,
    });

    test("add_node — auto unit address skips occupied siblings and writes reg", () => {
        const overlay = setup();
        const result = add_node(overlay, request({}));

        expect(result).toMatchObject({
            status: "added", key: "adi,ad7124-8@2", path: `${SPI0}/adi,ad7124-8@2`, label: "ad7124_8",
            notes: [{ kind: "picked-address", unit: "2" }],
        });
        const output = overlay.print();
        expect(output).toContain("ad7124_8: adi,ad7124-8@2");
        expect(output).toContain("reg = <2>");
    });

    test("add_node — second add gets @3 and an indexed label", () => {
        const overlay = setup();
        add_node(overlay, request({}));
        expect(add_node(overlay, request({}))).toMatchObject({ status: "added", key: "adi,ad7124-8@3", label: "ad7124_8_1" });
    });

    test("add_node — explicit name@a writes reg <10> without auto-addressing", () => {
        const overlay = setup();
        expect(add_node(overlay, request({ name: "adc@a", auto_address: false }))).toMatchObject({ status: "added", key: "adc@a" });
        expect(overlay.print()).toMatch(/adc@a \{[^}]*reg = <10>/s);
    });

    test("add_node — non-hex unit address keeps the name but writes no reg", () => {
        const overlay = setup();
        const result = add_node(overlay, request({ name: "adc@bar" }));
        expect(result).toMatchObject({ status: "added", key: "adc@bar", notes: [{ kind: "non-hex-unit", unit: "bar" }] });
        expect(overlay.print()).not.toContain("reg =");
    });

    test("add_node — no unit address when auto_address is off", () => {
        const overlay = setup();
        const result = add_node(overlay, request({ parent_path: "/", name: "regulator-fixed", compatible: "regulator-fixed", auto_address: false }));
        expect(result).toMatchObject({ status: "added", key: "regulator-fixed", path: "/regulator-fixed" });
        expect(overlay.print()).toContain("regulator-fixed {");
        expect(overlay.print()).not.toContain("regulator-fixed@");
    });

    test("add_node — base parent without a fragment gets one targeting its label", () => {
        const overlay = setup();
        expect(add_node(overlay, request({ parent_path: SPI1 }))).toMatchObject({ status: "added", key: "adi,ad7124-8@0", notes: [] });
        expect(overlay.print()).toContain("target = <&spi1>");
    });

    test("add_node — base parent without cells is left alone", () => {
        const overlay = setup();
        expect(add_node(overlay, request({ parent_path: "/soc/bus", name: "dev@1", auto_address: false }))).toMatchObject({ status: "added" });
        expect(overlay.print()).not.toContain("-cells");
    });

    test("add_node — no auto address under a root without #size-cells", () => {
        const overlay = setup();
        const result = add_node(overlay, request({ parent_path: "/" }));
        expect(result).toMatchObject({ status: "added", key: "adi,ad7124-8", notes: [{ kind: "reg-needed" }] });
        expect(overlay.print()).not.toContain("reg =");
        expect(overlay.print()).not.toContain("-cells");
    });

    test("add_node — no auto address under a memory-mapped parent", () => {
        const base = DeviceTree.new_from_string(`/dts-v1/;
/ {
    #address-cells = <2>;
    #size-cells = <1>;
    memory@0 { reg = <0x0 0x0 0x40000000>; };
};`);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DeviceTreeOverlay.new_from_string("/dts-v1/;\n/plugin/;\n/ {\n};", base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        expect(add_node(overlay, request({ parent_path: "/" })))
            .toMatchObject({ status: "added", key: "adi,ad7124-8", notes: [{ kind: "reg-needed" }] });
        expect(add_node(overlay, request({ parent_path: "/", name: "dev@3f200000" })))
            .toMatchObject({ status: "added", key: "dev@3f200000", notes: [{ kind: "reg-size-zero" }] });
        expect(overlay.print()).toContain("reg = <0 1059061760 0>");
    });

    test("add_node — overlay-added parent without cells is indexed and gets cells", () => {
        const overlay = setup("/dts-v1/;\n/plugin/;\n\n&spi0 {\n\tadc@4 {\n\t\treg = <4>;\n\t};\n};");
        expect(add_node(overlay, request({ parent_path: `${SPI0}/adc@4`, name: "channel" })))
            .toMatchObject({ status: "added", key: "channel@0", notes: [] });
        expect(overlay.print()).toMatch(/adc@4 \{[^}]*#address-cells = <1>;\s*#size-cells = <0>/s);
    });

    test("add_node — parent that already has cells is left alone", () => {
        const overlay = setup();
        add_node(overlay, request({}));
        expect(overlay.print()).not.toContain("#address-cells");
    });

    test("add_node — under an overlay-added node", () => {
        const overlay = setup("/dts-v1/;\n/plugin/;\n\n&spi0 {\n\tadc@4 {\n\t\treg = <4>;\n\t};\n};");
        const result = add_node(overlay, request({ parent_path: `${SPI0}/adc@4`, name: "channel@0", auto_address: false }));
        expect(result).toMatchObject({ status: "added", path: `${SPI0}/adc@4/channel@0` });
        expect(overlay.print()).toMatch(/adc@4 \{[^}]*#address-cells = <1>/s);
    });

    test("add_node — duplicate refused, overlay untouched", () => {
        const overlay = setup();
        const before = overlay.print();
        expect(add_node(overlay, request({ name: "spidev@0", label: "x" }))).toEqual({ status: "duplicate", key: "spidev@0" });
        expect(overlay.print()).toBe(before);
    });

    test("add_node — label refusals", () => {
        const overlay = setup();
        expect(add_node(overlay, request({ label: "spi0" }))).toEqual({ status: "label-taken", label: "spi0", owner: SPI0 });
        expect(add_node(overlay, request({ label: "1bad" }))).toEqual({ status: "invalid-label", label: "1bad" });
    });

    test("add_node — empty unit address refused", () => {
        expect(add_node(setup(), request({ name: "adc@" }))).toEqual({ status: "empty-unit-address" });
    });

    test("add_node — parent-not-found, no fragment created", () => {
        const overlay = setup();
        const before = overlay.print();
        expect(add_node(overlay, request({ parent_path: "/soc/i2c@0" }))).toEqual({ status: "parent-not-found" });
        expect(overlay.print()).toBe(before);
    });
}
