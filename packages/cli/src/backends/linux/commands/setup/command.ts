// The Linux backend's `setup`: what the bare `analog-attach` on a terminal asks once the
// backend is chosen. It asks for the Linux tree, the base devicetree and the workfile's
// name, saves them and builds the binding caches when they aren't current. The workfile
// itself is left to `init`, which the front end runs next when the response is `ready`.

import * as fs from "node:fs";
import * as os from "node:os";
import path from "node:path";

import { answer, cancelled, input_error, PromptCancelled, refuse, type InteractiveSession, type Outcome, type Session } from "../../../../interface/backend-interface";
import type { SetupResponse } from "../../../../interface/backend-responses";
import { ensure_caches, type EnsureResult, type StartProgress } from "../../config/rebuild";
import { read_settings, type ConfigResult, type Settings } from "../../config/settings";
import { format_config_errors, workspace_context, type WorkspaceContext } from "../../config/workspace";
import { step_context, step_linux, step_overlay, type SetupPlace } from "../../setup";
import { creation_problem, type OverlayChoice } from "../../workfile";
import { format_summary, type Summary } from "../init/command";

/** What the setup run is going to set up, every part checked. */
export interface SetupPlan {
    linux: string;
    devicetree: string;
    overlay: OverlayChoice;
}

export type Ensure = (settings: Settings, context: WorkspaceContext, start_progress: StartProgress) => Promise<ConfigResult<EnsureResult>>;

export interface SetupOptions {
    /** Where Linux trees are looked for. Default: the home directory. */
    home?: string;
    /** Builds the binding caches unless they are current; replaced in tests. */
    ensure?: Ensure;
}

/** The settings the setup run writes, in order. */
const SAVED = ["linux", "devicetree", "workfile"] as const;

/** `.analog-attach/config.json` when the file is under the session's directory, else its absolute path. */
function shown_file(file: string, cwd: string): string {
    const relative = path.relative(cwd, file);
    return relative.startsWith("..") || path.isAbsolute(relative) ? file : relative;
}

/**
 * Save linux, devicetree and the workfile's name, then build the binding caches
 * when they are not current. The workfile itself is left to `init`. What was
 * saved stays when the build fails.
 */
export async function execute_setup(plan: SetupPlan, session: Session, ensure: Ensure = ensure_caches): Promise<Outcome<SetupResponse>> {
    const workfile = plan.overlay.kind === "keep" ? plan.overlay.path : path.resolve(session.cwd, plan.overlay.filename);
    const values: Record<typeof SAVED[number], string> = { linux: plan.linux, devicetree: plan.devicetree, workfile };
    let file: string | undefined;
    for (const key of SAVED) {
        const written = await session.settings.set(key, values[key]);
        if (!written.ok) { return input_error(written.message); }
        file = written.file;
    }
    if (session.prompter !== undefined) {
        session.say(`Saved ${SAVED.slice(0, -1).join(", ")} and ${SAVED.at(-1)!} to ${session.style.cyan(shown_file(file!, session.cwd))}.`);
        session.say("");
    }

    const ensured = await ensure(read_settings(session.settings), workspace_context(session), label => session.progress(label));
    if (!ensured.ok || !ensured.value.ok) {
        const reason = ensured.ok ? ensured.value.message : format_config_errors(ensured.errors, session.program).human;
        return refuse(`${reason}\nFix the problem, then run '${session.program} config --reload' to build the binding caches and '${session.program} init' to create the workfile.`);
    }
    const indexed = ensured.value.rebuilt;
    // After the cache build's progress line.
    if (indexed && session.prompter !== undefined) { session.say(""); }

    const exists = fs.statSync(workfile, { throwIfNoEntry: false })?.isFile() === true;
    // `init` keeps an existing workfile, or creates it where it can.
    const ready = exists || creation_problem(workfile) === undefined;
    const summary: Summary = { linux: plan.linux, devicetree: plan.devicetree, overlay: workfile, state: exists ? "kept" : "not created yet", indexed };
    const response: SetupResponse = {
        ok: true,
        message: `Saved ${SAVED.join(", ")}; the binding caches are ${indexed ? "built" : "current"}`,
        severity: "info",
        saved: [...SAVED],
        ready,
    };
    // When ready, `init` runs next and its summary ends the run.
    return answer(response, ready ? "" : style => `${format_summary(summary, style, session.program).join("\n")}\n`);
}

