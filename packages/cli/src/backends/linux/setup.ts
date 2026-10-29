// The questions of the setup run (the bare `analog-attach` on a terminal), asked
// through the session's prompter. Each step takes the current value of the setting,
// when there is one, as its Enter default. What a step says between its questions
// goes to `session.say`, styled with `session.style`.

import * as fs from "node:fs";
import path from "node:path";
import * as os from "node:os";

import type { Choice, InteractiveSession, Style } from "../../interface/backend-interface";
import { linux_tree_problem } from "./config/workspace";
import { next_workfile_name, workfile_filename, workfile_problem, type OverlayChoice } from "./workfile";

/** Where the setup run resolves what is typed (the session's directory) and looks for Linux trees (the home directory). */
export interface SetupPlace {
    cwd: string;
    home: string;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/** `~` and `~/…` are the home directory. */
export function expand_home(answer: string, home = os.homedir()): string {
    return answer === "~" || answer.startsWith("~/") ? path.join(home, answer.slice(1)) : answer;
}

/**
 * What Tab completes a typed path to: the entries of the directory typed so far
 * that start with the rest, as typed (`~/li` → `~/linux/`), directories with a
 * trailing slash.
 */
export function path_completions(partial: string, { cwd, home }: SetupPlace): string[] {
    const typed = partial.trimStart();
    if (typed === "") { return []; }
    const slash = typed.lastIndexOf("/");
    const prefix = slash === -1 ? "" : typed.slice(0, slash + 1);
    const stem = typed.slice(slash + 1);
    const directory = path.resolve(cwd, expand_home(prefix === "" ? "." : prefix, home));
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
        return [];
    }
    return entries
        .filter(entry => entry.name.startsWith(stem))
        .map(entry => {
            let is_directory = entry.isDirectory();
            if (entry.isSymbolicLink()) {
                try { is_directory = fs.statSync(path.join(directory, entry.name)).isDirectory(); } catch { /* a dangling link */ }
            }
            return `${prefix}${entry.name}${is_directory ? "/" : ""}`;
        })
        .toSorted();
}

export type PathCheck = { ok: true; path: string } | { ok: false; problem: string };

/** The resolved path of a Linux tree, or what is wrong with the answer. */
export function check_linux(answer: string, { cwd, home }: SetupPlace): PathCheck {
    const resolved = path.resolve(cwd, expand_home(answer, home));
    if (!fs.existsSync(resolved)) { return { ok: false, problem: `Path does not exist: ${resolved}` }; }
    const problem = linux_tree_problem(resolved);
    return problem === undefined ? { ok: true, path: resolved } : { ok: false, problem };
}

/** The resolved path of a base `.dts` file, or what is wrong with the answer. */
export function check_dts(answer: string, { cwd, home }: SetupPlace): PathCheck {
    const resolved = path.resolve(cwd, expand_home(answer, home));
    if (!fs.existsSync(resolved)) { return { ok: false, problem: `Path does not exist: ${resolved}` }; }
    if (!resolved.endsWith(".dts")) { return { ok: false, problem: "File must have a .dts extension." }; }
    return { ok: true, path: resolved };
}

/** A path question: Tab completes, an empty or refused answer is asked again, `check` gives the path. */
async function ask_path(session: InteractiveSession, place: SetupPlace, message: string, check: (answer: string) => PathCheck): Promise<string> {
    const answer = await session.prompter.input({
        message,
        validate: typed => {
            if (typed.trim() === "") { return "Type a path"; }
            const checked = check(typed.trim());
            return checked.ok ? true : checked.problem;
        },
        complete: partial => Promise.resolve(path_completions(partial, place)),
    });
    const checked = check(answer.trim());
    // A scripted prompter doesn't validate.
    if (!checked.ok) { throw new Error(`${message}: ${checked.problem}`); }
    return checked.path;
}

// ---------------------------------------------------------------------------
// Step 1: the Linux kernel source tree
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set([
    "node_modules", ".git", ".cache", ".local", ".npm", ".yarn",
    ".nvm", ".cargo", ".rustup", ".gradle", ".m2", ".config",
    "__pycache__", "venv", ".venv", "build", "dist",
]);

