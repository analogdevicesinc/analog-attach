import { Ruleset } from "../ruleset_parser/types";

/**
 * Platform manifest - lists ops and structs available for this platform
 */
export type PlatformManifest = {
    name: string;       // platform name e.g. "max32690"
    ops: string[];      // paths to ops yaml files
    structs: string[];  // paths to struct yaml files (extras)
};

/**
 * Platform specs indexed by platform ID
 */
export type PlatformSpecs = {
    [platform_id: string]: PlatformManifest;
};

export type Workfile = {
    platform?: string;                      // platform name e.g. "max32690"
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

export type PropertySuggestions = {
    values?: string[], // for normal values / instantiated symbols
    types?: string[], // types that can be instantiated and become symbols/values (that fit in this case)
}

export type MinimalWorkfileNode = {
    $compatible: string;
    [property: string]: unknown;
};

export type MinimalWorkfile = {
    platform: string; // e.g. max32690
    symbols: Record<string, MinimalWorkfileNode>;
}

export function is_minimal_workfile_node(value: unknown): value is MinimalWorkfileNode {
    if (typeof value !== "object" || value === null) {
        return false;
    }

    const object = value as Record<string, unknown>;
    return typeof object.$compatible === "string";
}

export function is_minimal_workfile(value: unknown): value is MinimalWorkfile {
    if (typeof value !== "object" || value === null) {
        return false;
    }

    const object = value as Record<string, unknown>;

    if (typeof object.platform !== "string") {
        return false;
    }

    if (typeof object.symbols !== "object" || object.symbols === null) {
        return false;
    }

    for (const node of Object.values(object.symbols)) {
        if (!is_minimal_workfile_node(node)) {
            return false;
        }
    }

    return true;
}
