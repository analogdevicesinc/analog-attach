// Paths in the page: a field that suggests what is there as you type, and a file picker (Browse…).
// Both read folders through the server (/api/files: names, and whether each is a folder): the
// CLI's own completion of paths is the shell's, which the page hasn't. What a setting takes, a
// folder or a file of some kind, is PATH_KINDS's; the CLI still checks the value when it is saved.
// The picker is the desktop's (/api/dialog: the server opens it: the desktop portal's, else zenity,
// kdialog, yad, or macOS's), which hasn't the page's "Or a new file here"; by Preferences → Files,
// or where the desktop's can't open, the page's own.

import { api, esc, open_dialog } from "./ui.mjs";

/** What each path setting takes: a folder, or a file with one of these extensions. */
export const PATH_KINDS = {
	linux: { dir: true, about: "the Linux kernel tree" },
	devicetree: { extensions: [".dts"], about: "the base devicetree, a .dts" },
	workfile: { extensions: [".dtso", ".dts", ".json"], new_file: true, about: "the workfile; a new name makes one" },
	"capi-path": { dir: true, about: "the CAPI checkout" },
	"module-paths": { dir: true, about: "a module repository" },
	"build-dir": { dir: true, new_file: true, about: "the build folder" },
};

/** The kind of a setting's path: PATH_KINDS's, or any file or folder. */
export const path_kind = key => PATH_KINDS[key] ?? {};

/** A folder's entries from the server: { path, parent, home, entries } or { error }. */
export async function list_folder(path, { hidden = false } = {}) {
	const response = await api(`/api/files?path=${encodeURIComponent(path)}${hidden ? "&hidden=1" : ""}`);
	return response.json().catch(() => ({ error: "No answer" }));
}

/** Whether an entry fits a kind: every folder (to go into), and the files of its extensions. */
function fits(entry, kind) {
	if (entry.dir) return true;
	if (kind.dir) return false;
	return kind.extensions === undefined || kind.extensions.some(extension => entry.name.endsWith(extension));
}

let lists = 0;

/**
 * A path field, as HTML: the input (its `attributes` added to it), a datalist the typing fills, and
 * Browse…. `key` is the setting, for its kind. `attach_paths(root)` makes the fields in `root` work.
 */
export function path_field(key, value, attributes = "", { placeholder = "a path; ~ for your home folder" } = {}) {
	const list = `aa-paths-${++lists}`;
	return `<span class="path-field" data-path-key="${esc(key)}">
		<input ${attributes} value="${esc(value ?? "")}" placeholder="${esc(placeholder)}" spellcheck="false" list="${list}" autocomplete="off" data-path-input>
		<datalist id="${list}"></datalist>
		<button type="button" class="secondary" data-path-browse title="Pick ${esc(path_kind(key).about ?? "a path")}">Browse…</button>
	</span>`;
}

/**
 * Make the path fields in `root` work: as one is typed in, its list offers the entries of the
 * folder typed so far that fit its kind; Browse… opens the picker on what is typed, and puts what
 * is picked in. `on_pick(field, path)` runs after a pick (a list of paths adds a line instead).
 */
export function attach_paths(root, { on_pick } = {}) {
	let timer;
	root.addEventListener("input", event => {
		const input = event.target.closest?.("[data-path-input]");
		if (input === null) return;
		clearTimeout(timer);
		timer = setTimeout(() => suggest(input), 120);
	});
	root.addEventListener("focusin", event => {
		const input = event.target.closest?.("[data-path-input]");
		if (input !== null && input.list?.children.length === 0) suggest(input);
	});
	root.addEventListener("click", async event => {
		const button = event.target.closest?.("[data-path-browse]");
		if (button === null) return;
		event.preventDefault();
		const field = button.closest(".path-field");
		const input = field.querySelector("[data-path-input]") ?? field.querySelector("textarea");
		const key = field.dataset.pathKey;
		const typed = input.tagName === "TEXTAREA" ? "" : input.value.trim();
		const picked = await browse_path({ key, start: typed });
		if (picked === undefined) return;
		if (on_pick !== undefined) on_pick(input, picked);
		else {
			input.value = picked;
			input.dispatchEvent(new Event("input", { bubbles: true }));
			input.focus();
		}
	});
}

