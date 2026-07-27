import fs from "node:fs";
import path from "node:path";

import { fileURLToPath } from "node:url";
import { error, ok } from "../ruleset_parser/result";
import { build_views } from "./view_builder";
import { make_environment } from "./nunjucks_environment";

import type { CodegenInput, CodegenResult, Views } from "./types";
import type { Result } from "../ruleset_parser/result";
import type { FileSpec } from "./types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.join(__dirname, "templates");
const STRUCTURE_FILE = path.join(TEMPLATES_DIR, "project_structure.json");

// The project layout is data, not code: `project_structure.json` next to the
// templates declares which files exist and how they map to templates/views.
// Parsed and validated here so a malformed structure fails loudly (a Result
// error) rather than producing a half-written project.
function load_file_specs(views: Views): Result<FileSpec[]> {
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
		const { template, output, view, protect } = entry as Record<string, unknown>;

		if (typeof template !== "string" || typeof output !== "string" || typeof view !== "string") {
			return error(`Project structure entry #${position} needs string 'template', 'output', and 'view'`);
		}
		if (typeof protect !== "boolean") {
			return error(`Project structure entry #${position} ('${output}') needs a boolean 'protect'`);
		}
		if (!(view in views)) {
			return error(`Project structure entry '${output}' references unknown view '${view}'`);
		}
		if (!fs.existsSync(path.join(TEMPLATES_DIR, template))) {
			return error(`Project structure entry '${output}' references missing template '${template}'`);
		}

		specs.push({ template, output, view: view as keyof Views, protect });
	}

	return ok(specs);
}

export function generate_project(input: CodegenInput): Result<CodegenResult> {
	const { output_path, project_name } = input;
	const files_created: string[] = [];

	// Build all view contexts from workfile
	const views_result = build_views(input);
	if (!views_result.ok) {
		return views_result;
	}
	const views = views_result.value;

	// Load the declarative file->template->view map
	const specs_result = load_file_specs(views);
	if (!specs_result.ok) {
		return specs_result;
	}
	const files = specs_result.value;

	const project_directory = path.join(output_path, project_name);
	const environment = make_environment(TEMPLATES_DIR);

	// Generate files. Directories are derived from each output path, so the JSON
	// structure alone determines the project layout.
	for (const file of files) {
		const file_path = path.join(project_directory, file.output);

		// Skip protected files if they already exist
		if (file.protect && fs.existsSync(file_path)) {
			continue;
		}

		fs.mkdirSync(path.dirname(file_path), { recursive: true });

		const content = environment.render(file.template, views[file.view]);
		fs.writeFileSync(file_path, content);
		files_created.push(file_path);
	}

	return ok({ files_created });
}
