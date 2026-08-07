// A "template set" is one folder of project templates plus the
// `project_structure.json` that declares which files it generates. Sets live
// side by side under `templates/` (`templates/no-os/`, and any other set added
// later), so a second target is a new folder rather than a change to codegen.
//
// Which set to use is a setting (`template_set`, see settings/globals.ts),
// overridable per invocation via `CodegenInput.template_set`. Codegen resolves
// and validates the set BEFORE it renders anything, so a typo or a half-populated
// folder fails loudly instead of producing a partial project.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { error, ok } from "../ruleset_parser/result";
import { get_setting } from "../settings/settings";
import { DEFAULT_TEMPLATE_SET } from "../settings/globals";

import type { Result } from "../ruleset_parser/result";

// Re-exported so callers get the whole template-set vocabulary from one module,
// even though the constant itself must live in settings/globals (see there).
export { DEFAULT_TEMPLATE_SET } from "../settings/globals";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Root holding the bundled sets. Every direct child folder with a
// `project_structure.json` is a set.
export const TEMPLATES_ROOT = path.join(__dirname, "templates");

// The per-set manifest filename; also what marks a folder as a template set.
export const STRUCTURE_FILENAME = "project_structure.json";

// Names of the bundled template sets, sorted. Used for error messages and for
// CLI completion of `aa config template_set`.
export function list_template_sets(): string[] {
	if (!fs.existsSync(TEMPLATES_ROOT)) {
		return [];
	}

	return fs
		.readdirSync(TEMPLATES_ROOT, { withFileTypes: true })
		.filter(entry => entry.isDirectory())
		.map(entry => entry.name)
		.filter(name => fs.existsSync(path.join(TEMPLATES_ROOT, name, STRUCTURE_FILENAME)))
		.sort();
}

// The configured set name: the `template_set` setting's value, its declared
// default, then DEFAULT_TEMPLATE_SET. Never fails — a missing or unreadable
// config just means "the default set", since codegen worked without this setting
// before it existed.
export function configured_template_set(): string {
	const setting = get_setting("template_set");
	if (!setting.ok) {
		return DEFAULT_TEMPLATE_SET;
	}
	return setting.value.value ?? setting.value.default ?? DEFAULT_TEMPLATE_SET;
}

// Resolve a template set to its directory on disk.
//
// Precedence: the explicit per-invocation name, then the `template_set` setting,
// then DEFAULT_TEMPLATE_SET. A name containing a path separator (or an absolute
// path) is taken as a path to an out-of-tree set, so a user can keep their own
// templates outside the installed app; a bare name is looked up under
// TEMPLATES_ROOT.
export function resolve_template_set(requested?: string): Result<string> {
	const name = requested ?? configured_template_set();

	const is_path = path.isAbsolute(name) || name.includes("/") || name.includes("\\");
	const directory = is_path ? path.resolve(name) : path.join(TEMPLATES_ROOT, name);

	if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
		const available = list_template_sets();
		const hint = available.length > 0 ? ` Available sets: ${available.join(", ")}` : "";
		return error(`Template set '${name}' not found at '${directory}'.${hint}`);
	}

	if (!fs.existsSync(path.join(directory, STRUCTURE_FILENAME))) {
		return error(`Template set '${name}' has no '${STRUCTURE_FILENAME}' (looked in '${directory}')`);
	}

	return ok(directory);
}
