// The Linux part of the GUI: a device tree overlay on a base devicetree (a Raspberry Pi 4, ...).
// The core (../../core/app.mjs) mounts it on a project whose backend is linux, after the project
// setup; every action is an `analog-attach` command (../../core/ui.mjs). See ../README.md for
// what a part is given and gives back.
//
// One screen, three columns, no menu:
//   the tree      the merged devicetree, focused on what the overlay adds or changes; ＋ Add Device
//                 on its title row
//   the node      the one picked: its properties (what the binding requires first), its child
//                 nodes, rename, move, delete; a placeholder while none is
//   the right     the overlay as saved (or the full .dts the last build wrote, where the output is
//                 devicetree) and its validation, the binding of the node open, or the chat with
//                 the assistant, each a tab
// The header has Validate, Build and Deploy (their output in the console); the gear's popup has
// the project's settings (its Project tab, PROJECT_SECTIONS) beside the preferences.
//
// Adding a device is a panel over the page: a compatible of the Linux tree, then its bus or parent.
// No toasts: a refusal is said where it happened (state.problem), an outcome in the console.
//
// A `&label` is a way to its node: a link in the overlay source, "go to <label>" under a
// field holding one; the node it opens has "← back to …", one step (state.back). A list of labels
// ends with the nodes the user can add for it (＋ Add a fixed-clock…: create_for).

import { $, api, ask, cli, esc, first_line, info_button, info_text, linkify, log, open_dialog, open_panel, show_console, stream } from "../../core/ui.mjs";
import { CREATE, cell_words, cells_editor, create_options, drop_provider_cells, edit_type, empty_row, fit_rows, same_number, shape_of, sync_ghost, with_ghost, with_go, written_value } from "./editors.mjs";
import { attach_paths, path_field } from "../../core/paths.mjs";
import { attach_open_with, open_with_button } from "../../core/open.mjs";
import { shown_type } from "./dt-type.mjs";
import { changed_lines, node_lines } from "./source-nodes.mjs";
import { open_setting } from "../../core/setup.mjs";

export const title = "Linux";
export const about = "Device tree overlays for a Linux board (Raspberry Pi and others).";
/** No toasts in a Linux project, the core's included (ui.mjs use_toasts). */
export const toasts = false;
/** No console preferences (its height, the GUI's own reads) in a Linux project (ui.mjs use_console_options). */
export const console_options = false;
/** Whether a command the setup's start ran failed, and the step's problem when it did. */
const start_failed = result => result.code !== 0 || result.json?.ok === false;
const start_problem = result => ({ ok: false, problem: first_line(result.json?.message ?? (result.stderr || result.stdout)) });

/** The overlay syntaxes, each by what it writes: the CLI's description (one line, for the terminal), laid out. */
const SYNTAXES_ABOUT = `<dl class="syntaxes">
	<dt>fragment:</dt><dd><code>fragment@0 { target = &lt;&amp;spi0&gt;; __overlay__ { … }; };</code></dd>
	<dt>reference:</dt><dd><code>&amp;spi0 { … };</code></dd>
</dl>`;

/** What the project setup asks for (in order), then offers as optional, for a Linux project. */
export const setup = {
	keys: ["linux", "devicetree"],
	titles: { linux: "Linux tree", devicetree: "Base devicetree", optional: "Overlay" },
	optional: ["workfile", "overlay-syntax", "output"],
	// The CLI's also says setting it builds the binding caches: the step says so while it is saved.
	description: { linux: "Path to Linux kernel source tree", workfile: "Name of the workfile, if a valid workfile with this name already exists it will use that" },
	// The workfile is a name in the project folder; left empty, init makes overlay.dtso there.
	names: { workfile: "overlay.dtso" },
	// The output's options say it all: no description.
	about: { "overlay-syntax": SYNTAXES_ABOUT, output: "" },
	// With none yet, the setup's last step starts one (the part has no start of its own): the setup ends in the overlay.
	start: {
		actions: [
			{
				id: "create", label: "Create Overlay", primary: true, saving: "Creating the overlay…",
				run: async ({ cli: run }) => {
					// init needs a workfile: the field left empty, it is the step's placeholder, in the project folder.
					const workfile = await run(["config", "workfile", "--json"], { quiet: true });
					if (!workfile.json?.configs?.[0]?.value) {
						const named = await run(["config", "workfile", setup.names.workfile, "--json"]);
						if (start_failed(named)) {
							return start_problem(named);
						}
					}
					const result = await run(["init", "--json"]);
					return start_failed(result) ? start_problem(result) : { ok: true };
				},
			},
			{
				id: "import", label: "Import Overlay",
				// The import panel, its commands run as they are (the part isn't mounted yet); undefined when closed with none.
				run: ({ cli: run }) => new Promise(resolve => {
					let imported = false;
					open_import({
						import_overlay: async source => {
							const result = await run(["import", source, "--json"]);
							imported = !start_failed(result);
							return result;
						},
						on_close: () => resolve(imported ? { ok: true } : undefined),
					});
				}),
			},
		],
	},
	help: {
		linux: `<p class="subtle">None yet? In a terminal: <code>git clone --depth 1 --branch rpi-6.12.y https://github.com/analogdevicesinc/linux.git ~/linux-adi</code></p>`,
	},
	found: {
		// The CLI finds none for linux (CONFIG-017 is noos's): the server looks near the project and under ~.
		linux: async ({ api }) => ((await (await api("/api/linux-trees")).json()).trees ?? []).map(tree => ({ value: tree.path, display_string: "a Linux tree" })),
	},
	refused: {
		// A folder of a tree (its arch/, Documentation/devicetree): its root, offered.
		linux: async (value, _problem, { api }) => {
			const root = (await (await api(`/api/linux-trees?inside=${encodeURIComponent(value)}`)).json()).root;
			return root ? { text: `It is inside the Linux tree ${root}.`, value: root } : null;
		},
	},
	choices: {
		// The base devicetrees of the tree (list context), the Raspberry Pis first.
		devicetree: async ({ cli }) => {
			const listed = (await cli(["list", "context", "--json"], { quiet: true })).json?.devicetrees ?? [];
			const choices = listed.map(dts => ({ value: dts.path, label: dts.name, detail: board_name(dts.name), note: dts.arch }));
			return [...choices.filter(choice => choice.label.includes("-rpi-")), ...choices.filter(choice => !choice.label.includes("-rpi-"))];
		},
	},
	// Setting the tree or the base builds the binding caches.
	saving: {
		linux: "Saving and building cache, this may take a few seconds.",
		devicetree: "Saving and building cache, this may take a few seconds.",
	},
};

/** A Raspberry Pi's name from its devicetree's (bcm2711-rpi-4-b.dts: Raspberry Pi 4 Model B), else nothing. */
function board_name(file) {
	const model = /-rpi-(.+)\.dts$/.exec(file)?.[1];
	if (model === undefined) return "";
	const named = model
		.replace(/^(\d)-b-plus$/, "$1 Model B+").replace(/^(\d)-a-plus$/, "$1 Model A+").replace(/^(\d)-b$/, "$1 Model B").replace(/^(\d)-a$/, "$1 Model A")
		.replace(/^cm(\d)(s?)(.*)$/, (_all, n, s, rest) => `Compute Module ${n}${s ? "S" : ""}${rest.replace(/-/g, " ").replace(/ io$/, " IO Board")}`)
		.replace(/^zero-2-w$/, "Zero 2 W").replace(/^zero-w$/, "Zero W").replace(/^zero$/, "Zero");
	return `Raspberry Pi ${named}`;
}

const state = {
	workfile: false,       // the overlay exists (read / --json answers)
	root: null,            // the overlay's devices, from the merged tree: { children: [nodes] }
	text: "",              // read: the overlay as saved
	// The lines a change wrote to it, flashed for a moment: { lines, at, scrolled } (scrolled: brought into view once).
	flash: null,
	// The full devicetree the last build wrote (output devicetree): { path, text, stale }, or null
	// while there is none (another output, not built yet); the right column's Overlay tab shows it
	// in the overlay's place when side_source is "full".
	full: null,
	side_source: "overlay", // overlay | full
	// A refusal or a complaint, said where it happened until the next edit: { place, text, kind }
	// (problem_slot). No toasts in this part.
	problem: null,
	held: null,            // what a refused editor's fields held, put back at each redraw (hold_fields)
	targets: [],          // [{ target, nodes: [key] }]: the buses the overlay adds to or changes, by label
	errors: [], warnings: [],
	validated: false,
	selected: null,        // the path of the node open: a label, or label/child
	node: null,            // read <selected> --json
	props: null,           // list property <selected> --json
	patterns: [],          // its child nodes' name patterns (^channel@…$)
	prop_patterns: [],     // its properties' name patterns (^pinctrl-[0-9]+$)
	refused: new Map(),    // node + property → the values its refused update had (show_refused)
	devices: null,         // list devices --json, once
	about: new Map(),      // compatible → what its binding says (list devices <compatible> --json), once each
	about_open: new Set(), // the nodes (by selected) with the binding's description open
	said: new Map(),       // property → what the binding says of it on the node open ("" for nothing), for Add Property
	described: new Map(),  // property → list property <node> <property>'s property, for an Add Property name state.props hasn't (pinctrl-0)
	buses: null,           // [{ name, path, labels, status, source }]: the SPI and I2C buses, for Add Device and Move
	settings: {},          // config --json: { key: value }
	busy: false,
	validating: false,     // a change running, or dt-validate reading the overlay: the status spins
	// The tree beside the node: the overlay's devices by bus, or the whole merged devicetree.
	merged: null,          // read / --json: the base with the overlay applied, opened where it changes
	loaded: new Map(),     // a base node's children, read when it is first opened: path -> nodes
	// A bus the overlay adds devices to: its children from the base, which the merged tree leaves
	// out where the overlay doesn't reach them (spidev@0): path -> nodes. Read again after each change.
	bus_base: new Map(),
	open: new Set(),       // nodes opened by hand
	closed: new Set(),     // nodes closed by hand (open by default: those with changes below)
	shown_open: new Set(), // the nodes open in the tree as last drawn
	// The tree focused: only what the overlay adds or changes, the way to it and what else is on the
	// buses it adds devices to, unless unticked; a search looks through the whole merged tree all the
	// same, read for it (node_index), not only what has been opened.
	focused: (() => { try { return localStorage.getItem("aa-linux-only-changed") !== "0"; } catch { return true; } })(),
	tree_filter: "",
	// The search's index: every node of the merged tree (list node --json), read at the first search
	// and kept until the tree is read again (drop_node_index): { by_path, children (parent path ->
	// nodes), stale (the tree read again since: shown until the new one is in), failed }. null: not read.
	node_index: null,
	editing: null,         // Add Property open: { filter, pick, suggestions, custom }
	// Each property's type as dt-schema gives it (type_text), in the fields and Add Property: off
	// unless turned on in Preferences. Kept.
	show_types: (() => { try { return localStorage.getItem("aa-linux-show-types") === "1"; } catch { return false; } })(),
	// The right column (the overlay and its validation) folded to a ribbon: kept, else folded on a
	// narrow window.
	// Folded unless opened (Preferences, or its ribbon): the node's card says the same.
	side_folded: (() => { try { return localStorage.getItem("aa-linux-side") !== "open"; } catch { return true; } })(),
	// What the right column shows: the overlay and its validation, the binding of the node open
	// (side_binding; the overlay's while there is none), or the chat with the assistant (the core's,
	// docked here: chat.dock). Kept.
	side_tab: (() => { try { return side_tab_of(localStorage.getItem("aa-linux-side-tab")); } catch { return "overlay"; } })(),
	// The way back from a node opened by a reference (a link, a field's "go to", a node added for a property):
	// { to, name, at }, the "← back to <name>" in the header of the node at `at`; one step, not a history.
	back: undefined,
	creatable: new Map(),    // property name → the compatibles list value offers to add for it (can_create), asked once each
	label_checks: new Map(), // label → whether it names a node (read <label>), for one the merged tree and the bindings' lists haven't; undefined while asked
	binding_files: new Map(), // a binding file's path → what the server read of it: { text } (or too_big, binary, error)
};

/** A tab of the right column, as kept: overlay, binding or chat (kept as claude before the chat took any model). */
function side_tab_of(kept) {
	if (kept === "claude") return "chat";
	return kept === "chat" || kept === "binding" ? kept : "overlay";
}

let host;   // the core's context
let main;   // this part's element
/** The core's chat, told when its panel comes on screen or leaves it (chat.dock's place). */
let chat_changed = () => {};

// No menu (so no fold of the core's): the tree, the node, the right column.
const LAYOUT = `
	<section class="list" id="lx-list"></section>
	<section class="content lx-middle" id="lx-content"></section>
	<aside class="lx-side" id="lx-side">
		<div class="lx-side-resize" data-side-resize title="Drag to resize; double-click to reset"></div>
		<div class="lx-side-pane" id="lx-side-pane"></div>
		<div class="lx-chat-dock" id="lx-chat-dock" hidden></div>
	</aside>`;

/** The chat docked in the right column is the core's: its clicks, keys and fields aren't the part's. */
const not_chat = handler => event => (event.target.closest?.(".chat") ? undefined : handler(event));

/** Draw the Linux part in `context.main`; resolves with what the core calls after. */
export async function mount(context) {
	host = context;
	main = context.main;
	main.dataset.eco = "linux";
	// The first read is no change: nothing of another project's overlay to flash against.
	state.text = "";
	state.flash = null;
	main.innerHTML = LAYOUT;
	if (document.getElementById("lx-style") === null) document.head.insertAdjacentHTML("beforeend", `<link id="lx-style" rel="stylesheet" href="ecosystems/linux/linux.css">`);
	context.header_actions.innerHTML = `<button id="lx-validate">Validate</button><button id="lx-build" class="primary">Build Overlay</button><button id="lx-deploy">Deploy</button>`;
	// What validate says is in the console, opened for it.
	$("lx-validate").onclick = async () => {
		show_console();
		await cli(["validate"]);
		await refresh();
	};
	$("lx-build").onclick = () => build();
	$("lx-deploy").onclick = () => deploy();
	main.addEventListener("click", not_chat(on_click));
	attach_open_with(main);
	// A problem said in place goes at the next edit (the field keeps what was typed). First, so a
	// change that is refused again says it anew.
	main.addEventListener("input", not_chat(event => {
		if (event.target.closest?.("#lx-content")) clear_problem();
	}), { capture: true });
	side_width(stored_side_width());
	main.addEventListener("mousedown", start_side_resize);
	// A property's ✕ keeps the focus where it is: leaving a field sends what is typed in it, and the ✕ drops that.
	// A label field's "go to <label>" too: it sends what is typed itself before it goes (go_from_field), so its click isn't lost to the redraw.
	main.addEventListener("mousedown", event => {
		if (event.target.closest?.(`[data-act="clear"], [data-act="go-label"]`)) event.preventDefault();
	});
	// A number field's ghost and a label field's link follow what is typed; a list of labels keeps what it
	// held, for its ＋ Add entries to put it back (create_for).
	main.addEventListener("input", not_chat(event => {
		const field = event.target;
		if (field.matches?.(".lx-num > input")) sync_ghost(field);
		if (field.matches?.(".lx-labels")) sync_go(field);
		if (field.tagName === "SELECT" && !field.value.startsWith(CREATE)) field.dataset.was = field.value;
	}));
	main.addEventListener("change", not_chat(on_change));
	main.addEventListener("focusin", on_focus);
	main.addEventListener("input", event => {
		if (event.target.id !== "lx-prop-filter" || state.editing === null) return;
		state.editing.filter = event.target.value;
		const filter = event.target.value.trim().toLowerCase();
		for (const row of main.querySelectorAll(".lx-pick-row")) row.hidden = filter !== "" && !row.dataset.match.includes(filter);
	});
	main.addEventListener("dblclick", event => {
		// A flag or a pinned value has nothing to type: added at once. Any other has its field, where the first click went.
		const row = event.target.closest?.(".lx-pick-row");
		if (row !== null && row !== undefined && main.querySelector(PICK_FIELD) === null) add_picked_property();
	});
	main.addEventListener("keydown", not_chat(event => {
		if (event.key === "Enter" && event.target.id === "lx-prop-filter") {
			const first = [...main.querySelectorAll(".lx-pick-row")].find(row => !row.hidden);
			if (first) pick_property(first.dataset.name);
		}
		if (event.key === "Enter" && event.target.matches?.("input[data-edit]")) event.target.blur();
		if (event.key === "Enter" && ["lx-custom-name", "lx-custom-value"].includes(event.target.id)) main.querySelector('[data-act="add-custom"]')?.click();
		if (event.key === "Enter" && event.target.closest?.(".lx-pick-detail") && event.target.matches("input, select")) {
			event.preventDefault();
			main.querySelector('.lx-pick-detail [data-act="pick-add"]')?.click();
		}
		if (event.key === "Escape" && main.querySelector(".lx-editor")) main.querySelector('.lx-editor [data-act="prop-close"]')?.click();
	}));
	await refresh();
	return {
		refresh,
		// Deploy sits where the core's Project Setup button is; the project's settings are the
		// gear's Project tab, so the preferences offer no setup either.
		setup_button: false,
		setup_option: false,
		project: { title: "Project", draw: draw_project },
		preferences: [{
			title: "Linux",
			items: [
				{
					label: "Show property types", hint: "Each property's type as dt-schema gives it, with its constraints (uint32 · 0 to 10000000).", kind: "switch",
					value: () => state.show_types,
					set: on => { state.show_types = on; try { localStorage.setItem("aa-linux-show-types", on ? "1" : "0"); } catch {} render(); },
				},
			],
		}],
		chat: {
			skill: "analog-attach-linux",
			hint: "<i>add an AD7124-8 on spi0</i>, <i>wire its interrupt to GPIO 25</i>, <i>why does validate fail?</i>",
			context: () => [
				"This is a Linux project: a device tree overlay on a base devicetree; follow the analog-attach-linux skill.",
				state.selected ? `The user has the node ${state.selected} open in the GUI.` : "",
			].join(" "),
			// The panel in the right column, in the overlay's place.
			dock: {
				place(panel, changed) {
					$("lx-chat-dock").append(panel);
					chat_changed = changed;
				},
				shown: () => main.isConnected && !state.side_folded && state.side_tab === "chat",
				show() {
					state.side_folded = false;
					set_side_tab("chat");
				},
				hide: () => set_side_tab("overlay"),
			},
		},
	};
}

// --- the CLI ---------------------------------------------------------------------------

/** The changes, one after the other: one made while another is written waits for it. */
let changes = Promise.resolve();

/**
 * A command that changes the overlay: run it with --json, read again. The console has what it
 * said; a success shows nothing more. A refusal (or a warning) is said in place: under the field
 * or by the button `place` names (problem_slot), or with "console" by opening the console; with
 * no `place`, the caller says it (a dialog) or the console has it. A new compatible on the node
 * open is a new binding: what it fixes is set after it (fill_fixed).
 */
async function mutate(args, { place } = {}) {
	const run = changes.then(() => mutate_now(args, place));
	changes = run.catch(() => undefined);
	const result = await run;
	if (args[0] === "update" && args[2] === "compatible" && args[1] === state.selected && written(result)) {
		state.said.clear();
		state.described.clear();
		await fill_fixed();
	}
	return result;
}

async function mutate_now(args, place) {
	state.busy = true;
	document.body.style.cursor = "progress";
	// The status spins from now until dt-validate has read the overlay again.
	state.validating = true;
	render();
	try {
		const result = await cli([...args, "--json"]);
		const failed = result.code !== 0 || result.json?.ok === false;
		if (!failed) follow_rename(args, result.json?.message ?? "");
		const warning = (result.stderr ?? "").trim();
		if (warning !== "") log(`<div class="fail">${esc(warning)}</div>`);
		const missing = result.json?.missing_required ?? [];
		if (missing.length > 0) log(`<div>${esc(`Still to set: ${missing.map(item => item.property).join(", ")}`)}</div>`);
		if (failed || result.json?.severity === "warn") {
			const text = first_line(result.json?.message ?? (failed ? result.stderr : result.stdout));
			if (place === "console") show_console();
			else if (place !== undefined) say_problem(place, text, failed ? "error" : "warn");
		}
		await refresh({ settings: false });
		return result;
	} finally {
		state.busy = false;
		document.body.style.cursor = "";
		// The change is written; dt-validate may still be reading it: the status says so.
		if (state.validating) render();
	}
}

/**
 * After a change that renames the node open (rename, or update reg, which renames it to its new
 * unit address), the path the GUI keeps for it: its last name replaced, so the card stays on it.
 * A node open by its label alone keeps it: a label doesn't change.
 */
function follow_rename(args, message) {
	if (state.selected === null) return;
	const renamed = /renamed to (\S+?)\s*$/.exec(message)?.[1] ?? (args[0] === "rename" && args[1] === state.selected ? args[2] : undefined);
	if (renamed === undefined || (args[1] !== state.selected && args[0] !== "rename")) return;
	const parts = state.selected.split("/");
	if (parts.length === 1 && !state.selected.startsWith("/")) return;
	const old = parts.at(-1) ?? "";
	// A name without @ keeps the unit address (rename's rule).
	const key = renamed.includes("@") || !old.includes("@") ? renamed : `${renamed}@${old.split("@")[1]}`;
	parts[parts.length - 1] = key;
	const was = state.selected;
	state.selected = parts.join("/");
	if (state.back?.at === was) state.back.at = state.selected;
}

/** A node the overlay adds: its own, with nothing from the base. */
const added_by_overlay = node => node.origin === "internal" && !(node.properties ?? []).some(property => property.source === "base");

/**
 * The overlay's devices and their buses, from the merged tree (read / --json). A device is the top
 * of a subtree the overlay adds; its bus is the node above, by its first label (as a fragment's
 * target names it), else its path. A base node the overlay changes without adding to it (a bus it
 * enables) is a bus with no device.
 */
function overlay_devices(merged) {
	const devices = [];
	const targets = [];
	const walk = (node, path) => {
		const placed = [];
		for (const child of node.children ?? []) {
			if (added_by_overlay(child)) {
				devices.push(child);
				placed.push(child.key);
			} else if ((child.children ?? []).length > 0 || child.origin === "internal") {
				walk(child, child_path(path, child.key));
			}
		}
		if (placed.length > 0 || node.origin === "internal") targets.push({ target: label_of(node) ?? path, nodes: placed });
	};
	walk(merged, "/");
	return { root: { kind: "node", key: "/", children: devices }, targets };
}

/**
 * Read the project again. The reads go together (each CLI run preprocesses into its own file,
 * so they may), and dt-validate starts with them rather than after: the view is drawn once the
 * reads are in, the validation when it is. `settings` reads the settings too (not after a change
 * to the overlay, which can't change them). The overlay's devices come from the merged tree,
 * which has every node `read --json` has, where it goes (READ-011): one run fewer, and no more
 * than the six requests a browser sends to one server at once.
 */
