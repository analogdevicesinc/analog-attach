// The chat's Codex CLI provider (assistant.mjs): for each message of the page's chat, the server
// runs OpenAI's Codex CLI headless (`codex exec --json`) in the project folder and turns its
// events (JSON Lines: thread.started, item.started / item.completed of a command_execution or an
// agent_message, turn.completed, turn.failed, error) into the chat's own as they come.
//
// Codex has no allowlist of commands: what limits it is its sandbox alone, `workspace-write` in
// the project folder (it may write there and in the temporary folder, and read anywhere), with
// the network on (`sandbox_workspace_write.network_access`: deploy reaches the board), and with
// no approvals (`approval_policy=never`: what the sandbox refuses fails at once, never waiting
// for a person). The system prompt (`developer_instructions`) asks it for
// `analog-attach` commands only; the `analog-attach` it runs is the GUI's own CLI, through a
// small script put first on its PATH (agent.mjs). The message goes on its standard input, so
// one that starts with `-` stays a message. One conversation per project folder: the first
// message starts it, the next ones continue it (`codex exec resume <thread>`).
//
// It uses the user's own Codex CLI and its login; the `analog-attach-<backend>` skill
// (`analog-attach skill install --agent codex`, in ~/.agents/skills) teaches it the CLI.

import { agent_command, create_shim, run_agent, version_status } from "./agent.mjs";

/**
 * Codex's arguments for one message (read from its standard input, `-`): `session`, when given,
 * the thread it continues. The options come before `resume`, where the sandbox's must be.
 */
export function codex_args({ folder, system, session }) {
	return [
		"exec", "--json", "--color", "never", "--skip-git-repo-check",
		"--sandbox", "workspace-write", "--cd", folder,
		"-c", "approval_policy=\"never\"",
		// A TOML string: JSON's escapes are TOML's.
		"-c", `developer_instructions=${JSON.stringify(system)}`,
		// Deploy copies the overlay to the board: the sandbox's network is off by default.
		"-c", "sandbox_workspace_write.network_access=true",
		...(session === undefined ? [] : ["resume", session]),
		"-",
	];
}

/** A command as Codex ran it (`/bin/bash -lc 'analog-attach list'`), as the chat shows it: the shell's script. */
export function shown_command(command) {
	const script = /^(?:\S*\/)?(?:ba|z)?sh -l?c (?:'((?:[^']|'\\'')*)'|"((?:[^"\\]|\\.)*)"|(\S+))$/.exec(String(command));
	if (script === null) return String(command);
	if (script[1] !== undefined) return script[1].replace(/'\\''/g, "'");
	if (script[2] !== undefined) return script[2].replace(/\\(.)/g, "$1");
	return script[3];
}

/**
 * The translation of one answer's events: `translate(event)` turns one of Codex's into the
 * chat's, to `emit`; `on_session` gets the thread to continue next time. `finish()` ends the
 * answer when Codex said nothing of how it ended (an `error` alone).
 */
export function codex_translator(emit, on_session, started = Date.now()) {
	const commands = new Set(); // the commands shown, by item id
	let ended = false;
	let problem;
	const seconds = () => (Date.now() - started) / 1000;
	const command = item => {
		if (commands.has(item.id)) return;
		commands.add(item.id);
		emit({ type: "command", id: item.id, command: shown_command(item.command) });
	};
	function translate(event) {
		const item = event.item ?? {};
		if (event.type === "thread.started" && typeof event.thread_id === "string") {
			on_session(event.thread_id);
		} else if (event.type === "item.started" && item.type === "command_execution") {
			command(item);
		} else if (event.type === "item.completed" && item.type === "command_execution") {
			command(item);
			const refused = item.status === "declined";
			emit({ type: "output", id: item.id, output: String(item.aggregated_output ?? ""), failed: refused || item.status === "failed" || (item.exit_code ?? 0) !== 0, refused });
		} else if (event.type === "item.completed" && item.type === "agent_message") {
			emit({ type: "turn" });
			emit({ type: "text", text: String(item.text ?? "") });
		} else if (event.type === "item.completed" && item.type === "file_change") {
			// Told not to, it edited files anyway: the chat shows which.
			const changes = (item.changes ?? []).map(change => `${change.kind} ${change.path}`).join(", ");
			emit({ type: "command", id: item.id, command: `(file change) ${changes}` });
			emit({ type: "output", id: item.id, output: changes, failed: item.status === "failed", refused: false });
		} else if (event.type === "turn.completed") {
			ended = true;
			emit({ type: "result", ok: true, seconds: seconds() });
		} else if (event.type === "turn.failed") {
			ended = true;
			emit({ type: "result", ok: false, error: String(event.error?.message ?? "The turn failed"), seconds: seconds() });
		} else if (event.type === "error") {
			problem = String(event.message ?? "");
		}
	}
	function finish() {
		if (!ended && problem) emit({ type: "result", ok: false, error: problem, seconds: seconds() });
	}
	return { translate, finish };
}

/**
 * The Codex CLI provider. `cli` is the command that runs the GUI's CLI (as start_gui has it);
 * `codex` the Codex command (default `codex`, or $ANALOG_ATTACH_CODEX).
 */
export function create_codex({ cli, codex = agent_command("ANALOG_ATTACH_CODEX", "codex") }) {
	const shim = create_shim(cli, "codex");
	const sessions = new Map(); // project folder -> Codex's thread id

	/** Whether Codex is there: { available, version }. */
	function status() {
		return version_status({ words: codex, executable: "codex", name: "Codex CLI", named: /codex/i });
	}

	/**
	 * Answer one message: Codex's events, as the chat's, to `emit` as they come. `system` is the
	 * developer instructions; `signal` stops it. Resolves with Codex's exit: { code, stderr }.
	 */
	async function answer({ folder, message, system, emit, signal }) {
		const translator = codex_translator(emit, thread => sessions.set(folder, thread));
		const exit = await run_agent({
			words: codex,
			args: codex_args({ folder, system, session: sessions.get(folder) }),
			folder,
			env: shim.env(),
			input: message,
			signal,
			emit,
			on_event: translator.translate,
		});
		translator.finish();
		return exit;
	}

	/** Forget the project's conversation: the next message starts a new one. */
	function reset(folder) {
		sessions.delete(folder);
	}

	return { status, answer, reset, close: shim.close };
}
