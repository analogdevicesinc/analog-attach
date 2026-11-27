// The chat's agent executables (claude.mjs, codex.mjs, gemini.mjs): the arguments each is run
// with, the translation of its events into the chat's, and a whole answer with a stand-in
// executable that prints canned events, runs `analog-attach` through its PATH (the GUI's CLI,
// a stand-in too) and saves what it was given. Run by the CLI's vitest (its config includes
// ../gui/test).

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { create_assistant } from "../src/assistant.mjs";
import { claude_args, create_claude, translate_claude } from "../src/claude.mjs";
import { codex_args, codex_translator, create_codex, shown_command } from "../src/codex.mjs";
import { create_gemini, gemini_args, gemini_prompt, gemini_translator, POLICY } from "../src/gemini.mjs";

let base;
beforeEach(() => { base = fs.mkdtempSync(path.join(os.tmpdir(), "aa-gui-agents-")); });
afterEach(() => { fs.rmSync(base, { recursive: true, force: true }); });

/** An executable script `name` in `base`, of `body` (a node program). */
function script(name, body) {
	const file = path.join(base, name);
	fs.writeFileSync(file, `#!/usr/bin/env node\n${body}`, { mode: 0o755 });
	return file;
}

/**
 * A stand-in agent: `--version` prints `version`; otherwise it saves its arguments and standard
 * input as run<n>.json, runs `analog-attach --version` through PATH and prints `events(answer)`,
 * one JSON object per line.
 */
function stand_in(name, version, events) {
	const runs = path.join(base, `${name}-runs`);
	fs.mkdirSync(runs);
	const file = script(name, `
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log(${JSON.stringify(version)}); process.exit(0); }
const input = process.stdin.isTTY || args.at(-1) !== "-" ? null : fs.readFileSync(0, "utf8");
fs.writeFileSync(${JSON.stringify(runs)} + "/run" + fs.readdirSync(${JSON.stringify(runs)}).length + ".json", JSON.stringify({ args, input, cwd: process.cwd() }));
const answer = execFileSync("analog-attach", ["--version"], { encoding: "utf8" }).trim();
for (const event of (${events.toString()})(answer)) console.log(JSON.stringify(event));
`);
	return { file, run: index => JSON.parse(fs.readFileSync(path.join(runs, `run${index}.json`), "utf8")) };
}

/** The GUI's CLI, a stand-in: `--version` prints its version. */
const fake_cli = () => [script("cli", "console.log(\"fake-cli 1.2.3\");")];

/** One message answered: the chat's events. */
async function ask(provider, folder, message, system = "the GUI's words") {
	const events = [];
	const exit = await provider.answer({ folder, message, system, emit: event => events.push(event), signal: new AbortController().signal });
	return { events, exit };
}

