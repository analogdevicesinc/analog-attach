import { Ruleset } from "../bindings_parser/types";

export type Workfile = {
    symbols: Record<string, Ruleset>  // symbol_name -> ruleset (values in properties)
}
