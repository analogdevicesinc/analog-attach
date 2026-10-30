// One run of `analog-attach`: read `backend`, load that backend, open the settings with
// its section, build the routes, and run the words. Everything a run touches comes in
// through `MainDeps`, so tests drive it in-process (bin/cli.ts passes the real ones).
//
//   - `__complete -- <words>`: the completion lines (complete.ts), nothing on stderr, exit 0.
//   - `--json` is taken out of the words wherever it is (before a `--`), then stricli parses them.
//   - The bare run (no words, not `--json`, on a terminal): setup.ts. Off a terminal, or with
//     `--quiet` alone, the usage (on stderr and exit 2 under `--json`).
//   - `help [<command>...]` is `<command>... --help`.

import * as fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { run as run_stricli } from "@stricli/core";
import type { Backend, Prompter, Session } from "../interface/backend-interface";
import { complete_words } from "./complete";
import { EXIT_CRASH, EXIT_INPUT_ERROR, EXIT_OK, run_outcome, type OutputStreams } from "./output";
import type { Registry } from "./registry";
import { backend_command, build_application, build_routes, positional_record, type FrontEnd, type RunContext } from "./routes";
import { create_session } from "./session";
import { BACKEND_KEY, backend_setting, open_settings, settings_files, type SettingsLocation, type SettingsStore } from "./settings-store";
import { bare_run } from "./setup";
import { claude_on_path } from "./skill";
import type { Environment } from "./stubs";

export const PROGRAM = "analog-attach";

export interface MainDeps {
    registry: Registry;
    streams: OutputStreams;
    location: SettingsLocation;
    /** Whether stdin and stdout are terminals: only then may a command ask. */
    tty: { stdin: boolean; stdout: boolean };
    /** `$SHELL` and the variables of the completion install paths. Default: none. */
    environment?: Environment;
    /** The prompter of a run that may ask; made only when one does. Without it nothing asks. */
    prompter?: () => Prompter | Promise<Prompter>;
    /** `skill install`'s check. Default: `claude --version` runs. */
    claude_installed?: () => boolean;
    /** Aborted on Ctrl-C outside a prompt. */
    signal?: AbortSignal;
    /** The directory with package.json and `bundled/`. Default: found from this file. */
    package_root?: string;
}

// =====================================================================================
// The package
// =====================================================================================

/** The nearest ancestor of this module's file with this package's package.json: `packages/cli`, from `src/front/` and from `dist/`. */
export function find_package_root(from: string = path.dirname(fileURLToPath(import.meta.url))): string {
    let directory = from;
    for (;;) {
        const manifest = path.join(directory, "package.json");
        if (fs.existsSync(manifest)) {
            const { name } = JSON.parse(fs.readFileSync(manifest, "utf8")) as { name?: string };
            if (name === "@analog-attach/cli") { return directory; }
        }
        const parent = path.dirname(directory);
        if (parent === directory) { throw new Error(`No package.json of @analog-attach/cli above ${from}`); }
        directory = parent;
    }
}

function package_version(root: string): string {
    try {
        const { version } = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { version?: string };
        return version ?? "0.0.0";
    } catch {
        return "0.0.0";
    }
}

/** `<package root>/bundled/<backend id>`: where a backend's bundled files are. */
export function assets_directory(package_root: string, backend_id: string): string {
    return path.join(package_root, "bundled", backend_id);
}

// =====================================================================================
// The front end of a run
// =====================================================================================

/** Why there is no backend, pointing to `config backend`. */
function no_backend_message(id: string | undefined, registry: Registry): string {
    const choose = backend_command({ program: PROGRAM, registry });
    if (id === undefined) { return `No backend is set. Run '${PROGRAM}' on a terminal, or ${choose}.`; }
    const known = Object.keys(registry);
    return `Unknown backend: ${id}. ${known.length === 0 ? "This build has none." : `Known backends: ${known.join(", ")}.`} Run ${choose}.`;
}

