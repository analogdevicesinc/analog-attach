/** Running a command for a backend, its output passed on line by line (through `session.progress`). */

import { spawn, type ChildProcessByStdio } from "node:child_process";
import path from "node:path";
import type { Readable } from "node:stream";

import type { Session } from "../interface/backend-interface";

/** The directory that holds `.analog-attach/`, where a backend runs the user's commands: the state directory is `<root>/.analog-attach/<id>`. */
export function project_root(session: Pick<Session, "state_dir">): string {
    return path.dirname(path.dirname(session.state_dir));
}

export type CommandResult = { exit_code: number };

/** Where a child's output goes, line by line, and what stops it. */
export interface OutputSink {
    line(text: string): void;
    readonly signal?: AbortSignal;
}

/** Run a command, its output (stdout and stderr, as they come) passed on line by line. */
export function run(command: string, arguments_: string[], cwd: string, sink: OutputSink, environment?: NodeJS.ProcessEnv): Promise<CommandResult> {
    return watch(spawn(command, arguments_, {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        ...(environment === undefined ? {} : { env: environment }),
        ...(sink.signal === undefined ? {} : { signal: sink.signal }),
    }), sink);
}

/** Run a shell string, for a `build-command` / `deploy-command` override. */
export function run_shell(command: string, cwd: string, sink: OutputSink): Promise<CommandResult> {
    return watch(spawn(command, [], {
        cwd,
        shell: true,
        stdio: ["ignore", "pipe", "pipe"],
        ...(sink.signal === undefined ? {} : { signal: sink.signal }),
    }), sink);
}

function watch(child: ChildProcessByStdio<null, Readable, Readable>, sink: OutputSink): Promise<CommandResult> {
    return new Promise((resolve) => {
        const pending = { stdout: "", stderr: "" };
        const pass = (stream: "stdout" | "stderr") => (chunk: Buffer) => {
            const lines = (pending[stream] + chunk.toString("utf8")).split(/\r?\n/);
            pending[stream] = lines.pop() ?? "";
            for (const line of lines) {
                sink.line(line);
            }
        };
        child.stdout.on("data", pass("stdout"));
        child.stderr.on("data", pass("stderr"));
        child.on("close", (code) => {
            for (const rest of [pending.stdout, pending.stderr]) {
                if (rest !== "") {
                    sink.line(rest);
                }
            }
            resolve({ exit_code: code ?? 1 });
        });
        child.on("error", () => { resolve({ exit_code: 1 }); });
    });
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    test("run_shell - passes each line on and gives the exit status", async () => {
        const lines: string[] = [];
        const result = await run_shell("echo one; echo two >&2; exit 3", ".", { line: text => { lines.push(text); } });
        expect(result.exit_code).toBe(3);
        expect(lines.toSorted()).toEqual(["one", "two"]);
    });
}
