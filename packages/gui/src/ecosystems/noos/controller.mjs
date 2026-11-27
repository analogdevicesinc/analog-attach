// The noos (CAPI) part of the GUI: the workfile, adding devices, the graph, generate & build,
// and the settings. The core (../../core/app.mjs) mounts it on a project whose backend is noos,
// after the project setup; every action is an `analog-attach` command (../../core/ui.mjs).
// See ../README.md for what a part of an ecosystem is given and gives back.

import { $, api, ask, cli, esc, first_line, is_dark, log, open_dialog, open_panel, stream, toast } from "../../core/ui.mjs";
import { icon } from "../../core/icons.mjs";
import { attach_paths, list_folder, path_field } from "../../core/paths.mjs";
import { attach_open_with, open_with_button } from "../../core/open.mjs";

export const title = "noos (CAPI)";
export const about = "Firmware for a microcontroller board: no-OS drivers on CAPI, generated, built and flashed.";
/** What the project setup asks for (in order), then offers as optional, for a noos project. */
export const setup = {
	keys: ["capi-path", "module-paths", "target"],
	titles: { "capi-path": "CAPI checkout", "module-paths": "Module repositories", target: "Board" },
	optional: ["project-name", "example", "interview", "bootstrap"],
};

const state = {
	project: null,       // the core's: { dir, settings, backend }
	tree: null,          // read --json: { properties: [platform, board], children: [nodes] }
	nodes: [],           // children of the tree
	errors: [], warnings: [],
	devices: null,
	configs: null,
	workfile: false,
	view: "workfile",
	selected: null,
	filter: "",
	details: new Set(),  // "node.prop" rows with their details open
	about_open: new Set(), // the nodes with their schema's description open
	detail_text: {},
	busy: false,
	// A reference's options: "node.prop" (or "node.prop.member" for a union's value) → { options,
	// generation }, options null for a field that is not a reference. Read again after each
	// refresh (a new generation), the old options shown until then.
	choices: new Map(),
	choices_loading: new Set(),
	generation: 0,
	member_picked: new Map(), // "node.prop" → the union member picked, before its value is
	// Experimental (Preferences): the nodes as the Linux part's tree, by what each refers to. For a
	// showcase; to be removed.
	// "flat" (every node at the top, the default), "nested" (by what each node refers to) or "off"
	// (the classic list). The old switch stored "1" for nested and "0" for its default.
	linux_tree: (() => { try { const stored = localStorage.getItem("aa-exp-noos-linux-tree"); return stored === "1" || stored === "nested" ? "nested" : stored === "off" ? "off" : "flat"; } catch { return "flat"; } })(),
	tree_closed: new Set(),
	// Generate & build: the generated project's files, as a tree, and the one shown.
	files: {
		generated: null,     // the folder the last generate said it wrote
		listings: new Map(), // folder → its /api/files listing
		open: new Set(),     // the folders open in the tree
		shown: null,         // the file shown: { path, text } | { path, binary } | { path, too_big } | { path, error }
	},
};

const LAYOUT = `
	<nav id="nav">
		<div class="section">Design</div>
		<button data-view="workfile" class="active" title="Workfile">${icon("document")}<span class="nav-label">Workfile</span><span class="count" id="count-nodes"></span></button>
		<button data-act="open-add" class="nav-action" title="Add Device">${icon("add")}<span class="nav-label">Add Device</span></button>
		<button data-view="graph" title="Graph">${icon("flow-chart")}<span class="nav-label">Graph</span></button>
		<div class="section">Project</div>
		<button data-view="build" title="Generate &amp; build">${icon("tools")}<span class="nav-label">Generate &amp; build</span></button>
		<button data-view="settings" title="Settings">${icon("settings")}<span class="nav-label">Settings</span></button>
	</nav>
	<section class="list" id="list"></section>
	<section class="content" id="content"></section>`;

/** The core's context (see mount) and the element this part draws in. */
let host;
let main;

/**
 * Draw the noos part in `context.main`, for `context.project`. Returns what the core calls
 * after: `refresh()` when the project should be read again.
 */
export async function mount(context) {
	host = context;
	main = context.main;
	state.project = context.project;
	main.innerHTML = LAYOUT;
	context.header_actions.innerHTML = `<button id="validate">Validate</button>`;
	$("validate").onclick = async () => {
		await cli(["validate"]);
		await refresh();
	};
	bind_events();
	// The graph follows the theme.
	window.addEventListener("aa-theme", () => { if (state.view === "graph") render_graph(); });
	await refresh();
	return {
		refresh: () => {
			state.devices = null;
			return refresh();
		},
		preferences: [{
			title: "noos",
			items: [{
				label: "Linux-style tree", hint: "The workfile's nodes as the Linux part's tree: flat (the default), or nested by what each refers to (experimental); Off is the classic list.", kind: "choice",
				options: [["flat", "Flat"], ["nested", "Nested"], ["off", "Off"]],
				value: () => state.linux_tree,
				set: mode => { state.linux_tree = mode; try { localStorage.setItem("aa-exp-noos-linux-tree", mode); } catch {} render(); },
			}],
		}],
		// What the core's chat tells the assistant: a noos project, and what the user is looking at.
		chat: {
			skill: "analog-attach-noos",
			hint: "<i>add an ADXL355 eval board</i>, <i>set the SPI speed to 4 MHz</i>, <i>why is the workfile not valid?</i>",
			context: () => [
				"This is a noos (CAPI) project: follow the analog-attach-noos skill.",
				state.selected ? `The user has the node ${state.selected} open in the GUI.` : "",
			].join(" "),
		},
	};
}

// --- the CLI ---------------------------------------------------------------------------
const board_pin = at => `${at.connector} pin ${at.pin}${at.chip_pin ? ` (${at.chip_pin})` : ""}`;

/**
 * Connections as the jumpers to place: part pins carrying one signal to one board pin are one
 * wire ("P1 pin 1 or 2"). The CLI's text output does the same (bootstrap_run.ts).
 */
function one_wire_each(connections) {
	const wires = [];
	for (const connection of connections) {
		const same = wires.find(wire => wire.role === connection.role && wire.to.connector === connection.to.connector && wire.to.pin === connection.to.pin);
		if (same) same.pins.push(connection.from);
		else wires.push({ pins: [connection.from], role: connection.role, to: connection.to });
	}
	return wires.map(({ pins, role, to }) => {
		const one_connector = pins.every(pin => pin.connector === pins[0].connector);
		const named = pins.map((pin, index) => one_connector && index > 0 ? pin.pin : `${pin.connector} pin ${pin.pin}`);
		return { from: named.length === 1 ? named[0] : `${named.slice(0, -1).join(", ")} or ${named.at(-1)}`, role, to };
	});
}