async function refresh({ settings = true } = {}) {
	const validation = cli(["validate", "--json"], { quiet: true });
	state.validating = true;
	const selected = state.selected;
	const [text, merged, configs, node, props] = await Promise.all([
		cli(["read"], { quiet: true }),
		cli(["read", "/", "--json"], { quiet: true }),
		settings || Object.keys(state.settings).length === 0 ? cli(["config", "--json"], { quiet: true }) : Promise.resolve(undefined),
		selected === null ? Promise.resolve(undefined) : cli(["read", selected, "--json"], { quiet: true }),
		selected === null ? Promise.resolve(undefined) : cli(["list", "property", selected, "--json"], { quiet: true }),
	]);
	state.workfile = merged.json !== undefined && merged.json.ok !== false && merged.json.kind === "node";
	state.merged = state.workfile ? merged.json : null;
	// The search's index is of the tree as it was: read again (kept, and shown, until it is in).
	drop_node_index({ keep: true });
	const overlay_text = state.workfile ? text.stdout : "";
	if (state.text !== "" && overlay_text !== state.text) state.flash = { lines: changed_lines(state.text, overlay_text), at: performance.now(), scrolled: false };
	state.text = overlay_text;
	({ root: state.root, targets: state.targets } = state.workfile ? overlay_devices(state.merged) : { root: null, targets: [] });
	if (configs !== undefined) {
		state.settings = Object.fromEntries((configs.json?.configs ?? []).map(config => [config.field_name, config.value]));
	}
	state.buses = null;
	if (selected !== null && state.selected === selected) {
		state.node = node?.json?.kind === "node" ? node.json : null;
		state.props = props?.json?.properties ?? [];
		Object.assign(state, patterns_of(props?.json));
	}
	// A device of the overlay by its label, any node of the merged tree by its path, or a node of the
	// base by its label (a reference followed to one below what the tree reaches); gone, nothing.
	const by_label = state.selected !== null && !state.selected.includes("/") && (state.node?.alias ?? []).includes(state.selected);
	if (state.selected !== null && (state.node === null || (!state.selected.startsWith("/") && find_node(state.selected) === undefined && !by_label))) {
		state.selected = null;
		state.editing = null;
		await load_selected();
	}
	render();
	load_bus_children();
	load_full();
	validation.then(result => {
		if (!main?.isConnected) return;
		if (state.workfile) {
			// validate itself failing (dtc can't read the overlay: a number no cell holds) is an error, not a valid overlay.
			const failed = result.json === undefined || result.json.ok === false;
			state.errors = failed ? [{ path: [], message: result.json?.message ?? (result.stderr || "validate failed") }] : result.json.errors ?? [];
			state.warnings = result.json?.warnings ?? [];
			state.validated = true;
		}
		state.validating = false;
		render();
	});
}

/** A bus by the node's name (spi, i2c) or its compatible. */
const is_bus = node => /^(spi|i2c)(@|$)/.test(node.key) || [compatible_of(node)].flat().some(value => /\b(spi|i2c)\b/.test(String(value ?? "")));

/**
 * The base's children of the buses the overlay adds devices to (bus_base): a chip select or an
 * address the base already uses (spidev@0) is in the tree, to see and to turn off. A node with a
 * device of the overlay right under it is read; kept if it is a bus. Drawn again if they changed.
 */
async function load_bus_children() {
	const parents = [];
	const walk = (node, path) => {
		const children = node.children ?? [];
		if (path !== "/" && !added_by_overlay(node) && children.some(child => added_by_overlay(child))) parents.push(path);
		for (const child of children) if (!added_by_overlay(child)) walk(child, child_path(path, child.key));
	};
	if (state.merged !== null) walk(state.merged, "/");
	const found = new Map();
	// A few at a time, as load_buses.
	for (let at = 0; at < parents.length; at += 3) {
		await Promise.all(parents.slice(at, at + 3).map(async path => {
			const { json: node } = await cli(["read", path, "--json"], { quiet: true });
			if (node?.kind === "node" && is_bus(node)) found.set(path, (node.children ?? []).filter(child => !added_by_overlay(child)));
		}));
	}
	const same = found.size === state.bus_base.size && [...found].every(([path, nodes]) => JSON.stringify(nodes) === JSON.stringify(state.bus_base.get(path)));
	state.bus_base = found;
	if (!same && main?.isConnected) render();
}

/**
 * The full devicetree the last build wrote, where the output setting is devicetree (state.full):
 * read for the Overlay tab's Full .dts, which is offered only while the file is there; stale when
 * it is older than the overlay. Drawn again when that changed.
 */
async function load_full() {
	const files = build_files();
	let full = null;
	if (files.full) {
		const read = async path => (await api(`/api/file?path=${encodeURIComponent(path)}`)).json().catch(() => ({}));
		const path = project_path(files.source);
		const [source, overlay] = await Promise.all([read(path), read(String(state.settings.workfile ?? ""))]);
		if (typeof source.text === "string") full = { path: source.path ?? path, text: source.text, stale: typeof overlay.modified === "number" && source.modified < overlay.modified };
	}
	const same = JSON.stringify(full) === JSON.stringify(state.full);
	state.full = full;
	if (full === null) state.side_source = "overlay";
	if (!same && main?.isConnected && state.workfile) draw_side();
}

async function validate_quietly() {
	state.validating = true;
	render();
	const result = await cli(["validate", "--json"], { quiet: true });
	state.errors = result.json?.errors ?? [];
	state.warnings = result.json?.warnings ?? [];
	state.validated = true;
	state.validating = false;
	render();
}

async function load_selected() {
	if (state.selected === null) {
		state.node = null;
		state.props = null;
		return;
	}
	const [node, props] = await Promise.all([
		cli(["read", state.selected, "--json"], { quiet: true }),
		cli(["list", "property", state.selected, "--json"], { quiet: true }),
	]);
	state.node = node.json?.kind === "node" ? node.json : null;
	state.props = props.json?.properties ?? [];
	Object.assign(state, patterns_of(props.json));
}

/**
 * The name patterns of a node's binding (list property's names, ^…$), told apart by its
 * child_patterns: a child node's (^channel@…$) or a property's (^pinctrl-…$).
 */
function patterns_of(json) {
	const all = (json?.names ?? []).filter(name => name.startsWith("^"));
	const children = new Set(json?.child_patterns ?? []);
	return { patterns: all.filter(name => children.has(name)), prop_patterns: all.filter(name => !children.has(name)) };
}

/** A pattern without its ^, its groups of plain text unwrapped: ^(channel@)[0-7]$, channel@[0-7]$. */
function literal_groups(pattern) {
	return pattern.slice(1).replaceAll(/\(([^()|[\]\\?*+{}.]*)\)/g, "$1");
}

