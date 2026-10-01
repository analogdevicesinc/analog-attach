import type { Ruleset } from "../ruleset_parser/types";

export interface Workfile {
    // The chip the project targets, e.g. "max32655". A board names its own chip, so this
    // is inferred from `board` when one is set, and set directly for a chip that has no
    // board module of its own. NOTE: this is what CAPI's own files call the `soc`; CAPI
    // reserves "platform" for the backend (maxim), which is `platform_vendor` here.
    platform?: string;
    platform_vendor?: string;               // backend vendor, e.g. "maxim"
    // Board the project builds for, e.g. "max32655fthr", as declared in a platform
    // module's `boards:` list. Optional because a chip with exactly one board does not
    // need the user to say so; it is resolved to a concrete board before codegen runs.
    board?: string;
    platform_ops: Record<string, Ruleset>;  // locked, auto-populated from platform, not printed
    exposed_ops: Record<string, Ruleset>;   // same as platform_ops, but runtime updated
    symbols: Record<string, Ruleset>;       // user-created symbols, printed in codegen
};

/**
 * The instantiable symbols a user can add to a workfile.
 *
 * Grouped by the module that ships them rather than by the old `devices`/`noos`/`platform`
 * split: a symbol's provenance is now simply which repo indexed it, and that generalises
 * to however many driver collections and platform backends are configured.
 */
export interface AvailableStructs {
    /** Module name -> its instantiable symbols. */
    by_module: Record<string, string[]>;
    /** Every instantiable symbol, flattened and sorted. */
    all: string[];
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
    // Board preset, e.g. "ad-apard32690-sl". Optional so workfiles written before
    // boards existed still load; resolved from the chip when a single board matches.
    board?: string;
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

    if (object.board !== undefined && typeof object.board !== "string") {
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
