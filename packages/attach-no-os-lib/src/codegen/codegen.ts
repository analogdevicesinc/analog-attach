import fs from "node:fs";
import path from "node:path";

import { error, ok } from "../ruleset_parser/result";
import { make_environment } from "./eta_environment";
import { load_devices } from "./device_loader";
import { get_connected_symbols, reorder_symbols_topologically } from "../validator/connection_graph";
import { effective_value, is_descriptor_reference, is_null_pointer, number_literal, property_default, reference_expression } from "./codegen_helpers";
import { STRUCTURE_FILENAME, resolve_template_set } from "./template_sets";
import { schedule_patches } from "./patch_schedule";

import type { Eta } from "eta";
import type { CodegenInput, CodegenResult } from "./types";
import type { Result } from "../ruleset_parser/result";
import type { FileSpec } from "./types";

// Helpers injected into every template under `it.h` — the Eta replacement for the
// custom nunjucks filters that used to live on the environment. Templates call them
// as functions (`it.h.tab_indent(x)`) instead of piping (`x | tab_indent`).
const template_helpers = {
	// Was the `reverse` filter. Teardown runs in reverse init order; main_c.eta
	// calls this instead of the `| reverse` filter.
	// eslint-disable-next-line unicorn/no-array-reverse
	reverse: <T>(array: T[]): T[] => [...array].reverse(),

	// Was the `tab_indent` filter. Indent every non-empty line of a (possibly
	// multi-line) block by one tab; empty lines are left bare to avoid trailing
	// whitespace. Device init/remove templates emit full statement blocks and the
	// main_c.eta loop only indents the first line, so the rest is re-indented here.
	tab_indent: (text: unknown): string =>
		String(text)
			.split("\n")
			.map(line => (line.length > 0 ? "\t" + line : line))
			.join("\n"),

	// The device init/remove blocks, in init order. The sole filesystem-touching
	// helper: it reads the schemas repo. Templates that need device headers pass
	// `devices(wf).map(d => d.header)` into the pure `_helpers.eta` collectors.
	devices: load_devices,

	// Typed property primitives (see codegen_helpers.ts) plus the validator's own
	// reference-collector, so templates never re-implement "what does this property
	// point at / resolve to".
	effective_value,
	property_default,
	is_null_pointer,
	is_descriptor_reference,
	reference_expression,
	number_literal,
	connected_symbols: get_connected_symbols,

	// Where each runtime patch goes relative to the init calls (see patch_schedule.ts).
	// A template decides WHAT to patch; this decides WHEN, which is ordering logic worth
	// having in tested TS rather than duplicated in every set.
	schedule_patches,
};

// The project layout is data, not code: `project_structure.json` inside the
// chosen template set declares which files exist and how they map to templates.
// Parsed and validated here so a malformed structure fails loudly (a Result
// error) rather than producing a half-written project.
//
// A set may declare `"extends": "<set>"`. Templates it does not carry itself are
// then taken from that base set, so a variant target (no-os-iio) ships only the
// templates that genuinely differ instead of a copy of the whole folder. One level
// only: a base set that itself extends is not followed, which keeps resolution
// obvious and cannot loop.
function load_file_specs(templates_directory: string): Result<FileSpec[]> {
	const structure_file = path.join(templates_directory, STRUCTURE_FILENAME);

	let parsed: unknown;
	try {
		parsed = JSON.parse(fs.readFileSync(structure_file, "utf8"));
	} catch (error_) {
		return error(`Could not read project structure '${structure_file}': ${String(error_)}`);
	}

	if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as { files?: unknown }).files)) {
		return error(`Project structure '${structure_file}' must be an object with a 'files' array`);
	}

	const extends_name = (parsed as { extends?: unknown }).extends;
	if (extends_name !== undefined && typeof extends_name !== "string") {
		return error(`Project structure '${structure_file}' has a non-string 'extends'`);
	}

	let base_directory: string | undefined;
	if (extends_name !== undefined) {
		const base = resolve_template_set(extends_name);
		if (!base.ok) {
			return error(`Project structure '${structure_file}' extends an unusable set: ${base.error.message}`);
		}
		if (path.resolve(base.value) === path.resolve(templates_directory)) {
			return error(`Project structure '${structure_file}' extends itself`);
		}
		base_directory = base.value;
	}

	const specs: FileSpec[] = [];
	for (const [index, entry] of (parsed as { files: unknown[] }).files.entries()) {
		const position = String(index);
		if (typeof entry !== "object" || entry === null) {
			return error(`Project structure entry #${position} is not an object`);
		}
		const { template, output, protect } = entry as Record<string, unknown>;

		if (typeof template !== "string" || typeof output !== "string") {
			return error(`Project structure entry #${position} needs string 'template' and 'output'`);
		}
		if (typeof protect !== "boolean") {
			return error(`Project structure entry #${position} ('${output}') needs a boolean 'protect'`);
		}

		// The set itself wins; the base is only consulted for what the set omits.
		let directory = templates_directory;
		if (!fs.existsSync(path.join(directory, template))) {
			if (base_directory === undefined || !fs.existsSync(path.join(base_directory, template))) {
				return error(`Project structure entry '${output}' references missing template '${template}'`);
			}
			directory = base_directory;
		}

		specs.push({ template, output, protect, directory });
	}

	return ok(specs);
}

