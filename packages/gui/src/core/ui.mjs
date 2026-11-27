// What every part of the GUI uses: running the CLI through the server, the console, the toast
// (noos's: a Linux project has none), escaping and linking. The core (app.mjs) and each
// ecosystem's part (../ecosystems/<id>/controller.mjs) import these, and nothing else of each other.

import { icon } from "./icons.mjs";

export const $ = id => document.getElementById(id);
export const esc = text => String(text ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** What ends a URL found in a text but is the sentence's: a full stop, a comma, a quote… */
const URL_TAIL = /[.,;:!?'"*]$/;
const URL_CLOSE = { ")": "(", "]": "[", "}": "{" };

/**
 * A description as HTML: escaped, its http:// and https:// URLs links (in a new tab, no opener,
 * no referrer), the punctuation after one left out of it (a full stop, a comma, a closing bracket
 * it doesn't open itself: …/Foo_(bar) keeps its own). For what a binding or a setting says: not a
 * validation message, a schema id or a file path.
 */
export function linkify(text) {
	const source = String(text ?? "");
	let html = "";
	let at = 0;
	for (const found of source.matchAll(/https?:\/\/[^\s<>"'`]+/g)) {
		let url = found[0];
		for (;;) {
			const last = url.at(-1) ?? "";
			const open = URL_CLOSE[last];
			const unopened = open !== undefined && url.split(open).length < url.split(last).length;
			if (!URL_TAIL.test(last) && !unopened) break;
			url = url.slice(0, -1);
		}
		// A scheme with nothing after it is no link.
		if (!/^https?:\/\/[^/]/.test(url)) continue;
		html += `${esc(source.slice(at, found.index))}<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a>`;
		at = found.index + url.length;
	}
	return html + esc(source.slice(at));
}

export const shell_quote = arg => /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, "'\\''")}'`;

/** The secret the server put in the page: every API call carries it (server.mjs). */
const TOKEN = document.querySelector('meta[name="aa-token"]')?.content ?? "";

/** A call to the server's API: JSON in, the response as it comes. */
export function api(path, body) {
	const headers = { "x-aa-token": TOKEN };
	if (body === undefined) return fetch(path, { headers });
	return fetch(path, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) });
}

export function log(html) {
	const out = $("console");
	out.insertAdjacentHTML("beforeend", html);
	out.scrollTop = out.scrollHeight;
}

/** Run `analog-attach ...args`: { code, stdout, stderr, json }. `quiet` keeps a read out of the console. */
export async function cli(args, { quiet = false } = {}) {
	// The GUI's own reads show in the console too when the preference says so.
	if (quiet && show_reads()) log(`<div class="read">· analog-attach ${esc(args.map(shell_quote).join(" "))}</div>`);
	if (!quiet) log(`<div class="cmd">$ analog-attach ${esc(args.map(shell_quote).join(" "))}</div>`);
	working(+1);
	let result;
	try {
		const response = await api("/api/run", { args });
		result = await response.json();
	} finally {
		working(-1);
	}
	if (!quiet) {
		const text = result.json?.message ?? `${result.stdout ?? ""}${result.stderr ?? result.error ?? ""}`.trimEnd();
		log(`<div class="${result.code === 0 ? "" : "fail"}">${esc(text)}</div>`);
	}
	return result;
}

/** How many CLI runs are under way: the bar under the header moves while there is one. */
let running = 0;
function working(change) {
	running = Math.max(0, running + change);
	document.body.classList.toggle("cli-working", running > 0);
}

/**
 * Whether the preferences have the console's (its height, the GUI's own reads). noos has them; a
 * Linux project has none, and its console never shows the reads. The core sets it per project (app.mjs).
 */
let console_options = true;
export function use_console_options(on) {
	console_options = on;
}
export const console_options_on = () => console_options;

/** Whether the console shows the reads the GUI makes on its own (Preferences; never without the console's preferences). */
export function show_reads() {
	if (!console_options) return false;
	try { return localStorage.getItem("aa-gui-show-reads") === "1"; } catch { return false; }
}

/**
 * Run a long command (build, deploy), its output into the console as it comes; the exit code, or
 * with `output` `{ code, text }`, what it wrote (a refusal exits 0 too: its text tells it apart).
 * `env`: variables for this run's environment alone (a secret deploy needs, by name): never shown
 * in the console, never on the command line.
 */
