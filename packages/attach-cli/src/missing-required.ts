import type { DeviceTree } from "attach-lib";

import type { Bindings, Workfile } from "./config/workspace";
import type { MissingProperty, Suggestion, Types } from "./protocol/types";
import { resolve_target_binding, type PropertyInfo } from "./commands/list/suggest";
import { format_details, format_missing } from "./commands/read/command";
import { apply_update } from "./commands/update/command";
import { node_missing_required, property_details } from "./node-state";
import { run_interview, type Entry, type InterviewSteps } from "./commands/add/interview";

// The required properties a new node still lacks, after `add` or after
// `update <path> <child>`: asked for on a terminal, listed otherwise, and
// described for an AI under --json.

/** The node to complete: `identifier` is how commands name it (a label, `adc/channel@0`), `path` its absolute path. */
export interface NewNode {
    workfile: Workfile;
    base: DeviceTree;
    bindings: Bindings;
    identifier: string;
    path: string;
}

/** Whether a person is at the other end: questions can be asked. */
export const on_terminal = (): boolean => process.stdin.isTTY && process.stdout.isTTY;

/** The required properties the node still lacks, in the order to set them. */
export async function missing_required_of(node: NewNode): Promise<string[]> {
    const { binding } = await resolve_target_binding(node.identifier, node.workfile.tree, node.base, { ok: true, value: node.bindings });
    return "error" in binding ? [] : node_missing_required(binding, node.workfile.tree, node.path);
}

/** The missing properties with what the binding says about them, for an AI to ask itself. */
export async function describe_missing(node: NewNode, missing: string[]): Promise<MissingProperty[]> {
    const { workfile, base, bindings, identifier } = node;
    const target = await resolve_target_binding(identifier, workfile.tree, base, { ok: true, value: bindings });
    return missing.map(property => {
        const { info, suggestions, others } = property_details(target, workfile.tree, base, identifier, property);
        return {
            property,
            ...(info?.description === undefined ? {} : { description: info.description }),
            suggestions: [...suggestions, ...others],
        };
    });
}

type Cell = Exclude<Types, { kind: "array" | "tuple" | "bool" }>;

const is_cell = (type: Types): type is Cell => type.kind === "number" || type.kind === "string" || type.kind === "enum";

/** The type of each cell of a fixed-size value: an array whose count the binding fixes (of values, or of tuples that fill it). */
function fixed_cells(type: Types): Cell[] | undefined {
    if (type.kind === "tuple") { return type.items.every(item => is_cell(item)) ? type.items : undefined; }
    if (type.kind !== "array" || type.min_items === undefined || type.min_items !== type.max_items) { return; }
    const count = type.min_items;
    const row = type.items.kind === "tuple" ? type.items.items : [type.items];
    if (row.length === 0 || count % row.length !== 0 || !row.every(item => is_cell(item))) { return; }
    return Array.from({ length: count / row.length }, () => row).flat();
}

const enum_suggestions = (type: Extract<Types, { kind: "enum" }>, suggestions: Suggestion[]): Suggestion[] =>
    type.options.map(({ value }) => suggestions.find(s => s.value === String(value)) ?? { value: String(value) });

/**
 * How the interview asks for a property: a lettered list for a closed set (an
 * enum, the nodes a phandle can name), and one entry per line for a fixed-size
 * array (diff-channels, interrupts once its parent is known). Undefined: the
 * whole value on one line. Enter takes the first suggestion (for a fixed-size
 * array, its cells), or the first option; never one of the other candidates.
 */
