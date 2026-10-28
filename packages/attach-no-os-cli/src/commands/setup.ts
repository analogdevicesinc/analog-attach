import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { styleText } from "node:util";
import { checkbox, confirm, input, select } from "@inquirer/prompts";
import YAML from "yaml";
import {
    PATH_LIST_DELIMITER,
    board_peripheral_kinds,
    get_effective_setting_value,
    get_settings_sources,
    get_workfile_path,
    list_boards,
    reset_registry,
    set_setting_value,
    set_target_setting
} from "attach-no-os-lib";
import { init_workfile } from "./init";

/**
 * `attach-noos` alone, at a terminal: the guided setup.
 *
 * It walks the settings a first run needs, in the order they depend on each other - where
 * capi is, which module repositories sit next to it, which board - and then the workfile.
 * Anything already set is shown and skipped, so running it again only asks what is still
 * missing. Each answer is written straight away, through the same calls `config` makes, so
 * stopping halfway (Ctrl+C) keeps what was answered. It ends by pointing at the next
 * commands rather than running them: from there the user drives.
 */

/** The module types the registry loads rulesets from: what `module_paths` is for. */
const MODULE_TYPES = new Set(["platform", "driver_collection", "utility", "middleware"]);

export interface ModuleRoot {
    path: string;
    name: string;
    type: string;
}

export async function run_setup(): Promise<number> {
    const sources = get_settings_sources();
    console.log(styleText("bold", "analog-attach setup"));
    console.log(styleText("dim", `Settings are saved to ${sources.local ?? sources.global}\n`));

    try {
        const capi = await ensure_capi_path();
        if (capi === undefined) {
            return 1;
        }
        await ensure_module_paths(capi);
        const board = await ensure_board();
        if (board !== undefined) {
            await ensure_workfile(board);
        }
    } catch (error) {
        // Ctrl+C at a prompt: what was answered is already saved.
        if (error instanceof Error && error.name === "ExitPromptError") {
            console.log(styleText("dim", "\nStopped. What was answered is saved; run attach-noos again to go on."));
            return 130;
        }
        throw error;
    }

    print_next_steps();
    return 0;
}

// --- The steps ---

async function ensure_capi_path(): Promise<string | undefined> {
    const current = effective("capi_path");
    if (current !== undefined && looks_like_capi(current)) {
        done("capi_path", current);
        return current;
    }
    if (current !== undefined) {
        console.log(styleText("yellow", `capi_path is ${current}, which is not a capi checkout.`));
    }

    const candidates = find_capi_candidates();
    let answer = "";
    if (candidates.length > 0) {
        answer = await select({
            message: "Where is capi?",
            choices: [
                ...candidates.map(candidate => ({ name: candidate, value: candidate })),
                { name: "Another folder…", value: "" }
            ]
        });
    }
    if (answer === "") {
        answer = await input({
            message: "Path to the capi repository",
            validate: value => looks_like_capi(expand_home(value))
                || "No capi checkout there (looking for a module.yml with name: capi)"
        });
    }

    const capi = path.resolve(expand_home(answer));
    return write("capi_path", capi) ? capi : undefined;
}

async function ensure_module_paths(capi: string): Promise<void> {
    const current = effective("module_paths");
    if (current !== undefined) {
        done("module_paths", current.split(PATH_LIST_DELIMITER).map(entry => path.basename(entry)).join(", "));
        return;
    }

    const found = module_roots_near(capi);
    if (found.length === 0) {
        console.log(styleText("yellow", `No module repositories next to ${capi}.`));
        console.log(`  Set them later: attach-noos config module_paths <path>${PATH_LIST_DELIMITER}<path>`);
        return;
    }

    const width = Math.max(...found.map(root => root.name.length));
    const picked = await checkbox({
        message: "Which module repositories should rulesets come from?",
        choices: found.map(root => ({
            name: `${root.name.padEnd(width)}  ${styleText("dim", root.type.replace("_", " "))}`,
            value: root.path,
            checked: true
        })),
        required: true
    });
    if (write("module_paths", picked.join(PATH_LIST_DELIMITER))) {
        // The boards come from these: read them afresh for the next step.
        reset_registry();
    }
}

async function ensure_board(): Promise<string | undefined> {
    const current = effective("board");
    if (current !== undefined) {
        done("board", current);
        return current;
    }

    const boards = list_boards();
    if (!boards.ok || boards.value.length === 0) {
        console.log(styleText("yellow", boards.ok ? "No boards in the configured module repositories." : boards.error.message));
        console.log("  Set one later: attach-noos config board <name>");
        return undefined;
    }

    const width = Math.max(...boards.value.map(board => board.name.length));
    const board = await select({
        message: "Which board?",
        pageSize: 12,
        choices: boards.value.map(candidate => {
            const kinds = board_peripheral_kinds(candidate.name);
            const declared = kinds.ok && kinds.value.length > 0 ? kinds.value.join(", ") : "no board.yml peripherals";
            return {
                name: `${candidate.name.padEnd(width)}  ${(candidate.soc ?? "?").padEnd(9)}  ${styleText("dim", declared)}`,
                value: candidate.name
            };
        })
    });

    // A board and its platform are one choice: this sets both, as `config board` does.
    const written = set_target_setting("board", board);
    if (!written.ok) {
        console.log(styleText("red", written.error.message));
        return undefined;
    }
    const changed = Object.entries(written.value.changed)
        .map(([name, value]) => (value === undefined ? `cleared ${name}` : `${name} = ${value}`))
        .join(", ");
    console.log(styleText("green", "✓ ") + changed);
    return board;
}

