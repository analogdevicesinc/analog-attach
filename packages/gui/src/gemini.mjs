// The chat's Gemini CLI provider (assistant.mjs): for each message of the page's chat, the server
// runs Google's Gemini CLI headless (`gemini --prompt … --output-format stream-json`) in the
// project folder and turns its events (JSON Lines: init, message, tool_use, tool_result, error,
// result) into the chat's own as they come.
//
// Gemini may run `analog-attach` commands and nothing else: a policy file of the GUI's
// (`--policy`, its policy engine's rules) allows its shell tool for `analog-attach …` alone, and
// its skills (`activate_skill`), denies `analog-attach gui` (a server it would wait on forever)
// and every other tool. Headless, a tool its policy would ask about is refused at once. The
// `analog-attach` it runs is the GUI's own CLI, through a small script put first on its PATH
// (agent.mjs). Gemini has no flag to add to its system prompt: the GUI's instructions go before
// the message. One conversation per project folder: the first message starts it, the next ones
// continue it (`--resume <session>`).
//
// It uses the user's own Gemini CLI and its login; the `analog-attach-<backend>` skill
// (`analog-attach skill install --agent gemini`, in ~/.gemini/skills) teaches it the CLI.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { agent_command, create_shim, run_agent, version_status } from "./agent.mjs";

/** The GUI's policy for Gemini: the highest priority that matches a call decides. */
export const POLICY = `# The analog-attach GUI's chat: analog-attach commands only.
[[rule]]
toolName = "run_shell_command"
commandPrefix = "analog-attach gui"
decision = "deny"
priority = 950
denyMessage = "analog-attach gui is the GUI this chat is in."

[[rule]]
toolName = "run_shell_command"
commandPrefix = "analog-attach "
decision = "allow"
priority = 900

[[rule]]
toolName = "activate_skill"
decision = "allow"
priority = 900

[[rule]]
toolName = "*"
decision = "deny"
priority = 100
denyMessage = "In the analog-attach GUI's chat only analog-attach commands are allowed."
`;

/** What Gemini is asked: the GUI's instructions, then the user's message. */
export function gemini_prompt(system, message) {
	return `The analog-attach GUI's instructions: ${system}\n\nThe user's message:\n${message}`;
}

/** Gemini's arguments for one message: `session`, when given, the conversation it continues. */
export function gemini_args({ message, system, session, policy }) {
	return [
		// One word, so that a message that starts with `-` stays the prompt.
		`--prompt=${gemini_prompt(system, message)}`, "--output-format", "stream-json",
		"--approval-mode", "default", "--policy", policy,
		...(session === undefined ? [] : ["--resume", session]),
	];
}

/** A tool call as the chat shows it: the shell's command, or the tool and its parameters. */
const shown_call = event => (event.tool_name === "run_shell_command" && typeof event.parameters?.command === "string"
	? event.parameters.command
	: `${event.tool_name} ${JSON.stringify(event.parameters ?? {})}`);

/**
 * The translation of one answer's events: `translate(event)` turns one of Gemini's into the
 * chat's, to `emit`; `on_session` gets the session to continue next time. Gemini says nothing
 * of a new reply: one starts with its first text after a command.
 */
export function gemini_translator(emit, on_session) {
	let replying = false;
	function translate(event) {
		if (event.type === "init" && typeof event.session_id === "string") {
			on_session(event.session_id);
		} else if (event.type === "message" && event.role === "assistant") {
			if (!replying) emit({ type: "turn" });
			replying = true;
			emit({ type: "text", text: String(event.content ?? "") });
		} else if (event.type === "tool_use") {
			replying = false;
			emit({ type: "command", id: event.tool_id, command: shown_call(event) });
		} else if (event.type === "tool_result") {
			replying = false;
			const failed = event.status === "error";
			const output = String(event.output ?? event.error?.message ?? "");
			const refused = failed && (event.error?.type === "policy_violation" || /denied by policy|requires user confirmation/i.test(event.error?.message ?? ""));
			emit({ type: "output", id: event.tool_id, output, failed, refused });
		} else if (event.type === "result") {
			emit({
				type: "result",
				ok: event.status === "success",
				...(event.error?.message ? { error: String(event.error.message) } : {}),
				...(typeof event.stats?.duration_ms === "number" ? { seconds: event.stats.duration_ms / 1000 } : {}),
			});
		}
	}
	return { translate };
}

/**
 * The Gemini CLI provider. `cli` is the command that runs the GUI's CLI (as start_gui has it);
 * `gemini` the Gemini command (default `gemini`, or $ANALOG_ATTACH_GEMINI).
 */
export function create_gemini({ cli, gemini = agent_command("ANALOG_ATTACH_GEMINI", "gemini") }) {
	const shim = create_shim(cli, "gemini");
	// The policy beside the shim (or in a folder of its own, with no shim).
	const folder_of_policy = shim.dir ?? fs.mkdtempSync(path.join(os.tmpdir(), "aa-gui-gemini-"));
	const policy = path.join(folder_of_policy, "analog-attach-gui.toml");
	fs.writeFileSync(policy, POLICY);
	const sessions = new Map(); // project folder -> Gemini's session id

	/** Whether Gemini is there: { available, version }. */
	function status() {
		return version_status({ words: gemini, executable: "gemini", name: "Gemini CLI", named: /gemini/i });
	}

	/**
	 * Answer one message: Gemini's events, as the chat's, to `emit` as they come. `system` is the
	 * GUI's instructions; `signal` stops it. Resolves with Gemini's exit: { code, stderr }.
	 */
	function answer({ folder, message, system, emit, signal }) {
		const translator = gemini_translator(emit, session => sessions.set(folder, session));
		return run_agent({
			words: gemini,
			args: gemini_args({ message, system, session: sessions.get(folder), policy }),
			folder,
			env: shim.env(),
			signal,
			emit,
			on_event: translator.translate,
		});
	}

	/** Forget the project's conversation: the next message starts a new one. */
	function reset(folder) {
		sessions.delete(folder);
	}

	function close() {
		shim.close();
		fs.rmSync(folder_of_policy, { recursive: true, force: true });
	}

	return { status, answer, reset, close };
}
