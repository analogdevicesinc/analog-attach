// `__complete`: given the shell words typed so far (the last is the word under the cursor,
// possibly empty), the lines the stubs of stubs.ts render. Ported from attach-cli's
// completion/complete.ts, over the route table instead of commander (decision 4).
//
// The front end completes command and flag names, and `config`'s keys and values itself.
// For a positional it builds the `Slot` and asks `backend.complete`, and for a flag's value
// a `flag` slot. A line is `value` or `value<TAB>description`; the directives are those of
// stubs.ts. Nothing goes to stderr: the session is in `complete` mode, and a failing source
// gives no candidates (COMPL-005).

import type { Candidate, Completion, Session } from "../interface/backend-interface";
import { find_route, next_segments, type FrontEnd, type Route } from "./routes";
import { DIRS_DIRECTIVE, FILES_DIRECTIVE, GROUP_DIRECTIVE, NOSPACE_DIRECTIVE } from "./stubs";

const GLOBAL_FLAGS: readonly Candidate[] = [
    { value: "--json", description: "Output as JSON" },
    { value: "--help", description: "Print help information and exit" },
    { value: "--version", description: "Print version information and exit" },
];

/** Dequote a word as a POSIX shell would (COMPL-002). */
export function shell_dequote(word: string): string {
    let result = "";
    let index = 0;
    while (index < word.length) {
        const ch = word[index]!;
        if (ch === "'") {
            const close = word.indexOf("'", index + 1);
            if (close === -1) {
                result += word.slice(index + 1);
                break;
            }
            result += word.slice(index + 1, close);
            index = close + 1;
            continue;
        }
        if (ch === "\"") {
            index++;
            while (index < word.length) {
                const c = word[index]!;
                if (c === "\"") { index++; break; }
                if (c === "\\" && index + 1 < word.length && "\"\\$`".includes(word[index + 1]!)) {
                    result += word[index + 1]!;
                    index += 2;
                    continue;
                }
                result += c;
                index++;
            }
            continue;
        }
        if (ch === "\\" && index + 1 < word.length) {
            result += word[index + 1]!;
            index += 2;
            continue;
        }
        result += ch;
        index++;
    }
    return result;
}

/** A flag word (`--parent`, `-h`), as opposed to a value such as `-1`. */
function is_flag_word(word: string): boolean {
    return word.startsWith("-") && word.length > 1 && !/^-\d/.test(word);
}

/** The lines for `completion`, filtered by `prefix` (COMPL-010 to COMPL-014, plus the fallback after the candidates). */
export function completion_lines(completion: Completion, prefix: string): string[] {
    const candidates = completion.candidates.filter(candidate => candidate.value.startsWith(prefix));
    const lines: string[] = [];
    if (completion.fallback !== undefined) {
        lines.push(completion.fallback === "dirs" ? DIRS_DIRECTIVE : FILES_DIRECTIVE);
    } else if (candidates.length > 0 && candidates.every(candidate => candidate.partial === true)) {
        // The shell decides for all candidates at once: no space only when none is a whole word.
        lines.push(NOSPACE_DIRECTIVE);
    }
    const line = (candidate: Candidate): string => candidate.description === undefined || candidate.description === ""
        ? candidate.value
        : `${candidate.value}\t${candidate.description}`;
    // Grouped candidates come after the others, each group under a heading line, in the order the groups first appear.
    const groups = [...new Set(candidates.flatMap(candidate => candidate.group === undefined ? [] : [candidate.group]))];
    for (const candidate of candidates) { if (candidate.group === undefined) { lines.push(line(candidate)); } }
    for (const group of groups) {
        lines.push(`${GROUP_DIRECTIVE}\t${group}`);
        for (const candidate of candidates) { if (candidate.group === group) { lines.push(line(candidate)); } }
    }
    return lines;
}

function flag_candidates(route: Route, committed: readonly string[]): Completion {
    const used = new Set(committed.filter(word => word.startsWith("--")).map(word => word.split("=")[0]!));
    const candidates: Candidate[] = Object.entries(route.flags)
        .filter(([name, spec]) => spec.hidden !== true && (spec.kind === "values" || !used.has(`--${name}`)))
        .map(([name, spec]) => ({ value: `--${name}`, description: spec.brief }));
    // --json is taken out of the words before parsing, so no route declares it, but it goes anywhere
    // (complete_words drops it once it was typed).
    candidates.push(GLOBAL_FLAGS[0]!, { value: "--help", description: "Print help information and exit" });
    return { candidates };
}

async function from_backend(front: FrontEnd, slot: Parameters<NonNullable<FrontEnd["backend"]>["complete"]>[0], prefix: string, session: Session): Promise<Completion> {
    if (front.backend === undefined) { return { candidates: [] }; }
    return front.backend.complete(slot, prefix, session);
}

