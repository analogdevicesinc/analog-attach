// The GUI's core: the header (the project folder, Open, New project, Setup), the console, and
// the project's screen. A folder with no project settings (no .analog-attach/config.json) gets
// the project setup (setup.mjs), once; then, and for a project set up already, the core mounts
// the part of the project's ecosystem (../ecosystems/<backend>/controller.mjs) in <main>.
//
// The core knows no ecosystem: ECOSYSTEMS lists the parts, and each says what its setup asks
// for. See ../ecosystems/README.md.

import { $, api, cli, log, toast } from "./ui.mjs";
import { run_setup } from "./setup.mjs";
import * as noos from "../ecosystems/noos/controller.mjs";
import * as linux from "../ecosystems/linux/controller.mjs";

/** The ecosystems' parts, by backend id: { title, about, setup, mount }. */
const ECOSYSTEMS = { noos, linux };

const state = {
	project: null,     // { dir, settings, backend }: GET /api/project
	missing: [],       // analog-attach --json alone: the required settings still unset
	part: null,        // the mounted part: { backend, refresh() }
	setup: false,      // the setup is on screen
};

/** Read the project again: its folder, settings and backend, and what is missing. */
async function read_project() {
	const response = await api("/api/project");
	state.project = await response.json();
	$("project").value = state.project.dir ?? "";
	const bare = await cli(["--json"], { quiet: true });
	state.missing = bare.json?.missing ?? [];
}

function set_chips(board, status) {
	$("board").textContent = board;
	$("status").className = `chip ${status.kind ?? ""}`;
	$("status").textContent = status.text;
}

/** Show the project setup instead of the ecosystem's part. */
async function open_setup() {
	state.setup = true;
	$("main").hidden = true;
	$("setup").hidden = false;
	$("header-actions").innerHTML = "";
	set_chips(state.project?.backend ? `${state.project.backend} project` : "new project", { text: "setting up", kind: "warn" });
	await run_setup({
		root: $("setup"),
		ecosystems: ECOSYSTEMS,
		project: () => state.project,
		missing: () => state.missing,
		reload: read_project,
		finish: () => open_part(),
	});
}

/** Show the part of the project's ecosystem: mount it, or have it read the project again. */
async function open_part() {
	state.setup = false;
	$("setup").hidden = true;
	$("main").hidden = false;
	const backend = state.project?.backend;
	const ecosystem = ECOSYSTEMS[backend];
	if (ecosystem === undefined) {
		await open_setup();
		return;
	}
	if (state.part?.backend === backend) {
		await state.part.refresh();
		return;
	}
	// A fresh <main> for each part: its own content, layout and listeners.
	const fresh = document.createElement("main");
	fresh.id = "main";
	$("main").replaceWith(fresh);
	$("header-actions").innerHTML = "";
	const part = await ecosystem.mount({
		main: $("main"),
		header_actions: $("header-actions"),
		project: state.project,
		set_chips,
		reload_project,
		open_setup,
	});
	state.part = { backend, ...part };
}

/** The project changed (a setting saved, another folder): read it, and show what fits. */
async function reload_project() {
	await read_project();
	if (!state.setup) await open_part();
}

/** Open a folder: the setup when it has no project settings (once), else its ecosystem's part. */
async function open_folder(dir, create = false) {
	const response = await api("/api/project", { dir, create });
	const result = await response.json();
	if (!response.ok) {
		toast(result.error, true);
		return;
	}
	state.part = null;
	try { localStorage.setItem("aa-gui-project", result.dir); } catch {}
	toast(create ? `New project in ${result.dir}` : `Opened ${result.dir}`);
	await start();
}

async function start() {
	await read_project();
	if (!state.project.settings || ECOSYSTEMS[state.project.backend] === undefined) await open_setup();
	else await open_part();
}

$("open").onclick = () => open_folder($("project").value.trim());
$("new-project").onclick = () => {
	const dir = prompt("Folder for the new project (made when it doesn't exist):", `${state.project?.dir ?? "~"}/new-project`);
	if (dir) open_folder(dir, true);
};
$("project").onkeydown = event => { if (event.key === "Enter") $("open").click(); };
$("setup-button").onclick = () => open_setup();
$("refresh").onclick = () => reload_project();
$("clear-console").onclick = () => { $("console").innerHTML = ""; };
$("toggle-console").onclick = () => {
	const footer = $("footer");
	footer.classList.toggle("collapsed");
	$("toggle-console").textContent = footer.classList.contains("collapsed") ? "Show" : "Hide";
};
$("theme").onclick = () => {
	const root = document.documentElement;
	const dark = getComputedStyle(root).getPropertyValue("--bg").trim().startsWith("#0");
	root.dataset.theme = dark ? "light" : "dark";
	try { localStorage.setItem("aa-gui-theme", root.dataset.theme); } catch {}
	window.dispatchEvent(new Event("aa-theme"));
};

try {
	const theme = localStorage.getItem("aa-gui-theme");
	if (theme) document.documentElement.dataset.theme = theme;
} catch {}
log(`<div class="subtle" style="color:#8b95a3">Ready. Each action below shows the command it ran and what the CLI said.</div>`);
start();
