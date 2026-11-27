// The project setup: the CLI's guided setup (`analog-attach` alone on a terminal) as steps.
//
//   1. The ecosystem (`backend`), among the parts in ../ecosystems/ the CLI lets a project pick
//      (`config`'s options for it).
//   2. The settings that ecosystem's part asks for (its `setup.keys`), each from `config <key>
//      --json`: a choice among its options, or a path with what the CLI found for it. The part
//      may add to a step (SETUP_HOOKS): its own description, more help, more found values, a
//      list to pick from, a value for an empty field, a way out of a refusal, what it says while
//      a setting is saved.
//   3. Last, its optional settings (`setup.optional`), with their values and defaults; Open
//      Project saves them, creates the workfile (`analog-attach init`) where there is none yet,
//      and the core opens the ecosystem's part, which needs one. A part with its own ways to
//      start a workfile (`setup.start`: linux, create or import an overlay) has its buttons there
//      in Open Project's place while there is none.
//
// Every step saves with `analog-attach config`, so the CLI checks the value; a refusal shows in
// the step. The core runs it once, for a folder with no project settings; the header's Setup
// runs it again. A part changes one setting the same way, its step in a panel (open_setting).

import { api, cli, esc, info_button, info_text, open_panel } from "./ui.mjs";
import { attach_paths, path_field } from "./paths.mjs";

const STEP_TITLES = { backend: "Ecosystem", optional: "More settings" };

// What an ecosystem's `setup` may add to the step of a setting, each by the setting's key:
//   description: { key: text }, in place of the CLI's description
//   help:    { key: html }, under the setting's description
//   found:   { key: async helpers => [{ value, display_string? }] }, beside what the CLI found
//   choices: { key: async helpers => [{ value, label, detail?, note? }] }, a list to filter (by
//            label and detail) and pick from
//   empty:   { key: helpers => value }, saved when the field is left empty
//   refused: { key: async (value, problem, helpers) => ({ text, value }) }, a fix offered
//   saving:  { key: text }, what the step says while the setting is saved (one that takes long)
// and to its optional settings (More settings, unless `titles.optional` names the step), with `description` too:
//   names:   { key: placeholder }, a path given as a file name in the project folder
//   about:   { key: html }, in place of the description (one with code, laid out); "", none (no (i))
// and to the last step, while the project has no workfile yet:
//   start:   { actions: [{ id, label, primary?, saving?, run: async helpers => result }] },
//            buttons in Open Project's place: each saves the optional settings, then `run` makes
//            the workfile; `result` is { ok: true }, { ok: false, problem }, or undefined (cancelled)
// `helpers`: { api, cli, dir } (the server's API, the CLI, the project folder).

/** How many of a step's choices show at once: the filter finds the others. */
const MOST_CHOICES = 60;

/** The buttons of a setting's step that save it: a value picked, the field, a list of paths. */
const SAVES = new Set(["setup-save", "setup-save-input", "setup-save-list"]);

/**
 * A setting's step: what `config <key> --json` says of it, with what the CLI found for it, the
 * part's additions (`hooks`: its `setup`), and the field to give it. `cache` keeps the part's
 * list (`choices`) by key; `filter` is what is typed in the filter of a choice with many options.
 * `save`: whether the field has its Save Setting (the setup's Next Step saves it instead).
 */
