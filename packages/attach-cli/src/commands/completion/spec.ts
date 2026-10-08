import { CONFIG_REGISTRY } from "../../config";
import { INTELLIGENCE_KINDS } from "../list-intelligence/command";

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

export const COMPLETION_SPEC: Readonly<Record<string, CommandSpec>> = {
    add: {
        // One compatible at most; after it only flags remain.
        positional: { mode: "byIndex", sources: [{ kind: "suggest", suggest: "device-key" }] },
        flags: { "--to": { kind: "suggest", suggest: "parent" } },
        // `--to spi0 adc@0` is `spi0/adc@0`: each further segment is a child of the path so far.
        flag_rest: { "--to": { kind: "suggest", suggest: "children" } },
    },
    read: {
        positional: { mode: "all", source: { kind: "suggest", suggest: "navigate" } },
    },
    update: {
        positional: { mode: "all", source: { kind: "suggest", suggest: "navigate" } },
        // The positionals are the prop-ref, so `suggest value` sees the property being set.
        flags: { "--with": { kind: "suggest", suggest: "value" } },
    },
    delete: {
        positional: { mode: "all", source: { kind: "suggest", suggest: "navigate" } },
    },
    move: {
        positional: { mode: "all", source: { kind: "suggest", suggest: "navigate" } },
        // The destination starts at an overlay entry point (spi0, i2c1, …); like
        // `add --to`, each further segment is a child of the path so far.
        flags: { "--to": { kind: "suggest", suggest: "entry-points" } },
        flag_rest: { "--to": { kind: "suggest", suggest: "children" } },
    },
    suggest: {
        // The kinds are exactly what list-intelligence reports; the description is
        // the first sentence of each kind's (a period after "e.g." or "i.e." doesn't end it).
        positional: {
            mode: "byIndex",
            sources: [{
                kind: "choices",
                choices: INTELLIGENCE_KINDS.map(entry => ({ value: entry.kind, description: entry.description.split(/(?<=[^.\s]{2}\.)\s/)[0]! })),
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

// Commands that complete their flag names but have no value completion.
export const NO_VALUE_COMPLETION: readonly string[] = [
    "validate",
    "rename",
    "enable",
    "disable",
    "build",
    "deploy",
    "attach-manifest",
    "create-workfile",
    "list-devices",
    "validate2",
    "list-intelligence",
    "install-skill",
    "uninstall-skill",
];
