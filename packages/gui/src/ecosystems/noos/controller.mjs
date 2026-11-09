// The noos (CAPI) part of the GUI: the workfile, adding devices, the graph, generate & build,
// and the settings. The core (../../core/app.mjs) mounts it on a project whose backend is noos,
// after the project setup; every action is an `analog-attach` command (../../core/ui.mjs).
// See ../README.md for what a part of an ecosystem is given and gives back.

import { $, cli, esc, first_line, log, stream, toast } from "../../core/ui.mjs";
import { mount_chat } from "./chat.mjs";

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
	detail_text: {},
	busy: false,
};

const LAYOUT = `
	<nav id="nav">
		<div class="section">Design</div>
		<button data-view="workfile" class="active">Workfile <span class="count" id="count-nodes"></span></button>
		<button data-view="add">Add devices</button>
		<button data-view="graph">Graph</button>
		<div class="section">Project</div>
		<button data-view="build">Generate &amp; build</button>
		<button data-view="settings">Settings</button>
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
	mount_chat({
		main,
		button_area: context.console_actions,
		// What Claude is told of the page: a noos project, and what the user is looking at.
		context: () => [
			"This is a noos (CAPI) project: follow the analog-attach-noos skill.",
			state.selected ? `The user has the node ${state.selected} open in the GUI.` : "",
		].join(" "),
		changed: () => {
			state.devices = null;
			return refresh();
		},
		cli,
	});
	// The graph follows the theme.
	window.addEventListener("aa-theme", () => { if (state.view === "graph") render_graph(); });
	await refresh();
	return {
		refresh: () => {
			state.devices = null;
			return refresh();
		},
	};
}

// --- the CLI ---------------------------------------------------------------------------
const board_pin = at => `${at.connector} pin ${at.pin}${at.chip_pin ? ` (${at.chip_pin})` : ""}`;

/** The wiring and what is left, from an add or update result: the console's lines. */
function report_lines(json) {
	const lines = [];
	for (const bus of json.wiring ?? []) {
		lines.push(`Wire ${bus.part} to the board over ${bus.interface.toUpperCase()}${bus.peripheral ? ` (${bus.peripheral})` : ""}:`);
		for (const connection of bus.connections) {
			lines.push(`  ${`${connection.from.connector} pin ${connection.from.pin} (${connection.role})`.padEnd(24)} -> ${board_pin(connection.to)}`);
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
	const board = workfile_prop("board");
	let status = { text: "✓ valid", kind: "ok" };
	if (!state.workfile) status = { text: "no workfile", kind: "warn" };
	else if (state.errors.length > 0) status = { text: `✗ ${state.errors.length} error${state.errors.length === 1 ? "" : "s"}`, kind: "err" };
	else if (state.warnings.length > 0) status = { text: `✓ valid · ${state.warnings.length} warning(s)`, kind: "ok" };
	host.set_chips(board ? `⌂ ${board}` : (state.workfile ? "no board" : "no workfile"), status);
	$("count-nodes").textContent = state.nodes.length > 0 ? String(state.nodes.length) : "";
	for (const button of $("nav").querySelectorAll("button")) button.classList.toggle("active", button.dataset.view === state.view);

	const wide = state.view !== "workfile";
	$("list").style.display = wide ? "none" : "";
	$("content").className = `content${wide ? " wide" : ""}`;

	if (state.view === "workfile") render_workfile();
	else if (state.view === "add") render_add();
	else if (state.view === "settings") render_settings();
	else if (state.view === "build") render_build();
	else if (state.view === "graph") render_graph();
}

// --- helpers on the tree ---------------------------------------------------------------
const prop = (node, key) => node.properties.find(property => property.key === key);
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
			<button class="primary" data-act="init">Create workfile</button>
			<button data-goto="settings">Check settings</button>
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
	list.innerHTML = `
		<div class="tools"><input id="filter" placeholder="Filter nodes…" value="${esc(state.filter)}"></div>
		<div class="items">${shown.map(node => {
			const count = errors_of(node.key).length;
			return `<div class="item${node.key === state.selected ? " active" : ""}" data-node="${esc(node.key)}">
				<div style="min-width:0"><div class="name">${esc(node.key)}</div><div class="type">${esc(type_of(node))}</div></div>
				${count > 0 ? `<span class="badge">${count}</span>` : ""}
			</div>`;
		}).join("") || `<div class="empty">No nodes. <a href="#" data-goto="add">Add a device</a></div>`}</div>`;
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
}

function overview() {
	const errors = state.errors.map(error => `<tr class="error"><td class="key"><button class="link" data-node="${esc(error.path?.[0])}">${esc((error.path ?? []).join("."))}</button></td><td>${esc(error.message)}</td></tr>`).join("");
	const warnings = state.warnings.map(warning => `<tr><td class="key">${esc((warning.path ?? []).join("."))}</td><td>${esc(warning.message)}</td></tr>`).join("");
	return `<div class="card">
		<div class="title-row"><h2>Workfile</h2><span class="chip">${esc(workfile_prop("platform") ?? "?")}</span><span class="chip">${state.nodes.length} nodes</span></div>
		<p class="subtle">Pick a node on the left to edit it, or add a device. Bootstrap fills in whatever leaves no room for choice after each change; its report shows in the console.</p>
		<div class="actions-row"><button class="primary" data-goto="add">＋ Add device</button><button data-goto="graph">View graph</button><button data-goto="build">Generate &amp; build</button></div>
	</div>
	<div class="card"><h3>${state.errors.length === 0 ? "✓ No errors" : `Errors (${state.errors.length})`}</h3>
		${state.errors.length === 0 ? `<p class="subtle">The workfile is valid.</p>` : `<table>${errors}</table>`}
		${warnings ? `<h3 style="margin-top:14px">Warnings</h3><table>${warnings}</table>` : ""}
	</div>`;
}

function node_card(node) {
	const names = node_names();
	const node_errors = errors_of(node.key);
	const referenced_by = state.nodes.filter(other => other.properties.some(property => references(property.value).includes(node.key))).map(other => other.key);
	const rows = node.properties.map(property => property_row(node, property, names, node_errors)).join("");
	return `<div class="card">
		<div class="title-row">
			<h2 class="mono" style="font-size:17px">${esc(node.key)}</h2>
			<span class="chip">${esc(type_of(node))}</span>
			${node_errors.length > 0 ? `<span class="chip err">${node_errors.length} error${node_errors.length === 1 ? "" : "s"}</span>` : `<span class="chip ok">✓</span>`}
			<div class="spacer"></div>
			<button data-act="rename" data-node="${esc(node.key)}">Rename</button>
			<button class="danger" data-act="delete-node" data-node="${esc(node.key)}">Delete</button>
		</div>
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
		<td class="kind">${esc(kind_label(property.type))}</td>
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
		const [member, target] = Array.isArray(value) ? value : [undefined, undefined];
		const members = (member_type?.options ?? []).map(option => `<option value="${esc(option.value)}"${option.value === member ? " selected" : ""}>${esc(option.display_string ?? option.value)}</option>`).join("");
		return `<div class="editor">
			<select data-edit="member" ${data}><option value=""${member === undefined ? " selected" : ""} disabled>— member —</option>${members}</select>
			<input data-edit="union-value" ${data} data-member="${esc(member ?? "")}" value="${esc(target ?? "")}" placeholder="node" list="dl-${esc(node.key)}-${esc(property.key)}" spellcheck="false">
			<datalist id="dl-${esc(node.key)}-${esc(property.key)}"></datalist>
			${ref_link(target, names)}</div>`;
	}
	// Numbers stay text: the CLI takes hex (0x1D) and checks the value itself.
	return `<div class="editor">
		<input type="text"${type.kind === "number" ? ' inputmode="numeric"' : ""} data-edit="text" ${data} value="${esc(value ?? "")}" placeholder="${value === null ? "cleared" : "unset"}" list="dl-${esc(node.key)}-${esc(property.key)}" spellcheck="false">
		<datalist id="dl-${esc(node.key)}-${esc(property.key)}"></datalist>
		${ref_link(value, names)}</div>`;
}