/** The Linux trees under `root` (any directory with `Documentation/devicetree/bindings/` and `include/`, whatever its name), breadth first. */
export function find_linux_trees(root = os.homedir()): string[] {
    const results: string[] = [];
    const queue: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }];
    const MAX_DEPTH = 4;
    const MAX_RESULTS = 10;
    const start = Date.now();
    const TIMEOUT_MS = 5000;

    while (queue.length > 0) {
        if (Date.now() - start > TIMEOUT_MS) { break; }
        if (results.length >= MAX_RESULTS) { break; }

        const item = queue.shift()!;
        if (item.depth > MAX_DEPTH) { continue; }

        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(item.dir, { withFileTypes: true }).toSorted((a, b) => a.name.localeCompare(b.name));
        } catch { continue; }

        for (const entry of entries) {
            if (!entry.isDirectory()) { continue; }
            if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) { continue; }

            const full = path.join(item.dir, entry.name);

            if (linux_tree_problem(full) === undefined) {
                results.push(full);
                continue;
            }

            if (item.depth < MAX_DEPTH) {
                queue.push({ dir: full, depth: item.depth + 1 });
            }
        }
    }

    return results;
}

/** The choice that asks for a path instead of a listed one. */
const TYPE_PATH = Symbol("type a path");

export async function step_linux(session: InteractiveSession, place: SetupPlace, current?: string): Promise<string> {
    const { bold, dim } = session.style;
    const say = (line: string): void => { session.say(line); };
    say(bold("Step 1: Linux kernel source tree"));
    say("");
    say(`${session.program} needs the path to a Linux kernel source tree`);
    say(dim("(must contain Documentation/devicetree/bindings/ and include/)"));
    say("");

    say("Searching for Linux source trees under ~...");
    const found = find_linux_trees(place.home);
    say("");

    // The configured tree comes first: Enter keeps it.
    const trees = current === undefined ? found : [current, ...found.filter(tree => tree !== current)];
    let selected: string;
    if (trees.length === 0) {
        say("No Linux source trees found under ~.");
        say("");
        say(dim("Tab-complete available. Path must contain Documentation/devicetree/bindings/ and include/."));
        selected = await ask_path(session, place, "Linux source path", answer => check_linux(answer, place));
    } else {
        const choices: Choice<string | typeof TYPE_PATH>[] = [
            ...trees.map(tree => ({ name: `${tree}${tree === current ? dim(" (current)") : ""}`, value: tree })),
            { name: "Type a path", value: TYPE_PATH },
        ];
        const picked = await session.prompter.select({ message: "Linux source tree", choices, default: trees[0] });
        selected = picked === TYPE_PATH
            ? await ask_path(session, place, "Linux source path", answer => check_linux(answer, place))
            : picked;
    }
    say(`Selected: ${selected}`);
    return selected;
}

// ---------------------------------------------------------------------------
// Step 2: the base devicetree (the context)
// ---------------------------------------------------------------------------

export function find_architectures(linux_path: string): string[] {
    const arch_directory = path.join(linux_path, "arch");
    try {
        return fs.readdirSync(arch_directory, { withFileTypes: true })
            .filter(entry => entry.isDirectory())
            .filter(entry => fs.existsSync(path.join(arch_directory, entry.name, "boot", "dts")))
            .map(entry => entry.name)
            .toSorted();
    } catch { return []; }
}

export function find_dts_files(linux_path: string, arch: string): string[] {
    const dts_root = path.join(linux_path, "arch", arch, "boot", "dts");
    const results: string[] = [];

    function walk(directory: string): void {
        let entries: fs.Dirent[];
        try { entries = fs.readdirSync(directory, { withFileTypes: true }); }
        catch { return; }

        for (const entry of entries) {
            const full = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                walk(full);
            } else if (entry.name.endsWith(".dts")) {
                results.push(path.relative(dts_root, full));
            }
        }
    }

    walk(dts_root);
    return results.toSorted();
}

/** The items that contain `query`, ignoring case, in their order. */
export function filter_items(items: readonly string[], query: string): string[] {
    const lower = query.toLowerCase();
    return items.filter(item => item.toLowerCase().includes(lower));
}

/** The choice that goes back to the architectures. */
export const BACK = Symbol("back");

/**
 * The choices of the `.dts` search for what is typed: the matching files and "← back".
 * With nothing typed "← back" comes first, so a stray Enter goes back rather than
 * taking a file; once something is typed it comes last.
 */
export function dts_choices(files: readonly string[], term: string, style: Pick<Style, "dim">): Choice<string | typeof BACK>[] {
    const back: Choice<typeof BACK> = { name: style.dim("← back to the architectures"), value: BACK };
    const matches = filter_items(files, term).map(file => ({ name: file, value: file }));
    return term === "" ? [back, ...matches] : [...matches, back];
}

