// `backend.complete`: the candidates for one word, from the same data functions the `list`
// commands render (commands/list/data.ts), called directly. It replaces attach-linux's
// COMPLETION_SPEC table, its `__complete` engine and the hidden `__list` command, which ran
// a `list` kind in JSON mode and read back what it printed.
//
// It runs on every Tab: it never builds a cache and never prints. A workspace that doesn't
// load (no settings, no caches) gives no candidates; the cache warning goes to
// `session.warn`, which prints nothing in `complete` mode.

import type { Candidate, Completion, Session, Slot } from "../../interface/backend-interface";
import { load_workspace, optional_bindings, type Need, type Workspace } from "./config/workspace";
import type { Suggestion } from "./protocol/types";
import { template_suggestions } from "./commands/add/template-suggest";
import { device_keys, entry_points, load_binding, navigate, overlay_file_suggestions, overlay_property_suggestions, parent_suggestions, value_list } from "./commands/list/data";
import { node_children } from "./commands/list/suggest";

const NONE: Completion = { candidates: [] };

/** A display that repeats the value with a note (`reg (required)`, `fan-… (child node …)`) describes it by the note alone. */
export function short_description(value: string, display: string): string | undefined {
    if (display === value) { return undefined; }
    const note = /^(.*?)…? \((.*)\)$/.exec(display);
    return note?.[1] === value || note?.[1] === value.replace(/…$/, "") ? note[2] : display;
}

/** A suggestion of the data functions as a candidate: its display trimmed to the note, its group and stem kept. */
export function to_candidate(suggestion: Suggestion): Candidate {
    const description = suggestion.display_string === undefined ? undefined : short_description(suggestion.value, suggestion.display_string);
    return {
        value: suggestion.value,
        ...(description === undefined ? {} : { description }),
        ...(suggestion.partial === true ? { partial: true } : {}),
        ...(suggestion.group === undefined ? {} : { group: suggestion.group }),
    };
}

/** The workspace, or undefined when it doesn't load (completion offers nothing then). */
function workspace_of<N extends Need>(session: Session, needs: readonly N[]): Workspace<N> | undefined {
    const loaded = load_workspace(session, needs);
    return loaded.ok ? loaded.workspace : undefined;
}

// ── node paths ──────────────────────────────────────────────────────────────

/**
 * A node path, one segment at a time within one word: before the first `/` the roots,
 * each followed by `/` and partial (the shell adds no space); after it the children of
 * the node typed so far, as whole words (COMPL-050, COMPL-051). A leading `/` is the root.
 */
function path_candidates(
    partial: string,
    roots: () => Promise<{ value: string; description?: string }[]>,
    children: (identifier: string) => string[] | undefined,
): Promise<Completion> | Completion {
    const slash = partial.lastIndexOf("/");
    if (slash === -1) {
        return roots().then(found => ({
            candidates: found.map(({ value, description }) => ({
                value: value.endsWith("/") ? value : `${value}/`,
                ...(description === undefined ? {} : { description }),
                partial: true,
            })),
        }));
    }
    const parent = slash === 0 ? "/" : partial.slice(0, slash);
    const head = partial.slice(0, slash + 1);
    return { candidates: (children(parent) ?? []).map(child => ({ value: `${head}${child}` })) };
}

/**
 * The roots of a node path, by command. Every command of attach-linux's table started
 * from the overlay's entry points (COMPL-050, open issue CO-2), and `add --parent` from
 * the device's valid parents (COMPL-052); the children are the merged tree's for all.
 */
function tree_path(partial: string, session: Session): Completion | Promise<Completion> {
    const workspace = workspace_of(session, ["base", "overlay"]);
    if (workspace === undefined) { return NONE; }
    const { tree: overlay } = workspace.overlay;
    const base = workspace.base.tree;
    return path_candidates(
        partial,
        () => Promise.resolve(entry_points(overlay).map(value => ({ value }))),
        identifier => node_children(base, overlay, identifier),
    );
}

async function parent_path(compatible: string | undefined, partial: string, session: Session): Promise<Completion> {
    if (compatible === undefined) { return NONE; }
    const workspace = workspace_of(session, ["bindings", "base", "overlay"]);
    if (workspace === undefined) { return NONE; }
    const { tree: overlay } = workspace.overlay;
    const base = workspace.base.tree;
    return path_candidates(
        partial,
        async () => {
            const binding = await load_binding(workspace.bindings, compatible);
            if (!binding.ok) { return []; }
            return parent_suggestions(base, binding.binding).map(s => ({ value: s.value, ...(s.display_string === undefined ? {} : { description: s.display_string }) }));
        },
        identifier => node_children(base, overlay, identifier),
    );
}

// ── properties and values ───────────────────────────────────────────────────

async function property_candidates(command: string, identifier: string, session: Session): Promise<Completion> {
    const workspace = workspace_of(session, ["base", "overlay"]);
    if (workspace === undefined || identifier === "") { return NONE; }
    const { tree: overlay } = workspace.overlay;
    // `delete` removes only what the overlay sets (COMPL-064).
    if (command === "delete") { return { candidates: overlay_property_suggestions(identifier, overlay).map(s => to_candidate(s)) }; }
    // Bindings are optional: without them the node's own children and properties.
    const found = await navigate(identifier, overlay, workspace.base.tree, optional_bindings(workspace));
    return found.kind === "node" ? { candidates: found.suggestions.map(s => to_candidate(s)) } : NONE;
}

/**
 * The values `list value` suggests (COMPL-065). After value tokens already typed
 * (`update adc interrupts 19 <Tab>`), the rest of each suggestion that starts with them.
 */
