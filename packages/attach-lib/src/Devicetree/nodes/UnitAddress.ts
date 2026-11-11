import { type DTNode, type DTProperty, is_dt_flag } from "../syntax/AST.js";
import { PropertyBuilder } from "../build/PropertyBuilder.js";
import { cell_number, is_enabled } from "./Access.js";

/**
 * Unit addresses are hex by convention (and dtc requires it on SPI, I2C and
 * simple-bus children), but some bindings name child nodes in decimal, e.g.
 * `^channel@([0-9]|1[0-5])$`.
 */
export type UnitRadix = 10 | 16;

/** A unit address and the radix it is written in. */
export type UnitAddr = { value: bigint; repr: "hex" | "dec" };

export function parse_unit_address(unit: string, radix: UnitRadix = 16): bigint | undefined {
    if (unit === "") { return undefined; }
    const cleaned = unit.toLowerCase();
    if (radix === 10) { return /^\d+$/.test(cleaned) ? BigInt(cleaned) : undefined; }
    if (!/^[\da-f][\da-f,]*$/.test(cleaned)) { return undefined; }
    if (cleaned.includes(",")) { return undefined; }
    return BigInt(`0x${cleaned}`);
}

export function format_unit_address(value: bigint, radix: UnitRadix = 16): string {
    return value.toString(radix);
}

const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
const HEX_LETTERS = ["a", "b", "c", "d", "e", "f"];

function accepts_any(regex: RegExp, name: string, units: string[]): boolean {
    return units.some(unit => regex.test(`${name}@${unit}`));
}

/**
 * The radix of `name@<unit>` children under a binding with these node
 * patterns, found by probing: a pattern that accepts digits but no hex letter
 * (`^channel@([0-9]|1[0-5])$`) means decimal, one that also accepts letters
 * means hex. Decimal wins when both kinds match, since a decimal name satisfies
 * both. Undefined when no pattern accepts the name.
 */
export function unit_radix(patterns: string[], name: string): UnitRadix | undefined {
    let hex = false;
    for (const pattern of patterns) {
        let regex: RegExp;
        try { regex = new RegExp(pattern); } catch { continue; }
        if (!accepts_any(regex, name, DIGITS)) { continue; }
        if (!accepts_any(regex, name, HEX_LETTERS)) { return 10; }
        hex = true;
    }
    return hex ? 16 : undefined;
}

export function encode_reg_address(value: bigint, address_cells: number, size_cells: number): DTProperty {
    const tags: bigint[] = [];
    for (let index = address_cells - 1; index >= 0; index--) {
        tags.push((value >> BigInt(index * 32)) & 0xFF_FF_FF_FFn);
    }
    for (let index = 0; index < size_cells; index++) {
        tags.push(0n);
    }
    return PropertyBuilder.build_cell_array()
        .with_cells(...tags)
        .with_name("reg")
        .build();
}

export function decode_reg_address(reg: DTProperty, address_cells: number): bigint | undefined {
    if (is_dt_flag(reg.value)) { return undefined; }
    const first = reg.value[0];
    if (first?.kind !== "array") { return undefined; }

    let result = 0n;
    for (let index = 0; index < address_cells; index++) {
        const element = first.elements[index];
        const value = element === undefined ? undefined : cell_number(element);
        if (value === undefined) { return undefined; }
        result = (result << 32n) | (value & 0xFF_FF_FF_FFn);
    }
    return result;
}

/**
 * The address a child occupies on its parent's bus: the first address of its
 * `reg`, read with the parent's `#address-cells`, or with no `reg`, its
 * hexadecimal unit address. A cell written as an expression counts once it
 * evaluates (`(4<<8|0x03)`, a macro after cpp). Undefined when its `reg` doesn't
 * decode (it then occupies nothing, whatever its unit address) or it has neither.
 */
