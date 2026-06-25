import { Property } from "../bindings_parser/types";
import { Workfile } from "../workfile_handler/types";
import { ChildOverride, ConnectionGraph, ValidationError, ValidationResult } from "./types";
import { ParseContext } from "../bindings_parser/validators";
import { validate_property } from "./property_validator";
import { validate_mutex } from "./override_resolver";
import { collect_child_overrides, create_connections_graph } from "./connection_graph";


export function validate_workfile(workfile: Workfile): ValidationResult {
	const errors: ValidationError[] = [];
	const connections_graph = create_connections_graph(workfile);

	for (const [symbol_name, ruleset] of Object.entries(workfile.symbols)) {
		if (ruleset._t !== "BindingStuct") {
			continue;
		}

		const child_overrides = collect_child_overrides(symbol_name, workfile, connections_graph);
		const context: ParseContext = {
			path: symbol_name,
			document: {}
		};

		// FIXME: Might want to move this to a more specialized location
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