describe("Claude Code", () => {
	test("its arguments: allowed analog-attach only, the system prompt added, --resume for the next", () => {
		const args = claude_args({ message: "hi", system: "sys" });
		expect(args.slice(0, 2)).toEqual(["-p", "hi"]);
		expect(args.join(" ")).toContain("--permission-mode dontAsk --allowedTools Bash(analog-attach:*) --disallowedTools Bash(analog-attach gui:*) --append-system-prompt sys");
		expect(args).not.toContain("--resume");
		expect(claude_args({ message: "hi", system: "sys", session: "s1" }).slice(-2)).toEqual(["--resume", "s1"]);
	});

	test("its events as the chat's", () => {
		const events = [];
		let session;
		const emit = event => events.push(event);
		for (const event of [
			{ type: "system", subtype: "init", session_id: "s1" },
			{ type: "stream_event", event: { type: "message_start" } },
			{ type: "stream_event", event: { delta: { type: "text_delta", text: "Hi" } } },
			{ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", input: { command: "analog-attach list" } }] } },
			{ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: [{ text: "denied" }], is_error: true }] } },
			{ type: "result", duration_ms: 2000, total_cost_usd: 0.5 },
		]) translate_claude(event, emit, id => { session = id; });
		expect(session).toBe("s1");
		expect(events).toEqual([
			{ type: "turn" },
			{ type: "text", text: "Hi" },
			{ type: "command", id: "t1", command: "analog-attach list" },
			{ type: "output", id: "t1", output: "denied", failed: true, refused: true },
			{ type: "result", ok: true, seconds: 2, cost_usd: 0.5 },
		]);
	});

	test("a whole answer: the GUI's CLI first on its PATH, the conversation resumed", async () => {
		const claude = stand_in("claude", "9.9.9 (Claude Code)", answer => [
			{ type: "system", subtype: "init", session_id: "c-session" },
			{ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", input: { command: "analog-attach --version" } }] } },
			{ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: answer }] } },
			{ type: "result", is_error: false },
		]);
		const provider = create_claude({ cli: fake_cli(), claude: [claude.file] });
		try {
			expect(await provider.status()).toEqual({ available: true, version: "9.9.9 (Claude Code)" });
			const { events, exit } = await ask(provider, base, "what version?");
			expect(exit).toEqual({ code: 0, stderr: "" });
			expect(events.find(event => event.type === "output")).toMatchObject({ output: "fake-cli 1.2.3", failed: false });
			expect(claude.run(0).args).not.toContain("--resume");
			await ask(provider, base, "again");
			expect(claude.run(1).args.slice(-2)).toEqual(["--resume", "c-session"]);
		} finally {
			provider.close();
		}
	});
});

