// The GUI's core: the header (the project folder, Setup), the console with
// its command line, the chat with the assistant, and the project's screen. A folder with no project settings (no .analog-attach/config.json),
// one still missing a required setting, or one with no workfile yet (unless its part starts one) gets the project setup
// (setup.mjs), which ends by creating the workfile; then the core mounts the part of the
// project's ecosystem (../ecosystems/<backend>/controller.mjs) in <main>.
//
// The core knows no ecosystem: ECOSYSTEMS lists the parts, and each says what its setup asks
// for. See ../ecosystems/README.md.

import { $, api, cli, esc, log, split_words, stream, use_console_options, use_toasts } from "./ui.mjs";
import { run_setup } from "./setup.mjs";
import { mount_chat } from "./chat.mjs";
import { icon } from "./icons.mjs";
import { apply_theme, open_preferences } from "./preferences.mjs";
import * as noos from "../ecosystems/noos/controller.mjs";
import * as linux from "../ecosystems/linux/controller.mjs";

/** The ecosystems' parts, by backend id: { title, about, setup, mount, toasts, console_options }. */
const ECOSYSTEMS = { noos, linux };

const state = {
	project: null,     // { dir, settings, backend }: GET /api/project
	missing: [],       // analog-attach --json alone: the required settings still unset
	part: null,        // the mounted part: { backend, refresh(), chat }
	setup: false,      // the setup is on screen
};

/** Read the project again: its folder, settings and backend, and what is missing. */
async function read_project() {
	const response = await api("/api/project");
	state.project = await response.json();
	$("project").textContent = state.project.dir ?? "";
	// A part without toasts (linux: `export const toasts = false`) has none from the core either, its setup included.
	use_toasts(ECOSYSTEMS[state.project.backend]?.toasts !== false);
	// A part without the console's preferences (linux: `export const console_options = false`): no height to reset, no reads shown.
	use_console_options(ECOSYSTEMS[state.project.backend]?.console_options !== false);
	const bare = await cli(["--json"], { quiet: true });
	state.missing = bare.json?.missing ?? [];
}

/** What a click on the board's chip does (set_chips' `action`), while the part gives one. */
let board_action;

/**
 * The header's chips: the board, and the status. With `action` ({ title, run }), the board's chip
 * is a button: a click, Enter or Space runs it (the Linux part: change the base devicetree).
 */
function set_chips(board, status, action) {
	const chip = $("board");
	chip.textContent = board;
	board_action = action;
	chip.classList.toggle("action", action !== undefined);
	if (action === undefined) {
		chip.removeAttribute("role");
		chip.removeAttribute("tabindex");
		chip.removeAttribute("title");
	} else {
		chip.setAttribute("role", "button");
		chip.tabIndex = 0;
		chip.title = action.title;
	}
	$("status").className = `chip ${status.kind ?? ""}`;
	$("status").textContent = status.text;
}
$("board").onclick = () => board_action?.run();
$("board").onkeydown = event => {
	if (board_action === undefined || (event.key !== "Enter" && event.key !== " ")) return;
	event.preventDefault();
	board_action.run();
};

/** Show the project setup instead of the ecosystem's part. */
async function open_setup() {
	state.setup = true;
	$("main").hidden = true;
	$("setup").hidden = false;
	// The part's buttons stay its own: hidden during the setup, shown again after.
	$("header-actions").hidden = true;
	$("console-actions").hidden = true;
	// The setup's header: the brand and the project folder; no Setup button, no chips.
	$("setup-button").hidden = true;
	$("board").hidden = true;
	$("status").hidden = true;
	set_chips("", { text: "" });
	await run_setup({
		root: $("setup"),
		ecosystems: ECOSYSTEMS,
		project: () => state.project,
		missing: () => state.missing,
		reload: read_project,
		workfile: has_workfile,
		finish: () => open_part(),
	});
}