/** The wiring and what is left, from an add or update result: the console's lines. */
function report_lines(json) {
	const lines = [];
	for (const bus of json.wiring ?? []) {
		lines.push(`Wire ${bus.part} to the board over ${bus.interface.toUpperCase()}${bus.peripheral ? ` (${bus.peripheral})` : ""}:`);
		for (const wire of one_wire_each(bus.connections)) {
			lines.push(`  ${`${wire.from} (${wire.role})`.padEnd(24)} -> ${board_pin(wire.to)}`);
		}
		for (const problem of bus.problems) lines.push(`  ! ${problem}`);
		if ((bus.board_pins ?? []).length > 0) lines.push(`  Its bus is on: ${bus.board_pins.map(pin => `${pin.signal.toUpperCase()} ${board_pin(pin.at)}`).join(", ")}`);
	}
	for (const chip_select of json.chip_selects ?? []) {
		const how = chip_select.kind === "gpio" ? `GPIO ${chip_select.gpio.port} pin ${chip_select.gpio.number}, at ${board_pin(chip_select.at)}`
			: chip_select.kind === "native" ? `native line ${chip_select.native_cs} of ${chip_select.peripheral}` : `unwired: ${chip_select.reason}`;
		lines.push(`Chip-select for ${chip_select.device}: ${how}`);
	}
	if ((json.missing_required ?? []).length > 0) {
		lines.push("Still to set:");
		for (const missing of json.missing_required) lines.push(`  ? ${missing.node}.${missing.property}${missing.suggestions?.length ? `  (${missing.suggestions.map(suggestion => suggestion.value).join(" | ")})` : ""}`);
	}
	return lines;
}

/** A command that changes the workfile: run it with --json, show what it said, then reload. */
async function mutate(args) {
	if (state.busy) return;
	state.busy = true;
	document.body.style.cursor = "progress";
	// The status spins until the workfile is read and validated again (refresh sets it).
	host.set_chips($("board")?.textContent ?? "", { text: "Updating…", kind: "busy" });
	try {
		const result = await cli([...args, "--json"]);
		const failed = result.code !== 0 || result.json?.ok === false;
		if (result.json !== undefined) {
			const lines = report_lines(result.json);
			if (lines.length > 0) log(`<div>${esc(lines.join("\n"))}</div>`);
		}
		toast(failed ? first_line(result.json?.message ?? result.stderr ?? result.stdout) : first_line(result.json?.message ?? result.stdout), failed);
		await refresh();
		return result;
	} finally {
		state.busy = false;
		document.body.style.cursor = "";
	}
}

// --- loading ---------------------------------------------------------------------------
async function refresh() {
	// The workfile is wherever the `workfile` setting says: ask the CLI rather than look.
	const tree = await cli(["read", "--json"], { quiet: true });
	state.workfile = tree.json !== undefined && tree.json.ok !== false;
	if (state.workfile) {
		const validation = await cli(["validate", "--json"], { quiet: true });
		state.tree = tree.json;
		state.nodes = state.tree?.children ?? [];
		state.errors = validation.json?.errors ?? [];
		state.warnings = validation.json?.warnings ?? [];
	} else {
		state.tree = null;
		state.nodes = [];
		state.errors = [];
		state.warnings = [];
	}
	if (state.selected !== null && !state.nodes.some(node => node.key === state.selected)) state.selected = null;
	state.detail_text = {};
	state.generation += 1;
	state.member_picked.clear();
	render();
}

async function load_devices() {
	if (state.devices !== null) return;
	const result = await cli(["list", "devices", "--json"], { quiet: true });
	state.devices = result.json?.devices ?? [];
}

async function load_configs() {
	const result = await cli(["config", "--json"], { quiet: true });
	state.configs = result.json?.configs ?? [];
}

// --- rendering -------------------------------------------------------------------------
function render() {
	// Another project's part took the page: a read still under way draws nothing.
	if (!main?.isConnected) return;
	const board = workfile_prop("board");
	let status = { text: "Valid", kind: "ok" };
	if (!state.workfile) status = { text: "no workfile", kind: "warn" };
	else if (state.errors.length > 0) status = { text: `${state.errors.length} error${state.errors.length === 1 ? "" : "s"}`, kind: "err" };
	else if (state.warnings.length > 0) status = { text: `Valid · ${state.warnings.length} warning${state.warnings.length === 1 ? "" : "s"}`, kind: "ok" };
	host.set_chips(board ? `⌂ ${board}` : (state.workfile ? "no board" : "no workfile"), status);
	$("count-nodes").textContent = state.nodes.length > 0 ? String(state.nodes.length) : "";
	for (const button of $("nav").querySelectorAll("button")) button.classList.toggle("active", button.dataset.view === state.view);

	const wide = state.view !== "workfile";
	$("list").style.display = wide ? "none" : "";
	$("content").className = `content${wide ? " wide" : ""}`;

	if (state.view === "workfile") render_workfile();
	else if (state.view === "settings") render_settings();
	else if (state.view === "build") render_build();
	else if (state.view === "graph") render_graph();
}

// --- helpers on the tree ---------------------------------------------------------------
const prop = (node, key) => node.properties.find(property => property.key === key);
/** The properties that describe the node (its schema, what the schema says it is) rather than configure it. */
const DESCRIBING = new Set(["$compatible", "$description"]);
const type_of = node => prop(node, "$compatible")?.value ?? "";
const node_names = () => new Set(state.nodes.map(node => node.key));
const errors_of = name => state.errors.filter(error => error.path?.[0] === name);
const workfile_prop = key => state.tree?.properties?.find(property => property.key === key)?.value;

/** Names a value refers to: a node name, or a union [member, name]. */
function references(value) {
	if (typeof value === "string") return [value];
	if (Array.isArray(value)) return value.filter(item => typeof item === "string");
	return [];
}

// --- rendering -------------------------------------------------------------------------
function no_workfile() {
	return `<div class="card empty">
		<h2>No workfile here yet</h2>
		<p>Create one for the configured target (<code>analog-attach init</code>), or open another folder above.</p>
		<div class="actions-row" style="justify-content:center">
			<button class="primary" data-act="init">Create Workfile</button>
			<button data-goto="settings">Check Settings</button>
		</div></div>`;
}

