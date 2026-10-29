import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    board_peripheral_kinds,
    get_workfile_path,
    list_boards,
    reset_registry,
} from "attach-no-os-lib";
import {
    answer,
    cancelled,
    PromptCancelled,
    refuse,
    type InteractiveSession,
    type Outcome,
} from "../../../interface/backend-interface";
import type { SetupResponse } from "../protocol/responses";
import { install, is_module_checkout, looks_like_capi, read_module } from "../settings";

/**
 * The bare `analog-attach` at a terminal, once the backend is noos: the guided setup.
 *
 * It walks the settings a first run needs, in the order they depend on each other - where
 * capi is, which module repositories sit next to it, which board - and then the workfile.
 * Anything already set is shown and skipped, so running it again only asks what is still
 * missing. Each answer is written straight away, through the same checks `config` makes, so
 * stopping halfway (Ctrl+C) keeps what was answered. When the user wants the workfile, the
 * response is `ready` and the front end runs `init` next.
 */

/** The module types the registry loads rulesets from: what `module-paths` is for. */
const MODULE_TYPES = new Set(["platform", "driver_collection", "utility", "middleware"]);

/** Boards listed at once before the list scrolls. */
const PAGE_SIZE = 12;

export interface ModuleRoot {
    path: string;
    name: string;
    type: string;
}

/** What a step did: the settings it wrote, or the refusal that ends the setup. */
type Step<T> = { ok: true; value: T; saved: string[] } | { ok: false; outcome: Outcome<never> };

export async function setup(session: InteractiveSession): Promise<Outcome<SetupResponse>> {
    install(session);
    session.say(session.style.bold(`${session.program} setup`));
    session.say("");

    const saved: string[] = [];
    let ready = false;
    try {
        const capi = await ensure_capi_path(session);
        if (!capi.ok) { return capi.outcome; }
        saved.push(...capi.saved);

        const modules = await ensure_module_paths(session, capi.value);
        if (!modules.ok) { return modules.outcome; }
        saved.push(...modules.saved);

        const board = await ensure_board(session);
        if (!board.ok) { return board.outcome; }
        saved.push(...board.saved);

        if (board.value !== undefined) {
            ready = await ask_workfile(session, board.value);
        }
    } catch (error) {
        // Ctrl+C at a prompt: what was answered is already saved.
        if (error instanceof PromptCancelled) {
            return cancelled(`Stopped. What was answered is saved; run ${session.program} again to go on.`);
        }
        throw error;
    }

    const message = saved.length === 0 ? "Every setting was already set" : `Saved ${saved.join(", ")}`;
    const response: SetupResponse = { ok: true, message, severity: "info", saved, ready };
    // When ready, the front end runs `init` next and prints its outcome after these.
    return answer(response, style => `${next_steps(session.program, style.bold("Next"))}${ready ? "\n" : ""}`);
}

// --- The steps ---

async function ensure_capi_path(session: InteractiveSession): Promise<Step<string>> {
    const { settings, style, prompter } = session;
    const current = settings.get("capi-path");
    if (current !== undefined && is_module_checkout(current)) {
        done(session, "capi-path", current);
        return { ok: true, value: current, saved: [] };
    }
    if (current !== undefined) {
        session.say(style.yellow(`capi-path is ${current}, which is not a capi checkout.`));
    }

    const candidates = find_capi_candidates(session.cwd);
    let picked = "";
    if (candidates.length > 0) {
        picked = await prompter.select({
            message: "Where is capi?",
            choices: [
                ...candidates.map(candidate => ({ name: candidate, value: candidate })),
                { name: "Another folder…", value: "" }
            ]
        });
    }
    if (picked === "") {
        picked = await prompter.input({
            message: "Path to the capi repository",
            validate: value => looks_like_capi(expand_home(value, session.cwd))
                || "No capi checkout there (looking for a module.yml with name: capi)"
        });
    }

    const capi = expand_home(picked, session.cwd);
    const written = await write(session, "capi-path", capi);
    return written.ok ? { ok: true, value: capi, saved: ["capi-path"] } : written;
}

async function ensure_module_paths(session: InteractiveSession, capi: string): Promise<Step<undefined>> {
    const { settings, style, prompter } = session;
    const current = settings.paths("module-paths");
    if (current !== undefined && current.length > 0) {
        done(session, "module-paths", current.map(entry => path.basename(entry)).join(", "));
        return { ok: true, value: undefined, saved: [] };
    }

    const found = module_roots_near(capi);
    if (found.length === 0) {
        session.say(style.yellow(`No module repositories next to ${capi}.`));
        session.say(`  Set them later: ${session.program} config module-paths <path> <path>...`);
        return { ok: true, value: undefined, saved: [] };
    }

    const width = Math.max(...found.map(root => root.name.length));
    const picked = await prompter.checkbox({
        message: "Which module repositories should rulesets come from?",
        choices: found.map(root => ({
            name: `${root.name.padEnd(width)}  ${style.dim(root.type.replace("_", " "))}`,
            value: root.path,
        })),
        required: true
    });
    const written = await write(session, "module-paths", picked);
    if (!written.ok) { return written; }
    // The boards come from these: read them afresh for the next step.
    reset_registry();
    return { ok: true, value: undefined, saved: ["module-paths"] };
}

