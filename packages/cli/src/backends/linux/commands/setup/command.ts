// The Linux backend's `setup`: what the bare `analog-attach` on a terminal asks once the
// backend is chosen. As the noos setup does, it walks the Linux tree, the base devicetree
// and the workfile, skipping a setting that is set and valid, and saves each answer as it
// is given, so a stopped run keeps what was answered. Then it builds the binding caches
// when they aren't current. The workfile itself is left to `init`, which the front end
// runs next when the response is `ready`.

import * as fs from "node:fs";
import * as os from "node:os";
import path from "node:path";

import { answer, cancelled, input_error, PromptCancelled, refuse, type InteractiveSession, type Outcome } from "../../../../interface/backend-interface";
import type { SetupResponse } from "../../../../interface/backend-responses";
import { ensure_caches, type EnsureResult, type StartProgress } from "../../config/rebuild";
import { read_settings, type ConfigResult, type Settings } from "../../config/settings";
import { format_config_errors, linux_tree_problem, workspace_context, type WorkspaceContext } from "../../config/workspace";
import { step_context, step_linux, step_overlay, type SetupPlace } from "../../setup";
import { creation_problem } from "../../workfile";
import { format_summary, type Summary } from "../init/command";

export type Ensure = (settings: Settings, context: WorkspaceContext, start_progress: StartProgress) => Promise<ConfigResult<EnsureResult>>;

export interface SetupOptions {
    /** Where Linux trees are looked for. Default: the home directory. */
    home?: string;
    /** Builds the binding caches unless they are current; replaced in tests. */
    ensure?: Ensure;
}

/** Why a configured path can't be kept: the Linux tree, or the base devicetree file. */
function tree_problem(linux: string): string | undefined {
    return linux_tree_problem(linux) === undefined ? undefined : "which is not a Linux source tree";
}

function file_problem(file: string): string | undefined {
    const stat = fs.statSync(file, { throwIfNoEntry: false });
    if (stat === undefined) { return "which does not exist"; }
    return stat.isFile() ? undefined : "which is not a file";
}

/** The run's lines and what it saved: a skipped setting is one `✓` line, an asked one its step and then a blank line. */
class SetupRun {
    readonly saved: string[] = [];
    private after_skip = false;

    constructor(readonly session: InteractiveSession, readonly place: SetupPlace) {}

    /**
     * The setting `key`: kept when it is set and `problem` finds nothing, else asked
     * with `ask` and saved at once. undefined when the save is refused.
     */
    async ensure(key: "linux" | "devicetree", current: string | undefined, problem: (value: string) => string | undefined, ask: () => Promise<string>): Promise<{ ok: true; value: string } | { ok: false; outcome: Outcome<never> }> {
        const { style } = this.session;
        const found = current === undefined ? undefined : problem(current);
        if (current !== undefined && found === undefined) {
            this.skip(key, current);
            return { ok: true, value: current };
        }
        this.start_step();
        if (current !== undefined) { this.session.say(style.yellow(`${key} is ${current}, ${found}.`)); this.session.say(""); }
        const value = await ask();
        return this.save(key, value);
    }

    /** One skipped setting: `✓ <key>: <value>`. */
    skip(key: string, value: string): void {
        this.session.say(`${this.session.style.cyan("✓")} ${key}: ${value}`);
        this.after_skip = true;
    }

    /** Before the questions of a step: a blank line after skipped settings. */
    start_step(): void {
        if (this.after_skip) { this.session.say(""); }
        this.after_skip = false;
    }

    /** Write the answer through the checks `config` makes, then `✓ <key> = <value>` and a blank line. */
    async save(key: string, value: string): Promise<{ ok: true; value: string } | { ok: false; outcome: Outcome<never> }> {
        const written = await this.session.settings.set(key, value);
        if (!written.ok) { return { ok: false, outcome: input_error(written.message) }; }
        this.saved.push(key);
        this.session.say(`${this.session.style.cyan("✓")} ${key} = ${value}`);
        this.session.say("");
        return { ok: true, value };
    }

    /** After the last step: a blank line when it was skipped. */
    end(): void { this.start_step(); }
}

/** The header, before the first step. */
function say_header(session: InteractiveSession): void {
    const title = `${session.program} setup`;
    for (const line of ["", session.style.bold(title), "=".repeat(title.length), "", "This sets up the workspace: a Linux kernel source tree, a base device tree and the overlay file.", ""]) {
        session.say(line);
    }
}

