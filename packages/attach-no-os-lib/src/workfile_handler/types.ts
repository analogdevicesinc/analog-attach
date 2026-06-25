import { Ruleset } from "../bindings_parser/types";

export type Workfile = {
    platform_ops: Record<string, Ruleset>;  // locked, auto-populated from platform, not printed
    symbols: Record<string, Ruleset>;       // user-created symbols, printed in codegen
};

export type LoadPlatformResult = {
    available_structs: string[];
};

export type AvailableStructs = {
    devices: string[];
    noos: string[];
    platform: string[];
};
