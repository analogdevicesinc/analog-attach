import {
    Attach,
    DeviceTree,
    extract_compatible,
    is_dt_flag,
    type DTLabel,
    type DTNode,
    type DTPath,
    type DtoPrintOptions,
    type FoundNodeResult,
} from 'attach-lib';

import { DeviceTreeOverlay } from 'attach-lib';
import { execSync } from "node:child_process";
import * as fs from 'node:fs';
import path from "node:path";

import type { LocalContext } from "./context";
import { load_compat_index, save_compat_index, type AttachConfig, type CompatIndex } from "./config";
import { input_error } from "./protocol/output";

/**
 * Message for a required positional that is missing because a variadic flag
 * given first swallowed it: `update --with 19 IRQ_TYPE_EDGE_FALLING adc/interrupts`
 * hands every token after `--with` to the flag, path included. `tokens` are
 * what the flag received.
 */
export function swallowed_positional_message(positional: string, flag: string, tokens: string[], example: string): string {
    return `Missing: ${positional}. ${flag} takes every token after it (here: ${tokens.join(" ")}), so put the ${positional} before it, e.g. ${example}`;
}

/** Substitute `{name}` placeholders in a command template, quoting each value so spaces are tolerated. */
export function substitute_command(template: string, values: Record<string, string>): string {
    let command = template;
    for (const [name, value] of Object.entries(values)) {
        command = command.replaceAll(`{${name}}`, `"${value}"`);
    }
    return command;
}

/** Whether the given tool is available on PATH (`check` is a cheap invocation, e.g. "dtc --version"). */
export function is_tool_available(check: string): boolean {
    try {
        execSync(check, { stdio: "ignore" });
        return true;
    } catch {
        return false;
    }
}