export function occupied_address(child: DTNode, address_cells: number): bigint | undefined {
    const reg = child.properties.find(p => p.name === "reg");
    if (reg !== undefined) { return decode_reg_address(reg, address_cells); }
    return child.unit_addr === undefined ? undefined : parse_unit_address(child.unit_addr);
}

/**
 * The lowest address no enabled child occupies: of `allowed` when it has any (a binding's `reg` enum), else from 0.
 * When every allowed address is taken, the lowest of them, `taken`. `occupants` are every enabled child's address.
 */
export function next_free_unit_address(
    effective_children: Map<string, DTNode>,
    address_cells: number,
    allowed: bigint[] = [],
): { address: bigint; occupants: { name: string; address: bigint }[]; taken: boolean } {
    const occupied = new Map<bigint, string>();
    const all_occupants: { name: string; address: bigint }[] = [];

    for (const [name, child] of effective_children) {
        if (!is_enabled(child)) { continue; }
        const address = occupied_address(child, address_cells);
        if (address !== undefined) {
            occupied.set(address, name);
            all_occupants.push({ name, address });
        }
    }

    if (allowed.length > 0) {
        const sorted = [...allowed].sort((a, b) => (a < b ? -1 : 1));
        const free = sorted.find(candidate => !occupied.has(candidate));
        return { address: free ?? sorted[0], occupants: all_occupants, taken: free === undefined };
    }
    for (let candidate = 0n; ; candidate++) {
        if (occupied.has(candidate)) { continue; }
        return { address: candidate, occupants: all_occupants, taken: false };
    }
}

export type SyncResult = "unchanged" | "renamed" | "conflict" | "not-numeric";

