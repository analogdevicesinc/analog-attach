// The chat's server side: the ✦ Assistant panel of the page (core/chat.mjs) sends a message, and
// a model answers it by running `analog-attach` commands in the project, and nothing else. The
// providers that answer are an executable, an agent of the user's run headless (agent.mjs), its
// skill (`analog-attach skill install --agent <agent>`) teaching it the CLI:
//
//   claude   Claude Code (claude.mjs): analog-attach commands only, by its allowlist.
//   codex    Codex CLI (codex.mjs): no allowlist; its sandbox, the project folder, is its limit.
//   gemini   Gemini CLI (gemini.mjs): analog-attach commands only, by a policy of the GUI's.
//
// or a server:
//
//   openai   any model behind an OpenAI-compatible Chat Completions endpoint (llm.mjs): OpenAI,
//            Ollama, LM Studio, vLLM, OpenRouter, …; the server runs the conversation, and puts
//            the part's skill (its SKILL.md) in the system prompt.
//
// Which one, the executable kept for when the server isn't (`agent`), and the endpoint's URL,
// model and API key: the environment's when the GUI starts ($ANALOG_ATTACH_CHAT_PROVIDER,
// $ANALOG_ATTACH_LLM_URL, $ANALOG_ATTACH_LLM_MODEL, $ANALOG_ATTACH_LLM_API_KEY), each overridden
// by what Preferences set, kept in the user's `~/.config/analog-attach/gui-chat.json` (the
// user's alone: never the project's). The API key never goes back to the page.
//
// Whichever answers, the page gets the same events, a JSON object per line:
//   {"type":"turn"}                                   a new reply of the model starts
//   {"type":"text","text":…}                          its text, a piece at a time
//   {"type":"command","id":…,"command":…}            a command it runs
//   {"type":"output","id":…,"output":…,"failed":b,"refused":b}   what the command answered
//   {"type":"result","ok":b,"error"?,"seconds"?,"cost_usd"?}     the end of the answer
//   {"type":"gui_done","code":n,"stderr":…}          the last line: 0, or what went wrong

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { create_claude } from "./claude.mjs";
import { create_codex } from "./codex.mjs";
import { create_gemini } from "./gemini.mjs";
import { create_llm } from "./llm.mjs";

export const PROVIDERS = { claude: "Claude Code", codex: "Codex CLI", gemini: "Gemini CLI", openai: "OpenAI-compatible" };
/** The providers that are an executable (the others are a server). */
export const AGENTS = ["claude", "codex", "gemini"];
const MAX_MESSAGE = 20_000;
/** The system prompt's words on what the model may run, by provider. */
const ONLY = {
	claude: "only those: no other tool or command is allowed.",
	// Codex's sandbox would let it run more: the prompt is what keeps it to the CLI.
	codex: "only those, in your shell: no other command, and never edit or write a file yourself; the project's files change through analog-attach.",
	gemini: "only those, with your shell tool: no other tool or command is allowed.",
	openai: "only those, with the analog_attach tool: you have no other tool, no shell and no files.",
};
const MAX_CONTEXT = 4000;

/** The user's file of the chat's settings: `$XDG_CONFIG_HOME/analog-attach/gui-chat.json`. */
function settings_file() {
	const xdg = process.env.XDG_CONFIG_HOME;
	const config = xdg !== undefined && path.isAbsolute(xdg) ? xdg : path.join(os.homedir(), ".config");
	return path.join(config, "analog-attach", "gui-chat.json");
}

/** What Preferences set: { provider?, agent?, url?, model?, api_key? }; nothing when the file is missing or broken. */
function read_kept(file) {
	try {
		const kept = JSON.parse(fs.readFileSync(file, "utf8"));
		return typeof kept === "object" && kept !== null ? kept : {};
	} catch {
		return {};
	}
}

/** A SKILL.md without its front matter (the `---` block of its name and description). */
const skill_body = text => text.replace(/^---\n[\s\S]*?\n---\n/, "").trim();

/**
 * The chat. `cli` is the command that runs the GUI's CLI (as start_gui has it); `backend()` the
 * project's backend; `skills(backend)` its skills, [{ name, source_dir }] (the CLI's
 * `Backend.skills`), for a provider that has no skills of its own.
 */
