import { DTNode, DTProperty, is_dt_flag, DTValue, DTNumber, DTLabel, DTPath, DTExpression } from "../Devicetree";
import { ParsedBinding } from "./AttachTypes";

export function dt_to_validator_input(node: DTNode, parsed_binding: ParsedBinding): Map<string, unknown> {
    const map = new Map<string, unknown>();
    for (const property of node.properties) {
        if (property.name === "status") { continue; }

        const value = _parse_dt_property(property);
        const definition = parsed_binding.properties.find((v) => v.key === property.name);

        if (definition === undefined) {
            map.set(property.name, value);
            continue;
        }

        const definition_type = definition.value._t;
        switch (definition_type) {
            case "array":
            case "enum_array":
            case "fixed_index":
            case "number_array":
            case "string_array": {
                if (Array.isArray(value)) {
                    map.set(property.name, value);
                    continue;
                }
                map.set(property.name, [value]);
                continue;
            }
            case "matrix": {
                if (Array.isArray(value)) {
                    if (value.every((entry) => Array.isArray(entry))) {
                        map.set(property.name, value);
                        continue;
                    }
                    map.set(property.name, [value]);
                    continue;
                } else {
                    map.set(property.name, [[value]]);
                    continue;
                }
            }
            case "const": {
                if (Array.isArray(value) && value.length === 1) {
                    map.set(property.name, value[0]);
                    continue;
                }
                map.set(property.name, value);
            }
            case "boolean":
            case "enum_integer":
            case "generic":
            case "integer": {
                if (Array.isArray(value) && value.length === 1) {
                    map.set(property.name, value[0]);
                    continue;
                }
                map.set(property.name, value);
                continue;
            }
            case "object": { continue; }
            default: {
                const _x: never = definition_type;
                throw new Error("Exhaustion check failed!");
            }
        }
    }
    return map;
}

function _parse_dt_property(property: DTProperty): unknown {
    if (is_dt_flag(property.value)) { return true; }
    const values = property.value;
    if (values.length === 1 && values[0] !== undefined) {
        return _parse_dt_value(values[0]);
    }
    return values.map((v) => _parse_dt_value(v));
}

function _parse_dt_value(v: DTValue): unknown {
    switch (v.kind) {
        case "string": {
            return v.value;
        }
        case "label": {
            return v.name;
        }
        case "path": {
            return v.path;
        }
        case "array": {
            return v.elements.map((element) => _parse_dt_cell_element(element));
        }
        default: {
            const _x: never = v;
            throw new Error("Exhaustion check failed!");
        }
    }
}

function _parse_dt_cell_element(element: DTNumber | DTLabel | DTPath | DTExpression): string | bigint {
    switch (element.kind) {
        case "number": {
            return element.value;
        }
        case "label": {
            return element.name;
        }
        case "path": {
            return element.path;
        }
        case "expression": {
            return element.value;
        }
        default: {
            const _x: never = element;
            throw new Error("Exhaustive check failed!");
        }
    }
}