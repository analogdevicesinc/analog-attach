/* eslint-disable unicorn/no-null */
import {
    is_dt_flag,
    get_full_node_name,
    AttachEnumType,
    type AttachType,
    type DTNode,
    type DTProperty as AttachDTProperty,
    type DTValue,
    type CellArrayElement,
} from "attach-lib";

import type { Node, Property, Types, PropertyValue } from "./types";

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

export function attach_type_to_protocol_type(value: AttachType): Types {
    switch (value._t) {
        case "boolean": {
            return { kind: "bool" };
        }
        case "integer": {
            return { kind: "number", subtype: "int" };
        }
        case "enum_integer": {
            return { kind: "enum", options: value.enum.map(v => ({ value: Number(v) })) };
        }
        case "const": {
            return typeof value.const === "string" ? { kind: "string" } : { kind: "number", subtype: "int" };
        }
        case "generic": {
            return { kind: "string" };
        }
        case "object": {
            return { kind: "string" };
        }
        case "string_array": {
            return value.maxItems === 1
                ? { kind: "string" }
                : { kind: "array", items: { kind: "string" } };
        }
        case "enum_array": {
            const options = value.enum.map(v =>
                value.enum_type === AttachEnumType.NUMBER
                    ? { value: Number(v) as number }
                    : { value: String(v) }
            );
            return value.maxItems === 1
                ? { kind: "enum", options }
                : { kind: "array", items: { kind: "enum", options } };
        }
        case "number_array": {
            return value.maxItems === 1
                ? { kind: "number", subtype: "int" }
                : { kind: "array", items: { kind: "number", subtype: "int" } };
        }
        case "array": {
            return { kind: "array", items: { kind: "number", subtype: "int" } };
        }
        case "fixed_index": {
            return {
                kind: "tuple",
                items: value.prefixItems.map(item =>
                    item._t === "number"
                        ? { kind: "number", subtype: "int" } as Types
                        : {
                            kind: "enum", options: item.enum.map(v =>
                                item.enum_type === AttachEnumType.NUMBER
                                    ? { value: Number(v) as number }
                                    : { value: String(v) }
                            )
                        } as Types
                ),
            };
        }
        case "matrix": {
            const row = value.values[0];
            return {
                kind: "array",
                items: row === undefined ? { kind: "number", subtype: "int" } : attach_type_to_protocol_type(row),
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
