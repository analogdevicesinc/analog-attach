// What each `list` kind and each completion kind of the old `__list` finds, as data: the
// `list` commands render it, and completion (complete.ts) offers it as candidates.
// Nothing here prints. A refusal carries the JSON message and, where the human wording
// differs, the text (`Node X not found` / `Node not found: X`).

import path from "node:path";

import {
    Attach,
    Result as AttachResult,
    parent_path_string,
    suggest_parents,
    type DeviceTree,
    type DeviceTreeOverlay,
    type ParsedBinding,
} from "attach-lib";

import type { Bindings } from "../../config/workspace";
import type { ConfigResult } from "../../config/settings";
import { overlay_files } from "../../overlay-index";
import { narrowed_binding } from "../../binding-resolution";
import type { Suggestion } from "../../protocol/types";
import { find_binding, fragment_target, get_compat_index, resolve_node_identifier, type IndexedBindings } from "../../utilities";
import {
    describe_child_nodes,
    describe_property_pattern,
    effective_target_node,
    navigate_candidates,
    navigate_node,
    property_info,
    resolve_target_binding,
    value_suggestions,
    type PropertyInfo,
} from "./suggest";

/** What a kind found, or why not: `message` is the response's, `text` the human wording when it differs. */
export type Found<T> = { ok: true; value: T } | { ok: false; message: string; text?: string };

const node_not_found = (identifier: string): { ok: false; message: string; text: string } =>
    ({ ok: false, message: `Node ${identifier} not found`, text: `Node not found: ${identifier}` });

// ── devices ─────────────────────────────────────────────────────────────────

/** The compatibles of the compat index that contain `filter`, every one without a filter, in the index's order. */
export function device_keys(bindings: IndexedBindings, filter?: string): string[] {
    const entries = Object.keys(get_compat_index(bindings).entries);
    return filter === undefined ? entries : entries.filter(entry => entry.includes(filter));
}

export type LoadedBinding =
    | { ok: true; path: string; binding: ParsedBinding }
    | { ok: false; reason: "none"; message: string; text: string }
    | { ok: false; reason: "parse"; message: string; text: string };

/** The parsed binding of a compatible, from the compat index. */
export async function load_binding(bindings: Bindings, compatible: string): Promise<LoadedBinding> {
    const binding_path = await find_binding(bindings, compatible);
    if (binding_path === undefined) {
        return { ok: false, reason: "none", message: `No binding found for ${compatible}`, text: `Failed to find binding for ${compatible}` };
    }
    const parsed = await Attach.parse(binding_path, bindings);
    if (AttachResult.is_err(parsed)) {
        const message = `Failed to parse binding ${binding_path}`;
        return { ok: false, reason: "parse", message, text: message };
    }
    return { ok: true, path: binding_path, binding: parsed.value.parsed_binding };
}

// ── parent (`list parent`, completion of `add --parent`) ────────────────────

/** The valid parents of a device in the base: the label (or path) to pass, and the path. */
export function parent_suggestions(base: DeviceTree, binding: ParsedBinding): Suggestion[] {
    return suggest_parents(base, binding).map(p => ({ value: p.label ?? parent_path_string(p), display_string: parent_path_string(p) }));
}

// ── overlay files (completion of `import`) ──────────────────────────────────

/** The overlay file names of the Linux tree that start with `filter`; only the file list, no scan. */
export function overlay_file_suggestions(linux: string, filter?: string): Suggestion[] {
    return overlay_files(linux)
        .filter(file => filter === undefined || path.basename(file).startsWith(filter))
        .map(file => ({ value: path.basename(file), display_string: file }));
}

// ── a node's properties (`list property <path>`) ────────────────────────────

export interface NodeProperties {
    /** The narrowed binding's properties, in binding order, with whether the merged node has each and whether it is required. */
    properties: { name: string; set: boolean; required: boolean }[];
    /** The binding's property patterns (`describe_property_pattern`). */
    patterns: Suggestion[];
    /** The binding's child-node patterns (`describe_child_nodes`). */
    children: Suggestion[];
}

