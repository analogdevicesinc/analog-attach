/* eslint-disable unicorn/no-null */
import {
    is_dt_flag,
    get_full_node_name,
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
