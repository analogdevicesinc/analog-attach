// The `Session` every backend call gets: the program name, the mode, the settings, the
// state and asset directories, the prompter, styles, and the only ways a backend writes
// to the terminal (`say` on stdout, `warn` and `progress` on stderr).

import path from "node:path";
import type { Progress, Prompter, Render, Session, SettingsView, Style } from "../interface/backend-interface";
import { CONFIG_DIRECTORY } from "./settings-store";
import type { OutputStream, OutputStreams } from "./output";

const ESC = "\u001B[";

function sgr(open: number, close: number): (text: string) => string {
    return text => `${ESC}${open}m${text}${ESC}${close}m`;
}

const identity = (text: string): string => text;

/** ANSI styles when `enabled`, no-ops otherwise. */
export function create_style(enabled: boolean): Style {
    if (!enabled) { return { bold: identity, dim: identity, cyan: identity, red: identity, yellow: identity }; }
    return { bold: sgr(1, 22), dim: sgr(2, 22), cyan: sgr(36, 39), red: sgr(31, 39), yellow: sgr(33, 39) };
}

/** `<project root>/.analog-attach/<backend id>/`. Not created here: the backend creates it when it first writes. */
export function state_directory(project_root: string, backend_id: string): string {
    return path.join(project_root, CONFIG_DIRECTORY, backend_id);
}

const SILENT_PROGRESS: Progress = { update() {}, line() {}, done() {} };

/**
 * A long step on `stream`, modelled on attach-cli's `start_progress` (src/progress.ts). On a
 * TTY the label line is rewritten in place with the latest detail, a child's lines are
 * printed above it, and `done` replaces it with the summary. Otherwise the label, each
 * child line and the summary are printed as lines, and details are dropped.
 */
export function start_progress(label: string, stream: OutputStream): Progress {
    const tty = stream.isTTY === true;
    const clear = "\r\u001B[2K";
    let current = label;
    stream.write(tty ? label : `${label}\n`);
    return {
        update(detail) {
            current = `${label} ${detail}`;
            if (tty) { stream.write(`${clear}${current}`); }
        },
        line(text) {
            stream.write(tty ? `${clear}${text}\n${current}` : `${text}\n`);
        },
        done(summary) {
            if (tty) {
                stream.write(`${clear}${summary ?? label}\n`);
            } else if (summary !== undefined) {
                stream.write(`${summary}\n`);
            }
        },
    };
}

export interface SessionOptions {
    /** The name in hints: `analog-attach`. */
    program: string;
    mode: Session["mode"];
    cwd: string;
    /** The directory that holds `.analog-attach/` (`SettingsFiles.project_root`). */
    project_root: string;
    backend_id: string;
    assets_dir: string;
    settings: SettingsView;
    /** Undefined when nothing may be asked: `--json`, `--quiet`, not a terminal. */
    prompter?: Prompter;
    streams: OutputStreams;
    /** Aborted on Ctrl-C outside a prompt. A signal that never aborts by default. */
    signal?: AbortSignal;
    /** Colours; by default when stdout is a terminal. */
    color?: boolean;
}

export function create_session(options: SessionOptions): Session {
    const { streams, mode } = options;
    const style = create_style(options.color ?? streams.stdout.isTTY === true);
    const quiet = mode === "complete";
    const session: Session = {
        program: options.program,
        mode,
        cwd: options.cwd,
        settings: options.settings,
        state_dir: state_directory(options.project_root, options.backend_id),
        assets_dir: options.assets_dir,
        prompter: options.prompter,
        style,
        signal: options.signal ?? new AbortController().signal,
        say(line: string | Render) {
            if (session.prompter === undefined) {
                throw new Error("session.say needs a prompter: a run that can't ask prints only its outcome");
            }
            streams.stdout.write(`${typeof line === "string" ? line : line(style)}\n`);
        },
        warn(message) {
            if (!quiet) { streams.stderr.write(`${message}\n`); }
        },
        progress(label) {
            return quiet ? SILENT_PROGRESS : start_progress(label, streams.stderr);
        },
    };
    return session;
}

