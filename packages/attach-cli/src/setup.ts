import * as readline from "node:readline";
import * as fs from "node:fs";
import path from "node:path";
import * as os from "node:os";

import { linux_tree_problem } from "./config/workspace";

const BOLD = "\u001B[1m";
const DIM = "\u001B[2m";
const RESET = "\u001B[0m";
const CYAN = "\u001B[36m";

function bold(text: string): string { return `${BOLD}${text}${RESET}`; }
function dim(text: string): string { return `${DIM}${text}${RESET}`; }
function cyan(text: string): string { return `${CYAN}${text}${RESET}`; }

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

function create_rl(): readline.Interface {
    return readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        completer: path_completer,
    });
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

function find_linux_trees(): string[] {
    const home = os.homedir();
    const results: string[] = [];
    const queue: { dir: string; depth: number }[] = [{ dir: home, depth: 0 }];
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
            entries = fs.readdirSync(item.dir, { withFileTypes: true });
        } catch { continue; }

        for (const entry of entries) {
            if (!entry.isDirectory()) { continue; }
            if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) { continue; }

            const full = path.join(item.dir, entry.name);

            if (entry.name === "linux" || entry.name.startsWith("linux-")) {
                if (linux_tree_problem(full) === undefined) {
                    results.push(full);
                }
                continue;
            }

            if (item.depth < MAX_DEPTH) {
                queue.push({ dir: full, depth: item.depth + 1 });
            }
        }
    }

    return results;
}

async function step_linux(rl: readline.Interface): Promise<string> {
    console.log(bold("Step 1: Linux kernel source tree"));
    console.log("");
    console.log("attach-linux needs the path to a Linux kernel source tree");
    console.log(dim("(must contain Documentation/devicetree/bindings/ and include/)"));
    console.log("");

    console.log("Searching for Linux source trees under ~...");
    const trees = find_linux_trees();
    console.log("");

    if (trees.length > 0) {
        console.log("Found Linux source trees:");
        for (const [index, tree] of trees.entries()) {
            console.log(`  ${cyan(`${index + 1})`)} ${tree}`);
        }
        console.log(`  ${cyan("m)")} Enter path manually`);
        console.log("");

        while (true) {
            const answer = await question(rl, `Choose [1]: `);
            const choice = answer === "" ? "1" : answer;

            if (choice === "m" || choice === "M") {
                return await ask_linux_path(rl);
            }

            const index = Number.parseInt(choice, 10) - 1;
            if (Number.isNaN(index) || index < 0 || index >= trees.length) {
                console.log(`Please enter 1-${trees.length} or m for manual entry.`);
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

async function ask_linux_path(rl: readline.Interface): Promise<string> {
    console.log("");
    console.log(dim("Tab-complete available. Path must contain Documentation/devicetree/bindings/ and include/."));
    while (true) {
        const answer = await question(rl, "Linux source path: ");
        if (answer === "") { continue; }

        const resolved = path.resolve(answer);

        if (!fs.existsSync(resolved)) {
            console.log(`Path does not exist: ${resolved}`);
            continue;
        }

        const problem = linux_tree_problem(resolved);
        if (problem !== undefined) {
            console.log(problem);
            continue;
        }

        console.log(`Selected: ${resolved}`);
        return resolved;
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
        console.log(`  ${cyan(`${index + 1})`)} ${arch_}`);
    }
    console.log("");

    let arch: string;
    while (true) {
        const answer = await question(rl, "Architecture: ");
        if (answer === "") { continue; }

        const index = Number.parseInt(answer, 10) - 1;
        if (!Number.isNaN(index) && index >= 0 && index < archs.length) {
            arch = archs[index]!;
            break;
        }

        const match = archs.find(a => a === answer);
        if (match !== undefined) { arch = match; break; }

        console.log(`Please enter 1-${archs.length} or an architecture name.`);
    }

    console.log(`Scanning ${arch}/boot/dts/...`);
    const all_files = find_dts_files(linux_path, arch);
    if (all_files.length === 0) {
        console.log("No .dts files found.");
        return await ask_dts_path(rl);
    }
    console.log(`Found ${all_files.length} .dts files.`);
    console.log("");
    console.log(dim("Type to filter, or enter a number to pick from the list."));
    console.log(dim('Type "back" to go back to architecture selection.'));

    let current_matches = all_files;
    let current_filter = "";

    while (true) {
        if (current_matches.length <= MAX_DISPLAYED) {
            console.log("");
            for (const [index_, current_match] of current_matches.entries()) {
                console.log(`  ${cyan(`${index_ + 1})`)} ${current_match}`);
            }
            console.log("");
        } else {
            console.log("");
            console.log(`${current_matches.length} matches. Showing first ${MAX_DISPLAYED}:`);
            for (let index_ = 0; index_ < MAX_DISPLAYED; index_++) {
                console.log(`  ${cyan(`${index_ + 1})`)} ${current_matches[index_]}`);
            }
            console.log(dim(`  ... and ${current_matches.length - MAX_DISPLAYED} more. Type to narrow.`));
            console.log("");
        }

        const filter_prompt = current_filter === "" ? "Filter: " : `Filter [${current_filter}]: `;
        const answer = await question(rl, filter_prompt);

        if (answer === "back") {
            return await interactive_dts_search(rl, linux_path);
        }

        const index = Number.parseInt(answer, 10) - 1;
        if (!Number.isNaN(index) && index >= 0 && index < current_matches.length && index < MAX_DISPLAYED) {
            const selected = current_matches[index]!;
            const absolute = path.join(linux_path, "arch", arch, "boot", "dts", selected);
            console.log(`Selected: ${absolute}`);
            return absolute;
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
            const selected = current_matches[0]!;
            const absolute = path.join(linux_path, "arch", arch, "boot", "dts", selected);
            console.log(`Selected: ${absolute}`);
            return absolute;
        }
    }
}

