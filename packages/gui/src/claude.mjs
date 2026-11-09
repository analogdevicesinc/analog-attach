// The GUI's chat with Claude: the server runs Claude Code headless (`claude -p`) in the project
// folder, for each message of the page's chat, and streams its events to the page.
//
// Claude may run `analog-attach` commands and nothing else: `--allowedTools
// "Bash(analog-attach:*)"` with `--permission-mode dontAsk`, which refuses any other tool at
// once rather than waiting for an approval nobody can give. The `analog-attach` it runs is the
// GUI's own CLI, through a small script put first on its PATH. One conversation per project
// folder: the first message starts it, the next ones continue it (`--resume`).
//
// It uses the user's own Claude Code and its login; the `analog-attach-<backend>` skill
// (`analog-attach skill install`) is what teaches it the CLI.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** What Claude may run, and may not even then (a server it would wait on forever). */
const ALLOWED = ["Bash(analog-attach:*)"];
const DISALLOWED = ["Bash(analog-attach gui:*)"];
const MAX_MESSAGE = 20_000;

/** A word for sh: quoted, so a path with spaces or quotes stays one word. */
const sh_quote = word => `'${String(word).replace(/'/g, "'\\''")}'`;

/**
 * The chat's side of the server. `cli` is the command that runs the GUI's CLI (as start_gui
 * has it); `claude` the Claude Code command (default `claude`, or $ANALOG_ATTACH_CLAUDE).
 */
export function create_chat({ cli, claude = (process.env.ANALOG_ATTACH_CLAUDE ?? "claude").split(" ").filter(word => word !== "") }) {
	// A folder with `analog-attach`, first on Claude's PATH: the GUI's own CLI. Only for a CLI
	// given by its path (`analog-attach gui`): a bare `analog-attach` (the server run on its own)
	// is the one on PATH already, and a script of that name calling it would call itself.
	const shim = path.isAbsolute(cli[0] ?? "") ? fs.mkdtempSync(path.join(os.tmpdir(), "aa-gui-claude-")) : undefined;
	if (shim !== undefined) {
		fs.writeFileSync(path.join(shim, "analog-attach"), `#!/bin/sh\nexec ${cli.map(sh_quote).join(" ")} "$@"\n`, { mode: 0o755 });
	}
	const sessions = new Map(); // project folder -> Claude's session id
	let running;               // the child of the message being answered, if any

	const [command, ...prefix] = claude;

	/** Whether Claude Code is there: { available, version }. */
	function status() {
		return new Promise(resolve => {
			const child = spawn(command, [...prefix, "--version"], { stdio: ["ignore", "pipe", "ignore"] });
			let out = "";
			child.stdout.on("data", chunk => { out += chunk; });
			child.on("error", () => resolve({ available: false }));
			child.on("close", code => resolve(code === 0 ? { available: true, version: out.trim() } : { available: false }));
		});
	}

	/** The system prompt's addition: where Claude is, and how to behave there. */
	function context_prompt(folder, context) {
		return [
			"You are the assistant in the chat panel of the analog-attach GUI. The user sees their project beside this chat;",
			`the project folder is ${folder}, and you work in it. Do what the user asks by running analog-attach commands, and`,
			"only those: no other tool or command is allowed. Add --json to every command whose answer you read, and check ok.",
			"After each command that changes the project, the GUI refreshes its view of it.",
			"Before anything destructive (delete --force, a reset, overwriting), say what it will do and ask the user first.",
			"Never run analog-attach alone or analog-attach gui: they wait for a person at a terminal, or forever.",
			"Keep replies short. When a command gives wiring instructions, show them to the user exactly.",
			typeof context === "string" ? context.slice(0, 4000) : "",
		].join(" ");
	}

	/**
	 * Answer one message: Claude's events (stream-json, one JSON object per line) written to
	 * `response` as they come, then a last line `{"type":"gui_done","code":...}`.
	 */
	function answer(folder, message, context, response) {
		if (typeof message !== "string" || message.trim() === "" || message.length > MAX_MESSAGE) {
			response.writeHead(400, { "content-type": "application/json" });
			response.end(JSON.stringify({ error: `a message is text, at most ${MAX_MESSAGE} characters` }));
			return;
		}
		if (running !== undefined) {
			response.writeHead(409, { "content-type": "application/json" });
			response.end(JSON.stringify({ error: "Claude is still answering: stop it, or wait" }));
			return;
		}
		const session = sessions.get(folder);
		const args = [
			...prefix, "-p", message, "--output-format", "stream-json", "--verbose", "--include-partial-messages",
			"--permission-mode", "dontAsk", "--allowedTools", ...ALLOWED, "--disallowedTools", ...DISALLOWED,
			"--append-system-prompt", context_prompt(folder, context),
			...(session === undefined ? [] : ["--resume", session]),
		];
		const child = spawn(command, args, {
			cwd: folder,
			stdio: ["ignore", "pipe", "pipe"],
			env: { ...process.env, ...(shim === undefined ? {} : { PATH: `${shim}${path.delimiter}${process.env.PATH ?? ""}` }), NO_COLOR: "1" },
		});
		running = child;
		response.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" });
		let pending = "";
		let stderr = "";
		child.stdout.on("data", chunk => {
			pending += chunk;
			const lines = pending.split("\n");
			pending = lines.pop() ?? "";
			for (const line of lines) {
				if (line.trim() === "") continue;
				// The session to continue next time: from Claude's own init event.
				try {
					const event = JSON.parse(line);
					if (event.type === "system" && event.subtype === "init" && typeof event.session_id === "string") sessions.set(folder, event.session_id);
				} catch {
					// Not JSON: passed on as is; the page shows what it can't read.
				}
				response.write(`${line}\n`);
			}
		});
		child.stderr.on("data", chunk => { stderr += chunk; });
		const done = code => {
			if (running === child) running = undefined;
			if (pending.trim() !== "") response.write(`${pending}\n`);
			response.end(`${JSON.stringify({ type: "gui_done", code, stderr: stderr.trim().slice(-2000) })}\n`);
		};
		child.on("error", error => { stderr += String(error); done(-1); });
		child.on("close", code => done(code));
		// The page went away (closed, reloaded): stop answering it.
		response.on("close", () => { if (child.exitCode === null) child.kill("SIGTERM"); });
	}

	/** Stop the message being answered: true when one was. */
	function stop() {
		if (running === undefined) return false;
		running.kill("SIGTERM");
		return true;
	}

	/** Forget the project's conversation: the next message starts a new one. */
	function reset(folder) {
		sessions.delete(folder);
	}

	function close() {
		stop();
		if (shim !== undefined) fs.rmSync(shim, { recursive: true, force: true });
	}

	return { status, answer, stop, reset, close };
}