/** The list of a field: the entries of the folder typed so far (up to its last /) that fit. */
async function suggest(input) {
	const key = input.closest(".path-field")?.dataset.pathKey;
	const kind = path_kind(key);
	const typed = input.value;
	const cut = typed.lastIndexOf("/");
	const folder = cut === -1 ? (typed.startsWith("~") ? "~" : ".") : typed.slice(0, cut + 1) || "/";
	const start = cut === -1 ? (typed.startsWith("~") ? "~/" : "") : typed.slice(0, cut + 1);
	const partial = cut === -1 ? (typed.startsWith("~") ? "" : typed) : typed.slice(cut + 1);
	const listing = await list_folder(folder, { hidden: partial.startsWith(".") });
	if (listing.error || input.value !== typed) return;
	// . and .., which a folder doesn't list: the way to the project's folder and the one above.
	const ups = cut === -1 || /(^|\/)\.{1,2}\/$/.test(start) ? ["./", "../"].filter(up => partial !== "" && up.startsWith(partial) && (cut === -1 || up === "../")).map(up => `${start}${up}`) : [];
	const options = [...ups.map(up => `<option value="${esc(up)}"></option>`), ...listing.entries
		.filter(entry => entry.name.startsWith(partial) && fits(entry, kind))
		.slice(0, 200)
		.map(entry => `<option value="${esc(`${start}${entry.name}${entry.dir ? "/" : ""}`)}"></option>`)];
	if (input.list) input.list.innerHTML = options.join("");
}

const PICKER = "aa-gui-file-picker";

/** The picker Browse… opens: "native" (the desktop's dialog, the default) or "built-in" (the page's). */
export function file_picker() {
	try { return localStorage.getItem(PICKER) === "built-in" ? "built-in" : "native"; } catch { return "native"; }
}

export function set_file_picker(picker) {
	try { if (picker === "built-in") localStorage.setItem(PICKER, picker); else localStorage.removeItem(PICKER); } catch {}
}

/** The native dialog the server has: { available, with? }, or { available: false } when it doesn't say. */
export async function native_dialog() {
	const response = await api("/api/dialog").catch(() => {});
	return response?.ok ? response.json().catch(() => ({ available: false })) : { available: false };
}

/** The folder a picker starts in: that of what is typed, else the home folder. */
function start_folder(kind, start) {
	if (start === "") return "~";
	return kind.dir || start.endsWith("/") ? start : start.slice(0, start.lastIndexOf("/") + 1) || "~";
}

/**
 * The file picker: the native dialog when the preference is that (`file_picker()`), else, or when
 * it can't open (said in the page's picker), the page's own. Resolves with the path picked, or
 * undefined when closed.
 */
export async function browse_path({ key, start = "", title } = {}) {
	const kind = path_kind(key);
	const heading = title ?? `Choose ${kind.about ?? "a path"}`;
	if (file_picker() !== "native") return built_in_picker({ kind, start, title: heading });
	const response = await api("/api/dialog", { dir: kind.dir === true, extensions: kind.extensions ?? [], title: heading, start: start_folder(kind, start) }).catch(() => {});
	let answer;
	if (response === undefined) answer = { error: "The GUI's server did not answer." };
	else if (response.status === 404) answer = { error: "This GUI's server is older than the page and has no native dialog: restart analog-attach gui." };
	else answer = await response.json().catch(() => ({ error: "No answer" }));
	if (answer.path !== undefined) return answer.path;
	if (answer.cancelled) return;
	return built_in_picker({ kind, start, title: heading, note: `The native file dialog didn't open: ${answer.error}` });
}

/**
 * The page's picker: a dialog on a folder (`start`, else the home folder), its entries that fit
 * `kind`, folders to go into, a file or the folder itself to pick; `note`, why it is this one.
 */