async function ask_dts_path(rl: readline.Interface): Promise<string> {
    console.log(dim("Tab-complete available."));
    while (true) {
        const answer = await question(rl, "Path to .dts file: ");
        if (answer === "") { continue; }

        const resolved = path.resolve(answer);

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

async function step_context(rl: readline.Interface, linux_path: string): Promise<string> {
    console.log(bold("Step 2: Base device tree (context)"));
    console.log("");
    console.log("Choose how to select the base .dts file:");
    console.log(`  ${cyan("1)")} Search in the Linux tree`);
    console.log(`  ${cyan("2)")} Enter path manually`);
    console.log(`  ${cyan("3)")} Export from remote device ${dim("(coming soon)")}`);
    console.log("");

    while (true) {
        const answer = await question(rl, "Choose [1]: ");
        const choice = answer === "" ? "1" : answer;

        switch (choice) {
            case "1": {
                return await interactive_dts_search(rl, linux_path);
            }
            case "2": {
                return await ask_dts_path(rl);
            }
            case "3": {
                console.log("Not yet available. Please choose another option.");
                continue;
            }
            default: {
                console.log("Please enter 1, 2, or 3.");
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Step 3: Output export lines
// ---------------------------------------------------------------------------

interface ShellInfo {
    name: string;
    rc_file: string;
    format_export: (key: string, value: string) => string;
    source_command: string;
}

function detect_shell(): ShellInfo {
    const shell = process.env["SHELL"] ?? "";
    const name = path.basename(shell);
    const home = os.homedir();

    switch (name) {
        case "fish": {
            return {
                name: "fish",
                rc_file: path.join(home, ".config", "fish", "config.fish"),
                format_export: (key, value) => `set -gx ${key} ${value}`,
                source_command: `source ${path.join(home, ".config", "fish", "config.fish")}`,
            };
        }
        case "zsh": {
            return {
                name: "zsh",
                rc_file: path.join(home, ".zshrc"),
                format_export: (key, value) => `export ${key}=${value}`,
                source_command: `source ${path.join(home, ".zshrc")}`,
            };
        }
        default: {
            return {
                name: name || "bash",
                rc_file: path.join(home, ".bashrc"),
                format_export: (key, value) => `export ${key}=${value}`,
                source_command: `source ${path.join(home, ".bashrc")}`,
            };
        }
    }
}

function step_output(linux_path: string, context_path: string): void {
    const shell = detect_shell();

    const line_linux = shell.format_export("ATTACH_LINUX", linux_path);
    const line_context = shell.format_export("ATTACH_DEVICETREE", context_path);

    console.log(bold("Setup complete!"));
    console.log("");
    console.log(`Add these lines to your ${cyan(shell.rc_file)}:`);
    console.log("");
    console.log(`  ${line_linux}`);
    console.log(`  ${line_context}`);
    console.log("");
    console.log("Then reload your shell:");
    console.log("");
    console.log(`  ${shell.source_command}`);
    console.log("");
    console.log(bold("Next steps:"));
    console.log("");
    console.log(`  ${cyan("1.")} Create a bare overlay workfile:`);
    console.log(`     ${dim("attach-linux create-workfile [name]")}`);
    console.log("");
    console.log(`  ${cyan("2.")} Search for devices to add to the overlay:`);
    console.log(`     ${dim("attach-linux list device [filter]")}`);
    console.log(`     ${dim("The first run builds a binding index — subsequent runs are instant.")}`);
    console.log("");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function run_setup(): Promise<void> {
    const rl = create_rl();
    try {
        console.log("");
        console.log(bold("attach-linux setup"));
        console.log("==================");
        console.log("");
        console.log("This will help you configure attach-linux.");
        console.log("You'll need a Linux kernel source tree and a target device tree file.");
        console.log("");

        const linux_path = await step_linux(rl);
        console.log("");

        const context_path = await step_context(rl, linux_path);
        console.log("");

        step_output(linux_path, context_path);
    } catch (error: unknown) {
        if (error instanceof Error && error.message === "interrupted") {
            console.log("\nSetup cancelled.");
            return;
        }
        throw error;
    } finally {
        rl.close();
    }
}
