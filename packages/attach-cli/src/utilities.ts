import {
    Attach,
    Result,
    DeviceTree,
    extract_compatible,
    is_dt_flag,
    type DTLabel,
    type DTNode,
    type DTPath,
    type FoundNodeResult,
    type LocatedNode,
} from 'attach-lib';

import { DeviceTreeOverlay } from 'attach-lib';
import { execSync } from "node:child_process";
import * as fs from 'node:fs';
import path from "node:path";

import { load_compat_index, type CompatIndex } from "./config/cache";
import type { Bindings } from "./config/workspace";
import { input_error } from "./protocol/output";

// --- New shared path helpers (Group A) ---

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export function parse_node_path(raw: string): Parsed<string> {
    if (raw === "") { return { ok: false, error: "Missing: path" }; }
    if (raw.startsWith("&")) {
        const bare = raw.startsWith("&{") && raw.endsWith("}") ? raw.slice(2, -1) : raw.slice(1);
        return { ok: false, error: `Use the bare form: ${bare}` };
    }
    if (/\s/.test(raw)) { return { ok: false, error: "a path is one token (join segments with /)" }; }
    if (raw.includes("//")) { return { ok: false, error: `empty segment in path: ${raw}` }; }
    const normalized = raw === "/" ? "/" : raw.replace(/\/$/, "");
    return { ok: true, value: normalized };
}

export function parse_property_name(raw: string): Parsed<string> {
    if (raw === "") { return { ok: false, error: "Missing: property name" }; }
    if (raw.includes("/")) { return { ok: false, error: "pass node and property separately" }; }
    return { ok: true, value: raw };
}

export interface ResolvedPath {
    reference: DTLabel | DTPath;
    in_overlay: FoundNodeResult | undefined;
    in_base: LocatedNode | undefined;
}

export function resolve_path(path_string: string, overlay: DeviceTreeOverlay, base?: DeviceTree): ResolvedPath {
    const reference = resolve_node_identifier(path_string, overlay);
    const in_overlay = overlay.find_node(reference);
    const in_base = base?.locate(reference);
    return { reference, in_overlay, in_base };
}

export function not_found_message(path_string: string, overlay: DeviceTreeOverlay, base?: DeviceTree): string {
    const split = split_property_reference(path_string);
    if (split.property_name !== undefined) {
        const parent = resolve_path(split.node_identifier, overlay, base);
        if (parent.in_overlay !== undefined || parent.in_base !== undefined) {
            return `Not found: ${path_string} (the property is a separate argument: <path> <property>)`;
        }
    }
    if (!path_string.startsWith("/") && path_string.includes("/")) {
        return `Not found: ${path_string}`;
    }
    return `Not found: ${path_string}`;
}

import type { LocalContext as LocalContextType } from "./context";

export function parse_target(
    context_: LocalContextType,
    path_raw: string | undefined,
    property_raw: string | undefined,
    need: { path: "required" | "optional"; property: "required" | "optional" | "none" },
): { path: string | undefined; property: string | undefined } | undefined {
    if (need.path === "required" && path_raw === undefined) {
        const message = "Missing: path";
        if (context_.json) { input_error(message); } else { console.log(message); }
        return undefined;
    }
    if (path_raw !== undefined) {
        const parsed = parse_node_path(path_raw);
        if (!parsed.ok) {
            if (context_.json) { input_error(parsed.error); } else { console.log(parsed.error); }
            return undefined;
        }
        path_raw = parsed.value;
    }
    if (need.property === "required" && property_raw === undefined) {
        const message = "Missing: property name";
        if (context_.json) { input_error(message); } else { console.log(message); }
        return undefined;
    }
    if (property_raw !== undefined) {
        const parsed = parse_property_name(property_raw);
        if (!parsed.ok) {
            if (context_.json) { input_error(parsed.error); } else { console.log(parsed.error); }
            return undefined;
        }
        property_raw = parsed.value;
    }
    return { path: path_raw, property: property_raw };
}

/** Substitute `{name}` placeholders in a command template, quoting each value so spaces are tolerated. */
export function substitute_command(template: string, values: Record<string, string>): string {
    let command = template;
    for (const [name, value] of Object.entries(values)) {
        command = command.replaceAll(`{${name}}`, `"${value}"`);
    }
    return command;
}

/** Run a `preprocess-command` template on `input` into `output`; the error output when it fails. */
export function run_preprocess(template: string, values: { input: string; output: string; linux?: string }): string | undefined {
    try {
        execSync(substitute_command(template, values), { stdio: "pipe" });
        return undefined;
    } catch (error) {
        return (error as { stderr?: Buffer }).stderr?.toString().trim() ?? String(error);
    }
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
            const located = base.locate(found);
            if (located !== undefined) {
                return { kind: "path", labels: [], path: `${located.path}/${child_part}` };
            }
        }
    }

    const in_overlay = overlay.find_node(label_part);

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

