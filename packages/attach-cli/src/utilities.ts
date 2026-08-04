import { Attach, extract_compatible, search_node_in_dts, type CellArrayElement, type DtsDocument, type DtsNode, type DtsReference, type DtsValue, type DtsValueComponent, type ParsedBinding } from 'attach-lib';
import * as fs from 'node:fs';
import path from "node:path";

import { load_compat_index, save_compat_index, type CompatIndex } from "./config";

/**
 * Expand `spi0/rest` or `&spi0/rest` into `&{/abs/path/rest}` so
 * search_node_in_dts can resolve it via an absolute-path lookup.
 * Identifiers without a `/` (or already starting with `&{/`) are returned unchanged.
 */
export function resolve_node_identifier(document: DtsDocument, identifier: string): string {
    if (identifier.startsWith("&{/")) {
        return identifier;
    }

    const slash = identifier.indexOf('/');
    if (slash === -1) {
        return identifier;
    }

    const raw_prefix = identifier.slice(0, slash);
    const suffix = identifier.slice(slash + 1);

    // Normalise to a bare label or absolute-path prefix for lookup
    const prefix = raw_prefix.startsWith("&") ? raw_prefix.slice(1) : raw_prefix;

    const resolved = search_node_in_dts(document, prefix);
    if (resolved === undefined) {
        return identifier;
    }

    return `&{${resolved.found_path}/${suffix}}`;
}

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

export function get_latest_mtime(directory: string): number {
    if (!fs.existsSync(directory)) {
        return 0;
    }

    let latest = fs.statSync(directory).mtimeMs;
    const list = fs.readdirSync(directory);

    for (const file of list) {
        if (file === ".git") {
            continue;
        }

        const filePath = path.join(directory, file);
        const stat = fs.statSync(filePath);

        latest = Math.max(latest, stat.isDirectory() ? get_latest_mtime(filePath) : stat.mtimeMs);
    }

    return latest;
}

function is_compat_index_stale(index: CompatIndex, linux: string, dtSchema: string): boolean {
    if (typeof index.generated_at !== "number" || index.entries === undefined) {
        return true;
    }

    const bindings_folder = path.resolve(linux, "Documentation", "devicetree", "bindings");
    const latest_mtime = Math.max(get_latest_mtime(bindings_folder), get_latest_mtime(dtSchema));

    return latest_mtime > index.generated_at;
}

export async function build_compat_index(linux: string, dtSchema: string): Promise<Record<string, string>> {
    const bindings_folder = path.resolve(linux, "Documentation", "devicetree", "bindings");
    const index: Record<string, string> = {};

    if (!fs.existsSync(bindings_folder)) {
        return index;
    }

    const all_files = get_all_file_paths(bindings_folder);
    const yaml_files = all_files.filter(file => file.endsWith(".yaml"));

    for (const file of yaml_files) {
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
            if (entry !== undefined && !(entry in index)) {
                index[entry] = file;
            }
        }
    }

    return index;
}

export async function find_binding(linux: string, dtSchema: string, compatible_to_find: string): Promise<string | undefined> {
    const cached_index = load_compat_index();

    if (cached_index !== undefined) {
        if (is_compat_index_stale(cached_index, linux, dtSchema)) {
            console.log("compat-index.json is stale, rebuilding...");
            const entries = await build_compat_index(linux, dtSchema);
            const compat_index_path = save_compat_index(entries);
            console.log(`Written: ${compat_index_path}`);
            return entries[compatible_to_find];
        }

        const cached_path = cached_index.entries[compatible_to_find];

        if (cached_path !== undefined && fs.existsSync(cached_path)) {
            return cached_path;
        }
    }

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

if (import.meta.vitest) {

    const { test, expect } = import.meta.vitest;
    const { parse_dts } = await import('attach-lib');

    let counter = 0;

    test(`${parse_cell_array_element.name} - ${++counter}`, () => {

        const input: CellArrayElement = {
            item: {
                kind: "ref",
                labels: [],
                ref: {
                    kind: "label",
                    name: "gpio"
                }
            }
        };

        const parsed_input = parse_cell_array_element(input);

        expect(parsed_input).toStrictEqual("gpio");

    });

    const dts_source = `/dts-v1/;
/ {
    soc {
        spi0: spi@7e204000 {
            imu1: adi,ad7124-8@0 {
            };
        };
    };
};`;

    test(`${resolve_node_identifier.name} - bare label/child expands to &{/abs/path/child}`, () => {
        const doc = parse_dts(dts_source);
        expect(resolve_node_identifier(doc, 'spi0/adi,ad7124-8@0')).toBe('&{/soc/spi@7e204000/adi,ad7124-8@0}');
    });

    test(`${resolve_node_identifier.name} - &label/child expands to &{/abs/path/child}`, () => {
        const doc = parse_dts(dts_source);
        expect(resolve_node_identifier(doc, '&spi0/adi,ad7124-8@0')).toBe('&{/soc/spi@7e204000/adi,ad7124-8@0}');
    });

    test(`${resolve_node_identifier.name} - already-absolute &{/path} is returned unchanged`, () => {
        const doc = parse_dts(dts_source);
        expect(resolve_node_identifier(doc, '&{/soc/spi@7e204000}')).toBe('&{/soc/spi@7e204000}');
    });

    test(`${resolve_node_identifier.name} - bare label with no slash is returned unchanged`, () => {
        const doc = parse_dts(dts_source);
        expect(resolve_node_identifier(doc, 'spi0')).toBe('spi0');
    });

    test(`${resolve_node_identifier.name} - unresolvable prefix is returned unchanged`, () => {
        const doc = parse_dts(dts_source);
        expect(resolve_node_identifier(doc, 'nonexistent/child@0')).toBe('nonexistent/child@0');
    });

}
