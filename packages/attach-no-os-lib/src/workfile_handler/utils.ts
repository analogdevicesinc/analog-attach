import { Workfile } from "./types";

export function find_symbol_by_descriptor(workfile: Workfile, descriptor_name: string): string | undefined {
    for (const [name, ruleset] of Object.entries(workfile.symbols)) {
        if (ruleset._t !== "RulesetStruct") {
            continue;
        }
        const current_descriptor = ruleset.$descriptor_name ?? `${name}_desc`;
        if (current_descriptor === descriptor_name) {
            return name;
        }
    }
    return undefined;
}