async function search_dts(session: InteractiveSession, place: SetupPlace, linux_path: string): Promise<string> {
    const say = (line: string): void => { session.say(line); };
    for (;;) {
        const archs = find_architectures(linux_path);
        if (archs.length === 0) {
            say("No architectures with device tree files found.");
            say("Falling back to manual path entry.");
            return manual_dts(session, place);
        }

        const arch = await session.prompter.select({ message: "Architecture", choices: archs.map(name => ({ name, value: name })) });

        say(`Scanning ${arch}/boot/dts/...`);
        const files = find_dts_files(linux_path, arch);
        if (files.length === 0) {
            say("No .dts files found.");
            return manual_dts(session, place);
        }
        say(`Found ${files.length} .dts files.`);
        say("");

        const picked = await session.prompter.search({
            message: "Filter",
            source: term => Promise.resolve(dts_choices(files, term, session.style)),
        });
        if (picked === BACK) { continue; }
        const selected = path.join(linux_path, "arch", arch, "boot", "dts", picked);
        say(`Selected: ${selected}`);
        return selected;
    }
}

async function manual_dts(session: InteractiveSession, place: SetupPlace): Promise<string> {
    session.say(session.style.dim("Tab-complete available."));
    const selected = await ask_path(session, place, "Path to .dts file", answer => check_dts(answer, place));
    session.say(`Selected: ${selected}`);
    return selected;
}

type ContextChoice = "keep" | "search" | "manual" | "remote";

export async function step_context(session: InteractiveSession, place: SetupPlace, linux_path: string, current?: string): Promise<string> {
    const { bold, dim } = session.style;
    session.say(bold("Step 2: Base device tree (context)"));
    session.say("");
    // With a configured base tree, the first choice keeps it and Enter takes it.
    const choices: Choice<ContextChoice>[] = [
        ...(current === undefined ? [] : [{ name: `Keep ${current}`, value: "keep" as const }]),
        { name: "Search in the Linux tree", value: "search" },
        { name: "Enter path manually", value: "manual" },
        { name: `Export from remote device ${dim("(coming soon)")}`, value: "remote", disabled: "Not yet available" },
    ];
    const picked = await session.prompter.select({ message: "Choose how to select the base .dts file", choices });
    switch (picked) {
        case "keep": { return current ?? manual_dts(session, place); }
        case "search": { return search_dts(session, place, linux_path); }
        // `remote` is disabled; a scripted prompter that picks it gets the manual path.
        case "manual":
        case "remote": { return manual_dts(session, place); }
    }
}

// ---------------------------------------------------------------------------
// Step 3: the overlay workfile
// ---------------------------------------------------------------------------

/** Ask for the name of a new workfile; Enter takes the next free `overlay[-N].dtso`, and an existing file is refused. */
async function ask_workfile_name(session: InteractiveSession, place: SetupPlace): Promise<string> {
    const default_name = next_workfile_name("overlay", place.cwd);
    const named = (typed: string): string => workfile_filename(typed.trim() === "" ? default_name : typed.trim());
    const answer = await session.prompter.input({
        message: "Overlay file name",
        default: default_name,
        validate: typed => workfile_problem(named(typed), place.cwd) ?? true,
    });
    const filename = named(answer);
    // A scripted prompter doesn't validate.
    const problem = workfile_problem(filename, place.cwd);
    if (problem !== undefined) { throw new Error(`Overlay file name: ${problem}`); }
    return filename;
}

/** An answer to "keep or new": Enter, `k` or `keep` keeps; `n` or `new` names a new one. */
export function keep_or_new(answer: string): "keep" | "new" | undefined {
    const lower = answer.trim().toLowerCase();
    if (lower === "" || lower === "k" || lower === "keep") { return "keep"; }
    if (lower === "n" || lower === "new") { return "new"; }
    return undefined;
}

/**
 * The overlay workfile: keep the configured one (Enter) or name a new one,
 * which `init` creates. `configured` is the configured workfile, whether its
 * file exists or not.
 */
