// The interactive side of missing-required.ts: the values filled in without asking
// (pinned by the binding, taken from its example), then the interview. Only a session
// with a prompter gets here: --json, --quiet and runs off a terminal list what is missing.
import { cell_extract_first_value, GPIO_MACROS, gpio_row_cells } from "attach-lib";

import type { InteractiveSession } from "../../interface/backend-interface";
import type { Suggestion, Types } from "./protocol/types";
import { resolve_target_binding, type PropertyInfo } from "./commands/list/suggest";
import { format_details } from "./commands/read/command";
import { apply_update, type Warn } from "./commands/update/command";
import { format_suggestion } from "./property-value";
import { missing_lines, missing_required_of, pinned_value_of, show_value, type NewNode } from "./missing-required";
import type { ExampleValue } from "./commands/add/example";
import { property_details } from "./node-state";
import { run_interview, session_io, type Entry, type InterviewSteps } from "./commands/add/interview";

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
function interview_steps({ workfile, base, bindings, identifier }: NewNode, warn: Warn): InterviewSteps {
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
            const outcome = await apply_update(workfile, base, bindings, identifier, property, tokens, warn);
            switch (outcome.kind) {
                case "set": { return { ok: true, lines: outcome.detail === undefined ? [outcome.message] : [outcome.message, outcome.detail] }; }
                case "error": { return { ok: false, lines: [outcome.message] }; }
                case "read": { return { ok: false, lines: [`${property} needs a value`] }; }
            }
        },
    };
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
 * Set the missing properties the binding pins to one value without asking:
 * `Set #address-cells = <1> (the only value the binding allows)`. Returns the
 * lines to print and what is still missing. Setting a value can narrow the
 * binding and require more, so it goes on until nothing more is pinned.
 */
export async function fill_pinned(node: NewNode, missing: string[], warn: Warn): Promise<{ lines: string[]; left: string[] }> {
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
            const outcome = await apply_update(workfile, base, bindings, identifier, property, flag ? [] : [format_suggestion(only)], warn);
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
export async function fill_from_example(node: NewNode, values: ExampleValue[], warn: Warn): Promise<{ node: NewNode; lines: string[] }> {
    const { workfile, base, bindings, identifier } = node;
    const lines: string[] = [];
    let current = node;
    for (const { property, value, index } of values) {
        const present = workfile.tree.effective_node(current.path);
        const existing = present?.properties.find(candidate => candidate.name === property);
        if (existing !== undefined && cell_extract_first_value(existing) === value) { continue; }
        // An I2C address reads (and is written) as 0x48.
        const token = property === "reg" ? `0x${value.toString(16)}` : value.toString();
        const shown = `${property} = <${token}>`;
        const why = `from example ${index}`;
        const parent = current.path.slice(0, current.path.lastIndexOf("/")) || "/";
        if (property === "reg" && present !== undefined && workfile.tree.effective_children(parent).has(`${present.name}@${value.toString(16)}`)) {
            lines.push(`Kept the address: ${present.name}@${value.toString(16)} is there already (${why})`);
            continue;
        }
        const outcome = await apply_update(workfile, base, bindings, identifier, property, [token], warn);
        const path = workfile.tree.all_labels().get(identifier) ?? current.path;
        const renamed = path === current.path ? undefined : path.slice(path.lastIndexOf("/") + 1);
        current = { ...current, path };
        lines.push(...fill_lines(shown, why, outcome, renamed));
    }
    return { node: current, lines };
}

/**
 * Ask for the `missing` required properties. The properties the binding pins and the
 * `example` values (`add`) are set first, without asking, each with a line; then the
 * interview asks for the rest; then what is still missing is listed. Everything is said
 * as it comes. Stopping the interview (Ctrl-C, Ctrl-D) keeps what was written and lists
 * the rest. --json uses `describe_missing`, a run that can't ask `missing_lines`.
 */
export async function ask_for_missing(node: NewNode, missing: string[], session: InteractiveSession, example: ExampleValue[] = []): Promise<void> {
    const warn: Warn = message => { session.warn(message); };
    const say = (line: string): void => { session.say(line); };
    const pinned = await fill_pinned(node, missing, warn);
    const from_example = await fill_from_example(node, example, warn);
    const rest = from_example.lines.length === 0 ? pinned.left : await missing_required_of(from_example.node);
    const filled = [...pinned.lines, ...from_example.lines];
    for (const line of filled) { say(line); }
    if (missing.length === 0 && filled.length === 0) { return; }

    if (rest.length > 0) {
        say("");
        await run_interview(rest, interview_steps(from_example.node, warn), session_io(session));
        say("");
    }
    const left = await missing_required_of(from_example.node);
    const done = left.length === 0 ? ["All required properties are set."] : missing_lines(node.identifier, left);
    for (const line of done) { say(line); }
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    const info = (type: Types, extra: Partial<PropertyInfo> = {}): PropertyInfo =>
        ({ type, description: "", required: true, binding_path: "/b.yaml", constraints: {}, suggestions: [], ...extra });
    const number: Types = { kind: "number", subtype: "int" };
    const irq_types: Types = { kind: "enum", options: [{ value: "IRQ_TYPE_NONE" }, { value: "IRQ_TYPE_EDGE_RISING" }] };

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