/** Show the part of the project's ecosystem: mount it, or have it read the project again. */
async function open_part() {
	state.setup = false;
	$("setup").hidden = true;
	$("main").hidden = false;
	$("header-actions").hidden = false;
	$("console-actions").hidden = false;
	$("board").hidden = false;
	$("status").hidden = false;
	const backend = state.project?.backend;
	const ecosystem = ECOSYSTEMS[backend];
	if (ecosystem === undefined) {
		await open_setup();
		return;
	}
	if (state.part?.backend === backend) {
		$("setup-button").hidden = state.part.setup_button === false;
		await state.part.refresh();
		// The chat back where the part docks it (the setup has the core's).
		chat.part_changed();
		return;
	}
	// A fresh <main> for each part: its own content, layout and listeners.
	const fresh = document.createElement("main");
	fresh.id = "main";
	$("main").replaceWith(fresh);
	$("header-actions").innerHTML = "";
	$("console-actions").innerHTML = "";
	const part = await ecosystem.mount({
		main: $("main"),
		header_actions: $("header-actions"),
		console_actions: $("console-actions"),
		project: state.project,
		set_chips,
		reload_project,
		open_setup,
		open_preferences: show_preferences,
	});
	state.part = { backend, ...part };
	// A part with its own button in the Setup button's place (setup_button: false): the setup stays in the preferences.
	$("setup-button").hidden = part.setup_button === false;
	// A part with a Project tab (`project`): the gear opens the project's settings too.
	$("preferences").title = part.project === undefined ? PREFERENCES_TITLE : `${part.project.title ?? "Project"} and Preferences: the project's settings, and how Analog Attach looks and behaves`;
	// The part's menu folds to the left: the core's toggle, first in it.
	const folded = document.body.classList.contains("nav-collapsed");
	$("main").querySelector("nav")?.insertAdjacentHTML("afterbegin", `<button class="nav-toggle" data-nav-toggle title="${folded ? "Unfold the menu" : "Fold the menu"}">${icon(folded ? "sidebar-unfold" : "sidebar-fold")}</button>`);
	chat.part_changed();
}

/** The project changed (a setting saved): read it, and show what fits. */
async function reload_project() {
	await read_project();
	if (!state.setup) await open_part();
}

/**
 * Whether the project's workfile is there: `read --json` refuses with workfile-missing, or for the
 * workfile setting being unset, when it isn't. A workfile that is there but doesn't read (a parse
 * error) is there: the part shows what is wrong with it.
 */
async function has_workfile() {
	const read = await cli(["read", "--json"], { quiet: true });
	const json = read.json;
	if (json === undefined || json.ok !== false) return true;
	return !(json.error_type === "workfile-missing" || (json.errors ?? []).some(error => error.field === "workfile"));
}

async function start() {
	await read_project();
	// The setup until the project has what it needs: no settings yet, a required one still unset, or
	// no workfile (without one, a part can't even search the devices): its last step makes one.
	const ecosystem = ECOSYSTEMS[state.project.backend];
	if (!state.project.settings || ecosystem === undefined || state.missing.length > 0 || !await has_workfile()) await open_setup();
	else await open_part();
}

$("setup-button").onclick = () => open_setup();
$("refresh").onclick = () => reload_project();
$("clear-console").onclick = () => { $("console").innerHTML = ""; };
// The console hidden or shown, kept for the next time; its button says what it does, whoever
// showed it (a build streaming shows it).
const CONSOLE_SHOWN = "aa-gui-console";
const console_label = () => { $("toggle-console").textContent = $("footer").classList.contains("collapsed") ? "Show Console" : "Hide Console"; };
new MutationObserver(console_label).observe($("footer"), { attributes: true, attributeFilter: ["class"] });
try { if (localStorage.getItem(CONSOLE_SHOWN) === "hidden") $("footer").classList.add("collapsed"); } catch {}
$("toggle-console").onclick = () => {
	const hidden = $("footer").classList.toggle("collapsed");
	try { localStorage.setItem(CONSOLE_SHOWN, hidden ? "hidden" : "shown"); } catch {}
};
// The console's height: dragged from its top edge, kept for the next time.
const CONSOLE_HEIGHT = "aa-gui-console-height";
const console_height = height => {
	const footer = $("footer");
	const clamped = Math.max(80, Math.min(window.innerHeight - 160, height));
	footer.style.height = `${clamped}px`;
	return clamped;
};
try {
	const kept = Number(localStorage.getItem(CONSOLE_HEIGHT));
	if (kept > 0) console_height(kept);
} catch {}
$("console-resize").onmousedown = event => {
	event.preventDefault();
	const footer = $("footer");
	if (footer.classList.contains("collapsed")) $("toggle-console").click();
	const start = event.clientY;
	const from = footer.getBoundingClientRect().height;
	document.body.classList.add("resizing-console");
	const move = moved => console_height(from + start - moved.clientY);
	const up = () => {
		document.removeEventListener("mousemove", move);
		document.removeEventListener("mouseup", up);
		document.body.classList.remove("resizing-console");
		try { localStorage.setItem(CONSOLE_HEIGHT, String(Math.round(footer.getBoundingClientRect().height))); } catch {}
	};
	document.addEventListener("mousemove", move);
	document.addEventListener("mouseup", up);
};
$("console-resize").ondblclick = () => {
	$("footer").style.height = "";
	try { localStorage.removeItem(CONSOLE_HEIGHT); } catch {}
};