if (import.meta.vitest) {
    const { test, expect, describe } = import.meta.vitest;
    const { capture_stream } = await import("./output");
    const { open_settings, settings_files } = await import("./settings-store");

    const settings = open_settings({ files: settings_files({ cwd: "/nonexistent/p", home: "/nonexistent" }) });
    const prompter = {} as Prompter;
    const make = (overrides: Partial<SessionOptions> = {}): { session: Session; stdout: ReturnType<typeof capture_stream>; stderr: ReturnType<typeof capture_stream> } => {
        const stdout = capture_stream();
        const stderr = capture_stream();
        const session = create_session({
            program: "analog-attach", mode: "text", cwd: "/p/sub", project_root: "/p", backend_id: "fake", assets_dir: "/assets", settings,
            ...overrides,
            streams: { stdout, stderr },
        });
        return { session, stdout, stderr };
    };

    test("carries program, cwd, the backend's state dir and the assets dir", () => {
        const { session } = make();
        expect(session.program).toBe("analog-attach");
        expect(session.cwd).toBe("/p/sub");
        expect(session.state_dir).toBe("/p/.analog-attach/fake");
        expect(session.assets_dir).toBe("/assets");
        expect(session.signal.aborted).toBe(false);
        expect(session.settings).toBe(settings);
    });

    describe("say", () => {
        test("throws without a prompter", () => {
            const { session, stdout } = make();
            expect(() => { session.say("Added adc@0"); }).toThrow(/needs a prompter/);
            expect(stdout.text).toBe("");
        });

        test("writes to stdout at once with a prompter, a Render with the session's style", () => {
            const { session, stdout } = make({ prompter, color: true });
            session.say("Added adc@0");
            session.say(style => style.cyan("x"));
            expect(stdout.text).toBe("Added adc@0\n\u001B[36mx\u001B[39m\n");
        });
    });

    test("warn - one line on stderr in text and json modes, nothing in complete mode", () => {
        for (const mode of ["text", "json"] as const) {
            const { session, stdout, stderr } = make({ mode });
            session.warn("Parent: spi (use --parent to choose another)");
            expect(stderr.text).toBe("Parent: spi (use --parent to choose another)\n");
            expect(stdout.text).toBe("");
        }
        const { session, stderr } = make({ mode: "complete" });
        session.warn("x");
        session.progress("Building").done("Built");
        expect(stderr.text).toBe("");
    });

    test("style - colours only when stdout is a TTY", () => {
        const plain = make().session.style;
        expect(plain.bold("x")).toBe("x");
        expect(plain.red("x")).toBe("x");
        const tty = create_session({
            program: "p", mode: "text", cwd: "/", project_root: "/", backend_id: "f", assets_dir: "/", settings,
            streams: { stdout: capture_stream(true), stderr: capture_stream() },
        });
        expect(tty.style.bold("x")).toBe("\u001B[1mx\u001B[22m");
        expect(tty.style.yellow("x")).toBe("\u001B[33mx\u001B[39m");
    });

    describe("progress", () => {
        test("a TTY rewrites one line, prints a child's lines above it, then replaces it", () => {
            const stream = capture_stream(true);
            const progress = start_progress("Building caches...", stream);
            progress.update("1/3");
            progress.line("cmake: configuring");
            progress.done("Built in 1.0s");
            expect(stream.text).toBe(
                "Building caches..."
                + "\r\u001B[2KBuilding caches... 1/3"
                + "\r\u001B[2Kcmake: configuring\nBuilding caches... 1/3"
                + "\r\u001B[2KBuilt in 1.0s\n",
            );
        });

        test("not a TTY: the label, the child's lines and the summary only", () => {
            const stream = capture_stream(false);
            const progress = start_progress("Building caches...", stream);
            progress.update("1/3");
            progress.line("cmake: configuring");
            progress.done("Built in 1.0s");
            expect(stream.text).toBe("Building caches...\ncmake: configuring\nBuilt in 1.0s\n");
            const bare = capture_stream(false);
            start_progress("Step", bare).done();
            expect(bare.text).toBe("Step\n");
        });

        test("the session's progress writes to stderr", () => {
            const { session, stdout, stderr } = make();
            session.progress("Step").done("Done");
            expect(stderr.text).toBe("Step\nDone\n");
            expect(stdout.text).toBe("");
        });
    });
}
