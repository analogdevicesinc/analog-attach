import { OverrideDirective, RulesetDevice, RulesetStruct } from "../ruleset_parser/types";

export type ValidationError = {
	path: string;
	message: string;
	severity: "error" | "warning";
};

export type ValidationResult = {
	valid: boolean;
	errors: ValidationError[];
}

export type ChildOverride = {
	directive: OverrideDirective,
	child: RulesetStruct | RulesetDevice
}

export type ConnectionGraph = Map<string, string[]>;
