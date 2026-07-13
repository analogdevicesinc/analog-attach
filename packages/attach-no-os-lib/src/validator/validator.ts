import { Workfile } from "../workfile_handler/types";
import { ValidationError, ValidationResult } from "./types";
import { ParseContext } from "../ruleset_parser/validators";
import { validate_property } from "./property_validator";
import { validate_mutex } from "./override_resolver";
import { collect_child_overrides, create_connections_graph } from "./connection_graph";

export function validate_workfile(workfile: Workfile): ValidationResult {
	const errors: ValidationError[] = [];
	const connections_graph = create_connections_graph(workfile);

	for (const [symbol_name, ruleset] of Object.entries(workfile.symbols)) {
		if (ruleset._t !== "RulesetStruct") {
			continue;
		}

		// A symbol referencing itself (e.g. parent set to its own descriptor) forms a
		// dependency cycle and cannot be ordered/generated. Reject it explicitly.
		if ((connections_graph.get(symbol_name) ?? []).includes(symbol_name)) {
			errors.push({
				path: symbol_name,
				message: `Symbol '${symbol_name}' references itself; self-references are not allowed.`,
				severity: "error",
			});
		}

		const child_overrides = collect_child_overrides(symbol_name, workfile, connections_graph);
		const context: ParseContext = {
			path: symbol_name,
			document: {}
		};

		for (const { directive } of child_overrides) {
			if (directive._t === "OverrideMutex") {
				errors.push(...validate_mutex(directive, ruleset, context));
			}
		}

		for (const property of ruleset.properties) {
			const property_errors = validate_property(property, child_overrides, ruleset, workfile, context);
			errors.push(...property_errors);
		}
	}

	return {
		valid: errors.filter(error => error.severity === "error").length === 0,
		errors: errors
	};
}
