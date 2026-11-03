// The error types (GEN-17): a fixed list, the same in every ecosystem, so that scripts and the UI
// can tell errors and warnings apart; the message says which case it is. From the Error types tab
// of the requirements workbook (cli-spec.xlsx); keep the two in step. attach-no-os-lib has the
// same list of names (its ErrorType), checked equal to this one in error-types.test.ts.

export interface ErrorTypeInfo {
    /** The group the workbook lists it under. */
    area: string;
    /** `error`, `warning`, or `error or warning` (validation: the definition decides). */
    severity: string;
    description: string;
    /** The ecosystems that have it: `All`, `Linux` or `CAPI`. */
    ecosystems: string;
}

export const ERROR_TYPES = {
    "unknown-command": { area: "Command line", severity: "error", description: "The command, sub-command or list kind does not exist; the message names the closest one.", ecosystems: "All" },
    "unknown-flag": { area: "Command line", severity: "error", description: "The command does not take that flag; the message names the closest one.", ecosystems: "All" },
    "missing-argument": { area: "Command line", severity: "error", description: "A required argument was left out.", ecosystems: "All" },
    "invalid-argument": { area: "Command line", severity: "error", description: "An argument has the wrong form, or there are too many.", ecosystems: "All" },
    "conflicting-flags": { area: "Command line", severity: "error", description: "Flags or values were given together that cannot be.", ecosystems: "All" },
    "missing-setting": { area: "Settings", severity: "error", description: "A setting the command needs has no value; the message names it and how to set it.", ecosystems: "All" },
    "unknown-setting": { area: "Settings", severity: "error", description: "The setting does not exist in the selected ecosystem; the message names the closest one.", ecosystems: "All" },
    "invalid-setting": { area: "Settings", severity: "error", description: "The value is not one the setting can take.", ecosystems: "All" },
    "settings-unreadable": { area: "Settings", severity: "error", description: "A settings file cannot be read or does not parse; the message names the file.", ecosystems: "All" },
    "invalid-source": { area: "Sources and tools", severity: "error", description: "A configured source tree is not what it should be.", ecosystems: "All" },
    "cache-missing": { area: "Sources and tools", severity: "error", description: "Data built from the sources is missing; the message says how to build it (config --reload).", ecosystems: "Linux" },
    "cache-stale": { area: "Sources and tools", severity: "warning", description: "Data built from the sources is older than the sources, or from another tree; the command goes on.", ecosystems: "Linux" },
    "tool-missing": { area: "Sources and tools", severity: "error", description: "An external tool or SDK the command needs is not installed or not found.", ecosystems: "All" },
    "tool-failed": { area: "Sources and tools", severity: "error", description: "An external tool ran and failed; its output is shown.", ecosystems: "All" },
    "install-incomplete": { area: "Sources and tools", severity: "error", description: "A file the tool ships with is missing: a packaging problem, not the user's.", ecosystems: "All" },
    "workfile-missing": { area: "Files", severity: "error", description: "There is no workfile where the workfile setting points; the message says to run init.", ecosystems: "All" },
    "workfile-exists": { area: "Files", severity: "error", description: "The command would overwrite an existing workfile, which it never does.", ecosystems: "All" },
    "parse-error": { area: "Files", severity: "error", description: "A file does not parse; the message names the file and, where known, the line.", ecosystems: "All" },
    "workfile-invalid": { area: "Files", severity: "error", description: "The workfile parses but does not fit the current definitions; the message says what to remove or change.", ecosystems: "All" },
    "write-failed": { area: "Files", severity: "error", description: "A file or directory cannot be written.", ecosystems: "All" },
    "not-found": { area: "Names and lookups", severity: "error", description: "The device, property, parent or destination named is not there; the message lists what is.", ecosystems: "All" },
    "unknown-device-type": { area: "Names and lookups", severity: "error", description: "No definition matches the device type given; the message names the closest ones.", ecosystems: "All" },
    "unknown-choice": { area: "Names and lookups", severity: "error", description: "The value must come from a fixed list and is not in it.", ecosystems: "All" },
    "ambiguous": { area: "Names and lookups", severity: "error", description: "More than one thing fits and the system will not guess; the message lists them and says how to pick.", ecosystems: "All" },
    "name-taken": { area: "Names and lookups", severity: "error", description: "The name is already used.", ecosystems: "All" },
    "invalid-name": { area: "Names and lookups", severity: "error", description: "The name is not allowed in the ecosystem.", ecosystems: "All" },
    "invalid-value": { area: "Edits", severity: "error", description: "The value given cannot be what the property takes; nothing is written.", ecosystems: "All" },
    "read-only": { area: "Edits", severity: "error", description: "That device or property cannot be changed by the user.", ecosystems: "All" },
    "edit-refused": { area: "Edits", severity: "error", description: "The edit would leave the workfile broken, so nothing is written; the message says why.", ecosystems: "All" },
    "needs-force": { area: "Edits", severity: "warning", description: "The command would affect more than its target, or replace something; it shows what would happen and does it only with --force.", ecosystems: "All" },
    "unchecked": { area: "Edits", severity: "warning", description: "The edit was made, but could not be checked against a definition.", ecosystems: "All" },
    "missing-required": { area: "Validation", severity: "error or warning", description: "A required value has no value; a warning where the definition only suggests it.", ecosystems: "All" },
    "out-of-range": { area: "Validation", severity: "error or warning", description: "A value is outside what the definition allows: type, range, number of items.", ecosystems: "All" },
    "bad-reference": { area: "Validation", severity: "error or warning", description: "A reference points to something missing, of the wrong type, or of the wrong capability.", ecosystems: "All" },
    "rule-violation": { area: "Validation", severity: "error or warning", description: "A rule of the device definitions is broken, or can never apply.", ecosystems: "CAPI" },
    "resource-conflict": { area: "Validation", severity: "error or warning", description: "Two devices use the same resource.", ecosystems: "All" },
    "dependency-cycle": { area: "Validation", severity: "error", description: "Devices depend on each other in a loop, so the output cannot be generated.", ecosystems: "CAPI" },
    "unresolved": { area: "Validation", severity: "warning", description: "The system could not settle something by itself and left it to the user; the message says what to choose.", ecosystems: "All" },
    "not-generated": { area: "Output", severity: "error", description: "The step before this one has not been done; the message names it.", ecosystems: "All" },
    "output-missing": { area: "Output", severity: "warning", description: "The tool reported success, but the output is not where it should be.", ecosystems: "All" },
    "generate-failed": { area: "Output", severity: "error", description: "The project could not be rendered from the workfile.", ecosystems: "CAPI" },
    "definition-error": { area: "Output", severity: "error", description: "The device definitions themselves are inconsistent: a problem for whoever maintains them, not the user's workfile.", ecosystems: "All" },
    "cancelled": { area: "Process", severity: "error", description: "The user stopped a question; answers already given are kept.", ecosystems: "All" },
    "internal-error": { area: "Process", severity: "error", description: "The tool itself failed: a bug, reported with what is known.", ecosystems: "All" },
} as const satisfies Record<string, ErrorTypeInfo>;

export type ErrorType = keyof typeof ERROR_TYPES;

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;
    const { ERROR_TYPE_NAMES } = await import("attach-no-os-lib");

    test("attach-no-os-lib has the same error types", () => {
        expect([...ERROR_TYPE_NAMES].sort()).toEqual(Object.keys(ERROR_TYPES).sort());
    });
}
