// The chat's OpenAI-compatible provider (assistant.mjs): any model served by the Chat Completions
// API (`POST <url>/chat/completions`): OpenAI, a local Ollama, LM Studio, llama.cpp or vLLM, a
// gateway such as OpenRouter or LiteLLM, and the providers that speak it (Gemini, Mistral, …).
//
// The server runs the conversation itself: it sends the model the messages and one tool,
// `analog_attach`, which runs `analog-attach <args>` in the project folder; it runs each command
// the model asks for, gives it the answer, and goes on until the model replies with text alone.
// The tool is all the model can do: the arguments are passed to the GUI's own CLI as an array
// (no shell), and `analog-attach gui` (a server it would wait on forever) is refused. The
// conversation is kept in memory, one per project folder, until a new chat or the end of the GUI.

import { spawn } from "node:child_process";

/** A model's turns for one message, at most: a model that loops on commands is stopped there. */
const MAX_ROUNDS = 40;
/** At most this much of a command's output goes back to the model (and to the page). */
const MAX_OUTPUT = 16_000;
/** A command still running after this long is stopped (a build is minutes, not hours). */
const COMMAND_TIMEOUT = 15 * 60 * 1000;

const TOOL = {
	type: "function",
	function: {
		name: "analog_attach",
		description: "Run `analog-attach <args>` in the project folder, and get its exit status, stdout and stderr. "
			+ "Give the arguments without `analog-attach` itself, one word per item, unquoted: "
			+ "[\"list\", \"parent\", \"--json\"] runs `analog-attach list parent --json`.",
		parameters: {
			type: "object",
			properties: { args: { type: "array", items: { type: "string" }, description: "The arguments of analog-attach, one word per item." } },
			required: ["args"],
		},
	},
};

/** The words of a command line given as one string: split at spaces, "…" and '…' kept whole. */
export function split_words(line) {
	const words = [];
	let word;
	let quote;
	for (const character of String(line)) {
		if (quote !== undefined) {
			if (character === quote) quote = undefined;
			else word += character;
		} else if (character === "\"" || character === "'") {
			quote = character;
			word ??= "";
		} else if (/\s/.test(character)) {
			if (word !== undefined) words.push(word);
			word = undefined;
		} else {
			word = (word ?? "") + character;
		}
	}
	if (word !== undefined) words.push(word);
	return words;
}

/**
 * The CLI's arguments of a tool call (its `arguments`, JSON): { args }, and `refused` when they
 * aren't run, saying why (`args` then only when they could be read). A model may give `args` as
 * one string, or start with `analog-attach`: both are taken.
 */
export function tool_args(text) {
	let input;
	try {
		input = JSON.parse(text === "" ? "{}" : text);
	} catch {
		return { refused: "The arguments aren't JSON: give {\"args\": [\"word\", …]}." };
	}
	const given = input?.args ?? input?.command;
	let args = typeof given === "string" ? split_words(given) : given;
	if (!Array.isArray(args) || !args.every(word => typeof word === "string")) return { refused: "args must be a list of words (strings)." };
	if (args[0] === "analog-attach") args = args.slice(1);
	if (args.length === 0) return { args, refused: "Not run: analog-attach alone waits for a person at a terminal. Give a command." };
	if (args.find(word => !word.startsWith("-")) === "gui") return { args, refused: "Not allowed: analog-attach gui is the GUI this chat is in." };
	return { args };
}

/** A command's answer for the model: its exit status, stdout and stderr, cut to MAX_OUTPUT. */
function command_answer({ code, stdout, stderr }) {
	const text = [`exit status: ${code}`, stdout.trim() === "" ? "" : `stdout:\n${stdout.trim()}`, stderr.trim() === "" ? "" : `stderr:\n${stderr.trim()}`]
		.filter(part => part !== "").join("\n");
	return text.length > MAX_OUTPUT ? `${text.slice(0, MAX_OUTPUT)}\n[… cut: ${text.length - MAX_OUTPUT} more characters]` : text;
}

