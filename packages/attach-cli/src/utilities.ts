import {
    Attach,
    extract_compatible,
    is_dt_flag,
    type DTLabel,
    type DTNode,
    type DTPath
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

// Split a joined node reference into its node part and an optional trailing
// property segment. The property is the text after the final '/' that lies
// outside any sigil-path brace group (`&{/...}`) — a '/' inside the braces is
// part of the path, not a separator. Returns `property_name === undefined` when
// there is no separable trailing segment (bare label, absolute or sigil path,
// or a slash only inside braces); callers try the whole identifier as a node
// first and fall back to this, so an absolute node path never mis-splits.
export function split_property_reference(
    identifier: string
): { node_identifier: string; property_name: string | undefined } {
    const brace_close = identifier.lastIndexOf("}");
    const last_slash = identifier.lastIndexOf("/");

    if (last_slash <= 0 || last_slash < brace_close) {
        return { node_identifier: identifier, property_name: undefined };
    }

    const property_name = identifier.slice(last_slash + 1);
    if (property_name.length === 0) {
        return { node_identifier: identifier, property_name: undefined };
    }

    return { node_identifier: identifier.slice(0, last_slash), property_name };
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

export function resolve_positional_path(arguments_: string[]): string | undefined {
    if (arguments_.length === 0) { return undefined; }
    const first = arguments_[0]!;
    if (first.startsWith("/") || first.startsWith("&")) {
        return arguments_.length === 1 ? first : `${first}/${arguments_.slice(1).join("/")}`;
    }
    return arguments_.join("/");
}

export function fragment_target(fragment: DTNode): string | undefined {
    const target = fragment.properties.find(p => p.name === "target");
    if (target !== undefined && !is_dt_flag(target.value)) {
        for (const value of target.value) {
            if (value.kind !== "array") { continue; }
            for (const element of value.elements) {
                if (element.kind === "label") {
                    const name = element.name.startsWith("&") ? element.name.slice(1) : element.name;
                    return `&${name}`;
                }
                if (element.kind === "path") {
                    return `&{${element.path}}`;
                }
            }
        }
    }

    const target_path = fragment.properties.find(p => p.name === "target-path");
    if (target_path !== undefined && !is_dt_flag(target_path.value)) {
        for (const value of target_path.value) {
            if (value.kind === "string") { return value.value; }
        }
    }

    return undefined;
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;
    const { DeviceTree: DT, DeviceTreeOverlay: DTO } = await import("attach-lib");

    const base_dts = `/dts-v1/; / { soc { spi0: spi@7e204000 {}; }; };`;

    const parse_overlay = (overlay_src: string): DeviceTreeOverlay => {
        const base = DT.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DTO.new_from_string(overlay_src, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }
        return overlay;
    };

    test("fragment_target reads a label target as &label", () => {
        const overlay = parse_overlay(`/dts-v1/; /plugin/; &spi0 { };`);
        const [fragment] = overlay.get_fragments();
        expect(fragment).toBeDefined();
        expect(fragment_target(fragment!)).toBe("&spi0");
    });

    test("fragment_target reads a path target as the absolute path", () => {
        const overlay = parse_overlay(`/dts-v1/; /plugin/; &{/soc/spi@7e204000} { };`);
        const [fragment] = overlay.get_fragments();
        expect(fragment).toBeDefined();
        expect(fragment_target(fragment!)).toBe("/soc/spi@7e204000");
    });

    test("split_property_reference - splits a label/property reference", () => {
        expect(split_property_reference("spi0/status")).toEqual({ node_identifier: "spi0", property_name: "status" });
    });

    test("split_property_reference - splits a sigil label/property reference", () => {
        expect(split_property_reference("&imu1/reg")).toEqual({ node_identifier: "&imu1", property_name: "reg" });
    });

    test("split_property_reference - splits an absolute path/property reference", () => {
        expect(split_property_reference("/soc/spi@7e204000/reg"))
            .toEqual({ node_identifier: "/soc/spi@7e204000", property_name: "reg" });
    });

    test("split_property_reference - splits a sigil-path/property reference outside the braces", () => {
        expect(split_property_reference("&{/soc/spi@7e204000}/reg"))
            .toEqual({ node_identifier: "&{/soc/spi@7e204000}", property_name: "reg" });
    });

    test("split_property_reference - no property for a bare label", () => {
        expect(split_property_reference("spi0")).toEqual({ node_identifier: "spi0", property_name: undefined });
    });

    test("split_property_reference - no property for a sigil path (slash only inside braces)", () => {
        expect(split_property_reference("&{/soc/spi@7e204000}"))
            .toEqual({ node_identifier: "&{/soc/spi@7e204000}", property_name: undefined });
    });

    test("split_property_reference - deepest slash wins for nested label/child/property", () => {
        expect(split_property_reference("imu1/channel@0/reg"))
            .toEqual({ node_identifier: "imu1/channel@0", property_name: "reg" });
    });
}

export async function find_binding(linux: string, dtSchema: string, compatible_to_find: string, silent = false): Promise<string | undefined> {
    let cached_index = load_compat_index();

    if (cached_index === undefined) {
        const entries = await build_compat_index(linux, dtSchema);
        const compat_index_path = save_compat_index(entries);
        if (!silent) { console.error(`Written: ${compat_index_path}`); }
        return entries[compatible_to_find];
    }

    if (is_compat_index_stale(cached_index, linux, dtSchema)) {
        if (!silent) { console.error("compat-index.json is stale, rebuilding..."); }
        const entries = await build_compat_index(linux, dtSchema);
        const compat_index_path = save_compat_index(entries);
        if (!silent) { console.error(`Written: ${compat_index_path}`); }
        return entries[compatible_to_find];
    }

    const cached_path = cached_index.entries[compatible_to_find];

    if (cached_path !== undefined && fs.existsSync(cached_path)) {
        return cached_path;
    }

    return;
}