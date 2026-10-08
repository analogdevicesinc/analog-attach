import { CONFIG_REGISTRY } from "../../config";
import { LIST_KINDS } from "../list/command";

// Single source of truth for value completion.
//
// Command names, flag names and their descriptions are read directly from the
// commander program (see `complete.ts`), so they are never duplicated here.
// This table only carries the knowledge commander cannot express: which
// positional or flag value should be completed as a file, a directory, a fixed
// set of choices, or a dynamic `suggest` lookup.
//
// A command that needs no value completion (only its flag names) is listed in
// `NO_VALUE_COMPLETION` instead of getting an empty entry. The drift test in
// `completion-drift.test.ts` asserts that every registered command appears in
// exactly one of the two, and that every flag named here really exists.

// Directive lines the engine prints to ask the shell stub to run its own native
// path completion, instead of the engine trying to enumerate the filesystem.
export const FILES_DIRECTIVE = "__ATTACH_COMPLETE_FILES__";
export const DIRS_DIRECTIVE = "__ATTACH_COMPLETE_DIRS__";

// "entry-points" is completion-only: `suggest navigate` with no node (the overlay's top-level targets).
export type SuggestKind = "device-key" | "parent" | "navigate" | "entry-points" | "children" | "value";

export type ValueSource =
    | { kind: "file" }
    | { kind: "dir" }
    | { kind: "values"; values: readonly string[] }
    // Fixed choices with a description each.
    | { kind: "choices"; choices: readonly { value: string; description: string }[] }
    | { kind: "suggest"; suggest: SuggestKind };

export interface CommandSpec {
    // How to complete positional arguments.
    //  - "all":     every positional uses the same source (add → device-key,
    //               read/update/delete → navigate).
    //  - "byIndex": the Nth positional uses sources[N]; anything past the list
    //               uses `rest` if given, else nothing.
    positional?:
        | { mode: "all"; source: ValueSource }
        | { mode: "byIndex"; sources: readonly ValueSource[]; rest?: ValueSource };
    // Value completion for specific flags, keyed by the option's long form.
    flags?: Readonly<Record<string, ValueSource>>;
    // Completion for the further words of a variadic flag (its first word uses
    // `flags`); the words given so far are passed as context. When it yields
    // nothing, the remaining flags are offered instead.
    flag_rest?: Readonly<Record<string, ValueSource>>;
}

const FILE: ValueSource = { kind: "file" };
const CONFIG_SET_FIELDS: ValueSource = {
    kind: "values",
    values: CONFIG_REGISTRY.filter(spec => !spec.internal && spec.env === undefined).map(spec => spec.toml),
};
const CONFIG_GET_FIELDS: ValueSource = {
    kind: "values",
    values: CONFIG_REGISTRY.filter(spec => !spec.internal).map(spec => spec.toml),
};

const NAV: ValueSource = { kind: "suggest", suggest: "navigate" };
const VAL: ValueSource = { kind: "suggest", suggest: "value" };

export const COMPLETION_SPEC: Readonly<Record<string, CommandSpec>> = {
    add: {
        positional: { mode: "byIndex", sources: [{ kind: "suggest", suggest: "device-key" }] },
        flags: { "--parent": { kind: "suggest", suggest: "parent" } },
    },
    read: {
        positional: { mode: "byIndex", sources: [NAV, NAV] },
    },
    update: {
        positional: { mode: "byIndex", sources: [NAV, NAV], rest: VAL },
    },
    delete: {
        positional: { mode: "byIndex", sources: [NAV, NAV] },
    },
    move: {
        positional: { mode: "byIndex", sources: [NAV] },
        flags: { "--parent": { kind: "suggest", suggest: "entry-points" } },
    },
    rename: {
        positional: { mode: "byIndex", sources: [NAV] },
    },
    enable: {
        positional: { mode: "byIndex", sources: [NAV] },
    },
    disable: {
        positional: { mode: "byIndex", sources: [NAV] },
    },
    validate: {
        positional: { mode: "byIndex", sources: [NAV] },
    },
    list: {
        positional: {
            mode: "byIndex",
            sources: [{
                kind: "choices",
                choices: LIST_KINDS.map(entry => ({ value: entry.kind, description: entry.summary })),
            }],
        },
    },
    "get-schema": {
        flags: { "--compatible": { kind: "suggest", suggest: "device-key" } },
    },
    completion: {
        positional: { mode: "byIndex", sources: [{ kind: "values", values: ["bash", "fish", "zsh"] }] },
    },
    "config-get": {
        positional: { mode: "all", source: CONFIG_GET_FIELDS },
    },
    "config-set": {
        positional: { mode: "byIndex", sources: [CONFIG_SET_FIELDS, FILE] },
    },
};

export const NO_VALUE_COMPLETION: readonly string[] = [
    "__list",
    "build",
    "deploy",
    "attach-manifest",
    "create-workfile",
    "validate2",
    "install-skill",
    "uninstall-skill",
];
