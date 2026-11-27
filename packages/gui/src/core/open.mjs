// "Open With": a path (the generated project, the overlay) opened in an app of the user's, an
// editor or the file manager. The server offers the apps of its fixed list that are on PATH
// (/api/openers) and starts the one picked (/api/open); the page never names a command.

import { api, esc, toast, toasts_on } from "./ui.mjs";

const LAST = "aa-gui-open-with";

/**
 * The apps a folder or a file opens with: { apps: [{ id, label }] }, or { error } when the server
 * did not say (a server started before it had Open With: the page is read anew, the server is not).
 * A list is asked once each; a failure is asked again next time.
 */
const asked = new Map();
async function openers(folder) {
	const key = folder ? "folder" : "file";
	if (asked.has(key)) return asked.get(key);
	let answer;
	try {
		const response = await api(`/api/openers?folder=${folder ? "1" : "0"}`);
		const json = response.ok ? await response.json() : undefined;
		answer = Array.isArray(json?.openers) ? { apps: json.openers }
			: { error: response.status === 404 ? "This GUI's server is older than the page and can't open apps: restart analog-attach gui." : `The server did not list the apps (${response.status}).` };
	} catch {
		answer = { error: "The GUI's server did not answer." };
	}
	if (answer.apps) asked.set(key, answer);
	return answer;
}

/** The app picked last, for the button to offer first. */
function last_used() {
	try { return localStorage.getItem(LAST) ?? ""; } catch { return ""; }
}

/**
 * Open `path` with the app `id`: a toast says what happened (noos). In a project without toasts
 * (linux) an opening says nothing, and a failure is said under the button (`host`, its
 * `.open-with`) until the next click on it.
 */
export async function open_path(path, id, host) {
	const response = await api("/api/open", { path, app: id });
	const json = await response.json().catch(() => ({ error: "No answer" }));
	if (json.error) {
		if (toasts_on() || host === undefined) toast(json.error, true);
		else host.insertAdjacentHTML("beforeend", `<div class="open-failed" role="alert">${esc(json.error)}</div>`);
		return false;
	}
	try { localStorage.setItem(LAST, id); } catch {}
	toast(`Opening ${json.opened.split("/").pop()} with ${json.with}`);
	return true;
}

/** The Open With button, as HTML: `path` a folder (`folder`) or a file. `attach_open_with` makes it work. */
export function open_with_button(path, { folder = false, label = "Open With" } = {}) {
	return `<span class="open-with"><button class="secondary" data-open-with="${esc(path)}" data-open-folder="${folder ? "1" : ""}" title="Open ${esc(path)} in an editor or the file manager">${esc(label)} ▾</button></span>`;
}

/** Make the Open With buttons in `root` work: a click lists the apps there are; picking one opens the path. */
export function attach_open_with(root) {
	root.addEventListener("click", async event => {
		const item = event.target.closest?.("[data-open-app]");
		if (item !== null) {
			event.preventDefault();
			const menu = item.closest(".open-menu");
			const host = menu.closest(".open-with");
			menu.remove();
			await open_path(menu.dataset.path, item.dataset.openApp, host);
			return;
		}
		const button = event.target.closest?.("[data-open-with]");
		if (button === null) return;
		event.preventDefault();
		const host = button.closest(".open-with");
		host.querySelector(".open-failed")?.remove();
		const open = host.querySelector(".open-menu");
		close_menus();
		if (open !== null) return;
		const { apps = [], error } = await openers(button.dataset.openFolder === "1");
		const last = last_used();
		const ordered = [...apps.filter(app => app.id === last), ...apps.filter(app => app.id !== last)];
		host.insertAdjacentHTML("beforeend", `<div class="open-menu" role="menu" data-path="${esc(button.dataset.openWith)}">
			${ordered.map(app => `<button role="menuitem" data-open-app="${esc(app.id)}">${esc(app.label)}${app.id === last ? ` <span class="subtle">· last used</span>` : ""}</button>`).join("")
				|| `<div class="subtle open-menu-empty">${esc(error ?? "No editor or file manager found on the server's PATH (VS Code, VSCodium, Cursor, Zed, Sublime Text, xdg-open).")}</div>`}
		</div>`);
	});
}

function close_menus() {
	for (const menu of document.querySelectorAll(".open-menu")) menu.remove();
}

// A click anywhere else, or Escape, closes the menu.
document.addEventListener("mousedown", event => { if (!event.target.closest?.(".open-with")) close_menus(); });
document.addEventListener("keydown", event => { if (event.key === "Escape") close_menus(); });