async function setting_body(key, { hooks, helpers, cache, filter = "", save = true }) {
	const result = await cli(["config", key, "--json"], { quiet: true });
	const entry = result.json?.configs?.[0];
	if (entry === undefined) return `<div class="problem">${esc(result.stderr || result.stdout)}</div>`;
	const about = `<p class="subtle">${esc(hooks.description?.[key] ?? entry.description)}${entry.required ? "" : " (optional)"}</p>${hooks.help?.[key] ? `<div class="setup-help">${hooks.help[key]}</div>` : ""}`;
	const value = entry.value;
	if (typeof entry.type === "object") {
		const options = entry.type.options;
		const many = options.length > 8;
		return `${about}${many ? `<div class="field-row"><input id="setup-filter" placeholder="Filter…" value="${esc(filter)}" spellcheck="false"></div>` : ""}
			<div class="choices">${options.filter(option => !many || option.includes(filter)).map(option => `<button class="choice${option === value ? " picked" : ""}" data-act="setup-save" data-key="${esc(key)}" data-value="${esc(option)}"><span class="k">${esc(option)}</span></button>`).join("")}</div>`;
	}
	const more = hooks.found?.[key] ? await hooks.found[key](helpers).catch(() => []) : [];
	const found = [...(entry.suggestions ?? []), ...more.filter(extra => !(entry.suggestions ?? []).some(suggestion => suggestion.value === extra.value))];
	if (entry.type === "path_list") {
		const chosen = new Set(Array.isArray(value) ? value : []);
		const others = (Array.isArray(value) ? value : []).filter(item => !found.some(suggestion => suggestion.value === item));
		const list = found.length > 0
			? `<p>Found:</p><div class="found">${found.map(suggestion => `<label><input type="checkbox" data-found="${esc(suggestion.value)}"${chosen.size === 0 || chosen.has(suggestion.value) ? " checked" : ""}>${esc(suggestion.value)} <span class="about">${esc(suggestion.display_string ?? "")}</span></label>`).join("")}</div>`
			: `<p class="subtle">Nothing found: give the paths.</p>`;
		return `${about}${list}
			<div class="field-row"><span class="path-field" data-path-key="${esc(key)}"><textarea id="setup-more" rows="2" placeholder="Other paths, one per line" spellcheck="false">${esc(others.join("\n"))}</textarea><button type="button" class="secondary" data-path-browse title="Pick a folder to add">Browse…</button></span></div>
			${save ? `<button class="primary" data-act="setup-save-list" data-key="${esc(key)}">Save Setting</button>` : ""}`;
	}
	const list = found.length > 0
		? `<p>Found:</p><div class="found">${found.map(suggestion => `<label><button class="link" data-act="setup-save" data-key="${esc(key)}" data-value="${esc(suggestion.value)}">${esc(suggestion.value)}</button> <span class="about">${esc(suggestion.display_string ?? "")}</span></label>`).join("")}</div>`
		: "";
	const hint = entry.type === "string" && key === "target" ? `<p class="subtle">No board or chip is known yet: the earlier steps (the sources) bring them.</p>` : "";
	return `${about}${list}${hint}${await choices_body(key, value, { hooks, helpers, cache })}
		<div class="field-row">${entry.type === "path"
			? path_field(key, typeof value === "string" ? value : "", `id="setup-value"`)
			: `<input id="setup-value" value="${esc(typeof value === "string" ? value : "")}" spellcheck="false">`}
			${save ? `<button class="primary" data-act="setup-save-input" data-key="${esc(key)}">Save Setting</button>` : ""}</div>`;
}

/**
 * The part's list for a setting (the base devicetrees): a filter, then the first of those it
 * matches, each saved by a click. All are drawn; the filter hides, so typing reads nothing.
 */
async function choices_body(key, value, { hooks, helpers, cache }) {
	const load = hooks.choices?.[key];
	if (load === undefined) return "";
	cache[key] ??= await load(helpers).catch(() => []);
	const choices = cache[key];
	if (choices.length === 0) return "";
	return `<div class="field-row"><input id="setup-choices-filter" placeholder="Filter: a board, a chip, a file name…" spellcheck="false" autocomplete="off"></div>
		<div class="choices setup-choices">${choices.map((choice, at) => `<button class="choice${choice.value === value ? " picked" : ""}" data-act="setup-save" data-key="${esc(key)}" data-value="${esc(choice.value)}" data-match="${esc(`${choice.label} ${choice.detail ?? ""}`.toLowerCase())}"${at >= MOST_CHOICES ? " hidden" : ""}>
			<span class="k mono">${esc(choice.label)}</span>${choice.detail || choice.note ? `<span class="subtle">${esc([choice.detail, choice.note].filter(Boolean).join(" · "))}</span>` : ""}</button>`).join("")}</div>
		<p class="subtle">Pick custom path:</p>`;
}

/** Show the choices in `root` the filter matches, the first MOST_CHOICES of them. */
function filter_choices(root, text) {
	const words = text.toLowerCase().split(/\s+/).filter(Boolean);
	let shown = 0;
	for (const button of root.querySelectorAll(".setup-choices [data-match]")) {
		const match = words.every(word => button.dataset.match.includes(word));
		button.hidden = !match || shown >= MOST_CHOICES;
		if (!button.hidden) shown++;
	}
}

