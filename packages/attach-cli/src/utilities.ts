import {
    Attach,
    extract_compatible,
    is_dt_flag,
    type DTNode,
    type DTProperty,
    type DTValue,
    type DTNumber,
    type DTLabel,
    type DTPath,
    type DTExpression,
    type ParsedBinding
} from 'attach-lib';

import { DeviceTreeOverlay } from 'attach-lib';
import * as fs from 'node:fs';
import path from "node:path";

import { load_compat_index, save_compat_index, type CompatIndex } from "./config";

export function resolve_node_identifier(
    identifier: string,
    overlay: DeviceTreeOverlay
): DTLabel | DTPath {
    const clean = identifier.startsWith("&") ? identifier.slice(1) : identifier;

    if (clean.startsWith("{/") && clean.endsWith("}")) {
        return { kind: "path", labels: [], path: clean.slice(1, -1) };
    }
    if (identifier.startsWith("/")) {
        return { kind: "path", labels: [], path: identifier };
    }

    const slash = clean.indexOf("/");
    if (slash === -1) {
        return { kind: "label", labels: [], name: clean };
    }

    const label_part = clean.slice(0, slash);
    const child_part = clean.slice(slash + 1);

    const base = overlay.get_base_dts();

    if (base !== undefined) {
        const found = base.resolve_identifier(label_part);
        if (found !== undefined) {
            const reference = found.kind === "path"
                ? base.get_node_by_path(found)
                : base.get_node_by_label(found);
            if (reference !== undefined) {
                return { kind: "path", labels: [], path: `${reference.full_path.path}/${child_part}` };
            }
        }
    }

    const in_overlay = overlay.find_node({ kind: "label", labels: [], name: label_part });

    if (in_overlay !== undefined) {
        return { kind: "path", labels: [], path: `${in_overlay.node_path}/${child_part}` };
    }

    return { kind: "label", labels: [], name: label_part };
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

export function is_compat_index_stale(index: CompatIndex, linux: string, dtSchema: string): boolean {
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

// TODO: this should be in lib: it's practically translating raw data to something the validator can ingest
export function parse_dt_node(node: DTNode, parsed_binding: ParsedBinding): Map<string, unknown> {
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