async function ensure_workfile(board: string): Promise<void> {
    const target = get_workfile_path();
    if (!target.ok) {
        console.log(styleText("red", target.error.message));
        return;
    }
    const shown = path.relative(process.cwd(), target.value) || target.value;
    if (fs.existsSync(target.value)) {
        done("workfile", shown);
        return;
    }

    const create = await confirm({ message: `Create ${shown} for ${board}?`, default: true });
    if (!create) {
        console.log(styleText("dim", "  Create it later: attach-noos init"));
        return;
    }
    const created = init_workfile();
    console.log(created.ok ? styleText("green", "✓ ") + created.message : styleText("red", created.text ?? created.message));
}

function print_next_steps(): void {
    console.log(`
${styleText("bold", "Next")}
  attach-noos list devices          what can be added: eval boards, drivers
  attach-noos add <eval board>      e.g. attach-noos add eval-adxl355-pmdz
  attach-noos read                  what the workfile holds
  attach-noos config                every setting, and how to change one
  attach-noos --help                every command`);
}

// --- Finding things ---

/** Whether `directory` is a capi checkout: its module.yml names it capi. */
export function looks_like_capi(directory: string): boolean {
    return read_module(directory)?.name === "capi";
}

/**
 * capi checkouts near where the user is: in the current directory or any above it, in the
 * home directory, and one or two levels into either (~/work/capi). Nearest first.
 */
export function find_capi_candidates(start: string = process.cwd(), home: string = os.homedir()): string[] {
    const bases: string[] = [];
    for (let directory = path.resolve(start); ; directory = path.dirname(directory)) {
        bases.push(directory);
        if (path.dirname(directory) === directory) {
            break;
        }
    }
    bases.push(home);

    const found: string[] = [];
    const consider = (directory: string): void => {
        if (!found.includes(directory) && looks_like_capi(directory)) {
            found.push(directory);
        }
    };
    for (const base of bases) {
        consider(base);
        for (const child of subdirectories(base)) {
            consider(child);
            consider(path.join(child, "capi"));
        }
    }
    return found;
}

/** The module repositories beside a capi checkout that rulesets can come from. */
export function module_roots_near(capi: string): ModuleRoot[] {
    return subdirectories(path.dirname(path.resolve(capi))).flatMap(directory => {
        const module = read_module(directory);
        return module?.type !== undefined && MODULE_TYPES.has(module.type)
            ? [{ path: directory, name: module.name ?? path.basename(directory), type: module.type }]
            : [];
    });
}

function read_module(directory: string): { name?: string, type?: string } | undefined {
    try {
        const parsed: unknown = YAML.parse(fs.readFileSync(path.join(directory, "module.yml"), "utf8"));
        if (typeof parsed !== "object" || parsed === null) {
            return undefined;
        }
        const { name, type } = parsed as Record<string, unknown>;
        return {
            ...(typeof name === "string" ? { name } : {}),
            ...(typeof type === "string" ? { type } : {})
        };
    } catch {
        return undefined;
    }
}

function subdirectories(directory: string): string[] {
    try {
        // A symlinked checkout (~/work -> /data/work) counts: follow links to see what they are.
        return fs.readdirSync(directory, { withFileTypes: true })
            .filter(entry => !entry.name.startsWith(".")
                && (entry.isDirectory() || (entry.isSymbolicLink() && is_directory(path.join(directory, entry.name)))))
            .map(entry => path.join(directory, entry.name))
            .sort();
    } catch {
        return [];
    }
}

function is_directory(candidate: string): boolean {
    try {
        return fs.statSync(candidate).isDirectory();
    } catch {
        return false;
    }
}

// --- Settings ---

function effective(key: "capi_path" | "module_paths" | "board"): string | undefined {
    const value = get_effective_setting_value(key);
    return value.ok && value.value !== undefined && value.value !== "" ? value.value : undefined;
}

function write(key: "capi_path" | "module_paths", value: string): boolean {
    const written = set_setting_value(key, value);
    if (!written.ok) {
        console.log(styleText("red", written.error.message));
        return false;
    }
    console.log(styleText("green", "✓ ") + `${key} = ${value}`);
    return true;
}

function done(key: string, value: string): void {
    console.log(styleText("green", "✓ ") + `${key}: ${value}`);
}

function expand_home(value: string): string {
    return value === "~" || value.startsWith("~/") ? path.join(os.homedir(), value.slice(1)) : value;
}
