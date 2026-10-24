import * as readline from "node:readline";
import * as fs from "node:fs";
import path from "node:path";
import * as os from "node:os";

import { code_index, pick_code } from "./commands/add/interview";
import { linux_tree_problem } from "./config/workspace";
import { live_filter } from "./live-filter";
import { next_workfile_name, workfile_filename, workfile_problem, type OverlayChoice } from "./workfile";

const BOLD = "\u001B[1m";
const DIM = "\u001B[2m";
const RESET = "\u001B[0m";
const CYAN = "\u001B[36m";

// Colours only on a terminal: `init` with flags is often piped.
const paint = (code: string, text: string): string => process.stdout.isTTY ? `${code}${text}${RESET}` : text;
export function bold(text: string): string { return paint(BOLD, text); }
export function dim(text: string): string { return paint(DIM, text); }
export function cyan(text: string): string { return paint(CYAN, text); }

// The prompts of `init` on a terminal. Each step takes the current value of the
// setting, when there is one, as its Enter default.

// ---------------------------------------------------------------------------
// Readline helpers
// ---------------------------------------------------------------------------

function path_completer(line: string): [string[], string] {
    const trimmed = line.trimStart();
    if (trimmed === "") { return [[], line]; }

    const resolved = path.resolve(trimmed);
    const directory = trimmed.endsWith("/") ? resolved : path.dirname(resolved);
    const prefix = trimmed.endsWith("/") ? "" : path.basename(resolved);

    try {
        const entries = fs.readdirSync(directory);
        const matches = entries
            .filter(entry => entry.startsWith(prefix))
            .map(match => {
                const full = path.join(directory, match);
                try {
                    return fs.statSync(full).isDirectory() ? `${full}/` : full;
                } catch { return full; }
            });
        return [matches, trimmed];
    } catch {
        return [[], line];
    }
}

export function create_rl(): readline.Interface {
    return readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        completer: path_completer,
    });
}

/** The letter that picks the option at `index` in a list: `a)`. */
const code_label = (index: number): string => cyan(`${pick_code(index)})`);

/** The index of the option a pick code names, when the list has it. */
function picked_index(answer: string, count: number): number | undefined {
    const index = code_index(answer);
    return index !== undefined && index < count ? index : undefined;
}

/** "a", "a to c": the codes of a list of `count` options. */
const code_range = (count: number): string => count === 1 ? pick_code(0) : `${pick_code(0)} to ${pick_code(count - 1)}`;

/** An answer that is a path rather than a pick: it has a slash or starts with ~ or a dot. */
const looks_like_path = (answer: string): boolean => answer.includes("/") || answer.startsWith("~") || answer.startsWith(".");

export function expand_home(answer: string): string {
    return answer === "~" || answer.startsWith("~/") ? path.join(os.homedir(), answer.slice(1)) : answer;
}

function question(rl: readline.Interface, prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
        rl.question(prompt, (answer) => { resolve(answer.trim()); });
        rl.once("close", () => { reject(new Error("interrupted")); });
    });
}

// ---------------------------------------------------------------------------
// Step 1: Find the Linux kernel source tree
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set([
    "node_modules", ".git", ".cache", ".local", ".npm", ".yarn",
    ".nvm", ".cargo", ".rustup", ".gradle", ".m2", ".config",
    "__pycache__", "venv", ".venv", "build", "dist",
]);

