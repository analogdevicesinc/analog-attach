import { Result } from "../bindings_parser/result";
import { Ruleset } from "../bindings_parser/types";

export type Workfile = {
    platform_ops: Record<string, Ruleset>;  // locked, auto-populated from platform, not printed
    symbols: Record<string, Ruleset>;       // user-created symbols, printed in codegen
}

export type BindingLoader = (path: string) => Result<Ruleset>;

export type LoadPlatformResult = {
    available_structs: string[];
};