/** Why the setting was refused, with the part's way out (a value to Use) when it has one. */
function problem_html(key, problem, fix) {
	if (!problem) return "";
	return `<div class="problem">${esc(problem)}${fix ? `<div class="actions-row" style="margin-top:6px"><span>${esc(fix.text)}</span><button class="primary" data-act="setup-save" data-key="${esc(key)}" data-value="${esc(fix.value)}">Use It</button></div>` : ""}</div>`;
}

/** The file name of a path setting's value ("" for none). */
function file_name(value) {
	return typeof value === "string" ? value.split("/").at(-1) : "";
}

/**
 * What a saving button of a setting's step (SAVES) saves, from `root`: `{ values }`, or
 * `{ problem }` when there is nothing to save yet.
 */
function picked_values({ act, key, value }, root, hooks, helpers) {
	if (act === "setup-save") return { values: [value] };
	if (act === "setup-save-input") {
		const value = root.querySelector("#setup-value").value.trim() || (hooks.empty?.[key]?.(helpers) ?? "");
		return value === "" ? { problem: "Give a path first: type it, pick one of those found, or Browse…." } : { values: [value] };
	}
	const picked = [...root.querySelectorAll("[data-found]")].filter(box => box.checked).map(box => box.dataset.found);
	const more = root.querySelector("#setup-more").value.split("\n").map(line => line.trim()).filter(line => line !== "");
	const values = [...picked, ...more];
	return values.length === 0 ? { problem: "Pick at least one, or give a path." } : { values };
}

/**
 * Save a setting with `config`: `{ ok: true }`, or `{ ok: false, problem, fix }`: what the CLI
 * said, and the part's way out of it (`refused`), if any.
 */
async function save_setting(key, values, hooks, helpers) {
	const result = await cli(["config", key, ...values, "--json"]);
	if (result.code === 0 && result.json?.ok !== false) return { ok: true };
	const problem = result.json?.message ?? (result.stderr || result.stdout || result.error || "").trim();
	const refused = hooks.refused?.[key];
	const fix = refused && values.length === 1 ? await refused(values[0], problem, helpers).catch(() => null) ?? null : null;
	return { ok: false, problem, fix };
}

/** While a setting is saved: `box` says so (`text`, after its title if it has one), its buttons off. */
function show_saving(box, text) {
	box.querySelector(".problem")?.remove();
	const title = box.querySelector("h3");
	(title ?? box).insertAdjacentHTML(title ? "afterend" : "afterbegin", `<div class="setup-saving"><span class="spinner"></span>${esc(text)}</div>`);
	for (const button of box.querySelectorAll("button")) button.disabled = true;
}

/** A path picked with Browse…: the field's value, or a line more in a list's (module-paths). */
function pick_path(field, path) {
	if (field.tagName === "TEXTAREA") field.value = [...field.value.split("\n").filter(line => line.trim() !== ""), path].join("\n");
	else field.value = path;
	field.focus();
}

/**
 * One setting's step, in a panel over the part (the Linux base devicetree, from the header's
 * chip): the same help, found values, list and field as in the setup, saved the same way.
 * `ecosystem` is the part's `setup`, `dir` the project's folder, `title` the panel's (else from the
 * step's title); once `config` has taken a value the panel closes and `saved()` runs (the part
 * reads the project again). `closed()` runs whenever the panel closes, saved or not, before
 * `saved()` (linux: back to the Project tab it was opened from).
 */