/** The Linux trees under `root` (any directory with `Documentation/devicetree/bindings/` and `include/`, whatever its name), breadth first. */
function find_linux_trees(root = os.homedir()): string[] {
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
            entries = fs.readdirSync(item.dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
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

export async function step_linux(rl: readline.Interface, current?: string): Promise<string> {
    console.log(bold("Step 1: Linux kernel source tree"));
    console.log("");
    console.log("attach-linux needs the path to a Linux kernel source tree");
    console.log(dim("(must contain Documentation/devicetree/bindings/ and include/)"));
    console.log("");

    console.log("Searching for Linux source trees under ~...");
    const found = find_linux_trees();
    console.log("");

    // The configured tree comes first: Enter keeps it.
    const trees = current === undefined ? found : [current, ...found.filter(tree => tree !== current)];

    if (trees.length > 0) {
        console.log("Linux source trees:");
        for (const [index, tree] of trees.entries()) {
            console.log(`  ${code_label(index)} ${tree}${tree === current ? dim(" (current)") : ""}`);
        }
        console.log("");
        console.log(dim("Pick one by its letter, or type a path."));
        console.log("");

        while (true) {
            const answer = await question(rl, `Choose [${pick_code(0)}]: `);
            const choice = answer === "" ? pick_code(0) : answer;

            if (looks_like_path(choice)) {
                const checked = check_linux(choice);
                if (checked.ok) { console.log(`Selected: ${checked.path}`); return checked.path; }
                console.log(checked.problem);
                continue;
            }

            const index = picked_index(choice, trees.length);
            if (index === undefined) {
                console.log(`Please enter ${code_range(trees.length)}, or a path.`);
                continue;
            }

            const selected = trees[index]!;
            console.log(`Selected: ${selected}`);
            return selected;
        }
    } else {
        console.log("No Linux source trees found under ~.");
        return await ask_linux_path(rl);
    }
}

export type PathCheck = { ok: true; path: string } | { ok: false; problem: string };

/** The resolved path of a Linux tree, or what is wrong with the answer. */
export function check_linux(answer: string): PathCheck {
    const resolved = path.resolve(expand_home(answer));
    if (!fs.existsSync(resolved)) { return { ok: false, problem: `Path does not exist: ${resolved}` }; }
    const problem = linux_tree_problem(resolved);
    return problem === undefined ? { ok: true, path: resolved } : { ok: false, problem };
}

/** The resolved path of a base device tree file, or what is wrong with the answer. */
export function check_devicetree(answer: string): PathCheck {
    const resolved = path.resolve(expand_home(answer));
    if (!fs.existsSync(resolved)) { return { ok: false, problem: `Path does not exist: ${resolved}` }; }
    if (!fs.statSync(resolved).isFile()) { return { ok: false, problem: `Not a file: ${resolved}` }; }
    return { ok: true, path: resolved };
}

async function ask_linux_path(rl: readline.Interface): Promise<string> {
    console.log("");
    console.log(dim("Tab-complete available. Path must contain Documentation/devicetree/bindings/ and include/."));
    while (true) {
        const answer = await question(rl, "Linux source path: ");
        if (answer === "") { continue; }

        const checked = check_linux(answer);
        if (checked.ok) { console.log(`Selected: ${checked.path}`); return checked.path; }
        console.log(checked.problem);
    }
}

// ---------------------------------------------------------------------------
// Step 2: Choose context (base device tree file)
// ---------------------------------------------------------------------------

function find_architectures(linux_path: string): string[] {
    const arch_directory = path.join(linux_path, "arch");
    try {
        return fs.readdirSync(arch_directory, { withFileTypes: true })
            .filter(entry => entry.isDirectory())
            .filter(entry => {
                const dts_directory = path.join(arch_directory, entry.name, "boot", "dts");
                return fs.existsSync(dts_directory);
            })
            .map(entry => entry.name)
            .sort();
    } catch { return []; }
}

function find_dts_files(linux_path: string, arch: string): string[] {
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
    results.sort();
    return results;
}

const MAX_DISPLAYED = 20;

async function interactive_dts_search(rl: readline.Interface, linux_path: string): Promise<string> {
    const archs = find_architectures(linux_path);
    if (archs.length === 0) {
        console.log("No architectures with device tree files found.");
        console.log("Falling back to manual path entry.");
        return await ask_dts_path(rl);
    }

    console.log("");
    console.log("Architectures with device tree files:");
    for (const [index, arch_] of archs.entries()) {
        console.log(`  ${code_label(index)} ${arch_}`);
    }
    console.log("");

    let arch: string;
    while (true) {
        const answer = await question(rl, "Architecture: ");
        if (answer === "") { continue; }

        const index = picked_index(answer, archs.length);
        if (index !== undefined) {
            arch = archs[index]!;
            break;
        }

        const match = archs.find(a => a === answer);
        if (match !== undefined) { arch = match; break; }

        console.log(`Please enter ${code_range(archs.length)}, or an architecture name.`);
    }

    console.log(`Scanning ${arch}/boot/dts/...`);
    const all_files = find_dts_files(linux_path, arch);
    if (all_files.length === 0) {
        console.log("No .dts files found.");
        return await ask_dts_path(rl);
    }
    console.log(`Found ${all_files.length} .dts files.`);
    console.log("");

    const absolute = (file: string): string => path.join(linux_path, "arch", arch, "boot", "dts", file);
    if (process.stdin.isTTY && process.stdout.isTTY) {
        console.log(dim("Type to filter, ↑/↓ to move, Enter to pick, Esc to go back to the architectures."));
        const result = await live_filter(all_files);
        if (result.kind === "back") { return await interactive_dts_search(rl, linux_path); }
        console.log(`Selected: ${absolute(result.item)}`);
        return absolute(result.item);
    }

    console.log(dim("Type to filter, or enter a letter to pick from the list."));
    console.log(dim('Type "back" to go back to architecture selection.'));

    let current_matches = all_files;
    let current_filter = "";

    while (true) {
        if (current_matches.length <= MAX_DISPLAYED) {
            console.log("");
            for (const [index_, current_match] of current_matches.entries()) {
                console.log(`  ${code_label(index_)} ${current_match}`);
            }
            console.log("");
        } else {
            console.log("");
            console.log(`${current_matches.length} matches. Showing first ${MAX_DISPLAYED}:`);
            for (let index_ = 0; index_ < MAX_DISPLAYED; index_++) {
                console.log(`  ${code_label(index_)} ${current_matches[index_]}`);
            }
            console.log(dim(`  ... and ${current_matches.length - MAX_DISPLAYED} more. Type to narrow.`));
            console.log("");
        }

        const filter_prompt = current_filter === "" ? "Filter: " : `Filter [${current_filter}]: `;
        const answer = await question(rl, filter_prompt);

        if (answer === "back") {
            return await interactive_dts_search(rl, linux_path);
        }

        const index = picked_index(answer, Math.min(current_matches.length, MAX_DISPLAYED));
        if (index !== undefined) {
            const selected = absolute(current_matches[index]!);
            console.log(`Selected: ${selected}`);
            return selected;
        }

        if (answer !== "") {
            current_filter = answer;
        }

        const lower = current_filter.toLowerCase();
        current_matches = all_files.filter(f => f.toLowerCase().includes(lower));

        if (current_matches.length === 0) {
            console.log(`No matches for "${current_filter}". Try a different filter.`);
            current_filter = "";
            current_matches = all_files;
        } else if (current_matches.length === 1) {
            const selected = absolute(current_matches[0]!);
            console.log(`Selected: ${selected}`);
            return selected;
        }
    }
}

async function ask_dts_path(rl: readline.Interface): Promise<string> {
    console.log(dim("Tab-complete available."));
    while (true) {
        const answer = await question(rl, "Path to .dts file: ");
        if (answer === "") { continue; }

        const resolved = path.resolve(expand_home(answer));

        if (!fs.existsSync(resolved)) {
            console.log(`Path does not exist: ${resolved}`);
            continue;
        }

        if (!resolved.endsWith(".dts")) {
            console.log("File must have a .dts extension.");
            continue;
        }

        console.log(`Selected: ${resolved}`);
        return resolved;
    }
}

export async function step_context(rl: readline.Interface, linux_path: string, current?: string): Promise<string> {
    console.log(bold("Step 2: Base device tree (context)"));
    console.log("");
    console.log("Choose how to select the base .dts file:");
    // With a configured base tree, the first choice keeps it and Enter takes it.
    const choices: { label: string; pick?: () => Promise<string> }[] = [
        ...(current === undefined ? [] : [{ label: `Keep ${current}`, pick: async () => current }]),
        { label: "Search in the Linux tree", pick: async () => await interactive_dts_search(rl, linux_path) },
        { label: "Enter path manually", pick: async () => await ask_dts_path(rl) },
        { label: `Export from remote device ${dim("(coming soon)")}` },
    ];
    for (const [index, choice] of choices.entries()) {
        console.log(`  ${code_label(index)} ${choice.label}`);
    }
    console.log("");

    while (true) {
        const answer = await question(rl, `Choose [${pick_code(0)}]: `);
        const choice = answer === "" ? pick_code(0) : answer;

        const picked = choices[picked_index(choice, choices.length) ?? -1];
        if (picked === undefined) {
            console.log(`Please enter ${code_range(choices.length)}.`);
        } else if (picked.pick === undefined) {
            console.log("Not yet available. Please choose another option.");
        } else {
            return await picked.pick();
        }
    }
}

// ---------------------------------------------------------------------------
// Step 3: The overlay workfile
// ---------------------------------------------------------------------------

/** Ask for the name of a new workfile; Enter takes the next free `overlay[-N].dtso`. */
async function ask_workfile_name(rl: readline.Interface): Promise<string> {
    const default_name = next_workfile_name();
    while (true) {
        const answer = await question(rl, `Overlay file name [${default_name}]: `);
        const filename = answer === "" ? default_name : workfile_filename(answer);
        const problem = workfile_problem(filename);
        if (problem === undefined) { return filename; }
        console.log(problem);
    }
}

/**
 * The overlay workfile: keep the configured one (Enter) or create a new one.
 * `configured` is the configured overlay when its file exists.
 */
export async function step_overlay(rl: readline.Interface, configured?: string): Promise<OverlayChoice> {
    console.log(bold("Step 3: Overlay workfile"));
    console.log("");
    console.log("The workfile is the overlay file your changes are written to.");
    console.log("");

    if (configured !== undefined) {
        while (true) {
            const answer = await question(rl, `Overlay: [k]eep ${configured} / [n]ew [k]: `);
            const lower = answer.toLowerCase();
            if (lower === "" || lower === "k" || lower === "keep") { return { kind: "keep", path: configured }; }
            if (lower === "n" || lower === "new") { return { kind: "create", filename: await ask_workfile_name(rl) }; }
            console.log("Please enter k to keep it or n for a new one.");
        }
    }
    return { kind: "create", filename: await ask_workfile_name(rl) };
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    test("picked_index — a letter in range picks, a number or a letter past the list does not", () => {
        expect(picked_index("a", 3)).toBe(0);
        expect(picked_index("c", 3)).toBe(2);
        expect(picked_index("d", 3)).toBeUndefined();
        expect(picked_index("1", 3)).toBeUndefined();
        expect(picked_index("aa", 30)).toBe(26);
        expect(code_range(1)).toBe("a");
        expect(code_range(3)).toBe("a to c");
    });

    test("find_linux_trees — any directory with the bindings and include/, not only one named linux", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "attach-setup-"));
        try {
            for (const tree of ["linux_adi", path.join("src", "kernel")]) {
                fs.mkdirSync(path.join(root, tree, "Documentation", "devicetree", "bindings"), { recursive: true });
                fs.mkdirSync(path.join(root, tree, "include"));
            }
            fs.mkdirSync(path.join(root, "linux-docs", "Documentation", "devicetree", "bindings"), { recursive: true });
            expect(find_linux_trees(root)).toEqual([path.join(root, "linux_adi"), path.join(root, "src", "kernel")]);
        } finally {
            fs.rmSync(root, { recursive: true });
        }
    });

    test("check_linux — a Linux tree is accepted, a missing path or another directory is not", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "attach-setup-"));
        try {
            fs.mkdirSync(path.join(root, "Documentation", "devicetree", "bindings"), { recursive: true });
            fs.mkdirSync(path.join(root, "include"));
            expect(check_linux(root)).toEqual({ ok: true, path: root });
            const missing = check_linux(path.join(root, "nope"));
            expect(!missing.ok && missing.problem).toContain("Path does not exist");
            const other = check_linux(path.join(root, "include"));
            expect(!other.ok && other.problem).toContain("not a Linux source tree");
        } finally {
            fs.rmSync(root, { recursive: true });
        }
    });

    test("check_devicetree — a file is accepted, a directory or missing path is not", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "attach-setup-"));
        try {
            const file = path.join(root, "base.dts");
            fs.writeFileSync(file, "");
            expect(check_devicetree(file)).toEqual({ ok: true, path: file });
            const directory = check_devicetree(root);
            expect(!directory.ok && directory.problem).toContain("Not a file");
            const missing = check_devicetree(path.join(root, "nope.dts"));
            expect(!missing.ok && missing.problem).toContain("Path does not exist");
        } finally {
            fs.rmSync(root, { recursive: true });
        }
    });

    test("looks_like_path — a slash, ~ or a leading dot makes the answer a path", () => {
        expect(["/home/me/linux", "~/linux", "./linux", "../linux", "linux/"].map(answer => looks_like_path(answer))).toEqual([true, true, true, true, true]);
        expect(["a", "arm", "b"].map(answer => looks_like_path(answer))).toEqual([false, false, false]);
    });
}