describe("Codex CLI", () => {
	test("its arguments: the workspace-write sandbox in the folder with the network, no approvals, the message on stdin, resume <thread> for the next", () => {
		const args = codex_args({ folder: "/p", system: "say \"hi\"\nthen go" });
		expect(args).toEqual([
			"exec", "--json", "--color", "never", "--skip-git-repo-check", "--sandbox", "workspace-write", "--cd", "/p",
			"-c", "approval_policy=\"never\"", "-c", "developer_instructions=\"say \\\"hi\\\"\\nthen go\"",
			"-c", "sandbox_workspace_write.network_access=true", "-",
		]);
		expect(codex_args({ folder: "/p", system: "s", session: "th" }).slice(-3)).toEqual(["resume", "th", "-"]);
	});

	test("a command as the chat shows it: the script its shell was given", () => {
		expect(shown_command("bash -lc 'analog-attach list --json'")).toBe("analog-attach list --json");
		expect(shown_command("/bin/bash -lc 'analog-attach read '\\''a b'\\'''")).toBe("analog-attach read 'a b'");
		expect(shown_command("/bin/zsh -lc \"analog-attach \\\"x\\\"\"")).toBe("analog-attach \"x\"");
		expect(shown_command("analog-attach list")).toBe("analog-attach list");
	});

	test("its events as the chat's", () => {
		const events = [];
		let thread;
		const { translate, finish } = codex_translator(event => events.push(event), id => { thread = id; }, Date.now());
		for (const event of [
			{ type: "thread.started", thread_id: "th1" },
			{ type: "turn.started" },
			{ type: "item.completed", item: { id: "i0", type: "reasoning", text: "thinking" } },
			{ type: "item.started", item: { id: "i1", type: "command_execution", command: "bash -lc 'analog-attach list'", aggregated_output: "", exit_code: null, status: "in_progress" } },
			{ type: "item.completed", item: { id: "i1", type: "command_execution", command: "bash -lc 'analog-attach list'", aggregated_output: "spi0\n", exit_code: 0, status: "completed" } },
			{ type: "item.completed", item: { id: "i2", type: "command_execution", command: "bash -lc 'rm x'", aggregated_output: "", exit_code: null, status: "declined" } },
			{ type: "item.completed", item: { id: "i3", type: "command_execution", command: "bash -lc 'touch /etc/x'", aggregated_output: "Permission denied", exit_code: 1, status: "failed" } },
			{ type: "item.completed", item: { id: "i4", type: "agent_message", text: "Done." } },
			{ type: "turn.completed", usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0 } },
		]) translate(event);
		finish();
		expect(thread).toBe("th1");
		expect(events.map(({ seconds, ...event }) => event)).toEqual([
			{ type: "command", id: "i1", command: "analog-attach list" },
			{ type: "output", id: "i1", output: "spi0\n", failed: false, refused: false },
			{ type: "command", id: "i2", command: "rm x" },
			{ type: "output", id: "i2", output: "", failed: true, refused: true },
			{ type: "command", id: "i3", command: "touch /etc/x" },
			{ type: "output", id: "i3", output: "Permission denied", failed: true, refused: false },
			{ type: "turn" },
			{ type: "text", text: "Done." },
			{ type: "result", ok: true },
		]);
	});

	test("a failed turn, and an error alone, end the answer not ok", () => {
		const failed = [];
		const one = codex_translator(event => failed.push(event), () => {});
		one.translate({ type: "turn.failed", error: { message: "quota" } });
		one.finish();
		expect(failed).toMatchObject([{ type: "result", ok: false, error: "quota" }]);
		const errored = [];
		const two = codex_translator(event => errored.push(event), () => {});
		two.translate({ type: "error", message: "stream lost" });
		two.finish();
		expect(errored).toMatchObject([{ type: "result", ok: false, error: "stream lost" }]);
	});

	test("a whole answer: the message on its standard input, the GUI's CLI on its PATH, the thread resumed until a new chat", async () => {
		const codex = stand_in("codex", "codex-cli 0.99.0", answer => [
			{ type: "thread.started", thread_id: "x-thread" },
			{ type: "turn.started" },
			{ type: "item.started", item: { id: "item_1", type: "command_execution", command: "bash -lc 'analog-attach --version'", aggregated_output: "", exit_code: null, status: "in_progress" } },
			{ type: "item.completed", item: { id: "item_1", type: "command_execution", command: "bash -lc 'analog-attach --version'", aggregated_output: `${answer}\n`, exit_code: 0, status: "completed" } },
			{ type: "item.completed", item: { id: "item_2", type: "agent_message", text: `It is ${answer}.` } },
			{ type: "turn.completed", usage: {} },
		]);
		const provider = create_codex({ cli: fake_cli(), codex: [codex.file] });
		try {
			expect(await provider.status()).toEqual({ available: true, version: "codex-cli 0.99.0" });
			const { events, exit } = await ask(provider, base, "--what version?");
			expect(exit).toEqual({ code: 0, stderr: "" });
			expect(events.map(event => event.type)).toEqual(["command", "output", "turn", "text", "result"]);
			expect(events[3]).toEqual({ type: "text", text: "It is fake-cli 1.2.3." });
			const first = codex.run(0);
			expect(first.input).toBe("--what version?");
			expect(fs.realpathSync(first.cwd)).toBe(fs.realpathSync(base));
			expect(first.args).not.toContain("resume");
			expect(first.args.join(" ")).toContain("developer_instructions=\"the GUI's words\"");
			await ask(provider, base, "again");
			expect(codex.run(1).args.slice(-3)).toEqual(["resume", "x-thread", "-"]);
			provider.reset(base);
			await ask(provider, base, "a new chat");
			expect(codex.run(2).args).not.toContain("resume");
		} finally {
			provider.close();
		}
	});

	test("not installed: why", async () => {
		const provider = create_codex({ cli: ["analog-attach"], codex: [path.join(base, "no-codex")] });
		expect(await provider.status()).toEqual({ available: false, problem: "Codex CLI isn't installed (no <code>codex</code> command)." });
		provider.close();
	});
});

