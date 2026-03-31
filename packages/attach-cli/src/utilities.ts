import { Attach, extract_compatible, type CellArrayElement, type DtsNode, type DtsValue, type DtsValueComponent, type ParsedBinding } from 'attach-lib';
import * as fs from 'node:fs';
import path from "node:path";

export function bigIntReplacer(_key: string, value: any): any {
    return typeof value === 'bigint' ? Number(value) : value;
}

export function get_all_file_paths(directory: string): string[] {
    let results: string[] = [];
    const list = fs.readdirSync(directory);

    for (const file of list) {
        const filePath = path.join(directory, file);
        const stat = fs.statSync(filePath);

        if (stat && stat.isDirectory()) {
            results = [...results, ...get_all_file_paths(filePath)];
        } else {
            results.push(filePath);
        }
    }

    return results.sort(); // Sort to make hash order-independent
}

export async function find_binding(linux: string, dtSchema: string, compatible_to_find: string): Promise<string | undefined> {
    const bindings_folder = path.resolve(linux, "Documentation", "devicetree", "bindings");

    if (!fs.existsSync(bindings_folder)) {
        console.log(`Missing ${bindings_folder}`);
        return;
    }

    const all_files = get_all_file_paths(bindings_folder);
    const yaml_files = all_files.filter(file => file.endsWith(".yaml"));

    for (const file of yaml_files) {

        if (!fs.readFileSync(file, 'utf8').includes(compatible_to_find)) {
            continue;
        }

        const attach = Attach.new();
        const binding = await attach.parse_binding(file, linux, dtSchema);

        if (binding === undefined) {
            continue;
        }

        const compatible = extract_compatible(binding.parsed_binding);

        if (compatible === undefined) {
            continue;
        }

        for (const entry of compatible) {
            // TODO fix why entry could be undefined
            // arm/actions.yaml
            if (entry !== undefined && entry === compatible_to_find) {
                return file;
            }
        }

    }

    return;
}

export function parse_dts_node(node: DtsNode, parsed_binding: ParsedBinding): Map<string, unknown> {
    const map = new Map<string, unknown>();
    for (const property of node.properties) {
        if (property.name === "status") {
            continue;
        }

        const value = parse_dts_value(property.value);

        const definition = parsed_binding.properties.find((value) => value.key === property.name);

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
            case "object": {
                // TODO: finish?
                continue;
            }

            default: {
                const _x: never = definition_type;
                throw new Error("Exhaustion check failed!");
            }
        }
    }
    return map;
}

function parse_dts_value(value: DtsValue | undefined): unknown {

    if (value === undefined) {
        return true;
    }

    if (value.components.length === 1 && value.components[0] !== undefined) {
        return parse_dts_value_component(value.components[0]);
    }

    return value.components.map((component) => parse_dts_value_component(component));
}

function parse_dts_value_component(component: DtsValueComponent): string | number[] | (string | bigint)[] {
    const kind = component.kind;

    switch (kind) {
        case "string": {
            return component.value;
        }
        case "ref": {
            return component.ref.kind === "label" ? component.ref.name : component.ref.path;
        }
        case "bytes": {
            return component.bytes.map((byte) => byte.value);
        }
        case "array": {
            return component.elements.map((element) => parse_cell_array_element(element));
        }
        default: {
            const _x: never = kind;
            throw new Error("Exhaustion check failed!");
        }
    }
}

function parse_cell_array_element(element: CellArrayElement): string | bigint {
    const kind = element.item.kind;

    switch (kind) {
        case "number":
        case "u64": {
            return BigInt(element.item.value);
        }
        case "macro": {
            return element.item.value;
        }
        case "ref": {
            return element.item.ref.kind === "label" ? element.item.ref.name : element.item.ref.path;
        }
        case "expression": {
            return element.item.value;
        }
        default: {
            const _x: never = kind;
            throw new Error("Exhaustive check failed!");
        }
    }
}