function render_workfile() {
	const list = $("list");
	const content = $("content");
	if (!state.workfile) {
		list.innerHTML = "";
		content.innerHTML = no_workfile();
		return;
	}
	const filter = state.filter.toLowerCase();
	const shown = state.nodes.filter(node => node.key.toLowerCase().includes(filter) || type_of(node).toLowerCase().includes(filter));
	// Redrawn, the list stays where it was scrolled to.
	const scrolled = list.querySelector(".items")?.scrollTop ?? 0;
	queueMicrotask(() => { const items = list.querySelector(".items"); if (items) items.scrollTop = scrolled; });
	if (state.linux_tree !== "off") {
		const flat = state.linux_tree === "flat";
		list.innerHTML = `
			<div class="tools"><input id="filter" placeholder="Filter nodes…" value="${esc(state.filter)}"></div>
			<div class="lx-section-title lx-tree-title"><span>${flat ? "Workfile nodes" : "Workfile tree"}</span>${flat ? "" : `<span class="lx-tag changed" title="Preferences > noos: experimental">Linux-style · nested</span>`}</div>
			<div class="items lx-tree lx-merged${flat ? " lx-flat" : ""}">${(flat ? linux_style_flat(filter) : linux_style_tree(filter)) || `<div class="empty">No nodes. <a href="#" data-act="open-add">Add a device</a></div>`}</div>`;
	} else list.innerHTML = `
		<div class="tools"><input id="filter" placeholder="Filter nodes…" value="${esc(state.filter)}"></div>
		<div class="items">${shown.map(node => {
			const count = errors_of(node.key).length;
			return `<div class="item${node.key === state.selected ? " active" : ""}" data-node="${esc(node.key)}">
				<div style="min-width:0"><div class="name">${esc(node.key)}</div><div class="type">${esc(type_of(node))}</div></div>
				${count > 0 ? `<span class="badge">${count}</span>` : ""}
			</div>`;
		}).join("") || `<div class="empty">No nodes. <a href="#" data-act="open-add">Add a device</a></div>`}</div>`;
	const filter_input = $("filter");
	filter_input.oninput = () => {
		state.filter = filter_input.value;
		const at = filter_input.selectionStart;
		render_workfile();
		$("filter").focus();
		$("filter").setSelectionRange(at, at);
	};

	const node = state.nodes.find(candidate => candidate.key === state.selected);
	if (node === undefined) {
		content.innerHTML = overview();
		return;
	}
	content.innerHTML = node_card(node);
	load_choices(node);
}

// --- references ------------------------------------------------------------------------
// The protocol says "string" for a reference too, so which fields are references, and what they
// can point at, is the CLI's to say: `read <node> <property>` gives the definition and the options.

/** The definitions whose value names another node (or a board/driver resource). */
const REFERENCES = new Set(["include", "driver_init_param", "driver_ops", "platform_ops", "platform_extra"]);

const choice_key = (node, property, member) => [node, property, ...(member ? [member] : [])].join(".");

/** The union member a field shows: the one just picked, else the stored one. */
function union_member(node, property) {
	const picked = state.member_picked.get(choice_key(node.key, property.key));
	return picked ?? (Array.isArray(property.value) ? property.value[0] : undefined);
}

/** Read the options of the node's reference fields, then draw them as dropdowns. */
async function load_choices(node) {
	const wanted = node.properties.flatMap(property => {
		if (property.key === "$compatible" || property.key === "$description") return [];
		if (property.type?.kind === "string") return [[property.key]];
		const member = property.type?.kind === "tuple" ? union_member(node, property) : undefined;
		return member ? [[property.key, member]] : [];
	}).filter(([property, member]) => {
		const key = choice_key(node.key, property, member);
		return (state.choices.get(key)?.generation ?? -1) < state.generation && !state.choices_loading.has(key);
	});
	if (wanted.length === 0) return;
	const generation = state.generation;
	await Promise.all(wanted.map(async ([property, member]) => {
		const key = choice_key(node.key, property, member);
		state.choices_loading.add(key);
		try {
			const result = member === undefined
				? await cli(["read", node.key, property, "--json"], { quiet: true })
				: await cli(["list", "value", node.key, property, member, "--json"], { quiet: true });
			state.choices.set(key, { options: member === undefined ? reference_options(result.json) : suggestion_options(result.json), generation });
		} finally {
			state.choices_loading.delete(key);
		}
	}));
	if (state.view !== "workfile" || state.selected !== node.key) return;
	// Not under the user's hands: a field being edited is drawn again once it is left.
	if ($("content")?.contains(document.activeElement)) state.redraw_on_leave = true;
	else render_workfile();
}

/** A property read: its options when it is a reference, null when it is free text. */
function reference_options(json) {
	if (json === undefined || !REFERENCES.has(json.definition)) return null;
	const options = (json.suggestions?.values ?? []).map(suggestion => ({ value: suggestion.value, label: suggestion.display_string ?? suggestion.value }));
	for (const schema of json.suggestions?.can_create ?? []) {
		if (!options.some(option => option.value === schema.value)) options.push({ value: schema.value, label: `＋ new ${schema.value}`, create: true });
	}
	return options;
}

/** `list value` for a union member: the nodes it can name, and the schemas it can create. */
function suggestion_options(json) {
	return (json?.suggestions ?? []).map(suggestion => {
		const create = / \(can create\)$/.test(suggestion.display_string ?? "");
		return { value: suggestion.value, label: create ? `＋ new ${suggestion.value}` : suggestion.display_string ?? suggestion.value, create };
	});
}

/** A dropdown of a reference's options; the current value stays listed even if it is not one. */
function reference_select(attrs, value, options, unset) {
	const listed = value && !options.some(option => option.value === value) ? [{ value, label: value }, ...options] : options;
	return `<select ${attrs}><option value=""${value ? "" : " selected"}${unset === "clear" ? "" : " disabled"}>— unset —</option>${listed.map(option =>
		`<option value="${esc(option.value)}"${option.create ? ` data-create="1"` : ""}${option.value === value ? " selected" : ""}>${esc(option.label)}</option>`).join("")}</select>`;
}

/**
 * A reference's value as picked: an existing node's name, or, for "＋ new <schema>", the name of
 * the node `add <schema>` just made (an `update` with the schema's name would store that name).
 */
async function picked_reference(field) {
	if (field.selectedOptions[0]?.dataset.create !== "1") return field.value;
	const added = await mutate(["add", field.value]);
	const name = added?.json?.ok === false ? undefined : added?.json?.path?.[0];
	if (name === undefined) render_workfile();
	return name;
}

/**
 * Experimental: the workfile's nodes as the Linux part's tree (its look: its stylesheet and
 * classes). A workfile has no parents, so the tree is what refers to what: an eval board opens to
 * its part, the part to its config and its bus. Roots are the nodes nothing refers to; a node met
 * again below itself is not opened twice. For a showcase; to be removed.
 */
