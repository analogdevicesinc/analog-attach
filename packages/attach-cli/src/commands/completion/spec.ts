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

export type SuggestKind = "device-key" | "parent" | "navigate";

export type ValueSource =
    | { kind: "file" }
    | { kind: "dir" }
    | { kind: "values"; values: readonly string[] }
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
}

const FILE: ValueSource = { kind: "file" };
const DIR: ValueSource = { kind: "dir" };
const CONFIG_FIELDS: ValueSource = { kind: "values", values: ["linux", "dt-schema", "context", "overlay"] };

// Flags shared by many commands.
const FILE_CONTEXT = { "--overlay": FILE, "--context": FILE } as const;
const LINUX_SCHEMA_DIRS = { "--linux": DIR, "--dt-schema": DIR } as const;

export const COMPLETION_SPEC: Readonly<Record<string, CommandSpec>> = {
    add: {
        positional: { mode: "all", source: { kind: "suggest", suggest: "device-key" } },
        flags: { ...FILE_CONTEXT, ...LINUX_SCHEMA_DIRS, "--to": { kind: "suggest", suggest: "parent" } },
    },
    read: {
        positional: { mode: "all", source: { kind: "suggest", suggest: "navigate" } },
        flags: { ...FILE_CONTEXT },
    },
    update: {
        positional: { mode: "all", source: { kind: "suggest", suggest: "navigate" } },
        flags: { ...FILE_CONTEXT, ...LINUX_SCHEMA_DIRS },
    },
    delete: {
        positional: { mode: "all", source: { kind: "suggest", suggest: "navigate" } },
        flags: { ...FILE_CONTEXT },
    },
    validate: {
        flags: { ...FILE_CONTEXT, ...LINUX_SCHEMA_DIRS },
    },
    move: {
        flags: { ...FILE_CONTEXT },
    },
    rename: {
        flags: { ...FILE_CONTEXT },
    },
    enable: {
        flags: { ...FILE_CONTEXT },
    },
    disable: {
        flags: { ...FILE_CONTEXT },
    },
    "get-schema": {
        flags: { "--compatible": { kind: "suggest", suggest: "device-key" }, "--context": FILE, ...LINUX_SCHEMA_DIRS },
    },
    build: {
        flags: { "--overlay": FILE },
    },
    deploy: {
        flags: { "--dtbo": FILE },
    },
    completion: {
        positional: { mode: "byIndex", sources: [{ kind: "values", values: ["bash", "fish", "zsh"] }] },
    },
    "config-get": {
        positional: { mode: "all", source: CONFIG_FIELDS },
    },
    "config-set": {
        positional: { mode: "byIndex", sources: [CONFIG_FIELDS, FILE] },
    },
};

// Commands that complete their flag names but have no value completion.
export const NO_VALUE_COMPLETION: readonly string[] = [
    "attach-manifest",
    "create-workfile",
    "list-devices",
    "validate2",
    "list-intelligence",
    "suggest",
    "install-skill",
    "uninstall-skill",
];