/** The names a pattern takes (^channel@([0-9]|1[0-5])$: channel@0, channel@1, …), the `taken` left out. */
function free_names(pattern, taken) {
	const prefix = literal_groups(pattern).split(/[([\\]/)[0];
	const matcher = new RegExp(pattern);
	const names = [];
	for (let at = 0; at < 256 && names.length < 64; at++) {
		for (const name of [`${prefix}${at}`, `${prefix}${at.toString(16)}`]) {
			if (matcher.test(name) && !taken.has(name) && !names.includes(name)) names.push(name);
		}
	}
	return names;
}

/** What a node's children are called on its card: Channels when the binding's are channel@N. */
function children_title(patterns) {
	const prefixes = patterns.map(pattern => literal_groups(pattern).split(/[@([\\]/)[0]);
	if (prefixes.length > 0 && prefixes.every(prefix => prefix === "channel")) return { title: "Channels", one: "Channel" };
	return { title: "Child nodes", one: "Child Node" };
}

/**
 * Add a child node (channel@0) and open it. A child with a unit address needs the node's
 * #address-cells and #size-cells: when the binding pins them and they aren't set, they
 * are written first.
 */
async function add_child(name) {
	const parent = state.selected;
	if (name.includes("@")) {
		const set = new Set((state.node?.properties ?? []).map(property => property.key));
		for (const [cells, fallback] of [["#address-cells", "1"], ["#size-cells", "0"]]) {
			const binding = (state.props ?? []).find(prop => prop.name === cells);
			if (binding === undefined || set.has(cells)) continue;
			const fixed = binding.pinned ?? binding.type?.options?.[0]?.value ?? fallback;
			await mutate(["update", parent, cells, String(fixed)], { place: "child" });
		}
	}
	// Refused, it is said by Add Channel, on the node still open.
	if (!written(await mutate(["update", parent, name], { place: "child" }))) return;
	await select(`${parent}/${name}`);
	await fill_fixed();
}

/**
 * Set what the binding fixes on the node open, one the GUI has just made (Add Device, Add
 * Channel) or given a new compatible: each required property it lacks that the binding pins to
 * one value or gives a default, so there is nothing to click for it (the terminal's add asks for
 * the defaults instead). Setting one can make the binding require more (its if/then): the
 * reads after the update list them, and each is tried once. A node only opened is never written
 * to.
 */
async function fill_fixed() {
	const path = state.selected;
	const tried = new Set();
		for (;;) {
		const next = (state.props ?? []).find(prop => prop.required && !prop.set && !tried.has(prop.name) && fixed_words(prop) !== undefined);
		if (next === undefined || state.selected !== path) break;
		tried.add(next.name);
		await mutate(["update", path, next.name, ...fixed_words(next)], { place: "card" });
	}
}

/** The value the binding fixes, as update takes it: the one it allows, else its default; none for a choice. */
function fixed_words(binding) {
	if (binding.pinned !== undefined) return pin_words(binding);
	const value = binding.default;
	if (value === undefined || value === null || value === false) return undefined;
	return value === true ? [] : [value].flat().map(String);
}

/** Add Property's fields for the value of the one picked: its cells, or its one field. */
const PICK_FIELD = ".lx-pick-detail :is(.lx-cell, .lx-value)";

/** What the binding of `compatible` says of the device and its properties (list devices <compatible> --json), read once. */
async function load_about(compatible) {
	if (state.about.has(compatible)) return;
	const result = await cli(["list", "devices", compatible, "--json"], { quiet: true });
	const device = result.json?.device;
	state.about.set(compatible, device?.key === compatible ? device : { missing: `No binding found for ${compatible}.` });
}

/**
 * What the binding says of each property Add Property offers (state.said), read when the panel
 * opens so that picking one shows it at once: the device's binding has them in one answer; the
 * others (a child node's, a numbered one) are asked one by one, a few at a time. The one picked
 * meanwhile gets its text in place: a redraw would take what is being typed. The text is shown as
 * the binding writes it, line for line: its lines aren't joined (a list in it stays one).
 */
async function load_said() {
	const path = state.selected;
	const said = state.said;
	const show = () => {
		const about = main.querySelector(".lx-pick-about");
		const text = said.get(state.editing?.pick);
		if (state.selected === path && about !== null && text !== undefined) about.innerHTML = linkify(text.trim());
	};
	const compatible = first_compatible(state.node);
	if (compatible !== undefined) {
		await load_about(compatible);
		for (const property of state.about.get(compatible)?.properties ?? []) {
			if (!said.has(property.name)) said.set(property.name, property.description ?? "");
		}
		show();
	}
	const rest = addable_properties().map(choice => choice.name).filter(name => !said.has(name));
	for (let at = 0; at < rest.length && state.selected === path && state.editing !== null; at += 3) {
		await Promise.all(rest.slice(at, at + 3).map(name => describe(path, name)));
		show();
	}
}

/**
 * What the binding says of a property of the node at `path` that state.props doesn't list (a
 * numbered one, pinctrl-0, its type the pattern's): list property <path> <name>, its description
 * kept in state.said and the whole property in state.described, for the node still open.
 */
async function describe(path, name) {
	const result = await cli(["list", "property", path, name, "--json"], { quiet: true });
	if (state.selected !== path) return;
	const property = result.json?.property;
	state.said.set(name, property?.description ?? "");
	if (property !== undefined) state.described.set(name, property);
}

/** What the binding says of a property Add Property offers: the node's list, else describe's. */
const offered_binding = name => (state.props ?? []).find(prop => prop.name === name) ?? state.described.get(name);

/**
 * Add Property: one picked, its value's field drawn and gone to, with what the binding says of
 * it (load_said has it; for a name state.props doesn't list it is read first when it hasn't yet,
 * the field being in the shape of its type). The values it could take (list value) are read, and
 * put in place.
 */
async function pick_property(name) {
	if (state.editing === null || state.editing.name !== undefined || state.editing.pick === name) return;
	const path = state.selected;
	if (offered_binding(name) === undefined) {
		await describe(path, name);
		if (state.selected !== path || state.editing === null || state.editing.name !== undefined || state.editing.pick === name) return;
	}
	state.editing.pick = name;
	state.editing.suggestions = [];
	render();
	(main.querySelector(PICK_FIELD) ?? main.querySelector('.lx-pick-detail [data-act="pick-add"]'))?.focus();
	const suggested = main.querySelector(".lx-pick-suggested");
	if (suggested === null) return;
	const values = await cli(["list", "value", state.selected, name, "--json"], { quiet: true });
	keep_creatable(name, { can_create: values.json?.can_create });
	if (state.editing?.pick !== name) return;
	state.editing.suggestions = values.json?.suggestions ?? [];
	if (suggested.isConnected) suggested.innerHTML = suggestions_list(state.editing.suggestions);
}

/**
 * Add Property's Add: the property is written with the value given in the panel (a flag, or a
 * value the binding pins, has none to give), and joins the node's properties, at their end.
 * Refused, the panel stays, with what was typed.
 */
async function add_picked_property() {
	const name = state.editing?.pick;
	if (name === undefined) return;
	const binding = offered_binding(name);
	let words;
	if (binding?.pinned !== undefined) words = pin_words(binding);
	else if (binding?.type?.kind === "bool") words = [];
	else {
		const typed = editor_words(main.querySelector(".lx-pick-detail"));
		if (typed.words === undefined) {
			say_problem("pick", typed.incomplete ? "Fill every cell" : `Give ${name} its value`);
			[...main.querySelectorAll(PICK_FIELD)].find(field => field.value.trim() === "")?.focus();
			return;
		}
		words = typed.words;
	}
	// The redraws of the update take the fields: what they held is put back if it is refused.
	const put_back = hold_fields(PICK_FIELD);
	if (written(await mutate(["update", state.selected, name, ...words], { place: "pick" }))) {
		close_editor();
		return;
	}
	if (state.editing?.pick === name) put_back();
}

/** Open Add Property under the node's properties. */
async function open_add_property() {
	drop_problem();
	state.editing = {};
	render();
	// Brought into view, once the redraw has put the scroll back.
	await Promise.resolve();
	main.querySelector(".lx-editor")?.scrollIntoView({ block: "nearest" });
}

async function load_devices() {
	if (state.devices !== null) return;
	const result = await cli(["list", "devices", "--json"], { quiet: true });
	state.devices = result.json?.devices ?? [];
}

/** The base's buses an SPI or I2C device can go on, each with its status in the overlay. */
async function load_buses() {
	if (state.buses !== null) return;
	const parents = await cli(["list", "parent", "adi,adxl345", "--json"], { quiet: true });
	const buses = (parents.json?.suggestions ?? []).map(suggestion => ({ name: suggestion.value, path: suggestion.display_string }));
	// A few at a time: a dozen CLIs at once on the same project don't all answer.
	const read_bus = async bus => {
		const node = (await cli(["read", bus.name, "--json"], { quiet: true })).json;
		const status = node?.properties?.find(property => property.key === "status");
		// The bus by its first label (spi0, not its other one spi): the overlay's targets use it.
		bus.labels = node?.alias ?? [bus.name];
		bus.name = bus.labels[0] ?? bus.name;
		// No status property is okay (the devicetree default); no answer is unknown.
		bus.status = node?.kind !== "node" ? "unknown" : status?.value ?? "okay";
		bus.source = status?.source ?? "base";
	};
	for (let at = 0; at < buses.length; at += 3) await Promise.all(buses.slice(at, at + 3).map(read_bus));
	state.buses = buses;
}

// --- the tree ---------------------------------------------------------------------------

const label_of = node => node?.alias?.[0];
/** The path the CLI takes for a device: its label, or its name. */
const path_of = node => label_of(node) ?? node.key;
const compatible_of = node => node?.properties?.find(property => property.key === "compatible")?.value;
/** The node's most specific compatible: the first of its list, the one its binding is found by. */
const first_compatible = node => [compatible_of(node)].flat().find(value => typeof value === "string" && value !== "");

/** A binding's text as written in its YAML, its lines joined: a blank line or an indented one still starts anew. */
const unwrap = text => text.trim().replace(/([^\n])\n(?=[^\s])/g, "$1 ");

/** What the binding of `compatible` says of the device: its title, its description and its file. */
function about_box(compatible) {
	const about = state.about.get(compatible);
	if (about === undefined) return `<div class="lx-about subtle">Reading the binding…</div>`;
	if (about.title === undefined && about.description === undefined) return `<div class="lx-about subtle">${esc(about.missing ?? "The binding says nothing of the device.")}</div>`;
	return `<div class="lx-about">
		${about.title ? `<div class="lx-about-title">${esc(about.title)}</div>` : ""}
		${about.description ? `<div class="lx-about-text">${linkify(unwrap(about.description))}</div>` : ""}
		${about.binding ? `<div class="subtle mono lx-about-file" title="${esc(about.binding)}">${esc(about.binding.split("/bindings/").pop())}</div>` : ""}
	</div>`;
}

/** A node of the overlay by the path the GUI uses: label or name, then child names. */
function find_node(path) {
	const [first, ...rest] = path.split("/");
	let node = state.root?.children?.find(child => label_of(child) === first || child.key === first);
	for (const name of rest) node = node?.children?.find(child => child.key === name);
	return node;
}

// --- references: a label, the way to its node and back ----------------------------------------

/** A devicetree label: what `&label` names. */
const LABEL = /^[A-Za-z_]\w*$/;
/** Whether a property's binding gives it phandles (dt-schema's phandle, phandle-array): its values are labels. */
const is_phandle = binding => (binding?.dt_type ?? "").startsWith("phandle");
/** Whether a value read holds a reference (&label). */
const refers = value => [value].flat(Infinity).some(word => typeof word === "string" && word.startsWith("&"));

/** The labels a phandle's type lists (its first cell's choices: the context's nodes it can name). */
function listed_labels(type) {
	if (type?.kind === "enum") return (type.options ?? []).map(option => String(option.value));
	if (type?.kind === "array") return listed_labels(type.items);
	if (type?.kind === "tuple") return listed_labels(type.items?.[0]);
	return [];
}

/**
 * The labels known to name a node without asking: the merged tree's, what was read of the base
 * below it, and those the binding of the node open lists for its phandles. Worked out again when
 * one of them changed.
 */
let known = { from: [], labels: new Set() };
function known_labels() {
	const from = [state.merged, state.loaded.size, state.bus_base, state.props];
	if (from.every((part, at) => part === known.from[at])) return known.labels;
	const labels = new Set();
	const walk = (node, path) => {
		for (const alias of node.alias ?? []) labels.add(alias);
		for (const child of children_of(node, path)) walk(child, child_path(path, child.key));
	};
	if (state.merged !== null) walk(state.merged, "/");
	for (const property of state.props ?? []) if (is_phandle(property)) for (const label of listed_labels(property.type)) labels.add(label);
	known = { from, labels };
	return labels;
}

/**
 * Whether `label` names a node of the base or the overlay. One the GUI doesn't know (a base node
 * below what the merged tree reaches) is asked of the CLI (read <label>), a few at a time, and
 * the page drawn again when one does: false until then.
 */
function label_exists(label) {
	if (!LABEL.test(label)) return false;
	if (known_labels().has(label)) return true;
	if (!state.label_checks.has(label)) {
		state.label_checks.set(label, undefined);
		to_check.add(label);
		if (to_check.size === 1) queueMicrotask(check_labels);
	}
	return state.label_checks.get(label) === true;
}
const to_check = new Set();
async function check_labels() {
	let found = false;
	while (to_check.size > 0) {
		const batch = [...to_check].slice(0, 3);
		for (const label of batch) to_check.delete(label);
		await Promise.all(batch.map(async label => {
			const read = await cli(["read", label, "--json"], { quiet: true });
			state.label_checks.set(label, read.json?.kind === "node");
			found ||= read.json?.kind === "node";
		}));
	}
	if (found && main?.isConnected) render();
}

/**
 * The kinds of node that can be added for a property (list value's can_create: fixed-clock for
 * clocks, regulator-fixed for a supply), by its name, which is all they depend on: asked once
 * per name, the page drawn again when there are some. [] until then.
 */
function creatable_for(name) {
	if (!state.creatable.has(name) && state.selected !== null) {
		state.creatable.set(name, undefined);
		to_ask.add(name);
		if (to_ask.size === 1) queueMicrotask(ask_creatable);
	}
	return state.creatable.get(name) ?? [];
}
const to_ask = new Set();
async function ask_creatable() {
	let found = false;
	while (to_ask.size > 0 && state.selected !== null) {
		const batch = [...to_ask].slice(0, 3);
		for (const name of batch) to_ask.delete(name);
		const node = state.selected;
		await Promise.all(batch.map(async name => {
			const asked = await cli(["list", "value", node, name, "--json"], { quiet: true });
			const kinds = (asked.json?.can_create ?? []).map(item => item.value);
			state.creatable.set(name, kinds);
			found ||= kinds.length > 0;
		}));
	}
	// Not asked (no node open any more): asked again next time.
	for (const name of to_ask) state.creatable.delete(name);
	to_ask.clear();
	if (found && main?.isConnected) render();
}
/** What the read of a property said it can be given (its suggestions): the kinds of node to add for it, kept by its name. */
function keep_creatable(name, suggestions) {
	if (name !== undefined && suggestions !== undefined) state.creatable.set(name, (suggestions.can_create ?? []).map(item => item.value));
}

/**
 * Whether a property's fields hold labels, and what can be added for it: `{ labels, creatable }`,
 * as the editors take it (cells_editor's `links`). A phandle by its binding, or a value with a
 * reference in it (a property the binding doesn't define).
 */
function links_of(name, binding, property) {
	const labels = is_phandle(binding) || refers(property?.value);
	return { labels, creatable: labels ? creatable_for(name) : [] };
}

/**
 * A label field's link, "go to <label>" (with_go: under it, in the same wrap): shown while the
 * field holds a label that exists, its whole name in the title where the text is cut short.
 */
function sync_go(field) {
	const go = field.closest(".lx-go-field")?.querySelector(":scope > .lx-go");
	if (!go) return;
	const label = field.value.trim().replace(/^&/, "");
	const shown = label !== "" && !label.startsWith(CREATE) && label_exists(label);
	go.hidden = !shown;
	go.textContent = shown ? `go to ${label}` : "";
	go.title = shown ? `Open the node labelled ${label}` : "";
	go.dataset.label = shown ? label : "";
}

/** The ghosts of the number fields in `root`, and the links of its label fields, as their values are now. */
function sync_fields(root) {
	if (root === null) return;
	for (const input of root.querySelectorAll(":scope .lx-num > input")) sync_ghost(input);
	for (const field of root.querySelectorAll(".lx-labels")) sync_go(field);
}

/** The path of the merged tree's node with `label`, where the tree has it (a node of the base below what it reaches it hasn't). */
function find_label(label) {
	let found;
	const walk = (node, path) => {
		if (found !== undefined) return;
		if ((node.alias ?? []).includes(label)) {
			found = path;
			return;
		}
		for (const child of children_of(node, path)) walk(child, child_path(path, child.key));
	};
	if (state.merged !== null) walk(state.merged, "/");
	return found === "/" ? undefined : found;
}

/** Open the node `label` names (a link, a label field's "go to"), by its path where the tree has it, else by the label; the way back to the node open. */
async function go_to(label) {
	await select(find_label(label) ?? label, { back: state.selected ?? undefined });
}

/**
 * A label field's "go to <label>": what is typed in its field and not sent yet is sent first
 * (leaving the field does it, as anywhere), then the label it holds is opened.
 */
async function go_from_field(button) {
	const field = button.closest(".lx-go-field")?.querySelector(":scope > .lx-labels");
	const label = button.dataset.label;
	if (!label) return;
	if (field && field === document.activeElement && field.tagName === "INPUT" && field.value !== field.defaultValue) {
		field.blur();
		await changes;
	}
	await go_to(label);
}

/**
 * A list of labels' ＋ Add a <kind>…: the node is added (the CLI picks its parent and label), the
 * property set to it (in this field's place: the row of a list, the others as they are), and the
 * new node opened, with the way back. The field holds what it held meanwhile. Refused, the add
 * is said where the property is, and nothing more is done; the set refused, the node added stays,
 * and the view stays on the device, why said by the property.
 */
async function create_for(field, kind) {
	const name = field.closest("[data-prop]")?.dataset.prop;
	const from = state.selected;
	if (name === undefined || from === null) return;
	const place = field.closest(".lx-pick-detail") ? "pick" : property_place(name);
	const cells = field.closest(".lx-cells");
	// The words of the update, the new label where this field is.
	const SLOT = "\u0000label";
	const typed = cells === null ? undefined : cell_words(cells, { field, value: SLOT });
	if (typed?.incomplete) {
		say_problem(place, "Fill every cell first: the node added is set where this one is");
		return;
	}
	const words_for = label => typed === undefined ? [label] : typed.words.map(word => word.split(SLOT).join(label));
	const added = await mutate(["add", kind], { place });
	if (!written(added)) return;
	const label = added.json?.label;
	if (!label) {
		say_problem(place, `Added ${added.json?.key ?? kind}, but the CLI named no label to set ${name} to`);
		return;
	}
	if (!written(await mutate(["update", from, name, ...words_for(label)], { place })) || state.selected !== from) return;
	const node = Array.isArray(added.json.path) ? find_merged(`/${added.json.path.join("/")}`) : undefined;
	await select(node === undefined ? label : path_of(node), { back: from });
	await fill_fixed();
}

/** A dt-validate message without what the GUI shows beside it: the file, the node, the schema. */
function message_html(message) {
	const lines = String(message).replace(/^\S+\.dtb: /, "").replace(/^[^\s:]+ \([^)]*\): /, "").split("\n");
	const schema = lines.find(line => /from schema \$id:/.test(line));
	const text = lines.filter(line => line !== schema).map(line => line.trim()).filter(Boolean);
	return `${esc(text.join("\n"))}${schema ? `<div class="lx-schema">${esc(schema.trim().replace(/^from schema \$id: http:\/\/devicetree.org\/schemas\//, "binding: "))}</div>` : ""}`;
}

/** Where each finding is, worked out once per merged tree (`finding_place`). */
const located = { merged: undefined, paths: new WeakMap() };

/**
 * Where a finding of validate is: `{ node, property }`. Its path is walked down the merged tree:
 * `node` is the deepest node it reaches, `property` the segment after it (the property it is
 * about, undefined for one about the node as a whole). `node` is undefined when its first
 * segment names no node there: a finding of a fragment whose target the base doesn't have
 * (node<N>), which only the side column lists.
 */
function finding_place(finding) {
	if (located.merged !== state.merged) {
		located.merged = state.merged;
		located.paths = new WeakMap();
	}
	if (!located.paths.has(finding)) {
		let node = state.merged;
		let at = "/";
		let depth = 0;
		for (const key of finding.path ?? []) {
			const child = node ? children_of(node, at).find(item => item.key === key) : undefined;
			if (child === undefined) break;
			node = child;
			at = child_path(at, key);
			depth++;
		}
		located.paths.set(finding, at === "/" ? {} : { node: at, property: finding.path[depth] });
	}
	return located.paths.get(finding);
}
/** The node of the merged tree a finding is about (finding_place). */
const finding_node = finding => finding_place(finding).node;

/**
 * A finding's message as it reads under the property it is about: without the file, the node, the
 * property and the schema, which the row says (adc@0:clock-names:0: 'mclk' was expected: 'mclk' was expected).
 */
function property_message(message, property) {
	const text = String(message).split("\n").map(line => line.trim()).filter(line => line !== "" && !/^from schema \$id:/.test(line)).join("\n").replace(/^\S+\.dtb: /, "");
	const at = text.indexOf(`${property}:`);
	return at === -1 ? text.replace(/^[^\s:]+ \([^)]*\): /, "") : text.slice(at + property.length + 1).replace(/^(\d+:)*\s*/, "");
}
/** The errors and the warnings of the node at `path` of the merged tree, not those of the nodes below it. */
const errors_at = path => state.errors.filter(error => finding_node(error) === path);
const warnings_at = path => state.warnings.filter(warning => finding_node(warning) === path);

// --- rendering ----------------------------------------------------------------------------

/**
 * What a field of the node's card holds: its editor's cells (a tuple's, reg's), or its own value,
 * by the property (or the id) it is for.
 */
function field_values(field) {
	const owner = field.closest("[data-prop]") ?? field;
	const cells = owner.matches(".lx-cells") ? [...owner.querySelectorAll(".lx-cell")].map(cell => cell.value) : [field.value];
	return { node: state.selected, prop: owner.dataset.prop ?? field.id, cells };
}
const same_values = (one, other) => one !== null && other !== null && one.node === other.node && one.prop === other.prop
	&& one.cells.length === other.cells.length && one.cells.every((cell, at) => cell === other.cells[at]);

/** What the last change event handed to on_change held (field_values): sent, or not to be sent. */
let handed = null;
/** A redraw is replacing the fields: a field it removes loses the focus, which isn't the user leaving it. */
let redrawing = false;

/**
 * Draw `box` again (`draw`) without losing what is being typed in it: the field with the focus,
 * its text and cursor, and the other cells of its editor, which aren't sent until all are filled.
 */
function keep_typing(box, draw) {
	const redraw = () => {
		redrawing = true;
		try { draw(); } finally { redrawing = false; }
	};
	const active = document.activeElement;
	if (active === null || !box.contains(active) || !active.matches("input, select")) {
		redraw();
		return;
	}
	const editor = active.closest("[data-prop]");
	const cells = editor === null ? [] : [...editor.querySelectorAll(".lx-cell")];
	const kept = {
		id: active.id, prop: editor?.dataset.prop ?? active.dataset.prop, index: cells.indexOf(active), value: active.value,
		cells: cells.map(cell => cell.value), start: active.selectionStart, end: active.selectionEnd, typed: field_values(active),
	};
	redraw();
	const again = kept.id ? box.querySelector(`#${CSS.escape(kept.id)}`) : null;
	const owner = kept.prop === undefined ? null : box.querySelector(`[data-prop="${CSS.escape(kept.prop)}"]:is(input, select, .lx-cells)`);
	const fresh = owner === null ? [] : [...owner.querySelectorAll(".lx-cell")];
	const field = again ?? (kept.index >= 0 ? fresh[kept.index] : owner?.matches("input, select") ? owner : null);
	if (field === null || field === undefined) return;
	// Typed but not sent yet: what is drawn differs, and it isn't what the last change handed on
	// (that one is on its way, or was refused: drawn the old value until the reads come back). The
	// browser sees a value put back as no edit of the user's, so leaving the field would send
	// nothing; it is sent then, unless the browser did.
	const same_cells = fresh.length === kept.cells.length;
	const differs = field.value !== kept.value || (same_cells && fresh.some((cell, at) => cell.value !== kept.cells[at]));
	const unsent = differs && !same_values(kept.typed, handed);
	if (same_cells) fresh.forEach((cell, at) => { cell.value = kept.cells[at]; });
	field.value = kept.value;
	field.focus();
	if (unsent) {
		let sent = false;
		field.addEventListener("change", () => { sent = true; }, { once: true });
		// A redraw taking the field away carries the text to the next one instead.
		field.addEventListener("blur", () => { if (!sent && !redrawing) field.dispatchEvent(new Event("change", { bubbles: true })); }, { once: true });
	}
	if (field.setSelectionRange && kept.start !== null && field.type !== "checkbox") { try { field.setSelectionRange(kept.start, kept.end); } catch {} }
}

/**
 * The values of the node's fields whose update the CLI refused, put back after a redraw (it
 * draws what is saved), marked, for the user to correct: by node and property, until one goes
 * through or another node is opened. Why is said under the field (problem_slot).
 */
function show_refused(box) {
	for (const typed of state.refused.values()) {
		if (typed.node !== state.selected) continue;
		const owner = box.querySelector(`.lx-noos-card [data-prop="${CSS.escape(typed.prop)}"]:is(input, select, .lx-cells)`);
		if (owner === null) continue;
		const cells = owner.matches(".lx-cells") ? [...owner.querySelectorAll(".lx-cell")] : [owner];
		if (cells.length !== typed.cells.length) continue;
		cells.forEach((cell, at) => { cell.value = typed.cells[at]; });
		owner.classList.add("refused");
	}
}

// --- what went wrong, in place ----------------------------------------------------------------

/**
 * Where a refusal or a complaint is said (state.problem's `place`), in red (a warning in its
 * colour), until the next edit: "card" by the node's actions (Enabled, Delete), "pick" in Add
 * Property by Add, "custom" by Add Property of a custom
 * one, "child" by Add Channel, and `prop:<name>` under that property's field. Each view draws
 * its slots, empty and hidden but for the one with the problem, so say_problem fills it in
 * place, and a redraw draws it again.
 */
function problem_slot(place) {
	const problem = state.problem?.place === place ? state.problem : undefined;
	return `<div class="lx-problem${problem?.kind === "warn" ? " warn" : ""}" data-problem="${esc(place)}" role="alert"${problem ? "" : " hidden"}>${esc(problem?.text ?? "")}</div>`;
}

/** The place of a property's problem: under its field. */
const property_place = name => `prop:${name}`;

/** Say `text` at `place` (problem_slot): the one problem shown, the others cleared. */
function say_problem(place, text, kind = "error") {
	state.problem = { place, text, kind };
	for (const slot of main.querySelectorAll("[data-problem]")) {
		const here = slot.dataset.problem === place;
		slot.hidden = !here;
		slot.textContent = here ? text : "";
		slot.classList.toggle("warn", here && kind === "warn");
	}
}

/** The next edit: the problem said goes (the field keeps what was typed). */
function clear_problem() {
	state.held = null;
	if (state.problem === null) return;
	state.problem = null;
	for (const slot of main.querySelectorAll("[data-problem]")) {
		slot.hidden = true;
		slot.textContent = "";
	}
}

/** A problem, and the fields held with it, gone: another node, the editor opened or closed. */
function drop_problem() {
	state.problem = null;
	state.held = null;
}

/**
 * The fields `selector` finds (an editor's) as they are, and the function that keeps them so
 * after a refused change: every redraw (the change's, dt-validate's after it) draws what is
 * saved, and puts back what was typed (put_back_held), until the next edit, for the user to
 * correct it.
 */
function hold_fields(selector) {
	const values = [...main.querySelectorAll(selector)].map(field => [field.id || field.dataset.prop || "", field.value]);
	return () => {
		state.held = { selector, values };
		put_back_held();
		sync_fields(main);
	};
}

function put_back_held() {
	if (!state.held) return;
	const fields = [...main.querySelectorAll(state.held.selector)];
	if (fields.length !== state.held.values.length) return;
	for (const [at, field] of fields.entries()) {
		const [id, value] = state.held.values[at];
		if ((field.id || field.dataset.prop || "") === id) field.value = value;
	}
}

function render() {
	// Another project's part took the page: a read still under way draws nothing.
	if (!main?.isConnected) return;
	// The overlay gone (deleted, or the workfile setting changed): the setup's last step makes one.
	if (!state.workfile) {
		if (!main.hidden) void host.open_setup();
		return;
	}
	const base = String(state.settings.devicetree ?? "").split("/").pop()?.replace(/\.dts$/, "");
	let status = { text: "Validating…", kind: "busy" };
	if (state.validating) status = { text: state.busy ? "Updating…" : "Validating…", kind: "busy" };
	else if (state.validated && state.errors.length > 0) status = { text: `${state.errors.length} error${state.errors.length === 1 ? "" : "s"}`, kind: "err" };
	else if (state.validated) status = { text: state.warnings.length > 0 ? `Valid · ${state.warnings.length} warning${state.warnings.length === 1 ? "" : "s"}` : "Valid", kind: "ok" };
	host.set_chips(base ? `⌂ ${base}` : "no base devicetree", status, { title: "Change the base devicetree", run: () => change_setting("devicetree") });
	main.classList.toggle("side-folded", state.side_folded);
	draw_side();
	chat_changed();
	draw_build_button();
	render_overlay();
}

/**
 * ＋ Add Device, on the tree's title row: the Add Device panel, with the node picked in the tree
 * as the bus or parent when the device can go on it. Its own function so it can move.
 */
const add_device_button = () => `<button class="secondary lx-add-device" data-act="open-add" title="Add a device to the overlay: on the bus or the node picked in the tree, when it can go there">＋ Add Device</button>`;

function render_overlay() {
	const list = $("lx-list");
	// Redrawn, the tree and the node stay where they were scrolled to.
	const tree_scroll = list.querySelector(".items")?.scrollTop ?? 0;
	const content_scroll = $("lx-content").scrollTop;
	// (shownNode, not node: data-node is what a click opens.)
	const same_node = $("lx-content").dataset.shownNode === String(state.selected);
	queueMicrotask(() => {
		const items = list.querySelector(".items");
		if (items) items.scrollTop = tree_scroll;
		if (same_node) $("lx-content").scrollTop = content_scroll;
		$("lx-content").dataset.shownNode = String(state.selected);
	});
	state.shown_open = new Set();
	const was = document.activeElement;
	const typing = was?.id === "lx-tree-filter" ? [was.selectionStart, was.selectionEnd] : undefined;
	const rows = merged_rows(state.merged, "/", 0).html;
	list.innerHTML = `<div class="tools lx-tools">
		<div class="form-row" style="width:100%"><input id="lx-tree-filter" placeholder="Find a node or label…" value="${esc(state.tree_filter)}" spellcheck="false" style="flex:1">
		<label class="subtle form-row" style="font:var(--type-body-xs);gap:4px" title="Only the nodes the overlay adds or changes, the way to them, and what else is on the buses it adds devices to"><input type="checkbox" id="lx-focused"${state.focused ? " checked" : ""}> Focused View</label></div></div>
		<div class="lx-section-title lx-tree-title"><span>Device tree</span>${add_device_button()}</div>
		<div class="items lx-tree lx-merged">${rows || `<div class="empty">${state.tree_filter.trim() === "" && state.focused ? "No change yet: add a device, or untick <b>Focused View</b> to see the whole base." : "Nothing matches."}</div>`}</div>`;
	const filter = $("lx-tree-filter");
	// Drawn again while typed in (the index in, a read after a change), the box keeps the focus and the caret.
	if (typing !== undefined) {
		filter.focus();
		filter.setSelectionRange(...typing);
	}
	filter.oninput = () => {
		state.tree_filter = filter.value;
		if (filter_word() !== "") load_node_index();
		render_overlay();
	};
	$("lx-focused").onchange = event => {
		state.focused = event.target.checked;
		try { localStorage.setItem("aa-linux-only-changed", state.focused ? "1" : "0"); } catch {}
		render_overlay();
	};
	// Add Property's list stays where it was scrolled to: picking one of its rows is a redraw.
	const pick_scroll = $("lx-content").querySelector(".lx-pick-rows")?.scrollTop ?? 0;
	keep_typing($("lx-content"), () => {
		$("lx-content").innerHTML = state.selected === null ? overview() : node_card();
		show_refused($("lx-content"));
		put_back_held();
	});
	// After what keep_typing and the refused put back: the ghosts and the links to labels as the fields hold now.
	sync_fields($("lx-content"));
	const pick_rows = $("lx-content").querySelector(".lx-pick-rows");
	if (pick_rows !== null) pick_rows.scrollTop = pick_scroll;
}

/** A node's status: the read's own field, or its status property; undefined when it has none. */
const status_of = node => node?.status ?? node?.properties?.find(property => property.key === "status")?.value;
/** Off: a status other than okay (a node without one is on, as the devicetree has it). */
const is_off = node => { const status = status_of(node); return status !== undefined && status !== "okay" && status !== "ok"; };
const off_tag = node => is_off(node) ? `<span class="lx-off" title="status = &quot;${esc(status_of(node))}&quot;">off</span>` : "";

// --- the merged tree ------------------------------------------------------------------------

/** What the overlay does to a node of the merged tree: adds it, changes it, or nothing. */
function change_kind(node) {
	// A node of the search's index (index_node) says it, as list node finds it the same way.
	if (node?.change !== undefined) return node.change;
	const sources = new Set((node?.properties ?? []).map(property => property.source));
	// A node of the overlay's own (origin internal) is added, even with no property left (reg removed).
	if (!sources.has("base") && (sources.has("overlay") || node?.origin === "internal")) return "added";
	if (sources.has("overlay")) return "changed";
	return "none";
}

const child_path = (path, key) => path === "/" ? `/${key}` : `${path}/${key}`;
/**
 * A node's children: in the merged tree where the overlay reaches it, else as read when opened; a
 * bus the overlay adds devices to has its base's others first (bus_base).
 */
const children_of = (node, path) => {
	const own = (node.children?.length ?? 0) > 0 ? node.children : state.loaded.get(path) ?? [];
	const base = state.bus_base.get(path);
	if (base === undefined) return own;
	const keys = new Set(own.map(child => child.key));
	return [...base.filter(child => !keys.has(child.key)), ...own];
};
/** Whether the node has children still to read: a base node not opened yet that read says has some (a leaf gets no ▸). */
const unread = (node, path) => (node.children?.length ?? 0) === 0 && node.origin !== "internal" && node.has_children !== false && !state.loaded.has(path);

// --- the search's index ---------------------------------------------------------------------

let index_reading;      // the list node run under way, if any
let index_generation = 0; // bumped when the index is dropped: a run started before it is of another tree
let index_search;       // the last search: { index, word, matched, ways }

/** A node of the index as the tree draws one: a base node not read yet, its children read when it is opened. */
const index_node = entry => ({ kind: "node", key: entry.key, alias: entry.labels, origin: entry.origin, change: entry.change, has_children: entry.has_children, children: [], properties: [], ...(entry.status === undefined ? {} : { status: entry.status }) });

/**
 * The search's index, read once (list node --json, quiet as the other reads) the first time the
 * filter has a word, or again when it is stale; the tree is drawn again once it is in. A run
 * that fails leaves the search to what has been read (failed), until the tree is read again.
 */
function load_node_index() {
	if ((state.node_index !== null && !state.node_index.stale) || index_reading !== undefined) return;
	const generation = index_generation;
	index_reading = cli(["list", "node", "--json"], { quiet: true }).then(result => {
		if (generation !== index_generation) return;
		index_reading = undefined;
		const entries = Array.isArray(result.json?.nodes) ? result.json.nodes : undefined;
		const children = new Map();
		const by_path = new Map();
		for (const entry of entries ?? []) {
			const node = index_node(entry);
			by_path.set(entry.path, node);
			if (entry.path === "/") continue;
			const parent = entry.path.slice(0, entry.path.lastIndexOf("/")) || "/";
			if (!children.has(parent)) children.set(parent, []);
			children.get(parent).push({ path: entry.path, node, compatible: entry.compatible });
		}
		state.node_index = { by_path, children, stale: false, failed: entries === undefined };
		if (main?.isConnected && state.tree_filter.trim() !== "") render_overlay();
	});
}

/**
 * The index is of a tree read before: `keep`, it is still searched (the base is the same, the
 * overlay changed) until the new one is in; else it goes. Read again at once when a search is on.
 */
function drop_node_index({ keep = false } = {}) {
	index_generation += 1;
	index_reading = undefined;
	state.node_index = keep && state.node_index !== null && !state.node_index.failed ? { ...state.node_index, stale: true } : null;
	if (state.tree_filter.trim() !== "") load_node_index();
}

/** The filter as matched: lower case, a leading & dropped (as list node takes it). */
const filter_word = () => state.tree_filter.trim().toLowerCase().replace(/^&/, "");

/**
 * The search in the index: the paths of the nodes whose name, label or compatible has the
 * filter's word (`matched`), and those and every node above them (`ways`); undefined without a
 * word or an index (the search is then of what has been read). Worked out once per word and index.
 */
function tree_search() {
	const word = filter_word();
	const index = state.node_index;
	if (word === "" || index === null || index.failed) return undefined;
	if (index_search?.index === index && index_search.word === word) return index_search;
	const matched = new Set();
	const ways = new Set();
	for (const entries of index.children.values()) {
		for (const { path, node, compatible } of entries) {
			if (![node.key, ...node.alias, ...compatible].some(text => text.toLowerCase().includes(word))) continue;
			matched.add(path);
			for (let at = path; at !== "/" && !ways.has(at); at = at.slice(0, at.lastIndexOf("/")) || "/") ways.add(at);
		}
	}
	index_search = { index, word, matched, ways };
	return index_search;
}

/**
 * The children a search goes through: those read (children_of), else, for a base node not read
 * yet, the index's: those on the way to a match, or all of them when it was opened by hand.
 */
function search_children(node, path, search, opened) {
	const own = children_of(node, path);
	if (search === undefined || own.length > 0 || !unread(node, path)) return own;
	return (state.node_index.children.get(path) ?? []).filter(entry => opened || search.ways.has(entry.path)).map(entry => entry.node);
}

/**
 * The rows of a node and its children: `{ html, changed, matched }`. A node with changes below
 * it is open unless closed by hand; with a filter, the nodes that match and the way to them.
 * Focused, a node of the base on a bus the overlay adds devices to is shown, changed or not.
 */
function merged_rows(node, path, depth, shown_anyway = false) {
	const kind = change_kind(node);
	const filter = filter_word();
	// The search goes through the index, the whole merged tree; without one yet, through what has been read.
	const search = tree_search();
	const own_match = filter !== "" && (search !== undefined
		? search.matched.has(path)
		: node.key.toLowerCase().includes(filter) || (node.alias ?? []).some(alias => alias.toLowerCase().includes(filter)));
	// A node opened by hand shows its children, whatever the filter.
	const opened = filter !== "" && state.open.has(path);
	const below = (filter === "" ? children_of(node, path) : search_children(node, path, search, opened))
		.map(child => merged_rows(child, child_path(path, child.key), depth + 1, opened));
	const changes_below = below.some(row => row.changed);
	const changed = kind !== "none" || changes_below;
	const matched = own_match || below.some(row => row.matched);
	if (filter !== "" && !matched && !shown_anyway) return { html: "", changed, matched };
	const on_bus = state.bus_base.get(path.slice(0, path.lastIndexOf("/")))?.some(child => child.key === node.key) ?? false;
	if (state.focused && !changed && !on_bus && filter === "") return { html: "", changed, matched };
	const has_children = below.length > 0 || unread(node, path);
	const open = depth === 0 || (!state.closed.has(path) && (state.open.has(path) || (filter !== "" && below.some(row => row.matched)) || (filter === "" && changes_below)));
	if (open) state.shown_open.add(path);
	const errors = kind === "none" ? 0 : errors_at(path).length;
	const label = label_of(node);
	const active = state.selected === path || (label !== undefined && state.selected === label);
	const row = depth === 0 ? "" : `<div class="item lx-m ${kind}${changes_below && kind === "none" ? " leads" : ""}${active ? " active" : ""}${own_match ? " match" : ""}${is_off(node) ? " off" : ""}" data-tree-node="${esc(path)}" style="padding-left:${4 + (depth - 1) * 16}px">
		<button class="lx-twist" ${has_children ? `data-toggle="${esc(path)}"` : "disabled"}>${has_children ? (open ? "▾" : "▸") : ""}</button>
		<span class="name"><span class="lx-node-name">${esc(node.key)}</span>${label ? ` <span class="lx-amp">&amp;${esc(label)}</span>` : ""}</span>
		${kind === "added" ? `<span class="lx-tag new">new</span>` : kind === "changed" ? `<span class="lx-tag changed">changed</span>` : ""}
		${off_tag(node)}
		${errors > 0 ? `<span class="badge">${errors}</span>` : ""}
	</div>`;
	return { html: row + (open ? below.map(child => child.html).join("") : ""), changed, matched };
}

/** Open or close a node of the merged tree; a base node's children are read the first time. */
async function toggle(path) {
	if (state.shown_open.has(path)) {
		state.open.delete(path);
		state.closed.add(path);
	} else {
		state.closed.delete(path);
		state.open.add(path);
		// A node only the search's index has (below what has been read) is read the same way.
		const node = find_merged(path) ?? state.node_index?.by_path.get(path);
		if (node !== undefined && unread(node, path)) {
			const read = await cli(["read", path, "--json"], { quiet: true });
			state.loaded.set(path, read.json?.children ?? []);
			if (!main?.isConnected) return;
		}
	}
	render_overlay();
}

/**
 * Where the node open is in the merged tree: its path. A label-first one (ad5592r/channel@0) has
 * its first segment found there, by a label, else as a device the overlay adds by its name, and
 * the rest after it: a name and a label alone can be another node's (each device's channel@0).
 */
function path_in_merged() {
	const selected = state.selected;
	if (selected === null || selected.startsWith("/")) return selected ?? undefined;
	const [first, ...rest] = selected.split("/");
	const look = (at, path, matches) => {
		for (const child of at?.children ?? []) {
			const child_at = child_path(path, child.key);
			if (matches(child)) return child_at;
			const found = look(child, child_at, matches);
			if (found !== undefined) return found;
		}
		return undefined;
	};
	const top = look(state.merged, "/", node => (node.alias ?? []).includes(first))
		?? look(state.merged, "/", node => node.key === first && added_by_overlay(node));
	return top === undefined ? undefined : rest.reduce(child_path, top);
}

/** A node of the merged tree by its path, through what has been read of it. */
function find_merged(path) {
	let node = state.merged;
	let at = "/";
	for (const key of path.split("/").filter(Boolean)) {
		node = node === undefined ? undefined : children_of(node, at).find(child => child.key === key);
		at = child_path(at, key);
	}
	return node;
}

// The right column's width: dragged from its left edge, kept for the next time; dragged very
// narrow, it folds to its ribbon.
const SIDE_WIDTH = "aa-linux-side-width";
const stored_side_width = () => { try { return Number(localStorage.getItem(SIDE_WIDTH)) || undefined; } catch { return undefined; } };
function side_width(width) {
	if (width === undefined) main.style.removeProperty("--side-w");
	else main.style.setProperty("--side-w", `${Math.round(width)}px`);
}
function start_side_resize(event) {
	if (!event.target.closest("[data-side-resize]")) return;
	event.preventDefault();
	// The second press of a double click: back to the default width.
	if (event.detail >= 2) {
		try { localStorage.removeItem(SIDE_WIDTH); } catch {}
		side_width(undefined);
		return;
	}
	const right = main.getBoundingClientRect().right;
	const widest = Math.max(320, Math.round(main.getBoundingClientRect().width * 0.55));
	let width = $("lx-side").getBoundingClientRect().width;
	document.body.classList.add("resizing-side");
	const move = moved => {
		moved_at_all = true;
		width = right - moved.clientX;
		side_width(Math.max(240, Math.min(widest, width)));
	};
	let moved_at_all = false;
	const up = () => {
		document.removeEventListener("mousemove", move);
		document.removeEventListener("mouseup", up);
		document.body.classList.remove("resizing-side");
		// A click without a drag changes nothing (the first press of a double click).
		if (!moved_at_all) return;
		if (width < 200) {
			// Pulled almost shut: folded, its width as it was.
			side_width(stored_side_width());
			state.side_folded = true;
			try { localStorage.setItem("aa-linux-side", "folded"); } catch {}
			render();
			return;
		}
		try { localStorage.setItem(SIDE_WIDTH, String(Math.round(Math.max(240, Math.min(widest, width))))); } catch {}
	};
	document.addEventListener("mousemove", move);
	document.addEventListener("mouseup", up);
}

/** The right column showing `tab` (overlay | binding | chat), kept for the next time. */
function set_side_tab(tab) {
	state.side_tab = tab;
	try { localStorage.setItem("aa-linux-side-tab", tab); } catch {}
	render();
}

/** The right column: folded to its ribbon, or its tabs, then the overlay and its validation, the binding, or the chat. */
function draw_side() {
	const shown = side_shown();
	const chatting = !state.side_folded && shown === "chat";
	const source = $("lx-side-pane").querySelector(".lx-side-source");
	const kept = source === null ? undefined : { top: source.scrollTop, for: source.dataset.for, found: source.dataset.found === "1" };
	$("lx-side").classList.toggle("chatting", chatting);
	$("lx-side-pane").innerHTML = state.side_folded ? side_ribbon() : `${side_tabs()}${chatting ? "" : `<div class="lx-side-body">${shown === "binding" ? binding_view() : side_view()}</div>`}`;
	$("lx-chat-dock").hidden = !chatting;
	const drawn = $("lx-side-pane").querySelector(".lx-side-source");
	if (drawn === null) return;
	scroll_source(drawn, kept);
	if (!(state.full !== null && state.side_source === "full")) flash_source(drawn);
}

/**
 * The source in the right column, drawn again: where it was scrolled to, but brought to the node
 * open the first time the source has it (the node opened, or added to the overlay since), unless
 * it is in view already. `kept`: the source as it was before the redraw.
 */
function scroll_source(box, kept) {
	const full = state.full !== null && state.side_source === "full";
	const path = path_in_merged();
	box.dataset.for = `${full ? "full" : "overlay"}\n${path ?? ""}`;
	box.scrollTop = kept?.top ?? 0;
	if (kept?.for === box.dataset.for && kept.found) {
		box.dataset.found = "1";
		return;
	}
	const at = path === undefined ? undefined : node_lines(full ? state.full.text : state.text, path, find_label);
	if (at === undefined || box.children[at.start] === undefined) return;
	box.dataset.found = "1";
	bring_into_view(box, at.start, at.end);
}

/**
 * Lines `start` to `end` of a source box in view: left as they are if they are, else the first at
 * the top, under the line before it (the node it is in).
 */
function bring_into_view(box, start, end) {
	const lines = box.children;
	const view = box.getBoundingClientRect();
	const first = lines[start].getBoundingClientRect();
	const last = (lines[end] ?? lines[start]).getBoundingClientRect();
	if (first.top >= view.top && last.bottom <= view.bottom) return;
	box.scrollTop += lines[Math.max(0, start - 1)].getBoundingClientRect().top - view.top - Number.parseFloat(getComputedStyle(box).paddingTop);
}

/** How long the lines a change wrote stay lit (the lx-flash animation's length). */
const FLASH_MS = 1600;

/**
 * The lines the last change wrote to the overlay (state.flash), lit and fading, and brought into
 * view the first time they are drawn. A redraw meanwhile goes on with the fade where it was.
 */
function flash_source(box) {
	const flash = state.flash;
	const elapsed = flash === null ? FLASH_MS : performance.now() - flash.at;
	if (flash === null || elapsed >= FLASH_MS) return;
	const lines = flash.lines.filter(at => box.children[at] !== undefined);
	for (const at of lines) {
		box.children[at].classList.add("lx-flash");
		box.children[at].style.animationDelay = `-${Math.round(elapsed)}ms`;
	}
	if (flash.scrolled || lines.length === 0) return;
	flash.scrolled = true;
	bring_into_view(box, lines[0], lines.at(-1));
}

/** The tab the right column shows: the one picked, but the overlay's in the Binding tab's place while it has nothing to show. */
function side_shown() {
	return state.side_tab === "binding" && side_binding().why !== undefined ? "overlay" : state.side_tab;
}

/** What dt-validate said, as a mark: a spinner while it reads, the errors or warnings counted, or ✓. */
function validation_mark() {
	const errors = state.validated ? state.errors.length : 0;
	const warnings = state.validated ? state.warnings.length : 0;
	return state.validating ? `<span class="spinner" title="Validating"></span>` : errors > 0 ? `<span class="badge" title="${errors} error${errors === 1 ? "" : "s"}">${errors}</span>` : warnings > 0 ? `<span class="badge warn" title="${warnings} warning${warnings === 1 ? "" : "s"}">${warnings}</span>` : state.validated ? `<span class="lx-ribbon-ok" title="Valid">✓</span>` : "";
}

/** The right column folded: a ribbon on the edge, its name sideways, the errors counted on it. */
function side_ribbon() {
	const shown = side_shown();
	const [title, text] = { chat: ["Show the chat with the assistant", "✦ Assistant"], binding: ["Show the binding of the node open", "Binding"] }[shown] ?? ["Show the overlay and its validation", "Overlay · Validation"];
	return `<button class="lx-ribbon" data-act="side-toggle" title="${title}">
		<span class="lx-ribbon-arrow">«</span>
		<span class="lx-ribbon-text">${text}</span>
		${state.workfile ? validation_mark() : ""}
	</button>`;
}

/** The right column's tabs: the overlay and its validation, the binding of the node open, or the chat with the assistant; and its fold. */
function side_tabs() {
	const shown = side_shown();
	const tab = (id, label, title, disabled = false) => `<button class="lx-side-tab${shown === id ? " active" : ""}" role="tab" aria-selected="${shown === id}" data-act="side-tab" data-tab="${id}" title="${esc(title)}"${disabled ? " disabled" : ""}>${label}</button>`;
	// Greyed while there is nothing to show: why, in its tooltip.
	const binding = side_binding();
	const about_binding = binding.why ?? (binding.path === undefined ? `Reading the binding of ${binding.compatible}…` : `${file_name(binding.path)}: the binding of ${binding.compatible}`);
	return `<div class="lx-side-tabs" role="tablist">
		${tab("overlay", `Overlay · Validation${state.workfile ? validation_mark() : ""}`, state.workfile ? "The overlay as saved, and what dt-validate says of it" : "No overlay yet: create or import one first", !state.workfile)}
		${tab("binding", "Binding", about_binding, binding.why !== undefined)}
		${tab("chat", "✦ Assistant", "Ask the assistant to change the project")}
		<div class="spacer"></div>
		<button class="ghost lx-fold" data-act="side-toggle" title="Fold this column to the right">»</button>
	</div>`;
}

/**
 * The right column: the overlay as saved, or (Overlay | Full .dts, offered while the last build's
 * full devicetree is there: state.full) that devicetree, each with Copy and Open With; then what
 * dt-validate says of the overlay.
 */
function side_view() {
	// A finding opens its node, where the overlay has one for it.
	const item = (entry, kind) => {
		const at = finding_node(entry);
		const open = at === undefined ? "" : ` data-node="${esc(at)}" title="Open ${esc(at)}"`;
		return `<div class="lx-finding ${kind}${at === undefined ? "" : " opens"}"${open}><div class="mono lx-finding-path">${esc((entry.path ?? []).join("/"))}</div>${message_html(entry.message)}</div>`;
	};
	const full = state.full !== null && state.side_source === "full";
	const shown = full ? state.full.path : project_path(String(state.settings.workfile ?? ""));
	const name = String(shown ?? "").split("/").pop();
	const toggle = state.full === null ? "" : `<div class="lx-seg" role="group" title="What this tab shows">
		<button data-act="side-source" data-source="overlay" class="${full ? "" : "on"}" title="The overlay, as saved">Overlay</button>
		<button data-act="side-source" data-source="full" class="${full ? "on" : ""}" title="The full devicetree the last build wrote: the base with the overlay applied">Full .dts</button></div>`;
	return `<div class="lx-side-section">
			<div class="lx-section-title"><span class="lx-side-name" title="${esc(shown ?? "")}">${state.full === null ? `Overlay · ${esc(name)}` : esc(name)}</span><span class="lx-side-tools">${toggle}<button class="ghost" data-act="copy-source" title="${full ? "Copy the full devicetree" : "Copy the overlay"}">Copy</button>${shown ? open_with_button(shown) : ""}</span></div>
			${full && state.full.stale ? `<p class="lx-older">Older than the overlay: build again to see its latest changes.</p>` : ""}
			${full ? source_box(state.full.text, "lx-side-source") : source_box(state.text, "lx-side-source", { references: true })}
		</div>
		<div class="lx-side-section">
			<div class="lx-section-title"><span>Validation</span>${state.validating || !state.validated ? `<span class="lx-spinning"><span class="spinner"></span>validating…</span>` : ""}</div>
			<div class="${state.validating ? "lx-stale" : ""}" title="${state.validating ? "From before the last change: dt-validate is reading the overlay again" : ""}">
			${!state.validated ? "" : state.errors.length + state.warnings.length === 0 ? `<span class="chip ok">No errors or warnings</span>`
				: `${state.errors.map(error => item(error, "error")).join("")}${state.warnings.map(warning => item(warning, "warning")).join("")}`}
			</div>
		</div>`;
}

// --- the Binding tab: the binding file of the node open ----------------------------------------

const file_name = path => String(path).split("/").pop();

/**
 * The compatible whose binding the Binding tab shows: the node open's first, or for a node with
 * none (a channel) that of the nearest node above it that has one, short of the root.
 */
function binding_compatible() {
	if (state.selected === null || state.node === null) return;
	const own = first_compatible(state.node);
	if (own !== undefined) return own;
	const parts = state.selected.split("/");
	for (let end = parts.length - 1; end > 0; end--) {
		const up = parts.slice(0, end).join("/");
		if (up === "") break;
		const compatible = first_compatible(up.startsWith("/") ? find_merged(up) : find_node(up));
		if (compatible !== undefined) return compatible;
	}
}

/**
 * What the Binding tab has to show: `{ compatible, path, file }` (`file` the server's read of it,
 * undefined while it is read), or `{ why }` when there is nothing (no node open, no binding). The
 * binding is read (load_binding) the first time it is asked for.
 */
function side_binding() {
	const compatible = binding_compatible();
	if (compatible === undefined) return { why: state.selected === null ? "Open a node to see its binding" : "This node has no compatible, nor a device above it: no binding to show" };
	const about = state.about.get(compatible);
	if (about === undefined) {
		load_binding(compatible);
		return { compatible };
	}
	if (!about.binding) return { compatible, why: about.missing ?? `No binding found for ${compatible}` };
	const file = state.binding_files.get(about.binding);
	if (file === undefined) load_binding(compatible);
	return { compatible, path: about.binding, file };
}

/** The binding of `compatible` and its file, read once each (state.about, state.binding_files); the right column drawn again then. */
const binding_reads = new Map();
function load_binding(compatible) {
	if (!binding_reads.has(compatible)) {
		binding_reads.set(compatible, (async () => {
			await load_about(compatible);
			const path = state.about.get(compatible)?.binding;
			if (path && !state.binding_files.has(path)) state.binding_files.set(path, await read_file(path));
		})().finally(() => {
			binding_reads.delete(compatible);
			if (main?.isConnected && state.workfile) draw_side();
		}));
	}
	return binding_reads.get(compatible);
}

/** A text file, as the server reads it for the page (/api/file): `{ text }`, or why it has none. */
async function read_file(path) {
	try {
		const response = await api(`/api/file?path=${encodeURIComponent(path)}`);
		return await response.json();
	} catch (error) {
		return { error: `Can't read ${path}: ${error.message}` };
	}
}

/** The Binding tab: the binding's file name, Copy and Open With, then its YAML as the file has it. */
function binding_view() {
	const binding = side_binding();
	if (binding.file === undefined) return `<p class="subtle">Reading the binding of ${esc(binding.compatible ?? "the node")}…</p>`;
	return `<div class="lx-side-section lx-binding">${binding_html(binding.path, binding.file)}</div>`;
}

/** A binding file as the Binding tab and the Add Device panel show it: its name, Copy, Open With, its YAML (or why it isn't shown). */
function binding_html(path, file) {
	const text = typeof file?.text === "string";
	let why = file?.error ?? "The file could not be read.";
	if (file?.binary) why = "Not a text file.";
	if (file?.too_big) why = "The file is too big to show.";
	return `<div class="lx-section-title"><span class="lx-side-name lx-file-name" title="${esc(path)}">${esc(file_name(path))}</span><span class="lx-side-tools">${text ? `<button class="ghost" data-act="copy-binding" data-path="${esc(path)}" title="Copy the binding">Copy</button>` : ""}${open_with_button(path)}</span></div>
		${text ? yaml_box(file.text) : `<p class="subtle">${esc(why)}</p>`}`;
}

/**
 * A YAML file, read-only, as source_box shows a source: numbered and wrapped, each line
 * highlighted on its own (keys, strings, comments), its http(s) URLs links (linkify). A schema's
 * own ids ($id, $schema) are no links: nothing is served there.
 */
function yaml_box(text) {
	const lines = text.replace(/\n$/, "").split("\n");
	// A block's text (description: |) is text as it is, # and : included, up to the next line as
	// little indented as its key.
	let block;
	const shown = lines.map(line => {
		const indent = /^ */.exec(line)[0].length;
		if (block !== undefined && (line.trim() === "" || indent > block)) return linkify(line);
		block = /:\s*[|>][-+0-9]*\s*(#.*)?$/.test(line) && !/^\s*#/.test(line) ? indent : undefined;
		return yaml_line(line);
	});
	return `<pre class="lx-source lx-yaml" style="--ln-digits:${String(lines.length).length}">${shown.map(line => `<span class="ln">${line}</span>`).join("")}</pre>`;
}

function yaml_line(line) {
	const comment = /^(\s*)(#.*)$/.exec(line);
	if (comment !== null) return `${esc(comment[1])}<span class="c">${linkify(comment[2])}</span>`;
	const keyed = /^(\s*(?:-\s+)?)("[^"]*"|'[^']*'|[^\s#'"][^:#]*?)(:)(?=\s|$)(.*)$/.exec(line);
	if (keyed === null) {
		const item = /^(\s*-)(\s.*)?$/.exec(line);
		return item === null ? yaml_value(line) : `${esc(item[1])}${yaml_value(item[2] ?? "")}`;
	}
	const [, lead, key, colon, rest] = keyed;
	return `${esc(lead)}<span class="${key.startsWith("$") ? "k" : "l"}">${esc(key)}</span>${colon}${yaml_value(rest, ["$id", "$schema"].includes(key))}`;
}

/** What follows a key (or a line of a block): a quoted string, then a comment; its URLs links unless `plain`. */
function yaml_value(text, plain = false) {
	const show = part => plain ? esc(part) : linkify(part);
	const at = text.search(/\s#/);
	const [value, comment] = at === -1 ? [text, ""] : [text.slice(0, at), text.slice(at)];
	const quoted = /^(\s*)("[^"]*"|'[^']*')(\s*)$/.exec(value);
	const shown = quoted === null ? show(value) : `${esc(quoted[1])}<span class="s">${show(quoted[2])}</span>${esc(quoted[3])}`;
	return `${shown}${comment ? `<span class="c">${show(comment)}</span>` : ""}`;
}

/** Whether the overlay adds or changes nothing: no node of the merged tree is its. */
function overlay_empty() {
	const walk = node => change_kind(node) !== "none" || (node.children ?? []).some(child => walk(child));
	return state.merged === null || !(state.merged.children ?? []).some(child => walk(child));
}

/** The middle column with no node picked: where to look, and with an empty overlay where to start. */
function overview() {
	return `<div class="lx-placeholder">
		<p>Select a node to see its properties</p>
		${overlay_empty() ? `<p>or add a device to get started</p>` : ""}
	</div>`;
}

/** The node's interrupt-parent, as a field shows it (gpio): what its interrupts' cells are. */
const interrupt_parent = node => shown_value(node?.properties?.find(property => property.key === "interrupt-parent")?.value);

/**
 * A value as a one-line field shows it: words, a phandle without its &. Given a property's
 * `value`, its numbers are decimal (what to compare with a choice, a pinned value); given its
 * written_value, as the file writes them (what the field holds).
 */
function shown_value(value) {
	if (value === true || value === undefined || value === null) return "";
	const words = Array.isArray(value) ? value.flat(8) : [value];
	return words.map(word => typeof word === "string" ? word.replace(/^&/, "") : String(word)).join(" ");
}

/**
 * A property the binding allows one value only (list property's `pinned`: #address-cells <1>, a
 * flag it requires): set in stone, never edited. `held` when the node has it at that value,
 * `action` the button that sets it.
 */
function pin_of(binding, property) {
	const pinned = binding?.pinned;
	if (pinned === undefined) return undefined;
	const held = property !== undefined && (pinned === "" ? property.value === true : shown_value(property.value) === pinned);
	const text = pin_text(binding);
	return { held, words: pin_words(binding), text, action: pinned === "" ? "Set Flag" : `Set ${text}` };
}

/** Whether a property's values are strings, so a pinned value is one word, quoted. */
function pin_is_text(binding) {
	const type = binding.type ?? {};
	return type.kind === "string" || type.items?.kind === "string" || (type.options ?? []).some(option => typeof option.value === "string");
}

/** The pinned value as update takes it: no word for a flag, a list's entries, a string whole. */
function pin_words(binding) {
	if (binding.pinned === "") return [];
	const option = (binding.type?.options ?? []).find(item => String(item.value) === binding.pinned);
	if (option?.list !== undefined) return option.list.map(String);
	return pin_is_text(binding) ? [binding.pinned] : binding.pinned.split(/\s+/);
}

/** The pinned value as the devicetree writes it: <1>, "mclk", a flag as set. */
function pin_text(binding) {
	if (binding.pinned === "") return "(set)";
	return pin_is_text(binding) ? pin_words(binding).map(word => `"${word}"`).join(", ") : `<${binding.pinned}>`;
}

/** The node picked: what it is and does, its properties each a field, Add Property below them. */
function node_card() {
	const node = state.node;
	if (node === null) return `<div class="lx-pane-empty"><p class="subtle">Reading ${esc(state.selected)}…</p></div>`;
	const kind = change_kind(node);
	const added = kind === "added";
	const top = added && (state.root?.children ?? []).some(child => child.key === node.key && label_of(child) === label_of(node));
	const props = state.props ?? [];
	const info = name => props.find(prop => prop.name === name);
	const missing = missing_required();
	const where = path_in_merged() ?? state.selected;
	const node_errors = errors_at(where);
	const node_warnings = warnings_at(where);
	// The field editor says a finding about a property under that property's field; one about the
	// node as a whole is left to the Validation column.
	const listed = new Set([...node.properties.map(property => property.key), ...missing.map(prop => prop.name)]);
	const inline = new Map([...node_errors, ...node_warnings].map(finding => [finding, finding_place(finding).property]).filter(([, property]) => listed.has(property)));
	const fragment = top ? state.targets.find(item => item.nodes.includes(node.key)) : undefined;
	// A child the overlay adds (a channel): the way back to its device.
	const parent_path = added && !top && state.selected.includes("/", 1) ? state.selected.slice(0, state.selected.lastIndexOf("/")) : "";
	const label = label_of(node);

	const children = node.children ?? [];
	const taken = new Set(children.map(child => child.key));
	const free = (state.patterns ?? []).flatMap(pattern => free_names(pattern, taken));
	const named = children_title(state.patterns ?? []);

	return `<div class="lx-pane">
		<div class="lx-section-title"><span>Node</span></div>
		<div class="lx-node-head">
			${state.back?.at === state.selected ? `<button class="ghost lx-back" data-act="go-back" title="Open ${esc(state.back.to)} again">← back to ${esc(state.back.name)}</button>` : ""}
			<div class="lx-node-title"><h2 class="lx-node-path" title="${esc(where)}">${esc(where)}</h2>
				${compatible_of(node) ? `<button class="ghost lx-about-button${state.about_open.has(state.selected) ? " on" : ""}" title="What the binding says of the device" data-act="node-about">ⓘ</button>` : ""}</div>
			<div class="lx-tags">
				${label ? `<span class="lx-tag label">&amp;${esc(label)}</span>` : ""}
				<span class="lx-tag ${added ? "new" : kind === "changed" ? "changed" : "base"}">${added ? "added by the overlay" : kind === "changed" ? "base, changed by the overlay" : "base only"}</span>
				${compatible_of(node) ? `<span class="lx-tag">${esc(compatible_of(node))}</span>` : ""}
				${fragment ? `<span class="lx-tag">on &amp;${esc(fragment.target)}</span>` : ""}
				${state.validating && added ? `<span class="chip busy">Validating…</span>` : state.validated && added ? (node_errors.length > 0 ? `<span class="chip err">${node_errors.length} error${node_errors.length === 1 ? "" : "s"}</span>` : `<span class="chip ok">Valid</span>`) : ""}
			</div>
			${state.about_open.has(state.selected) ? about_box(first_compatible(node)) : ""}
		</div>
		<div class="lx-node-actions">
			${parent_path ? `<button class="secondary" data-node="${esc(parent_path)}" title="Open ${esc(parent_path)}">↑ ${esc(parent_path.split("/").pop())}</button>` : ""}
			${where === "/" ? "" : enable_switch(!is_off(node), `data-edit="enabled"`)}
			<div class="spacer"></div>
			${added ? `<button data-act="rename">Rename Node</button>${top ? `<button data-act="move">Move Node</button>` : ""}<button class="danger" data-act="delete-node">Delete Node</button>` : ""}
		</div>
		${problem_slot("card")}

		<div class="lx-section-title"><span>Properties</span></div>
		${noos_style_properties(node, info, name => ({
			errors: node_errors.filter(error => inline.get(error) === name), warnings: node_warnings.filter(warning => inline.get(warning) === name),
		}))}
		${state.editing !== null ? add_property_panel() : `<div class="actions-row lx-props-actions"><button data-act="new-prop">＋ Add Property</button></div>`}

		${children.length > 0 || free.length > 0 ? `<div class="lx-section-title"><span>${esc(named.title)}</span><span class="count">${children.length}</span></div>
		<div class="lx-children">${children.map(child => `<button class="lx-child" data-node="${esc(`${state.selected}/${child.key}`)}"><span class="mono">${esc(child.key)}</span><span class="subtle">${child.properties?.length ?? 0} propert${child.properties?.length === 1 ? "y" : "ies"} ›</span></button>`).join("") || `<span class="subtle">None yet.</span>`}</div>
		${free.length > 0 ? `<div class="form-row lx-add-child">
			<select id="lx-child-name" aria-label="Which one" title="The next free one, or another">${free.map(name => `<option value="${esc(name)}">${esc(name)}</option>`).join("")}</select>
			<button class="primary" data-act="add-child-named">＋ Add ${esc(named.one)}</button></div>${problem_slot("child")}` : ""}` : ""}
	</div>`;
}

/**
 * The properties that open the node's list, set or not, in the binding's order: the ones it
 * requires, and before interrupts its interrupt-parent, which the binding doesn't require but
 * interrupts takes its shape from (where it is set, or interrupts still has to be).
 */
function required_properties() {
	const props = state.props ?? [];
	const set = new Set((state.node?.properties ?? []).map(property => property.key));
	const required = props.filter(prop => prop.required && !prop.name.startsWith("^"));
	const at = required.findIndex(prop => prop.name === "interrupts");
	const parent_prop = props.find(prop => prop.name === "interrupt-parent");
	if (at !== -1 && parent_prop !== undefined && !required.includes(parent_prop) && (set.has("interrupt-parent") || !set.has("interrupts"))) required.splice(at, 0, parent_prop);
	return required;
}

/** What the node open still has to be given: those of required_properties it hasn't. */
function missing_required() {
	const set = new Set((state.node?.properties ?? []).map(property => property.key));
	return required_properties().filter(prop => !set.has(prop.name));
}

/**
 * The field of a property's value in Add Property, in the
 * shape of its type: its cells, a choice, or one line; a flag has none. A number's field has its
 * ghost; a phandle's (a label) its "go to" link under it and, a choice, the nodes that can be added for it.
 */
function value_field(name, type, property, binding) {
	const links = links_of(name, binding, property);
	if (shape_of(type) !== undefined) return cells_editor(name, type, written_value(property), { parent: interrupt_parent(state.node), links });
	if (type.kind === "bool") return `<div class="subtle">A flag: there or not.</div>`;
	if (type.kind === "enum") return choice_field(`class="lx-value${links.labels ? " lx-labels" : ""}" data-prop="${esc(name)}"`, type, property, links);
	return one_line_field(`class="lx-value${links.labels ? " lx-labels" : ""}" data-prop="${esc(name)}" data-text="${type.kind === "string" ? "1" : ""}" placeholder="${esc(type_text(binding))}"`, type, property, links);
}

/**
 * A choice's dropdown, `attributes` its own. The stored value stays among the choices, even when
 * the binding's list hasn't it (a regulator the overlay adds itself): the dropdown never shows
 * something else. A list of labels ends with the nodes that can be added for it, and has its
 * "go to" link under it (with_go).
 */
function choice_field(attributes, type, property, links) {
	const options = (type.options ?? []).map(option => String(option.value));
	// A number among the choices in another base (0x2 for 2) is that choice; one that isn't, as written.
	const read = shown_value(property?.value);
	const as_written = shown_value(written_value(property));
	const current = options.includes(read) ? read : same_number(options, as_written) ?? as_written;
	if (current !== "" && !options.includes(current)) options.unshift(current);
	const select = `<select ${attributes}><option value="" disabled${current === "" ? " selected" : ""}>— choose —</option>${options.map(option => `<option value="${esc(option)}"${option === current ? " selected" : ""}>${esc(option)}</option>`).join("")}${links.labels ? create_options(links.creatable) : ""}</select>`;
	return links.labels ? with_go(select) : select;
}

/**
 * A one-line field, `attributes` its own, holding the value as the file writes it (written_value):
 * a label's has its "go to" link under it (with_go), a number's its ghost (one number: several, none).
 */
function one_line_field(attributes, type, property, links) {
	const value = shown_value(written_value(property));
	const input = `<input ${attributes} value="${esc(value)}" spellcheck="false">`;
	if (links.labels) return with_go(input);
	return type.kind === "number" ? with_ghost(input, value) : input;
}

/** The values a property could take (list value's suggestions), each a button that fills the editor's field. */
function suggestions_list(suggestions) {
	if (suggestions.length === 0) return "";
	return `<div class="lx-editor-label subtle">Suggestions</div><div class="lx-suggestions">${suggestions.map(suggestion => `<button data-suggest="${esc(suggestion.value)}"><span class="mono">${esc(suggestion.value)}</span>${suggestion.display_string && suggestion.display_string !== suggestion.value ? `<span class="subtle">${esc(suggestion.display_string.replace(new RegExp(`^${suggestion.value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[—-]?\\s*`), ""))}</span>` : ""}</button>`).join("")}</div>`;
}

/**
 * Add Property with one picked: what the binding says of it, the field of its value in the shape
 * of its type (a flag, or a value the binding pins, has none), and Add, which writes it. The
 * values to pick from are offered where the field is one line.
 */
function pick_detail(picked) {
	const editing = state.editing;
	const binding = offered_binding(picked.name);
	const type = edit_type(picked.name, binding?.type ?? {}, undefined);
	const pinned = binding?.pinned !== undefined;
	const one_line = !pinned && shape_of(type) === undefined && type.kind !== "bool" && type.kind !== "enum";
	const field = pinned
		? `<div><span class="mono">${esc(pin_text(binding))}</span> <span class="subtle">${binding.pinned === "" ? "A flag the binding requires." : "The only value the binding allows."}</span></div>`
		: type.kind === "bool" ? "" : value_field(picked.name, type, undefined, binding);
	const kind = type_text(binding);
	return `<div class="mono lx-pick-name">${esc(picked.name)}</div>
		${kind ? `<div class="subtle mono lx-pick-type">${type_html(binding)}</div>` : ""}
		<div class="lx-pick-about">${linkify((state.said.get(picked.name) ?? "").trim())}</div>
		${field ? `<div class="lx-editor-field">${field}</div>` : ""}
		<div class="actions-row"><button class="primary" data-act="pick-add">＋ Add ${esc(picked.name)}</button></div>
		${problem_slot("pick")}
		${one_line ? `<div class="lx-pick-suggested">${suggestions_list(editing.suggestions ?? [])}</div>` : ""}`;
}

/**
 * Add Property, under the node's properties: which, among the binding's unset ones, and its
 * value, or a custom one.
 */
function add_property_panel() {
	const editing = state.editing;
	const choices = addable_properties();
	const filter = (editing.filter ?? "").trim().toLowerCase();
	const picked = choices.find(choice => choice.name === editing.pick);
	return `<div class="lx-editor" data-panel-new>
		<div class="lx-editor-head"><strong>Add a property</strong><div class="spacer"></div><button class="ghost" data-act="prop-close">Close</button></div>
		<div class="lx-pick-prop">
			<div class="lx-pick-list">
				<input id="lx-prop-filter" placeholder="Filter: gpio, supply, spi-…" value="${esc(editing.filter ?? "")}" spellcheck="false" autocomplete="off">
				<div class="lx-pick-rows">${choices.map(choice => `<button class="lx-pick-row${choice.name === editing.pick ? " on" : ""}" data-act="pick-prop" data-name="${esc(choice.name)}" data-match="${esc(choice.name.toLowerCase())}"${filter !== "" && !choice.name.toLowerCase().includes(filter) ? " hidden" : ""}>
					<span class="mono">${esc(choice.name)}</span>${choice.required ? `<span class="lx-tag warn">required</span>` : ""}${choice.pattern ? `<span class="lx-tag">numbered</span>` : ""}</button>`).join("") || `<div class="subtle">The binding has no other property.</div>`}</div>
			</div>
			<div class="lx-pick-detail">${picked === undefined ? "" : pick_detail(picked)}</div>
		</div>
		<details class="lx-custom"${editing.custom ? " open" : ""}><summary>Custom Property</summary>
		<div class="form-row lx-custom-row">
			<input id="lx-custom-name" placeholder="name" spellcheck="false">
			<select id="lx-custom-kind" aria-label="The value's kind">${Object.entries(CUSTOM_KINDS).map(([value, kind]) => `<option value="${value}">${kind.label}</option>`).join("")}</select>
			<input id="lx-custom-value" placeholder="${esc(CUSTOM_KINDS.numbers.hint)}" spellcheck="false">
			<button class="secondary" data-act="add-custom">Add Property</button>
		</div>${problem_slot("custom")}</details>
	</div>`;
}

/**
 * Whether a property of the node can be removed: one the overlay set, not the compatible nor one
 * the binding requires, nor #address-cells or #size-cells while a child has a unit address
 * (its reg is read by them).
 */
function removable(node, name, property, binding) {
	if (property === undefined || name === "compatible" || property.source === "base" || binding?.required) return false;
	return !(["#address-cells", "#size-cells"].includes(name) && (node.children ?? []).some(child => child.key.includes("@")));
}

/**
 * What Add Property offers for the node open: the binding's properties not set yet, the required
 * first, then the next free name of each of its property patterns (pinctrl-0). Those still to set
 * that the field editor lists among the node's properties, each with its field, are not offered.
 */
function addable_properties() {
	const set = new Set((state.node?.properties ?? []).map(property => property.key));
	const listed = new Set(missing_required().map(prop => prop.name));
	// status is the node's Enabled switch.
	const unset = (state.props ?? []).filter(prop => !set.has(prop.name) && !prop.name.startsWith("^") && !listed.has(prop.name) && prop.name !== "status");
	const numbered = (state.prop_patterns ?? []).map(pattern => free_names(pattern, set)[0]).filter(name => name !== undefined)
		.map(name => ({ name, pattern: true }));
	return [...unset.filter(prop => prop.required), ...unset.filter(prop => !prop.required), ...numbered];
}

/**
 * The properties as the noos part shows them (its node card): one list, every property a field
 * in place by its type, ⓘ for what the binding says and ✕ to remove it; a change is an update at
 * once. What the binding requires comes first (required_properties), the ones still to set
 * each an empty field, in red, which keeps its place once given a value; the node's other
 * properties follow as the overlay has them, so one added (written last) ends the list. What
 * validate finds about a property (`findings(name)`: its errors and warnings) is said under its field.
 */
function noos_style_properties(node, info, findings) {
	const row = (name, property) => {
		const binding = info(name);
		const type = edit_type(name, binding?.type ?? property?.type ?? {}, property?.value);
		const base = property?.source === "base";
		const data = `data-prop="${esc(name)}"`;
		const pin = pin_of(binding, property);
		let editor;
		if (pin !== undefined) editor = pin.held
			? `<span class="mono" title="The only value the binding allows: it can't be changed">${esc(pin.text)}</span>`
			: `<button class="secondary" data-act="set-pin" ${data} title="The only value the binding allows">${esc(pin.action)}</button>`;
		else if (shape_of(type) !== undefined) editor = cells_editor(name, type, written_value(property), { base, parent: interrupt_parent(node), links: links_of(name, binding, property) });
		else if (type.kind === "bool") editor = `<label class="switch"><input type="checkbox" data-edit="bool" ${data}${property?.value === true ? " checked" : ""}><span></span></label>`;
		else {
			const links = links_of(name, binding, property);
			const marked = links.labels ? ` class="lx-labels"` : "";
			editor = type.kind === "enum"
				? choice_field(`data-edit="words" ${data}${marked}`, type, property, links)
				: one_line_field(`data-edit="words" ${data}${marked}${type.kind === "string" ? ` data-text="1"` : ""} placeholder="${esc(type_text(binding))}"`, type, property, links);
		}
		const kind = type_text(binding);
		const fixed = binding?.pinned === undefined ? "" : `<span class="lx-tag" title="The only value the binding allows">fixed</span>`;
		const tag = `${fixed}${base ? `<span class="lx-tag base" title="Set by the base devicetree; a change here goes into the overlay">base</span>` : ""}`;
		const found = findings(name);
		// From before the last change while dt-validate reads the overlay again: dimmed.
		const said = (finding, kind) => `<div class="lx-prop-problem ${kind}${state.validating ? " stale" : ""}">${esc(property_message(finding.message, name))}</div>`;
		return `<div class="lx-prop${property === undefined ? " lx-unset" : ""}${base ? " from-base" : ""}${found.errors.length > 0 ? " invalid" : ""}"${property === undefined ? ` title="Still to set: ${binding?.required ? "the binding requires it" : "interrupts takes its shape from it"}"` : ""}>
			<div class="lx-prop-name"><span class="mono">${esc(name)}</span>${binding?.required ? ` <span class="req">*</span>` : ""}
				${kind || tag ? `<div class="lx-prop-kind">${kind ? `<span class="mono">${type_html(binding)}</span>` : ""}${tag}</div>` : ""}</div>
			<div class="lx-prop-value"><div class="editor">${editor}</div>${problem_slot(`prop:${name}`)}${found.errors.map(error => said(error, "error")).join("")}${found.warnings.map(warning => said(warning, "warning")).join("")}<div class="detail" data-detail="${esc(name)}" hidden></div></div>
			<div class="lx-prop-actions">
				<button class="ghost" title="What the binding says" data-act="details" ${data}>ⓘ</button>
				${removable(node, name, property, binding) ? `<button class="ghost" title="Remove" data-act="clear" ${data}>✕</button>` : `<span></span>`}
			</div></div>`;
	};
	const set = new Map(node.properties.map(property => [property.key, property]));
	const first = required_properties().map(prop => prop.name);
	const rest = node.properties.filter(property => !first.includes(property.key));
	return `<div class="card lx-noos-card"><div class="lx-plist">${first.map(name => row(name, set.get(name))).join("")}${rest.map(property => row(property.key, property)).join("")}</div></div>`;
}

/**
 * A property's type as dt-schema gives it, with what its values can be (list property's and read's
 * `dt_type` without the parts about size, `shown_type`: uint32 · 0 to 10000000, uint32-array ·
 * each 0 to 7, uint32 · const 28, phandle-array, flag), `untyped` where the binding gives none (a
 * custom property); "" while Preferences doesn't show types.
 */
const type_text = binding => state.show_types ? shown_type(binding?.dt_type || "untyped") : "";
/**
 * The type as it is shown: whole, never cropped. It wraps where it is too long for its place, and
 * only between its parts (the type, then each constraint after a `·`), each part kept on one line.
 */
const type_html = binding => type_text(binding).split(" · ")
	.map((part, at) => `<span class="lx-type-part">${at === 0 ? "" : "· "}${esc(part)}</span>`).join(" ");

/** The kinds of value a custom property takes, and how each is given to update. */
const CUSTOM_KINDS = {
	numbers: { label: "Numbers", hint: "cells: 1 2 0x10", words: value => value.split(/\s+/).filter(word => word !== "") },
	text: { label: "Text", hint: "a string: hello world", words: value => [value] },
	reference: { label: "Reference", hint: "a label: vref", words: value => [`&${value.replace(/^&/, "")}`] },
	flag: { label: "Flag", hint: "no value: the property alone", words: () => [] },
};

/** Harmonic's toggle switch, labelled Enabled: enable / disable the node (`data`). */
function enable_switch(enabled, data) {
	return `<div class="lx-enable" title="Sets status = &quot;${enabled ? "disabled" : "okay"}&quot;">
		<span>Enabled</span><label class="switch"><input type="checkbox" ${data}${enabled ? " checked" : ""}><span></span></label></div>`;
}

/**
 * The overlay's text, its labels, strings, numbers and comments set apart. With `references`, a
 * reference to a node that exists (`&spi0 {`, `<&clk_osc>`) is a link to it (data-ref), and so is
 * a label where a node is given it (`adc: adi,ad7124-8@2 {`); a node without one isn't a link.
 */
function highlight(text, references = false) {
	// `label` as `shown`: a link to its node, or only coloured.
	const label_html = (shown, label) => references && label_exists(label)
		? `<a href="#" class="l lx-ref" data-ref="${label}" title="Go to ${label}">${shown}</a>`
		: `<span class="l">${shown}</span>`;
	// A label given is at the start of its line, before any tag; its link has no `&amp;` for the
	// references after it to take.
	return esc(text)
		.replaceAll(/(\/\/.*)$/gm, `<span class="c">$1</span>`)
		.replaceAll(/(&quot;[^&]*?&quot;)/g, `<span class="s">$1</span>`)
		.replaceAll(/^(\s*)([\w-]+)(:)/gm, (_all, indent, label, colon) => `${indent}${label_html(label, label)}${colon}`)
		.replaceAll(/&amp;([\w-]+)/g, (all, label) => label_html(all, label))
		.replaceAll(/(\/dts-v1\/|\/plugin\/|__overlay__|fragment@\d+)/g, `<span class="k">$1</span>`)
		.replaceAll(/(&lt;)([^&]*?)(&gt;)/g, (_all, open, inner, close) => `${open}<span class="n">${inner}</span>${close}`);
}

/**
 * A source as every view shows it (the right column's overlay or full .dts, the Add Device
 * preview): numbered and wrapped, each line highlighted on its own (a span never crosses lines).
 * `references`: its references and labels are links (the overlay's; not the full .dts, with a base's thousands).
 */
function source_box(text, extra = "", { references = false } = {}) {
	const lines = text.replace(/\n$/, "").split("\n");
	// The numbers' column as wide as the last number.
	return `<pre class="lx-source${extra ? ` ${extra}` : ""}" style="--ln-digits:${String(lines.length).length}">${lines.map(line => `<span class="ln">${highlight(line, references)}</span>`).join("")}</pre>`;
}

/** A project path as an absolute one: a relative one is the project folder's (as build-dir is). */
function project_path(file) {
	const folder = host.project?.dir;
	if (!file || !folder || file.startsWith("/") || /^~(?=$|\/)/.test(file)) return file;
	return `${folder.replace(/\/+$/, "")}/${file.replace(/^(\.\/)+/, "")}`;
}

/** A Copy button that copied: it reads "Copied ✓" for a moment (no toasts in this part). */
function show_copied(button, said = "Copied ✓") {
	// Its own label kept once: a second click within the moment doesn't make "Copied ✓" its label.
	button.dataset.label ??= button.textContent;
	button.textContent = said;
	clearTimeout(Number(button.dataset.timer));
	button.dataset.timer = String(setTimeout(() => {
		if (button.isConnected) button.textContent = button.dataset.label;
	}, 1500));
}

/** Copy `text`, the button saying it did; the browser refusing the clipboard, it says that instead. */
async function copy_text(button, text) {
	try {
		await navigator.clipboard.writeText(text);
		show_copied(button);
	} catch {
		show_copied(button, "Not copied");
	}
}

// --- the gear's Project tab ---------------------------------------------------------------------

/**
 * The Project tab of the gear's popup (the core's preferences panel, `project` in what mount
 * resolves with): the project's own settings, in sections, one after the other, each drawn by
 * its `draw(box, { close })` into a box of its own, and handling its own clicks there; `close`
 * closes the popup: the settings, the commands the CLI runs (the executable variables), and the
 * variables they get.
 */
const PROJECT_SECTIONS = [
	{ id: "settings", draw: draw_settings },
	{ id: "commands", draw: draw_commands },
	{ id: "system-variables", draw: draw_system_variables },
	{ id: "project-variables", draw: draw_project_variables },
];

/** Draw the Project tab in `box` (the core calls it each time the popup opens). */
async function draw_project(box, { close }) {
	box.innerHTML = PROJECT_SECTIONS.map(section => `<div class="lx-project-section" data-project-section="${esc(section.id)}"></div>`).join("");
	await Promise.all(PROJECT_SECTIONS.map(section => section.draw(box.querySelector(`[data-project-section="${CSS.escape(section.id)}"]`), { close })));
}

/** A setting's description as its (i) shows it (the setup's `about`, else the CLI's, its URLs links); "", none. */
const setting_about = config => setup.about[config.field_name] ?? linkify(config.description);

/**
 * The Project tab's settings, as `analog-attach config` has them: by category, each with its
 * control (a choice, a path, a text), saved one at a time, reset to its default, for this project.
 * A refusal is said under its field, which keeps what was typed, until the next edit; a save shows
 * nothing more than the value saved. The Linux tree and the base devicetree change as in the
 * setup: its step, in a panel in the popup's place, back to the tab after. Setting linux or
 * devicetree rebuilds the binding caches: it takes a while.
 */
async function draw_settings(box, { close }) {
	if (box.dataset.wired !== "1") {
		box.dataset.wired = "1";
		attach_paths(box);
		box.addEventListener("click", event => on_settings_click(event, box, close));
		box.addEventListener("input", event => {
			const row = event.target.closest?.(".setting-row");
			const problem = row?.querySelector(".lx-problem");
			if (problem) problem.hidden = true;
		});
		box.addEventListener("keydown", event => {
			if (event.key === "Enter" && event.target.matches?.("input[data-setting]")) event.target.closest(".setting-row")?.querySelector('[data-act="lx-save-setting"]')?.click();
		});
	}
	if (box.childElementCount === 0) box.innerHTML = `<p class="subtle">Reading the settings…</p>`;
	const result = await cli(["config", "--json"], { quiet: true });
	const configs = result.json?.configs ?? [];
	if (!box.isConnected) return;
	const groups = new Map();
	for (const config of configs) {
		if (!groups.has(config.category)) groups.set(config.category, []);
		groups.get(config.category).push(config);
	}
	const control = config => {
		const value = Array.isArray(config.value) ? config.value.join(" ") : config.value ?? "";
		const options = typeof config.type === "object" && Array.isArray(config.type?.options) ? config.type.options : null;
		if (options !== null) {
			return `<select data-setting="${esc(config.field_name)}"><option value="">— ${config.default ? `default (${esc(config.default)})` : "unset"} —</option>${options.map(option => {
				const choice = typeof option === "string" ? option : option.value;
				return `<option value="${esc(choice)}"${choice === value ? " selected" : ""}>${esc(choice)}</option>`;
			}).join("")}</select>`;
		}
		if (config.type === "path") return path_field(config.field_name, value, `data-setting="${esc(config.field_name)}"`);
		return `<input data-setting="${esc(config.field_name)}" value="${esc(value)}" placeholder="${esc(config.default ?? (config.type === "path" ? "a path" : "unset"))}" spellcheck="false">`;
	};
	// The Linux tree and the base devicetree change as in the setup: its step, in a panel (change_setting).
	const picked = { linux: "another Linux tree", devicetree: "another base devicetree" };
	const editor = config => picked[config.field_name]
		? `<span class="path-field"><input readonly value="${esc(config.value ?? "")}" placeholder="unset" title="Change… picks ${picked[config.field_name]}" spellcheck="false"><button class="secondary" data-act="change-setting" data-key="${esc(config.field_name)}" title="Pick ${picked[config.field_name]}">Change…</button></span>`
		: `${control(config)}<button class="secondary" data-act="lx-save-setting" data-key="${esc(config.field_name)}">Save</button><button class="ghost" title="Back to the default" data-act="lx-reset-setting" data-key="${esc(config.field_name)}">Reset</button>`;
	// Drawn again after a save or a reset: the popup stays where it was scrolled to.
	const scroller = box.closest(".panel-body");
	const scrolled = scroller?.scrollTop ?? 0;
	box.innerHTML = [...groups].map(([category, settings]) => `<section class="pref-section lx-settings"><h3>${esc(category)}</h3><table>${settings.map(config => `<tr class="setting-row" data-info data-setting-row="${esc(config.field_name)}">
		<td class="key">${esc(config.field_name)}${config.required ? ` <span class="req">*</span>` : ""}${setting_about(config) ? info_button(config.field_name) : ""}</td>
		<td class="edit"><div class="editor">${editor(config)}</div>
		<div class="lx-problem" role="alert" hidden></div>
		${setting_about(config) ? info_text(setting_about(config), "subtle lx-setting-about") : ""}</td></tr>`).join("")}</table></section>`).join("");
	if (scroller) scroller.scrollTop = scrolled;
}

/**
 * A click in the Project tab's settings: Save and Reset (`config`), each said under its field when
 * refused; Change… for the Linux tree and the base devicetree. A setting can be the backend
 * itself, or the tree or the base: the core reads the project again (and mounts another part for
 * another backend, the popup then closed); the settings are drawn again, with what was saved.
 */
async function on_settings_click(event, box, close) {
	const target = event.target.closest("[data-act]");
	if (target === null) return;
	const act = target.dataset.act;
	const key = target.dataset.key;
	if (act === "change-setting") {
		change_setting(key, { back: true });
		return;
	}
	if (act !== "lx-save-setting" && act !== "lx-reset-setting") return;
	const row = target.closest(".setting-row");
	const field = row.querySelector(`[data-setting="${CSS.escape(key)}"]`);
	const value = field?.value.trim() ?? "";
	const reset = act === "lx-reset-setting" || value === "";
	target.classList.add("loading");
	// With --json: a refused setting exits 0 too, its answer tells it apart.
	const result = await cli(["config", key, ...(reset ? ["--reset"] : [value]), "--json"]);
	target.classList.remove("loading");
	if (result.code !== 0 || result.json?.ok === false) {
		// The field keeps what was typed; why is under it, until the next edit.
		const problem = row.querySelector(".lx-problem");
		problem.textContent = first_line(result.json?.message ?? (result.stderr || result.stdout));
		problem.hidden = false;
		return;
	}
	if (key === "linux" || key === "devicetree") base_changed();
	await host.reload_project();
	if (!main.isConnected) {
		close();
		return;
	}
	await draw_settings(box, { close });
	// The system variables follow the settings (AA_OUTPUT, AA_BUILD_DIR, …).
	const variables = box.parentElement?.querySelector('[data-project-section="system-variables"]');
	if (variables) await draw_system_variables(variables);
}

/** A variable's line in the Project tab: its name, its ⓘ when it says something, its value or its control, then a project variable's tools (variable_tools). */
const variable_row = (variable, edit, about = "", tools = "") => `<tr class="setting-row" data-info data-var-row="${esc(variable.name)}">
	<td class="key">${esc(variable.name)}${about ? info_button(variable.name) : ""}</td>
	<td class="edit">${edit}<div class="lx-problem" role="alert" hidden></div>${about ? info_text(about, "subtle lx-setting-about") : ""}</td>${tools}</tr>`;

/** The executable variable of each command the CLI runs, by what runs it (`runs`, `scripts`). */
const COMMAND_OF = { build: "AA_BUILD", deploy: "AA_DEPLOY", preprocess: "AA_PREPROCESS_COMMAND" };

/** What runs a command, as its ⓘ says it: the header's button, or every devicetree read. */
const RUN_BY = { build: "Build Overlay runs it, its output in the console.", deploy: "Deploy runs it, its output in the console.", preprocess: "Every command that reads a devicetree runs it." };

/** The commands a variable is given to, as its ⓘ says it: AA_BUILD, AA_DEPLOY and AA_PREPROCESS_COMMAND. */
const given_to = variable => {
	const names = (variable.scripts ?? []).map(script => `<code>${esc(COMMAND_OF[script] ?? script)}</code>`);
	return `Given to ${names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names.join("")}.`;
};

/** The starter script of each command that has one: what AA_BUILD and AA_DEPLOY run by default. */
const STARTER_OF = { build: "aa_build.sh", deploy: "aa_deploy.sh" };

/** A command's row (draw_commands): its lines to edit, whether it is the default, Save and Restore Default. */
const command_row = variable => {
	const value = variable.value ?? "";
	const is_default = value === variable.default;
	const starter = STARTER_OF[variable.runs];
	// With a starter, Restore Default also writes a missing script, so it is on at the default too.
	const restore = starter === undefined
		? `Go back to the default: ${variable.default ?? ""}`
		: `Go back to the default, ${variable.default ?? ""}, and write the starter ${starter} when the project folder has none`;
	const lines = Math.min(12, Math.max(1, value.split("\n").length));
	return variable_row(variable, `<div class="editor lx-command">
		<textarea class="mono" data-command rows="${lines}" spellcheck="false" autocomplete="off" aria-label="${esc(variable.name)}" data-saved="${esc(value)}">${esc(value)}</textarea>
		<div class="lx-command-tools"><span class="subtle">${is_default ? "Default" : "Changed"}</span>
			<button class="secondary" data-act="command-save" disabled title="Save it (Ctrl+Enter)">Save</button>
			<button class="ghost" data-act="command-reset" data-runs="${esc(variable.runs ?? "")}" data-default="${is_default ? "1" : ""}"${is_default && starter === undefined ? " disabled" : ""} title="${esc(restore)}">Restore Default</button></div></div>`,
	`${esc(variable.description ?? "")}. ${RUN_BY[variable.runs] ?? ""} It runs with <code>sh</code> in the project folder, and may have several lines.`);
};

/**
 * The Project tab's commands (`config var --json`, kind executable): what Build Overlay, Deploy
 * and the preprocessing run, each a shell command of one or more lines, run with sh in the project
 * folder. Each is edited in place and saved with Save (`config var <NAME> <command>`); Restore
 * Default (`--reset`) goes back to the default, which runs the project's aa_build.sh or aa_deploy.sh,
 * or cpp, and writes that script's starter when the project folder has none (`init --restore`),
 * or warns that the one there is kept (restore_default). A refusal is said under its row.
 */
async function draw_commands(box) {
	if (box.dataset.wired !== "1") {
		box.dataset.wired = "1";
		box.addEventListener("click", event => on_commands_click(event, box));
		box.addEventListener("input", event => {
			const row = event.target.closest?.(".setting-row");
			const problem = row?.querySelector(".lx-problem");
			if (problem) problem.hidden = true;
			const save = row?.querySelector('[data-act="command-save"]');
			if (save && event.target.matches?.("[data-command]")) save.disabled = event.target.value === event.target.dataset.saved;
		});
		box.addEventListener("keydown", event => {
			// Ctrl+Enter saves; Enter alone is a new line of the command.
			if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && event.target.matches?.("[data-command]")) {
				event.preventDefault();
				event.target.closest(".setting-row")?.querySelector('[data-act="command-save"]')?.click();
			}
		});
	}
	if (box.childElementCount === 0) box.innerHTML = `<p class="subtle">Reading the commands…</p>`;
	const variables = await read_variables();
	const commands = variables.filter(variable => variable.kind === "executable");
	if (!box.isConnected) return;
	box.innerHTML = `<section class="pref-section lx-settings lx-variables lx-commands"><h3>Commands</h3>
		<table>${commands.map(variable => command_row(variable)).join("")}</table></section>`;
}

async function on_commands_click(event, box) {
	const target = event.target.closest("[data-act]");
	const row = target?.closest(".setting-row");
	if (!target || !row) return;
	const name = row.dataset.varRow;
	let problem;
	if (target.dataset.act === "command-save") {
		const value = row.querySelector("[data-command]")?.value ?? "";
		if (value.trim() === "") {
			say_row_problem(row, `Give ${name} a command, or use the default`);
			return;
		}
		problem = await change_variable([name, value]);
	} else if (target.dataset.act === "command-reset") {
		await restore_default(box, row, name, target.dataset);
		return;
	} else {
		return;
	}
	if (problem !== undefined) {
		say_row_problem(row, problem);
		return;
	}
	await draw_commands(box);
}

/** Whether the project folder has an entry named `name` (a file or not): its listing, else, cut short, a read of it. */
async function in_project_folder(name) {
	const folder = String(host.project?.dir ?? "").replace(/\/+$/, "");
	const listing = await api(`/api/files?path=${encodeURIComponent(folder)}&hidden=1`);
	const { entries, truncated } = await listing.json().catch(() => ({}));
	if (Array.isArray(entries) && (truncated !== true || entries.some(entry => entry.name === name))) return entries.some(entry => entry.name === name);
	const read = await api(`/api/file?path=${encodeURIComponent(`${folder}/${name}`)}`);
	const file = await read.json().catch(() => ({}));
	return file.error === undefined;
}

/**
 * Restore Default: the command back to its default (`config var <NAME> --reset`, unless it is
 * there already), then, for AA_BUILD and AA_DEPLOY, the starter script its default runs: written
 * when the project folder has none (`init --restore <step>`, which also sets the variables the
 * starter uses, drawn in Project variables), kept with a warning, under the row and in the
 * console, when it has one, since that one may be the user's own.
 */
async function restore_default(box, row, name, { runs = "", default: at_default }) {
	if (at_default !== "1") {
		const problem = await change_variable([name, "--reset"]);
		if (problem !== undefined) {
			say_row_problem(row, problem);
			return;
		}
	}
	const starter = STARTER_OF[runs];
	let said;
	if (starter !== undefined) {
		if (await in_project_folder(starter)) {
			said = { text: `${starter} is already in the project folder: kept as it is, and ${name} runs it. 'analog-attach init --restore ${runs}' writes the starter over it.`, kind: "warn" };
			log(`<div class="warnl">${esc(`warning: ${said.text}`)}</div>`);
		} else {
			const result = await cli(["init", "--restore", runs, "--json"]);
			if (result.code !== 0 || result.json?.ok === false) said = { text: first_line(result.json?.message ?? (result.stderr || result.stdout)), kind: "error" };
			else if (result.json?.variables?.length > 0) {
				const variables = box.parentElement?.querySelector('[data-project-section="project-variables"]');
				if (variables) await draw_project_variables(variables);
			}
		}
	}
	await draw_commands(box);
	if (said === undefined) return;
	const slot = box.querySelector(`[data-var-row="${CSS.escape(name)}"] .lx-problem`);
	if (!slot) return;
	slot.textContent = said.text;
	slot.classList.toggle("warn", said.kind === "warn");
	slot.hidden = false;
}

/**
 * The Project tab's system variables (`config var --json`, kind system): what the CLI gives
 * the commands in their environment, worked out from the settings, read-only. Drawn again with
 * the tab, so it follows a setting saved.
 */
async function draw_system_variables(box) {
	if (box.childElementCount === 0) box.innerHTML = `<p class="subtle">Reading the variables…</p>`;
	const variables = await read_variables();
	const system = variables.filter(variable => variable.kind === "system");
	if (!box.isConnected) return;
	box.innerHTML = `<section class="pref-section lx-settings lx-variables"><h3>System variables</h3>
		<table>${system.map(variable => variable_row(variable,
			`<div class="lx-var-value mono${variable.value === null ? " subtle" : ""}" title="${esc(variable.value ?? "")}">${esc(variable.value ?? "(not set)")}</div>`,
			`${esc(variable.description ?? "")}. ${given_to(variable)}`)).join("")}</table></section>`;
}

/** A project variable's Secret switch, and its ✕ (`config var <name> --reset`). */
const secret_switch = (on, title) => `<label class="lx-check lx-var-secret" title="${esc(title)}"><input type="checkbox" data-var-secret${on ? " checked" : ""}> Secret</label>`;
const remove_button = variable => `<button class="ghost" data-act="var-remove" title="Remove ${esc(variable.name)}">✕</button>`;

/** A project variable's tools, a cell each, the same columns in every row: its action (Save, Forget, Add or none), its Secret switch and its ✕ (none in the new row). */
const variable_tools = (action, secret, remove = "") => `<td class="lx-var-tool lx-var-action">${action}</td><td class="lx-var-tool">${secret}</td><td class="lx-var-tool lx-var-remove">${remove}</td>`;

/** A secret made a plain variable in the table, not saved yet: its row has a value to give (draw_project_variables). */
const unsecreting = new Set();

/**
 * The Project tab's project variables (`config var`): a table of the project's own, each its
 * value, saved with Save, a Secret switch and ✕ (`--reset`); then a row to add one. A secret's
 * value is never shown or stored: its row says whether the GUI's environment has it, or this page
 * was given it on Deploy (Forget drops that). Made a secret, a variable's stored value goes (`--secret`);
 * made plain again, it is given a value then saved. A refusal is said under its row.
 */
async function draw_project_variables(box) {
	if (box.dataset.wired !== "1") {
		box.dataset.wired = "1";
		box.addEventListener("click", event => on_variables_click(event, box));
		box.addEventListener("change", event => on_variables_change(event, box));
		box.addEventListener("input", event => {
			const problem = event.target.closest?.(".setting-row")?.querySelector(".lx-problem");
			if (problem) problem.hidden = true;
		});
		box.addEventListener("keydown", event => {
			if (event.key !== "Enter" || !event.target.matches?.("input:not([type=checkbox])")) return;
			event.target.closest(".setting-row")?.querySelector('[data-act="var-save"], [data-act="var-add"]')?.click();
		});
	}
	if (box.childElementCount === 0) box.innerHTML = `<p class="subtle">Reading the variables…</p>`;
	const variables = await read_variables();
	const own = variables.filter(variable => variable.kind === "project" || variable.kind === "secret");
	if (!box.isConnected) return;
	const row = variable => {
		const plain = variable.kind !== "secret" || unsecreting.has(variable.name);
		if (plain) {
			return variable_row(variable, `<div class="editor"><input data-var-value value="${esc(variable.kind === "secret" ? "" : variable.value ?? "")}" placeholder="${variable.kind === "secret" ? "its value, now stored" : ""}" spellcheck="false" autocomplete="off"></div>`, "",
				variable_tools(`<button class="secondary" data-act="var-save">Save</button>`, secret_switch(false, "A secret's value is never stored: AA_DEPLOY gets it from the environment, or Deploy asks for it"), remove_button(variable)));
		}
		const held = secrets.has(variable.name);
		const where = variable.in_environment ? "in the GUI's environment" : (held ? "given on Deploy, kept in this page" : "asked for on Deploy");
		return variable_row(variable, `<div class="editor"><span class="lx-var-value subtle">Secret, ${where}</span></div>`, "",
			variable_tools(held ? `<button class="ghost" data-act="var-forget" title="Forget the value given: Deploy asks for it again">Forget</button>` : "",
				secret_switch(true, "Untick to store a value instead"), remove_button(variable)));
	};
	const scroller = box.closest(".panel-body");
	const scrolled = scroller?.scrollTop ?? 0;
	box.innerHTML = `<section class="pref-section lx-settings lx-variables"><h3>Project variables</h3>
		<table>${own.map(row).join("")}
			<tr class="setting-row lx-var-new"><td class="key"><input data-var-name placeholder="NAME" spellcheck="false" autocomplete="off" aria-label="The new variable's name"></td>
			<td class="edit"><div class="editor"><input data-var-value placeholder="value" spellcheck="false" autocomplete="off" aria-label="Its value"></div>
			<div class="lx-problem" role="alert" hidden></div></td>
			${variable_tools(`<button class="secondary" data-act="var-add">Add</button>`, secret_switch(false, "A secret: its value is never stored; AA_DEPLOY gets it from the environment, or Deploy asks for it"))}</tr></table></section>`;
	if (scroller) scroller.scrollTop = scrolled;
}

/** Run a `config var` change for the Project tab: undefined when written, else why (said under the row). */
async function change_variable(words) {
	const result = await cli(["config", "var", ...words, "--json"]);
	return result.code === 0 && result.json?.ok !== false ? undefined : first_line(result.json?.message ?? (result.stderr || result.stdout));
}

/** A row's problem, under it, until the next edit. */
function say_row_problem(row, text) {
	const problem = row?.querySelector(".lx-problem");
	if (!problem) return;
	problem.textContent = text;
	problem.classList.remove("warn");
	problem.hidden = false;
}

async function on_variables_click(event, box) {
	const target = event.target.closest("[data-act]");
	const row = target?.closest(".setting-row");
	if (!target || !row) return;
	const name = row.dataset.varRow;
	const value = row.querySelector("[data-var-value]")?.value ?? "";
	let problem;
	switch (target.dataset.act) {
		case "var-add": {
			const added = row.querySelector("[data-var-name]").value.trim();
			const secret = row.querySelector("[data-var-secret]").checked;
			if (added === "") {
				say_row_problem(row, "Give the variable a name");
				row.querySelector("[data-var-name]").focus();
				return;
			}
			problem = await change_variable(secret ? [added, "--secret"] : [added, value]);
			break;
		}
		case "var-save": {
			// A secret made plain: a value first, then the secret reset and the value stored (a secret takes none, CONFIG-307).
			if (unsecreting.has(name)) {
				if (value === "") {
					say_row_problem(row, `Give ${name} a value, or tick Secret again`);
					return;
				}
				problem = await change_variable([name, "--reset"]) ?? await change_variable([name, value]);
				if (problem === undefined) {
					unsecreting.delete(name);
					secrets.delete(name);
				}
			} else {
				problem = await change_variable([name, value]);
			}
			break;
		}
		case "var-remove": {
			problem = await change_variable([name, "--reset"]);
			if (problem === undefined) {
				unsecreting.delete(name);
				secrets.delete(name);
			}
			break;
		}
		case "var-forget": {
			secrets.delete(name);
			break;
		}
		default: {
			return;
		}
	}
	if (problem !== undefined) {
		say_row_problem(row, problem);
		return;
	}
	await draw_project_variables(box);
}

/** The Secret switch of a variable's row: made a secret at once (its value goes); made plain, its row asks for a value. */
async function on_variables_change(event, box) {
	const field = event.target;
	if (!field.matches?.("[data-var-secret]")) return;
	const row = field.closest(".setting-row");
	const name = row?.dataset.varRow;
	if (row.classList.contains("lx-var-new")) {
		row.querySelector("[data-var-value]").disabled = field.checked;
		return;
	}
	if (name === undefined) return;
	if (!field.checked) {
		unsecreting.add(name);
		await draw_project_variables(box);
		box.querySelector(`[data-var-row="${CSS.escape(name)}"] [data-var-value]`)?.focus();
		return;
	}
	if (unsecreting.delete(name)) {
		await draw_project_variables(box);
		return;
	}
	const problem = await change_variable([name, "--secret"]);
	if (problem !== undefined) {
		field.checked = false;
		say_row_problem(row, problem);
		return;
	}
	await draw_project_variables(box);
}

/**
 * The Linux tree or the base devicetree (the header's chip, the Project tab): the setup's step for
 * it, in a panel (open_setting); `back`, from the Project tab, opens the tab again once it closes.
 * Once saved, the base nodes read so far are another tree's or base's: read again, with the project.
 */
function change_setting(key, { back = false } = {}) {
	open_setting({
		key,
		ecosystem: setup,
		dir: host.project?.dir ?? "",
		title: key === "linux" ? "Change the Linux tree" : undefined,
		closed: back ? () => host.open_preferences?.({ tab: "project" }) : undefined,
		saved: async () => {
			base_changed();
			await host.reload_project();
		},
	});
}

/** The tree or the base changed: the base nodes read so far (opened in the tree) are read again. */
function base_changed() {
	state.loaded.clear();
	state.bus_base.clear();
	drop_node_index();
}

/**
 * What `build` writes, as the settings say (the CLI's derive_build_files): a .dtbo of the overlay,
 * or, where `output` is devicetree, the full devicetree's .dts and its .dtb. Paths are the project's.
 */
function build_files() {
	const full = state.settings.output === "devicetree";
	const folder = String(state.settings["build-dir"] ?? "build").replace(/\/+$/, "");
	const name = String(state.settings.workfile ?? "overlay.dtso").split("/").pop();
	const stem = `${folder}/${name.endsWith(".dtso") ? name.slice(0, -".dtso".length) : name}`;
	return full
		? { full, binary: `${stem}.dtb`, source: `${stem}.dts`, what: "Devicetree" }
		: { full, binary: `${stem}.dtbo`, what: "Overlay" };
}

/** The header's Build button: what the output setting makes. */
function draw_build_button() {
	const button = $("lx-build");
	if (button === null || !state.workfile) return;
	const files = build_files();
	button.textContent = `Build ${files.what}`;
	button.title = files.full
		? `The base with the overlay applied, compiled into ${files.binary}`
		: `The overlay compiled into ${files.binary}`;
}

/** "1 error", "2 warnings". */
const counted = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

/**
 * Build: the project's AA_BUILD (aa_build.sh by default), its output into the console (opened for
 * it). With validation errors it asks first: the build compiles what the bindings refuse all the
 * same. A refusal (no aa_build.sh, said with the CLI's hint; the command failing) exits 0 as a
 * build does: the build's last words, the file it wrote (BUILD-032), tell them apart, and the
 * console's last line says which. A full .dts it wrote is offered in the right column (load_full).
 */
async function build() {
	if (state.validated && state.errors.length > 0) {
		const text = `dt-validate finds ${counted(state.errors.length, "error")} in the overlay. The build compiles it all the same, but the kernel may not probe what is wrong. Build it anyway?`;
		if (!await ask({ title: "Build with validation errors", text, action: "Build Anyway" })) return;
	}
	const { code, text } = await stream(["build"], { output: true });
	const lines = text.trim().split("\n").map(line => line.trim());
	const at = lines.lastIndexOf("Build completed successfully");
	const done = code === 0 && at !== -1;
	// The files follow it, one per line: the .dtbo, or where output is devicetree the .dts then the .dtb; none when AA_BUILD didn't write it (BUILD-033).
	const paths = done ? lines.slice(at + 1).filter(line => line !== "") : [];
	const errors = state.validated ? state.errors.length : 0;
	if (done) log(`<div class="okl">${esc(`Built${paths.length === 0 ? "" : ` ${paths.at(-1).split("/").pop()}`}${errors > 0 ? `, with ${counted(errors, "validation error")}` : ""}`)}</div>`);
	// A non-zero exit has its line from stream already.
	else if (code === 0) log(`<div class="fail">✘ Not built: the build refused, above</div>`);
	await load_full();
}

/**
 * The values of the project's secrets given in this page (Deploy's dialog, ask_secrets), by name:
 * kept in memory until the page is closed, and handed to `deploy` in its run's environment only
 * (deploy.md DEPLOY-040): never saved, logged, shown, or put on a command line.
 */
const secrets = new Map();

/** The project's variables (`config var --json`): the system ones, then the project's, a secret with no value. */
async function read_variables() {
	const result = await cli(["config", "var", "--json"], { quiet: true });
	return result.json?.variables ?? [];
}

/**
 * Deploy: the project's AA_DEPLOY (aa_deploy.sh by default), its output into the console (opened
 * for it). A secret the environment the GUI runs in hasn't, and this page hasn't been given, is asked for first
 * (ask_secrets), then given to the run. A refusal exits 0 as a deploy does: its last words tell
 * them apart (DEPLOY-032), and the console's last line says which; a missing aa_deploy.sh is said
 * there with the CLI's hint. A secret the CLI says it lacks, or a password the board refused
 * (the starter's `refused the password`), is asked for again, and the deploy run again.
 */
async function deploy() {
	const variables = await read_variables();
	const listed = variables.filter(variable => variable.kind === "secret");
	const wanted = listed.filter(variable => !variable.in_environment && !secrets.has(variable.name)).map(variable => variable.name);
	if (wanted.length > 0 && !await ask_secrets(wanted)) return;
	for (;;) {
		const names = new Set(listed.map(variable => variable.name));
		const given = Object.fromEntries([...secrets].filter(([name]) => names.has(name)));
		const { code, text } = await stream(["deploy"], { output: true, env: given });
		if (code === 0 && /^Deploy completed successfully$/m.test(text)) return;
		if (code === 0) log(`<div class="fail">✘ Not deployed: the deploy refused, above</div>`);
		const missing = [...text.matchAll(/Secret variable ([A-Za-z_]\w*) is not in the environment/g)].map(found => found[1]);
		const refused = /refused the password/.test(text) ? [...names] : [];
		for (const name of refused) secrets.delete(name);
		const again = [...new Set([...missing, ...refused])];
		for (const name of again) names.add(name);
		const why = refused.length > 0 ? first_line(text.split("\n").find(line => /refused the password/.test(line))?.replace(/^aa_deploy\.sh:\s*/, "")) : undefined;
		if (again.length === 0 || !await ask_secrets(again, why)) return;
		for (const name of missing) if (!listed.some(variable => variable.name === name)) listed.push({ name, kind: "secret" });
	}
}

/**
 * The dialog for the secrets deploy needs (`names`), each a password field; `problem` said in it
 * (the board refused the last one). Resolves true once each has a value, kept in `secrets`; false
 * when it is closed without.
 */
function ask_secrets(names, problem) {
	return new Promise(resolve => {
		let given = false;
		const dialog = open_dialog({
			title: "Deploy",
			subtitle: `AA_DEPLOY needs ${names.length === 1 ? "a secret" : "secrets"} of the project. Kept in this page until it is closed, given to the deploy in its environment, never saved.`,
			body: names.map(name => `<label class="field"><span class="mono">${esc(name)}</span><input type="password" data-secret="${esc(name)}" autocomplete="off" spellcheck="false"></label>`).join(""),
			action: "Deploy",
			on_action: body => {
				const values = names.map(name => [name, body.querySelector(`[data-secret="${CSS.escape(name)}"]`)?.value ?? ""]);
				const empty = values.find(([, value]) => value === "");
				if (empty !== undefined) return `Give ${empty[0]}`;
				for (const [name, value] of values) secrets.set(name, value);
				given = true;
				resolve(true);
				return true;
			},
			on_close: () => { if (!given) resolve(false); },
		});
		if (problem) dialog.problem(problem);
	});
}

// --- adding a device: the panel -----------------------------------------------------------

/**
 * The Add Device panel's state. `near` is the node picked in the tree when it opened, by its
 * labels and its path in the merged tree: the device's bus or parent when it can go there.
 */
const add = { panel: undefined, filter: "", adi_only: true, tag: "", picked: null, parents: null, near: { labels: [], path: undefined }, preview_timer: undefined };

/** The node picked in the tree, as Add Device preselects it: its labels, its path in the merged tree. */
function picked_in_tree() {
	if (state.selected === null) return { labels: [], path: undefined };
	return { labels: state.node?.alias ?? (state.selected.startsWith("/") ? [] : [state.selected.split("/")[0]]), path: path_in_merged() };
}

async function open_add() {
	// The button is drawn with the overlay only: there is one.
	if (!state.workfile) return;
	add.near = picked_in_tree();
	add.picked = null;
	add.panel = open_panel({
		title: "Add a device",
		wide: true,
		on_close: () => { add.panel = undefined; },
	});
	add.panel.body.addEventListener("click", on_add_click);
	attach_open_with(add.panel.body);
	// What the form said was wrong goes at the next edit (the field keeps what was typed).
	add.panel.body.addEventListener("input", event => {
		if (event.target.closest?.("#lx-pick")) {
			for (const problem of add.panel?.body.querySelectorAll(":scope #lx-pick .lx-problem") ?? []) problem.hidden = true;
			$("lx-addr")?.classList.remove("refused");
		}
	}, { capture: true });
	add.panel.body.addEventListener("input", event => {
		if (event.target.id === "lx-find") {
			add.filter = event.target.value;
			draw_results();
		}
		// The name, the address and the label redraw the preview a moment after the last key.
		if (["lx-name", "lx-addr", "lx-label"].includes(event.target.id)) {
			clearTimeout(add.preview_timer);
			add.preview_timer = setTimeout(draw_preview, 300);
		}
	});
	add.panel.body.addEventListener("change", event => {
		if (event.target.id === "lx-adi") {
			add.adi_only = event.target.checked;
			draw_results();
		}
		if (event.target.id === "lx-parent") draw_bus_fields();
		if (event.target.id === "lx-cs") {
			draw_cs_note();
			draw_preview();
		}
		// The template redraws the preview once it knows what the copy is named (draw_template), the bus once its fields are drawn (draw_bus_fields).
		if (event.target.id === "lx-template") draw_template();
	});
	add.panel.body.innerHTML = `<p class="subtle lx-add-loading">Reading the Linux tree's compatibles…</p>`;
	await load_devices();
	add.panel.body.innerHTML = `<div class="lx-add">
		<div class="lx-add-search">
			<input id="lx-find" value="${esc(add.filter)}" spellcheck="false" autofocus>
			<label class="subtle form-row" style="font:var(--type-body-xs)"><input type="checkbox" id="lx-adi"${add.adi_only ? " checked" : ""}> Analog Devices parts</label>
			<div class="lx-tags" id="lx-tags"></div>
			<div class="lx-results" id="lx-results"></div>
		</div>
		<div class="lx-add-pick" id="lx-pick"><div class="empty">Pick a device on the left.</div></div>
	</div>`;
	draw_results();
	$("lx-find").focus();
}

/** The compatibles the search matches, among the Analog Devices parts only when `adi_only`. */
function matches(adi_only = add.adi_only) {
	// Every word in the compatible or the binding's folder (iio/adc): "adc", "ad7124", "adc ad71".
	const words = add.filter.trim().toLowerCase().split(/\s+/).filter(Boolean);
	return state.devices.filter(device => (!adi_only || device.key.startsWith("adi,"))
		&& (add.tag === "" || device.tag === add.tag)
		&& words.every(word => device.key.toLowerCase().includes(word) || (device.tag ?? "").toLowerCase().includes(word)));
}

function draw_results() {
	if (add.panel === undefined || $("lx-results") === null) return;
	const found = matches();
	const searched = state.devices.filter(device => !add.adi_only || device.key.startsWith("adi,"));
	$("lx-find").placeholder = `Search ${searched.length.toLocaleString("en").replaceAll(",", " ")} Devices`;
	const tags = new Map();
	for (const device of searched) tags.set(device.tag, (tags.get(device.tag) ?? 0) + 1);
	const top = [...tags].sort((a, b) => b[1] - a[1]).slice(0, 14);
	$("lx-tags").innerHTML = [`<button class="lx-tag${add.tag === "" ? " on" : ""}" data-tag="">all</button>`,
		...top.map(([tag, count]) => `<button class="lx-tag${add.tag === tag ? " on" : ""}" data-tag="${esc(tag)}">${esc(tag)} <span>${count}</span></button>`)].join("");
	const shown = found.slice(0, 200);
	$("lx-results").innerHTML = shown.map(device => `<button class="lx-result${add.picked === device.key ? " on" : ""}" data-pick="${esc(device.key)}"><span class="mono">${esc(device.key)}</span><span class="subtle">${esc(device.tag)}</span></button>`).join("")
		+ (found.length > shown.length ? `<div class="subtle" style="padding:8px">and ${found.length - shown.length} more: narrow the search</div>` : "")
		+ (found.length === 0 ? no_match() : "");
}

/** The search found nothing: among the Analog Devices parts only, the way to all the compatibles. */
function no_match() {
	const where = add.tag === "" ? "" : ` in ${esc(add.tag)}`;
	if (!add.adi_only) return `<div class="empty">No device matches${where}.</div>`;
	const others = matches(false).length;
	return `<div class="empty">No Analog Devices part matches${where}.${others > 0 ? `<div class="actions-row" style="justify-content:center;margin-top:8px"><button class="secondary" data-act="all-compatibles">Search All</button></div>` : " Nor does any other device."}</div>`;
}

/**
 * The devicetree's generic node name for a binding's folder (iio/adc: adc), as the spec lists
 * them, or nothing (the CLI then names the node after its compatible).
 */
function generic_name(tag = "") {
	const GENERIC = { "iio/adc": "adc", "iio/dac": "dac", "iio/accel": "accelerometer", "iio/gyroscope": "gyrometer", "iio/magnetometer": "magnetometer",
		"iio/temperature": "temperature-sensor", "iio/pressure": "pressure-sensor", "iio/humidity": "humidity-sensor", "iio/light": "light-sensor",
		"iio/proximity": "proximity-sensor", "iio/imu": "imu", "iio/potentiometer": "potentiometer", rtc: "rtc", eeprom: "eeprom" };
	return GENERIC[tag] ?? "";
}

async function pick(key) {
	add.picked = key;
	draw_results();
	const [parents, templates] = await Promise.all([
		cli(["list", "parent", key, "--json"], { quiet: true }),
		load_templates(key),
	]);
	if (add.picked !== key || $("lx-pick") === null) return;
	add.parents = parents.json?.suggestions ?? [];
	add.templates = templates;
	// The buses by the labels the board calls them (spi0, not its other label spi), and on or off.
	const buses = await load_buses().then(() => state.buses ?? []).catch(() => []);
	if (add.picked !== key || $("lx-pick") === null) return;
	const bus_of = parent => buses.find(bus => bus.path === parent.display_string || (bus.labels ?? []).includes(parent.value));
	const shown = parent => {
		const bus = bus_of(parent);
		const labels = bus?.labels ?? [parent.value];
		const off = bus !== undefined && bus.status !== "okay" && bus.status !== "unknown" ? " · off" : "";
		// A labelled parent by its labels only; an unlabelled one's value is its path (/clocks).
		return `${labels.join(" · ")}${off}`;
	};
	// The node picked in the tree when the device can go there (a bus, a parent it lists), else the first.
	const near = parent => (add.near.path !== undefined && parent.display_string === add.near.path)
		|| add.near.labels.some(label => parent.value === label || (bus_of(parent)?.labels ?? []).includes(label));
	const preferred = add.parents.find(parent => near(parent))?.value ?? add.parents[0]?.value ?? "";
	// Bus when the device goes on an SPI or I2C bus, else Parent (the node it goes under).
	const on_bus = add.parents.length > 0 && add.parents.every(parent => bus_of(parent) !== undefined || /^(spi|i2c)/.test(parent.value));
	$("lx-pick").innerHTML = `
		<div class="lx-picked"><div class="mono" style="font:600 var(--font-size-medium)/24px var(--mono)">${esc(key)}</div>
			<div class="subtle">${esc(state.devices.find(device => device.key === key)?.tag ?? "")}</div></div>
		${template_field()}
		<label class="lx-field"><span>${on_bus ? "Bus" : "Parent"}</span>
			<select id="lx-parent">${add.parents.map(parent => `<option value="${esc(parent.value)}"${parent.value === preferred ? " selected" : ""}>${esc(shown(parent))}</option>`).join("")}</select></label>
		<div id="lx-bus-fields"></div>
		<div class="fields-inline lx-add-names">
			<label class="lx-field lx-own-name"><span>Name</span><input id="lx-name" spellcheck="false"></label>
			<label class="lx-field"><span>Label</span><input id="lx-label" spellcheck="false"></label>
		</div>
		<div id="lx-preview" hidden></div>
		<div class="actions-row" style="margin-top:12px"><button class="primary" data-act="do-add">＋ Add Device</button></div>
		<div class="lx-problem" id="lx-add-problem" role="alert" hidden></div>`;
	add.copied = undefined;
	await draw_bus_fields();
}

/**
 * What `add --template` takes for the device: `required`, the binding's examples with it (their
 * bus) and the Linux tree's overlays that add it (their fit). Asked of the CLI's completion, which
 * is the one place that lists them: lines `value<TAB>description`, then its directives.
 */
async function load_templates(key) {
	const result = await cli(["__complete", "add", key, "--template", ""], { quiet: true });
	return (result.stdout ?? "").split("\n")
		.filter(line => line !== "" && !line.startsWith("__ANALOG_ATTACH_COMPLETE_"))
		.map(line => {
			const [value, description = ""] = line.split("\t");
			return { value, description };
		})
		.filter(template => template.value === "required" || /^(example|overlay):/.test(template.value));
}

/**
 * A template written for another compatible of the binding than the one picked (completion's
 * `, written for <compatible>` of an example, `via <compatible>` of an overlay: COMPL-071), as its
 * label says it; "" for one written for the device itself.
 */
const written_for = compatible => compatible ? ` · written for ${compatible} (same family)` : "";

/** An example's label: Example 1 · SPI · written for adi,ad7124-4 (same family); the bus left out when it has none. */
function example_label(template) {
	const [bus = "", other] = template.description.split(", written for ");
	return `Example ${template.value.slice("example:".length)}${bus !== "" && bus !== "binding example" ? ` · ${bus}` : ""}${written_for(other)}`;
}

/** An overlay's label: its name, its fit, and the compatible it was matched through when another. */
function overlay_label(template) {
	const via = / via (\S+)$/.exec(template.description)?.[1];
	return `${template.value.slice("overlay:".length).replace(/-overlay\.dts$|\.dts$/, "")} · ${template.description.split(" ")[0]}${written_for(via)}`;
}

/** "Start from": an empty node, a binding example, or an overlay's node (`add --template`). */
function template_field() {
	const templates = add.templates ?? [];
	const examples = templates.filter(template => template.value.startsWith("example:"));
	const overlays = templates.filter(template => template.value.startsWith("overlay:"));
	if (examples.length === 0 && overlays.length === 0) return "";
	const option = (template, label) => `<option value="${esc(template.value)}">${esc(label)}</option>`;
	return `<label class="lx-field"><span>Start from</span>
		<select id="lx-template">
			<option value="required" selected>Empty node</option>
			${examples.length > 0 ? `<optgroup label="Node from example">${examples.map(template => option(template, example_label(template))).join("")}</optgroup>` : ""}
			${overlays.length > 0 ? `<optgroup label="Node from overlay">${overlays.map(template => option(template, overlay_label(template))).join("")}</optgroup>` : ""}
		</select></label>`;
}

/**
 * The template picked: a copy (an example, an overlay's node) keeps its own name, unit address and
 * reg unless --name renames it (ADD-068), so what it is named is read from a dry run without
 * --name (its `key`: add.copied), and the chip select or the address starts at the copy's own,
 * taken or not (the "used by …" says so). Back to an empty node, they start at the first free
 * one again. Then the preview.
 */
async function draw_template() {
	const template = $("lx-template")?.value ?? "required";
	const parent = $("lx-parent")?.value ?? "";
	const filled = add.copied?.unit;
	add.copied = undefined;
	if (template === "required") {
		if ($("lx-cs") !== null && add.bus_node?.first_free !== undefined) $("lx-cs").value = String(add.bus_node.first_free);
		if ($("lx-addr") !== null && filled !== undefined && $("lx-addr").value === filled) $("lx-addr").value = "";
		draw_cs_note();
		await draw_preview();
		return;
	}
	const result = await cli(["add", add.picked, ...(parent ? ["--parent", parent] : []), "--template", template, "--dry-run", "--json"], { quiet: true });
	if (($("lx-template")?.value ?? "required") !== template || ($("lx-parent")?.value ?? "") !== parent) return;
	const [base = "", unit] = String(result.json?.ok ? result.json.key ?? "" : "").split("@");
	add.copied = { template, parent, base, unit: unit !== undefined && /^[0-9a-f]+$/i.test(unit) ? unit.toLowerCase() : undefined };
	if (add.copied.unit !== undefined) {
		const at = String(Number.parseInt(add.copied.unit, 16));
		if ($("lx-cs") !== null && [...$("lx-cs").options].some(option => option.value === at)) $("lx-cs").value = at;
		if ($("lx-addr") !== null) $("lx-addr").value = add.copied.unit;
	}
	draw_cs_note();
	await draw_preview();
}

/**
 * The add the form says: on the bus picked, from the template, with the label typed, and the name
 * typed with the chip select (SPI) or the address (I2C) as its unit address, which sets reg. A
 * field left empty sends nothing: the CLI names the node and labels it (the placeholders say
 * what, from the preview's dry run). A chip select or an address always goes, with the name
 * typed, else a copy's own name, else the devicetree's generic one for the device (adc), else the
 * CLI's (the compatible); a copy at its own unit address with no name typed sends no --name, and
 * keeps its name and reg. `bad_address` when the address typed isn't hex (it is then left out).
 */
function add_arguments() {
	const parent = $("lx-parent")?.value;
	const label = $("lx-label")?.value.trim().replace(/^&/, "");
	const template = $("lx-template")?.value ?? "required";
	const copied = template !== "required";
	const cs = $("lx-cs")?.value;
	const address = $("lx-addr")?.value.trim().replace(/^0x/i, "");
	const bad_address = address !== undefined && !/^[0-9a-f]+$/i.test(address);
	const unit = cs !== undefined ? Number(cs).toString(16) : (address === undefined || bad_address ? undefined : Number.parseInt(address, 16).toString(16));
	const typed = $("lx-name")?.value.trim() ?? "";
	const own = copied && add.copied?.template === template && add.copied.parent === (parent ?? "") ? add.copied : undefined;
	let name = typed;
	if (unit !== undefined && !typed.includes("@")) {
		const kept = typed === "" && own?.unit !== undefined && Number.parseInt(own.unit, 16).toString(16) === unit;
		const base = typed || (copied ? own?.base : generic_name(state.devices.find(device => device.key === add.picked)?.tag) || add.picked);
		name = kept || !base ? typed : `${base}@${unit}`;
	}
	const argv = ["add", add.picked, ...(parent ? ["--parent", parent] : []), ...(copied ? ["--template", template] : []), ...(name ? ["--name", name] : []), ...(label ? ["--label", label] : [])];
	return { argv, cs, bad_address };
}

/**
 * Above Add Device: the node as add would add it from what the form says (`add --dry-run`). What
 * the dry run names and labels it is the Name's and the Label's placeholder: what an empty field
 * leaves to the CLI.
 */
async function draw_preview() {
	const box = $("lx-preview");
	if (box === null) return;
	const { argv } = add_arguments();
	const result = await cli([...argv, "--dry-run", "--json"], { quiet: true });
	// The form changed since: the run for what it says now draws.
	if ($("lx-preview") !== box || JSON.stringify(add_arguments().argv) !== JSON.stringify(argv)) return;
	box.innerHTML = result.json?.ok ? source_box(result.json.node ?? "") : `<div class="problem">${esc(result.json?.message ?? `${result.stderr ?? result.error ?? ""}`.trim())}</div>`;
	box.hidden = false;
	if (result.json?.ok) {
		if ($("lx-name") !== null) $("lx-name").placeholder = String(result.json.key ?? "").split("@")[0];
		if ($("lx-label") !== null) $("lx-label").placeholder = String(result.json.label ?? "");
	}
}

/**
 * Under Bus: for an SPI bus, the chip select, each marked with the node already on it (the base's
 * spidev@0) and its count from cs-gpios; for an I2C bus, the address, the ones taken said; then
 * what the bus needs: turned on when it is off in the base, the node on the chip select turned
 * off. Read from the bus (read <bus> --json).
 */
async function draw_bus_fields() {
	const box = $("lx-bus-fields");
	const parent = $("lx-parent")?.value;
	if (box === null) return;
	if (!parent) {
		await draw_template();
		return;
	}
	box.innerHTML = "";
	const node = (await cli(["read", parent, "--json"], { quiet: true })).json;
	if ($("lx-parent")?.value !== parent || $("lx-bus-fields") === null) return;
	const prop = name => node?.properties?.find(property => property.key === name);
	const labels = node?.alias ?? [parent];
	const status = prop("status")?.value ?? "okay";
	const spi = /spi/.test(`${labels.join(" ")} ${prop("compatible")?.value ?? ""}`);
	const i2c = !spi && /i2c/.test(`${labels.join(" ")} ${prop("compatible")?.value ?? ""}`);
	const taken = new Map();
	for (const child of node?.children ?? []) {
		const unit = child.key.split("@")[1];
		if (unit !== undefined && /^[0-9a-f]+$/i.test(unit)) taken.set(Number.parseInt(unit, 16), child);
	}
	const gpios = prop("cs-gpios")?.value;
	const count = Array.isArray(gpios) ? (gpios.every(row => Array.isArray(row)) ? gpios.length : gpios.filter(cell => typeof cell === "string" && cell.startsWith("&")).length) : undefined;
	const selects = spi ? Array.from({ length: Math.max(count ?? 4, ...[...taken.keys()].map(at => at + 1)) }, (_, at) => at) : [];
	const first_free = selects.find(at => !taken.has(at)) ?? 0;
	add.bus_node = { labels, status, taken, first_free, path: add.parents?.find(item => item.value === parent)?.display_string ?? parent };
	box.innerHTML = `${spi ? `<label class="lx-field lx-cs-field"><span>Chip select</span>
			<select id="lx-cs">${selects.map(at => `<option value="${at}"${at === first_free ? " selected" : ""}>${at}${taken.has(at) ? `  —  used by ${esc(taken.get(at).key)}` : "  —  free"}${count !== undefined && at >= count ? " (no cs-gpios entry)" : ""}</option>`).join("")}</select>
			<span class="hint">Which CS line the device is wired to: it is the node's unit address and reg.</span></label><div id="lx-cs-note"></div>` : ""}
		${i2c ? `<label class="lx-field lx-addr-field"><span>Address</span><input id="lx-addr" placeholder="53" spellcheck="false" autocomplete="off">
			<span class="hint">The device's I2C address in hex (53 or 0x53), from its datasheet: it is the node's unit address and reg.${taken.size > 0 ? ` Taken on ${esc(labels[0] ?? parent)}: ${[...taken.keys()].map(at => at.toString(16)).join(", ")}.` : ""}</span>
			<span class="lx-problem" id="lx-addr-problem" role="alert" hidden></span></label>` : ""}
		${status !== "okay" ? `<label class="lx-check"><input type="checkbox" id="lx-enable-bus" checked> Turn ${esc(labels[0] ?? parent)} on: it is <b>${esc(status)}</b> in the base devicetree</label>` : ""}`;
	draw_cs_note();
	// A copy starts at its own chip select or address, and the preview follows.
	await draw_template();
}

/** Under Chip select: the node already on the one picked, turned off when the device is added. */
function draw_cs_note() {
	const note = $("lx-cs-note");
	if (note === null) return;
	const user = add.bus_node?.taken.get(Number($("lx-cs")?.value));
	note.innerHTML = user === undefined ? "" : `<label class="lx-check"><input type="checkbox" id="lx-disable-taken" checked> Turn off <span class="mono">${esc(user.key)}</span>${user.alias?.[0] ? ` (&amp;${esc(user.alias[0])})` : ""}, which uses this chip select</label>`;
}

/** In the Add panel, what is wrong said at its place (the address, by Add Device) until the next edit. */
function add_problem(id, text) {
	const slot = $(id);
	if (slot === null) return;
	slot.textContent = text;
	slot.hidden = false;
}

async function on_add_click(event) {
	const tag = event.target.closest("[data-tag]");
	if (tag) {
		add.tag = tag.dataset.tag;
		draw_results();
		return;
	}
	const picked = event.target.closest("[data-pick]");
	if (picked) {
		await pick(picked.dataset.pick);
		return;
	}
	const act = event.target.closest("[data-act]")?.dataset.act;
	if (act === "copy-binding") {
		const button = event.target.closest("[data-act]");
		await copy_text(button, state.binding_files.get(button.dataset.path)?.text ?? "");
		return;
	}
	if (act === "all-compatibles") {
		add.adi_only = false;
		$("lx-adi").checked = false;
		draw_results();
		$("lx-find")?.focus();
	} else if (act === "do-add") {
		const { argv, cs, bad_address } = add_arguments();
		if (bad_address) {
			add_problem("lx-addr-problem", "Give the device's I2C address, in hex: 53, or 0x53");
			$("lx-addr").classList.add("refused");
			$("lx-addr").focus();
			return;
		}
		const parent = $("lx-parent")?.value;
		const user = cs === undefined ? undefined : add.bus_node?.taken.get(Number(cs));
		const turn_off = user !== undefined && $("lx-disable-taken")?.checked;
		const turn_on = $("lx-enable-bus")?.checked;
		const result = await mutate(argv);
		if (!result?.json?.ok) {
			// Said by the button; the form keeps what it says.
			add_problem("lx-add-problem", first_line(result?.json?.message ?? result?.stderr ?? "") || "The device was not added.");
			return;
		}
		// The device is in: a refusal of what goes with it is in the console, opened.
		if (turn_off) await mutate(["disable", user.alias?.[0] ?? `${add.bus_node.path}/${user.key}`], { place: "console" });
		if (turn_on) {
			state.buses = null;
			// By its first label (spi0, not spi), as the buses are shown.
			await mutate(["enable", add.bus_node?.labels[0] ?? parent], { place: "console" });
		}
		add.panel?.close();
		// The new device in the tree, whatever was being looked for in it.
		state.tree_filter = "";
		// By its path: its name can be another device's on another bus (dac@0).
		const added = Array.isArray(result.json.path) ? find_merged(`/${result.json.path.join("/")}`) : undefined;
		if (added) {
			await select(path_of(added));
			await fill_fixed();
		}
	}
}

/** The import panel: `import_overlay(source)` runs the import (the part's, by default), `on_close` runs once it closes. */
async function open_import({ import_overlay = source => mutate(["import", source]), on_close } = {}) {
	const panel = open_panel({ title: "Import an overlay", subtitle: "One of the Linux tree's overlays: search by its name or a part it adds.", wide: false, on_close });
	panel.body.innerHTML = `<p class="subtle">Reading the Linux tree's overlays…</p>`;
	const result = await cli(["list", "overlay", "--json"], { quiet: true });
	if (result.json?.ok === false) {
		panel.body.innerHTML = `<p class="subtle">${esc(result.json.message ?? "The overlays could not be read.")}</p>`;
		return;
	}
	const overlays = result.json?.overlays ?? [];
	panel.body.innerHTML = `<div class="form-row"><input id="lx-import-find" placeholder="Search ${overlays.length.toLocaleString("en").replaceAll(",", " ")} overlays: ad7124, adxl, cn0554" spellcheck="false" style="flex:1"></div><div id="lx-import-list" class="lx-import-list"></div>`;
	const draw = () => {
		// Every word in the file name or a compatible it adds: "ad7124", "adi,adxl", "cn0554 rpi".
		const words = $("lx-import-find").value.trim().toLowerCase().split(/\s+/).filter(Boolean);
		const found = words.length === 0 ? [] : overlays.filter(overlay => words.every(word => overlay.name.toLowerCase().includes(word)
			|| overlay.devices.some(device => device.toLowerCase().includes(word))));
		const shown = found.slice(0, 100);
		$("lx-import-list").innerHTML = words.length === 0 ? ""
			: found.length === 0 ? `<p class="subtle">No overlay matches.</p>`
			: shown.map(overlay => `<div class="lx-overlay"><div class="lx-overlay-name"><span class="mono">${esc(overlay.name)}</span>${overlay.devices.length === 0 ? "" : `<span class="mono subtle">${esc(overlay.devices.join(", "))}</span>`}</div><span class="chip ${overlay.fit === "compatible" ? "ok" : overlay.fit === "incompatible" ? "err" : ""}" title="${esc(overlay.reason)}">${esc(overlay.fit)}</span><button data-source="${esc(overlay.path)}">Import Overlay</button></div>`).join("")
				+ (found.length > shown.length ? `<p class="subtle">and ${found.length - shown.length} more: narrow the search</p>` : "");
	};
	panel.body.addEventListener("input", event => { if (event.target.id === "lx-import-find") draw(); });
	panel.body.addEventListener("click", async event => {
		const button = event.target.closest("[data-source]");
		if (!button) return;
		const row = button.closest(".lx-overlay");
		panel.body.querySelector(".lx-import-failed")?.remove();
		button.disabled = true;
		const imported = await import_overlay(button.dataset.source);
		button.disabled = false;
		if (imported.code === 0 && imported.json?.ok !== false) {
			panel.close();
			return;
		}
		// The panel stays: the failure under the overlay that gave it.
		const message = (imported.json?.message ?? imported.stderr ?? "").trim() || "The import failed.";
		row.insertAdjacentHTML("afterend", `<div class="lx-import-failed">${esc(message)}</div>`);
	});
	$("lx-import-find").focus();
}

// --- events -----------------------------------------------------------------------------------

/**
 * Open the node at `path`. `back`: the node it is opened from by a reference (a link, a field's
 * "go to", a node added for a property), which its header offers to go back to; without it, there is no way back.
 */
async function select(path, { back } = {}) {
	// Named as the node open calls it: its label, else its name.
	const name = back !== undefined && back === state.selected ? label_of(state.node) : undefined;
	state.back = back === undefined || back === path ? undefined : { to: back, name: name ?? back.split("/").pop(), at: path };
	if (state.selected !== path) {
		drop_problem();
		state.editing = null;
		state.refused.clear();
		state.said.clear();
		state.described.clear();
	}
	state.selected = path;
	state.node = null;
	render();
	await load_selected();
	render();
}

async function on_click(event) {
	if (event.target.closest("input, select, textarea, .switch")) return;
	// A reference's link (the overlay source): its node.
	const ref = event.target.closest("[data-ref]");
	if (ref) {
		event.preventDefault();
		event.stopPropagation();
		await go_to(ref.dataset.ref);
		return;
	}
	const twist = event.target.closest("[data-toggle]")?.dataset.toggle;
	if (twist) {
		await toggle(twist);
		return;
	}
	const suggestion = event.target.closest("[data-suggest]")?.dataset.suggest;
	if (suggestion !== undefined) {
		const field = main.querySelector(".lx-editor .lx-value");
		if (field) {
			field.value = field.tagName === "SELECT" ? suggestion : suggestion.replace(/^&/, "");
			sync_fields(field.parentElement);
			field.focus();
		}
		return;
	}
	const tree_node = event.target.closest("[data-tree-node]")?.dataset.treeNode;
	if (tree_node) {
		await select(tree_node);
		return;
	}
	const target = event.target.closest("[data-act], [data-node]");
	if (!target) return;
	const act = target.dataset.act;
	if (!act && target.dataset.node) {
		await select(target.dataset.node);
		return;
	}
	const property = target.dataset.prop;
	switch (act) {
		case "node-about": {
			const at = state.selected;
			if (state.about_open.delete(at)) {
				render();
				break;
			}
			state.about_open.add(at);
			const compatible = first_compatible(state.node);
			render();
			if (compatible !== undefined && !state.about.has(compatible)) {
				await load_about(compatible);
				render();
			}
			break;
		}
		case "open-add":
			// With the node picked in the tree preselected, when the device can go there.
			event.preventDefault();
			await open_add();
			break;
		case "change-setting":
			change_setting(target.dataset.key);
			break;
		case "rename":
			open_rename();
			break;
		case "move":
			await open_move();
			break;
		case "delete-node":
			// Refused, the node stays open, with why by its actions.
			if (await ask({ title: "Delete node", text: `<code>${esc(state.node?.key ?? state.selected)}</code> and what is below it leave the overlay; references to it are cleared.`, action: "Delete Node", danger: true })
				&& written(await mutate(["delete", state.selected, "--force"], { place: "card" }))) {
				state.selected = null;
				render();
			}
			break;
		case "cells-add": {
			const editor = target.closest(".lx-cells");
			// As many rows as the binding allows, no more.
			if (editor.dataset.max !== undefined && editor.querySelectorAll(".lx-row:not(.lx-cells-head)").length >= Number(editor.dataset.max)) break;
			const row = empty_row(editor);
			target.before(row);
			fit_rows(editor);
			sync_fields(row);
			row.querySelector("input, select")?.focus();
			break;
		}
		case "cells-remove": {
			const editor = target.closest(".lx-cells");
			target.closest(".lx-row").remove();
			fit_rows(editor);
			for (const [at, index] of [...editor.querySelectorAll(".lx-row-index")].filter(index => index.textContent !== "").entries()) index.textContent = String(at);
			// In place (the noos-style editor), a removed row is saved at once, as any change there.
			if (editor.closest(".lx-noos-card")) {
				const result = cell_words(editor);
				if (!result.incomplete) await (result.clear ? remove_property(editor.dataset.prop) : mutate(["update", state.selected, editor.dataset.prop, ...result.words], { place: `prop:${editor.dataset.prop}` }));
			}
			break;
		}
		case "side-toggle":
			state.side_folded = !state.side_folded;
			try { localStorage.setItem("aa-linux-side", state.side_folded ? "folded" : "open"); } catch {}
			render();
			break;
		case "side-tab":
			set_side_tab(side_tab_of(target.dataset.tab));
			break;
		case "copy-binding": {
			await copy_text(target, state.binding_files.get(target.dataset.path)?.text ?? "");
			break;
		}
		case "new-prop":
			await open_add_property();
			main.querySelector("#lx-prop-filter")?.focus({ preventScroll: true });
			load_said();
			break;
		case "pick-prop":
			await pick_property(target.dataset.name);
			break;
		case "pick-add":
			await add_picked_property();
			break;
		case "prop-close":
			close_editor();
			break;
		case "set-pin": {
			const binding = (state.props ?? []).find(prop => prop.name === property);
			if (binding?.pinned !== undefined) await mutate(["update", state.selected, property, ...pin_words(binding)], { place: property_place(property) });
			break;
		}
		case "go-label": {
			await go_from_field(target);
			break;
		}
		case "go-back": {
			// One step: the node opened from, with no way back from it.
			if (state.back !== undefined) await select(state.back.to);
			break;
		}
		case "add-child-named": {
			const name = $("lx-child-name")?.value.trim();
			if (!name) return;
			await add_child(name);
			break;
		}
		case "clear": {
			// What is typed in the row is dropped, not written: its fields send nothing more.
			const row = target.closest(".lx-prop");
			for (const field of row?.querySelectorAll("input, select") ?? []) field.dataset.discarded = "1";
			if (row?.contains(document.activeElement)) document.activeElement.blur();
			await remove_property(property);
			break;
		}
		case "details": {
			const box = main.querySelector(`[data-detail="${CSS.escape(property)}"]`);
			if (!box) break;
			if (!box.hidden) {
				box.hidden = true;
				break;
			}
			box.hidden = false;
			box.textContent = "Reading…";
			const set = state.node?.properties?.some(item => item.key === property);
			const result = set
				? await cli(["read", state.selected, property], { quiet: true })
				: await cli(["list", "property", state.selected, property], { quiet: true });
			// The binding's text, its links working.
			box.innerHTML = linkify((result.stdout || result.stderr).trim());
			break;
		}
		case "add-custom": {
			// Its fold stays open across the redraws, and what is wrong is said in it.
			if (state.editing) state.editing.custom = true;
			const name = $("lx-custom-name").value.trim();
			if (name === "") {
				say_problem("custom", "Give the custom property a name");
				$("lx-custom-name").focus();
				return;
			}
			const kind = CUSTOM_KINDS[$("lx-custom-kind").value] ?? CUSTOM_KINDS.numbers;
			const value = $("lx-custom-value").value.trim();
			if (value === "" && kind !== CUSTOM_KINDS.flag) {
				say_problem("custom", `Give it a value (${kind.hint}), or make it a flag`);
				$("lx-custom-value").focus();
				return;
			}
			const put_back = hold_fields("#lx-custom-name, #lx-custom-kind, #lx-custom-value");
			if (written(await mutate(["update", state.selected, name, ...kind.words(value)], { place: "custom" }))) close_editor();
			else put_back();
			break;
		}
		case "side-source":
			// The right column's Overlay tab: the overlay, or the full .dts the last build wrote.
			state.side_source = target.dataset.source === "full" && state.full !== null ? "full" : "overlay";
			draw_side();
			break;
		case "copy-source":
			await copy_text(target, state.side_source === "full" && state.full !== null ? state.full.text : state.text);
			break;
	}
}

async function on_change(event) {
	const field = event.target;
	if (field.dataset?.discarded) return;
	// A field edited and taken away by a redraw: the browser says it changed, but the user is still
	// typing; keep_typing carries the text to the field drawn instead, sent when the user leaves it.
	if (redrawing) return;
	// A clocks row's new provider: its old cells go, the CLI shapes the row by its #clock-cells.
	drop_provider_cells(field);
	// A list of labels' ＋ Add a <kind>…: the field goes back to what it held; the node is added and set (create_for).
	if (field.tagName === "SELECT" && field.value.startsWith(CREATE)) {
		const kind = field.value.slice(CREATE.length);
		field.value = field.dataset.was ?? [...field.options].find(option => option.defaultSelected)?.value ?? "";
		await create_for(field, kind);
		return;
	}
	if (field.id === "lx-custom-kind") {
		state.editing && (state.editing.custom = true);
		const kind = CUSTOM_KINDS[field.value];
		$("lx-custom-value").placeholder = kind.hint;
		$("lx-custom-value").disabled = field.value === "flag";
		return;
	}
	if (field.closest?.(".lx-editor") && field.id !== "lx-custom-kind") return;
	// What this change hands on, so a redraw before the CLI answers doesn't send it again (keep_typing).
	const typed = field_values(field);
	handed = typed;
	// The field editor: a tuple's cells go once all are filled.
	const in_place = field.closest?.(".lx-noos-card .lx-cells");
	if (in_place) {
		const result = cell_words(in_place);
		in_place.classList.toggle("incomplete", result.incomplete === true);
		if (result.incomplete) return;
		await (result.clear ? remove_property(in_place.dataset.prop) : update_in_place(typed, result.words));
		return;
	}
	const kind = field.dataset?.edit;
	if (!kind) return;
	// A switch or a field in place shows its change itself: only a refusal or a warning is said.
	if (kind === "enabled") {
		await mutate([field.checked ? "enable" : "disable", state.selected], { place: "card" });
		return;
	}
	const property = field.dataset.prop;
	if (kind === "bool") {
		await (field.checked ? mutate(["update", state.selected, property], { place: property_place(property) }) : remove_property(property));
		return;
	}
	const words = field.dataset.text === "1" && field.value.trim() !== "" ? [field.value.trim()] : field.value.trim().split(/\s+/).filter(word => word !== "");
	if (words.length === 0) await remove_property(property);
	else await update_in_place(typed, words);
}

/**
 * The update of a field of the node's card (`typed`: field_values), sent at once and said only
 * when refused or warned of: the field shows it, the console has the command. Refused, the field
 * keeps what was typed, marked, for the user to correct (show_refused).
 */
async function update_in_place(typed, words) {
	const key = `${typed.node}\u0000${typed.prop}`;
	state.refused.delete(key);
	const result = await mutate(["update", typed.node, typed.prop, ...words], { place: `prop:${typed.prop}` });
	if (!written(result)) {
		state.refused.set(key, { ...typed, message: first_line(result?.json?.message ?? result?.stderr) });
		render();
	}
	return result;
}

/**
 * What an editor's field holds (value_field), as update takes it: `{ words }`; `{ incomplete: true }`
 * while some of its cells are still to fill (marked), `{ clear: true }` when they are all empty,
 * `{ empty: true }` for a one-line field with nothing in it.
 */
function editor_words(panel) {
	const cells = panel.querySelector(".lx-cells");
	if (cells !== null) {
		const result = cell_words(cells);
		cells.classList.toggle("incomplete", result.incomplete === true);
		return result;
	}
	const field = panel.querySelector(".lx-value");
	const value = field?.value.trim() ?? "";
	if (value === "") return { empty: true };
	// A string stays one word (spaces and all); anything else is its words.
	return { words: field?.dataset.text === "1" ? [value] : value.split(/\s+/) };
}

/**
 * Remove a property of the node open (delete <node> <property>), unless its binding requires it:
 * then nothing is removed, and the field shows the value again. What the delete answered, if it ran.
 */
async function remove_property(name) {
	if ((state.props ?? []).some(prop => prop.name === name && prop.required)) {
		state.problem = { place: property_place(name), text: `${name} is required: it can't be removed, only given another value`, kind: "error" };
		render();
		return;
	}
	// Not set (interrupt-parent, listed to set before interrupts, its field emptied): there is nothing to delete.
	if (!(state.node?.properties ?? []).some(property => property.key === name)) {
		render();
		return;
	}
	state.refused.delete(`${state.selected}\u0000${name}`);
	return mutate(["delete", state.selected, name], { place: property_place(name) });
}

/** Whether a mutate wrote its change. */
const written = result => result !== undefined && result.code === 0 && result.json?.ok !== false;

/** Close Add Property (a property added: it is among the fields now). */
function close_editor() {
	state.editing = null;
	drop_problem();
	render();
}

/** Rename: the label (the CLI can't change it yet), the name and the unit address, which sets reg. */
function open_rename() {
	const node = state.node;
	if (node === null) return;
	const [name, unit] = node.key.split("@");
	const label = label_of(node);
	const NAME = /^[a-zA-Z0-9,._+-]+$/;
	const UNIT = /^[0-9a-fA-F,]+$/;
	const dialog = open_dialog({
		title: "Rename node",
		subtitle: `<code>${esc(state.selected)}</code>`,
		body: `<label class="field"><span>Label <span class="subtle">· what references use: &amp;${esc(label ?? "…")}</span></span>
				<input value="${esc(label ?? "")}" disabled placeholder="none">
				<span class="hint">The CLI can't change a label yet.</span></label>
			<div class="fields-inline">
				<label class="field" data-check="name"><span>Name</span><input id="rename-name" value="${esc(name)}" spellcheck="false"><span class="hint">Letters, digits and , . _ + -</span></label>
				<span class="at">@</span>
				<label class="field" data-check="unit"><span>Unit address</span><input id="rename-unit" value="${esc(unit ?? "")}" placeholder="none" spellcheck="false"><span class="hint">Hex; it sets reg</span></label>
			</div>`,
		action: "Rename Node",
		on_action: async body => {
			const new_name = body.querySelector("#rename-name").value.trim();
			const new_unit = body.querySelector("#rename-unit").value.trim();
			if (!NAME.test(new_name)) return "The name may have letters, digits and , . _ + - only";
			if (new_unit !== "" && !UNIT.test(new_unit)) return "The unit address is hex digits (and commas)";
			const key = new_unit === "" ? new_name : `${new_name}@${new_unit}`;
			if (key === node.key) return true;
			const result = await mutate(["rename", state.selected, key]);
			return result?.json?.ok === false || result?.code !== 0 ? first_line(result?.json?.message ?? result?.stderr ?? "Not renamed") : true;
		},
	});
	// Checked as typed: the field says what is wrong under it.
	dialog.body.addEventListener("input", event => {
		const field = event.target.closest(".field");
		if (field === null) return;
		const value = event.target.value.trim();
		field.classList.toggle("bad", field.dataset.check === "name" ? !NAME.test(value) : value !== "" && !UNIT.test(value));
	});
}

/**
 * Move: the buses or parents the device can go on (list parent), filtered as typed; the node goes
 * there. Each by its first label (spi0, not spi), as Add Device names them: list parent gives one
 * label, so the dialog names them so once the buses are read. As in Add Device, the field is Bus
 * when every one is an SPI or I2C bus, else Parent, and its words follow.
 */
async function open_move() {
	const node = state.node;
	const compatible = compatible_of(node);
	const listed = compatible ? (await cli(["list", "parent", compatible, "--json"], { quiet: true })).json?.suggestions ?? [] : [];
	const parents = listed.map(parent => ({ ...parent, labels: [parent.value] }));
	// The bus it is on, by its path in the merged tree: list parent names buses by one label
	// (i2c1), the overlay's fragment perhaps by another (&i2c_arm).
	const where = path_in_merged();
	const parent_path = where === undefined ? undefined : where.split("/").slice(0, -1).join("/") || "/";
	const here = parents.find(parent => parent.display_string === parent_path);
	let picked;
	// Bus or Parent (Add Device's rule): by the names list parent gives, then by the buses once read.
	let buses = [];
	const on_bus = () => parents.length > 0 && parents.every(parent => buses.some(bus => bus.path === parent.display_string || (bus.labels ?? []).includes(parent.value)) || /^(spi|i2c)/.test(parent.value));
	const word = () => on_bus() ? "bus" : "parent";
	const rows = filter => parents.filter(parent => `${parent.labels.join(" ")} ${parent.display_string ?? ""}`.toLowerCase().includes(filter.toLowerCase()))
		.map(parent => `<button class="${parent === picked ? "on" : ""}" data-pick-bus="${parents.indexOf(parent)}"><span class="mono">${esc(parent.labels.join(" · "))}${parent === here ? ` <span class="subtle">· here</span>` : ""}</span><span class="subtle">${esc(parent.display_string ?? "")}</span></button>`).join("")
		|| `<div class="subtle" style="padding:8px">No ${word()} matches.</div>`;
	const dialog = open_dialog({
		title: "Move node",
		subtitle: `<code>${esc(node.key)}</code> and what is below it, to another <span id="move-word">${word()}</span>.`,
		body: `<label class="field"><span id="move-title">${on_bus() ? "Bus" : "Parent"}</span><input id="move-filter" placeholder="Filter: spi, i2c1, /soc/…" spellcheck="false"></label><div class="pick-list" id="move-list">${rows("")}</div>`,
		action: "Move Node",
		on_action: async () => {
			if (picked === undefined) return `Pick a ${word()}`;
			if (picked === here) return true;
			// A node open by its path moves: keep it by its label when it has one.
			state.selected = label_of(node) ?? state.selected;
			const result = await mutate(["move", state.selected, picked.labels[0] ?? picked.value]);
			return result?.json?.ok === false || result?.code !== 0 ? first_line(result?.json?.message ?? result?.stderr ?? "Not moved") : true;
		},
	});
	const redraw = () => { dialog.body.querySelector("#move-list").innerHTML = rows(dialog.body.querySelector("#move-filter").value); };
	dialog.body.addEventListener("input", event => {
		if (event.target.id === "move-filter") redraw();
	});
	dialog.body.addEventListener("click", event => {
		const button = event.target.closest("[data-pick-bus]");
		if (button === null) return;
		picked = parents[Number(button.dataset.pickBus)];
		for (const other of dialog.body.querySelectorAll("[data-pick-bus]")) other.classList.toggle("on", other === button);
	});
	buses = await load_buses().then(() => state.buses ?? []).catch(() => []);
	for (const parent of parents) parent.labels = buses.find(bus => bus.path === parent.display_string || (bus.labels ?? []).includes(parent.value))?.labels ?? parent.labels;
	if (!dialog.body.isConnected) return;
	redraw();
	dialog.body.querySelector("#move-title").textContent = on_bus() ? "Bus" : "Parent";
	const subtitle_word = document.querySelector("#move-word");
	if (subtitle_word) subtitle_word.textContent = word();
}

/** The values a property can take, from list value, into a field's datalist. */
async function suggest(property, list) {
	if (!property || !list) return;
	const result = await cli(["list", "value", state.selected, property, "--json"], { quiet: true });
	const suggestions = result.json?.suggestions ?? [];
	list.innerHTML = suggestions.map(suggestion => `<option value="${esc(suggestion.value)}">${esc(suggestion.display_string ?? "")}</option>`).join("");
}

function on_focus(event) {
	const field = event.target;
	if (field.tagName === "SELECT" && field.dataset?.was === undefined) field.dataset.was = field.value;
	if (field.dataset?.edit === "words" && field.tagName === "INPUT" && !field.dataset.suggested) {
		field.dataset.suggested = "1";
		suggest(field.dataset.prop, field.list);
	}
}