async function complete_route(front: FrontEnd, route: Route, rest: readonly string[], prefix: string, session: Session): Promise<Completion> {
    // Walk the words after the route: flags (and the values of the ones that take one), and positionals.
    const positionals: string[] = [];
    let pending: string | undefined;
    let escaped = false;
    for (const word of rest) {
        if (pending !== undefined) { pending = undefined; continue; }
        if (!escaped && word === "--") { escaped = true; continue; }
        if (!escaped && is_flag_word(word)) {
            const name = word.replace(/^--?/, "");
            const spec = route.flags[name];
            if (spec !== undefined && spec.kind !== "boolean" && !name.includes("=")) { pending = name; }
            continue;
        }
        positionals.push(word);
    }

    // The value of a flag.
    if (pending !== undefined) {
        if (!route.supported) { return { candidates: [] }; }
        return from_backend(front, { kind: "flag", command: route.path.join(" "), flag: pending, prior: positionals }, prefix, session);
    }

    // A flag name.
    if (!escaped && prefix.startsWith("-") && !/^-\d/.test(prefix)) { return flag_candidates(route, rest); }

    // A positional; once there is no source, the flags (COMPL-033).
    const index = positionals.length;
    const last = route.positionals.at(-1);
    const spec = route.positionals[index] ?? (last?.variadic === true ? last : undefined);
    if (route.complete !== undefined) {
        return await route.complete(index, positionals, prefix, session) ?? flag_candidates(route, rest);
    }
    if (spec?.slot === undefined) { return flag_candidates(route, rest); }
    if (!route.supported) { return { candidates: [] }; }
    return from_backend(front, spec.slot(positionals), prefix, session);
}

function names(candidates: readonly { name: string; brief: string }[]): Completion {
    return { candidates: candidates.map(({ name, brief }) => ({ value: name, description: brief })) };
}

/** The lines `__complete <words>` prints. Never throws. */
export async function complete_words(front: FrontEnd, routes: readonly Route[], words: readonly string[], session: Session): Promise<string[]> {
    const dequoted = words.map(word => shell_dequote(word));
    const prefix = dequoted.at(-1) ?? "";
    let committed = dequoted.slice(0, -1);
    // --json counts wherever it was typed, before the command too: it isn't offered twice.
    const json_given = committed.includes("--json");
    const without_json = (completion: Completion): Completion =>
        json_given ? { ...completion, candidates: completion.candidates.filter(candidate => candidate.value !== "--json") } : completion;

    // Global flags before the command are skipped (COMPL-020).
    const start = committed.findIndex(word => !word.startsWith("-"));
    if (start === -1) {
        if (prefix.startsWith("-")) { return completion_lines(without_json({ candidates: [...GLOBAL_FLAGS] }), prefix); }
        return completion_lines({ candidates: [...next_segments(routes, []).map(({ name, brief }) => ({ value: name, description: brief })), { value: "help", description: "Print help for a command" }] }, prefix);
    }
    committed = committed.slice(start);

    try {
        // The route is read from the words that aren't flags (`list --json devices`).
        const route_words = committed.filter(word => !is_flag_word(word));
        // `help <command>`: the command names again, word by word.
        if (route_words[0] === "help") {
            return prefix.startsWith("-") ? [] : completion_lines(names(next_segments(routes, route_words.slice(1))), prefix);
        }
        const found = find_route(routes, route_words);
        if (found === undefined) {
            // A route map's next word (`list <Tab>`), or a command that doesn't exist (nothing, COMPL-023).
            return prefix.startsWith("-") ? [] : completion_lines(names(next_segments(routes, route_words)), prefix);
        }
        // The words after the route's last segment.
        let seen = 0;
        const after = committed.findIndex(word => !is_flag_word(word) && ++seen === found.used);
        return completion_lines(without_json(await complete_route(front, found.route, committed.slice(after + 1), prefix, session)), prefix);
    } catch {
        return [];
    }
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    test("shell_dequote - quotes and backslashes as a POSIX shell reads them", () => {
        expect(shell_dequote("'sp")).toBe("sp");
        expect(shell_dequote(String.raw`"a\"b"`)).toBe("a\"b");
        expect(shell_dequote(String.raw`a\ b`)).toBe("a b");
        expect(shell_dequote("'a'b\"c\"")).toBe("abc");
    });

    test("completion_lines - filter, nospace, groups after the rest, the fallback first", () => {
        expect(completion_lines({ candidates: [{ value: "spi0/", partial: true }, { value: "spi1/", partial: true }, { value: "x" }] }, "s"))
            .toEqual([NOSPACE_DIRECTIVE, "spi0/", "spi1/"]);
        expect(completion_lines({ candidates: [{ value: "reg", description: "set", group: "set" }, { value: "status", description: "s" }, { value: "spi-max", group: "not set" }] }, ""))
            .toEqual(["status\ts", `${GROUP_DIRECTIVE}\tset`, "reg\tset", `${GROUP_DIRECTIVE}\tnot set`, "spi-max"]);
        expect(completion_lines({ candidates: [], fallback: "files" }, "x")).toEqual([FILES_DIRECTIVE]);
        expect(completion_lines({ candidates: [{ value: "rpi-x.dtbo", partial: true }], fallback: "dirs" }, "")).toEqual([DIRS_DIRECTIVE, "rpi-x.dtbo"]);
    });
}