export function continue_values(suggestions: readonly Suggestion[], prior: readonly string[]): Suggestion[] {
    if (prior.length === 0) { return [...suggestions]; }
    const seen = new Set<string>();
    return suggestions.flatMap(suggestion => {
        const tokens = suggestion.value.split(/\s+/).filter(token => token !== "");
        if (tokens.length <= prior.length || !prior.every((token, index) => tokens[index] === token)) { return []; }
        const value = tokens.slice(prior.length).join(" ");
        if (seen.has(value)) { return []; }
        seen.add(value);
        return [{ ...suggestion, value }];
    });
}

async function value_candidates(slot: Extract<Slot, { kind: "value" }>, session: Session): Promise<Completion> {
    // `list value`'s member: Linux has no union values.
    if (slot.command !== "update" || slot.path === "" || slot.property === "") { return NONE; }
    const workspace = workspace_of(session, ["base", "overlay"]);
    if (workspace === undefined) { return NONE; }
    const found = await value_list(slot.path, slot.property, workspace.overlay.tree, workspace.base.tree, optional_bindings(workspace));
    if (!found.ok) { return NONE; }
    return { candidates: continue_values(found.value.suggestions, slot.prior).map(s => to_candidate(s)) };
}

// ── devices, overlays, templates ────────────────────────────────────────────

/** The compatibles of the compat index (COMPL-070); the front end keeps those that start with the word. */
function device_candidates(partial: string, session: Session): Completion {
    const workspace = workspace_of(session, ["bindings"]);
    if (workspace === undefined) { return NONE; }
    return { candidates: device_keys(workspace.bindings, partial === "" ? undefined : partial).map(value => ({ value })) };
}

/** `import`'s source: the overlay files of the Linux tree (COMPL-072), or any file. */
function source_candidates(partial: string, session: Session): Completion {
    const workspace = workspace_of(session, ["bindings"]);
    const candidates = workspace === undefined ? [] : overlay_file_suggestions(workspace.bindings.linux, partial === "" ? undefined : partial).map(s => to_candidate(s));
    return { candidates, fallback: "files" };
}

/** `add --template`: `required`, the binding's examples with the device, the overlays that add it (COMPL-071). */
async function template_candidates(compatible: string | undefined, session: Session): Promise<Completion> {
    if (compatible === undefined) { return NONE; }
    const workspace = workspace_of(session, ["bindings", "base"]);
    if (workspace === undefined) { return NONE; }
    const suggestions = await template_suggestions(workspace, compatible);
    return { candidates: suggestions.map(s => to_candidate(s)) };
}

// ── the slot ────────────────────────────────────────────────────────────────

/** The candidates for one slot. May throw; `complete` is the silent one. */
export async function complete_slot(slot: Slot, partial: string, session: Session): Promise<Completion> {
    switch (slot.kind) {
        case "path": { return tree_path(partial, session); }
        case "property": { return property_candidates(slot.command, slot.path, session); }
        case "value": { return value_candidates(slot, session); }
        case "device": { return device_candidates(partial, session); }
        case "source": { return source_candidates(partial, session); }
        case "flag": {
            if (slot.command !== "add") { return NONE; }
            if (slot.flag === "parent") { return parent_path(slot.prior[0], partial, session); }
            if (slot.flag === "template") { return template_candidates(slot.prior[0], session); }
            // --name, --label: free text.
            return NONE;
        }
        case "extra": {
            switch (slot.id) {
                // move's node and destination, enable's and disable's node.
                case "path":
                case "destination": { return tree_path(partial, session); }
                // list parent's and list overlay's device.
                case "compatible": { return device_candidates(partial, session); }
                default: { return NONE; }
            }
        }
    }
}

/** `Backend.complete`: never throws, never prints. */
export async function complete(slot: Slot, partial: string, session: Session): Promise<Completion> {
    try {
        return await complete_slot(slot, partial, session);
    } catch {
        return NONE;
    }
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    test("short_description — a display that repeats the value keeps only its note", () => {
        expect(short_description("reg", "reg (required)")).toBe("required");
        expect(short_description("fan-", "fan-… (child node ^fan-[0-9]+$)")).toBe("child node ^fan-[0-9]+$");
        expect(short_description("aon_intr", "aon_intr (disabled)")).toBe("disabled");
        expect(short_description("reg", "reg")).toBeUndefined();
        expect(short_description("gpio", "gpio — interrupt controller, #interrupt-cells = <2>")).toBe("gpio — interrupt controller, #interrupt-cells = <2>");
        expect(short_description("spi0/", "/soc/spi@0")).toBe("/soc/spi@0");
    });

    test("to_candidate — the trimmed description, the group and the stem", () => {
        expect(to_candidate({ value: "fan-", display_string: "fan-… (child node ^fan-[0-9]+$)", partial: true, group: "not set" }))
            .toEqual({ value: "fan-", description: "child node ^fan-[0-9]+$", partial: true, group: "not set" });
        expect(to_candidate({ value: "reg", display_string: "reg" })).toEqual({ value: "reg" });
    });

    test("continue_values — the rest of the suggestions that start with the typed tokens", () => {
        const suggestions = [
            { value: "19 IRQ_TYPE_EDGE_FALLING", display_string: "19 IRQ_TYPE_EDGE_FALLING — spi_pmod1.int" },
            { value: "19 IRQ_TYPE_LEVEL_LOW" },
            { value: "20 IRQ_TYPE_EDGE_FALLING" },
            { value: "&vref" },
        ];
        expect(continue_values(suggestions, [])).toEqual(suggestions);
        expect(continue_values(suggestions, ["19"]).map(s => s.value)).toEqual(["IRQ_TYPE_EDGE_FALLING", "IRQ_TYPE_LEVEL_LOW"]);
        expect(continue_values(suggestions, ["19", "IRQ_TYPE_LEVEL_LOW"])).toEqual([]);
    });
}
