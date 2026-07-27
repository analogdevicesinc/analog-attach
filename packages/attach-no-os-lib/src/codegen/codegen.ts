import fs from "node:fs";
import path from "node:path";

import { fileURLToPath } from "node:url";
import { error, ok } from "../ruleset_parser/result";
import { make_environment } from "./eta_environment";
import { load_devices } from "./device_loader";

import type { CodegenInput, CodegenResult } from "./types";
import type { Result } from "../ruleset_parser/result";
import type { FileSpec } from "./types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.join(__dirname, "templates");
const STRUCTURE_FILE = path.join(TEMPLATES_DIR, "project_structure.json");

// Helpers injected into every template under `it.h` — the Eta replacement for the
// custom nunjucks filters that used to live on the environment. Templates call them
// as functions (`it.h.tab_indent(x)`) instead of piping (`x | tab_indent`).
//
// `reverse` and `tab_indent` are pure string/array primitives; `devices` is the one
// impure helper (reads the external schemas repo, see device_loader.ts) — kept out
// of the pure `_helpers.eta` partial, which never touches `it.h`.
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
};

// The project layout is data, not code: `project_structure.json` next to the
// templates declares which files exist and how they map to templates. Parsed and
// validated here so a malformed structure fails loudly (a Result error) rather
// than producing a half-written project.
function load_file_specs(): Result<FileSpec[]> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(fs.readFileSync(STRUCTURE_FILE, "utf8"));
	} catch (error_) {
		return error(`Could not read project structure '${STRUCTURE_FILE}': ${String(error_)}`);
	}

	if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as { files?: unknown }).files)) {
		return error(`Project structure '${STRUCTURE_FILE}' must be an object with a 'files' array`);
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
		if (!fs.existsSync(path.join(TEMPLATES_DIR, template))) {
			return error(`Project structure entry '${output}' references missing template '${template}'`);
		}

		specs.push({ template, output, protect });
	}

	return ok(specs);
}

export function generate_project(input: CodegenInput): Result<CodegenResult> {
	const { output_path, project_name } = input;
	const files_created: string[] = [];

	// Load the declarative file->template map.
	const specs_result = load_file_specs();
	if (!specs_result.ok) {
		return specs_result;
	}
	const files = specs_result.value;

	// Every template receives the SAME context: the whole (resolved) workfile plus
	// project metadata and the injected helpers under `it.h`. Templates derive
	// everything else via the pure `_helpers.eta` partial (`include("./_helpers")`).
	// The workfile is nested under `it.workfile` so its own `platform_vendor` does
	// not clash with the codegen input's `platform_vendor` (used by makefile.eta).
	const context = {
		workfile: input.workfile,
		project_name: input.project_name,
		platform_vendor: input.platform_vendor,
		platform_name: input.platform_name,
		noos_path: input.noos_path,
		h: template_helpers,
	};

	const project_directory = path.join(output_path, project_name);
	const environment = make_environment(TEMPLATES_DIR);

	// Generate files. Directories are derived from each output path, so the JSON
	// structure alone determines the project layout. A template that throws (e.g. a
	// dependency cycle or a half-configured device) is surfaced as a Result error.
	try {
		for (const file of files) {
			const file_path = path.join(project_directory, file.output);

			// Skip protected files if they already exist.
			if (file.protect && fs.existsSync(file_path)) {
				continue;
			}

			fs.mkdirSync(path.dirname(file_path), { recursive: true });

			const content = environment.render(file.template, context);
			fs.writeFileSync(file_path, content);
			files_created.push(file_path);
		}
	} catch (error_) {
		return error(error_ instanceof Error ? error_.message : String(error_));
	}

	return ok({ files_created });
}