/** The steps: what is set, and whether `init` should run (the workfile exists, or the user wants it created). */
async function run_steps(run: SetupRun): Promise<{ ok: true; linux: string; devicetree: string; workfile: string; create: boolean } | { ok: false; outcome: Outcome<never> }> {
    const { session, place } = run;
    const current = read_settings(session.settings);

    const linux = await run.ensure("linux", current.linux, tree_problem, () => step_linux(session, place));
    if (!linux.ok) { return linux; }
    const devicetree = await run.ensure("devicetree", current.devicetree, file_problem, () => step_context(session, place, linux.value));
    if (!devicetree.ok) { return devicetree; }

    if (current.workfile === undefined) {
        // A new name: init creates it, nothing more to ask.
        run.start_step();
        const filename = await step_overlay(session, place);
        const saved = await run.save("workfile", path.resolve(session.cwd, filename));
        if (!saved.ok) { return saved; }
        return { ok: true, linux: linux.value, devicetree: devicetree.value, workfile: saved.value, create: true };
    }

    const workfile = current.workfile;
    const shown = path.relative(session.cwd, workfile).startsWith("..") ? workfile : path.relative(session.cwd, workfile);
    run.skip("workfile", workfile);
    const exists = fs.statSync(workfile, { throwIfNoEntry: false })?.isFile() === true;
    // A file init can't create (its directory is gone) gets no question: the summary says what to do.
    const create = exists || (creation_problem(workfile) === undefined
        && await session.prompter.confirm({ message: `Create ${shown}?`, default: true }));
    run.end();
    return { ok: true, linux: linux.value, devicetree: devicetree.value, workfile, create };
}

/**
 * `Backend.setup`: walk the steps, saving each answer, then build the caches.
 * Stopping a question (Ctrl-C, Ctrl-D) keeps what was answered: exit 130.
 */
export function create_setup(options: SetupOptions = {}): (session: InteractiveSession) => Promise<Outcome<SetupResponse>> {
    return async session => {
        const run = new SetupRun(session, { cwd: session.cwd, home: options.home ?? os.homedir() });
        say_header(session);
        let steps: Awaited<ReturnType<typeof run_steps>>;
        try {
            steps = await run_steps(run);
        } catch (error) {
            if (error instanceof PromptCancelled) {
                return cancelled(`Stopped. What was answered is saved; run ${session.program} again to go on.`);
            }
            throw error;
        }
        if (!steps.ok) { return steps.outcome; }

        const ensure = options.ensure ?? ensure_caches;
        const ensured = await ensure(read_settings(session.settings), workspace_context(session), label => session.progress(label));
        if (!ensured.ok || !ensured.value.ok) {
            const reason = ensured.ok ? ensured.value.message : format_config_errors(ensured.errors, session.program).human;
            return refuse(`${reason}\nFix the problem, then run '${session.program} config --reload' to build the binding caches and '${session.program} init' to create the workfile.`);
        }
        const indexed = ensured.value.rebuilt;
        // After the cache build's progress line.
        if (indexed) { session.say(""); }

        const { saved } = run;
        const response: SetupResponse = {
            ok: true,
            message: `${saved.length === 0 ? "Every setting was already set" : `Saved ${saved.join(", ")}`}; the binding caches are ${indexed ? "built" : "current"}`,
            severity: "info",
            saved,
            ready: steps.create,
        };
        if (steps.create) { return answer(response, ""); }
        // Not created: the summary makes `init` the first next step.
        const summary: Summary = { linux: steps.linux, devicetree: steps.devicetree, overlay: steps.workfile, state: "not created yet", indexed };
        return answer(response, style => `${format_summary(summary, style, session.program).join("\n")}\n`);
    };
}

