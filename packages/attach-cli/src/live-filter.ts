// The live filter of the setup wizard's DTS search: on a terminal every
// keystroke narrows the list. The state machine (`apply_key`) and the drawing
// (`render_frame`) are pure; `live_filter` only wires them to the keypress
// events of stdin.

const BOLD = "\u001B[1m";
const DIM = "\u001B[2m";
const CYAN = "\u001B[36m";
const RESET = "\u001B[0m";

/** Rows shown at once; a longer match list scrolls with the highlight. */
export const MAX_ROWS = 20;

export interface FilterState {
    query: string;
    /** Index in the match list of the highlighted row. */
    highlight: number;
    /** An arrow key moved the highlight: with an empty query Enter needs that, so a stray Enter takes nothing. */
    moved: boolean;
}

export const INITIAL_STATE: FilterState = { query: "", highlight: 0, moved: false };

export type FilterAction =
    | { kind: "none" }
    | { kind: "select"; item: string }
    | { kind: "back" }
    | { kind: "cancel" };

/** The part of a Node keypress event the filter reads. */
export interface KeyPress {
    sequence?: string;
    name?: string;
    ctrl?: boolean;
    meta?: boolean;
}

/** The items that contain `query`, ignoring case, in their order. */
export function filter_items(items: readonly string[], query: string): string[] {
    const lower = query.toLowerCase();
    return items.filter(item => item.toLowerCase().includes(lower));
}

/** The index of the first row shown when `highlight` is the highlighted row of a list longer than the window. */
export function window_start(highlight: number, size = MAX_ROWS): number {
    return highlight < size ? 0 : highlight - size + 1;
}

/** `text` with the first occurrence of `query` (ignoring case) in bold. */
export function highlight_match(text: string, query: string): string {
    if (query === "") { return text; }
    const at = text.toLowerCase().indexOf(query.toLowerCase());
    if (at === -1) { return text; }
    const end = at + query.length;
    return `${text.slice(0, at)}${BOLD}${text.slice(at, end)}${RESET}${text.slice(end)}`;
}

const is_printable = (key: KeyPress): boolean =>
    key.ctrl !== true && key.meta !== true && key.sequence !== undefined && key.sequence !== ""
    && [...key.sequence].every(character => { const code = character.codePointAt(0)!; return code >= 32 && code !== 127; });

/** The new state and what to do after one key press. */
export function apply_key(state: FilterState, key: KeyPress, items: readonly string[]): { state: FilterState; action: FilterAction } {
    const none: FilterAction = { kind: "none" };
    const same = (action: FilterAction = none): { state: FilterState; action: FilterAction } => ({ state, action });
    const matches = filter_items(items, state.query);

    if (key.ctrl === true && (key.name === "c" || key.name === "d")) { return same({ kind: "cancel" }); }
    if (key.name === "escape") { return same({ kind: "back" }); }
    if (key.name === "return" || key.name === "enter") {
        const chosen = matches[state.highlight];
        if (chosen === undefined || (state.query === "" && !state.moved)) { return same(); }
        return same({ kind: "select", item: chosen });
    }
    if (key.name === "down" || key.name === "up") {
        const next = key.name === "down" ? Math.min(state.highlight + 1, matches.length - 1) : state.highlight - 1;
        return { state: { ...state, highlight: Math.max(next, 0), moved: true }, action: { kind: "none" } };
    }
    if (key.name === "backspace") {
        return { state: { query: state.query.slice(0, -1), highlight: 0, moved: false }, action: { kind: "none" } };
    }
    if (key.ctrl === true && key.name === "u") {
        return { state: INITIAL_STATE, action: { kind: "none" } };
    }
    if (is_printable(key)) {
        return { state: { query: state.query + key.sequence, highlight: 0, moved: false }, action: { kind: "none" } };
    }
    return same();
}

/** The lines of the list for `state`: the count, the visible rows with the highlight marked, then the filter prompt. */
export function render_frame(state: FilterState, items: readonly string[], columns: number): string[] {
    const matches = filter_items(items, state.query);
    const width = Math.max(20, columns - 4);
    const start = window_start(state.highlight);
    const shown = matches.slice(start, start + MAX_ROWS);

    let info: string;
    if (matches.length === 0) { info = `No file matches "${state.query}"`; }
    else if (matches.length <= MAX_ROWS) { info = matches.length === 1 ? "1 match" : `${matches.length} matches`; }
    else { info = `${start + 1}-${start + shown.length} of ${matches.length} matches`; }

    const rows = shown.map((match, offset) => {
        const text = match.length > width ? `${match.slice(0, width - 1)}…` : match;
        const marker = start + offset === state.highlight ? `${CYAN}>${RESET}` : " ";
        return `${marker} ${highlight_match(text, state.query)}`;
    });
    return [`${DIM}${info}${RESET}`, ...rows, `Filter: ${state.query}`];
}