export async function step_overlay(session: InteractiveSession, place: SetupPlace, configured?: string): Promise<OverlayChoice> {
    session.say(session.style.bold("Step 3: Overlay workfile"));
    session.say("");
    session.say("The workfile is the overlay file your changes are written to.");
    session.say("");

    if (configured !== undefined) {
        const answer = await session.prompter.input({
            message: `Overlay: [k]eep ${configured} / [n]ew`,
            default: "k",
            validate: typed => keep_or_new(typed) === undefined ? "Please enter k to keep it or n for a new one." : true,
        });
        if (keep_or_new(answer) !== "new") { return { kind: "keep", path: configured }; }
    }
    return { kind: "create", filename: await ask_workfile_name(session, place) };
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;
    const { create_style } = await import("../../front/session");

    const temporary = (): { root: string; done: () => void } => {
        const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "attach-setup-")));
        return { root, done: () => { fs.rmSync(root, { recursive: true }); } };
    };

    test("find_linux_trees — any directory with the bindings and include/, not only one named linux", () => {
        const { root, done } = temporary();
        try {
            for (const tree of ["linux_adi", path.join("src", "kernel")]) {
                fs.mkdirSync(path.join(root, tree, "Documentation", "devicetree", "bindings"), { recursive: true });
                fs.mkdirSync(path.join(root, tree, "include"));
            }
            fs.mkdirSync(path.join(root, "linux-docs", "Documentation", "devicetree", "bindings"), { recursive: true });
            expect(find_linux_trees(root)).toEqual([path.join(root, "linux_adi"), path.join(root, "src", "kernel")]);
        } finally {
            done();
        }
    });

    test("check_linux — a Linux tree is accepted, a missing path or another directory is not; ~ and relative paths resolve", () => {
        const { root, done } = temporary();
        try {
            fs.mkdirSync(path.join(root, "linux", "Documentation", "devicetree", "bindings"), { recursive: true });
            fs.mkdirSync(path.join(root, "linux", "include"));
            const place = { cwd: root, home: root };
            expect(check_linux(path.join(root, "linux"), place)).toEqual({ ok: true, path: path.join(root, "linux") });
            expect(check_linux("~/linux", place)).toEqual({ ok: true, path: path.join(root, "linux") });
            expect(check_linux("./linux/", place)).toEqual({ ok: true, path: path.join(root, "linux") });
            const missing = check_linux("nope", place);
            expect(!missing.ok && missing.problem).toBe(`Path does not exist: ${path.join(root, "nope")}`);
            const other = check_linux("linux/include", place);
            expect(!other.ok && other.problem).toContain("not a Linux source tree");
        } finally {
            done();
        }
    });

    test("check_dts — an existing .dts is accepted, a missing path or another extension is not", () => {
        const { root, done } = temporary();
        try {
            fs.writeFileSync(path.join(root, "base.dts"), "");
            fs.writeFileSync(path.join(root, "base.dtsi"), "");
            const place = { cwd: root, home: root };
            expect(check_dts("base.dts", place)).toEqual({ ok: true, path: path.join(root, "base.dts") });
            expect(check_dts("base.dtsi", place)).toEqual({ ok: false, problem: "File must have a .dts extension." });
            expect(check_dts("nope.dts", place)).toEqual({ ok: false, problem: `Path does not exist: ${path.join(root, "nope.dts")}` });
        } finally {
            done();
        }
    });

    test("path_completions — entries of the typed directory as typed, directories with a slash", () => {
        const { root, done } = temporary();
        try {
            fs.mkdirSync(path.join(root, "linux"));
            fs.mkdirSync(path.join(root, "lib"));
            fs.writeFileSync(path.join(root, "linux", "base.dts"), "");
            const place = { cwd: root, home: root };
            expect(path_completions("li", place)).toEqual(["lib/", "linux/"]);
            expect(path_completions("linux/b", place)).toEqual(["linux/base.dts"]);
            expect(path_completions("~/lin", place)).toEqual(["~/linux/"]);
            expect(path_completions(`${root}/lin`, place)).toEqual([`${root}/linux/`]);
            expect(path_completions("", place)).toEqual([]);
            expect(path_completions("nope/x", place)).toEqual([]);
        } finally {
            done();
        }
    });

    test("dts_choices — the matches, back first with nothing typed and last once something is", () => {
        const style = create_style(false);
        const files = ["broadcom/bcm2711-rpi-4-b.dts", "broadcom/bcm2837-rpi-3-b.dts", "xilinx/zynq.dts"];
        expect(dts_choices(files, "", style).map(choice => choice.value)).toEqual([BACK, ...files]);
        expect(dts_choices(files, "RPI", style).map(choice => choice.value)).toEqual([files[0], files[1], BACK]);
        expect(dts_choices(files, "nothing", style).map(choice => choice.value)).toEqual([BACK]);
    });

    test("keep_or_new — Enter and k keep, n names a new one, anything else is asked again", () => {
        expect(["", "k", "Keep", " K "].map(answer => keep_or_new(answer))).toEqual(["keep", "keep", "keep", "keep"]);
        expect(["n", "NEW"].map(answer => keep_or_new(answer))).toEqual(["new", "new"]);
        expect(keep_or_new("x")).toBeUndefined();
    });
}
