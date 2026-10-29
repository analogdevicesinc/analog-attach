/* eslint-disable unicorn/no-null */
import {
    is_dt_flag,
    get_full_node_name,
    AttachEnumType,
    type AttachType,
    type Cell,
    type DTNode,
    type DTProperty as AttachDTProperty,
    type DTValue,
    type CellArrayElement,
} from "attach-lib";

import type { Node, Property, Types, PropertyValue } from "./types";
import { item_bounds } from "../item-count";

export function convert_node(node: DTNode): Node {
    const key = get_full_node_name(node);

    return {
        kind: "node",
        key: key,
        properties: node.properties.map(p => convert_property(p)),
        children: node.children.map(c => convert_node(c)),
        alias: node.labels,
    };
}

export function convert_property(property: AttachDTProperty): Property {
    if (is_dt_flag(property.value)) {
        return {
            kind: "property",
            key: property.name,
            type: { kind: "bool" },
            value: true,
        };
    }

    const values = property.value as DTValue[];
    const { type, value } = infer_type_and_value(values);

    return {
        kind: "property",
        key: property.name,
        type,
        value,
    };
}

function infer_type_and_value(values: DTValue[]): { type: Types; value: PropertyValue } {
    if (values.length === 0) {
        return { type: { kind: "string" }, value: null };
    }

    if (values.length === 1) {
        const v = values[0]!;
        return convert_single_value(v);
    }

    const converted = values.map(v => convert_single_value(v));
    return {
        type: { kind: "array", items: converted[0]!.type },
        value: converted.map(c => c.value),
    };
}

function convert_single_value(v: DTValue): { type: Types; value: PropertyValue } {
    switch (v.kind) {
        case "string": {
            return { type: { kind: "string" }, value: v.value };
        }
        case "label": {
            return { type: { kind: "string" }, value: `&${v.name}` };
        }
        case "path": {
            return { type: { kind: "string" }, value: v.path };
        }
        case "array": {
            return convert_cell_array(v.elements);
        }
    }
}

function convert_cell_array(elements: CellArrayElement[]): { type: Types; value: PropertyValue } {
    if (elements.length === 0) {
        return { type: { kind: "array", items: { kind: "number", subtype: "int" } }, value: [] };
    }

    if (elements.length === 1) {
        const element = elements[0]!;
        const converted = convert_cell_element(element);
        return { type: converted.type, value: converted.value };
    }

    const converted = elements.map(element => convert_cell_element(element));
    return {
        type: { kind: "array", items: { kind: "number", subtype: "int" } },
        value: converted.map(c => c.value),
    };
}

/** The binding's minItems / maxItems on a value array, as the protocol names them. */
function item_counts(value: AttachType): { min_items?: number; max_items?: number } {
    const bounds = item_bounds(value);
    if (bounds === undefined) { return {}; }
    return { min_items: bounds.min, ...(bounds.max === undefined ? {} : { max_items: bounds.max }) };
}

/** The protocol type of one value: a cell or a string. */
function cell_to_protocol_type(cell: Cell): Types {
    switch (cell._t) {
        case "string": {
            return { kind: "string" };
        }
        case "enum": {
            return {
                kind: "enum",
                options: cell.enum.map(v => cell.enum_type === AttachEnumType.NUMBER ? { value: Number(v) } : { value: String(v) }),
            };
        }
        case "number":
        case "any": {
            return { kind: "number", subtype: "int" };
        }
    }
}

export function attach_type_to_protocol_type(value: AttachType): Types {
    switch (value._t) {
        case "flag": {
            return { kind: "bool" };
        }
        case "scalar": {
            const cell = value.cell;
            // A one-option enum the binding also defaults to is a const.
            if (cell._t === "enum" && cell.enum.length === 1 && cell.enum[0] === value.default) {
                return typeof value.default === "string" ? { kind: "string" } : { kind: "number", subtype: "int" };
            }
            return cell_to_protocol_type(cell);
        }
        case "unknown":
        case "node": {
            return { kind: "string" };
        }
        case "list": {
            if (Array.isArray(value.item)) {
                return { kind: "tuple", items: value.item.map(cell => cell_to_protocol_type(cell)) };
            }
            const item = cell_to_protocol_type(value.item);
            if (value.item._t === "any") {
                return { kind: "array", items: item };
            }
            return value.maxItems === 1 ? item : { kind: "array", items: item, ...item_counts(value) };
        }
        case "matrix": {
            const row = value.rows[0];
            return {
                kind: "array",
                items: row === undefined ? { kind: "number", subtype: "int" } : attach_type_to_protocol_type(row),
                ...item_counts(value),
            };
        }
        default: {
            const _x: never = value;
            throw new Error("Exhaustive check failed");
        }
    }
}

function convert_cell_element(element: CellArrayElement): { type: Types; value: PropertyValue } {
    switch (element.kind) {
        case "number": {
            return { type: { kind: "number", subtype: "int" }, value: Number(element.value) };
        }
        case "label": {
            return { type: { kind: "string" }, value: `&${element.name}` };
        }
        case "path": {
            return { type: { kind: "string" }, value: element.path };
        }
        case "expression": {
            return { type: { kind: "string" }, value: element.value };
        }
    }
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    test("attach_type_to_protocol_type — value arrays carry the binding's item counts, entry lists don't", () => {
        expect(attach_type_to_protocol_type({ _t: "list", item: { _t: "number" }, minItems: 2, maxItems: 2 }))
            .toEqual({ kind: "array", items: { kind: "number", subtype: "int" }, min_items: 2, max_items: 2 });
        expect(attach_type_to_protocol_type({ _t: "list", item: { _t: "string" }, minItems: 1 }))
            .toEqual({ kind: "array", items: { kind: "string" }, min_items: 1 });
        expect(attach_type_to_protocol_type({ _t: "list", item: { _t: "number" }, minItems: 1, maxItems: 1 }))
            .toEqual({ kind: "number", subtype: "int" });
        expect(attach_type_to_protocol_type({ _t: "list", item: { _t: "any" }, minItems: 1, maxItems: 2 }))
            .toEqual({ kind: "array", items: { kind: "number", subtype: "int" } });
    });

    test("attach_type_to_protocol_type — a defaulted one-option enum is a const", () => {
        const one = (default_value: bigint | string | undefined, option: bigint | string): AttachType => ({
            _t: "scalar",
            cell: { _t: "enum", enum: [option], enum_type: typeof option === "string" ? AttachEnumType.STRING : AttachEnumType.NUMBER },
            ...(default_value === undefined ? {} : { default: default_value }),
        });
        expect(attach_type_to_protocol_type(one(3n, 3n))).toEqual({ kind: "number", subtype: "int" });
        expect(attach_type_to_protocol_type(one("a", "a"))).toEqual({ kind: "string" });
        expect(attach_type_to_protocol_type(one(undefined, 3n))).toEqual({ kind: "enum", options: [{ value: 3 }] });
    });

    test("attach_type_to_protocol_type — interrupts under a known parent count cells", () => {
        const interrupts: AttachType = {
            _t: "matrix",
            minItems: 1,
            maxItems: 1,
            rows: [{ _t: "list", item: [{ _t: "number" }, { _t: "number" }], minItems: 2, maxItems: 2 }],
        };
        expect(attach_type_to_protocol_type(interrupts)).toEqual({
            kind: "array",
            items: { kind: "tuple", items: [{ kind: "number", subtype: "int" }, { kind: "number", subtype: "int" }] },
            min_items: 2,
            max_items: 2,
        });
    });
}