export function create_assistant({ cli, backend, skills = async () => [] }) {
	const file = settings_file();
	const env = process.env;

	/** The settings in use: the environment's, each overridden by what Preferences kept. */
	function settings() {
		const kept = read_kept(file);
		const pick = (key, variable) => (typeof kept[key] === "string" && kept[key] !== "" ? kept[key] : env[variable] ?? "");
		const url = pick("url", "ANALOG_ATTACH_LLM_URL");
		let provider = pick("provider", "ANALOG_ATTACH_CHAT_PROVIDER");
		// Neither said: an endpoint set means it is the one meant.
		if (!(provider in PROVIDERS)) provider = url === "" ? "claude" : "openai";
		// The executable to go back to from the server: the one in use, else the one kept.
		const agent = AGENTS.includes(provider) ? provider : AGENTS.includes(kept.agent) ? kept.agent : "claude";
		return { provider, agent, url, model: pick("model", "ANALOG_ATTACH_LLM_MODEL"), api_key: pick("api_key", "ANALOG_ATTACH_LLM_API_KEY") };
	}

	const providers = {
		claude: create_claude({ cli }),
		codex: create_codex({ cli }),
		gemini: create_gemini({ cli }),
		openai: create_llm({ cli, settings }),
	};
	let running; // the AbortController of the message being answered, if any

	/** The settings for the page: the API key's presence, never the key. */
	function shown_settings() {
		const { api_key, ...rest } = settings();
		return { ...rest, key_set: api_key !== "", providers: PROVIDERS, agents: AGENTS, file };
	}

	/**
	 * Keep what Preferences set (`given`: provider, agent, url, model, api_key; "" or null takes
	 * the environment's again). [status, body].
	 */
	function set_settings(given) {
		if (typeof given !== "object" || given === null) return [400, { error: "settings are an object" }];
		const kept = read_kept(file);
		for (const key of ["provider", "agent", "url", "model", "api_key"]) {
			if (!(key in given)) continue;
			const value = given[key];
			if (value !== null && typeof value !== "string") return [400, { error: `${key} must be a string` }];
			if (key === "provider" && value && !(value in PROVIDERS)) return [400, { error: `provider is one of ${Object.keys(PROVIDERS).join(", ")}` }];
			if (key === "agent" && value && !AGENTS.includes(value)) return [400, { error: `agent is one of ${AGENTS.join(", ")}` }];
			if (key === "url" && value && !/^https?:\/\/[^\s]+$/.test(value)) return [400, { error: "The endpoint is an http:// or https:// URL" }];
			if (value === null || value.trim() === "") delete kept[key];
			else kept[key] = value.trim();
		}
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, `${JSON.stringify(kept, undefined, "\t")}\n`, { mode: 0o600 });
		fs.chmodSync(file, 0o600);
		return [200, shown_settings()];
	}

	/** Whether the provider in use can answer: { provider, name, available, version?, problem? }. */
	async function status() {
		const { provider } = settings();
		return { provider, name: PROVIDERS[provider], ...await providers[provider].status() };
	}

	/** The part's skill as text (its SKILL.md), for the server, which has no skills: "" when there is none. */
	async function skill_text(name) {
		if (typeof name !== "string" || name === "") return "";
		try {
			const id = await backend();
			const skill = id ? (await skills(id)).find(candidate => candidate.name === name) : undefined;
			return skill === undefined ? "" : skill_body(fs.readFileSync(path.join(skill.source_dir, "SKILL.md"), "utf8"));
		} catch {
			return "";
		}
	}

	/** The system prompt (an agent's addition to its own): where the model is, and how to behave there. */
	async function system_prompt(provider, folder, context, skill) {
		const lines = [
			"You are the assistant in the chat panel of the analog-attach GUI. The user sees their project beside this chat;",
			`the project folder is ${folder}, and you work in it. Do what the user asks by running analog-attach commands, and`,
			ONLY[provider],
			"Add --json to every command whose answer you read, and check ok.",
			"After each command that changes the project, the GUI refreshes its view of it.",
			"Before anything destructive (delete --force, a reset, overwriting), say what it will do and ask the user first.",
			"Never run analog-attach alone or analog-attach gui: they wait for a person at a terminal, or forever.",
			"There are no forms or selection widgets in this chat: ask your questions as text, the options as a numbered list.",
			"Keep replies short. When a command gives wiring instructions, show them to the user exactly.",
			typeof context === "string" ? context.slice(0, MAX_CONTEXT) : "",
		].join(" ");
		if (AGENTS.includes(provider)) return lines;
		const text = await skill_text(skill);
		return text === "" ? lines : `${lines}\n\nThe ${skill} skill, how to use the CLI (its commands are analog_attach calls here):\n\n${text}`;
	}

	/**
	 * Answer one message (`body`: { message, context?, skill? }) to `response`: the chat's events
	 * as they come, then {"type":"gui_done",...}. 409 while another is being answered.
	 */
	async function answer(folder, body, response) {
		const { message, context, skill } = body ?? {};
		if (typeof message !== "string" || message.trim() === "" || message.length > MAX_MESSAGE) {
			response.writeHead(400, { "content-type": "application/json" });
			response.end(JSON.stringify({ error: `a message is text, at most ${MAX_MESSAGE} characters` }));
			return;
		}
		if (running !== undefined) {
			response.writeHead(409, { "content-type": "application/json" });
			response.end(JSON.stringify({ error: "The assistant is still answering: stop it, or wait" }));
			return;
		}
		const controller = new AbortController();
		running = controller;
		// The page went away (closed, reloaded): stop answering it.
		response.on("close", () => controller.abort());
		const { provider } = settings();
		const emit = event => { if (!response.writableEnded) response.write(`${JSON.stringify(event)}\n`); };
		let code = -1;
		let stderr = "";
		try {
			response.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" });
			const system = await system_prompt(provider, folder, context, skill);
			({ code, stderr } = await providers[provider].answer({ folder, message, system, emit, signal: controller.signal }));
		} catch (error) {
			stderr = String(error?.message ?? error);
		} finally {
			if (running === controller) running = undefined;
			if (!response.writableEnded) response.end(`${JSON.stringify({ type: "gui_done", code, stderr: stderr.slice(-2000) })}\n`);
		}
	}

	/** Stop the message being answered: true when one was. */
	function stop() {
		if (running === undefined) return false;
		running.abort();
		return true;
	}

	/** Forget the project's conversations: the next message starts a new one. */
	function reset(folder) {
		for (const provider of Object.values(providers)) provider.reset(folder);
	}

	function close() {
		stop();
		for (const provider of Object.values(providers)) provider.close();
	}

	return { status, answer, stop, reset, close, settings: shown_settings, set_settings };
}
