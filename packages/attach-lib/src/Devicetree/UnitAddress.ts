import { type DTNode, type DTProperty, is_dt_flag, get_full_node_name } from "./Parser/AST.js";
import { PropertyBuilder } from "./PropertyBuilder.js";
import { cell_extract_first_value } from "../Intelligence/query.js";
import type { DeviceTreeOverlay } from "./DevicetreeOverlay.js";

export function parse_unit_address(unit: string): bigint | undefined {
    if (unit === "") { return undefined; }
    const cleaned = unit.toLowerCase();
    if (!/^[\da-f][\da-f,]*$/.test(cleaned)) { return undefined; }
    if (cleaned.includes(",")) { return undefined; }
    return BigInt(`0x${cleaned}`);
}

export function format_unit_address(value: bigint): string {
    return value.toString(16);
}

function get_cells_property(node: DTNode, name: string): number | undefined {
    const property = node.properties.find(p => p.name === name);
    if (property === undefined || is_dt_flag(property.value)) { return undefined; }
    const value = cell_extract_first_value(property);
    return typeof value === "bigint" ? Number(value) : undefined;
}

export interface AddressCells {
    address: number;
    size: number;
}

export function address_cells_of(overlay: DeviceTreeOverlay, parent_path: string): AddressCells {
    const found = overlay.find_node({ kind: "path", labels: [], path: parent_path });
    const node = found?.node;

    const base = overlay.get_base_dts();
    let base_node: DTNode | undefined;
    if (base !== undefined) {
        const reference = base.get_node_by_path({ kind: "path", labels: [], path: parent_path });
        if (reference !== undefined) { base_node = base.deref_node(reference); }
    }

    const overlay_addr = node !== undefined ? get_cells_property(node, "#address-cells") : undefined;
    const overlay_size = node !== undefined ? get_cells_property(node, "#size-cells") : undefined;
    const base_addr = base_node !== undefined ? get_cells_property(base_node, "#address-cells") : undefined;
    const base_size = base_node !== undefined ? get_cells_property(base_node, "#size-cells") : undefined;

    return {
        address: overlay_addr ?? base_addr ?? 1,
        size: overlay_size ?? base_size ?? 0,
    };
}

export function encode_reg_address(value: bigint, address_cells: number, size_cells: number): DTProperty {
    const tags = [];
    for (let index = address_cells - 1; index >= 0; index--) {
        tags.push(PropertyBuilder.tag_number((value >> BigInt(index * 32)) & 0xFFFF_FFFFn));
    }
    for (let index = 0; index < size_cells; index++) {
        tags.push(PropertyBuilder.tag_number(0n));
    }
    return PropertyBuilder.build_cell_array()
        .with_tagged_values(...(tags as [any, ...any[]]))
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
        if (element === undefined || element.kind !== "number") { return undefined; }
        result = (result << 32n) | (element.value & 0xFFFF_FFFFn);
    }
    return result;
}

export function is_enabled(node: DTNode): boolean {
    const status = node.properties.find(p => p.name === "status");
    if (status === undefined || is_dt_flag(status.value)) { return true; }
    const first = status.value[0];
    return !(first?.kind === "string" && first.value === "disabled");
}

export function next_free_unit_address(
    effective_children: Map<string, DTNode>,
    address_cells: number,
): { address: bigint; occupants: { name: string; address: bigint }[] } {
    const occupied = new Map<bigint, string>();
    const all_occupants: { name: string; address: bigint }[] = [];

    for (const [name, child] of effective_children) {
        if (!is_enabled(child)) { continue; }
        const reg = child.properties.find(p => p.name === "reg");
        if (reg !== undefined) {
            const address = decode_reg_address(reg, address_cells);
            if (address !== undefined) {
                occupied.set(address, name);
                all_occupants.push({ name, address });
            }
        } else if (child.unit_addr !== undefined) {
            const address = parse_unit_address(child.unit_addr);
            if (address !== undefined) {
                occupied.set(address, name);
                all_occupants.push({ name, address });
            }
        }
    }

    for (let candidate = 0n; ; candidate++) {
        if (occupied.has(candidate)) { continue; }
        return { address: candidate, occupants: all_occupants };
    }
}

export type SyncResult = "unchanged" | "renamed" | "conflict" | "not-numeric";

export function sync_unit_address_from_reg(
    node: DTNode,
    address_cells: number,
    effective_siblings: Map<string, DTNode>,
): SyncResult {
    const reg = node.properties.find(p => p.name === "reg");
    if (reg === undefined) { return "unchanged"; }

    const new_address = decode_reg_address(reg, address_cells);
    if (new_address === undefined) { return "not-numeric"; }

    const current_unit = node.unit_addr;
    const current_address = current_unit !== undefined ? parse_unit_address(current_unit) : undefined;

    if (current_address !== undefined && current_address === new_address) { return "unchanged"; }

    const new_unit = format_unit_address(new_address);
    const new_full_name = `${node.name}@${new_unit}`;

    if (effective_siblings.has(new_full_name)) { return "conflict"; }

    node.unit_addr = new_unit;
    return "renamed";
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    test("parse_unit_address", () => {
        expect(parse_unit_address("0")).toBe(0n);
        expect(parse_unit_address("a")).toBe(0xan);
        expect(parse_unit_address("10")).toBe(0x10n);
        expect(parse_unit_address("7e204000")).toBe(0x7e20_4000n);
        expect(parse_unit_address("bar")).toBeUndefined();
        expect(parse_unit_address("")).toBeUndefined();
        expect(parse_unit_address("0x10")).toBeUndefined();
    });

    test("format_unit_address", () => {
        expect(format_unit_address(0n)).toBe("0");
        expect(format_unit_address(0xan)).toBe("a");
        expect(format_unit_address(0x10n)).toBe("10");
    });

    test("encode_reg_address — single address cell, no size", () => {
        const reg = encode_reg_address(5n, 1, 0);
        expect(reg.name).toBe("reg");
        expect(is_dt_flag(reg.value)).toBe(false);
    });

    test("decode_reg_address — round trip", () => {
        const reg = encode_reg_address(0xan, 1, 0);
        expect(decode_reg_address(reg, 1)).toBe(0xan);
    });

    test("decode_reg_address — two address cells", () => {
        const reg = encode_reg_address(0x1_0000_0000n, 2, 1);
        expect(decode_reg_address(reg, 2)).toBe(0x1_0000_0000n);
    });

    test("is_enabled", () => {
        const enabled: DTNode = { name: "x", unit_addr: undefined, labels: [], properties: [], children: [] };
        expect(is_enabled(enabled)).toBe(true);
        const disabled: DTNode = {
            name: "x", unit_addr: undefined, labels: [], children: [],
            properties: [PropertyBuilder.build_string().with_value("disabled").with_name("status").build()],
        };
        expect(is_enabled(disabled)).toBe(false);
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
