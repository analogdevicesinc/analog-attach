import type { Rule } from "../ruleset_parser/types";

export interface ValidationError {
	path: string;
	message: string;
	severity: "error" | "warning";
};

export interface ValidationResult {
	valid: boolean;
	errors: ValidationError[];
}

// A rule with its relative refs resolved to concrete symbol names (decision:
// resolve once at collection time). `self_symbol` is the symbol that declared the
// rule; `parent_symbol` is the symbol that includes it (its includer), found via
// reverse graph lookup — undefined when nothing includes the declarer. The engine
// maps ref.node -> one of these names, so scope is decided in exactly one place.
export interface CollectedRule {
	rule: Rule,
	self_symbol: string,
	parent_symbol?: string
}

export type ConnectionGraph = Map<string, string[]>;