export async function stream(args, { output = false, env } = {}) {
	working(+1);
	try {
		const result = await stream_run(args, env);
		return output ? result : result.code;
	} finally {
		working(-1);
	}
}

async function stream_run(args, variables) {
	log(`<div class="cmd">$ analog-attach ${esc(args.map(shell_quote).join(" "))}</div>`);
	show_console();
	const response = await api("/api/stream", variables === undefined ? { args } : { args, env: variables });
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	const out = $("console");
	const block = document.createElement("div");
	out.append(block);
	let text = "";
	for (;;) {
		const { value, done } = await reader.read();
		if (done) break;
		text += decoder.decode(value, { stream: true });
		block.textContent = text.split("\u0000exit")[0];
		out.scrollTop = out.scrollHeight;
	}
	const code = Number(text.split("\u0000exit ")[1] ?? -1);
	log(`<div class="${code === 0 ? "okl" : "fail"}">${code === 0 ? "✔ done" : `✘ exited with ${code}`}</div>`);
	toast(code === 0 ? `${args[0]} finished` : `${args[0]} failed (exit ${code})`, code !== 0);
	return { code, text: text.split("\u0000exit")[0] };
}

export function first_line(text) {
	return (text ?? "").split("\n").find(line => line.trim() !== "")?.trim() ?? "Done";
}

/** The console opened if it is closed: what a build, a deploy or a validation says is there. */
export function show_console() {
	$("footer").classList.remove("collapsed");
}

/**
 * Whether the project's part has toasts. noos does; a Linux project has none: its part says a
 * refusal where it happened and an outcome in the console, and the core's own notices (a stream's
 * end, Open With, a new chat) are left out or said in place. The core sets it per project (app.mjs).
 */
let toasts = true;
export function use_toasts(on) {
	toasts = on;
}
export const toasts_on = () => toasts;

let toast_timer;
/** The message in the corner, for a while; nothing in a project without toasts (use_toasts). */
export function toast(text, error = false) {
	if (!toasts) return;
	const box = $("toast");
	box.textContent = text;
	box.className = `toast show${error ? " err" : ""}`;
	clearTimeout(toast_timer);
	toast_timer = setTimeout(() => { box.className = "toast"; }, 3500);
}

/** Whether the page is dark: the theme switch's choice, else the system's. */
export function is_dark() {
	const theme = document.documentElement.dataset.theme;
	return theme ? theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
}

/** A command line's words, as a shell would split them: spaces apart, '…' and "…" kept whole. */
export function split_words(line) {
	const words = [];
	let word = "";
	let quote = null;
	let started = false;
	for (const char of line) {
		if (quote !== null) {
			if (char === quote) quote = null;
			else word += char;
		} else if (char === "'" || char === '"') {
			quote = char;
			started = true;
		} else if (/\s/.test(char)) {
			if (started || word !== "") words.push(word);
			word = "";
			started = false;
		} else {
			word += char;
		}
	}
	if (started || word !== "") words.push(word);
	return words;
}

/**
 * A dialog in the middle of the page, Harmonic's modal: a title, the part's `body` (HTML), and a
 * footer with Cancel and the action (`action`, `danger` for a destructive one). `on_action(body)`
 * runs the action: it resolves true to close the dialog, false to keep it (a refusal shown in
 * it). Enter in a field is the action; Escape, Cancel or a click beside it close it.
 * Returns `{ body, close }`.
 */
