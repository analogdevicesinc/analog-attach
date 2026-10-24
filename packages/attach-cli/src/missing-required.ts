import { cell_extract_first_value, GPIO_MACROS, gpio_row_cells, type AttachEnumType, type AttachType, type DeviceTree, type DeviceTreeOverlay, type ValueSuggestion } from "attach-lib";

import type { NodeBinding } from "./binding-resolution";
import type { Bindings, Workfile } from "./config/workspace";
import type { MissingProperty, Suggestion, Types } from "./protocol/types";
import { resolve_target_binding, value_suggestions, type PropertyInfo, type TargetBinding } from "./commands/list/suggest";
import { format_details, format_missing } from "./commands/read/command";
import { apply_update, format_suggestion } from "./commands/update/command";
import type { ExampleValue } from "./commands/add/example";
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

/** A `*-gpios` property no controller is chosen for yet: the question is a row (controller, then its cells), asked once or several times. */
const is_gpio_question = (info: PropertyInfo): info is PropertyInfo & { gpio_rows: NonNullable<PropertyInfo["gpio_rows"]> } =>
    info.gpio_rows !== undefined && info.phandle_options !== undefined;

/** `1..4`, `2`, `1 or more`: how many rows the binding gives a gpio property; nothing for exactly one. */
export function gpio_rows_text({ min_rows, max_rows }: NonNullable<PropertyInfo["gpio_rows"]>): string | undefined {
    if (max_rows === undefined) { return min_rows <= 1 ? "one or more" : `${min_rows} or more`; }
    if (max_rows <= 1) { return undefined; }
    return min_rows === max_rows ? String(max_rows) : `${min_rows}..${max_rows}`;
}

/** The entries of a gpio row after its controller: a number for each cell but the last, then the flags (one of `GPIO_*`, Enter = the first). `cells` is the controller's; a controller the tree doesn't give is asked for a line and flags. */
function gpio_cell_entries(cells: ReturnType<typeof gpio_row_cells>): Entry[] {
    const shape = cells ?? [{ kind: "number" as const }, { kind: "flags" as const, macros: GPIO_MACROS }];
    let numbers = 0;
    return shape.map((cell): Entry => {
        if (cell.kind === "number") { numbers++; return { kind: "number", label: numbers === 1 ? "line" : `cell ${numbers}` }; }
        const options = cell.macros.map(({ name, value }): Suggestion => ({ value: name, display_string: `${name} (${value})` }));
        return { options, default: options[0]!.value, label: "flags" };
    });
}

/**
 * How the interview asks for a property: a lettered list for a closed set (an
 * enum, the nodes a phandle can name), and one entry per line for a fixed-size
 * array (diff-channels, interrupts once its parent is known). Undefined: the
 * whole value on one line. Enter takes the first suggestion (for a fixed-size
 * array, its cells), or the first option; never one of the other candidates.
 */
