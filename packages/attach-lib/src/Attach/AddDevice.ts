import { AttachEnumType, type AttachType, type Cell, type ParsedBinding } from "../Bindings/index.js";
import { add_node, type AddNodeRequest, type AddNodeResult } from "../Devicetree/AddNode.js";
import { DeviceTree } from "../Devicetree/DeviceTree.js";
import { DeviceTreeOverlay } from "../Devicetree/DeviceTreeOverlay.js";

/** An `add_node` request without what the binding decides: whether the node gets an address, and which. */
export type AddDeviceRequest = Omit<AddNodeRequest, "auto_address" | "addresses">;

/**
 * Add a device node as its binding has it: a node whose binding defines `reg` gets an address (`auto_address`), the
 * lowest free one its `reg` enum allows when it has one. Without a binding, the node gets no address.
 */
export function add_device_node(overlay: DeviceTreeOverlay, request: AddDeviceRequest, binding?: ParsedBinding): AddNodeResult {
    const reg = binding?.properties.find(property => property.key === "reg");
    return add_node(overlay, { ...request, auto_address: reg !== undefined, addresses: reg === undefined ? [] : reg_addresses(reg.value) });
}

/** The addresses a `reg` type allows: the number options of its first cell, none when that cell isn't an enum. */
function reg_addresses(type: AttachType): bigint[] {
    const cell = first_cell(type);
    if (cell?._t !== "enum") { return []; }
    return cell.enum.filter((option): option is bigint => typeof option === "bigint");
}

/** The first cell of a value: a scalar's, a list's first position, a matrix's first row's. */
function first_cell(type: AttachType): Cell | undefined {
    switch (type._t) {
        case "scalar": { return type.cell; }
        case "list": { return Array.isArray(type.item) ? type.item[0] : type.item; }
        case "matrix": { return type.rows[0] === undefined ? undefined : first_cell(type.rows[0]); }
        default: { return undefined; }
    }
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    const overlay = (): DeviceTreeOverlay => {
        const base = DeviceTree.new_from_string("/dts-v1/;\n/ {\n\ti2c1: i2c {\n\t\t#address-cells = <1>;\n\t\t#size-cells = <0>;\n\t};\n};");
        if (typeof base === "string") { throw new TypeError(base); }
        const result = DeviceTreeOverlay.new_from_string("/dts-v1/;\n/plugin/;\n\n&i2c1 {\n};", base);
        if (typeof result === "string") { throw new TypeError(result); }
        return result;
    };
    const with_reg = (value: AttachType): ParsedBinding => ({ required_properties: [], properties: [{ key: "reg", value }], pattern_properties: [], examples: [] });
    const addresses: Cell = { _t: "enum", enum: [0x24n, 0x1En], enum_type: AttachEnumType.NUMBER };
    const request = { parent_path: "/i2c", name: "pmic", compatible: "adi,max77503" };

    test("add_device_node — the reg enum's addresses, of a matrix's first row, a list or a scalar", () => {
        for (const value of [
            { _t: "matrix", rows: [{ _t: "list", item: addresses, maxItems: 1 }], maxItems: 1 },
            { _t: "list", item: [addresses, { _t: "number" }] },
            { _t: "scalar", cell: addresses },
        ] satisfies AttachType[]) {
            expect(add_device_node(overlay(), request, with_reg(value))).toMatchObject({ status: "added", key: "pmic@1e", notes: [] });
        }
    });

    test("add_device_node — a reg that isn't an enum picks from 0; no reg or no binding, no address", () => {
        expect(add_device_node(overlay(), request, with_reg({ _t: "matrix", rows: [{ _t: "list", item: { _t: "any" } }] })))
            .toMatchObject({ status: "added", key: "pmic@0" });
        expect(add_device_node(overlay(), request, { ...with_reg({ _t: "flag" }), properties: [] }))
            .toMatchObject({ status: "added", key: "pmic" });
        expect(add_device_node(overlay(), request)).toMatchObject({ status: "added", key: "pmic" });
    });
}
