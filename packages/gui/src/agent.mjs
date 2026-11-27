// What the chat's agent executables share (assistant.mjs): Claude Code (claude.mjs), Codex CLI
// (codex.mjs) and Gemini CLI (gemini.mjs), each run headless in the project folder for one
// message, its JSON events read line by line as they come and turned into the chat's own.
//
// Each gets the GUI's own CLI as `analog-attach`: a small script of that name in a folder put
// first on its PATH (`create_shim`). Each is found by its command, or by the variable that
// names another (the tests use stand-ins): $ANALOG_ATTACH_CLAUDE, $ANALOG_ATTACH_CODEX,
// $ANALOG_ATTACH_GEMINI.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** A word for sh: quoted, so a path with spaces or quotes stays one word. */
export const sh_quote = word => `'${String(word).replace(/'/g, "'\\''")}'`;

/** The words of an agent's command: $<variable> when set (`node fake.mjs`), else `fallback`. */
export function agent_command(variable, fallback) {
	return (process.env[variable] ?? fallback).split(" ").filter(word => word !== "");
}

/**
 * A folder with `analog-attach`, the GUI's own CLI, to put first on an agent's PATH: { dir,
 * env(), close() }. Only for a CLI given by its path (`analog-attach gui`): a bare
 * `analog-attach` (the server run on its own) is the one on PATH already, and a script of that
 * name calling it would call itself; `dir` is then undefined.
 */
export function create_shim(cli, tag) {
	const dir = path.isAbsolute(cli[0] ?? "") ? fs.mkdtempSync(path.join(os.tmpdir(), `aa-gui-${tag}-`)) : undefined;
	if (dir !== undefined) {
		fs.writeFileSync(path.join(dir, "analog-attach"), `#!/bin/sh\nexec ${cli.map(sh_quote).join(" ")} "$@"\n`, { mode: 0o755 });
	}
	return {
		dir,
		/** The agent's environment: the server's, the shim first on PATH, no colours. */
		env: () => ({ ...process.env, ...(dir === undefined ? {} : { PATH: `${dir}${path.delimiter}${process.env.PATH ?? ""}` }), NO_COLOR: "1" }),
		close() {
			if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true });
		},
	};
}

/**
 * Whether the agent is there (`<command> --version` runs): { available, version } or
 * { available: false, problem }. `executable` is its command's usual name (codex), `name`
 * the agent's (Codex CLI), `named` tells a version that names it already (`2.1.3 (Claude
 * Code)`).
 */
export function version_status({ words, executable, name, named }) {
	const [command, ...prefix] = words;
	const shown = `<code>${executable}</code>`;
	return new Promise(resolve => {
		const child = spawn(command, [...prefix, "--version"], { stdio: ["ignore", "pipe", "ignore"] });
		let out = "";
		child.stdout.on("data", chunk => { out += chunk; });
		child.on("error", () => resolve({ available: false, problem: `${name} isn't installed (no ${shown} command).` }));
		child.on("close", code => resolve(code === 0
			? { available: true, version: named.test(out) ? out.trim() : `${name} ${out.trim()}` }
			: { available: false, problem: `${name} doesn't run (${shown} <code>--version</code> failed).` }));
	});
}

/**
 * Run an agent for one message: `words` its command, `args` after them, in `folder` with `env`.
 * `input`, when given, is written to its standard input (else it has none). Each line it prints
 * that is JSON goes to `on_event`, any other to the chat as text; `signal` stops it. Resolves
 * with its exit: { code, stderr }.
 */
export function run_agent({ words, args, folder, env, input, signal, on_event, emit }) {
	const [command, ...prefix] = words;
	return new Promise(resolve => {
		const child = spawn(command, [...prefix, ...args], { cwd: folder, stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"], env });
		if (input !== undefined) {
			// An agent that ends before reading it all: not an error of the GUI's.
			child.stdin.on("error", () => {});
			child.stdin.end(input);
		}
		const stop = () => { if (child.exitCode === null) child.kill("SIGTERM"); };
		signal.addEventListener("abort", stop, { once: true });
		let pending = "";
		let stderr = "";
		const line = text => {
			if (text.trim() === "") return;
			let event;
			try {
				event = JSON.parse(text);
			} catch {
				// Not JSON: shown as it is.
				emit({ type: "text", text: `${text}\n` });
				return;
			}
			on_event(event);
		};
		child.stdout.on("data", chunk => {
			pending += chunk;
			const lines = pending.split("\n");
			pending = lines.pop() ?? "";
			for (const text of lines) line(text);
		});
		child.stderr.on("data", chunk => { stderr += chunk; });
		let ended = false;
		const done = code => {
			if (ended) return;
			ended = true;
			signal.removeEventListener("abort", stop);
			line(pending);
			resolve({ code, stderr: stderr.trim() });
		};
		child.on("error", error => { stderr += String(error); done(-1); });
		child.on("close", code => done(code));
	});
}