export function generate_project(input: CodegenInput): Result<CodegenResult> {
	const { output_path, project_name } = input;
	const files_created: string[] = [];

	// Which set of templates to render with — the per-call override, else the
	// `template_set` setting, else the bundled default. Resolved (and checked to
	// exist) before anything is written.
	const templates_result = resolve_template_set(input.template_set);
	if (!templates_result.ok) {
		return templates_result;
	}
	const templates_directory = templates_result.value;

	// Load the declarative file->template map of that set.
	const specs_result = load_file_specs(templates_directory);
	if (!specs_result.ok) {
		return specs_result;
	}
	const files = specs_result.value;

	// Every template receives the SAME context: the whole (resolved) workfile plus
	// project metadata and the injected helpers under `it.h`. Templates derive
	// everything else via the pure `_helpers.eta` partial (`include("./_helpers")`).
	// The workfile is nested under `it.workfile` so its own `platform_vendor` does
	// not clash with the codegen input's `platform_vendor`.
	//
	// `files` is the manifest itself: cmakelists_txt.eta builds its `target_sources`
	// and `target_include_directories` lists from it, so adding a file to the project
	// is a one-line manifest change that CMake cannot fall out of step with.
	const context = {
		workfile: input.workfile,
		project_name: input.project_name,
		platform_vendor: input.platform_vendor,
		platform_name: input.platform_name,
		board: input.board,
		noos_path: input.noos_path,
		files: files,
		h: template_helpers,
	};

	const project_directory = path.join(output_path, project_name);

	// One Eta engine per owning set, not one per project. A template borrowed from a
	// base set must render with `views` pointing at THAT set, or its
	// `include("./_helpers")` would reach the borrowing set's helpers instead of the
	// ones it was written against. Cached because a set typically owns several files.
	const environments = new Map<string, Eta>();
	const environment_for = (directory: string): Eta => {
		let environment = environments.get(directory);
		if (!environment) {
			environment = make_environment(directory);
			environments.set(directory, environment);
		}
		return environment;
	};

	// Generate files. Directories are derived from each output path, so the JSON
	// structure alone determines the project layout. A template that throws (e.g. a
	// dependency cycle or a half-configured device) is surfaced as a Result error.
	try {
		// Lay symbols out dependency-first, in place, so every `Object.entries(symbols)`
		// in the templates walks referenced structs before their referrers. Codegen used
		// to topo-sort inside the Eta helpers; doing it once here in code keeps the
		// templates free of graph logic (and reuses the core connection graph). Throws on
		// a dependency cycle, caught below as a Result error.
		reorder_symbols_topologically(input.workfile);

		for (const file of files) {
			const file_path = path.join(project_directory, file.output);

			// Skip protected files if they already exist.
			if (file.protect && fs.existsSync(file_path)) {
				continue;
			}

			fs.mkdirSync(path.dirname(file_path), { recursive: true });

			const content = environment_for(file.directory).render(file.template, context);
			fs.writeFileSync(file_path, content);
			files_created.push(file_path);
		}
	} catch (error_) {
		return error(error_ instanceof Error ? error_.message : String(error_));
	}

	return ok({ files_created });
}