export function question_entries(info: PropertyInfo | undefined, suggestions: Suggestion[], others: Suggestion[]): Entry[] | undefined {
    if (info === undefined) { return; }
    const first = suggestions[0]?.value;
    if (info.phandle_options !== undefined) {
        const options = [...suggestions, ...others];
        return options.length === 0 ? undefined : [{ options, ...(first === undefined ? {} : { default: first }) }];
    }
    const enum_entry = (type: Extract<Types, { kind: "enum" }>, fallback: string | undefined): Entry => {
        const options = enum_suggestions(type, suggestions);
        const pick = options.find(o => o.value === fallback) ?? options[0];
        return { options, ...(pick === undefined ? {} : { default: pick.value }) };
    };
    const { type } = info;
    if (type.kind === "enum") { return [enum_entry(type, first)]; }
    const cells = fixed_cells(type);
    if (cells === undefined) {
        // An enum list of any length: several picks on one line.
        return type.kind === "array" && type.items.kind === "enum" ? [{ ...enum_entry(type.items, first), several: true }] : undefined;
    }
    if (cells.length < 2) { return; }
    const defaults = first === undefined || first.includes(",") ? [] : first.split(/\s+/);
    const fallbacks = defaults.length === cells.length ? defaults : [];
    return cells.map((cell, index): Entry => {
        const fallback = fallbacks[index];
        if (cell.kind === "enum") { return enum_entry(cell, fallback); }
        return { kind: cell.kind, ...(fallback === undefined ? {} : { default: fallback }) };
    });
}

/** The questions are rebuilt each time, so an answer (interrupt-parent) shapes the next one (interrupts). */
function interview_steps({ workfile, base, bindings, identifier }: NewNode): InterviewSteps {
    return {
        ask: async (property) => {
            const target = await resolve_target_binding(identifier, workfile.tree, base, { ok: true, value: bindings });
            const { info, suggestions, others } = property_details(target, workfile.tree, base, identifier, property);
            const entries = question_entries(info, suggestions, others);
            if (entries === undefined) {
                // Enter takes the first suggestion, never one of the other candidates.
                return { property, details: format_details(info, [...suggestions, ...others], { with_type: true }), suggestions };
            }
            // The entries list the options themselves.
            const listed = entries.some(entry => entry.options !== undefined);
            return { property, details: format_details(info, [], { with_type: !listed, with_allowed: !listed }), suggestions, entries };
        },
        apply: async (property, tokens) => {
            const outcome = await apply_update(workfile, base, bindings, identifier, property, tokens);
            switch (outcome.kind) {
                case "set": { return { ok: true, lines: outcome.detail === undefined ? [outcome.message] : [outcome.message, outcome.detail] }; }
                case "error": { return { ok: false, lines: [outcome.message] }; }
                case "read": { return { ok: false, lines: [`${property} needs a value`] }; }
            }
        },
    };
}

export function missing_lines(identifier: string, missing: string[]): string[] {
    if (missing.length === 0) { return []; }
    return [...format_missing(missing), `Set them with: update ${identifier} <property> <value>`];
}

/**
 * Ask for the `missing` required properties on a terminal (unless `interview`
 * is off), or list them. Human output only; --json uses `describe_missing`.
 */
