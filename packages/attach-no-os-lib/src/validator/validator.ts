import type { Workfile } from "../workfile_handler/types";
import type { ValidationError, ValidationResult } from "./types";
import type { ParseContext } from "../ruleset_parser/validators";
import { validate_property } from "./property_validator";
import { child_names, collect_child_overrides, create_connections_graph, describe_cycle, topo_sorted_symbols } from "./connection_graph";

export function validate_workfile(workfile: Workfile): ValidationResult {
	const errors: ValidationError[] = [];
	const connections_graph = create_connections_graph(workfile);

	// Structs embedded by value must be defined before the struct that embeds them, so a
	// loop of value references cannot be laid out in C at all — codegen would have to
	// place each member of the loop after itself. Report it here, with the loop spelled
	// out, rather than letting the reordering step throw during generation.
	//
	// Only VALUE edges close a loop: pointer references (i3c's bus <-> device) just store
	// an address, so a declaration suffices and the order is free. A symbol whose own
	// value reference is itself is the same defect with one member, and lands here too.
	for (const cycle of topo_sorted_symbols(workfile).cycles) {
		// A one-member cycle is a value self-reference, already reported below by the
		// self-reference rule (which catches pointer ones too). Skip it so one defect
		// produces one error.
		if (cycle.length < 2) {
			continue;
		}

		const description = describe_cycle(cycle);
		// One error per member, so every symbol involved is flagged in the UI rather than
		// only whichever one the trace happened to start from.
		for (const name of cycle) {
			errors.push({
				path: name,
				message: `Symbol '${name}' is part of a dependency cycle (${description}). Structs referenced by value must be defined first, so this cannot be generated.`,
				severity: "error",
			});
		}
	}

	for (const [symbol_name, ruleset] of Object.entries(workfile.symbols)) {
		// Both structs and descriptors carry properties to validate (a descriptor's
		// single required init_param include, in particular).
		if (ruleset._t !== "RulesetStruct" && ruleset._t !== "RulesetDescriptor") {
			continue;
		}

		// A symbol referencing itself is never a meaningful device model, whether the
		// reference is by value (also an unorderable one-member cycle) or by pointer
		// (`.bus = &itself` compiles, but means nothing). Hence all edges, unlike the
		// cycle check above — mutual POINTER references between two DIFFERENT symbols
		// stay legal, because that is what i3c needs.
		if (child_names(connections_graph, symbol_name).includes(symbol_name)) {
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
