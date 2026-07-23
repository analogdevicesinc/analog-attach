import fs from "node:fs";
import path from "node:path";

import { fileURLToPath } from "node:url";
import { ok } from "../ruleset_parser/result";
import { build_views } from "./view_builder";
import { make_environment } from "./nunjucks_environment";

import type { CodegenInput, CodegenResult } from "./types";
import type { Result } from "../ruleset_parser/result";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.join(__dirname, "templates");

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

	const environment = make_environment(TEMPLATES_DIR);

	// Generate files
	const files = [
		{ template: "makefile.njk", output: "Makefile", view: views.makefile, protect: false },
		{ template: "src_mk.njk", output: "src.mk", view: views.src_mk, protect: false },
		{ template: "main_c.njk", output: "src/main.c", view: views.main_c, protect: false },
		{ template: "common_data_h.njk", output: "src/common/common_data.h", view: views.common_data_h, protect: false },
		{ template: "common_data_c.njk", output: "src/common/common_data.c", view: views.common_data_c, protect: false },
		{ template: "user_app_h.njk", output: "src/user_app.h", view: views.user_app_h, protect: true },
		{ template: "user_app_c.njk", output: "src/user_app.c", view: views.user_app_c, protect: true },
	];

	for (const file of files) {
		const file_path = path.join(project_directory, file.output);

		// Skip protected files if they already exist
		if (file.protect && fs.existsSync(file_path)) {
			continue;
		}

		const content = environment.render(file.template, file.view);
		fs.writeFileSync(file_path, content);
		files_created.push(file_path);
	}

	return ok({ files_created });
}