describe("Gemini CLI", () => {
	test("its arguments: the GUI's instructions before the message, in one word, its policy, --resume for the next", () => {
		const args = gemini_args({ message: "-hi", system: "sys", policy: "/p.toml" });
		expect(args).toEqual([`--prompt=${gemini_prompt("sys", "-hi")}`, "--output-format", "stream-json", "--approval-mode", "default", "--policy", "/p.toml"]);
		expect(gemini_prompt("sys", "-hi")).toBe("The analog-attach GUI's instructions: sys\n\nThe user's message:\n-hi");
		expect(gemini_args({ message: "m", system: "s", policy: "/p.toml", session: "g1" }).slice(-2)).toEqual(["--resume", "g1"]);
	});

	test("its policy: analog-attach commands and skills allowed, analog-attach gui and every other tool denied", () => {
		const rules = POLICY.split("[[rule]]").slice(1).map(rule => Object.fromEntries([...rule.matchAll(/^(\w+) = (.+)$/gm)].map(([, key, value]) => [key, value])));
		expect(rules.map(rule => [rule.toolName, rule.commandPrefix, rule.decision, rule.priority])).toEqual([
			["\"run_shell_command\"", "\"analog-attach gui\"", "\"deny\"", "950"],
			["\"run_shell_command\"", "\"analog-attach \"", "\"allow\"", "900"],
			["\"activate_skill\"", undefined, "\"allow\"", "900"],
			["\"*\"", undefined, "\"deny\"", "100"],
		]);
	});

	test("its events as the chat's: a new reply after each command", () => {
		const events = [];
		let session;
		const { translate } = gemini_translator(event => events.push(event), id => { session = id; });
		for (const event of [
			{ type: "init", session_id: "g1", model: "gemini-2.5-pro" },
			{ type: "message", role: "user", content: "hi" },
			{ type: "message", role: "assistant", content: "Let me ", delta: true },
			{ type: "message", role: "assistant", content: "look.", delta: true },
			{ type: "tool_use", tool_name: "run_shell_command", tool_id: "c1", parameters: { command: "analog-attach list" } },
			{ type: "tool_result", tool_id: "c1", status: "success", output: "spi0" },
			{ type: "tool_use", tool_name: "write_file", tool_id: "c2", parameters: { file_path: "x" } },
			{ type: "tool_result", tool_id: "c2", status: "error", error: { type: "policy_violation", message: "Tool execution denied by policy." } },
			{ type: "message", role: "assistant", content: "Done.", delta: true },
			{ type: "result", status: "success", stats: { duration_ms: 1500 } },
		]) translate(event);
		expect(session).toBe("g1");
		expect(events).toEqual([
			{ type: "turn" },
			{ type: "text", text: "Let me " },
			{ type: "text", text: "look." },
			{ type: "command", id: "c1", command: "analog-attach list" },
			{ type: "output", id: "c1", output: "spi0", failed: false, refused: false },
			{ type: "command", id: "c2", command: "write_file {\"file_path\":\"x\"}" },
			{ type: "output", id: "c2", output: "Tool execution denied by policy.", failed: true, refused: true },
			{ type: "turn" },
			{ type: "text", text: "Done." },
			{ type: "result", ok: true, seconds: 1.5 },
		]);
	});

	test("an error result ends the answer not ok", () => {
		const events = [];
		gemini_translator(event => events.push(event), () => {}).translate({ type: "result", status: "error", error: { type: "FatalToolExecutionError", message: "no space" } });
		expect(events).toEqual([{ type: "result", ok: false, error: "no space" }]);
	});

	test("a whole answer: its policy file given, the GUI's CLI on its PATH, the session resumed until a new chat", async () => {
		const gemini = stand_in("gemini", "0.99.0", answer => [
			{ type: "init", session_id: "g-session", model: "m" },
			{ type: "tool_use", tool_name: "run_shell_command", tool_id: "t1", parameters: { command: "analog-attach --version" } },
			{ type: "tool_result", tool_id: "t1", status: "success", output: answer },
			{ type: "message", role: "assistant", content: "ok", delta: true },
			{ type: "result", status: "success", stats: { duration_ms: 10 } },
		]);
		const provider = create_gemini({ cli: fake_cli(), gemini: [gemini.file] });
		try {
			expect(await provider.status()).toEqual({ available: true, version: "Gemini CLI 0.99.0" });
			const { events, exit } = await ask(provider, base, "what version?");
			expect(exit).toEqual({ code: 0, stderr: "" });
			expect(events.find(event => event.type === "output")).toEqual({ type: "output", id: "t1", output: "fake-cli 1.2.3", failed: false, refused: false });
			const first = gemini.run(0);
			const policy = first.args[first.args.indexOf("--policy") + 1];
			expect(fs.readFileSync(policy, "utf8")).toBe(POLICY);
			expect(first.args[0]).toBe(`--prompt=${gemini_prompt("the GUI's words", "what version?")}`);
			expect(first.args).not.toContain("--resume");
			await ask(provider, base, "again");
			expect(gemini.run(1).args.slice(-2)).toEqual(["--resume", "g-session"]);
			provider.reset(base);
			await ask(provider, base, "a new chat");
			expect(gemini.run(2).args).not.toContain("--resume");
			provider.close();
			expect(fs.existsSync(policy)).toBe(false);
		} finally {
			provider.close();
		}
	});
});

