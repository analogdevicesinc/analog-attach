// The GUI's server: it serves the page (index.html, core/, ecosystems/) and runs the CLI for it.
// Every action in the page is one `analog-attach <args>` run in the project folder. Arguments
// are passed as an array to spawn (no shell), and the server only listens on 127.0.0.1.
//
// Any page the browser opens can send requests to 127.0.0.1, so the API answers only the GUI's
// own page: each call carries the token the server wrote into that page (x-aa-token), from the
// GUI's own origin (Origin, Host). Without them, a call is refused (403).
//
// `analog-attach gui` starts it (packages/cli, src/front/gui.ts); `src/start.mjs` starts it on
// its own, for working on the page.

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { create_assistant } from "./assistant.mjs";
import { portal_pick, portal_version } from "./portal.mjs";

export const DEFAULT_PORT = 5177;
/** How many ports after a busy one `next_free` tries before taking any free port. */
const NEXT_PORTS = 20;
const PAGE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const TYPES = { ".html": "text/html; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
// The page's files that are bytes, not text (the logo, the bundled fonts).
const BINARY = new Set([".png", ".woff2"]);

/** A file of the page, by its URL path: under `root` only, and of a type the page uses. */
function page_file(root, pathname) {
	const relative = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
	const file = path.resolve(root, relative);
	if (file !== root && !file.startsWith(root + path.sep)) return undefined;
	if (!(path.extname(file) in TYPES) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return undefined;
	return file;
}

function read_body(request) {
	return new Promise((resolve, reject) => {
		let body = "";
		request.on("data", chunk => { body += chunk; });
		request.on("end", () => {
			try {
				resolve(body === "" ? {} : JSON.parse(body));
			} catch (error) {
				reject(error);
			}
		});
		request.on("error", reject);
	});
}

/** At most this many entries of a folder go to the page: a picker, not a listing of /usr/lib. */
const MOST_ENTRIES = 3000;

/**
 * The entries of the folder `asked` (~ for the home folder; relative to the project `folder`):
 * [status, { path, parent, entries: [{ name, dir }] }], folders first, then by name. Hidden
 * entries (a leading dot) only with `hidden`.
 */
function list_folder(asked, folder, hidden) {
	const home = process.env.HOME ?? "";
	const expanded = asked.replace(/^~(?=$|\/)/, home);
	const dir = path.resolve(folder, expanded === "" ? "." : expanded);
	let dirents;
	try {
		dirents = fs.readdirSync(dir, { withFileTypes: true });
	} catch (error) {
		return [400, { error: `Can't read ${dir}: ${error.code ?? error.message}`, path: dir }];
	}
	const entries = [];
	for (const dirent of dirents) {
		if (!hidden && dirent.name.startsWith(".")) continue;
		let is_dir = dirent.isDirectory();
		// A link to a folder is a folder to the picker.
		if (dirent.isSymbolicLink()) {
			try { is_dir = fs.statSync(path.join(dir, dirent.name)).isDirectory(); } catch { continue; }
		}
		entries.push({ name: dirent.name, dir: is_dir });
		if (entries.length >= MOST_ENTRIES) break;
	}
	entries.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
	return [200, { path: dir, parent: path.dirname(dir) === dir ? null : path.dirname(dir), home, entries, truncated: entries.length >= MOST_ENTRIES }];
}

/** Folders a search for Linux trees doesn't go into: caches, tools and build output. */
const SKIP_FOLDERS = new Set(["node_modules", "__pycache__", "venv", "build", "dist", "snap", "Downloads"]);

/** Whether `dir` is the root of a Linux tree: the CLI's test (linux_tree_problem), bindings and include/. */
const is_linux_tree = dir => fs.existsSync(path.join(dir, "Documentation", "devicetree", "bindings")) && fs.existsSync(path.join(dir, "include"));

/**
 * The Linux trees near the project, for the setup (the CLI offers none for `linux`): in the
 * folders above the project and their own folders (../linux-adi), then under the home folder,
 * breadth first, a few levels deep, nearest first. `inside`: the tree a path typed is in, when it
 * names a folder of one (arch/, Documentation/devicetree) and not its root.
 */
function linux_trees(folder, inside) {
	const home = process.env.HOME ?? "";
	const found = [];
	const seen = new Set();
	const started = Date.now();
	const look = (from, depth) => {
		const queue = [{ dir: from, depth: 0 }];
		while (queue.length > 0 && found.length < 12 && Date.now() - started < 3000) {
			const { dir, depth: at } = queue.shift();
			if (is_linux_tree(dir)) {
				if (!found.includes(dir)) found.push(dir);
				continue;
			}
			// A folder is gone into once (a search from further up may have passed it by).
			if (at >= depth || seen.has(dir)) continue;
			seen.add(dir);
			let entries;
			try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
			for (const entry of entries.toSorted((a, b) => a.name.localeCompare(b.name))) {
				if (entry.name.startsWith(".") || SKIP_FOLDERS.has(entry.name)) continue;
				const full = path.join(dir, entry.name);
				// A link to a folder is followed (~/linux -> /work/linux-adi).
				let is_dir = entry.isDirectory();
				if (entry.isSymbolicLink()) { try { is_dir = fs.statSync(full).isDirectory(); } catch { is_dir = false; } }
				if (is_dir) queue.push({ dir: full, depth: at + 1 });
			}
		}
	};
	// The project's own folder and those above it, up to the home folder (or two, outside it).
	let up = path.resolve(folder);
	for (let levels = 0; levels < 4; levels++) {
		look(up, levels === 0 ? 2 : 1);
		const parent = path.dirname(up);
		if (parent === up || up === home) break;
		up = parent;
	}
	if (home) look(home, 3);
	let root;
	if (inside) {
		let dir = path.resolve(folder, inside.replace(/^~(?=$|\/)/, home));
		while (path.dirname(dir) !== dir && !is_linux_tree(dir)) dir = path.dirname(dir);
		if (is_linux_tree(dir)) root = dir;
	}
	const tidy = dir => home && (dir === home || dir.startsWith(home + path.sep)) ? `~${dir.slice(home.length)}` : dir;
	return [200, { trees: found.map(dir => ({ path: dir, shown: tidy(dir) })), root }];
}

/** The most of a file the page is given to show: larger ones are named, not sent. */
const MOST_FILE_BYTES = 512 * 1024;

/**
 * A text file for the page to show (the generated project's files): [status, { path, size, text }],
 * or { path, size, binary } / { path, size, too_big } without its text.
 */
function read_text_file(asked, folder) {
	const file = path.resolve(folder, asked.replace(/^~(?=$|\/)/, process.env.HOME ?? ""));
	let stat;
	try {
		stat = fs.statSync(file);
	} catch (error) {
		return [400, { error: `Can't read ${file}: ${error.code ?? error.message}`, path: file }];
	}
	if (!stat.isFile()) return [400, { error: `Not a file: ${file}`, path: file }];
	// modified: when it was last written (ms), to tell a build's output older than its source.
	const about = { path: file, size: stat.size, modified: stat.mtimeMs };
	if (stat.size > MOST_FILE_BYTES) return [200, { ...about, too_big: true }];
	const bytes = fs.readFileSync(file);
	if (bytes.subarray(0, 8192).includes(0)) return [200, { ...about, binary: true }];
	return [200, { ...about, text: bytes.toString("utf8") }];
}

/**
 * The apps a path can be opened with ("Open With"): a fixed list, each offered when its command
 * is on PATH. The page names one by its id; nothing else is ever run. `files: false` opens folders only,
 * `folders: false` files only. The system's own opener takes a file to its default app, a folder
 * to the file manager.
 */
const SYSTEM_OPENER = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
const OPENERS = [
	{ id: "code", label: "VS Code", command: "code" },
	{ id: "codium", label: "VSCodium", command: "codium" },
	{ id: "cursor", label: "Cursor", command: "cursor" },
	{ id: "zed", label: "Zed", command: "zed" },
	{ id: "subl", label: "Sublime Text", command: "subl" },
	{ id: "text-editor", label: "Text Editor", command: "gnome-text-editor", folders: false },
	{ id: "system", label: "Default App", folder_label: "File Manager", command: SYSTEM_OPENER },
];

/** Whether `command` is a program on PATH. */
function on_path(command) {
	const extensions = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE").split(";") : [""];
	return (process.env.PATH ?? "").split(path.delimiter).filter(Boolean).some(dir => extensions.some(extension => {
		try {
			fs.accessSync(path.join(dir, command + extension), fs.constants.X_OK);
			return true;
		} catch {
			return false;
		}
	}));
}

/** The openers there are, for a folder or a file. */
function available_openers(for_folder) {
	return OPENERS.filter(opener => (for_folder ? opener.folders !== false : opener.files !== false) && on_path(opener.command))
		.map(opener => ({ id: opener.id, label: for_folder && opener.folder_label ? opener.folder_label : opener.label }));
}

/** Open `asked` with the opener `id`, detached from the server: [status, { opened } | { error }]. */
function open_with(asked, id, folder) {
	const target = path.resolve(folder, String(asked ?? "").replace(/^~(?=$|\/)/, process.env.HOME ?? ""));
	if (!fs.existsSync(target)) return [400, { error: `Nothing at ${target}` }];
	const for_folder = fs.statSync(target).isDirectory();
	const opener = OPENERS.find(candidate => candidate.id === id);
	if (opener === undefined || !available_openers(for_folder).some(candidate => candidate.id === id)) return [400, { error: `Can't open ${for_folder ? "a folder" : "a file"} with ${id}` }];
	const child = spawn(opener.command, [target], { cwd: path.dirname(target), detached: true, stdio: "ignore" });
	child.on("error", () => {});
	child.unref();
	return [200, { opened: target, with: opener.label }];
}

/**
 * The native file picker (Preferences → Files): the desktop's own dialog, opened by the server, so
 * on the machine it runs on. On Linux the desktop portal's file chooser first (portal.mjs: GNOME's,
 * KDE's or GTK's dialog, nothing to install); without one, or where it fails, the first of a fixed
 * list of programs on PATH (on KDE kdialog first); on macOS osascript. A program is given the kind
 * of path (a folder, or files of some extensions), a title and the folder to start in, as
 * arguments (no shell), and prints the path picked; a cancel is exit 1 (yad's closed window 252,
 * osascript's -128).
 */
const DIALOGS = [
	{
		id: "zenity", command: "zenity",
		args: ({ dir, extensions, title, start }) => ["--file-selection", `--title=${title}`, `--filename=${start}/`,
			...(dir ? ["--directory"] : (extensions.length > 0 ? [`--file-filter=${extensions.map(extension => `*${extension}`).join(" ")}`, "--file-filter=All files | *"] : []))],
	},
	{
		id: "kdialog", command: "kdialog",
		args: ({ dir, extensions, title, start }) => ["--title", title, ...(dir ? ["--getexistingdirectory", start] : ["--getopenfilename", start, ...(extensions.length > 0 ? [extensions.map(extension => `*${extension}`).join(" ")] : [])])],
	},
	{
		id: "yad", command: "yad",
		args: ({ dir, extensions, title, start }) => ["--file", `--title=${title}`, `--filename=${start}/`, "--width=900", "--height=600",
			...(dir ? ["--directory"] : (extensions.length > 0 ? [`--file-filter=${extensions.map(extension => `*${extension}`).join(" ")}`, "--file-filter=All files | *"] : []))],
	},
	{
		id: "osascript", command: "osascript", platform: "darwin",
		// The title, the folder and the extensions are the script's arguments, never its text.
		args: ({ dir, extensions, title, start }) => ["-e", "on run argv",
			"-e", `POSIX path of (choose ${dir ? "folder" : "file"} with prompt (item 1 of argv) default location (POSIX file (item 2 of argv))${!dir && extensions.length > 0 ? " of type (items 3 thru -1 of argv)" : ""})`,
			"-e", "end run", title, start, ...extensions.map(extension => extension.slice(1))],
	},
];

/** Whether there is a display for a dialog to open on: on Linux, $DISPLAY or $WAYLAND_DISPLAY. */
const has_display = () => process.platform !== "linux" || Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);

/** The program there is for the dialog: the first of DIALOGS on PATH, for this platform. */
function program_dialog() {
	const kde = /kde/i.test(process.env.XDG_CURRENT_DESKTOP ?? "");
	const order = kde ? [...DIALOGS.filter(dialog => dialog.id === "kdialog"), ...DIALOGS.filter(dialog => dialog.id !== "kdialog")] : DIALOGS;
	return order.find(dialog => (dialog.platform ?? "linux") === process.platform && on_path(dialog.command));
}

/** The native dialog there is, with a display to open on: "portal", a program's id, or undefined. */
async function native_dialog() {
	if (!has_display()) return;
	if (process.platform === "linux" && await portal_version() !== undefined) return "portal";
	return program_dialog()?.id;
}

/** An extension a dialog may filter on: a dot and a name (.dts, .dtso). */
const EXTENSION = /^\.[\w-]+(\.[\w-]+)*$/;

/**
 * Pick a path in the native dialog: `asked` { dir, extensions, title, start }, `start` a folder (~,
 * relative to the project `folder`; the nearest that exists). Resolves with [status, { path, with }
 * | { cancelled, with } | { error }] once the dialog is closed; `signal` aborted (the page gone)
 * closes it.
 */
async function native_pick(asked, folder, signal) {
	if (!has_display()) return [400, { error: "No display for a native file dialog on the GUI's machine ($DISPLAY, $WAYLAND_DISPLAY)" }];
	const extensions = Array.isArray(asked?.extensions) ? asked.extensions : [];
	if (!extensions.every(extension => typeof extension === "string" && EXTENSION.test(extension))) return [400, { error: "extensions must be a list like [\".dts\"]" }];
	const title = typeof asked?.title === "string" && asked.title !== "" ? asked.title : "Choose a path";
	let start = path.resolve(folder, String(asked?.start ?? "").replace(/^~(?=$|\/)/, () => process.env.HOME ?? ""));
	while (!(fs.existsSync(start) && fs.statSync(start).isDirectory()) && path.dirname(start) !== start) start = path.dirname(start);
	const kind = { dir: asked?.dir === true, extensions, title, start };
	// The portal first; where it can't, a program (and the portal's problem, without one).
	let problem;
	if (process.platform === "linux") {
		const answer = await portal_pick(kind, signal);
		if (answer.error === undefined) return [200, { ...answer, with: "portal" }];
		problem = answer.error;
		if (signal.aborted) return [200, { cancelled: true, with: "portal" }];
	}
	const dialog = program_dialog();
	if (dialog === undefined) return [400, { error: `No native file dialog: ${problem === undefined ? "" : `${problem}, and `}no zenity, kdialog or yad (osascript on macOS) on the server's PATH` }];
	return new Promise(resolve => {
		const child = spawn(dialog.command, dialog.args(kind), { cwd: folder, stdio: ["ignore", "pipe", "pipe"], signal });
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", chunk => { stdout += chunk; });
		child.stderr.on("data", chunk => { stderr += chunk; });
		child.on("error", error => resolve(signal.aborted ? [200, { cancelled: true, with: dialog.id }] : [500, { error: `${dialog.id}: ${error.message}` }]));
		child.on("close", code => {
			const picked = stdout.replace(/\r?\n$/, "");
			if (code === 0 && picked !== "") resolve([200, { path: picked.length > 1 ? picked.replace(/\/$/, "") : picked, with: dialog.id }]);
			else if (dialog.id === "osascript" ? /-128/.test(stderr) : code === 1 || code === 252 || signal.aborted) resolve([200, { cancelled: true, with: dialog.id }]);
			else resolve([500, { error: `${dialog.id} failed (${String(code)}): ${stderr.trim().split("\n").pop() ?? ""}` }]);
		});
	});
}

function valid_args(args) {
	return Array.isArray(args) && args.every(arg => typeof arg === "string");
}

/** A variable name a run may be given: a shell's, and not one of the CLI's system variables (AA_…). */
const ENV_NAME = /^[A-Za-z_]\w*$/;

/**
 * The variables a run is given on top of the server's environment (`env` of /api/run and
 * /api/stream: a secret deploy needs, deploy.md DEPLOY-040): `{ env }`, or `{ error }` for one
 * that isn't an object of strings, a name that isn't a variable's, or a name starting AA_. They
 * are that run's alone, and go nowhere else: not logged, not in the answer, never on a command line.
 */
function given_variables(given) {
	if (given === undefined || given === null) return { env: {} };
	if (typeof given !== "object" || Array.isArray(given)) return { error: "env must be an object of strings" };
	for (const [name, value] of Object.entries(given)) {
		if (!ENV_NAME.test(name)) return { error: `env: ${JSON.stringify(name)} is not a variable name` };
		if (/^aa_/i.test(name)) return { error: `env: ${name} starts with AA_, the CLI's own variables` };
		if (typeof value !== "string") return { error: `env: ${name} must be a string` };
	}
	return { env: { ...given } };
}

function send(response, status, body, type = "application/json") {
	response.writeHead(status, { "content-type": type, "cache-control": "no-store" });
	response.end(type === "application/json" ? JSON.stringify(body) : body);
}

/**
 * Start the GUI's server. `cli` is the command that runs the CLI, as an array (`[node,
 * "/path/to/cli.js"]`); `project` the folder the CLI runs in: the GUI's project, for as long as it
 * runs (another project is another GUI, started there).
 * Resolves with the server and its URL once it listens. With `next_free` (the port was not asked
 * for: another GUI may have the default), a busy port moves it on to the next ones, then to any
 * free port; otherwise a busy port is an error.
 */
export function start_gui({ cli, runner, skills, project, port = DEFAULT_PORT, root = PAGE_ROOT, next_free = false }) {
	const folder = path.resolve(project);
	const page_root = path.resolve(root);
	const token = crypto.randomBytes(24).toString("hex");
	let origins = new Set();
	const [command, ...prefix] = cli;
	/** Whether the native file dialog is open (/api/dialog): one at a time. */
	let picking = false;

	// The runs' environment: this process's pid lets `validate` keep dt-validate running for
	// as long as the GUI does (GUI-010, the CLI's commands/validate/worker.ts).
	const environment = { ...process.env, NO_COLOR: "1", ANALOG_ATTACH_VALIDATE_WORKER: String(process.pid) };
	/** Run the CLI in a child process, `variables` over the environment: exit code, stdout and stderr. */
	const spawn_run = (args, variables = {}) => new Promise(resolve => {
		const child = spawn(command, [...prefix, ...args], { cwd: folder, env: { ...environment, ...variables } });
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", chunk => { stdout += chunk; });
		child.stderr.on("data", chunk => { stderr += chunk; });
		child.on("error", error => resolve({ code: -1, stdout, stderr: String(error) }));
		child.on("close", code => resolve({ code, stdout, stderr }));
	});
	/**
	 * Run the CLI to completion: exit code, stdout, stderr, and stdout parsed when it is JSON. With
	 * a `runner` (the CLI's own, in this process), through it; else in a child process. `variables`:
	 * this run's alone, over the process's (given_variables).
	 */
	const run = async (args, variables = {}) => {
		const result = runner === undefined ? await spawn_run(args, variables) : await runner(args, folder, variables).catch(error => ({ code: 1, stdout: "", stderr: String(error) }));
		let json;
		try {
			json = JSON.parse(result.stdout);
		} catch {
			json = undefined;
		}
		return { ...result, json };
	};

	/** The project's backend, as its settings have it (null: none). */
	const project_backend = async () => (await run(["--json", "config", "backend"])).json?.configs?.[0]?.value ?? null;
	/** The project folder, whether it has project settings, and its backend. */
	const describe = async () => ({
		dir: folder,
		settings: fs.existsSync(path.join(folder, ".analog-attach", "config.json")),
		backend: await project_backend(),
	});
	const chat = create_assistant({ cli, backend: project_backend, ...(skills === undefined ? {} : { skills }) });

	const server = http.createServer(async (request, response) => {
		const url = new URL(request.url ?? "/", "http://localhost");
		try {
			if (!url.pathname.startsWith("/api/")) {
				const file = request.method === "GET" ? page_file(page_root, url.pathname) : undefined;
				if (file === undefined) {
					send(response, 404, { error: "not found" });
					return;
				}
				const text = fs.readFileSync(file, BINARY.has(path.extname(file)) ? undefined : "utf8");
				// The page gets the token; the other files are code, the same for anyone.
				send(response, 200, file.endsWith("index.html") ? text.replace("%AA_TOKEN%", token) : text, TYPES[path.extname(file)]);
				return;
			}

			// The API: the GUI's own page only (the token it was given, from its own origin).
			const origin = request.headers.origin;
			if (request.headers["x-aa-token"] !== token || !origins.has(`http://${request.headers.host ?? ""}`) || (origin !== undefined && !origins.has(origin))) {
				send(response, 403, { error: "not the GUI's page" });
				return;
			}

			if (request.method === "GET" && url.pathname === "/api/project") {
				send(response, 200, await describe());
				return;
			}

			// A folder's entries, for the path fields and the file picker of the page: names and whether
			// each is a folder, nothing read from the files (the CLI's own completion of paths is the
			// shell's, which the page hasn't). Beside running the CLI, the server only lists folders,
			// reads a text file to show (/api/file), finds Linux trees for the setup (/api/linux-trees),
			// opens a path in an app of its list (/api/open) and opens the native file dialog (/api/dialog).
			if (request.method === "GET" && url.pathname === "/api/files") {
				send(response, ...list_folder(url.searchParams.get("path") ?? "", folder, url.searchParams.get("hidden") === "1"));
				return;
			}

			// The Linux trees near the project, for the setup's Linux tree step (read only).
			if (request.method === "GET" && url.pathname === "/api/linux-trees") {
				send(response, ...linux_trees(folder, url.searchParams.get("inside") ?? ""));
				return;
			}

			// A text file to show (the generated project's files), and the apps a path opens with.
			if (request.method === "GET" && url.pathname === "/api/file") {
				send(response, ...read_text_file(url.searchParams.get("path") ?? "", folder));
				return;
			}
			if (request.method === "GET" && url.pathname === "/api/openers") {
				send(response, 200, { openers: available_openers(url.searchParams.get("folder") === "1") });
				return;
			}
			if (request.method === "POST" && url.pathname === "/api/open") {
				const { path: target, app } = await read_body(request);
				send(response, ...open_with(target, app, folder));
				return;
			}

			// The native file picker: which there is, and a pick (one dialog at a time; the answer
			// waits for it to close, and a page gone closes it).
			if (request.method === "GET" && url.pathname === "/api/dialog") {
				const dialog = await native_dialog();
				send(response, 200, dialog === undefined ? { available: false } : { available: true, with: dialog });
				return;
			}
			if (request.method === "POST" && url.pathname === "/api/dialog") {
				const asked = await read_body(request);
				if (picking) {
					send(response, 409, { error: "A file dialog is already open" });
					return;
				}
				picking = true;
				const gone = new AbortController();
				response.on("close", () => gone.abort());
				try {
					send(response, ...await native_pick(asked, folder, gone.signal));
				} finally {
					picking = false;
				}
				return;
			}

			if (request.method === "POST" && url.pathname === "/api/run") {
				const { args, env } = await read_body(request);
				const given = given_variables(env);
				if (!valid_args(args) || given.error !== undefined) {
					send(response, 400, { error: given.error ?? "args must be an array of strings" });
					return;
				}
				send(response, 200, await run(args, given.env));
				return;
			}

			// The chat (assistant.mjs): whether its model is there, a message, stop, a new chat, and
			// which model answers (Preferences).
			if (url.pathname === "/api/chat" && request.method === "GET") {
				send(response, 200, await chat.status());
				return;
			}
			if (url.pathname === "/api/chat" && request.method === "POST") {
				await chat.answer(folder, await read_body(request), response);
				return;
			}
			if (url.pathname === "/api/chat/stop" && request.method === "POST") {
				send(response, 200, { stopped: chat.stop() });
				return;
			}
			if (url.pathname === "/api/chat/reset" && request.method === "POST") {
				chat.reset(folder);
				send(response, 200, { reset: true });
				return;
			}
			if (url.pathname === "/api/chat/settings" && request.method === "GET") {
				send(response, 200, chat.settings());
				return;
			}
			if (url.pathname === "/api/chat/settings" && request.method === "POST") {
				send(response, ...chat.set_settings(await read_body(request)));
				return;
			}

			// Long commands (build, deploy): the output as it comes, then a last line with the exit code.
			// `env`: the variables of this run alone (a secret deploy needs), in its environment only.
			if (request.method === "POST" && url.pathname === "/api/stream") {
				const { args, env } = await read_body(request);
				const given = given_variables(env);
				if (!valid_args(args) || given.error !== undefined) {
					send(response, 400, { error: given.error ?? "args must be an array of strings" });
					return;
				}
				response.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
				const child = spawn(command, [...prefix, ...args], { cwd: folder, env: { ...environment, ...given.env } });
				child.stdout.on("data", chunk => response.write(chunk));
				child.stderr.on("data", chunk => response.write(chunk));
				child.on("error", error => response.end(`\n${String(error)}\n\u0000exit -1`));
				child.on("close", code => response.end(`\n\u0000exit ${String(code)}`));
				request.on("close", () => { if (child.exitCode === null) child.kill(); });
				return;
			}

			send(response, 404, { error: "not found" });
		} catch (error) {
			send(response, 500, { error: String(error) });
		}
	});

	server.on("close", () => chat.close());
	const listen = at => new Promise((resolve, reject) => {
		const failed = error => reject(error);
		server.once("error", failed);
		server.listen(at, "127.0.0.1", () => {
			server.off("error", failed);
			const address = server.address();
			const listening = String(typeof address === "object" && address ? address.port : at);
			origins = new Set([`http://127.0.0.1:${listening}`, `http://localhost:${listening}`]);
			resolve({ server, url: `http://127.0.0.1:${listening}`, token });
		});
	});
	return (async () => {
		// The ports to try: the one given; with next_free, the next ones after it, then any (0).
		const tries = next_free && port !== 0
			? [...Array.from({ length: NEXT_PORTS + 1 }, (_, step) => port + step).filter(at => at <= 65_535), 0]
			: [port];
		for (const [index, at] of tries.entries()) {
			try {
				return await listen(at);
			} catch (error) {
				if (error?.code !== "EADDRINUSE" || index === tries.length - 1) {
					chat.close();
					if (error?.code === "EADDRINUSE") throw new Error(`Port ${at} on 127.0.0.1 is in use (another analog-attach gui?): pick another with --port, or --port 0 for any free one`);
					throw error;
				}
			}
		}
		throw new Error("unreachable");
	})();
}
