// The chat's Claude Code provider (assistant.mjs): for each message of the page's chat, the
// server runs Claude Code headless (`claude -p`) in the project folder and turns its events
// (stream-json) into the chat's own (assistant.mjs) as they come.
//
// Claude may run `analog-attach` commands and nothing else: `--allowedTools
// "Bash(analog-attach:*)"` with `--permission-mode dontAsk`, which refuses any other tool at
// once rather than waiting for an approval nobody can give. The `analog-attach` it runs is the
// GUI's own CLI, through a small script put first on its PATH (agent.mjs). One conversation per
// project folder: the first message starts it, the next ones continue it (`--resume`).
//
// It uses the user's own Claude Code and its login; the `analog-attach-<backend>` skill
// (`analog-attach skill install`) is what teaches it the CLI.

import { agent_command, create_shim, run_agent, version_status } from "./agent.mjs";

/** What Claude may run, and may not even then (a server it would wait on forever). */
const ALLOWED = ["Bash(analog-attach:*)"];
const DISALLOWED = ["Bash(analog-attach gui:*)"];

/** A tool result's text: a string, or the text of its pieces. */
const result_text = content => (typeof content === "string" ? content : (content ?? []).map(piece => piece.text ?? "").join("\n"));

/** Claude's arguments for one message: `session`, when given, the conversation it continues. */
export function claude_args({ message, system, session }) {
	return [
		"-p", message, "--output-format", "stream-json", "--verbose", "--include-partial-messages",
		"--permission-mode", "dontAsk", "--allowedTools", ...ALLOWED, "--disallowedTools", ...DISALLOWED,
		"--append-system-prompt", system,
		...(session === undefined ? [] : ["--resume", session]),
	];
}

/**
 * One of Claude's events as the chat's (assistant.mjs), to `emit`; `on_session` gets the
 * session to continue next time, from Claude's init event.
 */
export function translate_claude(event, emit, on_session) {
	if (event.type === "system" && event.subtype === "init" && typeof event.session_id === "string") {
		on_session(event.session_id);
	} else if (event.type === "stream_event" && event.event?.type === "message_start") {
		emit({ type: "turn" });
	} else if (event.type === "stream_event" && event.event?.delta?.type === "text_delta") {
		emit({ type: "text", text: event.event.delta.text });
	} else if (event.type === "assistant") {
		for (const block of event.message?.content ?? []) {
			if (block.type === "tool_use") emit({ type: "command", id: block.id, command: block.input?.command ?? JSON.stringify(block.input) });
		}
	} else if (event.type === "user") {
		for (const block of event.message?.content ?? []) {
			if (block.type !== "tool_result") continue;
			const output = result_text(block.content);
			const refused = block.is_error === true && /denied|don't ask mode/i.test(output);
			emit({ type: "output", id: block.tool_use_id, output, failed: block.is_error === true, refused });
		}
	} else if (event.type === "result") {
		emit({
			type: "result",
			ok: event.is_error !== true,
			...(event.is_error && event.result ? { error: String(event.result) } : {}),
			...(typeof event.duration_ms === "number" ? { seconds: event.duration_ms / 1000 } : {}),
			...(typeof event.total_cost_usd === "number" ? { cost_usd: event.total_cost_usd } : {}),
		});
	}
}

/**
 * The Claude Code provider. `cli` is the command that runs the GUI's CLI (as start_gui has it);
 * `claude` the Claude Code command (default `claude`, or $ANALOG_ATTACH_CLAUDE).
 */
export function create_claude({ cli, claude = agent_command("ANALOG_ATTACH_CLAUDE", "claude") }) {
	const shim = create_shim(cli, "claude");
	const sessions = new Map(); // project folder -> Claude's session id

	/** Whether Claude Code is there: { available, version }. */
	function status() {
		return version_status({ words: claude, executable: "claude", name: "Claude Code", named: /claude code/i });
	}

	/**
	 * Answer one message: Claude's events, as the chat's, to `emit` as they come. `system` is the
	 * system prompt's addition; `signal` stops it. Resolves with Claude's exit: { code, stderr }.
	 */
	function answer({ folder, message, system, emit, signal }) {
		return run_agent({
			words: claude,
			args: claude_args({ message, system, session: sessions.get(folder) }),
			folder,
			env: shim.env(),
			signal,
			emit,
			on_event: event => translate_claude(event, emit, session => sessions.set(folder, session)),
		});
	}

	/** Forget the project's conversation: the next message starts a new one. */
	function reset(folder) {
		sessions.delete(folder);
	}

	return { status, answer, reset, close: shim.close };
}