function linux_style_tree(filter) {
	if (document.getElementById("lx-style") === null) document.head.insertAdjacentHTML("beforeend", `<link id="lx-style" rel="stylesheet" href="ecosystems/linux/linux.css">`);
	const by_name = new Map(state.nodes.map(node => [node.key, node]));
	const refers_to = node => [...new Set(node.properties.filter(property => !DESCRIBING.has(property.key))
		.flatMap(property => references(property.value)).filter(name => by_name.has(name) && name !== node.key))];
	const referred = new Set(state.nodes.flatMap(refers_to));
	const roots = state.nodes.filter(node => !referred.has(node.key));
	const matches = node => filter === "" || node.key.toLowerCase().includes(filter) || type_of(node).toLowerCase().includes(filter);
	const rows = (node, depth, path, trail) => {
		const below = refers_to(node).filter(name => !trail.has(name)).map(name => by_name.get(name));
		const inner = below.map(child => rows(child, depth + 1, `${path}/${child.key}`, new Set([...trail, child.key])));
		const shown = matches(node) || inner.some(row => row !== "");
		if (!shown) return "";
		const open = filter !== "" || !state.tree_closed.has(path);
		const errors = errors_of(node.key).length;
		return `<div class="item lx-m${node.key === state.selected ? " active" : ""}" data-node="${esc(node.key)}" style="padding-left:${4 + depth * 16}px">
			<button class="lx-twist" ${below.length > 0 ? `data-act="tree-toggle" data-path="${esc(path)}"` : "disabled"}>${below.length > 0 ? (open ? "▾" : "▸") : ""}</button>
			<span class="name"><span class="lx-node-name">${esc(node.key)}</span> <span class="lx-amp">${esc(type_of(node))}</span></span>
			${errors > 0 ? `<span class="badge">${errors}</span>` : ""}
		</div>${open ? inner.join("") : ""}`;
	};
	return (roots.length > 0 ? roots : state.nodes).map(node => rows(node, 0, node.key, new Set([node.key]))).join("");
}

/** Experimental: the workfile's nodes as the Linux part's tree rows, flat: every node at the top, in the workfile's order. */
function linux_style_flat(filter) {
	if (document.getElementById("lx-style") === null) document.head.insertAdjacentHTML("beforeend", `<link id="lx-style" rel="stylesheet" href="ecosystems/linux/linux.css">`);
	return state.nodes
		.filter(node => filter === "" || node.key.toLowerCase().includes(filter) || type_of(node).toLowerCase().includes(filter))
		.map(node => {
			const errors = errors_of(node.key).length;
			return `<div class="item lx-m${node.key === state.selected ? " active" : ""}" data-node="${esc(node.key)}" style="padding-left:12px">
				<span class="name"><span class="lx-node-name">${esc(node.key)}</span> <span class="lx-amp">${esc(type_of(node))}</span></span>
				${errors > 0 ? `<span class="badge">${errors}</span>` : ""}
			</div>`;
		}).join("");
}

function overview() {
	const errors = state.errors.map(error => `<tr class="error"><td class="key"><button class="link" data-node="${esc(error.path?.[0])}">${esc((error.path ?? []).join("."))}</button></td><td>${esc(error.message)}</td></tr>`).join("");
	const warnings = state.warnings.map(warning => `<tr><td class="key">${esc((warning.path ?? []).join("."))}</td><td>${esc(warning.message)}</td></tr>`).join("");
	return `<div class="card">
		<div class="title-row"><h2>Workfile</h2><span class="chip">${esc(workfile_prop("platform") ?? "?")}</span><span class="chip">${state.nodes.length} nodes</span></div>
		<p class="subtle">Pick a node on the left to edit it, or add a device. Bootstrap fills in whatever leaves no room for choice after each change; its report shows in the console.</p>
		<div class="actions-row"><button class="primary" data-act="open-add">＋ Add Device</button><button data-goto="graph">View Graph</button><button data-goto="build">Generate &amp; Build</button></div>
	</div>
	<div class="card"><h3>${state.errors.length === 0 ? "No errors" : `Errors (${state.errors.length})`}</h3>
		${state.errors.length === 0 ? `<p class="subtle">The workfile is valid.</p>` : `<table>${errors}</table>`}
		${warnings ? `<h3 style="margin-top:14px">Warnings</h3><table>${warnings}</table>` : ""}
	</div>`;
}

function node_card(node) {
	const names = node_names();
	const node_errors = errors_of(node.key);
	const referenced_by = state.nodes.filter(other => other.properties.some(property => references(property.value).includes(node.key))).map(other => other.key);
	const rows = node.properties.filter(property => property.key !== "$description").map(property => property_row(node, property, names, node_errors)).join("");
	const description = prop(node, "$description")?.value;
	const about = state.about_open.has(node.key);
	return `<div class="card">
		<div class="title-row">
			<h2 class="mono" style="font-size:17px">${esc(node.key)}</h2>
			<button class="ghost node-about${about ? " on" : ""}" title="${description ? "What its schema says it is" : "Its schema has no description"}" data-act="node-about" data-node="${esc(node.key)}"${description ? "" : " disabled"}>ⓘ</button>
			<span class="chip">${esc(type_of(node))}</span>
			${node_errors.length > 0 ? `<span class="chip err">${node_errors.length} error${node_errors.length === 1 ? "" : "s"}</span>` : `<span class="chip ok">Valid</span>`}
			<div class="card-actions">
				<button data-act="rename" data-node="${esc(node.key)}">Rename Node</button>
				<button class="danger" data-act="delete-node" data-node="${esc(node.key)}">Delete Node</button>
			</div>
		</div>
		${about && description ? `<div class="detail node-about-text">${esc(description)}</div>` : ""}
		<div class="subtle" style="font-size:12.5px">${referenced_by.length > 0 ? `Used by ${referenced_by.map(name => `<button class="link" data-node="${esc(name)}">${esc(name)}</button>`).join(" ")}` : "Not referenced by any node: a root"}</div>
	</div>
	<div class="card" style="padding:6px 10px">
		<table><thead><tr><th>Property</th><th>Type</th><th>Value</th><th></th></tr></thead><tbody>${rows}</tbody></table>
	</div>`;
}

function property_row(node, property, names, node_errors) {
	const id = `${node.key}.${property.key}`;
	const error = node_errors.find(candidate => candidate.path?.[1] === property.key);
	const readonly = property.key === "$compatible";
	const detail = state.details.has(id)
		? `<tr><td colspan="4"><div class="detail">${esc(state.detail_text[id] ?? "Loading…")}</div></td></tr>` : "";
	return `<tr class="${error ? "error" : ""}">
		<td class="key">${esc(property.key)}</td>
		<td class="kind">${esc(state.choices.get(choice_key(node.key, property.key))?.options ? "reference" : kind_label(property.type))}</td>
		<td class="edit">${readonly ? `<span class="mono">${esc(property.value)}</span>` : editor(node, property, names)}
			${error ? `<div class="message">${esc(error.message)}</div>` : ""}</td>
		<td class="actions">
			<button class="ghost" title="Details: description, who set it, constraints" data-act="details" data-node="${esc(node.key)}" data-prop="${esc(property.key)}">ⓘ</button>
			${readonly ? "" : `<button class="ghost" title="Clear (analog-attach delete node property)" data-act="clear" data-node="${esc(node.key)}" data-prop="${esc(property.key)}">✕</button>`}
		</td></tr>${detail}`;
}