/** What the node's binding allows: its properties, property patterns and child-node patterns. */
export async function node_properties(identifier: string, overlay: DeviceTreeOverlay, base: DeviceTree, bindings: Bindings): Promise<Found<NodeProperties>> {
    const node = effective_target_node(identifier, overlay, base);
    if (node === undefined) { return node_not_found(identifier); }

    const { binding } = await resolve_target_binding(identifier, overlay, base, { ok: true, value: bindings });
    if ("error" in binding) { return { ok: false, message: binding.error }; }

    const applicable = narrowed_binding(binding, node);
    const required = new Set(applicable.required_properties);
    const existing = new Set(node.properties.map(p => p.name));
    return {
        ok: true,
        value: {
            properties: applicable.properties.map(p => ({ name: p.key, set: existing.has(p.key), required: required.has(p.key) })),
            patterns: binding.property_patterns.map(rule => describe_property_pattern(rule, node)),
            children: binding.child_nodes.map(rule => describe_child_nodes(rule, node)),
        },
    };
}

/** The entries of `node_properties`, one suggestion each: a property's name with its marks (`compatible (set, required)`), then the patterns. */
export function node_property_entries({ properties, patterns, children }: NodeProperties): Suggestion[] {
    return [
        ...properties.map(({ name, set, required }) => {
            const marks = [...(set ? ["set"] : []), ...(required ? ["required"] : [])].join(", ");
            return { value: name, ...(marks ? { display_string: `${name} (${marks})` } : {}) };
        }),
        ...patterns,
        ...children,
    ];
}

/** `Found 12 properties, 1 property pattern(s) and 1 child node pattern(s)`. */
export function node_properties_message({ properties, patterns, children }: NodeProperties): string {
    const pattern_note = patterns.length > 0 ? `, ${patterns.length} property pattern(s)` : "";
    const child_note = children.length > 0 ? ` and ${children.length} child node pattern(s)` : "";
    return `Found ${properties.length} properties${pattern_note}${child_note}`;
}

// ── one property (`list property <path> <property>`) ────────────────────────

/** What the node's binding says about one property, and whether the merged node has it. */
export async function property_type(
    identifier: string,
    property: string,
    overlay: DeviceTreeOverlay,
    base: DeviceTree,
    bindings: Bindings,
): Promise<Found<{ info: PropertyInfo; set: boolean }>> {
    const { target, binding } = await resolve_target_binding(identifier, overlay, base, { ok: true, value: bindings });
    if (target.binding_node === undefined) { return node_not_found(identifier); }
    if ("error" in binding) { return { ok: false, message: binding.error }; }
    const result = property_info(binding, target.binding_node, property);
    if (!result.ok) { return { ok: false, message: result.message }; }
    const node = effective_target_node(identifier, overlay, base);
    return { ok: true, value: { info: result.info, set: node?.properties.some(p => p.name === property) === true } };
}

// ── values (`list value <path> <property>`) ─────────────────────────────────

/**
 * The values the intelligence stack offers for a property, with the message
 * that sums them up. Without bindings (or a binding for the node) the values
 * are listed unchecked, and the message says why.
 */
export async function value_list(
    identifier: string,
    property: string,
    overlay: DeviceTreeOverlay,
    base: DeviceTree,
    bindings: ConfigResult<Bindings>,
): Promise<Found<{ message: string; suggestions: Suggestion[] }>> {
    const target = await resolve_target_binding(identifier, overlay, base, bindings);
    const result = value_suggestions(target, overlay, base, identifier, property);
    if (!result.ok) { return node_not_found(identifier); }
    const { values, suggestions } = result;

    const count = (source: string): number => values.filter(value => value.source === source).length;
    const parts = ([[count("binding"), "pinned by the binding"], [count("devicetree"), "from the context devicetree"]] as const)
        .filter(([n]) => n > 0)
        .map(([n, origin]) => `${n} value(s) ${origin}`);
    let message = parts.length > 0 ? `Found ${parts.join("; ")}` : `No values for ${property}`;
    if ("error" in target.binding) { message = `${message}; not checked against a binding (${target.binding.error})`; }
    return { ok: true, value: { message, suggestions } };
}