/** A word as the console shows it: quoted when it has spaces or quotes. */
const shown_word = word => (/^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replace(/'/g, "'\\''")}'`);

/**
 * The model's reply to `body`, streamed: `on_text` gets its text as it comes. Resolves with the
 * whole reply: { content, tool_calls }. A server that doesn't stream (a JSON answer) is read whole.
 */
async function complete(settings, body, on_text, signal) {
	const url = `${settings.url.replace(/\/+$/, "")}/chat/completions`;
	const response = await fetch(url, {
		method: "POST",
		headers: { "content-type": "application/json", ...(settings.api_key ? { authorization: `Bearer ${settings.api_key}` } : {}) },
		body: JSON.stringify({ ...body, stream: true }),
		signal,
	});
	if (!response.ok) {
		const text = (await response.text().catch(() => "")).trim();
		let detail = text;
		try { detail = JSON.parse(text)?.error?.message ?? text; } catch {}
		throw new Error(`${url} said ${response.status}${detail ? `: ${String(detail).slice(0, 1000)}` : ""}`);
	}
	if (!(response.headers.get("content-type") ?? "").includes("text/event-stream")) {
		const message = (await response.json())?.choices?.[0]?.message ?? {};
		if (message.content) on_text(message.content);
		return { content: message.content ?? "", tool_calls: message.tool_calls ?? [] };
	}
	// Server-sent events: `data: {chunk}` lines, then `data: [DONE]`. A tool call comes in
	// pieces, by its index: its id and name first, its arguments a piece at a time.
	let content = "";
	const calls = [];
	const decoder = new TextDecoder();
	let pending = "";
	const line = text => {
		if (!text.startsWith("data:")) return;
		const data = text.slice(5).trim();
		if (data === "" || data === "[DONE]") return;
		const chunk = JSON.parse(data);
		if (chunk.error) throw new Error(String(chunk.error.message ?? JSON.stringify(chunk.error)));
		const delta = chunk.choices?.[0]?.delta ?? {};
		if (typeof delta.content === "string" && delta.content !== "") {
			content += delta.content;
			on_text(delta.content);
		}
		for (const piece of delta.tool_calls ?? []) {
			const at = typeof piece.index === "number" ? piece.index : calls.length;
			calls[at] ??= { id: "", type: "function", function: { name: "", arguments: "" } };
			if (piece.id) calls[at].id = piece.id;
			if (piece.function?.name) calls[at].function.name += piece.function.name;
			if (piece.function?.arguments) calls[at].function.arguments += piece.function.arguments;
		}
	};
	for await (const bytes of response.body) {
		pending += decoder.decode(bytes, { stream: true });
		const lines = pending.split("\n");
		pending = lines.pop() ?? "";
		for (const text of lines) line(text.trim());
	}
	line(pending.trim());
	const tool_calls = calls.filter(Boolean).map((call, at) => ({ ...call, id: call.id || `call_${at}` }));
	return { content, tool_calls };
}

/**
 * The OpenAI-compatible provider. `cli` is the command that runs the GUI's CLI (as start_gui has
 * it); `settings()` the endpoint to use: { url, model, api_key? }.
 */
export function create_llm({ cli, settings }) {
	const conversations = new Map(); // project folder -> the messages so far (the system prompt aside)
	const [command, ...prefix] = cli;

	/** Whether an endpoint and a model are set: { available, version } or { available: false, problem }. */
	function status() {
		const { url, model } = settings();
		if (!url || !model) return { available: false, problem: "No model is set up." };
		let host = url;
		try { host = new URL(url).host; } catch {}
		return { available: true, version: `${model} · ${host}` };
	}

	/** `analog-attach <args>` in `folder`, in a child process: { code, stdout, stderr }. */
	function run_command(folder, args, signal) {
		return new Promise(resolve => {
			const child = spawn(command, [...prefix, ...args], {
				cwd: folder,
				stdio: ["ignore", "pipe", "pipe"],
				env: { ...process.env, NO_COLOR: "1" },
			});
			let stdout = "";
			let stderr = "";
			const stop = () => { if (child.exitCode === null) child.kill("SIGTERM"); };
			const timer = setTimeout(() => { stderr += `\n[stopped after ${COMMAND_TIMEOUT / 60_000} minutes]`; stop(); }, COMMAND_TIMEOUT);
			signal.addEventListener("abort", stop, { once: true });
			child.stdout.on("data", chunk => { stdout += chunk; });
			child.stderr.on("data", chunk => { stderr += chunk; });
			const done = code => {
				clearTimeout(timer);
				signal.removeEventListener("abort", stop);
				resolve({ code, stdout, stderr });
			};
			child.on("error", error => { stderr += String(error); done(-1); });
			child.on("close", code => done(code));
		});
	}

	/**
	 * Answer one message: the chat's events (assistant.mjs) to `emit` as they come. `system` is the
	 * system prompt; `signal` stops it. Resolves with { code, stderr }: 0, or 1 and what went wrong.
	 */
	async function answer({ folder, message, system, emit, signal }) {
		const current = settings();
		const messages = conversations.get(folder) ?? [];
		conversations.set(folder, messages);
		messages.push({ role: "user", content: message });
		const started = Date.now();
		try {
			for (let round = 0; round < MAX_ROUNDS; round++) {
				emit({ type: "turn" });
				const reply = await complete(current, {
					model: current.model,
					messages: [{ role: "system", content: system }, ...messages],
					tools: [TOOL],
				}, text => emit({ type: "text", text }), signal);
				messages.push({ role: "assistant", content: reply.content || null, ...(reply.tool_calls.length > 0 ? { tool_calls: reply.tool_calls } : {}) });
				if (reply.tool_calls.length === 0) {
					emit({ type: "result", ok: true, seconds: (Date.now() - started) / 1000 });
					return { code: 0, stderr: "" };
				}
				for (const call of reply.tool_calls) {
					const asked = call.function.name === TOOL.function.name ? tool_args(call.function.arguments) : { refused: `There is no tool ${call.function.name}: only analog_attach.` };
					const shown = asked.args === undefined ? `${call.function.name} ${call.function.arguments}` : `analog-attach ${asked.args.map(shown_word).join(" ")}`;
					emit({ type: "command", id: call.id, command: shown });
					let content;
					if (asked.refused !== undefined) {
						content = asked.refused;
						emit({ type: "output", id: call.id, output: content, failed: true, refused: true });
					} else {
						const result = await run_command(folder, asked.args, signal);
						content = command_answer(result);
						emit({ type: "output", id: call.id, output: content, failed: result.code !== 0, refused: false });
					}
					messages.push({ role: "tool", tool_call_id: call.id, content });
					if (signal.aborted) throw new Error("stopped");
				}
			}
			const problem = `Stopped after ${MAX_ROUNDS} rounds of commands: ask again to go on.`;
			emit({ type: "result", ok: false, error: problem, seconds: (Date.now() - started) / 1000 });
			return { code: 0, stderr: "" };
		} catch (error) {
			// The conversation stays one the model can read: each command it asked for has an answer.
			const asked = messages.at(-1)?.role === "user" ? [] : messages.findLast(entry => entry.role === "assistant")?.tool_calls ?? [];
			const answered = new Set(messages.filter(entry => entry.role === "tool").map(entry => entry.tool_call_id));
			for (const call of asked) {
				if (!answered.has(call.id)) messages.push({ role: "tool", tool_call_id: call.id, content: "Not run: the user stopped the answer." });
			}
			if (signal.aborted) {
				emit({ type: "result", ok: false, error: "Stopped.", seconds: (Date.now() - started) / 1000 });
				return { code: 0, stderr: "" };
			}
			return { code: 1, stderr: error?.cause?.message ? `${error.message}: ${error.cause.message}` : String(error?.message ?? error) };
		}
	}

	/** Forget the project's conversation: the next message starts a new one. */
	function reset(folder) {
		conversations.delete(folder);
	}

	return { status, answer, reset, close() {} };
}

