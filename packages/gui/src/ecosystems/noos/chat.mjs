// The noos part's chat with Claude: a panel on the right, opened from the console bar. The user
// writes what they want; the server runs Claude Code in the project (../../claude.mjs), which may
// run `analog-attach` commands only, and its answer streams in: its text as it writes it, each
// command it runs with what it answered, and anything it was refused. After each command the
// noos part reads the project again, so the change shows beside the chat.

import { $, api, esc, log, toast } from "../../core/ui.mjs";

const SKILL = "analog-attach-noos";

/** A line of a reply as HTML: escaped, with `code` and **bold**. */
const inline = text => esc(text).replace(/`([^`\n]+)`/g, "<code>$1</code>").replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>");

/** A Markdown table's lines (`| a | b |`, the `|---|` line below the head) as an HTML table. */
function table(lines) {
	const cells = line => line.trim().replace(/^\||\|$/g, "").split("|").map(cell => cell.trim());
	const [head, , ...rows] = lines;
	return `<table class="claude-table"><thead><tr>${cells(head).map(cell => `<th>${inline(cell)}</th>`).join("")}</tr></thead>`
		+ `<tbody>${rows.map(row => `<tr>${cells(row).map(cell => `<td>${inline(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

/** A reply's text as HTML: escaped, with ``` blocks, tables, `code` and **bold**. */
function format(text) {
	const parts = String(text).split(/```[^\n]*\n?/);
	return parts.map((part, index) => {
		if (index % 2 === 1) return `<pre>${esc(part.replace(/\n$/, ""))}</pre>`;
		// Runs of `|` lines with a `|---|` line second are tables; the other lines stay lines.
		const lines = part.split("\n");
		const out = [];
		for (let at = 0; at < lines.length; at++) {
			if (lines[at].trim().startsWith("|") && /^\s*\|[\s:|-]+\|\s*$/.test(lines[at + 1] ?? "")) {
				let end = at + 2;
				while (end < lines.length && lines[end].trim().startsWith("|")) end++;
				out.push(table(lines.slice(at, end)));
				at = end - 1;
			} else {
				out.push(`${inline(lines[at])}${at < lines.length - 1 ? "<br>" : ""}`);
			}
		}
		return out.join("");
	}).join("");
}

/**
 * Add the chat to the noos part. `main` is the part's element (the panel goes in it, and goes
 * with it); `button_area` where its button goes (the console bar); `context()` what Claude is
 * told of the page (the node on screen); `changed()` reads the project again; `cli` runs the
 * CLI, as the part does.
 */
export function mount_chat({ main, button_area, context, changed: read_again, cli }) {
	const chat = { open: false, busy: false, checked: false, timer: undefined };
	// Claude may run several commands in a row: read the project once they settle.
	const changed = () => {
		clearTimeout(chat.timer);
		chat.timer = setTimeout(read_again, 400);
	};
	button_area.insertAdjacentHTML("beforeend", `<button id="claude-toggle" title="Ask Claude to change the project">✦ Claude</button>`);
	main.insertAdjacentHTML("beforeend", `
		<link rel="stylesheet" href="ecosystems/noos/chat.css">
		<aside id="claude" class="claude" hidden>
			<div class="claude-bar">
				<strong>✦ Claude</strong><span class="subtle" id="claude-version"></span>
				<div class="spacer"></div>
				<button class="ghost" id="claude-new" title="Start a new conversation">New chat</button>
				<button class="ghost" id="claude-close" title="Close">✕</button>
			</div>
			<div class="claude-notice" id="claude-notice" hidden></div>
			<div class="claude-messages" id="claude-messages">
				<div class="claude-hint">Tell Claude what to change, in your words: <i>add an ADXL355 eval board</i>, <i>set the SPI speed to 4 MHz</i>, <i>why is the workfile not valid?</i> It runs <code>analog-attach</code> commands for you, and nothing else; each one shows here and in the console.</div>
			</div>
			<form class="claude-input" id="claude-form">
				<textarea id="claude-text" rows="3" placeholder="Ask Claude… (Enter to send, Shift+Enter for a new line)"></textarea>
				<div class="actions-row"><button class="primary" id="claude-send" type="submit">Send</button><button id="claude-stop" type="button" hidden>Stop</button></div>
			</form>
		</aside>`);
	const panel = $("claude");
	const messages = $("claude-messages");

	const add = html => {
		messages.insertAdjacentHTML("beforeend", html);
		messages.scrollTop = messages.scrollHeight;
		return messages.lastElementChild;
	};
	const set_busy = busy => {
		chat.busy = busy;
		$("claude-send").hidden = busy;
		$("claude-stop").hidden = !busy;
		$("claude-text").disabled = busy;
	};

	/** On first opening: is Claude Code there, and is the noos skill installed? */
	async function check() {
		if (chat.checked) return;
		chat.checked = true;
		const notice = $("claude-notice");
		const status = await (await api("/api/claude")).json();
		if (!status.available) {
			notice.hidden = false;
			notice.innerHTML = `Claude Code isn't installed (no <code>claude</code> command). Install it from <a href="https://claude.ai/code" target="_blank" rel="noreferrer">claude.ai/code</a>, log in, then reopen the GUI.`;
			$("claude-send").disabled = true;
			return;
		}
		$("claude-version").textContent = status.version ?? "";
		const skills = await cli(["skill", "install", "--json"], { quiet: true });
		const skill = skills.json?.skills?.find(candidate => candidate.name === SKILL);
		if (skill !== undefined && !skill.installed) {
			notice.hidden = false;
			notice.innerHTML = `The <code>${SKILL}</code> skill teaches Claude the CLI: it works better with it. <button id="claude-skill">Install it</button>`;
			$("claude-skill").onclick = async () => {
				const result = await cli(["skill", "install", SKILL, "--json"]);
				if (result.json?.ok) notice.hidden = true;
				else toast(result.json?.message ?? "The skill wasn't installed", true);
			};
		}
	}

	/** One message: send it, and show Claude's answer as it streams in. */
	async function send(message) {
		set_busy(true);
		add(`<div class="claude-msg user">${format(message)}</div>`);
		let bubble;          // Claude's text being written
		const cards = {};    // tool_use id -> its card
		const write = text => {
			bubble ??= add(`<div class="claude-msg assistant"></div>`);
			bubble.dataset.text = (bubble.dataset.text ?? "") + text;
			bubble.innerHTML = format(bubble.dataset.text);
			messages.scrollTop = messages.scrollHeight;
		};
		const handle = event => {
			if (event.type === "stream_event" && event.event?.type === "message_start") {
				bubble = undefined;
			} else if (event.type === "stream_event" && event.event?.delta?.type === "text_delta") {
				write(event.event.delta.text);
			} else if (event.type === "assistant") {
				for (const block of event.message?.content ?? []) {
					if (block.type === "tool_use" && cards[block.id] === undefined) {
						const command = block.input?.command ?? JSON.stringify(block.input);
						cards[block.id] = add(`<div class="claude-cmd"><div class="mono">$ ${esc(command)}</div></div>`);
						log(`<div class="cmd">✦ claude $ ${esc(command)}</div>`);
						bubble = undefined;
					}
				}
			} else if (event.type === "user") {
				for (const block of event.message?.content ?? []) {
					if (block.type !== "tool_result") continue;
					const card = cards[block.tool_use_id];
					const body = typeof block.content === "string" ? block.content : (block.content ?? []).map(part => part.text ?? "").join("\n");
					const refused = block.is_error && /denied|don't ask mode/i.test(body);
					if (card !== undefined) {
						card.classList.add(refused ? "refused" : block.is_error ? "failed" : "done");
						card.insertAdjacentHTML("beforeend", refused
							? `<div class="claude-refused">Not allowed: Claude may run analog-attach commands only.</div>`
							: `<details><summary>${block.is_error ? "failed" : "output"}</summary><pre>${esc(body.slice(0, 6000))}</pre></details>`);
					}
					if (!refused) changed();
				}
			} else if (event.type === "result") {
				const cost = typeof event.total_cost_usd === "number" ? ` · $${event.total_cost_usd.toFixed(3)}` : "";
				const seconds = typeof event.duration_ms === "number" ? ` · ${(event.duration_ms / 1000).toFixed(0)} s` : "";
				if (event.is_error && event.result) add(`<div class="claude-msg error">${format(event.result)}</div>`);
				add(`<div class="claude-meta">${esc(event.subtype === "success" ? "done" : event.subtype ?? "done")}${seconds}${cost}</div>`);
			} else if (event.type === "gui_done" && event.code !== 0 && event.code !== null) {
				add(`<div class="claude-msg error">Claude stopped (exit ${esc(event.code)})${event.stderr ? `: ${esc(event.stderr)}` : ""}</div>`);
			}
		};
		try {
			const response = await api("/api/claude", { message, context: context() });
			if (!response.ok) {
				const problem = await response.json().catch(() => ({}));
				add(`<div class="claude-msg error">${esc(problem.error ?? `The server said ${response.status}`)}</div>`);
				return;
			}
			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let pending = "";
			for (;;) {
				const { value, done } = await reader.read();
				if (done) break;
				pending += decoder.decode(value, { stream: true });
				const lines = pending.split("\n");
				pending = lines.pop() ?? "";
				for (const line of lines) {
					if (line.trim() === "") continue;
					try {
						handle(JSON.parse(line));
					} catch {
						write(`${line}\n`);
					}
				}
			}
		} catch (error) {
			add(`<div class="claude-msg error">${esc(String(error))}</div>`);
		} finally {
			set_busy(false);
			changed();
			$("claude-text").focus();
		}
	}

	$("claude-toggle").onclick = () => {
		chat.open = !chat.open;
		panel.hidden = !chat.open;
		document.body.classList.toggle("with-claude", chat.open);
		if (chat.open) {
			check();
			$("claude-text").focus();
		}
	};
	$("claude-close").onclick = () => $("claude-toggle").click();
	$("claude-new").onclick = async () => {
		if (chat.busy) return;
		await api("/api/claude/reset", {});
		messages.innerHTML = `<div class="claude-hint">A new conversation: Claude doesn't remember the earlier one.</div>`;
	};
	$("claude-stop").onclick = () => api("/api/claude/stop", {});
	$("claude-form").onsubmit = event => {
		event.preventDefault();
		const message = $("claude-text").value.trim();
		if (message === "" || chat.busy) return;
		$("claude-text").value = "";
		send(message);
	};
	$("claude-text").onkeydown = event => {
		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();
			$("claude-form").requestSubmit();
		}
	};
}
