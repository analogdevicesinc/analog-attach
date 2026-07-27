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

// How one symbol holds a reference to another, which decides whether the reference
// is an ORDERING constraint in generated C:
//   "value"   — the referenced struct is embedded/copied into the referrer, so the
//               compiler needs its full definition first (`.part = small_thing`).
//   "pointer" — only the address is stored, so a declaration is enough and the
//               referenced struct may be defined later (`.part = &small_thing`).
// Two symbols can therefore point at each other (a legal C cycle, e.g. i3c bus <->
// device) while two symbols can never embed each other.
export type ReferenceKind = "value" | "pointer";

export interface SymbolReference {
	name: string,
	kind: ReferenceKind
}

// Who references whom, with HOW each reference is held kept on the edge. One graph
// serves every consumer: "does anything reference X" and override scoping read the
// names and ignore `kind`, while codegen layout keeps only `kind: "value"` edges (see
// `value_children`). Building a second, pre-filtered graph would mean two objects that
// look alike but silently disagree about what an edge means.
export type ConnectionGraph = Map<string, SymbolReference[]>;