export async function build_compat_index(
    linux: string,
    dtSchema: string,
    on_progress?: (done: number, total: number) => void,
): Promise<{ entries: Record<string, string>; files: number }> {
    const bindings_folder = path.resolve(linux, "Documentation", "devicetree", "bindings");
    const index: Record<string, string> = {};

    if (!fs.existsSync(bindings_folder)) {
        return { entries: index, files: 0 };
    }

    const all_files = get_all_file_paths(bindings_folder);
    const yaml_files = all_files.filter(file => file.endsWith(".yaml"));

    for (const [position, file] of yaml_files.entries()) {
        on_progress?.(position + 1, yaml_files.length);
        const binding = await Attach.parse(file, { linux, dt_schema: dtSchema });

        if (Result.is_err(binding)) {
            continue;
        }

        const compatible = extract_compatible(binding.value.parsed_binding);

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

    return { entries: index, files: yaml_files.length };
}

/** @deprecated Use parse_node_path instead. Kept only for suggest callers pending Group B. */
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
    parent_compatibles: string[];
}

export function resolve_write_target(
    node_identifier: string,
    overlay: DeviceTreeOverlay,
    base_dt: DeviceTree,
): WriteTarget {
    const target_reference = resolve_node_identifier(node_identifier, overlay);
    const found = overlay.find_node(target_reference);

    const base_located = base_dt.locate(target_reference);

    const is_base_target = (found?.is_in_base ?? false) || (found === undefined && base_located !== undefined);

    let binding_node: DTNode | undefined;
    let binding_parent: DTNode | undefined;
    let parent_name = "";

    if (is_base_target && base_located !== undefined) {
        binding_node = base_located.node;
        binding_parent = base_dt.get_parent(base_located.path)?.node;
        parent_name = base_located.node.labels.at(-1) ?? base_located.path;
    } else if (found !== undefined) {
        binding_node = found.node;
        binding_parent = found.parent_node;
        parent_name = found.node.labels.at(-1) ?? found.node_path;
    }

    const node_path = found?.node_path ?? (base_located === undefined ? "" : base_located.path);
    const parent_compats = effective_parent_compatibles(binding_parent, node_path, base_dt);
    return { target_reference, found, is_base_target, binding_node, binding_parent, parent_name, parent_compatibles: parent_compats };
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;
    const { DeviceTree: DT, DeviceTreeOverlay: DTO } = await import("attach-lib");

    const base_dts = `/dts-v1/; / { soc { spi0: spi@7e204000 {}; }; };`;

    const parse_overlay = (overlay_source: string): DeviceTreeOverlay => {
        const base = DT.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DTO.new_from_string(overlay_source, base);
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

    test("parse_node_path — valid forms", () => {
        expect(parse_node_path("spi0")).toEqual({ ok: true, value: "spi0" });
        expect(parse_node_path("spi0/adc@0")).toEqual({ ok: true, value: "spi0/adc@0" });
        expect(parse_node_path("/soc/spi@7e204000")).toEqual({ ok: true, value: "/soc/spi@7e204000" });
        expect(parse_node_path("/")).toEqual({ ok: true, value: "/" });
    });

    test("parse_node_path — trailing slash stripped", () => {
        expect(parse_node_path("spi0/")).toEqual({ ok: true, value: "spi0" });
    });

    test("parse_node_path — errors", () => {
        expect(parse_node_path("")).toEqual({ ok: false, error: "Missing: path" });
        expect(parse_node_path("&spi0").ok).toBe(false);
        expect(parse_node_path("&{/x}").ok).toBe(false);
        expect(parse_node_path("spi0//x").ok).toBe(false);
    });

    test("parse_property_name — valid and invalid", () => {
        expect(parse_property_name("reg")).toEqual({ ok: true, value: "reg" });
        expect(parse_property_name("#address-cells")).toEqual({ ok: true, value: "#address-cells" });
        expect(parse_property_name("")).toEqual({ ok: false, error: "Missing: property name" });
        expect(parse_property_name("adc@0/reg").ok).toBe(false);
    });

    test("resolve_path — a base child via label", () => {
        const base = DT.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DTO.new_from_string(`/dts-v1/; /plugin/; &spi0 {};`, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }
        const resolved = resolve_path("spi0", overlay, base);
        expect(resolved.in_overlay).toBeDefined();
        expect(resolved.in_base).toBeDefined();
    });

    test("resolve_path — overlay label/child", () => {
        const base = DT.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DTO.new_from_string(`/dts-v1/; /plugin/; &spi0 { adc: adc@0 { reg = <0>; }; };`, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }
        const resolved = resolve_path("spi0/adc@0", overlay, base);
        expect(resolved.in_overlay).toBeDefined();
    });

    test("not_found_message — hint for old syntax", () => {
        const base = DT.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DTO.new_from_string(`/dts-v1/; /plugin/; &spi0 { adc: adc@0 { reg = <0>; }; };`, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }
        const message = not_found_message("spi0/adc@0/reg", overlay, base);
        expect(message).toContain("the property is a separate argument");
    });

    test("effective_parent_compatibles — overlay __overlay__ parent resolves via base tree", () => {
        const base_with_compat = DT.new_from_string(`/dts-v1/; / { soc { spi0: spi@7e204000 { compatible = "brcm,bcm2835-spi"; }; }; };`);
        if (typeof base_with_compat === "string") { throw new TypeError(base_with_compat); }
        const overlay = DTO.new_from_string(`/dts-v1/; /plugin/; &spi0 { adc@0 { reg = <0>; }; };`, base_with_compat);
        if (typeof overlay === "string") { throw new TypeError(overlay); }
        const found = overlay.find_node("/soc/spi@7e204000/adc@0");
        expect(found).toBeDefined();
        const parent_compats = effective_parent_compatibles(found!.parent_node, found!.node_path, base_with_compat);
        expect(parent_compats).toEqual(["brcm,bcm2835-spi"]);
    });

    test("effective_parent_compatibles — missing parent → empty", () => {
        const base = DT.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }
        expect(effective_parent_compatibles(undefined, "unknown", base)).toEqual([]);
    });

    const bus_node = (name: string, compatible?: string): DTNode => ({
        name,
        unit_addr: "0",
        labels: [],
        children: [],
        properties: compatible === undefined ? [] : [{ name: "compatible", value: [{ kind: "string", value: compatible }] }],
    }) as unknown as DTNode;

    test("bus_kind — from the node name, then the compatible", () => {
        expect(bus_kind(bus_node("spi"))).toBe("spi");
        expect(bus_kind(bus_node("i2c"))).toBe("i2c");
        expect(bus_kind(bus_node("bus", "brcm,bcm2835-spi"))).toBe("spi");
        expect(bus_kind(bus_node("bus", "brcm,bcm2711-i2c"))).toBe("i2c");
        expect(bus_kind(bus_node("soc", "simple-bus"))).toBeUndefined();
    });
}

