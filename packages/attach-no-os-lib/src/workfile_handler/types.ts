import type { Ruleset } from "../ruleset_parser/types";

/**
 * Platform manifest - lists ops and structs available for this platform
 */
export interface PlatformManifest {
    name: string;         // platform name e.g. "max32690"
    vendor: string;       // vendor name e.g. "maxim"
    description?: string; // optional human-readable platform description
    ops: string[];        // paths to ops yaml files
    structs: string[];    // paths to struct yaml files (extras)
};

/**
 * Platform specs indexed by platform ID
 */
export type PlatformSpecs = Record<string, PlatformManifest>;

export interface Workfile {
    platform?: string;                      // platform name e.g. "max32690"
    platform_vendor?: string;               // vendor name e.g. "maxim"
    platform_ops: Record<string, Ruleset>;  // locked, auto-populated from platform, not printed
    exposed_ops: Record<string, Ruleset>;   // same as platform_ops, but runtime updated
    symbols: Record<string, Ruleset>;       // user-created symbols, printed in codegen
};

export interface LoadPlatformResult {
    available_structs: string[];
};

export interface AvailableStructs {
    devices: string[];
    noos: string[];
    platform: string[];
};

export interface PropertySuggestions {
    values?: string[], // for normal values / instantiated symbols
    types?: string[], // types that can be instantiated and become symbols/values (that fit in this case)
}

export interface MinimalWorkfileNode {
    $compatible: string;
    [property: string]: unknown;
};

export interface MinimalWorkfile {
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
