import fs from "node:fs";
import path from "node:path";
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
export function make_environment(templates_directory: string, fallback?: string): Eta {
	const environment = new Eta({
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

	// A variant set extends its base: a partial it does not carry itself is the base set's
	// (`include("./_helpers")` from capi-iio's main.c reaches capi's helpers). A borrowed
	// partial resolves its own includes as if it sat in the variant set, so it stays inside
	// the views directory and a partial the variant does carry wins there too.
	if (fallback !== undefined) {
		const resolve = environment.resolvePath.bind(environment);
		environment.resolvePath = (template, options) => {
			const from = options?.filepath;
			const borrowed_from = from !== undefined && path.relative(fallback, from).split(path.sep)[0] !== "..";
			const own = resolve(template, borrowed_from
				? { ...options, filepath: path.join(templates_directory, path.relative(fallback, from)) }
				: options);
			const borrowed = path.join(fallback, path.relative(templates_directory, own));
			return fs.existsSync(own) || !fs.existsSync(borrowed) ? own : borrowed;
		};
	}

	return environment;
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