export function open_setting({ key, ecosystem, dir, title, saved, closed }) {
	const hooks = ecosystem ?? {};
	const helpers = { api, cli, dir };
	const view = { problem: "", fix: null, filter: "", cache: {} };
	const panel = open_panel({
		title: title ?? `Change the ${(hooks.titles?.[key] ?? key).toLowerCase()}`,
		wide: true,
		on_close: closed,
	});
	const root = panel.body;
	root.innerHTML = `<p class="subtle">Reading the setting…</p>`;

	async function render() {
		const body = await setting_body(key, { hooks, helpers, cache: view.cache, filter: view.filter });
		root.innerHTML = `${problem_html(key, view.problem, view.fix)}${body}`;
	}

	attach_paths(root, { on_pick: pick_path });
	root.addEventListener("click", async event => {
		const target = event.target.closest("[data-act]");
		if (!target || !SAVES.has(target.dataset.act)) return;
		const picked = picked_values(target.dataset, root, hooks, helpers);
		if (picked.problem) {
			view.problem = picked.problem;
			view.fix = null;
			await render();
			return;
		}
		show_saving(root, hooks.saving?.[key] ?? "Saving…");
		const result = await save_setting(key, picked.values, hooks, helpers);
		if (result.ok) {
			panel.close();
			await saved?.();
			return;
		}
		view.problem = result.problem;
		view.fix = result.fix;
		await render();
	});
	root.addEventListener("input", event => {
		if (event.target.id === "setup-choices-filter") filter_choices(root, event.target.value);
		if (event.target.id !== "setup-filter") return;
		view.filter = event.target.value;
		const at = event.target.selectionStart;
		render().then(() => {
			const field = root.querySelector("#setup-filter");
			field?.focus();
			field?.setSelectionRange(at, at);
		});
	});
	return render().then(() => root.querySelector("#setup-choices-filter")?.focus());
}

/**
 * Draw the setup in `context.root`. `context`: `ecosystems` ({ id: { title, about, setup } }),
 * `project()` and `missing()` (the core's, read again by `reload()`), `reload()`, `workfile()`
 * (whether the workfile is there), `finish()`.
 */