function kind_label(type) {
	if (!type) return "";
	if (type.kind === "number") return type.subtype ?? "number";
	if (type.kind === "tuple") return "union";
	return type.kind;
}

function ref_link(value, names) {
	if (typeof value !== "string" || value === "") return "";
	if (names.has(value)) return `<button class="link" title="Open ${esc(value)}" data-node="${esc(value)}">→</button>`;
	if (/_handle$|^bsp_|_ops$/.test(value)) return `<span class="hidden-ref" title="A board or driver resource: not stored in the workfile">~ hidden</span>`;
	return "";
}

function editor(node, property, names) {
	const type = property.type ?? {};
	const value = property.value;
	const data = `data-node="${esc(node.key)}" data-prop="${esc(property.key)}"`;
	if (type.kind === "enum") {
		const options = (type.options ?? []).map(option => `<option value="${esc(option.value)}"${option.value === value ? " selected" : ""}>${esc(option.display_string ?? option.value)}</option>`).join("");
		return `<div class="editor"><select data-edit="enum" ${data}><option value=""${value == null ? " selected" : ""} disabled>— unset —</option>${options}</select></div>`;
	}
	if (type.kind === "bool") {
		return `<div class="editor"><label class="switch"><input type="checkbox" data-edit="bool" ${data}${value === true ? " checked" : ""}><span></span></label>
			${value == null ? `<span class="null">unset</span>` : ""}</div>`;
	}
	if (type.kind === "tuple") {
		const [member_type] = type.items ?? [];
		const [stored_member, stored_target] = Array.isArray(value) ? value : [undefined, undefined];
		const member = union_member(node, property);
		// A member just picked has no value yet: the dropdown asks for one.
		const target = member === stored_member ? stored_target : undefined;
		const members = (member_type?.options ?? []).map(option => `<option value="${esc(option.value)}"${option.value === member ? " selected" : ""}>${esc(option.display_string ?? option.value)}</option>`).join("");
		const choices = member ? state.choices.get(choice_key(node.key, property.key, member)) : undefined;
		const value_field = !member ? `<select disabled><option>— pick a member first —</option></select>`
			: choices === undefined ? `<select disabled><option>Loading…</option></select>`
				: reference_select(`data-edit="union-value" ${data} data-member="${esc(member)}"`, target, choices.options ?? [], "pick");
		return `<div class="editor">
			<select data-edit="member" ${data}><option value=""${member === undefined ? " selected" : ""} disabled>— member —</option>${members}</select>
			${value_field}
			${ref_link(target, names)}</div>`;
	}
	if (type.kind === "string") {
		const choices = state.choices.get(choice_key(node.key, property.key));
		if (choices === undefined) return `<div class="editor"><select disabled><option>${esc(value ?? "Loading…")}</option></select></div>`;
		if (choices.options !== null) {
			return `<div class="editor">${reference_select(`data-edit="reference" ${data}`, value, choices.options, "clear")}${ref_link(value, names)}</div>`;
		}
	}
	// Numbers stay text: the CLI takes hex (0x1D) and checks the value itself.
	return `<div class="editor">
		<input type="text"${type.kind === "number" ? ' inputmode="numeric"' : ""} data-edit="text" ${data} value="${esc(value ?? "")}" placeholder="${value === null ? "cleared" : "unset"}" list="dl-${esc(node.key)}-${esc(property.key)}" spellcheck="false">
		<datalist id="dl-${esc(node.key)}-${esc(property.key)}"></datalist>
		${ref_link(value, names)}</div>`;
}

/** Adding a device: a panel over the page (the core's), the catalog in it. */
let add_panel;
function open_add() {
	if (!state.workfile) {
		toast("Create the workfile first", true);
		return;
	}
	add_panel = open_panel({
		title: "Add a device",
		subtitle: "An eval board brings its part and its wiring; a driver adds the bare part; a schema adds one node.",
		wide: true,
		on_close: () => { add_panel = undefined; },
	});
	// The panel is outside this part's element: its clicks come through the same handler.
	add_panel.body.addEventListener("click", on_click);
	add_panel.body.addEventListener("keydown", event => {
		if (event.key === "Enter" && ["add-key", "add-name", "add-as"].includes(event.target.id)) add_panel.body.querySelector('[data-act="add-free"]').click();
	});
	render_add();
}

async function render_add() {
	if (add_panel === undefined) return;
	const content = add_panel.body;
	content.innerHTML = `<p class="subtle">Loading the catalog…</p>`;
	await load_devices();
	const groups = new Map();
	for (const device of state.devices) {
		if (!groups.has(device.tag)) groups.set(device.tag, []);
		groups.get(device.tag).push(device);
	}
	const filter = (state.add_filter ?? "").toLowerCase();
	content.innerHTML = `<div class="card">
		<div class="title-row"><input id="add-filter" placeholder="Filter the catalog…" value="${esc(state.add_filter ?? "")}" style="flex:1"></div>
		<p class="subtle"><b>Name</b> is optional; <b>as</b> picks the interface for a part with several (adc, dac, or adc,dac).</p>
		<div class="form-row"><input id="add-key" placeholder="Any key or schema, e.g. capi_dac_chan" spellcheck="false" style="flex:1;max-width:320px"><input id="add-name" placeholder="name (optional)" spellcheck="false" style="max-width:200px"><input id="add-as" placeholder="as (optional)" spellcheck="false" style="max-width:140px"><button class="primary" data-act="add-free">Add Device</button></div>
	</div>
	${[...groups].map(([tag, devices]) => {
		const shown = devices.filter(device => device.key.toLowerCase().includes(filter));
		if (shown.length === 0) return "";
		return `<div class="card"><h3 style="text-transform:capitalize">${esc(tag)} <span class="subtle">· ${shown.length}</span></h3><div class="devices">${shown.map(device => `
			<div class="device"><div class="k">${esc(device.key)}</div>
				<div class="row"><input placeholder="name" data-add-name="${esc(device.key)}" spellcheck="false"><input placeholder="as" data-add-as="${esc(device.key)}" spellcheck="false" style="max-width:70px"></div>
				<button class="secondary" data-act="add" data-key="${esc(device.key)}">＋ Add Device</button></div>`).join("")}</div></div>`;
	}).join("")}`;
	const filter_input = $("add-filter");
	filter_input.oninput = () => {
		state.add_filter = filter_input.value;
		const at = filter_input.selectionStart;
		render_add().then(() => {
			$("add-filter").focus();
			$("add-filter").setSelectionRange(at, at);
		});
	};
}

