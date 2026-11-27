/** Running a command for a backend, its output passed on line by line (through `session.progress`). */

import { spawn, type ChildProcessByStdio } from "node:child_process";
import path from "node:path";
import type { Readable } from "node:stream";

import type { Session } from "../interface/backend-interface";

/** The directory that holds `.analog-attach/`, where a backend runs the user's commands: the state directory is `<root>/.analog-attach/<id>`. */
export function project_root(session: Pick<Session, "state_dir">): string {
	return path.dirname(path.dirname(session.state_dir));
}

export type CommandResult = {
	exit_code: number;
	/** Why the child couldn't start or was stopped (`spawn ./aa_build.sh EACCES`, an abort); its exit_code is then 1. */
	error?: string;
};

/** Where a child's output goes, line by line (and from which of its streams), and what stops it. */
export interface OutputSink {
	line(text: string, stream: "stdout" | "stderr"): void;
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
export function run_shell(command: string, cwd: string, sink: OutputSink, environment?: NodeJS.ProcessEnv): Promise<CommandResult> {
	return watch(spawn(command, [], {
		cwd,
		shell: true,
		stdio: ["ignore", "pipe", "pipe"],
		...(environment === undefined ? {} : { env: environment }),
		...(sink.signal === undefined ? {} : { signal: sink.signal }),
	}), sink);
}

function watch(child: ChildProcessByStdio<null, Readable, Readable>, sink: OutputSink): Promise<CommandResult> {
	return new Promise(resolve => {
		const pending = { stdout: "", stderr: "" };
		const pass = (stream: "stdout" | "stderr") => (chunk: Buffer) => {
			const lines = (pending[stream] + chunk.toString("utf8")).split(/\r?\n/);
			pending[stream] = lines.pop() ?? "";
			for (const line of lines) {
				sink.line(line, stream);
			}
		};
		child.stdout.on("data", pass("stdout"));
		child.stderr.on("data", pass("stderr"));
		child.on("close", code => {
			for (const stream of ["stdout", "stderr"] as const) {
				if (pending[stream] !== "") {
					sink.line(pending[stream], stream);
				}
			}
			resolve({ exit_code: code ?? 1 });
		});
		// Before `close`, which then resolves nothing more.
		child.on("error", error => { resolve({ exit_code: 1, error: error.message }); });
	});
}

if (import.meta.vitest) {
	const { test, expect } = import.meta.vitest;

	test("run_shell - passes each line on, with its stream, and gives the exit status", async () => {
		const lines: string[] = [];
		const result = await run_shell("echo one; echo two >&2; printf three; exit 3", ".", { line: (text, stream) => { lines.push(`${stream}:${text}`); } });
		expect(result).toEqual({ exit_code: 3 });
		expect(lines.toSorted()).toEqual(["stderr:two", "stdout:one", "stdout:three"]);
	});

	test("run - a child that can't start gives why", async () => {
		const result = await run("/nonexistent/analog-attach-test", [], ".", { line: () => {} });
		expect(result.exit_code).toBe(1);
		expect(result.error).toContain("ENOENT");
	});
}
