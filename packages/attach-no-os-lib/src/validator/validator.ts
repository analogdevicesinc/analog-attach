import type { Workfile } from "../workfile_handler/types";
import type { ValidationError, ValidationResult } from "./types";
import type { ParseContext } from "../ruleset_parser/validators";
import { validate_property } from "./property_validator";
import { collect_child_overrides, create_connections_graph } from "./connection_graph";

export function validate_workfile(workfile: Workfile): ValidationResult {
	const errors: ValidationError[] = [];
	const connections_graph = create_connections_graph(workfile);

	for (const [symbol_name, ruleset] of Object.entries(workfile.symbols)) {
		// Both structs and descriptors carry properties to validate (a descriptor's
		// single required init_param include, in particular).
		if (ruleset._t !== "RulesetStruct" && ruleset._t !== "RulesetDescriptor") {
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

		for (const property of ruleset.properties) {
			const property_errors = validate_property(property, child_overrides, ruleset, symbol_name, workfile, context);
			errors.push(...property_errors);
		}
	}

	return {
		valid: errors.filter(error => error.severity === "error").length === 0,
		errors: errors
	};
}