export type LiveResult = { kind: "select"; item: string } | { kind: "back" };

/**
 * Run the filter on stdin/stdout, which must be a terminal. readline's own key
 * handling is taken off stdin while it runs and put back when it ends. Rejects
 * with `interrupted` on Ctrl-C / Ctrl-D, like the line prompts do.
 */
export function live_filter(items: readonly string[]): Promise<LiveResult> {
    const input = process.stdin;
    const output = process.stdout;
    return new Promise((resolve, reject) => {
        const saved = input.listeners("keypress") as ((...arguments_: unknown[]) => void)[];
        input.removeAllListeners("keypress");
        let state = INITIAL_STATE;
        let drawn = 0;

        const erase = (): string => `${drawn > 1 ? `\u001B[${drawn - 1}A` : ""}\r\u001B[J`;
        const draw = (): void => {
            const lines = render_frame(state, items, output.columns || 80);
            output.write(erase() + lines.join("\n"));
            drawn = lines.length;
        };
        const finish = (done: () => void): void => {
            input.removeListener("keypress", on_key);
            for (const listener of saved) { input.on("keypress", listener); }
            output.write(erase());
            done();
        };
        const on_key = (_text: string | undefined, key: KeyPress | undefined): void => {
            const result = apply_key(state, key ?? {}, items);
            state = result.state;
            switch (result.action.kind) {
                case "select": { const { item } = result.action; finish(() => { resolve({ kind: "select", item }); }); return; }
                case "back": { finish(() => { resolve({ kind: "back" }); }); return; }
                case "cancel": { finish(() => { reject(new Error("interrupted")); }); return; }
                default: { draw(); }
            }
        };

        input.on("keypress", on_key);
        if (input.isTTY) { input.setRawMode(true); }
        input.resume();
        draw();
    });
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    const files = ["broadcom/bcm2711-rpi-4-b.dts", "broadcom/bcm2711-rpi-400.dts", "broadcom/bcm2837-rpi-3-b.dts", "freescale/imx8mp.dts"];
    const typed = (text: string): KeyPress[] => [...text].map(character => ({ sequence: character, name: character }));
    const press = (state: FilterState, keys: KeyPress[], items = files): { state: FilterState; action: FilterAction } => {
        let result: { state: FilterState; action: FilterAction } = { state, action: { kind: "none" } };
        for (const key of keys) { result = apply_key(result.state, key, items); }
        return result;
    };
    const plain = (lines: string[]): string[] => lines.map(line => line.replaceAll(/\u001B\[[0-9;]*m/g, ""));

    test("filter_items — a substring, ignoring case, in list order", () => {
        expect(filter_items(files, "RPI-4")).toEqual(["broadcom/bcm2711-rpi-4-b.dts", "broadcom/bcm2711-rpi-400.dts"]);
        expect(filter_items(files, "")).toEqual(files);
        expect(filter_items(files, "zzz")).toEqual([]);
    });

    test("highlight_match — the first occurrence is bold, whatever its case", () => {
        expect(highlight_match("bcm2711-rpi-4-b.dts", "RPI")).toBe(`bcm2711-${BOLD}rpi${RESET}-4-b.dts`);
        expect(highlight_match("bcm2711", "")).toBe("bcm2711");
        expect(highlight_match("bcm2711", "x")).toBe("bcm2711");
    });

    test("window_start — the window scrolls once the highlight passes its last row", () => {
        expect(window_start(0)).toBe(0);
        expect(window_start(19)).toBe(0);
        expect(window_start(20)).toBe(1);
        expect(window_start(34, 10)).toBe(25);
    });

    test("apply_key — typing narrows the list and resets the highlight", () => {
        const result = press(INITIAL_STATE, [...typed("rpi"), { name: "down", sequence: "\u001B[B" }, ...typed("-")]);
        expect(result.state).toEqual({ query: "rpi-", highlight: 0, moved: false });
        expect(result.action).toEqual({ kind: "none" });
    });

    test("apply_key — Enter takes the highlighted match, the arrows move it", () => {
        const down = { name: "down", sequence: "\u001B[B" };
        const up = { name: "up", sequence: "\u001B[A" };
        const enter = { name: "return", sequence: "\r" };
        expect(press(INITIAL_STATE, [...typed("rpi"), enter]).action).toEqual({ kind: "select", item: "broadcom/bcm2711-rpi-4-b.dts" });
        expect(press(INITIAL_STATE, [...typed("rpi"), down, enter]).action).toEqual({ kind: "select", item: "broadcom/bcm2711-rpi-400.dts" });
        expect(press(INITIAL_STATE, [...typed("rpi"), down, down, down, up, enter]).action).toEqual({ kind: "select", item: "broadcom/bcm2711-rpi-400.dts" });
        // The highlight stops at the ends of the list.
        expect(press(INITIAL_STATE, [...typed("imx"), down, down, enter]).action).toEqual({ kind: "select", item: "freescale/imx8mp.dts" });
        expect(press(INITIAL_STATE, [...typed("rpi"), up, up, enter]).action).toEqual({ kind: "select", item: "broadcom/bcm2711-rpi-4-b.dts" });
    });

    test("apply_key — Enter alone takes the only match left", () => {
        expect(press(INITIAL_STATE, [...typed("imx"), { name: "return", sequence: "\r" }]).action).toEqual({ kind: "select", item: "freescale/imx8mp.dts" });
    });

    test("apply_key — Enter takes nothing without a query or a moved highlight, nor when nothing matches", () => {
        const enter = { name: "return", sequence: "\r" };
        expect(press(INITIAL_STATE, [enter]).action).toEqual({ kind: "none" });
        expect(press(INITIAL_STATE, [{ name: "down", sequence: "\u001B[B" }, enter]).action).toEqual({ kind: "select", item: "broadcom/bcm2711-rpi-400.dts" });
        expect(press(INITIAL_STATE, [...typed("zzz"), enter]).action).toEqual({ kind: "none" });
    });

    test("apply_key — Backspace and Ctrl-U edit the query", () => {
        expect(press(INITIAL_STATE, [...typed("rpi"), { name: "backspace", sequence: "\u007F" }]).state.query).toBe("rp");
        expect(press(INITIAL_STATE, [...typed("rpi"), { name: "u", ctrl: true, sequence: "\u0015" }]).state).toEqual(INITIAL_STATE);
        expect(press(INITIAL_STATE, [{ name: "backspace", sequence: "\u007F" }]).state.query).toBe("");
    });

    test("apply_key — Esc goes back, Ctrl-C and Ctrl-D cancel, other keys do nothing", () => {
        expect(press(INITIAL_STATE, [...typed("rpi"), { name: "escape", sequence: "\u001B" }]).action).toEqual({ kind: "back" });
        expect(press(INITIAL_STATE, [{ name: "c", ctrl: true, sequence: "\u0003" }]).action).toEqual({ kind: "cancel" });
        expect(press(INITIAL_STATE, [{ name: "d", ctrl: true, sequence: "\u0004" }]).action).toEqual({ kind: "cancel" });
        const other = press(INITIAL_STATE, [{ name: "tab", sequence: "\t" }, { name: "left", sequence: "\u001B[D" }, { name: "x", meta: true, sequence: "\u001Bx" }]);
        expect(other.state).toEqual(INITIAL_STATE);
        expect(other.action).toEqual({ kind: "none" });
    });

    test("render_frame — the count, the rows with the marker on the highlight, the prompt last", () => {
        const state = press(INITIAL_STATE, [...typed("rpi"), { name: "down", sequence: "\u001B[B" }]).state;
        expect(plain(render_frame(state, files, 80))).toEqual([
            "3 matches",
            "  broadcom/bcm2711-rpi-4-b.dts",
            "> broadcom/bcm2711-rpi-400.dts",
            "  broadcom/bcm2837-rpi-3-b.dts",
            "Filter: rpi",
        ]);
        expect(render_frame(state, files, 80)[1]).toContain(`${BOLD}rpi${RESET}`);
    });

    test("render_frame — nothing matches, one match, and a long list that scrolls", () => {
        expect(plain(render_frame({ ...INITIAL_STATE, query: "zzz" }, files, 80))).toEqual([`No file matches "zzz"`, "Filter: zzz"]);
        expect(plain(render_frame({ ...INITIAL_STATE, query: "imx" }, files, 80))[0]).toBe("1 match");
        const many = Array.from({ length: 45 }, (_, index) => `board-${index}.dts`);
        const first = plain(render_frame(INITIAL_STATE, many, 80));
        expect(first[0]).toBe("1-20 of 45 matches");
        expect(first).toHaveLength(22);
        const scrolled = plain(render_frame({ query: "", highlight: 30, moved: true }, many, 80));
        expect(scrolled[0]).toBe("12-31 of 45 matches");
        expect(scrolled.at(-2)).toBe("> board-30.dts");
    });

    test("render_frame — a row wider than the terminal is cut", () => {
        const rows = plain(render_frame(INITIAL_STATE, ["x".repeat(100)], 40));
        expect(rows[1]).toBe(`> ${"x".repeat(35)}…`);
    });
}
