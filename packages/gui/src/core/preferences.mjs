// The GUI's preferences: how the tool itself looks and behaves, not the project's settings (those
// are the ecosystem's: `analog-attach config`, the setup). One panel from the header, in sections:
// the core's (appearance, layout, files, console, assistant), then the mounted part's own, About last.
// A section with nothing shown is left out: a Linux project has no layout or console (no menu to fold,
// no console preferences: ui.mjs use_console_options).
//
// A preference is kept in the browser (localStorage) and applies at once; the assistant's are the
// GUI server's, kept in the user's settings (../assistant.mjs). A part adds its own by
// `preferences` in what its mount resolves with: [{ title, items: [preference] }], where a
// preference is { label, hint, kind: "choice" | "switch" | "action" | "text" | "secret", options,
// placeholder (or placeholder()), value(), set(v) }, and `shown()`, when it says false, hides it (asked again
// after each change in its section: the assistant's server fields show only for the server). A text or
// secret is set when it changes (Enter, or leaving the field); a `set` that resolves with a
// string has refused it: the string says why, under the section's title.
//
// A part whose project settings are its own (linux) resolves with `project` too: { title, draw(box,
// { close }) }. The panel then has two tabs, that one first (the part draws it, and handles what
// is clicked in it), then Preferences.

import { file_picker, native_dialog, set_file_picker } from "./paths.mjs";
import { api, cli, console_options_on, esc, open_panel } from "./ui.mjs";

