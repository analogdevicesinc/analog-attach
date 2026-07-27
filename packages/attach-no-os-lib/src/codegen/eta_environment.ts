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

// A minimal engine for rendering template strings that don't live on disk —
// specifically the device init/remove templates read out of the schemas repo
// (see device_loader.ts). Same C-code-safe options as make_environment, used via
// renderString().
export function make_string_environment(): Eta {
	return new Eta({
		autoEscape: false,
		rmWhitespace: false,
		autoTrim: false,
	});
}