function built_in_picker({ kind, start, title, note }) {
	return new Promise(resolve => {
		let picked;
		let current = "";
		let hidden = false;
		let selected = "";
		const dialog = open_dialog({
			title,
			subtitle: [note ? esc(note) : "", kind.dir ? "Open the folder, then use it." : (kind.extensions ? `Files ending in ${esc(kind.extensions.join(", "))}; open folders to find them.` : "")].filter(Boolean).join("<br>"),
			body: `<div class="picker">
				<div class="picker-bar">
					<button class="icon" data-pick-go="__up" title="Up a folder">↑</button>
					<button class="icon" data-pick-go="~" title="Your home folder">⌂</button>
					<input id="picker-path" data-own-enter spellcheck="false" autocomplete="off" title="A folder: Enter opens it">
					<label class="subtle picker-hidden"><input type="checkbox" id="picker-hidden"> hidden</label>
				</div>
				<div class="picker-crumbs" id="picker-crumbs"></div>
				<div class="picker-list" id="picker-list"></div>
				${kind.new_file && !kind.dir ? `<label class="field picker-new"><span>Or a new file here</span><input id="picker-name" placeholder="overlay.dtso" spellcheck="false"></label>` : ""}
			</div>`,
			action: kind.dir ? "Use This Folder" : "Use This File",
			wide: true,
			on_action: body => {
				const name = body.querySelector("#picker-name")?.value.trim();
				if (name) picked = `${current.replace(/\/$/, "")}/${name}`;
				else if (kind.dir) picked = current;
				else if (selected) picked = selected;
				else return "Pick a file in the list";
				return true;
			},
			on_close: () => resolve(picked),
		});
		const list = dialog.body.querySelector("#picker-list");
		const go = async target => {
			const listing = await list_folder(target, { hidden });
			if (listing.error) {
				dialog.problem(listing.error);
				return;
			}
			dialog.problem("");
			current = listing.path;
			selected = "";
			dialog.body.querySelector("#picker-path").value = current;
			// The crumbs: each folder of the path, to go back to.
			const parts = current.split("/").filter(Boolean);
			dialog.body.querySelector("#picker-crumbs").innerHTML = [`<button class="link" data-pick-go="/">/</button>`,
				...parts.map((part, at) => `<button class="link" data-pick-go="${esc(`/${parts.slice(0, at + 1).join("/")}`)}">${esc(part)}</button>`)].join(`<span class="subtle">/</span>`);
			const shown = listing.entries.filter(entry => fits(entry, kind));
			list.innerHTML = shown.map(entry => `<button class="picker-entry${entry.dir ? " dir" : ""}" data-pick-entry="${esc(entry.name)}" data-dir="${entry.dir ? "1" : ""}">
					<span class="picker-glyph">${entry.dir ? "▸" : "·"}</span><span class="mono">${esc(entry.name)}${entry.dir ? "/" : ""}</span></button>`).join("")
				|| `<div class="subtle picker-empty">${kind.dir ? "No folder here." : "Nothing here fits: open a folder."}</div>`;
			if (listing.truncated) list.insertAdjacentHTML("beforeend", `<div class="subtle picker-empty">The first ${listing.entries.length} only: type the path above.</div>`);
		};
		dialog.body.addEventListener("click", event => {
			const to = event.target.closest("[data-pick-go]")?.dataset.pickGo;
			if (to !== undefined) {
				go(to === "__up" ? `${current}/..` : to);
				return;
			}
			const entry = event.target.closest("[data-pick-entry]");
			if (entry === null) return;
			const path = `${current.replace(/\/$/, "")}/${entry.dataset.pickEntry}`;
			if (entry.dataset.dir) {
				go(path);
				return;
			}
			selected = path;
			for (const other of list.querySelectorAll(".picker-entry")) other.classList.toggle("on", other === entry);
		});
		dialog.body.addEventListener("dblclick", event => {
			const entry = event.target.closest("[data-pick-entry]");
			if (entry !== null && !entry.dataset.dir) dialog.body.closest(".dialog").querySelector("[data-dialog-action]").click();
		});
		dialog.body.addEventListener("keydown", event => {
			if (event.key === "Enter" && event.target.id === "picker-path") {
				event.preventDefault();
				event.stopPropagation();
				go(event.target.value.trim());
			}
		}, true);
		dialog.body.addEventListener("change", event => {
			if (event.target.id === "picker-hidden") {
				hidden = event.target.checked;
				go(current);
			}
		});
		go(start_folder(kind, start)).then(() => { if (current === "") go("~"); });
	});
}