export async function ask_for_missing(node: NewNode, missing: string[], { interview }: { interview: boolean }): Promise<void> {
    const interactive = interview && on_terminal();
    if (!interactive || missing.length === 0) {
        for (const line of missing_lines(node.identifier, missing)) { console.log(line); }
        return;
    }

    console.log("");
    await run_interview(missing, interview_steps(node), { input: process.stdin, output: process.stdout, terminal: true });
    console.log("");
    const left = await missing_required_of(node);
    const done = left.length === 0 ? ["All required properties are set."] : missing_lines(node.identifier, left);
    for (const line of done) { console.log(line); }
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    test("missing_lines — the missing list with how to set them, nothing when complete", () => {
        expect(missing_lines("ad7124_8", ["interrupt-parent", "interrupts"])).toEqual([
            "Missing required: interrupt-parent, interrupts",
            "Set them with: update ad7124_8 <property> <value>",
        ]);
        expect(missing_lines("adc/channel@0", ["diff-channels"])).toEqual([
            "Missing required: diff-channels",
            "Set them with: update adc/channel@0 <property> <value>",
        ]);
        expect(missing_lines("ad7124_8", [])).toEqual([]);
    });

    const info = (type: Types, extra: Partial<PropertyInfo> = {}): PropertyInfo =>
        ({ type, description: "", required: true, binding_path: "/b.yaml", constraints: {}, suggestions: [], ...extra });
    const number: Types = { kind: "number", subtype: "int" };
    const irq_types: Types = { kind: "enum", options: [{ value: "IRQ_TYPE_NONE" }, { value: "IRQ_TYPE_EDGE_RISING" }] };

    test("question_entries — an enum is one lettered pick, the first suggestion (the binding's default) taken by Enter", () => {
        const reference = info({ kind: "enum", options: [{ value: 0 }, { value: 1 }, { value: 3 }] });
        expect(question_entries(reference, [{ value: "3", display_string: "3 — the binding's default" }, { value: "0" }, { value: "1" }], [])).toEqual([{
            options: [{ value: "0" }, { value: "1" }, { value: "3", display_string: "3 — the binding's default" }],
            default: "3",
        }]);
        expect(question_entries(reference, [], [])).toEqual([{ options: [{ value: "0" }, { value: "1" }, { value: "3" }], default: "0" }]);
    });

    test("question_entries — a phandle picks among the suggestions, then the other candidates, never one of those by default", () => {
        const parent = info({ kind: "enum", options: [{ value: "gicv2" }, { value: "gpio" }, { value: "aon_intr" }] }, { phandle_options: ["gicv2", "gpio", "aon_intr"] });
        const others = [{ value: "aon_intr", display_string: "aon_intr (disabled)" }];
        expect(question_entries(parent, [{ value: "gicv2" }, { value: "gpio" }], others))
            .toEqual([{ options: [{ value: "gicv2" }, { value: "gpio" }, ...others], default: "gicv2" }]);
        expect(question_entries(parent, [], others)).toEqual([{ options: others }]);
        expect(question_entries(parent, [], [])).toBeUndefined();
    });

    test("question_entries — a fixed-size array, one entry per cell: interrupts is a number then a lettered IRQ type", () => {
        const interrupts = info({ kind: "array", items: { kind: "tuple", items: [number, irq_types] }, min_items: 2, max_items: 2 });
        expect(question_entries(interrupts, [], [])).toEqual([
            { kind: "number" },
            { options: [{ value: "IRQ_TYPE_NONE" }, { value: "IRQ_TYPE_EDGE_RISING" }], default: "IRQ_TYPE_NONE" },
        ]);
        // A whole suggestion gives each entry its default.
        expect(question_entries(interrupts, [{ value: "25 IRQ_TYPE_EDGE_RISING" }], []))
            .toMatchObject([{ kind: "number", default: "25" }, { default: "IRQ_TYPE_EDGE_RISING" }]);
        const diff_channels = info({ kind: "array", items: number, min_items: 2, max_items: 2 });
        expect(question_entries(diff_channels, [], [])).toEqual([{ kind: "number" }, { kind: "number" }]);
        // Two gpio interrupts: the tuple twice.
        expect(question_entries(info({ ...interrupts.type, min_items: 4, max_items: 4 } as Types), [], [])).toHaveLength(4);
    });

    test("question_entries — an enum list of any length takes several picks; other values are one line", () => {
        expect(question_entries(info({ kind: "array", items: irq_types }), [], []))
            .toEqual([{ options: [{ value: "IRQ_TYPE_NONE" }, { value: "IRQ_TYPE_EDGE_RISING" }], default: "IRQ_TYPE_NONE", several: true }]);
        expect(question_entries(info(number), [{ value: "2" }], [])).toBeUndefined();
        expect(question_entries(info({ kind: "array", items: number, min_items: 1, max_items: 4 }), [], [])).toBeUndefined();
        expect(question_entries(info({ kind: "array", items: number }), [], [])).toBeUndefined();
        expect(question_entries(undefined, [{ value: "2" }], [])).toBeUndefined();
    });
}