/** The three steps, the current values as the Enter defaults. */
async function ask_plan(session: InteractiveSession, place: SetupPlace): Promise<SetupPlan> {
    const settings = read_settings(session.settings);
    const say = (line: string): void => { session.say(line); };
    const title = `${session.program} setup`;
    say("");
    say(session.style.bold(title));
    say("=".repeat(title.length));
    say("");
    say("This sets up the workspace: a Linux kernel source tree, a base device tree and the overlay file.");
    say("");
    const linux = await step_linux(session, place, settings.linux);
    say("");
    const devicetree = await step_context(session, place, linux, settings.devicetree);
    say("");
    const overlay = await step_overlay(session, place, settings.workfile);
    say("");
    return { linux, devicetree, overlay };
}

/** `Backend.setup`: ask, save, build the caches. Stopping a question (Ctrl-C, Ctrl-D) saves nothing: exit 130. */
export function create_setup(options: SetupOptions = {}): (session: InteractiveSession) => Promise<Outcome<SetupResponse>> {
    return async session => {
        let plan: SetupPlan;
        try {
            plan = await ask_plan(session, { cwd: session.cwd, home: options.home ?? os.homedir() });
        } catch (error) {
            if (error instanceof PromptCancelled) { return cancelled("Setup cancelled."); }
            throw error;
        }
        return execute_setup(plan, session, options.ensure);
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

    /** A directory with a Linux tree skeleton, a base .dts and a workspace directory, and a session there. */
    const workspace = () => {
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
        const session = create_session({
            program: "aa", mode: "text", cwd: work, project_root: work, backend_id: "linux", assets_dir: path.join(root, "assets"), settings,
            streams: { stdout, stderr: capture_stream() },
        });
        return { root, linux, dts, work, settings, session, done: () => { fs.rmSync(root, { recursive: true }); } };
    };
    const build = (): Promise<ConfigResult<EnsureResult>> => Promise.resolve({ ok: true, value: { ok: true, rebuilt: true, message: "built" } });
    const built: Ensure = build;

    test("execute_setup — saves the settings with the workfile's name and builds the caches, creating no workfile", async () => {
        const { linux, dts, work, settings, session, done } = workspace();
        try {
            const outcome = await execute_setup({ linux, devicetree: dts, overlay: { kind: "create", filename: "mine.dtso" } }, session, built);
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

    test("execute_setup — keeping the workfile leaves the file, and current caches aren't rebuilt", async () => {
        const { linux, dts, work, session, done } = workspace();
        try {
            const kept = path.join(work, "overlay.dtso");
            fs.writeFileSync(kept, "/dts-v1/;\n/plugin/;\n/ {\n};\n// mine\n");
            const current: Ensure = () => Promise.resolve({ ok: true, value: { ok: true, rebuilt: false, message: "current" } });
            const outcome = await execute_setup({ linux, devicetree: dts, overlay: { kind: "keep", path: kept } }, session, current);
            expect(await outcome_json(outcome)).toMatchObject({ ready: true, message: "Saved linux, devicetree, workfile; the binding caches are current" });
            expect(fs.readFileSync(kept, "utf8")).toContain("// mine");
        } finally {
            done();
        }
    });

    test("execute_setup — a failed cache build refuses and keeps the saved settings", async () => {
        const { linux, dts, work, settings, session, done } = workspace();
        try {
            const failing: Ensure = () => Promise.resolve({ ok: true, value: { ok: false, rebuilt: true, message: "Compiling binding schemas failed:\nbad binding" } });
            const outcome = await execute_setup({ linux, devicetree: dts, overlay: { kind: "create", filename: "overlay.dtso" } }, session, failing);
            expect(outcome.kind).toBe("refused");
            expect(outcome_text(outcome)).toBe("Compiling binding schemas failed:\nbad binding\nFix the problem, then run 'aa config --reload' to build the binding caches and 'aa init' to create the workfile.");
            expect(fs.existsSync(path.join(work, "overlay.dtso"))).toBe(false);
            expect(settings.get("workfile")).toBe(path.join(work, "overlay.dtso"));
        } finally {
            done();
        }
    });

    test("execute_setup — a workfile init couldn't create is not ready: the summary says what to do", async () => {
        const { linux, dts, session, done } = workspace();
        try {
            // A kept path whose directory is gone: the setting checks it, so the plan names a file in a directory that exists, then the directory goes.
            const directory = path.join(path.dirname(dts), "gone");
            fs.mkdirSync(directory);
            const outcome = await execute_setup({ linux, devicetree: dts, overlay: { kind: "keep", path: path.join(directory, "x.dtso") } }, session, () => {
                fs.rmSync(directory, { recursive: true });
                return build();
            });
            expect(await outcome_json(outcome)).toMatchObject({ ready: false });
            expect(outcome_text(outcome)).toContain("Workspace configured");
            expect(outcome_text(outcome)).toContain("aa init");
        } finally {
            done();
        }
    });
}