async function ensure_board(session: InteractiveSession): Promise<Step<string | undefined>> {
    const { settings, style, prompter } = session;
    const current = settings.get("board");
    if (current !== undefined) {
        done(session, "board", current);
        return { ok: true, value: current, saved: [] };
    }

    const boards = list_boards();
    if (!boards.ok || boards.value.length === 0) {
        session.say(style.yellow(boards.ok ? "No boards in the configured module repositories." : boards.error.message));
        session.say(`  Set one later: ${session.program} config board <name>`);
        return { ok: true, value: undefined, saved: [] };
    }

    const width = Math.max(...boards.value.map(board => board.name.length));
    const board = await prompter.select({
        message: "Which board?",
        page_size: PAGE_SIZE,
        choices: boards.value.map(candidate => {
            const kinds = board_peripheral_kinds(candidate.name);
            const declared = kinds.ok && kinds.value.length > 0 ? kinds.value.join(", ") : "no board.yml peripherals";
            return {
                name: `${candidate.name.padEnd(width)}  ${(candidate.soc ?? "?").padEnd(9)}  ${style.dim(declared)}`,
                value: candidate.name
            };
        })
    });

    // A board and its platform are one choice: the write sets both, as `config board` does.
    const written = await write(session, "board", board);
    if (!written.ok) { return written; }
    const platform = settings.get("platform");
    return { ok: true, value: board, saved: platform === undefined ? ["board"] : ["board", "platform"] };
}

/** Whether to create the workfile: only asked when there is none yet. */
async function ask_workfile(session: InteractiveSession, board: string): Promise<boolean> {
    const target = get_workfile_path();
    if (!target.ok) {
        session.say(session.style.red(target.error.message));
        return false;
    }
    const shown = path.relative(session.cwd, target.value) || target.value;
    if (fs.existsSync(target.value)) {
        done(session, "workfile", shown);
        return false;
    }

    const create = await session.prompter.confirm({ message: `Create ${shown} for ${board}?`, default: true });
    if (!create) {
        session.say(session.style.dim(`  Create it later: ${session.program} init`));
    }
    return create;
}

function next_steps(program: string, heading: string): string {
    const rows: [string, string][] = [
        [`${program} list devices`, "what can be added: eval boards, drivers"],
        [`${program} add <eval board>`, `e.g. ${program} add eval-adxl355-pmdz`],
        [`${program} read`, "what the workfile holds"],
        [`${program} config`, "every setting, and how to change one"],
        [`${program} --help`, "every command"],
    ];
    const width = Math.max(...rows.map(([left]) => left.length)) + 2;
    return [`\n${heading}`, ...rows.map(([left, right]) => `  ${left.padEnd(width)}${right}`)].join("\n");
}

// --- Finding things ---

/**
 * capi checkouts near where the user is: in the current directory or any above it, in the
 * home directory, and one or two levels into either (~/work/capi). Nearest first.
 */
export function find_capi_candidates(start: string, home: string = os.homedir()): string[] {
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

function subdirectories(directory: string): string[] {
    try {
        // A symlinked checkout (~/work -> /data/work) counts: follow links to see what they are.
        return fs.readdirSync(directory, { withFileTypes: true })
            .filter(entry => !entry.name.startsWith(".")
                && (entry.isDirectory() || (entry.isSymbolicLink() && is_directory(path.join(directory, entry.name)))))
            .map(entry => path.join(directory, entry.name))
            .toSorted();
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

/** Write one setting through `config`'s checks, and say so. */
async function write(session: InteractiveSession, key: string, value: string | readonly string[]): Promise<{ ok: true } | { ok: false; outcome: Outcome<never> }> {
    const written = await session.settings.set(key, value);
    if (!written.ok) {
        return { ok: false, outcome: refuse(written.message) };
    }
    const shown = typeof value === "string" ? value : value.join(", ");
    const platform = key === "board" ? session.settings.get("platform") : undefined;
    const also = platform === undefined ? "" : ` (and platform = ${platform})`;
    session.say(`${session.style.cyan("✓")} ${key} = ${shown}${also}`);
    return { ok: true };
}

function done(session: InteractiveSession, key: string, value: string): void {
    session.say(`${session.style.cyan("✓")} ${key}: ${value}`);
}

/** A typed path: `~` is the home directory, a relative one is from where the setup runs. */
function expand_home(value: string, cwd: string): string {
    const expanded = value === "~" || value.startsWith("~/") ? path.join(os.homedir(), value.slice(1)) : value;
    return path.resolve(cwd, expanded);
}