export function resolve_node_identifier(
    identifier: string,
    overlay: DeviceTreeOverlay
): DTLabel | DTPath {
    const clean = identifier;

    // `&label` / `&{/path}` are DTS phandle sigils, not accepted as CLI
    // navigation input (they are shell metacharacters and redundant with the
    // bare forms). attach-lib's label lookup would normalize `&spi0` back to
    // `spi0` and match, so route any sigil identifier to a literal path query
    // that matches no node — navigation then reports the usual "not found".
    if (identifier.startsWith("&")) {
        return { kind: "path", labels: [], path: identifier };
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
// property segment. The property is the text after the final '/'. Returns
// `property_name === undefined` when there is no separable trailing segment
// (bare label, or an absolute path whose only '/' is the leading one); callers
// try the whole identifier as a node first and fall back to this, so an
// absolute node path never mis-splits.
export function parse_property_reference(arguments_: string[]): { node_identifier: string; property_name: string } | undefined {
    const full_path = arguments_.join("/");
    const last_slash = full_path.lastIndexOf("/");
    const property_name = last_slash === -1 ? "" : full_path.slice(last_slash + 1);
    const node_identifier = last_slash > 0
        ? full_path.slice(0, last_slash)
        : (last_slash === 0 ? "/" : "");
    return property_name && node_identifier ? { node_identifier, property_name } : undefined;
}

export function split_property_reference(
    identifier: string
): { node_identifier: string; property_name: string | undefined } {
    const last_slash = identifier.lastIndexOf("/");

    if (last_slash <= 0) {
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

    if (index.linux !== undefined && path.resolve(linux) !== path.resolve(index.linux)) { return true; }
    if (index.dt_schema !== undefined && path.resolve(dtSchema) !== path.resolve(index.dt_schema)) { return true; }

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
    if (first.startsWith("/")) {
        return arguments_.length === 1 ? first : `${first}/${arguments_.slice(1).join("/")}`;
    }
    return arguments_.join("/");
}

// Report a fragment's target as a navigation identifier. The bare label / plain
// absolute path is returned deliberately (not the DTS phandle forms `&label` /
// `&{/path}`): this string is surfaced by `suggest`/completion and fed back as
// CLI input, which no longer accepts the `&` sigil (it is a shell metacharacter).
export function fragment_target(fragment: DTNode): string | undefined {
    const target = fragment.properties.find(p => p.name === "target");
    if (target !== undefined && !is_dt_flag(target.value)) {
        for (const value of target.value) {
            if (value.kind !== "array") { continue; }
            for (const element of value.elements) {
                if (element.kind === "label") {
                    return element.name.startsWith("&") ? element.name.slice(1) : element.name;
                }
                if (element.kind === "path") {
                    return element.path;
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

export interface WriteTarget {
    target_reference: DTLabel | DTPath;
    found: FoundNodeResult | undefined;
    is_base_target: boolean;
    binding_node: DTNode | undefined;
    binding_parent: DTNode | undefined;
    parent_name: string;
}

export function resolve_write_target(
    node_identifier: string,
    overlay: DeviceTreeOverlay,
    base_dt: DeviceTree,
): WriteTarget {
    const target_reference = resolve_node_identifier(node_identifier, overlay);
    const found = overlay.find_node(target_reference);

    const base_reference = target_reference.kind === "path"
        ? base_dt.get_node_by_path(target_reference)
        : base_dt.get_node_by_label(target_reference);

    const is_base_target = (found?.is_in_base ?? false) || (found === undefined && base_reference !== undefined);

    let binding_node: DTNode | undefined;
    let binding_parent: DTNode | undefined;
    let parent_name = "";

    if (is_base_target && base_reference !== undefined) {
        binding_node = base_dt.deref_node(base_reference);
        const parent_reference = base_dt.get_parent(base_reference);
        binding_parent = parent_reference === undefined ? undefined : base_dt.deref_node(parent_reference);
        parent_name = base_reference.labels.at(-1)?.name ?? base_reference.full_path.path;
    } else if (found !== undefined) {
        binding_node = found.node;
        binding_parent = found.parent_node;
        parent_name = found.node.labels.at(-1) ?? found.node_path;
    }

    return { target_reference, found, is_base_target, binding_node, binding_parent, parent_name };
}

export function load_trees(
    context_: LocalContext,
    context_path: string,
    overlay_path: string,
    base_dt?: DeviceTree,
): { base_dt: DeviceTree; overlay: DeviceTreeOverlay } | undefined {
    const dt = base_dt ?? DeviceTree.new_from_string(fs.readFileSync(context_path, "utf8"));
    if (typeof dt === "string") {
        if (context_.json) { input_error(`Failed to parse dts: ${dt}`); return; }
        console.log(`Failed to parse dts ${context_path}: ${dt}`);
        return;
    }

    const overlay = DeviceTreeOverlay.new_from_string(fs.readFileSync(overlay_path, "utf8"), dt);
    if (typeof overlay === "string") {
        if (context_.json) { input_error(`Failed to parse dtso: ${overlay}`); return; }
        console.log(`Failed to parse dtso ${overlay_path}: ${overlay}`);
        return;
    }

    return { base_dt: dt, overlay };
}

export function load_base(
    context_: LocalContext,
    context_path: string,
    base_dt?: DeviceTree,
): DeviceTree | undefined {
    const dt = base_dt ?? DeviceTree.new_from_string(fs.readFileSync(context_path, "utf8"));
    if (typeof dt === "string") {
        if (context_.json) { input_error(`Failed to parse dts: ${dt}`); return; }
        console.log(`Failed to parse dts ${context_path}: ${dt}`);
        return;
    }
    return dt;
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

    test("fragment_target reads a label target as the bare label", () => {
        const overlay = parse_overlay(`/dts-v1/; /plugin/; &spi0 { };`);
        const [fragment] = overlay.get_fragments();
        expect(fragment).toBeDefined();
        expect(fragment_target(fragment!)).toBe("spi0");
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

    test("split_property_reference - splits an absolute path/property reference", () => {
        expect(split_property_reference("/soc/spi@7e204000/reg"))
            .toEqual({ node_identifier: "/soc/spi@7e204000", property_name: "reg" });
    });

    test("split_property_reference - no property for a bare label", () => {
        expect(split_property_reference("spi0")).toEqual({ node_identifier: "spi0", property_name: undefined });
    });

    test("split_property_reference - deepest slash wins for nested label/child/property", () => {
        expect(split_property_reference("imu1/channel@0/reg"))
            .toEqual({ node_identifier: "imu1/channel@0", property_name: "reg" });
    });

    test("resolve_node_identifier rejects a `&label` sigil — routed to a non-matching path", () => {
        const overlay = parse_overlay(`/dts-v1/; /plugin/; &spi0 { };`);
        // `&spi0` is a DTS phandle sigil, not accepted CLI input. It must NOT be
        // normalized back to the bare `spi0`: it is returned as a literal path
        // query that resolves to nothing, so navigation reports "not found".
        const resolved = resolve_node_identifier("&spi0", overlay);
        expect(resolved).toEqual({ kind: "path", labels: [], path: "&spi0" });
        expect(overlay.find_node(resolved)).toBeUndefined();
    });

    test("resolve_node_identifier rejects a `&{/path}` sigil — routed to a non-matching path", () => {
        const overlay = parse_overlay(`/dts-v1/; /plugin/; &{/soc/spi@7e204000} { };`);
        const resolved = resolve_node_identifier("&{/soc/spi@7e204000}", overlay);
        expect(resolved).toEqual({ kind: "path", labels: [], path: "&{/soc/spi@7e204000}" });
        expect(overlay.find_node(resolved)).toBeUndefined();
    });
}

/**
 * Load the compat index, building it if missing and rebuilding it if stale.
 * Returns undefined only when the index is absent and linux/dtSchema are unset
 * (so it cannot be built). `log` receives progress lines (stderr-worthy).
 */
export async function get_or_build_compat_index(
    linux: string | undefined,
    dtSchema: string | undefined,
    log?: (message: string) => void,
): Promise<CompatIndex | undefined> {
    const index = load_compat_index();

    if (index === undefined) {
        if (linux === undefined || dtSchema === undefined) { return undefined; }
        log?.("compat-index.json not found, building...");
        const entries = await build_compat_index(linux, dtSchema);
        const compat_index_path = save_compat_index(entries, linux, dtSchema);
        log?.(`Written: ${compat_index_path}`);
        return { generated_at: Date.now(), linux, dt_schema: dtSchema, entries };
    }

    if (linux !== undefined && dtSchema !== undefined && is_compat_index_stale(index, linux, dtSchema)) {
        log?.("compat-index.json is stale, rebuilding...");
        const entries = await build_compat_index(linux, dtSchema);
        const compat_index_path = save_compat_index(entries, linux, dtSchema);
        log?.(`Written: ${compat_index_path}`);
        return { generated_at: Date.now(), linux, dt_schema: dtSchema, entries };
    }

    return index;
}

export async function find_binding(linux: string, dtSchema: string, compatible_to_find: string, silent = false): Promise<string | undefined> {
    const index = await get_or_build_compat_index(linux, dtSchema, silent ? undefined : (message) => console.error(message));

    // linux/dtSchema are defined here, so the index is always built.
    if (index === undefined) { return undefined; }

    const cached_path = index.entries[compatible_to_find];

    if (cached_path !== undefined && fs.existsSync(cached_path)) {
        return cached_path;
    }

    return;
}

export function overlay_print_options(config: AttachConfig): DtoPrintOptions {
    const syntax = config.overlaySyntax;
    if (syntax === "fragment" || syntax === "label") {
        return { syntax };
    }
    if (syntax !== undefined) {
        console.error(`Unknown overlay-syntax "${syntax}", using fragment`);
    }
    return { syntax: "fragment" };
}

export function write_overlay(file: string, overlay: DeviceTreeOverlay, config: AttachConfig): void {
    fs.writeFileSync(file, overlay.print(overlay_print_options(config)));
}