const keep = (key, value) => { try { if (value === undefined) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch {} };
const kept = key => { try { return localStorage.getItem(key); } catch { return null; } };

/** The theme: the system's, or light or dark whatever it says. */
export function apply_theme(theme) {
	const root = document.documentElement;
	if (theme === "light" || theme === "dark") root.dataset.theme = theme;
	else delete root.dataset.theme;
	window.dispatchEvent(new Event("aa-theme"));
}

/**
 * The assistant's settings saved (`changes`: provider, agent, url, model, api_key) into `chat`, what
 * the server has; the chat checks the model again. Resolves with why the server refused them, if
 * it did.
 */
async function save_chat(chat, changes) {
	const response = await api("/api/chat/settings", changes);
	const body = await response.json().catch(() => ({}));
	if (!response.ok) return body.error ?? `The server said ${response.status}`;
	Object.assign(chat, body);
	window.dispatchEvent(new Event("aa-chat-settings"));
	return undefined;
}

/**
 * The core's sections: what any project has. `context` is the core's (open_setup, the part);
 * `chat` the assistant's settings, as the server has them (/api/chat/settings).
 */
function core_sections(context, chat) {
	/** Whether a server answers (Preferences → Assistant → Server), not an executable. */
	const server = () => chat.provider === "openai";
	return [
		{
			title: "Appearance",
			items: [{
				label: "Theme", kind: "choice",
				options: [["system", "System"], ["light", "Light"], ["dark", "Dark"]],
				value: () => kept("aa-gui-theme") ?? "system",
				set: theme => { keep("aa-gui-theme", theme === "system" ? undefined : theme); apply_theme(theme); },
			}],
		},
		{
			title: "Layout",
			items: [
				{
					label: "Menu folded", hint: "The menu on the left as a strip of icons.", kind: "switch",
					// A part with no menu (linux) has nothing to fold.
					shown: () => document.querySelector("#main > nav") !== null,
					value: () => document.body.classList.contains("nav-collapsed"),
					set: on => { if (on !== document.body.classList.contains("nav-collapsed")) document.querySelector("[data-nav-toggle]")?.click(); },
				},
				{
					label: "Console height", hint: "Drag its top edge to change it.", kind: "action", action: "Reset Height",
					// A part without the console's preferences (linux) has none.
					shown: console_options_on,
					set: () => { document.getElementById("footer").style.height = ""; keep("aa-gui-console-height"); },
				},
			],
		},
		{
			title: "Files",
			items: [{
				label: "File picker", kind: "choice",
				options: [["built-in", "Built-in"], ["native", "Native"]],
				value: file_picker,
				set: set_file_picker,
				// Nothing for the built-in picker; for the native one, what opens it.
				note: async () => {
					if (file_picker() === "built-in") return "";
					const dialog = await native_dialog();
					if (dialog.with === "portal") return "Uses xdg-desktop-portal.";
					return dialog.available ? `Uses <code>${esc(dialog.with)}</code>.` : "No native dialog here: no desktop portal with a file chooser, and no zenity, kdialog or yad (macOS has its own). Browse… opens the built-in one.";
				},
			}],
		},
		{
			title: "Console",
			items: [{
				label: "Show the GUI's own reads", hint: "Every analog-attach call the GUI makes to read the project, greyed, beside the commands.", kind: "switch",
				shown: console_options_on,
				value: () => kept("aa-gui-show-reads") === "1",
				set: on => keep("aa-gui-show-reads", on ? "1" : undefined),
			}],
		},
		{
			title: "Assistant",
			items: [
				{
					label: "Model", kind: "choice",
					options: [["executable", "Executable"], ["server", "Server"]],
					value: () => (server() ? "server" : "executable"),
					// Back to the executable last used; to the server, keeping which that was.
					set: kind => save_chat(chat, kind === "server" ? { provider: "openai", agent: chat.agent } : { provider: chat.agent ?? "claude" }),
				},
				{
					label: "Agent", hint: "Its login is yours. Claude Code and Gemini CLI may run analog-attach commands only. Codex CLI has no list of the commands it may run: its sandbox is its only limit, run with no approvals, writing in the project folder alone, with the network on (Deploy reaches the board).", kind: "choice",
					shown: () => !server(),
					options: (chat.agents ?? ["claude"]).map(agent => [agent, chat.providers?.[agent] ?? agent]),
					value: () => chat.provider,
					set: agent => save_chat(chat, { provider: agent, agent }),
				},
				{
					label: "Endpoint", hint: "The API's base URL, before /chat/completions. https://api.openai.com/v1, http://localhost:11434/v1 (Ollama), http://localhost:1234/v1 (LM Studio).", kind: "text",
					shown: server,
					placeholder: "http://localhost:11434/v1",
					value: () => chat.url ?? "",
					set: url => save_chat(chat, { url }),
				},
				{
					label: "Model name", hint: "The model as the endpoint names it (gpt-4.1, qwen3:32b, …). It needs tool calls.", kind: "text",
					shown: server,
					placeholder: "qwen3:32b",
					value: () => chat.model ?? "",
					set: model => save_chat(chat, { model }),
				},
				{
					label: "API key", hint: "Sent to the endpoint only, kept in your own settings, never in the project. Left empty: none (a local server).", kind: "secret",
					shown: server,
					placeholder: () => (chat.key_set ? "set: type a new one to change it" : "none"),
					value: () => "",
					set: api_key => save_chat(chat, { api_key }),
				},
			],
			about: async () => {
				const status = await (await api("/api/chat")).json().catch(() => ({}));
				return status.available ? esc(status.version ?? "") : status.problem ?? "The model can't answer.";
			},
		},
	];
}

/** The About section, the panel's last: the version, and the setup to reopen where the part has one. */
function about_section(context) {
	return {
		title: "About",
		items: [{
			label: "Project setup", hint: "The ecosystem and its settings, for this project: the project's, not the tool's.", kind: "action", action: "Open Setup",
			// A part with its project settings in its own tab (setup_option: false, linux) has no setup to reopen.
			shown: () => context.part()?.setup_option !== false,
			set: () => context.open_setup(),
		}],
		about: async () => {
			const version = await cli(["--version"], { quiet: true });
			return `Analog Attach ${esc((version.stdout || "").trim() || "?")}`;
		},
	};
}

/** A text's placeholder: given, or what `placeholder()` says now. */
const placeholder = item => (typeof item.placeholder === "function" ? item.placeholder() : item.placeholder ?? "");

function item_html(item, section_index, item_index) {
	const id = `pref-${section_index}-${item_index}`;
	let control = "";
	if (item.kind === "choice") {
		const value = item.value();
		control = `<div class="pref-choice" role="radiogroup">${item.options.map(([option, text]) => `<button class="${option === value ? "on" : ""}" data-pref="${id}" data-value="${esc(option)}">${esc(text)}</button>`).join("")}</div>`;
	} else if (item.kind === "switch") {
		control = `<label class="switch"><input type="checkbox" data-pref="${id}"${item.value() ? " checked" : ""}><span></span></label>`;
	} else if (item.kind === "text" || item.kind === "secret") {
		control = `<input class="pref-field" type="${item.kind === "secret" ? "password" : "text"}" data-pref="${id}" value="${esc(item.value())}" placeholder="${esc(placeholder(item))}" spellcheck="false" autocomplete="off">`;
	} else {
		control = `<button data-pref="${id}">${esc(item.action)}</button>`;
	}
	return `<div class="pref-row" data-pref-row="${id}"${item.shown?.() === false ? " hidden" : ""}><div class="pref-text"><div class="pref-label">${esc(item.label)}</div>${item.hint ? `<div class="pref-hint">${esc(item.hint)}</div>` : ""}${item.note ? `<div class="pref-hint" data-note="${id}"></div>` : ""}</div><div class="pref-control">${control}</div></div>`;
}

/**
 * Open the preferences: the core's sections, then the part's (`part.preferences`), then About. With the
 * part's Project tab (`part.project`), the panel has it first, then Preferences; `tab` opens on
 * one ("project", "preferences"), the first by default; `section` (a title: "Assistant") scrolls
 * to that section, its first control focused.
 */
export async function open_preferences(context, { tab, section: go_to } = {}) {
	const part = context.part();
	const project = part?.project;
	const chat = await (await api("/api/chat/settings")).json().catch(() => ({}));
	const sections = [...core_sections(context, chat), ...(part?.preferences ?? []), about_section(context)]
		.filter(section => section.items.some(item => item.shown?.() !== false) || section.about);
	const items = new Map();
	const html = sections.map((section, at) => {
		section.items.forEach((item, index) => items.set(`pref-${at}-${index}`, { ...item, at }));
		return `<section class="pref-section" data-pref-section="${esc(section.title)}"><h3>${esc(section.title)}</h3>${section.about ? `<div class="pref-about subtle" data-about="${at}">…</div>` : ""}${section.items.map((item, index) => item_html(item, at, index)).join("")}</section>`;
	}).join("");
	const prefs = `<div class="prefs">${html}</div>`;
	const project_title = project?.title ?? "Project";
	const panel = project === undefined
		? open_panel({ title: "Preferences", subtitle: "How Analog Attach looks and behaves. The project's settings are in its setup.", body: prefs })
		: open_panel({
			title: "Settings",
			wide: true,
			body: `<div class="pref-tabs" role="tablist">
					<button class="pref-tab" role="tab" data-pref-tab="project">${esc(project_title)}</button>
					<button class="pref-tab" role="tab" data-pref-tab="preferences">Preferences</button>
				</div>
				<div class="pref-pane" data-pref-pane="project" role="tabpanel"><div class="pref-project"></div></div>
				<div class="pref-pane" data-pref-pane="preferences" role="tabpanel">${prefs}</div>`,
		});
	if (project !== undefined) {
		const show = name => {
			for (const button of panel.body.querySelectorAll("[data-pref-tab]")) {
				const on = button.dataset.prefTab === name;
				button.classList.toggle("active", on);
				button.setAttribute("aria-selected", String(on));
			}
			for (const pane of panel.body.querySelectorAll("[data-pref-pane]")) pane.hidden = pane.dataset.prefPane !== name;
		};
		show(tab === "preferences" ? "preferences" : "project");
		panel.body.querySelector(".pref-tabs").addEventListener("click", event => {
			const button = event.target.closest("[data-pref-tab]");
			if (button !== null) show(button.dataset.prefTab);
		});
		// The part draws its tab, and handles what is clicked in it.
		void project.draw(panel.body.querySelector(".pref-project"), { close: panel.close });
	}
	panel.body.addEventListener("click", async event => {
		const button = event.target.closest("button[data-pref]");
		if (button === null) return;
		const item = items.get(button.dataset.pref);
		if (item.kind === "choice") {
			const refused = await item.set(button.dataset.value);
			if (typeof refused !== "string") for (const other of panel.body.querySelectorAll(`button[data-pref="${button.dataset.pref}"]`)) other.classList.toggle("on", other === button);
			reshow(item.at);
			await about(item.at, refused);
		} else {
			if (item.action === "Open Setup") panel.close();
			await about(item.at, await item.set());
		}
	});
	panel.body.addEventListener("change", async event => {
		const input = event.target.closest("input[data-pref]");
		if (input === null) return;
		const item = items.get(input.dataset.pref);
		const refused = await item.set(input.type === "checkbox" ? input.checked : input.value);
		// A secret isn't shown back: the field empties, its placeholder says whether one is set.
		if (item.kind === "secret" && typeof refused !== "string") {
			input.value = "";
			input.placeholder = placeholder(item);
		}
		await about(item.at, refused);
	});
	/** The section's preferences shown or hidden again, and their values, after one of them changed. */
	function reshow(at) {
		sections[at].items.forEach((item, index) => {
			const id = `pref-${at}-${index}`;
			const row = panel.body.querySelector(`[data-pref-row="${id}"]`);
			if (row !== null && item.shown !== undefined) row.hidden = item.shown() === false;
			if (item.kind === "choice") {
				const value = item.value();
				for (const option of panel.body.querySelectorAll(`button[data-pref="${id}"]`)) option.classList.toggle("on", option.dataset.value === value);
			}
		});
	}
	/**
	 * The section's about and its preferences' notes (`note()`: HTML in the hint's place), again,
	 * after one of its preferences changed; `refused`: why the change was refused, under the about.
	 */
	async function about(at, refused) {
		const section = sections[at];
		for (const [index, item] of (section?.items ?? []).entries()) {
			const note = item.note && panel.body.querySelector(`[data-note="pref-${at}-${index}"]`);
			if (note) note.innerHTML = await item.note();
		}
		const box = panel.body.querySelector(`[data-about="${at}"]`);
		if (!section?.about || box === null) return;
		box.innerHTML = await section.about();
		if (typeof refused === "string") box.insertAdjacentHTML("beforeend", `<div class="pref-problem" role="alert">${esc(refused)}</div>`);
	}
	sections.forEach((_, at) => { void about(at); });
	const target = go_to === undefined ? null : [...panel.body.querySelectorAll("[data-pref-section]")].find(box => box.dataset.prefSection === go_to);
	if (target) {
		target.scrollIntoView({ block: "start" });
		(target.querySelector("button[data-pref].on") ?? target.querySelector("button[data-pref], input[data-pref]"))?.focus({ preventScroll: true });
	}
}