async function render_settings() {
	const content = $("content");
	content.innerHTML = `<div class="card"><p class="subtle">Loading settings…</p></div>`;
	await load_configs();
	const groups = new Map();
	for (const config of state.configs) {
		if (!groups.has(config.category)) groups.set(config.category, []);
		groups.get(config.category).push(config);
	}
	content.innerHTML = `<div class="card">
		<div class="title-row"><h2>Settings</h2><div class="spacer"></div>
			<label class="form-row subtle" title="Write to your user settings (~/.config/analog-attach) instead of this project's"><input type="checkbox" id="global"> save for all projects</label></div>
		<p class="subtle">The same as <code>analog-attach config</code>. <span class="req">*</span> required. <b>target</b> is a board (which brings its chip), or a chip used without a board. A list (<b>module-paths</b>) is its paths separated by spaces.</p>
	</div>
	${[...groups].map(([category, configs]) => `<div class="card" style="padding:10px 14px"><h3 style="text-transform:capitalize">${esc(category)}</h3><table>${configs.map(config => {
		const options = typeof config.type === "object" && Array.isArray(config.type?.options) ? config.type.options : null;
		const value = Array.isArray(config.value) ? config.value.join(" ") : config.value ?? "";
		const input = options
			? `<select data-setting="${esc(config.field_name)}"><option value="">— ${config.default ? `default (${esc(config.default)})` : "unset"} —</option>${options.map(option => {
				const v = typeof option === "string" ? option : option.value;
				return `<option value="${esc(v)}"${v === value ? " selected" : ""}>${esc(typeof option === "string" ? option : (option.display_string ?? option.value))}</option>`;
			}).join("")}</select>`
			: config.type === "path" || config.type === "path_list"
				? path_field(config.field_name, value, `data-setting="${esc(config.field_name)}"${config.type === "path_list" ? ` data-path-list="1"` : ""}`, { placeholder: config.type === "path_list" ? "paths, separated by spaces" : "a path; ~ for your home folder" })
				: `<input data-setting="${esc(config.field_name)}" value="${esc(value)}" placeholder="${esc(config.default ?? "unset")}" spellcheck="false">`;
		return `<tr class="setting-row"><td class="key">${esc(config.field_name)}${config.required ? ` <span class="req">*</span>` : ""}</td>
			<td class="edit"><div class="editor">${input}<button data-act="save-setting" data-key="${esc(config.field_name)}">Save Setting</button><button class="ghost" title="Reset to default" data-act="reset-setting" data-key="${esc(config.field_name)}">↺</button></div>
			<div class="subtle" style="font-size:12px;margin-top:3px">${esc(config.description)}</div></td></tr>`;
	}).join("")}</table></div>`).join("")}`;
}

/** A setting's value, as `config --json` gave it. */
const setting = key => state.configs?.find(config => config.field_name === key)?.value;
const dirname = file => file.replace(/\/[^/]*$/, "") || "/";
const absolute = (file, base) => /^(\/|~)/.test(file) ? file : `${base}/${file}`;

/**
 * The generated project's folder: where the last generate said it wrote (its message, the form
 * GENERATE-040 gives it), else where it will, as the CLI resolves it: project-path, else
 * out/<project-name> in the project folder, project-name defaulting to the workfile's folder's name.
 */
function project_dir() {
	if (state.files.generated) return state.files.generated;
	const root = state.project.dir;
	const configured = setting("project-path");
	if (configured) return absolute(configured, root);
	const workfile = absolute(setting("workfile") ?? "workfile.json", root);
	return `${root}/out/${setting("project-name") || dirname(workfile).split("/").pop()}`;
}

/** The build folder inside the project (build-dir): in the tree, shut until it is opened. */
const build_folder = dir => absolute(setting("build-dir") ?? "build", dir);

/** List a folder of the tree into the cache; with `open_below`, its folders too (not the build's), a few deep. */
async function load_folder(path, open_below = 0) {
	const listing = await list_folder(path);
	state.files.listings.set(path, listing);
	if (listing.error || open_below <= 0) return;
	state.files.open.add(path);
	const below = listing.entries.filter(entry => entry.dir).map(entry => `${listing.path}/${entry.name}`)
		.filter(folder => folder !== build_folder(project_dir()));
	await Promise.all(below.map(async folder => { state.files.open.add(folder); await load_folder(folder, open_below - 1); }));
}

/** Read the project's tree again, from the top; shows main.c first when nothing is shown. */
async function load_files() {
	const dir = project_dir();
	state.files.listings = new Map();
	state.files.open = new Set([dir]);
	await load_folder(dir, 3);
	const shown = state.files.shown?.path;
	const main_c = `${dir}/src/main.c`;
	if (shown === undefined || !shown.startsWith(dir)) {
		const has_main = state.files.listings.get(`${dir}/src`)?.entries?.some(entry => entry.name === "main.c");
		state.files.shown = null;
		if (has_main) await show_file(main_c);
	} else {
		await show_file(shown);
	}
}

async function show_file(path) {
	const response = await api(`/api/file?path=${encodeURIComponent(path)}`);
	state.files.shown = await response.json().catch(() => ({ path, error: "No answer" }));
	state.files.shown.path ??= path;
}

/** The tree's rows below `dir`: folders first, each a twisty; files to show. */
function file_rows(dir, depth) {
	const listing = state.files.listings.get(dir);
	if (listing === undefined) return `<div class="subtle file-row" style="padding-left:${8 + depth * 16}px">Reading…</div>`;
	if (listing.error) return `<div class="subtle file-row" style="padding-left:${8 + depth * 16}px">${esc(listing.error)}</div>`;
	return listing.entries.map(entry => {
		const path = `${listing.path}/${entry.name}`;
		const pad = `style="padding-left:${8 + depth * 16}px"`;
		if (!entry.dir) {
			return `<button class="file-row${state.files.shown?.path === path ? " on" : ""}" data-act="file-show" data-path="${esc(path)}" ${pad}><span class="file-glyph">·</span><span class="mono">${esc(entry.name)}</span></button>`;
		}
		const open = state.files.open.has(path);
		const build = path === build_folder(project_dir());
		return `<button class="file-row dir" data-act="file-dir" data-path="${esc(path)}" ${pad}><span class="file-glyph">${open ? "▾" : "▸"}</span><span class="mono">${esc(entry.name)}/</span>${build ? `<span class="subtle file-note">build output</span>` : ""}</button>
			${open ? file_rows(path, depth + 1) : ""}`;
	}).join("") || `<div class="subtle file-row" style="padding-left:${8 + depth * 16}px">empty</div>`;
}

/** The file shown beside the tree: its text, or why there is none. */
function file_preview() {
	const shown = state.files.shown;
	if (shown === null) return `<div class="file-preview-empty subtle">Pick a file to see it.</div>`;
	const name = shown.path.slice(project_dir().length + 1) || shown.path;
	const body = shown.error ? `<div class="file-preview-empty subtle">${esc(shown.error)}</div>`
		: shown.binary ? `<div class="file-preview-empty subtle">A binary file (${shown.size} bytes).</div>`
			: shown.too_big ? `<div class="file-preview-empty subtle">Too large to show here (${Math.round(shown.size / 1024)} KB).</div>`
				: `<pre class="file-text">${esc(shown.text)}</pre>`;
	return `<div class="file-preview-head"><span class="mono" title="${esc(shown.path)}">${esc(name)}</span><div class="spacer"></div>${shown.error ? "" : open_with_button(shown.path)}</div>${body}`;
}