async function render_add() {
	const content = $("content");
	if (!state.workfile) {
		content.innerHTML = no_workfile();
		return;
	}
	content.innerHTML = `<div class="card"><p class="subtle">Loading the catalog…</p></div>`;
	await load_devices();
	const groups = new Map();
	for (const device of state.devices) {
		if (!groups.has(device.tag)) groups.set(device.tag, []);
		groups.get(device.tag).push(device);
	}
	const filter = (state.add_filter ?? "").toLowerCase();
	content.innerHTML = `<div class="card">
		<div class="title-row"><h2>Add devices</h2><div class="spacer"></div><input id="add-filter" placeholder="Filter…" value="${esc(state.add_filter ?? "")}" style="max-width:260px"></div>
		<p class="subtle">An eval board brings its part and its wiring; a driver adds the bare part; a schema adds one node. <b>Name</b> is optional; <b>as</b> picks the interface for a part with several (adc, dac, or adc,dac).</p>
		<div class="form-row"><input id="add-key" placeholder="Any key or schema, e.g. capi_dac_chan" spellcheck="false" style="flex:1;max-width:320px"><input id="add-name" placeholder="name (optional)" spellcheck="false" style="max-width:200px"><input id="add-as" placeholder="as (optional)" spellcheck="false" style="max-width:140px"><button class="primary" data-act="add-free">Add</button></div>
	</div>
	${[...groups].map(([tag, devices]) => {
		const shown = devices.filter(device => device.key.toLowerCase().includes(filter));
		if (shown.length === 0) return "";
		return `<div class="card"><h3 style="text-transform:capitalize">${esc(tag)} <span class="subtle">· ${shown.length}</span></h3><div class="devices">${shown.map(device => `
			<div class="device"><div class="k">${esc(device.key)}</div>
				<div class="row"><input placeholder="name" data-add-name="${esc(device.key)}" spellcheck="false"><input placeholder="as" data-add-as="${esc(device.key)}" spellcheck="false" style="max-width:70px"></div>
				<button data-act="add" data-key="${esc(device.key)}">＋ Add</button></div>`).join("")}</div></div>`;
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
			: `<input data-setting="${esc(config.field_name)}" value="${esc(value)}" placeholder="${esc(config.default ?? "unset")}" spellcheck="false">`;
		return `<tr class="setting-row"><td class="key">${esc(config.field_name)}${config.required ? ` <span class="req">*</span>` : ""}</td>
			<td class="edit"><div class="editor">${input}<button data-act="save-setting" data-key="${esc(config.field_name)}">Save</button><button class="ghost" title="Reset to default" data-act="reset-setting" data-key="${esc(config.field_name)}">↺</button></div>
			<div class="subtle" style="font-size:12px;margin-top:3px">${esc(config.description)}</div></td></tr>`;
	}).join("")}</table></div>`).join("")}`;
}

function render_build() {
	$("content").innerHTML = `<div class="card">
		<h2>Generate &amp; build</h2>
		<p class="subtle">Generate writes the CAPI project from the workfile; build runs the platform toolchain; deploy flashes the board. Output streams into the console below.</p>
		<div class="actions-row">
			<button class="primary" data-act="generate">⚙ Generate</button>
			<button data-act="build">▶ Build</button>
			<button data-act="build-clean">Clean build</button>
			<button data-act="deploy">⚡ Deploy</button>
		</div>
	</div>
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
	const dark = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim().startsWith("#0");
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
			if (property.key === "$compatible") continue;
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
function bind_events() {
	main.addEventListener("click", async event => {
		// A click into an editor is for editing: the `change` handler below acts on it. Treating
		// it as "open this node" re-rendered the panel and threw the field away mid-click.
		if (event.target.closest("input, select, textarea, .switch")) return;
		const target = event.target.closest("[data-act], [data-node], [data-goto], nav button");
		if (!target) return;

		if (target.matches("nav button")) {
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
		case "init":
			await mutate(["init"]);
			break;
		case "rename": {
			const to = prompt(`Rename ${node} to:`, node);
			if (to && to !== node) {
				const result = await mutate(["rename", node, to]);
				if (result?.code === 0) state.selected = to;
				render();
			}
			break;
		}
		case "delete-node": {
			const used = state.nodes.some(other => other.properties.some(p => references(p.value).includes(node)));
			if (confirm(`Delete ${node}?${used ? "\n\nOther nodes reference it: their references are cleared (--force)." : ""}`)) {
				await mutate(["delete", node, ...(used ? ["--force"] : [])]);
			}
			break;
		}
		case "clear":
			await mutate(["delete", node, property]);
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
			await mutate(["add", key, ...(name ? ["--name", name] : []), ...(as ? ["--as", as] : [])]);
			break;
		}
		case "add-free": {
			const key = $("add-key").value.trim();
			if (!key) return;
			const name = $("add-name").value.trim();
			const as = $("add-as").value.trim();
			await mutate(["add", key, ...(name ? ["--name", name] : []), ...(as ? ["--as", as] : [])]);
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
		case "generate":
			await cli(["generate"]);
			break;
		case "build":
			await stream(["build"]);
			break;
		case "build-clean":
			await stream(["build", "--clean"]);
			break;
		case "deploy":
			await stream(["deploy"]);
			break;
		}
	});


	// Editing a value: an `update` per change.
	main.addEventListener("change", async event => {
		const field = event.target;
		const kind = field.dataset?.edit;
		if (!kind) return;
		const { node, prop: property } = field.dataset;
		if (kind === "enum") await mutate(["update", node, property, field.value]);
		else if (kind === "bool") await mutate(["update", node, property, field.checked ? "true" : "false"]);
		else if (kind === "text") {
			if (field.value.trim() === "") await mutate(["delete", node, property]);
			else await mutate(["update", node, property, field.value.trim()]);
		} else if (kind === "member") {
			const value_input = field.parentElement.querySelector('[data-edit="union-value"]');
			value_input.dataset.member = field.value;
			value_input.value = "";
			value_input.focus();
			fill_suggestions(value_input);
		} else if (kind === "union-value") {
			const member = field.dataset.member;
			if (member && field.value.trim() !== "") await mutate(["update", node, property, member, field.value.trim()]);
		}
	});

	// Suggestions from the CLI, the first time a field gets focus.
	async function fill_suggestions(field) {
		const list = field.list;
		if (!list) return;
		const { node, prop: property, member } = field.dataset;
		const args = ["list", "value", node, property, ...(member ? [member] : []), "--json"];
		const result = await cli(args, { quiet: true });
		const suggestions = result.json?.suggestions ?? [];
		list.innerHTML = suggestions.map(suggestion => `<option value="${esc(suggestion.value)}">${esc(suggestion.display_string ?? "")}</option>`).join("");
	}
	main.addEventListener("focusin", event => {
		const field = event.target;
		if (field.dataset?.edit === "text" || field.dataset?.edit === "union-value") {
			if (!field.dataset.suggested || field.dataset.edit === "union-value") {
				field.dataset.suggested = "1";
				fill_suggestions(field);
			}
		}
	});
	main.addEventListener("keydown", event => {
		if (event.key === "Enter" && event.target.matches?.('input[data-edit="text"], input[data-edit="union-value"]')) event.target.blur();
		if (event.key === "Enter" && ["add-key", "add-name", "add-as"].includes(event.target.id)) document.querySelector('[data-act="add-free"]').click();
	});
}