/**
 * The compat index `config-set linux` / `config-get --reload` built. It is
 * never built here: `parse_bindings` has checked it is there, so an empty one
 * only stands in for an index that disappeared since.
 */
export function get_compat_index({ linux, dt_schema }: Pick<Bindings, "linux" | "dt_schema">): CompatIndex {
    const index = load_compat_index();
    return index?.entries === undefined ? { generated_at: 0, linux, dt_schema, entries: {} } : index;
}

/** The other compatibles of the device's binding (the compat index maps each to its binding YAML). */
export async function binding_siblings(bindings: Pick<Bindings, "linux" | "dt_schema">, compatible: string): Promise<string[]> {
    const binding_path = await find_binding(bindings.linux, bindings.dt_schema, compatible);
    if (binding_path === undefined) { return []; }
    return Object.entries(get_compat_index(bindings).entries)
        .filter(([candidate, file]) => file === binding_path && candidate !== compatible)
        .map(([candidate]) => candidate)
        .sort();
}

export async function find_binding(linux: string, dtSchema: string, compatible_to_find: string): Promise<string | undefined> {
    const index = get_compat_index({ linux, dt_schema: dtSchema });

    const cached_path = index.entries[compatible_to_find];

    if (cached_path !== undefined && fs.existsSync(cached_path)) {
        return cached_path;
    }

    return;
}

export function node_compatibles(node: DTNode): string[] {
    const compatible = node.properties.find(p => p.name === "compatible");
    if (compatible === undefined || is_dt_flag(compatible.value)) { return []; }
    return compatible.value
        .filter(v => v.kind === "string")
        .map(v => (v as { kind: "string"; value: string }).value);
}

export type BusKind = "spi" | "i2c";

/** The bus a node is, from its generic node name (`spi@…`, `i2c@…`) or else its compatible. */
export function bus_kind(node: DTNode): BusKind | undefined {
    for (const kind of ["spi", "i2c"] as const) {
        if (node.name === kind) { return kind; }
    }
    for (const compatible of node_compatibles(node)) {
        if (/\bspi\b/.test(compatible)) { return "spi"; }
        if (/\bi2c\b/.test(compatible)) { return "i2c"; }
    }
    return undefined;
}

export function effective_parent_compatibles(
    parent_node: DTNode | undefined,
    node_path: string,
    base_dt: DeviceTree,
): string[] {
    if (parent_node !== undefined) {
        const compatibles = node_compatibles(parent_node);
        if (compatibles.length > 0) { return compatibles; }
    }
    const parent_path = node_path.includes("/")
        ? node_path.slice(0, node_path.lastIndexOf("/")) || "/"
        : undefined;
    if (parent_path === undefined) { return []; }
    const base_node = base_dt.node_at(parent_path);
    if (base_node === undefined) { return []; }
    return node_compatibles(base_node);
}