/** Read `backend`, load it, and open the settings with its section. */
async function open_front(deps: MainDeps, json: boolean, root: string): Promise<FrontEnd> {
    const files = settings_files(deps.location);
    const ids = Object.keys(deps.registry);
    // `backend` first, its value unchecked; no section is read yet.
    const bootstrap = open_settings({ files, top: [{ ...backend_setting(ids), options: undefined }], sections: ids });
    const id = bootstrap.get(BACKEND_KEY);
    const loader = id === undefined || !Object.hasOwn(deps.registry, id) ? undefined : deps.registry[id];
    const backend: Backend | undefined = loader === undefined ? undefined : await loader();

    const make_session = (mode: Session["mode"], store: SettingsStore, prompter?: Prompter): Session => create_session({
        program: PROGRAM,
        mode,
        cwd: files.cwd,
        project_root: files.project_root,
        // Without a backend nothing writes state; the directory is never created.
        backend_id: backend?.id ?? "none",
        assets_dir: assets_directory(root, backend?.id ?? "none"),
        settings: store,
        ...(prompter === undefined ? {} : { prompter }),
        streams: deps.streams,
        ...(deps.signal === undefined ? {} : { signal: deps.signal }),
    });

    const settings: SettingsStore = open_settings({
        files,
        top: [backend_setting(ids)],
        sections: ids,
        // Without a backend no section is read: every section is kept as it is.
        ...(backend === undefined ? {} : { active: { id: backend.id, specs: backend.settings } }),
        ...(backend?.settings_hooks === undefined ? {} : { hooks: backend.settings_hooks }),
        // The hooks never ask.
        session: () => make_session(json ? "json" : "text", settings),
    });
    const can_ask = deps.tty.stdin && deps.tty.stdout && deps.prompter !== undefined;
    return {
        program: PROGRAM,
        version: package_version(root),
        json,
        streams: deps.streams,
        files,
        settings,
        registry: deps.registry,
        ...(backend === undefined ? { backend_problem: no_backend_message(id, deps.registry) } : { backend }),
        home: files.home,
        environment: deps.environment ?? {},
        claude_installed: deps.claude_installed ?? claude_on_path,
        async session(mode, ask) {
            const prompter = ask && mode === "text" && can_ask ? await deps.prompter!() : undefined;
            return make_session(mode, settings, prompter);
        },
    };
}

// =====================================================================================
// main
// =====================================================================================

/** Takes `--json` out of `argv`, before a `--`. */
export function strip_json(argv: readonly string[]): { json: boolean; words: string[] } {
    const escape = argv.indexOf("--");
    const head = escape === -1 ? argv : argv.slice(0, escape);
    const tail = escape === -1 ? [] : argv.slice(escape);
    const words = head.filter(word => word !== "--json");
    return { json: words.length !== head.length, words: [...words, ...tail] };
}

/** stricli's exit codes: its parse errors (negative) are input errors (2), as attach-cli's commander errors were. */
function exit_code(value: number | string | null | undefined): number {
    const code = typeof value === "string" ? Number.parseInt(value, 10) : value ?? EXIT_OK;
    if (Number.isNaN(code)) { return EXIT_CRASH; }
    // UnknownCommand (-5), InvalidArgument (-4); the rest (-1 to -3) are crashes in stricli.
    if (code === -5 || code === -4) { return EXIT_INPUT_ERROR; }
    return code < 0 ? EXIT_CRASH : code;
}

async function run_words(front: FrontEnd, words: readonly string[], usage_to_stderr: boolean): Promise<number> {
    const routes = build_routes(front);
    const application = build_application(routes, front);
    let code: number | undefined;
    const process_: { stdout: OutputStreams["stdout"]; stderr: OutputStreams["stderr"]; env: Environment; exitCode?: number | string | null } = {
        stdout: usage_to_stderr ? front.streams.stderr : front.streams.stdout,
        stderr: front.streams.stderr,
        env: {},
    };
    const context: RunContext = {
        process: process_,
        async execute(route, flags, arguments_) {
            const quiet = route.quiet_flag !== undefined && flags[route.quiet_flag] === true;
            const session = await front.session(front.json ? "json" : "text", route.asks && !quiet);
            code = await run_outcome(
                () => route.run({ positionals: positional_record(route.positionals, arguments_), flags }, session),
                { json: front.json, style: session.style, streams: front.streams },
            );
        },
    };
    await run_stricli(application, words, context);
    if (usage_to_stderr) { return EXIT_INPUT_ERROR; }
    return code ?? exit_code(process_.exitCode);
}