export function sync_unit_address_from_reg(
    node: DTNode,
    address_cells: number,
    effective_siblings: Map<string, DTNode>,
    radix: UnitRadix = 16,
): SyncResult {
    const reg = node.properties.find(p => p.name === "reg");
    if (reg === undefined) { return "unchanged"; }

    const new_address = decode_reg_address(reg, address_cells);
    if (new_address === undefined) { return "not-numeric"; }

    const current_unit = node.unit_addr;
    const current_address = current_unit === undefined ? undefined : parse_unit_address(current_unit, radix);

    if (current_address !== undefined && current_address === new_address) { return "unchanged"; }

    const new_unit = format_unit_address(new_address, radix);
    const new_full_name = `${node.name}@${new_unit}`;

    if (effective_siblings.has(new_full_name)) { return "conflict"; }

    node.unit_addr = new_unit;
    return "renamed";
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    test("parse_unit_address", () => {
        expect(parse_unit_address("0")).toBe(0n);
        expect(parse_unit_address("a")).toBe(0xAn);
        expect(parse_unit_address("10")).toBe(0x10n);
        expect(parse_unit_address("7e204000")).toBe(0x7E_20_40_00n);
        expect(parse_unit_address("bar")).toBeUndefined();
        expect(parse_unit_address("")).toBeUndefined();
        expect(parse_unit_address("0x10")).toBeUndefined();
    });

    test("parse_unit_address / format_unit_address — decimal", () => {
        expect(parse_unit_address("10", 10)).toBe(10n);
        expect(parse_unit_address("a", 10)).toBeUndefined();
        expect(format_unit_address(10n, 10)).toBe("10");
    });

    test("unit_radix", () => {
        expect(unit_radix(["^channel@([0-9]|1[0-5])$"], "channel")).toBe(10);
        expect(unit_radix(["^channel@[0-9a-f]+$"], "channel")).toBe(16);
        expect(unit_radix(["^.*@[0-9a-f]+$"], "adc")).toBe(16);
        expect(unit_radix(["^.*@[0-9a-f]+$", "^channel@[0-9]+$"], "channel")).toBe(10);
        expect(unit_radix(["^led@[1-9]$"], "led")).toBe(10);
        expect(unit_radix(["^channel@[0-9]+$"], "port")).toBeUndefined();
        expect(unit_radix(["^(?invalid"], "x")).toBeUndefined();
    });

    test("sync_unit_address_from_reg — decimal radix", () => {
        const node: DTNode = {
            name: "channel", unit_addr: "1", labels: [], children: [],
            properties: [encode_reg_address(12n, 1, 0)],
        };
        expect(sync_unit_address_from_reg(node, 1, new Map(), 10)).toBe("renamed");
        expect(node.unit_addr).toBe("12");
        expect(sync_unit_address_from_reg(node, 1, new Map(), 10)).toBe("unchanged");
    });

    test("format_unit_address", () => {
        expect(format_unit_address(0n)).toBe("0");
        expect(format_unit_address(0xAn)).toBe("a");
        expect(format_unit_address(0x10n)).toBe("10");
    });

    test("encode_reg_address — single address cell, no size", () => {
        const reg = encode_reg_address(5n, 1, 0);
        expect(reg.name).toBe("reg");
        expect(is_dt_flag(reg.value)).toBe(false);
    });

    test("decode_reg_address — round trip", () => {
        const reg = encode_reg_address(0xAn, 1, 0);
        expect(decode_reg_address(reg, 1)).toBe(0xAn);
    });

    test("decode_reg_address — two address cells", () => {
        const reg = encode_reg_address(0x1_00_00_00_00n, 2, 1);
        expect(decode_reg_address(reg, 2)).toBe(0x1_00_00_00_00n);
    });

    /** The one child of the root in `source`. */
    const parsed_node = async (source: string): Promise<DTNode> => {
        const { DeviceTree } = await import("../DeviceTree.js");
        const tree = DeviceTree.new_from_string(`/dts-v1/;\n/ {\n${source}\n};`);
        if (typeof tree === "string") { throw new TypeError(tree); }
        const child = tree.node_at("/")?.children[0];
        if (child === undefined) { throw new TypeError("no child"); }
        return child;
    };

    test("occupied_address — a reg written as an expression is its value", async () => {
        // sc7280-idp's `reg = <PMR735A_ADC7_DIE_TEMP>` after cpp
        expect(occupied_address(await parsed_node("channel@403 { reg = <(4 << 8 | 0x03)>; };"), 1)).toBe(0x04_03n);
        // the value is the reg's, not the unit address's
        expect(occupied_address(await parsed_node("channel@0 { reg = <(4 << 8 | 0x03)>; };"), 1)).toBe(0x04_03n);
        // a macro the workfile doesn't expand occupies nothing
        expect(occupied_address(await parsed_node("channel@5 { reg = <(MY_ADDR)>; };"), 1)).toBeUndefined();
    });

    test("next_free_unit_address — a reg written as an expression occupies its address", async () => {
        const children = new Map<string, DTNode>([
            ["channel@0", await parsed_node("channel@0 { reg = <(0 << 8 | 0x00)>; };")],
            ["channel@1", await parsed_node("channel@1 { reg = <1>; };")],
        ]);
        expect(next_free_unit_address(children, 1).address).toBe(2n);
    });

    test("next_free_unit_address — base spidev@0/1 → 2", () => {
        const children = new Map<string, DTNode>();
        children.set("spidev@0", {
            name: "spidev", unit_addr: "0", labels: [], children: [],
            properties: [encode_reg_address(0n, 1, 0)],
        });
        children.set("spidev@1", {
            name: "spidev", unit_addr: "1", labels: [], children: [],
            properties: [encode_reg_address(1n, 1, 0)],
        });
        const result = next_free_unit_address(children, 1);
        expect(result.address).toBe(2n);
    });

    test("next_free_unit_address — disabled child does not occupy the address", () => {
        const children = new Map<string, DTNode>();
        children.set("spidev@0", {
            name: "spidev", unit_addr: "0", labels: [], children: [],
            properties: [
                encode_reg_address(0n, 1, 0),
                PropertyBuilder.build_string().with_value("disabled").with_name("status").build(),
            ],
        });
        const result = next_free_unit_address(children, 1);
        expect(result.address).toBe(0n);
    });
}
