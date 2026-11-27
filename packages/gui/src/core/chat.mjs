// The chat with the assistant, the core's: a panel on the right, opened from the console bar, the
// same for every ecosystem; a part may dock it in its own screen instead (the Linux part: its
// right column, in the overlay's place). The user writes what they want; the server has a model
// answer it in the project (../assistant.mjs): the user's Claude Code, Codex CLI or Gemini CLI,
// or any model behind an OpenAI-compatible endpoint (Preferences → Assistant). It may run `analog-attach` commands
// only, and its answer streams in: its text as it writes it, each command it runs with what it
// answered, and anything it was refused. After each command the mounted part reads the project
// again, so the change shows beside the chat.
//
// The part says what the model should know (`chat` in what its mount resolves with): the skill
// that teaches it the ecosystem's CLI, examples for the hint, and a line on what is on screen;
// and, to dock the panel, where (`dock`).

import { $, api, cli, esc, log, toast, toasts_on } from "./ui.mjs";

/** A line of a reply as HTML: escaped, with `code` and **bold**. */
const inline = text => esc(text).replace(/`([^`\n]+)`/g, "<code>$1</code>").replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>");

/** A Markdown table's lines (`| a | b |`, the `|---|` line below the head) as an HTML table. */
function table(lines) {
	const cells = line => line.trim().replace(/^\||\|$/g, "").split("|").map(cell => cell.trim());
	const [head, , ...rows] = lines;
	return `<table class="chat-table"><thead><tr>${cells(head).map(cell => `<th>${inline(cell)}</th>`).join("")}</tr></thead>`
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
 * Add the chat to the page, once. `button_area` is where its button goes (the console bar);
 * `open_settings()` opens Preferences on the Assistant, where the model is chosen; `part()` the mounted part's chat, `{ skill, hint, context(), dock? }`, or undefined; `changed()`
 * has the part read the project again. Returns `part_changed()`, for the core to call on a new
 * part, or on the part shown again after the setup.
 *
 * A part's `dock`, `{ place(panel, changed), shown(), show(), hide() }`, has the panel in its
 * screen: `place` puts it there and keeps `changed`, to call when the panel comes on screen or
 * leaves it; `shown()` says whether it is on screen, `show()` and `hide()` bring it or take it
 * away (the ✦ Assistant button). Without one, the panel is the core's, on the right of the page.
 */
export function mount_chat({ button_area, open_settings, part, changed: read_again }) {
	// open: the core's panel on screen (a part's dock says for its own); placed: the dock it is in.
	const chat = { open: false, busy: false, blocked: false, checked_for: undefined, timer: undefined, placed: undefined, shown: false };
	// The model may run several commands in a row: read the project once they settle.
	const changed = () => {
		clearTimeout(chat.timer);
		chat.timer = setTimeout(read_again, 400);
	};
	button_area.insertAdjacentHTML("beforeend", `<button id="chat-toggle" class="chat-button" title="Ask the assistant to change the project">✦ Assistant</button>`);
	document.body.insertAdjacentHTML("beforeend", `
		<aside id="chat" class="chat" hidden>
			<div class="chat-bar">
				<strong>✦ Assistant</strong><span class="subtle" id="chat-version"></span>
				<div class="spacer"></div>
				<button class="ghost" id="chat-new" title="Start a new conversation">New Chat</button>
				<button class="ghost" id="chat-close" title="Close">✕</button>
			</div>
			<div class="chat-notice" id="chat-notice" hidden></div>
			<div class="chat-messages" id="chat-messages"><div class="chat-hint" id="chat-hint"></div></div>
			<form class="chat-input" id="chat-form">
				<textarea id="chat-text" rows="3" placeholder="Ask the assistant… (Enter to send, Shift+Enter for a new line)"></textarea>
				<div class="actions-row" id="chat-actions" hidden><button id="chat-stop" type="button">Stop Answer</button></div>
			</form>
		</aside>`);
	const panel = $("chat");
	const messages = $("chat-messages");

	const add = html => {
		messages.insertAdjacentHTML("beforeend", html);
		messages.scrollTop = messages.scrollHeight;
		return messages.lastElementChild;
	};
	const set_busy = busy => {
		chat.busy = busy;
		$("chat-actions").hidden = !busy;
		$("chat-text").disabled = busy;
	};
	const hint = () => {
		const element = $("chat-hint");
		if (element === null) return;
		const examples = part()?.hint ?? "";
		element.innerHTML = `Tell the assistant what to change, in your words${examples ? `: ${examples}` : ""}. It runs <code>analog-attach</code> commands for you, and nothing else; each one shows here and in the console.`;
	};

	/** The ✦ Assistant button lit while the panel is on screen; on coming on screen, the hint and the checks. */
	const sync = () => {
		const shown = chat.placed === undefined ? chat.open : chat.placed.shown();
		$("chat-toggle").classList.toggle("on", shown);
		if (shown && !chat.shown) {
			hint();
			check();
			$("chat-text").focus({ preventScroll: true });
		}
		chat.shown = shown;
	};
	/** The core's panel open or closed. */
	const set_open = open => {
		chat.open = open;
		panel.hidden = !open;
		document.body.classList.toggle("with-chat", open);
	};
	/** The panel where the part wants it: in its dock, or the core's on the right of the page (the setup: no part). */
	const place = () => {
		const dock = part()?.dock;
		if (dock === chat.placed && panel.isConnected) return dock;
		const was_open = chat.placed === undefined ? chat.open : chat.placed.shown();
		chat.placed = dock;
		panel.classList.toggle("docked", dock !== undefined);
		if (dock === undefined) {
			document.body.append(panel);
			set_open(false);
		} else {
			set_open(false);
			panel.hidden = false;
			dock.place(panel, sync);
			// Open on the way in: open in the part too.
			if (was_open) dock.show();
		}
		sync();
		return dock;
	};

	/** On opening, once per part (and after Preferences changed the model): can the model answer, and, for an agent, is the part's skill installed for it? */
	async function check() {
		const skill_name = part()?.skill;
		if (chat.checked_for === (skill_name ?? "")) return;
		chat.checked_for = skill_name ?? "";
		const notice = $("chat-notice");
		notice.hidden = true;
		chat.blocked = false;
		const status = await (await api("/api/chat")).json().catch(() => ({ available: false, problem: "The GUI's server didn't answer." }));
		$("chat-version").textContent = status.available ? status.version ?? "" : "";
		if (!status.available) {
			notice.hidden = false;
			// The problem is the server's own text (HTML: a <code> in it).
			notice.innerHTML = `<span class="chat-notice-text">${status.problem ?? "The model can't answer."}</span><button class="secondary" id="chat-setup">Choose Model</button>`;
			$("chat-setup").onclick = () => open_settings();
			chat.blocked = true;
			return;
		}
		// The server has no skills of its own: it puts the part's skill in the model's prompt.
		if (skill_name === undefined || status.provider === "openai") return;
		const agent = ["--agent", status.provider];
		const skills = await cli(["skill", "install", ...agent, "--json"], { quiet: true });
		const skill = skills.json?.skills?.find(candidate => candidate.name === skill_name);
		if (skill !== undefined && !skill.installed) {
			notice.hidden = false;
			notice.innerHTML = `<span class="chat-notice-text">The <code>${esc(skill_name)}</code> skill teaches ${esc(status.name ?? "the agent")} the CLI: it works better with it.</span><button class="secondary" id="chat-skill">Install Skill</button>`;
			$("chat-skill").onclick = async () => {
				notice.querySelector(".chat-notice-problem")?.remove();
				const result = await cli(["skill", "install", skill_name, ...agent, "--json"]);
				const problem = result.json?.message ?? "The skill wasn't installed";
				if (result.json?.ok) notice.hidden = true;
				// A project without toasts (linux): the refusal under the button.
				else if (toasts_on()) toast(problem, true);
				else notice.insertAdjacentHTML("beforeend", `<div class="chat-notice-problem" role="alert">${esc(problem)}</div>`);
			};
		}
	}

	/** One message: send it, and show the model's answer as it streams in. */
	async function send(message) {
		set_busy(true);
		add(`<div class="chat-msg user">${format(message)}</div>`);
		let bubble;          // the model's text being written
		const cards = {};    // tool_use id -> its card
		const write = text => {
			bubble ??= add(`<div class="chat-msg assistant"></div>`);
			bubble.dataset.text = (bubble.dataset.text ?? "") + text;
			bubble.innerHTML = format(bubble.dataset.text);
			messages.scrollTop = messages.scrollHeight;
		};
		// The server's events (../assistant.mjs), whichever model answers.
		const handle = event => {
			if (event.type === "turn") {
				bubble = undefined;
			} else if (event.type === "text") {
				write(event.text);
			} else if (event.type === "command" && cards[event.id] === undefined) {
				cards[event.id] = add(`<div class="chat-cmd"><div class="mono">$ ${esc(event.command)}</div></div>`);
				log(`<div class="cmd">✦ $ ${esc(event.command)}</div>`);
				bubble = undefined;
			} else if (event.type === "output") {
				const card = cards[event.id];
				const output = String(event.output ?? "");
				if (card !== undefined) {
					card.classList.add(event.refused ? "refused" : event.failed ? "failed" : "done");
					card.insertAdjacentHTML("beforeend", event.refused
						? `<div class="chat-refused">Not allowed: the assistant may run analog-attach commands only.</div><details><summary>why</summary><pre>${esc(output.slice(0, 6000))}</pre></details>`
						: `<details><summary>${event.failed ? "failed" : "output"}</summary><pre>${esc(output.slice(0, 6000))}</pre></details>`);
				}
				if (!event.refused) changed();
			} else if (event.type === "result") {
				const cost = typeof event.cost_usd === "number" ? ` · $${event.cost_usd.toFixed(3)}` : "";
				const seconds = typeof event.seconds === "number" ? ` · ${event.seconds.toFixed(0)} s` : "";
				if (event.error) add(`<div class="chat-msg error">${format(event.error)}</div>`);
				add(`<div class="chat-meta">${event.ok ? "done" : "not done"}${seconds}${cost}</div>`);
			} else if (event.type === "gui_done" && event.code !== 0 && event.code !== null) {
				add(`<div class="chat-msg error">The assistant stopped (exit ${esc(event.code)})${event.stderr ? `: ${esc(event.stderr)}` : ""}</div>`);
			}
		};
		try {
			const response = await api("/api/chat", { message, context: part()?.context?.() ?? "", skill: part()?.skill ?? "" });
			if (!response.ok) {
				const problem = await response.json().catch(() => ({}));
				add(`<div class="chat-msg error">${esc(problem.error ?? `The server said ${response.status}`)}</div>`);
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
			add(`<div class="chat-msg error">${esc(String(error))}</div>`);
		} finally {
			set_busy(false);
			changed();
			$("chat-text").focus();
		}
	}

	$("chat-toggle").onclick = () => {
		const dock = place();
		if (dock === undefined) set_open(!chat.open);
		else if (dock.shown()) dock.hide();
		else dock.show();
		sync();
	};
	$("chat-close").onclick = () => $("chat-toggle").click();
	$("chat-new").onclick = async () => {
		if (chat.busy) return;
		await api("/api/chat/reset", {});
		messages.innerHTML = `<div class="chat-hint">A new conversation: the assistant doesn't remember the earlier one.</div>`;
	};
	$("chat-stop").onclick = () => api("/api/chat/stop", {});
	$("chat-form").onsubmit = event => {
		event.preventDefault();
		const message = $("chat-text").value.trim();
		// The model can't answer (the notice says why): Enter sends nothing.
		if (message === "" || chat.busy || chat.blocked) return;
		$("chat-text").value = "";
		send(message);
	};
	$("chat-text").onkeydown = event => {
		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();
			$("chat-form").requestSubmit();
		}
	};

	// Preferences changed the model: check it again, now if the panel is on screen.
	window.addEventListener("aa-chat-settings", () => {
		chat.checked_for = undefined;
		if (chat.shown) check();
	});

	return {
		/** Another part was mounted, or shown again: the panel where it wants it, and its skill and hint, now if the panel is on screen. */
		part_changed() {
			chat.checked_for = undefined;
			place();
			if (chat.shown) {
				hint();
				check();
			}
		},
	};
}