export function open_dialog({ title, subtitle = "", body = "", action = "Confirm", danger = false, wide = false, on_action, on_close }) {
	document.getElementById("aa-dialog")?.remove();
	document.body.insertAdjacentHTML("beforeend", `
		<div id="aa-dialog" class="dialog-backdrop">
			<section class="dialog${wide ? " wide" : ""}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
				<div class="dialog-head"><h2>${esc(title)}</h2>${subtitle ? `<div class="subtle">${subtitle}</div>` : ""}</div>
				<div class="dialog-body">${body}</div>
				<div class="dialog-problem" hidden></div>
				<div class="dialog-foot">
					<button class="secondary" data-dialog-cancel>Cancel</button>
					<button class="${danger ? "danger-strong" : "primary"}" data-dialog-action>${esc(action)}</button>
				</div>
			</section>
		</div>`);
	const backdrop = document.getElementById("aa-dialog");
	const dialog = backdrop.querySelector(".dialog");
	const problem = backdrop.querySelector(".dialog-problem");
	const action_button = backdrop.querySelector("[data-dialog-action]");
	let closed = false;
	const on_key = event => {
		if (event.key === "Escape") close();
		// Enter in a field is the action, unless the field has its own Enter (data-own-enter).
		if (event.key === "Enter" && event.target.matches?.(".dialog input:not([data-own-enter])")) {
			event.preventDefault();
			act();
		}
	};
	function close() {
		if (closed) return;
		closed = true;
		document.removeEventListener("keydown", on_key, true);
		backdrop.classList.add("closing");
		setTimeout(() => backdrop.remove(), 140);
		on_close?.();
	}
	async function act() {
		if (action_button.disabled) return;
		action_button.disabled = true;
		problem.hidden = true;
		try {
			const result = on_action === undefined ? true : await on_action(dialog.querySelector(".dialog-body"));
			if (result === true) close();
			else if (typeof result === "string") {
				problem.hidden = false;
				problem.textContent = result;
			}
		} finally {
			action_button.disabled = false;
		}
	}
	backdrop.addEventListener("mousedown", event => { if (event.target === backdrop) close(); });
	backdrop.querySelector("[data-dialog-cancel]").onclick = close;
	action_button.onclick = act;
	document.addEventListener("keydown", on_key, true);
	requestAnimationFrame(() => {
		backdrop.classList.add("open");
		(dialog.querySelector(".dialog-body input:not([disabled]), .dialog-body select") ?? action_button).focus();
	});
	return { body: dialog.querySelector(".dialog-body"), close, problem: text => { problem.hidden = !text; problem.textContent = text ?? ""; } };
}

/** A yes-or-no question in a dialog: resolves true when the action is chosen. */
export function ask({ title, text = "", action, danger = false }) {
	return new Promise(resolve => {
		let answered = false;
		open_dialog({
			title,
			body: text ? `<p>${text}</p>` : "",
			action,
			danger,
			on_action: () => { answered = true; resolve(true); return true; },
			on_close: () => { if (!answered) resolve(false); },
		});
	});
}

/**
 * A panel floating in the middle of the page (adding a device, both ecosystems): `title`,
 * a `subtitle`, and the part's `body` (HTML). Escape, ✕ or a click beside it closes it.
 * Returns `{ body, close }`: the element to draw in, and how to close it from the part.
 */
export function open_panel({ title, subtitle = "", body = "", wide = false, on_close }) {
	document.getElementById("aa-panel")?.remove();
	document.body.insertAdjacentHTML("beforeend", `
		<div id="aa-panel" class="panel-backdrop">
			<section class="panel${wide ? " wide" : ""}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
				<div class="panel-head">
					<div><h2>${esc(title)}</h2>${subtitle ? `<div class="subtle">${subtitle}</div>` : ""}</div>
					<div class="spacer"></div>
					<button class="ghost" data-panel-close title="Close (Esc)">✕</button>
				</div>
				<div class="panel-body">${body}</div>
			</section>
		</div>`);
	const backdrop = document.getElementById("aa-panel");
	const on_key = event => { if (event.key === "Escape") close(); };
	function close() {
		document.removeEventListener("keydown", on_key);
		backdrop.classList.add("closing");
		setTimeout(() => backdrop.remove(), 160);
		on_close?.();
	}
	backdrop.addEventListener("mousedown", event => { if (event.target === backdrop) close(); });
	backdrop.querySelector("[data-panel-close]").onclick = close;
	document.addEventListener("keydown", on_key);
	requestAnimationFrame(() => backdrop.classList.add("open"));
	return { body: backdrop.querySelector(".panel-body"), close };
}

/**
 * An (i) button for what `label` is: a click shows or hides the `info_text` of the same
 * `[data-info]` element (a setting's row), hidden until then.
 */
export function info_button(label) {
	return `<button type="button" class="info-toggle" data-info-toggle aria-expanded="false" title="About ${esc(label)}" aria-label="About ${esc(label)}">${icon("information")}</button>`;
}

/** The text an `info_button` shows (HTML, escaped by the caller). */
export function info_text(html, class_name = "") {
	return `<div class="info-text${class_name ? ` ${class_name}` : ""}" data-info-text hidden>${html}</div>`;
}

document.addEventListener("click", event => {
	const button = event.target.closest?.("[data-info-toggle]");
	const text = button?.closest("[data-info]")?.querySelector("[data-info-text]");
	if (!text) {
		return;
	}
	text.hidden = !text.hidden;
	button.setAttribute("aria-expanded", String(!text.hidden));
});