export const setup = create_setup();

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;
    const { open_settings, settings_files } = await import("../../../../front/settings-store");
    const { create_session } = await import("../../../../front/session");
    const { capture_stream } = await import("../../../../front/output");
    const { SETTINGS } = await import("../../config/settings");
    const { outcome_json, outcome_text } = await import("../../testing/outcome");
    const { scripted } = await import("../../testing/fixture");

    /** A directory with a Linux tree skeleton, a base .dts and a workspace directory, and a terminal session there answering `answers`. */
    const workspace = (answers: (paths: { linux: string; root: string }) => unknown[] = () => []) => {
        const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "attach-setup-")));
        const linux = path.join(root, "linux");
        fs.mkdirSync(path.join(linux, "Documentation", "devicetree", "bindings"), { recursive: true });
        fs.mkdirSync(path.join(linux, "include"));
        const dts = path.join(root, "base.dts");
        fs.writeFileSync(dts, "/dts-v1/;\n/ {\n};\n");
        const work = path.join(root, "work");
        fs.mkdirSync(work);
        const settings = open_settings({ files: settings_files({ cwd: work, home: path.join(root, "home") }), active: { id: "linux", specs: SETTINGS } });
        const stdout = capture_stream();
        const prompter = scripted(answers({ linux, root }));
        const session = create_session({
            program: "aa", mode: "text", cwd: work, project_root: work, backend_id: "linux", assets_dir: path.join(root, "assets"), settings,
            streams: { stdout, stderr: capture_stream() }, prompter,
        }) as InteractiveSession;
        return { root, linux, dts, work, settings, session, prompter, stdout, done: () => { fs.rmSync(root, { recursive: true }); } };
    };
    const built: Ensure = () => Promise.resolve({ ok: true, value: { ok: true, rebuilt: true, message: "built" } });
    const current: Ensure = () => Promise.resolve({ ok: true, value: { ok: true, rebuilt: false, message: "current" } });

    test("setup — with nothing set, asks the three steps and saves each answer; init then creates the workfile", async () => {
        const { root, linux, dts, work, settings, session, prompter, done } = workspace(({ linux }) => [linux, "manual", "../base.dts", "mine"]);
        try {
            const outcome = await create_setup({ home: root, ensure: built })(session);
            expect(prompter.asked).toEqual(["Linux source tree", "Choose how to select the base .dts file", "Path to .dts file", "Overlay file name"]);
            expect(await outcome_json(outcome)).toEqual({
                ok: true, message: "Saved linux, devicetree, workfile; the binding caches are built", severity: "info",
                saved: ["linux", "devicetree", "workfile"], ready: true,
            });
            expect(outcome_text(outcome)).toBe("");
            expect(fs.existsSync(path.join(work, "mine.dtso"))).toBe(false);
            expect([settings.get("linux"), settings.get("devicetree"), settings.get("workfile")]).toEqual([linux, dts, path.join(work, "mine.dtso")]);
        } finally {
            done();
        }
    });

    test("setup — a set and valid setting is skipped; an existing workfile asks nothing and is ready", async () => {
        const { root, linux, dts, work, settings, session, prompter, stdout, done } = workspace();
        try {
            const kept = path.join(work, "overlay.dtso");
            fs.writeFileSync(kept, "/dts-v1/;\n/plugin/;\n/ {\n};\n");
            for (const [key, value] of [["linux", linux], ["devicetree", dts], ["workfile", kept]] as const) { await settings.set(key, value); }
            const outcome = await create_setup({ home: root, ensure: current })(session);
            expect(prompter.asked).toEqual([]);
            expect(await outcome_json(outcome)).toMatchObject({ saved: [], ready: true, message: "Every setting was already set; the binding caches are current" });
            expect(stdout.text).toContain(`✓ linux: ${linux}\n✓ devicetree: ${dts}\n✓ workfile: ${kept}\n`);
        } finally {
            done();
        }
    });

    test("setup — a configured workfile not created yet: Create? asked, and no leaves it to init", async () => {
        const { root, linux, dts, work, settings, session, prompter, done } = workspace(() => [false]);
        try {
            for (const [key, value] of [["linux", linux], ["devicetree", dts], ["workfile", path.join(work, "overlay.dtso")]] as const) { await settings.set(key, value); }
            const outcome = await create_setup({ home: root, ensure: current })(session);
            expect(prompter.asked).toEqual(["Create overlay.dtso?"]);
            expect(await outcome_json(outcome)).toMatchObject({ ready: false });
            expect(outcome_text(outcome)).toContain("Workspace configured");
            expect(outcome_text(outcome)).toContain("aa init");
            expect(fs.existsSync(path.join(work, "overlay.dtso"))).toBe(false);
        } finally {
            done();
        }
    });

    test("setup — a configured tree that isn't one is named and asked again", async () => {
        const { root, linux, dts, settings, session, prompter, stdout, done } = workspace(({ linux }) => [linux, false]);
        try {
            // The store checks only that the path exists; it is the setup that wants a Linux tree.
            for (const [key, value] of [["linux", root], ["devicetree", dts], ["workfile", path.join(root, "work", "o.dtso")]] as const) { await settings.set(key, value); }
            await create_setup({ home: root, ensure: current })(session);
            expect(prompter.asked[0]).toBe("Linux source tree");
            expect(stdout.text).toContain(`linux is ${root}, which is not a Linux source tree.`);
            expect(settings.get("linux")).toBe(linux);
        } finally {
            done();
        }
    });

    test("setup — stopped at the base, the tree is kept: exit 130", async () => {
        const { root, linux, settings, session, done } = workspace(({ linux }) => [linux]);
        try {
            const outcome = await create_setup({ home: root, ensure: built })(session);
            expect(outcome.kind).toBe("cancelled");
            expect(outcome_text(outcome)).toBe("Stopped. What was answered is saved; run aa again to go on.");
            expect(settings.get("linux")).toBe(linux);
            expect(settings.get("devicetree")).toBeUndefined();
        } finally {
            done();
        }
    });

    test("setup — a failed cache build refuses and keeps the saved settings", async () => {
        const { root, linux, work, settings, session, done } = workspace(({ linux }) => [linux, "manual", "../base.dts", "overlay"]);
        try {
            const failing: Ensure = () => Promise.resolve({ ok: true, value: { ok: false, rebuilt: true, message: "Compiling binding schemas failed:\nbad binding" } });
            const outcome = await create_setup({ home: root, ensure: failing })(session);
            expect(outcome.kind).toBe("refused");
            expect(outcome_text(outcome)).toBe("Compiling binding schemas failed:\nbad binding\nFix the problem, then run 'aa config --reload' to build the binding caches and 'aa init' to create the workfile.");
            expect(fs.existsSync(path.join(work, "overlay.dtso"))).toBe(false);
            expect(settings.get("workfile")).toBe(path.join(work, "overlay.dtso"));
        } finally {
            done();
        }
    });
}