function project_files_card() {
	const dir = project_dir();
	const root = state.files.listings.get(dir);
	const missing = root?.error !== undefined;
	return `<div class="card">
		<div class="title-row"><h3 style="margin:0">Project files</h3><span class="chip mono" title="${esc(dir)}">${esc(dir.replace(`${state.project.dir}/`, ""))}</span>
			<div class="spacer"></div>
			<button class="ghost" data-act="files-refresh" title="Read the folder again">↻</button>
			${missing ? "" : open_with_button(dir, { folder: true })}</div>
		${missing ? `<p class="subtle">Not generated yet: Generate Project writes the project here.</p>`
			: root === undefined ? `<p class="subtle">Reading the project…</p>`
				: `<div class="files"><div class="file-tree">${file_rows(dir, 0)}</div><div class="file-preview">${file_preview()}</div></div>`}
	</div>`;
}

async function render_build() {
	draw_build();
	if (state.configs === null) await load_configs();
	if (state.files.listings.get(project_dir()) === undefined) {
		await load_files();
	}
	if (state.view === "build") draw_build();
}

function draw_build() {
	$("content").innerHTML = `<div class="card">
		<h2>Generate &amp; build</h2>
		<p class="subtle">Generate writes the CAPI project from the workfile; build runs the platform toolchain; deploy flashes the board. Output streams into the console below.</p>
		<div class="actions-row">
			<button class="primary" data-act="generate">Generate Project</button>
			<button class="secondary" data-act="build">Build Project</button>
			<button data-act="build-clean">Clean Build</button>
			<button data-act="deploy">Deploy Firmware</button>
		</div>
	</div>
	${state.configs === null ? "" : project_files_card()}
	<div class="card"><h3>Typical flow</h3>
		<ol class="subtle" style="margin:0;padding-left:18px;line-height:1.9">
			<li>Settings: capi, module repositories, target (the board)</li>
			<li>Create the workfile, then add an eval board (e.g. <code>eval-adxl355-pmdz</code>)</li>
			<li>Fix anything the status chip flags, in the Workfile view</li>
			<li>Generate → Build → Deploy, and open the board's serial console</li>
		</ol></div>`;
}

let mermaid;
async function render_graph() {
	const content = $("content");
	if (!state.workfile) {
		content.innerHTML = no_workfile();
		return;
	}
	content.innerHTML = `<div class="card"><div class="title-row"><h2>Graph</h2><span class="subtle">references between nodes · click a node to edit it</span></div><div id="graph">Rendering…</div></div>`;
	mermaid ??= (await import("https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs")).default;
	const dark = is_dark();
	mermaid.initialize({ startOnLoad: false, securityLevel: "loose", theme: dark ? "dark" : "default", flowchart: { htmlLabels: true } });
	const id_of = new Map(state.nodes.map((node, index) => [node.key, `n${index}`]));
	const hidden = new Map();
	const lines = ["flowchart LR"];
	for (const node of state.nodes) {
		const bad = errors_of(node.key).length > 0;
		lines.push(`  ${id_of.get(node.key)}["<b>${esc(node.key)}</b><br><small>${esc(type_of(node))}</small>"]${bad ? ":::bad" : ""}`);
	}
	for (const node of state.nodes) {
		for (const property of node.properties) {
			if (DESCRIBING.has(property.key)) continue;
			for (const target of references(property.value)) {
				let to = id_of.get(target);
				if (to === undefined && /_handle$|^bsp_|_ops$/.test(target)) {
					if (!hidden.has(target)) {
						hidden.set(target, `h${hidden.size}`);
						lines.push(`  ${hidden.get(target)}(["~ ${esc(target)}"]):::hid`);
					}
					to = hidden.get(target);
				}
				if (to !== undefined) lines.push(`  ${id_of.get(node.key)} -->|${esc(property.key)}| ${to}`);
			}
		}
	}
	for (const [name, id] of id_of) lines.push(`  click ${id} call aaSelect("${name}")`);
	lines.push("  classDef bad stroke:#dc2626,stroke-width:2px", "  classDef hid stroke-dasharray:4 3,opacity:.8");
	try {
		const { svg, bindFunctions } = await mermaid.render(`g${Date.now()}`, lines.join("\n"));
		$("graph").innerHTML = svg;
		bindFunctions?.($("graph"));
	} catch (error) {
		$("graph").textContent = `Could not render: ${error.message ?? error}`;
	}
}
window.aaSelect = name => {
	state.view = "workfile";
	state.selected = name;
	render();
};