/** One run. Never throws: a crash is its message on stderr and exit 1. */
export async function main(argv: readonly string[], deps: MainDeps): Promise<number> {
    let root: string;
    try {
        root = deps.package_root ?? find_package_root();
    } catch (error) {
        deps.streams.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        return EXIT_CRASH;
    }

    // The shells' completion: silent whatever happens (COMPL-005).
    if (argv[0] === "__complete") {
        const words = argv[1] === "--" ? argv.slice(2) : argv.slice(1);
        try {
            const front = await open_front(deps, false, root);
            const session = await front.session("complete", false);
            const lines = await complete_words(front, build_routes(front), words.length === 0 ? [""] : words, session);
            if (lines.length > 0) { deps.streams.stdout.write(`${lines.join("\n")}\n`); }
        } catch {
            // No candidates.
        }
        return EXIT_OK;
    }

    const { json, words } = strip_json(argv);
    try {
        const front = await open_front(deps, json, root);
        const terminal = deps.tty.stdin && deps.tty.stdout && deps.prompter !== undefined;
        if (words.length === 0 && !json && terminal) {
            const session = await front.session("text", true);
            return await run_outcome(
                () => bare_run(front, () => open_front(deps, json, root)),
                { json: false, style: session.style, streams: deps.streams },
            );
        }
        // The usage: no command (off a terminal, or `--json` alone), or `--quiet` alone.
        if (words.length === 0 || (words.length === 1 && words[0] === "--quiet")) {
            return await run_words(front, [], json);
        }
        const help = words[0] === "help" ? [...words.slice(1), "--help"] : words;
        return await run_words(front, help, false);
    } catch (error) {
        deps.streams.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        return EXIT_CRASH;
    }
}

