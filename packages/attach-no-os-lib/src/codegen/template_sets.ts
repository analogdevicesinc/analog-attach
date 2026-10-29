// A "template set" is one folder of project templates plus the
// `project_structure.json` that declares which files it generates. Sets live
// side by side under `templates/` (`templates/capi/`, and any other set added
// later), so a second target is a new folder rather than a change to codegen.
//
// Which set to use is a setting (`project-template`, see settings/globals.ts),
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

// Root holding the bundled sets, next to this module (src/codegen/templates, or the
// copy a bundling program ships). Every direct child folder with a
// `project_structure.json` is a set.
export const TEMPLATES_ROOT = path.join(__dirname, "templates");

let templates_root = TEMPLATES_ROOT;

// Where the bundled sets are, for a program that ships them elsewhere than next to the
// bundled lib (the analog-attach CLI: its assets directory). `undefined` goes back to
// TEMPLATES_ROOT.
export function use_templates_root(directory: string | undefined): void {
	templates_root = directory ?? TEMPLATES_ROOT;
}

// The root `list_template_sets` and `resolve_template_set` read.
export function get_templates_root(): string {
	return templates_root;
}

// The per-set manifest filename; also what marks a folder as a template set.
export const STRUCTURE_FILENAME = "project_structure.json";

// Names of the bundled template sets, sorted. Used for error messages and for
// CLI completion of `analog-attach config project-template`.
export function list_template_sets(): string[] {
	if (!fs.existsSync(templates_root)) {
		return [];
	}

	return fs
		.readdirSync(templates_root, { withFileTypes: true })
		.filter(entry => entry.isDirectory())
		.map(entry => entry.name)
		.filter(name => fs.existsSync(path.join(templates_root, name, STRUCTURE_FILENAME)))
		.sort();
}

// The configured set name: the `project-template` setting's value, its declared
// default, then DEFAULT_TEMPLATE_SET. Never fails — a missing or unreadable
// config just means "the default set", since codegen worked without this setting
// before it existed.
export function configured_template_set(): string {
	const setting = get_setting("project-template");
	if (!setting.ok) {
		return DEFAULT_TEMPLATE_SET;
	}
	return setting.value.value ?? setting.value.default ?? DEFAULT_TEMPLATE_SET;
}

// Resolve a template set to its directory on disk.
//
// Precedence: the explicit per-invocation name, then the `project-template` setting,
// then DEFAULT_TEMPLATE_SET. A name containing a path separator (or an absolute
// path) is taken as a path to an out-of-tree set, so a user can keep their own
// templates outside the installed app; a bare name is looked up under
// templates_root.
export function resolve_template_set(requested?: string): Result<string> {
	const name = requested ?? configured_template_set();

	const is_path = path.isAbsolute(name) || name.includes("/") || name.includes("\\");
	const directory = is_path ? path.resolve(name) : path.join(templates_root, name);

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
