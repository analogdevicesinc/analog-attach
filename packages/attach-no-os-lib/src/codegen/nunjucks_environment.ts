import nunjucks from "nunjucks";

// One configured environment for all project-level (.njk) templates.
//
// Options, and why each matters for C code generation (not HTML):
//   autoescape        off  — output is C source; never HTML-escape "&", '"', etc.
//   throwOnUndefined  on   — a mistyped template variable is a hard error, not a
//                            silently-empty render. Keeps templates and the Views
//                            type in lockstep.
//   trimBlocks        on   — the newline right after a {% %} tag is removed, so
//                            control-flow lines don't leave blank lines behind.
//   lstripBlocks      on   — leading whitespace before a {% %} tag is stripped, so
//                            we can indent tags for readability without indenting
//                            the emitted C.
export function make_environment(templates_directory: string): nunjucks.Environment {
	const environment = new nunjucks.Environment(
		new nunjucks.FileSystemLoader(templates_directory, { noCache: true }),
		{
			autoescape: false,
			throwOnUndefined: true,
			trimBlocks: true,
			lstripBlocks: true,
		}
	);

	// Replaces the precomputed `devices_reversed` view field: teardown order is the
	// reverse of init order, expressed inline in main_c.njk as `devices | reverse`.
	// eslint-disable-next-line unicorn/no-array-reverse
	environment.addFilter("reverse", (array: unknown[]) => [...array].reverse());

	// Indent every non-empty line of a (possibly multi-line) block by one tab.
	// Device init/remove templates now emit full statement blocks; the `main_c.njk`
	// loop only indents the first line, so we re-indent the rest here. Nunjucks'
	// built-in `indent` filter uses spaces — this codebase uses tabs. Empty lines are
	// left bare to avoid trailing whitespace.
	environment.addFilter("tab_indent", (text: unknown) =>
		String(text)
			.split("\n")
			.map(line => (line.length > 0 ? "\t" + line : line))
			.join("\n")
	);

	return environment;
}

// A minimal environment for rendering template strings that don't live on disk —
// specifically the device init/remove templates read out of the schemas repo. Same
// C-code-safe options as make_environment (no HTML escaping, hard error on undefined
// variables), but with no FileSystemLoader since we render via renderString().
export function make_string_environment(): nunjucks.Environment {
	return new nunjucks.Environment(undefined, {
		autoescape: false,
		throwOnUndefined: true,
		trimBlocks: true,
		lstripBlocks: true,
	});
}
