// The project setup: the CLI's guided setup (`analog-attach` alone on a terminal) as steps.
//
//   1. The ecosystem (`backend`), among the parts in ../ecosystems/.
//   2. The settings that ecosystem's part asks for (its `setup.keys`), each from `config <key>
//      --json`: a choice among its options, or a path with what the CLI found for it.
//   3. Its optional settings (`setup.optional`), with their values and defaults.
//   4. Done: the core opens the ecosystem's part.
//
// Every step saves with `analog-attach config`, so the CLI checks the value; a refusal shows in
// the step. The core runs it once, for a folder with no project settings; the header's Setup
// runs it again.

import { cli, esc } from "./ui.mjs";

const STEP_TITLES = { backend: "Ecosystem", optional: "More settings", done: "Done" };

/**
 * Draw the setup in `context.root`. `context`: `ecosystems` ({ id: { title, about, setup } }),
 * `project()` and `missing()` (the core's, read again by `reload()`), `reload()`, `finish()`.
 */
export function run_setup(context) {
	const state = { step: null, problem: "", optional_seen: false, filter: "", configs: [] };
	const root = context.root;

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
			list.push({ id: "optional", title: STEP_TITLES.optional, done: state.optional_seen });
			list.push({ id: "done", title: STEP_TITLES.done, done: false });
		}
		return list;
	}

	async function render() {
		root.innerHTML = `<div class="card"><p class="subtle">Reading the project's settings…</p></div>`;
		const configs = await cli(["config", "--json"], { quiet: true });
		state.configs = configs.json?.configs ?? [];
		const list = steps();
		if (state.step === null || !list.some(step => step.id === state.step)) state.step = (list.find(step => !step.done) ?? list.at(-1)).id;
		const index = list.findIndex(step => step.id === state.step);
		const body = await step_body(state.step);
		root.innerHTML = `<div class="card">
			<div class="title-row"><h2>Project setup</h2><span class="chip mono">${esc(context.project()?.dir ?? "")}</span></div>
			<p class="subtle">The same as <code>analog-attach</code> alone on a terminal: each step saves a setting with <code>analog-attach config</code>, in this project's <code>.analog-attach/config.json</code>.</p>
		</div>
		<div class="wizard">
			<div class="card steps">${list.map((step, at) => `<button class="${step.id === state.step ? "current" : ""} ${step.done ? "done" : ""}" data-act="setup-step" data-step="${esc(step.id)}">
				<span class="mark">${step.done ? "✓" : at + 1}</span>${esc(step.title)}</button>`).join("")}</div>
			<div class="card">
				<h3>${index + 1}. ${esc(list[index].title)}</h3>
				${state.problem ? `<div class="problem">${esc(state.problem)}</div>` : ""}
				${body}
				<div class="actions-row" style="margin-top:14px">
					${index > 0 ? `<button data-act="setup-back">← Back</button>` : ""}
					${index < list.length - 1 && list[index].done ? `<button data-act="setup-next">Next →</button>` : ""}
				</div>
			</div>
		</div>`;
	}

	/** The current step's content. */
	async function step_body(step) {
		if (step === "backend") {
			const current = context.project()?.backend;
			return `<p class="subtle">What does this project target? It is saved as the <code>backend</code> setting.</p>
				<div class="choices">${Object.entries(context.ecosystems).map(([id, ecosystem]) => `<button class="choice${id === current ? " picked" : ""}" data-act="setup-save" data-key="backend" data-value="${esc(id)}">
					<span class="k">${esc(ecosystem.title)}</span><span class="subtle">${esc(ecosystem.about)}</span></button>`).join("")}</div>`;
		}
		if (step === "optional") return optional_body();
		if (step === "done") {
			const ecosystem = context.ecosystems[context.project()?.backend];
			return `<p>The project is set up. You can come back here any time with <b>Setup</b> in the header.</p>
				<button class="primary" data-act="setup-finish">Open the ${esc(ecosystem?.title ?? "")} project</button>`;
		}
		// A setting: what config says of it, with what the CLI found for it.
		const result = await cli(["config", step, "--json"], { quiet: true });
		const entry = result.json?.configs?.[0];
		if (entry === undefined) return `<div class="problem">${esc(result.stderr || result.stdout)}</div>`;
		const about = `<p class="subtle">${esc(entry.description)}${entry.required ? "" : " (optional)"}</p>`;
		const value = entry.value;
		if (typeof entry.type === "object") {
			const options = entry.type.options;
			const many = options.length > 8;
			return `${about}${many ? `<div class="field-row"><input id="setup-filter" placeholder="Filter…" value="${esc(state.filter)}" spellcheck="false"></div>` : ""}
				<div class="choices">${options.filter(option => !many || option.includes(state.filter)).map(option => `<button class="choice${option === value ? " picked" : ""}" data-act="setup-save" data-key="${esc(step)}" data-value="${esc(option)}"><span class="k">${esc(option)}</span></button>`).join("")}</div>`;
		}
		const found = entry.suggestions ?? [];
		if (entry.type === "path_list") {
			const chosen = new Set(Array.isArray(value) ? value : []);
			const others = (Array.isArray(value) ? value : []).filter(item => !found.some(suggestion => suggestion.value === item));
			const list = found.length > 0
				? `<p>Found:</p><div class="found">${found.map(suggestion => `<label><input type="checkbox" data-found="${esc(suggestion.value)}"${chosen.size === 0 || chosen.has(suggestion.value) ? " checked" : ""}>${esc(suggestion.value)} <span class="about">${esc(suggestion.display_string ?? "")}</span></label>`).join("")}</div>`
				: `<p class="subtle">Nothing found: give the paths.</p>`;
			return `${about}${list}
				<div class="field-row"><textarea id="setup-more" rows="2" placeholder="Other paths, one per line" spellcheck="false">${esc(others.join("\n"))}</textarea></div>
				<button class="primary" data-act="setup-save-list" data-key="${esc(step)}">Save</button>`;
		}
		const list = found.length > 0
			? `<p>Found:</p><div class="found">${found.map(suggestion => `<label><button class="link" data-act="setup-save" data-key="${esc(step)}" data-value="${esc(suggestion.value)}">${esc(suggestion.value)}</button> <span class="about">${esc(suggestion.display_string ?? "")}</span></label>`).join("")}</div>`
			: "";
		const hint = entry.type === "string" && step === "target" ? `<p class="subtle">No board or chip is known yet: the earlier steps (the sources) bring them.</p>` : "";
		return `${about}${list}${hint}
			<div class="field-row"><input id="setup-value" value="${esc(typeof value === "string" ? value : "")}" placeholder="${entry.type === "path" ? "a path; ~ for your home folder" : ""}" spellcheck="false">
				<button class="primary" data-act="setup-save-input" data-key="${esc(step)}">Save</button></div>`;
	}

	/** The optional settings, on one step: each with its current value, saved together. */
	function optional_body() {
		const keys = context.ecosystems[context.project()?.backend]?.setup.optional ?? [];
		const configs = state.configs.filter(config => keys.includes(config.field_name));
		return `<p class="subtle">These have defaults; change any you like, or go on.</p>
			<table class="optional">${configs.map(config => {
				const value = config.value ?? "";
				const input = typeof config.type === "object"
					? `<select data-optional="${esc(config.field_name)}">${config.type.options.map(option => `<option${option === value ? " selected" : ""}>${esc(option)}</option>`).join("")}</select>`
					: `<input data-optional="${esc(config.field_name)}" value="${esc(value)}" placeholder="${esc(config.default ?? "unset")}" spellcheck="false">`;
				return `<tr><td class="key">${esc(config.field_name)}</td><td class="edit"><div class="editor">${input}</div><div class="subtle" style="font-size:12px;margin-top:3px">${esc(config.description)}</div></td></tr>`;
			}).join("")}</table>
			<div class="actions-row" style="margin-top:10px"><button class="primary" data-act="setup-save-optional">Save and go on</button><button data-act="setup-skip-optional">Keep the defaults</button></div>`;
	}

	/** Save a setting; on a refusal stay on the step and show why, else go on. */
	async function save(key, values) {
		const result = await cli(["config", key, ...values, "--json"]);
		if (result.code !== 0 || result.json?.ok === false) {
			state.problem = result.json?.message ?? (result.stderr || result.stdout || result.error || "").trim();
			await render();
			return;
		}
		state.problem = "";
		state.step = null;
		await context.reload();
		await render();
	}

	root.onclick = async event => {
		const target = event.target.closest("[data-act]");
		if (!target) return;
		const act = target.dataset.act;
		if (act === "setup-step") {
			state.step = target.dataset.step;
			state.problem = "";
			await render();
		} else if (act === "setup-back" || act === "setup-next") {
			const list = steps();
			const at = list.findIndex(step => step.id === state.step) + (act === "setup-next" ? 1 : -1);
			state.step = list[Math.max(0, Math.min(at, list.length - 1))].id;
			state.problem = "";
			await render();
		} else if (act === "setup-save") {
			await save(target.dataset.key, [target.dataset.value]);
		} else if (act === "setup-save-input") {
			const value = root.querySelector("#setup-value").value.trim();
			if (value !== "") await save(target.dataset.key, [value]);
		} else if (act === "setup-save-list") {
			const picked = [...root.querySelectorAll("[data-found]")].filter(box => box.checked).map(box => box.dataset.found);
			const more = root.querySelector("#setup-more").value.split("\n").map(line => line.trim()).filter(line => line !== "");
			const values = [...picked, ...more];
			if (values.length === 0) {
				state.problem = "Pick at least one, or give a path.";
				await render();
				return;
			}
			await save(target.dataset.key, values);
		} else if (act === "setup-save-optional") {
			for (const field of root.querySelectorAll("[data-optional]")) {
				const key = field.dataset.optional;
				const config = state.configs.find(candidate => candidate.field_name === key);
				const value = field.value.trim();
				if (value === (config?.value ?? "")) continue;
				const result = await cli(value === "" ? ["config", key, "--reset", "--json"] : ["config", key, value, "--json"]);
				if (result.code !== 0 || result.json?.ok === false) {
					state.problem = `${key}: ${result.json?.message ?? (result.stderr || result.stdout).trim()}`;
					await render();
					return;
				}
			}
			state.optional_seen = true;
			state.problem = "";
			state.step = null;
			await render();
		} else if (act === "setup-skip-optional") {
			state.optional_seen = true;
			state.step = null;
			await render();
		} else if (act === "setup-finish") {
			await context.finish();
		}
	};
	// The filter of a long choice (the boards): re-render as the user types, keeping the cursor.
	root.oninput = event => {
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
