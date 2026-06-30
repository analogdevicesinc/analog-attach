import fs from "node:fs";
import path from "node:path";
import Mustache from "mustache";
import { CodegenInput, CodegenResult } from "./types";
import { Result, ok } from "../ruleset_parser/result";
import { build_views } from "./view_builder";

const TEMPLATES_DIR = path.join(__dirname, "templates");

function load_template(name: string): string {
	return fs.readFileSync(path.join(TEMPLATES_DIR, name), "utf8");
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

	// Create directory structure
	const project_directory = path.join(output_path, project_name);
	const source_directory = path.join(project_directory, "src");
	const common_directory = path.join(source_directory, "common");

	fs.mkdirSync(common_directory, { recursive: true });

	// Generate files
	const files = [
		{ template: "makefile.mustache", output: "Makefile", view: views.makefile, protect: false },
		{ template: "src_mk.mustache", output: "src.mk", view: views.src_mk, protect: false },
		{ template: "main_c.mustache", output: "src/main.c", view: views.main_c, protect: false },
		{ template: "common_data_h.mustache", output: "src/common/common_data.h", view: views.common_data_h, protect: false },
		{ template: "common_data_c.mustache", output: "src/common/common_data.c", view: views.common_data_c, protect: false },
		{ template: "user_app_h.mustache", output: "src/user_app.h", view: views.user_app_h, protect: true },
		{ template: "user_app_c.mustache", output: "src/user_app.c", view: views.user_app_c, protect: true },
	];

	for (const file of files) {
		const file_path = path.join(project_directory, file.output);

		// Skip protected files if they already exist
		if (file.protect && fs.existsSync(file_path)) {
			continue;
		}

		const template = load_template(file.template);
		const content = Mustache.render(template, file.view);
		fs.writeFileSync(file_path, content);
		files_created.push(file_path);
	}

	return ok({ files_created });
}