// The menu's fold, kept for the next time.
try { if (localStorage.getItem("aa-gui-nav") === "collapsed") document.body.classList.add("nav-collapsed"); } catch {}
document.addEventListener("click", event => {
	const toggle = event.target.closest("[data-nav-toggle]");
	if (toggle === null) return;
	const collapsed = document.body.classList.toggle("nav-collapsed");
	toggle.innerHTML = icon(collapsed ? "sidebar-unfold" : "sidebar-fold");
	toggle.title = collapsed ? "Unfold the menu" : "Fold the menu";
	try { localStorage.setItem("aa-gui-nav", collapsed ? "collapsed" : "open"); } catch {}
});

// The tool's preferences (theme, layout, console, assistant): the core's and the part's.
// With a part's Project tab (part.project), the same popup has it first; `tab` opens on one ("project", "preferences"),
// `section` scrolls to one of its sections ("Assistant").
const PREFERENCES_TITLE = $("preferences").title;
const show_preferences = ({ tab, section } = {}) => open_preferences({ part: () => state.part, project: () => state.project, open_setup }, { tab, section });
$("preferences").innerHTML = icon("settings");
$("preferences").onclick = () => show_preferences();

// The chat with the assistant: the same panel for every part; the part says what the model should know.
const chat = mount_chat({
	button_area: $("console-bar-core"),
	open_settings: () => show_preferences({ tab: "preferences", section: "Assistant" }),
	part: () => (state.setup ? undefined : state.part?.chat),
	changed: () => (state.setup ? read_project() : state.part?.refresh()),
});

// The command line under the console: any analog-attach command, as typed on a terminal. A long
// one (build, deploy) streams; then the part reads the project again, as after its own actions.
const STREAMED = new Set(["build", "deploy"]);
const history = [];
let history_at = 0;
$("command-line").onsubmit = async event => {
	event.preventDefault();
	const input = $("command");
	const line = input.value.trim().replace(/^analog-attach\s+/, "");
	if (line === "") return;
	const words = split_words(line);
	history.push(line);
	history_at = history.length;
	input.value = "";
	$("footer").classList.remove("collapsed");
	// The bare command and the GUI wait for a person at a terminal: not from here.
	if (words[0] === "gui" || words.length === 0) {
		log(`<div class="fail">${esc(`analog-attach ${line}`)}: not from the GUI's command line</div>`);
		return;
	}
	input.disabled = true;
	try {
		if (STREAMED.has(words[0])) await stream(words);
		else await cli(words);
		if (state.setup) await read_project();
		else await state.part?.refresh();
	} finally {
		input.disabled = false;
		input.focus();
	}
};
$("command").onkeydown = event => {
	if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
	event.preventDefault();
	history_at = Math.max(0, Math.min(history.length, history_at + (event.key === "ArrowUp" ? -1 : 1)));
	$("command").value = history[history_at] ?? "";
};

try { apply_theme(localStorage.getItem("aa-gui-theme") ?? "system"); } catch {}
log(`<div class="subtle">Ready. Each action below shows the command it ran and what the CLI said.</div>`);
start();