// --- events ----------------------------------------------------------------------------
// Every listener is on this part's element: the core and other parts have their own.
/** Every click of this part, in its element and in its add panel. */
async function on_click(event) {
	// A click into an editor is for editing: the `change` handler below acts on it. Treating
	// it as "open this node" re-rendered the panel and threw the field away mid-click.
	if (event.target.closest("input, select, textarea, .switch")) return;
	const target = event.target.closest("[data-act], [data-node], [data-goto], nav button");
	if (!target) return;

	if (target.matches("nav button[data-view]")) {
		state.view = target.dataset.view;
		render();
		return;
	}
	if (target.dataset.goto) {
		event.preventDefault();
		state.view = target.dataset.goto;
		render();
		return;
	}
	const act = target.dataset.act;
	const node = target.dataset.node;
	const property = target.dataset.prop;
	if (!act && node) {
		state.view = "workfile";
		state.selected = node;
		render();
		return;
	}

	switch (act) {
		case "open-add":
			event.preventDefault();
			open_add();
			break;
		case "tree-toggle": {
			const path = target.dataset.path;
			if (state.tree_closed.has(path)) state.tree_closed.delete(path);
			else state.tree_closed.add(path);
			render();
			break;
		}
		case "init":
			await mutate(["init"]);
			break;
		case "rename": {
			open_dialog({
				title: "Rename node",
				subtitle: "References to it follow the new name.",
				body: `<label class="field"><span>Name</span><input id="rename-name" value="${esc(node)}" spellcheck="false"><span class="hint">Letters, digits and _</span></label>`,
				action: "Rename Node",
				on_action: async body => {
					const to = body.querySelector("#rename-name").value.trim();
					if (to === "") return "Give the node a name";
					if (to === node) return true;
					const result = await mutate(["rename", node, to]);
					if (result?.code !== 0 || result?.json?.ok === false) return first_line(result?.json?.message ?? result?.stderr ?? "Not renamed");
					state.selected = to;
					render();
					return true;
				},
			});
			break;
		}
		case "delete-node": {
			const used = state.nodes.some(other => other.properties.some(p => references(p.value).includes(node)));
			if (await ask({ title: "Delete node", text: `<code>${esc(node)}</code> leaves the workfile.${used ? " Other nodes reference it: their references are cleared." : ""}`, action: "Delete Node", danger: true })) {
				await mutate(["delete", node, ...(used ? ["--force"] : [])]);
			}
			break;
		}
		case "clear":
			await mutate(["delete", node, property]);
			break;
		case "node-about":
			if (!state.about_open.delete(node)) state.about_open.add(node);
			render();
			break;
		case "details": {
			const id = `${node}.${property}`;
			if (state.details.has(id)) {
				state.details.delete(id);
			} else {
				state.details.add(id);
				render();
				const result = await cli(["read", node, property], { quiet: true });
				state.detail_text[id] = (result.stdout || result.stderr).trim();
			}
			render();
			break;
		}
		case "add": {
			const key = target.dataset.key;
			const name = document.querySelector(`[data-add-name="${CSS.escape(key)}"]`)?.value.trim();
			const as = document.querySelector(`[data-add-as="${CSS.escape(key)}"]`)?.value.trim();
			const result = await mutate(["add", key, ...(name ? ["--name", name] : []), ...(as ? ["--as", as] : [])]);
			if (result?.code === 0 && result.json?.ok !== false) add_panel?.close();
			break;
		}
		case "add-free": {
			const key = $("add-key").value.trim();
			if (!key) return;
			const name = $("add-name").value.trim();
			const as = $("add-as").value.trim();
			const result = await mutate(["add", key, ...(name ? ["--name", name] : []), ...(as ? ["--as", as] : [])]);
			if (result?.code === 0 && result.json?.ok !== false) add_panel?.close();
			break;
		}
		case "save-setting": {
			const key = target.dataset.key;
			const input = document.querySelector(`[data-setting="${CSS.escape(key)}"]`);
			const value = input.value.trim();
			const scope = $("global")?.checked ? ["--global"] : [];
			const config = state.configs?.find(candidate => candidate.field_name === key);
			// A list setting takes each path as its own word.
			const values = config?.type === "path_list" ? value.split(/\s+/).filter(word => word !== "") : [value];
			await cli(value === "" ? ["config", key, "--reset", ...scope] : ["config", key, ...values, ...scope]);
			state.devices = null;
			// A setting can be the backend itself: the core reads the project again, and swaps parts.
			await host.reload_project();
			break;
		}
		case "reset-setting": {
			const scope = $("global")?.checked ? ["--global"] : [];
			await cli(["config", target.dataset.key, "--reset", ...scope]);
			state.devices = null;
			// A setting can be the backend itself: the core reads the project again, and swaps parts.
			await host.reload_project();
			break;
		}
		case "generate": {
			const result = await cli(["generate", "--json"]);
			// Where it wrote, from its message (GENERATE-040): what the tree shows.
			const wrote = /^Generated '.+' in (\/.*) \(board: /.exec(result.json?.message ?? "")?.[1];
			if (wrote) state.files.generated = wrote;
			await load_files();
			if (state.view === "build") draw_build();
			break;
		}
		case "build":
			await stream(["build"]);
			await refresh_files();
			break;
		case "build-clean":
			await stream(["build", "--clean"]);
			await refresh_files();
			break;
		case "files-refresh":
			await refresh_files();
			break;
		case "file-dir": {
			const path = target.dataset.path;
			if (state.files.open.delete(path)) {
				draw_build();
				break;
			}
			state.files.open.add(path);
			if (!state.files.listings.has(path)) await load_folder(path);
			draw_build();
			break;
		}
		case "file-show":
			await show_file(target.dataset.path);
			draw_build();
			break;
		case "deploy":
			await stream(["deploy"]);
			break;
	}
}

/** Read the project's files again, keeping the folders open and the file shown. */
async function refresh_files() {
	const open = new Set(state.files.open);
	state.files.listings = new Map();
	await Promise.all([...open].map(path => load_folder(path)));
	state.files.open = open;
	if (state.files.shown) await show_file(state.files.shown.path);
	if (state.view === "build") draw_build();
}

function bind_events() {
	main.addEventListener("click", on_click);
	attach_open_with(main);
	// The path settings: suggestions as typed, Browse…; a pick for a list adds it to the list.
	attach_paths(main, {
		on_pick: (field, path) => {
			field.value = field.dataset.pathList ? [field.value.trim(), path].filter(Boolean).join(" ") : path;
			field.focus();
		},
	});

	// Editing a value: an `update` per change.
	main.addEventListener("change", async event => {
		const field = event.target;
		const kind = field.dataset?.edit;
		if (!kind) return;
		const { node, prop: property } = field.dataset;
		if (kind === "enum") await mutate(["update", node, property, field.value]);
		else if (kind === "bool") await mutate(["update", node, property, field.checked ? "true" : "false"]);
		else if (kind === "reference" && field.value !== "") {
			const target = await picked_reference(field);
			if (target !== undefined) await mutate(["update", node, property, target]);
		} else if (kind === "text" || kind === "reference") {
			if (field.value.trim() === "") await mutate(["delete", node, property]);
			else await mutate(["update", node, property, field.value.trim()]);
		} else if (kind === "member") {
			// Its value comes next, from the nodes that member can name.
			state.member_picked.set(choice_key(node, property), field.value);
			field.blur();
			render_workfile();
		} else if (kind === "union-value") {
			const member = field.dataset.member;
			if (!member || field.value === "") return;
			const target = await picked_reference(field);
			if (target !== undefined) await mutate(["update", node, property, member, target]);
		}
	});

	// Suggestions from the CLI, the first time a field gets focus.
	async function fill_suggestions(field) {
		const list = field.list;
		if (!list) return;
		const { node, prop: property } = field.dataset;
		const args = ["list", "value", node, property, "--json"];
		const result = await cli(args, { quiet: true });
		const suggestions = result.json?.suggestions ?? [];
		list.innerHTML = suggestions.map(suggestion => `<option value="${esc(suggestion.value)}">${esc(suggestion.display_string ?? "")}</option>`).join("");
	}
	main.addEventListener("focusin", event => {
		const field = event.target;
		if (field.dataset?.edit === "text") {
			if (!field.dataset.suggested) {
				field.dataset.suggested = "1";
				fill_suggestions(field);
			}
		}
	});
	main.addEventListener("focusout", () => setTimeout(() => {
		if (state.redraw_on_leave && !$("content")?.contains(document.activeElement)) {
			state.redraw_on_leave = false;
			if (state.view === "workfile") render_workfile();
		}
	}));
	main.addEventListener("keydown", event => {
		if (event.key === "Enter" && event.target.matches?.('input[data-edit="text"]')) event.target.blur();
	});
}