export function run_setup(context) {
	const state = { step: null, problem: "", fix: null, filter: "", configs: [], choices: {}, starts: undefined, workfile: false };
	const root = context.root;
	const hooks = () => context.ecosystems[context.project()?.backend]?.setup ?? {};
	const helpers = () => ({ api, cli, dir: context.project()?.dir ?? "" });

	/** The steps for the project as it is now: [{ id, title, done }]. */
	function steps() {
		const backend = context.project()?.backend;
		const ecosystem = context.ecosystems[backend];
		const configs = new Map(state.configs.map(config => [config.field_name, config]));
		const set = key => {
			const value = configs.get(key)?.value;
			return value !== null && value !== undefined && !(Array.isArray(value) && value.length === 0);
		};
		const list = [{ id: "backend", title: STEP_TITLES.backend, done: Boolean(ecosystem) }];
		if (ecosystem) {
			for (const key of ecosystem.setup.keys) {
				list.push({ id: key, title: ecosystem.setup.titles?.[key] ?? key, done: set(key) && !context.missing().includes(key) });
			}
			// A part that starts the workfile here (`start`): the step is done once it is there.
			list.push({ id: "optional", title: ecosystem.setup.titles?.optional ?? STEP_TITLES.optional, done: ecosystem.setup.start !== undefined && state.workfile });
		}
		return list;
	}

	async function render() {
		root.innerHTML = `<div class="card"><p class="subtle">Reading the project's settings…</p></div>`;
		const configs = await cli(["config", "--json"], { quiet: true });
		state.configs = configs.json?.configs ?? [];
		state.workfile = await context.workfile();
		const list = steps();
		if (state.step === null || !list.some(step => step.id === state.step)) state.step = (list.find(step => !step.done) ?? list.at(-1)).id;
		const index = list.findIndex(step => step.id === state.step);
		// The last step's buttons: the part's starts while there is no workfile, else Open Project.
		state.starts = state.step === "optional" && hooks().start !== undefined && !state.workfile ? hooks().start : undefined;
		const body = await step_body(state.step);
		const open = state.starts
			? state.starts.actions.map(start => `<button${start.primary ? ` class="primary"` : ""} data-act="setup-open" data-start="${esc(start.id)}">${esc(start.label)}</button>`).join("")
			: `<button class="primary" data-act="setup-open">Open Project</button>`;
		const setting = !["backend", "optional"].includes(state.step);
		root.innerHTML = `<div class="card">
			<div class="title-row"><h2>Project setup</h2></div>
		</div>
		<div class="wizard">
			<div class="card steps">${list.map((step, at) => `<button class="${step.id === state.step ? "current" : ""} ${step.done ? "done" : ""}" data-act="setup-step" data-step="${esc(step.id)}">
				<span class="mark">${step.done ? "✓" : at + 1}</span>${esc(step.title)}</button>`).join("")}</div>
			<div class="card">
				<h3>${index + 1}. ${esc(list[index].title)}</h3>
				${problem_html(state.step, state.problem, state.fix)}
				${body}
				<div class="actions-row" style="margin-top:14px">
					${index > 0 ? `<button data-act="setup-back">Go Back</button>` : ""}
					${index < list.length - 1 && (list[index].done || setting) ? `<button${setting ? ` class="primary"` : ""} data-act="setup-next">Next Step</button>` : ""}
					${state.step === "optional" ? open : ""}
				</div>
			</div>
		</div>`;
	}

	/** The current step's content. */
	async function step_body(step) {
		if (step === "backend") {
			const current = context.project()?.backend;
			// The parts of the backends the CLI lets a project pick (config's options for `backend`).
			const options = state.configs.find(config => config.field_name === "backend")?.type?.options;
			const offered = Object.entries(context.ecosystems).filter(([id]) => !Array.isArray(options) || options.includes(id));
			return `<p class="subtle">What does this project target?</p>
				<div class="choices">${offered.map(([id, ecosystem]) => `<button class="choice${id === current ? " picked" : ""}" data-act="setup-save" data-key="backend" data-value="${esc(id)}">
					<span class="k">${esc(ecosystem.title)}</span><span class="subtle">${esc(ecosystem.about)}</span></button>`).join("")}</div>`;
		}
		if (step === "optional") return optional_body();
		// A setting: what config says of it, with what the CLI found for it.
		return setting_body(step, { hooks: hooks(), helpers: helpers(), cache: state.choices, filter: state.filter, save: false });
	}

	/** The optional settings, on one step: each with its current value, saved together. */
	function optional_body() {
		const { optional: keys = [], names = {}, description = {}, about = {} } = hooks();
		const configs = state.configs.filter(config => keys.includes(config.field_name));
		return `<table class="optional">${configs.map(config => {
				const name = names[config.field_name];
				const value = name === undefined ? config.value ?? "" : file_name(config.value);
				const input = typeof config.type === "object"
					? `<select data-optional="${esc(config.field_name)}">${config.type.options.map(option => `<option${option === value ? " selected" : ""}>${esc(option)}</option>`).join("")}</select>`
					: `<input data-optional="${esc(config.field_name)}" value="${esc(value)}" placeholder="${esc(name ?? config.default ?? "unset")}" spellcheck="false">`;
				const text = about[config.field_name] ?? esc(description[config.field_name] ?? config.description);
				return `<tr data-info><td class="key">${esc(config.field_name)}${text ? info_button(config.field_name) : ""}</td><td class="edit"><div class="editor">${input}</div>${text ? info_text(text, "subtle setup-about") : ""}</td></tr>`;
			}).join("")}</table>`;
	}

	/** While a setting is saved: the step says so (the part's words for a long one), its buttons off. */
	function saving(key, text = hooks().saving?.[key] ?? "Saving…") {
		const step = root.querySelector(".wizard > .card:last-child");
		if (step !== null) show_saving(step, text);
	}

	/** Save a setting; on a refusal stay on the step and show why, else go on (to `next`, or the first step not done). */
	async function save(key, values, next = null) {
		saving(key);
		const result = await save_setting(key, values, hooks(), helpers());
		if (!result.ok) {
			state.problem = result.problem;
			state.fix = result.fix;
			await render();
			return;
		}
		state.problem = "";
		state.fix = null;
		if (key === "linux") state.choices = {};
		state.step = next;
		await context.reload();
		await render();
	}

	/** What the field of a setting's step saves as (picked_values): a path or text, a list, or null for none. */
	function field_act(step) {
		if (["backend", "optional"].includes(step)) return null;
		if (root.querySelector("#setup-value")) return "setup-save-input";
		if (root.querySelector("#setup-more")) return "setup-save-list";
		return null;
	}

	/** Whether `values` are what `key` holds already (so Next Step needn't save it, or build caches again). */
	function same_values(key, values) {
		const value = state.configs.find(config => config.field_name === key)?.value;
		const held = Array.isArray(value) ? value : (value === null || value === undefined ? [] : [value]);
		return held.length === values.length && held.every((item, at) => item === values[at]);
	}

	// The path fields: suggestions as typed, Browse…; a pick for a list (module-paths) adds a line.
	if (root.dataset.paths !== "1") {
		root.dataset.paths = "1";
		attach_paths(root, { on_pick: pick_path });
	}

	root.onclick = async event => {
		const target = event.target.closest("[data-act]");
		if (!target) return;
		const act = target.dataset.act;
		if (act === "setup-step") {
			state.step = target.dataset.step;
			state.problem = "";
			state.fix = null;
			await render();
		} else if (act === "setup-back" || act === "setup-next") {
			const list = steps();
			const index = list.findIndex(step => step.id === state.step);
			const at = index + (act === "setup-next" ? 1 : -1);
			const next = list[Math.max(0, Math.min(at, list.length - 1))].id;
			// Next Step on a setting's step saves its field first, when it holds something new.
			const field = act === "setup-next" ? field_act(state.step) : null;
			if (field !== null) {
				const picked = picked_values({ act: field, key: state.step }, root, hooks(), helpers());
				if (picked.problem !== undefined && !list[index].done) {
					state.problem = picked.problem;
					await render();
					return;
				}
				if (picked.problem === undefined && !same_values(state.step, picked.values)) {
					await save(state.step, picked.values, next);
					return;
				}
			} else if (act === "setup-next" && !list[index].done) {
				state.problem = "Pick one first.";
				await render();
				return;
			}
			state.step = next;
			state.problem = "";
			state.fix = null;
			await render();
		} else if (SAVES.has(act)) {
			const picked = picked_values(target.dataset, root, hooks(), helpers());
			if (picked.problem === undefined) await save(target.dataset.key, picked.values);
			else {
				state.problem = picked.problem;
				await render();
			}
		} else if (act === "setup-open") {
			// The steps before first: the project needs their settings.
			const left = steps().filter(step => !step.done && step.id !== "optional");
			if (left.length > 0) {
				state.problem = `Set ${left.map(step => step.title).join(", ")} first.`;
				await render();
				return;
			}
			saving("optional");
			for (const field of root.querySelectorAll("[data-optional]")) {
				const key = field.dataset.optional;
				const config = state.configs.find(candidate => candidate.field_name === key);
				const value = field.value.trim();
				// A name (the part's `names`) is the project folder's file: config takes it relative to there.
				if (value === (hooks().names?.[key] === undefined ? config?.value ?? "" : file_name(config?.value))) continue;
				const result = await cli(value === "" ? ["config", key, "--reset", "--json"] : ["config", key, value, "--json"]);
				if (result.code !== 0 || result.json?.ok === false) {
					state.problem = `${key}: ${result.json?.message ?? (result.stderr || result.stdout).trim()}`;
					await render();
					return;
				}
			}
			// Then the workfile, where there is none yet, and the project.
			await context.reload();
			const start = state.starts?.actions.find(candidate => candidate.id === target.dataset.start);
			if (start !== undefined) {
				// The settings saved: the step as they are now, while the part's start runs.
				state.problem = "";
				await render();
				if (start.saving) {
					saving(start.id, start.saving);
				}
				const result = await start.run(helpers());
				if (result === undefined || !result.ok) {
					state.problem = result?.problem ?? "";
					await render();
					return;
				}
			} else if (!await context.workfile()) {
				const result = await cli(["init"]);
				if (result.code !== 0) {
					state.problem = (result.stderr || result.stdout).trim().split("\n")[0];
					await render();
					return;
				}
			}
			state.problem = "";
			await context.finish();
		}
	};
	// The filter of a long choice (the boards): re-render as the user types, keeping the cursor.
	root.oninput = event => {
		if (event.target.id === "setup-choices-filter") {
			filter_choices(root, event.target.value);
			return;
		}
		if (event.target.id !== "setup-filter") return;
		state.filter = event.target.value;
		const at = event.target.selectionStart;
		render().then(() => {
			const field = root.querySelector("#setup-filter");
			field?.focus();
			field?.setSelectionRange(at, at);
		});
	};
	return render();
}