export function question_entries(
    info: PropertyInfo | undefined,
    suggestions: Suggestion[],
    others: Suggestion[],
    row_cells: (controller: string) => ReturnType<typeof gpio_row_cells> = (): undefined => { return; },
): Entry[] | undefined {
    if (info === undefined) { return; }
    if (is_gpio_question(info)) {
        // One row: the controller first (the enabled ones, then the disabled), whose answer gives the cells that follow.
        const disabled = (option: Suggestion): boolean => option.note === "disabled";
        const options = [...suggestions, ...others.filter(o => !disabled(o)), ...others.filter(o => disabled(o))];
        const first = options[0];
        if (first === undefined) { return undefined; }
        return [{ options, ...(disabled(first) ? {} : { default: first.value }), label: "controller", reference: true, after: controller => gpio_cell_entries(row_cells(controller)) }];
    }
    const first = suggestions[0]?.value;
    if (info.phandle_options !== undefined) {
        const options = [...suggestions, ...others];
        return options.length === 0 ? undefined : [{ options, ...(first === undefined ? {} : { default: first }), reference: true }];
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
            const entries = question_entries(info, suggestions, others, controller => gpio_row_cells(workfile.tree.merged_tree() ?? base, controller));
            if (entries === undefined) {
                // Enter takes the first suggestion, never one of the other candidates.
                return { property, details: format_details(info, [...suggestions, ...others], { with_type: true }), suggestions };
            }
            // The entries list the options themselves.
            const listed = entries.some(entry => entry.options !== undefined);
            const details = format_details(info, [], { with_type: !listed, with_allowed: !listed });
            if (info === undefined || !is_gpio_question(info)) { return { property, details, suggestions, entries }; }
            const rows = gpio_rows_text(info.gpio_rows);
            return { property, details: rows === undefined ? details : [...details, `  Rows: ${rows}`], suggestions, entries, rows: info.gpio_rows };
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

/** A value as a line shows it: `<1>`, `<0x2a>` (`hex`), `"adi,x"`. */
function show_value(suggestion: Pick<ValueSuggestion, "rows" | "strings">, hex = false): string {
    if (suggestion.strings !== undefined) { return suggestion.strings.map(text => `"${text}"`).join(", "); }
    const cell = (value: ValueSuggestion["rows"][number][number]): string => {
        if (typeof value === "bigint") { return hex ? `0x${value.toString(16)}` : value.toString(); }
        return "label" in value ? `&${value.label}` : value.macro;
    };
    return suggestion.rows.map(row => `<${row.map(element => cell(element)).join(" ")}>`).join(", ");
}

/** The outcome of one fill as a line: what was set and why, or what refused it. */
function fill_lines(shown: string, why: string, outcome: Awaited<ReturnType<typeof apply_update>>, renamed?: string): string[] {
    switch (outcome.kind) {
        case "set": { return [`Set ${shown} (${why})${renamed === undefined ? "" : `; renamed to ${renamed}`}`, ...(outcome.detail === undefined ? [] : [outcome.detail])]; }
        case "error": { return [`Couldn't set ${shown} (${why}): ${outcome.message}`]; }
        case "read": { return [`Couldn't set ${shown} (${why})`]; }
    }
}

/**
 * The value the binding pins `property` to, when it pins one: the binding
 * layer offers exactly one value then (a `const`, a one-option enum, a flag the
 * narrowed binding requires). A binding that leaves a choice offers none or
 * several; its `default:` is one of them, never the only one.
 */
export function pinned_value_of(
    target: TargetBinding,
    overlay: DeviceTreeOverlay,
    base: DeviceTree,
    identifier: string,
    property: string,
): ValueSuggestion | undefined {
    const result = value_suggestions(target, overlay, base, identifier, property);
    if (!result.ok) { return; }
    const offered = result.values.filter(value => value.source === "binding");
    const only = offered.length === 1 ? offered[0] : undefined;
    return only?.flag === false ? undefined : only;
}

/**
 * Set the missing properties the binding pins to one value without asking:
 * `Set #address-cells = <1> (the only value the binding allows)`. Returns the
 * lines to print and what is still missing. Setting a value can narrow the
 * binding and require more, so it goes on until nothing more is pinned.
 */
export async function fill_pinned(node: NewNode, missing: string[]): Promise<{ lines: string[]; left: string[] }> {
    const { workfile, base, bindings, identifier } = node;
    const lines: string[] = [];
    const tried = new Set<string>();
    let left = missing;
    for (;;) {
        const target = await resolve_target_binding(identifier, workfile.tree, base, { ok: true, value: bindings });
        let filled = false;
        for (const property of left.filter(name => !tried.has(name))) {
            tried.add(property);
            const only = pinned_value_of(target, workfile.tree, base, identifier, property);
            if (only === undefined) { continue; }
            const flag = only.flag === true;
            const outcome = await apply_update(workfile, base, bindings, identifier, property, flag ? [] : [format_suggestion(only)]);
            const why = flag ? "a flag the binding requires" : "the only value the binding allows";
            lines.push(...fill_lines(flag ? property : `${property} = ${show_value(only)}`, why, outcome));
            filled ||= outcome.kind === "set";
        }
        left = await missing_required_of(node);
        if (!filled || left.every(name => tried.has(name))) { return { lines, left }; }
    }
}

/**
 * Write the values taken from the binding's example on the node's bus
 * (`spi-max-frequency`, an I2C `reg`) through `update`, which renames the node
 * to its new address and warns about clashes. The node keeps its own value when
 * it is the example's already, or when a sibling of the same name is at the
 * example's address (`update` couldn't rename it). Returns the lines and the
 * node, whose path changed when `reg` renamed it.
 */
export async function fill_from_example(node: NewNode, values: ExampleValue[]): Promise<{ node: NewNode; lines: string[] }> {
    const { workfile, base, bindings, identifier } = node;
    const lines: string[] = [];
    let current = node;
    for (const { property, value, index } of values) {
        const present = workfile.tree.effective_node(current.path);
        const existing = present?.properties.find(candidate => candidate.name === property);
        if (existing !== undefined && cell_extract_first_value(existing) === value) { continue; }
        const shown = `${property} = <${property === "reg" ? `0x${value.toString(16)}` : value.toString()}>`;
        const why = `from example ${index}`;
        const parent = current.path.slice(0, current.path.lastIndexOf("/")) || "/";
        if (property === "reg" && present !== undefined && workfile.tree.effective_children(parent).has(`${present.name}@${value.toString(16)}`)) {
            lines.push(`Kept the address: ${present.name}@${value.toString(16)} is there already (${why})`);
            continue;
        }
        const outcome = await apply_update(workfile, base, bindings, identifier, property, [value.toString()]);
        const path = workfile.tree.all_labels().get(identifier) ?? current.path;
        const renamed = path === current.path ? undefined : path.slice(path.lastIndexOf("/") + 1);
        current = { ...current, path };
        lines.push(...fill_lines(shown, why, outcome, renamed));
    }
    return { node: current, lines };
}

export interface AskOptions {
    /** Ask on a terminal; off lists what is missing. */
    interview: boolean;
    /** Values to take from the binding's example before the first question (`add` on a terminal). */
    example?: ExampleValue[];
}

/**
 * Ask for the `missing` required properties on a terminal (unless `interview`
 * is off), or list them. On a terminal the properties the binding pins and
 * the `example` values are set first, without asking, each with a line. Human
 * output only; --json uses `describe_missing`.
 */
export async function ask_for_missing(node: NewNode, missing: string[], { interview, example = [] }: AskOptions): Promise<void> {
    if (!interview || !on_terminal()) {
        for (const line of missing_lines(node.identifier, missing)) { console.log(line); }
        return;
    }

    const pinned = await fill_pinned(node, missing);
    const from_example = await fill_from_example(node, example);
    const rest = from_example.lines.length === 0 ? pinned.left : await missing_required_of(from_example.node);
    const filled = [...pinned.lines, ...from_example.lines];
    for (const line of filled) { console.log(line); }
    if (missing.length === 0 && filled.length === 0) { return; }

    if (rest.length > 0) {
        console.log("");
        await run_interview(rest, interview_steps(from_example.node), { input: process.stdin, output: process.stdout, terminal: true });
        console.log("");
    }
    const left = await missing_required_of(from_example.node);
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

    const { DeviceTree: DT, DeviceTreeOverlay: DTO, AttachEnumType: Kind } = await import("attach-lib");
    const { resolve_write_target } = await import("./utilities");

    // A node `adc@0` under spi0 whose binding is made of `properties` and requires `required`.
    const pinned_case = (properties: NodeBinding["properties"], required: string[]) => {
        const base = DT.new_from_string(`/dts-v1/;\n/ {\n\tspi0: spi@7e204000 {\n\t};\n};`);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DTO.new_from_string(`/dts-v1/;\n/plugin/;\n\n&spi0 {\n\tadc@0 {\n\t\tcompatible = "adi,ad5592r";\n\t\treg = <0>;\n\t};\n};`, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }
        const binding: NodeBinding = {
            properties,
            required_properties: required,
            child_nodes: [],
            property_patterns: [],
            binding_path: "/linux/iio/dac/adi,ad5592r.yaml",
            origin: { kind: "compatible", compatible: "adi,ad5592r" },
            narrow_and_populate: () => ({ properties, required_properties: required, errors: [] }),
        };
        const target: TargetBinding = { target: resolve_write_target("spi0/adc@0", overlay, base), binding };
        return (property: string) => pinned_value_of(target, overlay, base, "spi0/adc@0", property);
    };
    const one_of = (values: (bigint | string)[], enum_type: AttachEnumType = Kind.NUMBER, default_value?: string): AttachType =>
        ({ _t: "scalar", cell: { _t: "enum", enum: values, enum_type, ...(default_value === undefined ? {} : { default: default_value }) } });

    test("pinned_value_of — a const, a one-option enum and a required flag are pinned", () => {
        const pinned = pinned_case([
            { key: "#address-cells", value: one_of([1n]) },
            { key: "adi,mode", value: one_of(["only"], Kind.STRING) },
            { key: "spi-cpol", value: { _t: "flag" } },
        ], ["#address-cells", "adi,mode", "spi-cpol"]);
        expect(pinned("#address-cells")).toMatchObject({ rows: [[1n]], source: "binding" });
        expect(pinned("adi,mode")).toMatchObject({ strings: ["only"] });
        expect(pinned("spi-cpol")).toMatchObject({ flag: true });
    });

    test("pinned_value_of — a choice, a default and an optional flag are not pinned", () => {
        const pinned = pinned_case([
            { key: "adi,mode", value: one_of([0n, 1n]) },
            { key: "adi,rate", value: { _t: "scalar", cell: { _t: "number", signed: false }, default: 8n } as unknown as AttachType },
            { key: "spi-cpha", value: { _t: "flag" } },
            { key: "adi,names", value: one_of(["a", "b"], Kind.STRING, "a") },
        ], ["adi,mode", "adi,rate", "adi,names"]);
        // Two options: several suggestions, the first being the binding's default for the name list.
        expect(pinned("adi,mode")).toBeUndefined();
        expect(pinned("adi,rate")).toBeUndefined();
        expect(pinned("spi-cpha")).toBeUndefined();
        expect(pinned("adi,names")).toBeUndefined();
        expect(pinned("unknown")).toBeUndefined();
    });

    test("pinned_value_of — a property no layer has a value for is not pinned", () => {
        expect(pinned_case([{ key: "reg", value: { _t: "unknown" } }], ["reg"])("reg")).toBeUndefined();
    });

    test("show_value — cells, hex on request, macros, labels, strings", () => {
        expect(show_value({ rows: [[1n]] })).toBe("<1>");
        expect(show_value({ rows: [[42n]] }, true)).toBe("<0x2a>");
        expect(show_value({ rows: [[{ label: "gpio" }, 5n, { macro: "GPIO_ACTIVE_LOW" }], [1n]] })).toBe("<&gpio 5 GPIO_ACTIVE_LOW>, <1>");
        expect(show_value({ rows: [], strings: ["a", "b"] })).toBe('"a", "b"');
    });

    test("fill_lines — what was set and why, the rename, or what refused it", () => {
        expect(fill_lines("reg = <0x2a>", "from example 1", { kind: "set", message: "Set reg on acc", warned: false }, "adi,adxl345@2a"))
            .toEqual(["Set reg = <0x2a> (from example 1); renamed to adi,adxl345@2a"]);
        expect(fill_lines("spi-cpol", "a flag the binding requires", { kind: "set", message: "m", detail: "Set interrupt-parent", warned: false }))
            .toEqual(["Set spi-cpol (a flag the binding requires)", "Set interrupt-parent"]);
        expect(fill_lines("reg = <0x2a>", "from example 1", { kind: "error", message: "reg update would create a naming conflict; not written" }))
            .toEqual(["Couldn't set reg = <0x2a> (from example 1): reg update would create a naming conflict; not written"]);
    });

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
            .toEqual([{ options: [{ value: "gicv2" }, { value: "gpio" }, ...others], default: "gicv2", reference: true }]);
        expect(question_entries(parent, [], others)).toEqual([{ options: others, reference: true }]);
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

    const gpio_info = (rows: { min_rows: number; max_rows?: number }): PropertyInfo =>
        info({ kind: "enum", options: [{ value: "gpio" }, { value: "expgpio" }, { value: "aon_gpio" }] }, { phandle_options: ["gpio", "expgpio", "aon_gpio"], gpio_rows: rows });
    const gpio_others = [
        { value: "aon_gpio", display_string: "aon_gpio (disabled)", note: "disabled" },
        { value: "gpio", display_string: "gpio (enabled)", note: "enabled" },
        { value: "expgpio", display_string: "expgpio (enabled by the overlay)", note: "enabled by the overlay" },
    ];

    test("question_entries — a gpio property asks the controller first: enabled ones, then disabled, Enter takes the first enabled", () => {
        const entries = question_entries(gpio_info({ min_rows: 6, max_rows: 6 }), [], gpio_others);
        expect(entries).toHaveLength(1);
        expect(entries?.[0]).toMatchObject({
            options: [gpio_others[1], gpio_others[2], gpio_others[0]],
            default: "gpio",
            label: "controller",
        });
        // Only disabled controllers: listed, nothing taken by Enter.
        expect(question_entries(gpio_info({ min_rows: 1 }), [], [gpio_others[0]!])?.[0]?.default).toBeUndefined();
        expect(question_entries(gpio_info({ min_rows: 1 }), [], [])).toBeUndefined();
    });

    test("question_entries — the controller's answer gives the cells: #gpio-cells 1, 2, 3, and a controller the tree lacks", () => {
        const flags = GPIO_MACROS.map(({ name, value }) => ({ value: name, display_string: `${name} (${value})` }));
        const line = { kind: "number" as const, label: "line" };
        const entries = question_entries(gpio_info({ min_rows: 1, max_rows: 1 }), [], gpio_others, () => [{ kind: "number" }]);
        expect(entries?.[0]?.after?.("gpio")).toEqual([line]);
        const of = (cells?: ReturnType<typeof gpio_row_cells>) => question_entries(gpio_info({ min_rows: 1 }), [], gpio_others, () => cells)?.[0]?.after?.("gpio");
        expect(of([{ kind: "number" }, { kind: "flags", macros: GPIO_MACROS }])).toEqual([line, { options: flags, default: "GPIO_ACTIVE_HIGH", label: "flags" }]);
        expect(of([{ kind: "number" }, { kind: "number" }, { kind: "flags", macros: GPIO_MACROS }])).toEqual([line, { kind: "number", label: "cell 2" }, { options: flags, default: "GPIO_ACTIVE_HIGH", label: "flags" }]);
        // No #gpio-cells to read: a line and the flags.
        expect(of()).toEqual([line, { options: flags, default: "GPIO_ACTIVE_HIGH", label: "flags" }]);
    });

    test("question_entries — a gpio property whose controller is set (no phandle options) is not a row question", () => {
        const set = info({ kind: "array", items: number, min_items: 1, max_items: 4 }, { gpio_rows: { min_rows: 1, max_rows: 4 } });
        expect(question_entries(set, [], [])).toBeUndefined();
    });

    test("gpio_rows_text — the count of rows, nothing for exactly one", () => {
        expect(gpio_rows_text({ min_rows: 6, max_rows: 6 })).toBe("6");
        expect(gpio_rows_text({ min_rows: 1, max_rows: 4 })).toBe("1..4");
        expect(gpio_rows_text({ min_rows: 1 })).toBe("one or more");
        expect(gpio_rows_text({ min_rows: 2 })).toBe("2 or more");
        expect(gpio_rows_text({ min_rows: 1, max_rows: 1 })).toBeUndefined();
    });
}