describe("the assistant's settings", () => {
	const saved = {};
	const variables = ["XDG_CONFIG_HOME", "ANALOG_ATTACH_CHAT_PROVIDER", "ANALOG_ATTACH_LLM_URL", "ANALOG_ATTACH_LLM_MODEL", "ANALOG_ATTACH_LLM_API_KEY"];
	beforeEach(() => {
		for (const name of variables) {
			saved[name] = process.env[name];
			delete process.env[name];
		}
		process.env.XDG_CONFIG_HOME = base;
	});
	afterEach(() => {
		for (const name of variables) {
			if (saved[name] === undefined) delete process.env[name];
			else process.env[name] = saved[name];
		}
	});
	const file = () => path.join(base, "analog-attach", "gui-chat.json");
	const keep = kept => {
		fs.mkdirSync(path.dirname(file()), { recursive: true });
		fs.writeFileSync(file(), JSON.stringify(kept));
	};

	test("a file of before (provider claude or openai) keeps working; the executable is Claude Code", () => {
		keep({ provider: "openai", url: "http://127.0.0.1:9/v1" });
		const chat = create_assistant({ cli: ["analog-attach"], backend: async () => "linux" });
		try {
			expect(chat.settings()).toMatchObject({ provider: "openai", agent: "claude", agents: ["claude", "codex", "gemini"] });
			keep({ provider: "claude" });
			expect(chat.settings()).toMatchObject({ provider: "claude", agent: "claude" });
		} finally {
			chat.close();
		}
	});

	test("an agent is kept for when the server is chosen; an unknown one is refused", () => {
		const chat = create_assistant({ cli: ["analog-attach"], backend: async () => "linux" });
		try {
			expect(chat.set_settings({ provider: "gemini", agent: "gemini" })[1]).toMatchObject({ provider: "gemini", agent: "gemini" });
			expect(chat.set_settings({ provider: "openai", agent: "gemini" })[1]).toMatchObject({ provider: "openai", agent: "gemini" });
			expect(JSON.parse(fs.readFileSync(file(), "utf8"))).toEqual({ provider: "openai", agent: "gemini" });
			expect(chat.set_settings({ agent: "vim" })).toEqual([400, { error: "agent is one of claude, codex, gemini" }]);
			expect(chat.set_settings({ provider: "vim" })[0]).toBe(400);
		} finally {
			chat.close();
		}
	});

	test("$ANALOG_ATTACH_CHAT_PROVIDER may name an agent", () => {
		process.env.ANALOG_ATTACH_CHAT_PROVIDER = "codex";
		const chat = create_assistant({ cli: ["analog-attach"], backend: async () => "linux" });
		try {
			expect(chat.settings()).toMatchObject({ provider: "codex", agent: "codex" });
		} finally {
			chat.close();
		}
	});
});

test("the stand-ins run", () => {
	expect(execFileSync(fake_cli()[0], { encoding: "utf8" })).toBe("fake-cli 1.2.3\n");
});