// ── completion only ─────────────────────────────────────────────────────────

/** The overlay's entry points: each fragment's target, once. */
export function entry_points(overlay: DeviceTreeOverlay): string[] {
    return [...new Set(overlay.get_fragments().map(fragment => fragment_target(fragment)).filter((target): target is string => target !== undefined))];
}

export type Navigation =
    | { kind: "node"; suggestions: Suggestion[] }
    /** The path ends at a property of the overlay: nothing to navigate into, but not an error. */
    | { kind: "property"; name: string }
    | { kind: "not-found" };

/**
 * What can follow a node in the property positional (`navigate_candidates`),
 * on the node as the base and the overlay together have it. Bindings are
 * optional: without them the node's own children and properties are offered.
 */
export async function navigate(identifier: string, overlay: DeviceTreeOverlay, base: DeviceTree, bindings: ConfigResult<Bindings>): Promise<Navigation> {
    const node = navigate_node(identifier, overlay, base);
    if (node === undefined) {
        const last_slash = identifier.lastIndexOf("/");
        if (last_slash > 0) {
            const parent = overlay.find_node(resolve_node_identifier(identifier.slice(0, last_slash), overlay));
            const name = identifier.slice(last_slash + 1);
            if (parent?.node.properties.some(p => p.name === name) === true) { return { kind: "property", name }; }
        }
        return { kind: "not-found" };
    }
    const { binding } = bindings.ok ? await resolve_target_binding(identifier, overlay, base, bindings) : { binding: undefined };
    const found = effective_target_node(identifier, overlay, base);
    // What the node's data selects: a property an if/then branch forbids isn't offered, one it requires is marked.
    const applicable = binding === undefined || "error" in binding ? undefined : (found === undefined ? binding : narrowed_binding(binding, found));
    return { kind: "node", suggestions: navigate_candidates(node, applicable) };
}

/** The properties the overlay sets on a node: what `delete <path> <property>` can remove (a base value can only be overridden). */
export function overlay_property_suggestions(identifier: string | undefined, overlay: DeviceTreeOverlay): Suggestion[] {
    const found = identifier === undefined ? undefined : overlay.find_node(resolve_node_identifier(identifier, overlay));
    const names = found === undefined ? [] : overlay.overlay_properties(found.node_path).map(p => p.name);
    return names.map(value => ({ value, group: "set" }));
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    test("node_property_entries / node_properties_message — the marks, then the patterns; the counts", () => {
        const found: NodeProperties = {
            properties: [{ name: "compatible", set: true, required: true }, { name: "reg", set: false, required: true }, { name: "spi-cpol", set: true, required: false }, { name: "label", set: false, required: false }],
            patterns: [{ value: "^adi,pin[0-1]$", display_string: "adi,pin0, adi,pin1 (pattern ^adi,pin[0-1]$)" }],
            children: [],
        };
        expect(node_property_entries(found)).toEqual([
            { value: "compatible", display_string: "compatible (set, required)" },
            { value: "reg", display_string: "reg (required)" },
            { value: "spi-cpol", display_string: "spi-cpol (set)" },
            { value: "label" },
            { value: "^adi,pin[0-1]$", display_string: "adi,pin0, adi,pin1 (pattern ^adi,pin[0-1]$)" },
        ]);
        expect(node_properties_message(found)).toBe("Found 4 properties, 1 property pattern(s)");
        expect(node_properties_message({ ...found, patterns: [], children: [{ value: "^channel@[0-3]$" }] })).toBe("Found 4 properties and 1 child node pattern(s)");
    });
}
