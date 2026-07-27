import { Eta } from "eta";

// One configured Eta engine for all project-level (.eta) templates.
//
// Options, and why each matters for C code generation (not HTML):
//   autoEscape  false — output is C source; never HTML-escape "&", '"', etc.
//                       (nunjucks called this `autoescape`.) Use <%= %> freely;
//                       <%~ %> is the explicit "raw" tag kept for intent on values
//                       that contain "&".
//   views             — the templates directory. `eta.render("makefile.eta", view)`
//                       resolves against it (the .eta extension is accepted).
//   rmWhitespace false — leave whitespace to the templates; blank-line control is
//                        done per-tag with the `-%>` newline-slurp, mirroring the old
//                        nunjucks trimBlocks/lstripBlocks setup.
//
// NOTE: unlike nunjucks' throwOnUndefined, Eta renders a missing variable as the
// literal string "undefined" rather than erroring. The codegen tests (exact-content
// assertions) are the safety net against that for now; a dedicated guard is deferred.
export function make_environment(templates_directory: string): Eta {
	return new Eta({
		views: templates_directory,
		autoEscape: false,
		rmWhitespace: false,
		// Eta's default autoTrim slurps the newline AFTER every tag — including
		// output tags (`<%= %>`), which would collapse consecutive lines together
		// (`# name# Generated`). nunjucks only trimmed BLOCK tags (trimBlocks); it
		// never touched `{{ }}`. So disable autoTrim entirely and control block-tag
		// newlines explicitly with `-%>` in the templates (mirrors trimBlocks 1:1).
		autoTrim: false,
	});
}

// Helpers passed to every template under `it.h` — the Eta replacement for the
// custom nunjucks filters that used to live on the environment. Templates call
// them as functions (`it.h.tab_indent(x)`) instead of piping (`x | tab_indent`).
export const template_helpers = {
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
};

export type TemplateHelpers = typeof template_helpers;

// A minimal engine for rendering template strings that don't live on disk —
// specifically the device init/remove templates read out of the schemas repo.
// Same C-code-safe options as make_environment, used via renderString().
export function make_string_environment(): Eta {
	return new Eta({
		autoEscape: false,
		rmWhitespace: false,
		autoTrim: false,
	});
}