if (import.meta.vitest) {
    const { test, expect, describe, beforeEach, afterEach } = import.meta.vitest;
    const os = await import("node:os");
    const { capture_stream } = await import("./output");
    const { create_fake_backend } = await import("./testing/fake-backend");
    const { GROUP_DIRECTIVE, NOSPACE_DIRECTIVE, FILES_DIRECTIVE } = await import("./stubs");

    let base: string;
    let home: string;
    let cwd: string;
    let xdg: string;
    beforeEach(() => {
        base = fs.mkdtempSync(path.join(os.tmpdir(), "aa-main-"));
        home = path.join(base, "home");
        cwd = path.join(home, "project");
        xdg = path.join(base, "xdg");
        fs.mkdirSync(cwd, { recursive: true });
    });
    afterEach(() => { fs.rmSync(base, { recursive: true, force: true }); });

    const local_file = (): string => path.join(cwd, ".analog-attach", "config.json");
    const global_file = (): string => path.join(xdg, "analog-attach", "config.json");
    const write_local = (table: Record<string, unknown>): void => {
        fs.mkdirSync(path.dirname(local_file()), { recursive: true });
        fs.writeFileSync(local_file(), JSON.stringify(table));
    };
    const read_json = (file: string): unknown => JSON.parse(fs.readFileSync(file, "utf8"));

    /** A prompter that answers from a script, in order, and records the questions. */
    const scripted = (answers: unknown[]): Prompter & { asked: string[] } => {
        const asked: string[] = [];
        const next = <T>(message: string): Promise<T> => {
            asked.push(message);
            if (answers.length === 0) { return Promise.reject(new Error(`Unscripted question: ${message}`)); }
            return Promise.resolve(answers.shift() as T);
        };
        return {
            asked,
            select: question => next(question.message),
            input: question => next(question.message),
            confirm: question => next(question.message),
            checkbox: question => next(question.message),
            search: question => next(question.message),
        };
    };

    interface RunOptions {
        registry?: Registry;
        tty?: boolean;
        prompter?: Prompter;
        claude?: boolean;
        environment?: Environment;
    }
    const fakes = (): { registry: Registry; fake: ReturnType<typeof create_fake_backend> } => {
        const fake = create_fake_backend();
        const other = create_fake_backend({ id: "other", plain: true });
        return { fake, registry: { fake: () => Promise.resolve(fake.backend), other: () => Promise.resolve(other.backend) } };
    };
    const run = async (argv: readonly string[], options: RunOptions = {}): Promise<{ code: number; stdout: string; stderr: string }> => {
        const stdout = capture_stream(options.tty === true);
        const stderr = capture_stream(options.tty === true);
        const code = await main(argv, {
            registry: options.registry ?? fakes().registry,
            streams: { stdout, stderr },
            location: { cwd, home, xdg_config_home: xdg },
            tty: { stdin: options.tty === true, stdout: options.tty === true },
            environment: options.environment ?? {},
            ...(options.prompter === undefined ? {} : { prompter: () => options.prompter! }),
            claude_installed: () => options.claude ?? true,
        });
        return { code, stdout: stdout.text, stderr: stderr.text };
    };

    const code_of = async (argv: readonly string[], options?: RunOptions): Promise<number> => { const { code } = await run(argv, options); return code; };
    const stdout_of = async (argv: readonly string[], options?: RunOptions): Promise<string> => { const { stdout } = await run(argv, options); return stdout; };
    const stderr_of = async (argv: readonly string[], options?: RunOptions): Promise<string> => { const { stderr } = await run(argv, options); return stderr; };

    const complete = async (words: string[], options: RunOptions = {}): Promise<string[]> => {
        const { code, stdout, stderr } = await run(["__complete", "--", ...words], options);
        expect(code).toBe(0);
        expect(stderr).toBe("");
        return stdout === "" ? [] : stdout.trimEnd().split("\n");
    };
    const values = (lines: string[]): string[] => lines.filter(line => !line.startsWith("__ANALOG")).map(line => line.split("\t")[0]!);
    const with_skill = (): Registry => {
        const source = path.join(base, "skill-source");
        fs.mkdirSync(path.join(source, "references"), { recursive: true });
        fs.writeFileSync(path.join(source, "SKILL.md"), "# Fake\n");
        fs.writeFileSync(path.join(source, "references", "a.md"), "a\n");
        const fake = create_fake_backend({ skill_dir: source });
        return { fake: () => Promise.resolve(fake.backend) };
    };
    const installed = (): string => path.join(home, ".claude", "skills", "fake-skill");

    test("find_package_root - the package of this file, with its bundled directory", () => {
        const root = find_package_root();
        expect(read_json(path.join(root, "package.json"))).toMatchObject({ name: "@analog-attach/cli" });
        expect(assets_directory(root, "linux")).toBe(path.join(root, "bundled", "linux"));
    });

    test("strip_json - anywhere before a --", () => {
        expect(strip_json(["read", "--json", "spi0"])).toEqual({ json: true, words: ["read", "spi0"] });
        expect(strip_json(["--json", "list", "devices", "--json"])).toEqual({ json: true, words: ["list", "devices"] });
        expect(strip_json(["update", "x", "--", "--json"])).toEqual({ json: false, words: ["update", "x", "--", "--json"] });
    });

    describe("help", () => {
        test("shows the active backend's flags and extras, not another's", async () => {
            write_local({ backend: "fake" });
            const root = await run(["--help"]);
            expect(root.code).toBe(0);
            expect(root.stdout).toMatch(/^ {2}move /m);
            expect(root.stdout).toContain("Backend: fake (Fake devices (fake)). Another: 'analog-attach config backend other'.");
            const add = await run(["add", "--help"]);
            expect(add.stdout).toContain("--parent");
            expect(add.stdout).toContain("--name");
            const list = await run(["help", "list"]);
            expect(list.stdout).toContain("parent");

            write_local({ backend: "other" });
            const other = await run(["--help"]);
            expect(other.stdout).not.toMatch(/^ {2}move /m);
            expect(await stdout_of(["add", "--help"])).not.toContain("--parent");
            expect(await stdout_of(["list", "--help"])).not.toMatch(/\bparent\b/);
        });

        test("the root help names only the other registered backends, and none when there is no other", async () => {
            write_local({ backend: "fake" });
            const fake = create_fake_backend();
            const alone = await run(["--help"], { registry: { fake: () => Promise.resolve(fake.backend) } });
            expect(alone.stdout).toContain("Backend: fake (Fake devices (fake)).\n");
            expect(alone.stdout).not.toContain("Another");
            const third = create_fake_backend({ id: "third", plain: true });
            const many = await run(["--help"], { registry: { ...fakes().registry, third: () => Promise.resolve(third.backend) } });
            expect(many.stdout).toContain("Others: 'analog-attach config backend <other|third>'.");
        });

        test("the backend's placeholders", async () => {
            write_local({ backend: "fake" });
            expect(await stdout_of(["list", "devices", "--help"])).toContain("[<prefix>]");
        });

        test("off a terminal, the bare run and --quiet alone are the usage; under --json on stderr, exit 2", async () => {
            write_local({ backend: "fake" });
            const bare = await run([]);
            expect(bare.code).toBe(0);
            expect(bare.stdout).toContain("USAGE");
            expect(await stdout_of(["--quiet"])).toContain("USAGE");
            const json = await run(["--json"]);
            expect(json).toMatchObject({ code: 2, stdout: "" });
            expect(json.stderr).toContain("USAGE");
        });
    });

    describe("commands", () => {
        test("a backend command gets its arguments and flags; --json anywhere", async () => {
            write_local({ backend: "fake" });
            const text = await run(["build", "--board", "zed"]);
            expect(text).toEqual({ code: 0, stdout: `build {} {"board":"zed"}\n`, stderr: "" });
            const json = await run(["move", "--json", "spi0/adc@0", "spi1", "--dry-run"]);
            expect(json.code).toBe(0);
            expect(JSON.parse(json.stdout)).toMatchObject({ ok: true, arguments: { path: "spi0/adc@0", destination: "spi1" }, flags: { "dry-run": true } });
            const listed = await run(["list", "parent", "adi,ad7124-8", "--json"]);
            expect(JSON.parse(listed.stdout)).toMatchObject({ arguments: { device: "adi,ad7124-8" } });
        });

        test("each outcome's exit status", async () => {
            write_local({ backend: "fake" });
            expect(await code_of(["delete", "x"])).toBe(0);
            expect(await run(["rename", "a", "b"])).toEqual({ code: 2, stdout: "", stderr: "Bad name: b\n" });
            expect(await code_of(["update", "x"])).toBe(130);
            expect(await code_of(["validate"])).toBe(1);
        });

        test("a parse error is an input error: exit 2", async () => {
            write_local({ backend: "fake" });
            expect(await code_of(["rename", "only-one"])).toBe(2);
            expect(await code_of(["nonsense"])).toBe(2);
            expect(await code_of(["build", "--nope"])).toBe(2);
        });

        test("a shared command the backend leaves out: not supported, exit 2", async () => {
            write_local({ backend: "fake" });
            expect(await run(["deploy"])).toEqual({ code: 2, stdout: "", stderr: "deploy is not supported by the fake backend\n" });
            expect(await stdout_of(["--help"])).not.toMatch(/^ {2}deploy /m);
        });

        test("an extra of another backend is an unknown command", async () => {
            write_local({ backend: "other" });
            expect(await code_of(["move", "a", "b"])).toBe(2);
        });

        test("no backend, or one this build lacks: every command but config, completion, skill and help points to config backend", async () => {
            const unset = await run(["read"]);
            expect(unset).toEqual({ code: 2, stdout: "", stderr: "No backend is set. Run 'analog-attach' on a terminal, or 'analog-attach config backend <fake|other>'.\n" });
            write_local({ backend: "zephyr" });
            const unknown = await run(["list", "devices", "--json"]);
            expect(unknown.code).toBe(2);
            expect(unknown.stderr).toBe("Unknown backend: zephyr. Known backends: fake, other. Run 'analog-attach config backend <fake|other>'.\n");
            expect(await code_of(["--help"])).toBe(0);
            expect(await code_of(["completion", "bash"])).toBe(0);
            expect(await code_of(["config", "backend", "fake"])).toBe(0);
            expect(read_json(local_file())).toEqual({ backend: "fake" });
        });
    });

    describe("config", () => {
        test("set (local by default, --global), get, list", async () => {
            write_local({ backend: "fake" });
            const set = await run(["config", "syntax", "label"]);
            expect(set).toMatchObject({ code: 0, stderr: "" });
            expect(read_json(local_file())).toEqual({ backend: "fake", fake: { syntax: "label" } });
            expect(await code_of(["config", "chip", "c1", "--global"])).toBe(0);
            expect(read_json(global_file())).toEqual({ fake: { chip: "c1" } });

            const get = await run(["config", "syntax", "--json"]);
            expect(JSON.parse(get.stdout)).toMatchObject({ ok: true, configs: [{ field_name: "syntax", value: "label", source: "local" }] });
            const list = await run(["config", "--json"]);
            const keys = (JSON.parse(list.stdout) as { configs: { field_name: string }[] }).configs.map(entry => entry.field_name);
            expect(keys).toEqual(expect.arrayContaining(["backend", "tree", "modules", "syntax", "board", "chip"]));
            const text = await run(["config"]);
            expect(text.stdout).toContain("syntax");
            expect(text.stdout).toContain("label");
        });

        test("--reset removes the key", async () => {
            write_local({ backend: "fake", fake: { syntax: "label", chip: "c" } });
            const reset = await run(["config", "syntax", "--reset"]);
            expect(reset.code).toBe(0);
            expect(read_json(local_file())).toEqual({ backend: "fake", fake: { chip: "c" } });
        });

        test("a bad value or an unknown key: exit 2", async () => {
            write_local({ backend: "fake" });
            expect(await code_of(["config", "syntax", "nope"])).toBe(2);
            const unknown = await run(["config", "nope", "1"]);
            expect(unknown.code).toBe(2);
            expect(unknown.stderr).toContain("Unknown config field: nope");
        });

        test("the changed hook's outcome replaces the answer", async () => {
            const fake = create_fake_backend({
                changed: (keys, session) => Promise.resolve({ kind: "answer", response: { ok: true, message: `rebuilt for ${keys.join(",")}`, severity: "info" }, text: () => `Rebuilt (${session.mode})` }),
            });
            write_local({ backend: "fake" });
            const registry: Registry = { fake: () => Promise.resolve(fake.backend) };
            expect(await stdout_of(["config", "chip", "c2"], { registry })).toBe("Rebuilt (text)\n");
            expect(JSON.parse(await stdout_of(["config", "chip", "c3", "--json"], { registry }))).toMatchObject({ message: "rebuilt for chip" });
        });

        test("switching the backend keeps both sections; config shows only the active one's", async () => {
            write_local({ backend: "fake" });
            expect(await code_of(["config", "syntax", "label"])).toBe(0);
            expect(await code_of(["config", "backend", "other"])).toBe(0);
            const other = await run(["config", "--json"]);
            expect(other.code).toBe(0);
            const keys = (JSON.parse(other.stdout) as { configs: { field_name: string }[] }).configs.map(entry => entry.field_name);
            expect(keys).toEqual(["backend", "tree", "modules", "syntax", "board", "chip"]);
            const entries = (JSON.parse(other.stdout) as { configs: { field_name: string }[] }).configs;
            expect(entries.find(entry => entry.field_name === "syntax")).toMatchObject({ value: "fragment", source: "default" });
            expect(await code_of(["config", "syntax", "fragment"])).toBe(0);
            expect(read_json(local_file())).toEqual({ backend: "other", fake: { syntax: "label" }, other: { syntax: "fragment" } });
            expect(await code_of(["config", "backend", "fake"])).toBe(0);
            expect(JSON.parse(await stdout_of(["config", "syntax", "--json"]))).toMatchObject({ configs: [{ value: "label", source: "local" }] });
        });

        test("a check hook's also lands in the active section of the file written", async () => {
            write_local({ backend: "fake", other: { chip: "kept" } });
            expect(await stdout_of(["config", "board", "eval-a"])).toBe("Set board = eval-a (and chip = chip-a)\n");
            expect(read_json(local_file())).toEqual({ backend: "fake", fake: { board: "eval-a", chip: "chip-a" }, other: { chip: "kept" } });
            expect(await stdout_of(["config", "board", "eval-b", "--global"])).toBe("Set board = eval-b (global)\n");
            expect(read_json(global_file())).toEqual({ fake: { board: "eval-b", chip: "chip-b" } });
        });

        test("an unknown key: in the active section named with it, at the top level as itself; an inactive section's is no error", async () => {
            write_local({ backend: "fake", fake: { bogus: "x" }, other: { anything: "y" } });
            const section = await run(["config"]);
            expect(section).toMatchObject({ code: 2, stdout: "" });
            expect(section.stderr).toBe([
                "~/project/.analog-attach/config.json: unknown key fake.bogus",
                "",
                "Remove unknown keys from ~/project/.analog-attach/config.json; valid keys in fake are tree, modules, syntax, board, chip.",
                "",
            ].join("\n"));
            write_local({ backend: "fake", color: "blue", other: { anything: "y" } });
            const top = await run(["--json", "config"]);
            expect(top.code).toBe(2);
            expect(JSON.parse(top.stderr)).toEqual({
                errors: [{ field: "color", kind: "unknown", message: "~/project/.analog-attach/config.json: unknown key color", hint: "Remove unknown keys from ~/project/.analog-attach/config.json; valid top-level keys are backend and the backends' sections fake, other, each an object of that backend's settings." }],
                hints: ["Remove unknown keys from ~/project/.analog-attach/config.json; valid top-level keys are backend and the backends' sections fake, other, each an object of that backend's settings."],
            });
            write_local({ backend: "fake", other: { anything: "y" } });
            expect(await code_of(["config"])).toBe(0);
        });

        test("a section that isn't an object is an error, and isn't written into", async () => {
            write_local({ backend: "fake", fake: "label" });
            const shown = await run(["config"]);
            expect(shown.code).toBe(2);
            expect(shown.stderr).toContain("~/project/.analog-attach/config.json: fake: must be an object\n");
            const set = await run(["config", "syntax", "label"]);
            expect(set.code).toBe(2);
            expect(set.stderr).toContain("~/project/.analog-attach/config.json: fake: must be an object — Output syntax");
            expect(read_json(local_file())).toEqual({ backend: "fake", fake: "label" });
        });

        test("an old flat file fails with its keys, unknown at the top level", async () => {
            write_local({ backend: "fake", tree: "/t", syntax: "label" });
            const flat = await run(["config"]);
            expect(flat.code).toBe(2);
            expect(flat.stderr).toMatch(/^Configuration errors:\n {2}~\/project\/\.analog-attach\/config\.json: unknown key tree\n {2}~\/project\/\.analog-attach\/config\.json: unknown key syntax\n/);
            expect(flat.stderr).toContain("valid top-level keys are backend and the backends' sections fake, other");
        });

        test("with no backend set, the sections are kept and not checked", async () => {
            write_local({ fake: { bogus: 1 }, other: { syntax: "label" } });
            const shown = await run(["config", "--json"]);
            expect(shown.code).toBe(0);
            expect((JSON.parse(shown.stdout) as { configs: unknown[] }).configs).toHaveLength(1);
            expect(await code_of(["config", "backend", "other"])).toBe(0);
            expect(read_json(local_file())).toEqual({ backend: "other", fake: { bogus: 1 }, other: { syntax: "label" } });
            expect(JSON.parse(await stdout_of(["config", "syntax", "--json"]))).toMatchObject({ configs: [{ value: "label" }] });
        });

        test("--reload without a hook", async () => {
            write_local({ backend: "fake" });
            const reload = await run(["config", "--reload"]);
            expect(reload.code).toBe(0);
            expect(reload.stdout).toContain("Nothing to rebuild");
        });
    });

    describe("__complete", () => {

        test("command names, subcommands and flags of the active backend", async () => {
            write_local({ backend: "fake" });
            const top = values(await complete([""]));
            expect(top).toEqual(expect.arrayContaining(["config", "init", "add", "list", "move", "skill", "completion", "help"]));
            expect(top).not.toContain("deploy");
            expect(values(await complete(["list", ""]))).toEqual(["devices", "property", "value", "parent"]);
            expect(values(await complete(["add", "--"]))).toEqual(["--name", "--quiet", "--parent", "--json", "--help"]);
            expect(values(await complete(["--json", "add", "--"]))).toEqual(["--name", "--quiet", "--parent", "--help"]);
            write_local({ backend: "other" });
            expect(values(await complete([""]))).not.toContain("move");
        });

        test("config keys and values", async () => {
            write_local({ backend: "fake" });
            expect(values(await complete(["config", ""]))).toEqual(expect.arrayContaining(["backend", "tree", "syntax", "chip"]));
            expect(values(await complete(["config", "backend", ""]))).toEqual(["fake", "other"]);
            expect(values(await complete(["config", "syntax", ""]))).toEqual(["fragment", "label"]);
            expect(await complete(["config", "tree", ""])).toEqual([FILES_DIRECTIVE]);
        });

        test("positionals through backend.complete: groups, partial stems, the files fallback, flag values", async () => {
            const { fake, registry } = fakes();
            write_local({ backend: "fake" });
            expect(await complete(["read", "spi0/adc@0", ""], { registry })).toEqual([
                `${GROUP_DIRECTIVE}\tset`, "reg\trequired", "status", `${GROUP_DIRECTIVE}\tnot set`, "fan-\tchild node",
            ]);
            expect(fake.slots.at(-1)).toEqual({ kind: "property", command: "read", path: "spi0/adc@0" });
            expect(await complete(["read", "sp"], { registry })).toEqual([NOSPACE_DIRECTIVE, "spi0/", "spi1/"]);
            expect(await complete(["import", ""], { registry })).toEqual([FILES_DIRECTIVE, "rpi-ad7124.dtbo\toverlays/rpi-ad7124.dts"]);
            expect(await complete(["add", "--parent", "i"], { registry })).toEqual(["i2c1"]);
            expect(fake.slots.at(-1)).toEqual({ kind: "flag", command: "add", flag: "parent", prior: [] });
            expect(await complete(["move", "spi0/adc@0", ""], { registry })).toEqual(["destination-a"]);
            expect(await complete(["update", "spi0/adc@0", "reg", "1", ""], { registry })).toEqual(["0x10", "&vref"]);
            expect(fake.slots.at(-1)).toEqual({ kind: "value", command: "update", path: "spi0/adc@0", property: "reg", prior: ["1"] });
        });

        test("nothing for an unknown command or without a backend's source", async () => {
            expect(await complete(["read", ""])).toEqual([]);
            write_local({ backend: "fake" });
            expect(await complete(["nonsense", ""])).toEqual([]);
        });
    });

    describe("skill", () => {

        test("install copies the skill, refuses an installed one without --force", async () => {
            write_local({ backend: "fake" });
            const registry = with_skill();
            const first = await run(["skill", "install", "fake-skill"], { registry });
            expect(first.code).toBe(0);
            expect(first.stdout).toContain("Skill fake-skill installed successfully!");
            expect(fs.readFileSync(path.join(installed(), "references", "a.md"), "utf8")).toBe("a\n");
            const again = await run(["skill", "install", "fake-skill", "--json"], { registry });
            expect(JSON.parse(again.stdout)).toMatchObject({ ok: false, message: "Skill fake-skill is already installed. Use --force to overwrite." });
            expect(await code_of(["skill", "install", "fake-skill", "--force"], { registry })).toBe(0);
        });

        test("install refuses without Claude Code; uninstall removes it; an unknown name is an input error", async () => {
            write_local({ backend: "fake" });
            const registry = with_skill();
            expect(await stdout_of(["skill", "install", "fake-skill"], { registry, claude: false })).toContain("Claude Code is not installed.");
            expect(await code_of(["skill", "install", "nope"], { registry })).toBe(2);
            await run(["skill", "install", "fake-skill"], { registry });
            expect(await code_of(["skill", "uninstall", "fake-skill"], { registry })).toBe(0);
            expect(fs.existsSync(installed())).toBe(false);
            expect(await stdout_of(["skill", "uninstall", "fake-skill"], { registry })).toContain("is not installed");
        });
    });

    describe("the bare run on a terminal", () => {
        test("asks for the backend, saves it, runs setup, then init when ready", async () => {
            const fake = create_fake_backend({ setup: "ready" });
            const registry: Registry = { fake: () => Promise.resolve(fake.backend) };
            const tree = path.join(base, "tree");
            fs.mkdirSync(tree);
            const prompter = scripted(["fake", tree]);
            const result = await run([], { registry, tty: true, prompter });
            expect(prompter.asked).toEqual(["What does this project target?", "Source tree"]);
            expect(result.code).toBe(0);
            expect(result.stdout).toContain("Saved backend = fake to ~/project/.analog-attach/config.json.");
            expect(result.stdout).toContain("Saved tree.");
            expect(result.stdout).toMatch(/Created the workfile\n$/);
            expect(read_json(local_file())).toEqual({ backend: "fake", fake: { tree } });
        });

        test("a setup that isn't ready ends with its outcome; no setup lists the unset required settings", async () => {
            write_local({ backend: "fake" });
            const not_ready = create_fake_backend({ setup: "not-ready" });
            const first = await run([], { registry: { fake: () => Promise.resolve(not_ready.backend) }, tty: true, prompter: scripted([]) });
            expect(first).toMatchObject({ code: 0, stdout: "Nothing set up.\n" });
            const plain = create_fake_backend();
            const second = await run([], { registry: { fake: () => Promise.resolve(plain.backend) }, tty: true, prompter: scripted([]) });
            expect(second.stdout).toContain("needs these settings");
            expect(second.stdout).toContain("tree");
        });

        test("Ctrl-C at the backend question saves nothing: exit 130", async () => {
            const { PromptCancelled } = await import("../interface/backend-interface");
            const prompter = { ...scripted([]), select: () => Promise.reject(new PromptCancelled()) };
            const result = await run([], { tty: true, prompter });
            expect(result.code).toBe(130);
            expect(fs.existsSync(local_file())).toBe(false);
        });
    });
}
