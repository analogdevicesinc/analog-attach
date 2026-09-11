/**
 * Our side of the attach-meta manifest protocol.
 *
 * Registration is one round trip: attach-meta runs `<binary> attach-manifest`, reads a
 * single path from stdout, validates the file at that path against its manifest
 * meta-schema, hashes it, and remembers both in `.attach-meta.toml`. From then on every
 * dispatch prepends the `argv` we declared here and appends attach-meta's own validated
 * arguments.
 *
 * Two facts about that dispatch shape the whole CLI:
 *
 *  - Nothing is ever *inserted* into our argv, only appended. So `--json` has to be part
 *    of the prefix we declare, which is what makes the protocol path always emit JSON
 *    while the same routes stay human-readable when a person types them.
 *  - `generate`, `build`, `deploy`, `create-workfile`, `list-devices`, `validate` and
 *    `list-intelligence` are dispatched with *zero* arguments (aa-meta drops positionals
 *    and flags for them), so everything they need comes from tool config.
 */

import path from "node:path";
import { get_settings_file_path } from "attach-no-os-lib";

/**
 * Protocol major must equal attach-meta's own crate major (`check_major_match`), which is
 * 1. test/protocol.test.ts validates the emitted manifest against aa-meta's meta-schema
 * so a drift here fails loudly instead of at dispatch time.
 */
export const PROTOCOL_VERSION = "1.0.0";

/** Not part of the manifest (its root is closed) — used for `aa --version` and help. */
export const TOOL_VERSION = "0.1.0";
export const TOOL_NAME = "attach-no-os";
export const TOOL_DESCRIPTION = "Analog Attach CLI for no-OS workfiles";

/**
 * The commands attach-meta knows. Absence from a manifest *is* how a tool says it does
 * not implement one — there is no `supported: false` any more.
 */
export type CommandName =
    | "read"
    | "add"
    | "delete"
    | "move"
    | "update"
    | "rename"
    | "alias"
    | "validate"
    | "generate"
    | "build"
    | "deploy"
    | "list-devices"
    | "create-workfile"
    | "tool-config-get"
    | "tool-config-set"
    | "list-intelligence"
    | "suggest";

/**
 * Suggestion kinds we advertise via `list-intelligence`.
 *
 * `path` and `config-field` are deliberately position-agnostic: aa-meta's completion
 * looks up exactly one kind per command for *every* positional slot
 * (`completions[arg == subcommand]`), so a single kind has to serve "which node",
 * "which property", "which field" and "which value" and decide from how many preceding
 * arguments it was handed.
 *
 * aa-meta reserves kinds of its own (`attachable`, which lists the attachables on PATH) and
 * merges them with ours. A collision is not an error — it warns and keeps its own — so none
 * of these may be spelled like a reserved kind.
 */
export const SUGGEST_KINDS = {
    /** Positional path segments: 0 args → node keys, 1 arg → that node's properties. */
    path: "path",
    /** Device keys accepted by `add --key`. */
    device: "device",
    /** Candidate values for `update <node> <property> --with`. */
    value: "value",
    /** 0 args → config field names, 1 arg → that field's candidate values. */
    config_field: "config-field",
    platform: "platform",
    board: "board",
} as const;

export type CompletionEntry = {
    /**
     * A flag name (without `--`) for flag-value completion, or the command name for
     * positionals — the two roles aa-meta's `__complete` tells apart by whether the word
     * before the one being completed is a flag. A base schema's `x-positional` field is
     * *not* named here: the command name stands in for it.
     */
    arg: string;
    kind: string;
};

export type CommandMapping = {
    /** What this command does in this tool's terms; aa-meta shows it when explaining commands. */
    description?: string;
    argv: string[];
    /**
     * Additive JSON Schema for extra optional args. We declare none: the protocol base
     * schemas already cover every input our commands can actually receive, and the
     * commands that would want more (`create-workfile`, `generate`, `build`, `deploy`)
     * have their arguments dropped by aa-meta before dispatch regardless.
     */
    args?: Record<string, unknown>;
    timeout_ms?: number;
    completions?: CompletionEntry[];
};

export type Manifest = {
    protocol_version: string;
    commands: Partial<Record<CommandName, CommandMapping>>;
};

/** Long enough for a cold schema scan, short enough that a wedged process is noticed. */
const DEFAULT_TIMEOUT_MS = 60_000;

/** Completion runs synchronously in the user's shell, so it gets a much tighter leash. */
const COMPLETION_TIMEOUT_MS = 10_000;

export const MANIFEST_FILENAME = "attach-manifest.json";

/**
 * Where the manifest is written. Alongside the settings file, so the test override for
 * the config path relocates the manifest too.
 */
export function get_manifest_path(): string {
    return path.join(path.dirname(get_settings_file_path()), MANIFEST_FILENAME);
}

/**
 * How attach-meta should spawn us.
 *
 * It calls `Command::new(argv[0])` directly — no shell, no PATH games beyond what execvp
 * does — so `argv[0]` has to be either a name on PATH or an absolute path. Naming the
 * node binary and the script we were actually invoked as works for a global install and
 * for a local `node dist/cli.js` checkout alike; the trade-off is that the manifest pins
 * that interpreter path, so re-run `aa attach-manifest` after moving or upgrading node.
 */
function invocation_prefix(): string[] {
    const script = process.argv[1];
    return script ? [process.execPath, script] : ["aa"];
}

/**
 * Every command maps to one route word spelled exactly like the protocol name, plus
 * `--json` so the response is the protocol shape rather than the human rendering.
 *
 * `move` is declared even though a flat symbol table has no parents, and it answers
 * `ok: false`. That is on purpose: when `move` is *absent*, aa-meta substitutes its own
 * read → add → update → delete-`--force` fallback, which fails partway through and
 * leaves the workfile half-rewritten. A clean refusal is strictly better than that.
 *
 * `alias` is the opposite case — absent from the manifest, aa-meta refuses it up front
 * without touching the workfile, so there is nothing for us to improve on.
 */
export function build_manifest(): Manifest {
    const prefix = invocation_prefix();
    const map = (
        route: string,
        description: string,
        extra?: Omit<CommandMapping, "argv" | "description">,
    ): CommandMapping => ({
        description,
        argv: [...prefix, route, "--json"],
        timeout_ms: DEFAULT_TIMEOUT_MS,
        ...extra,
    });

    // Positional completion is keyed by the command's own name, so each command needs
    // its own entry even though they all complete the same thing.
    const positional_path = (command: string): CompletionEntry[] => [
        { arg: command, kind: SUGGEST_KINDS.path },
    ];

    return {
        protocol_version: PROTOCOL_VERSION,
        commands: {
            "tool-config-get": map(
                "tool-config-get",
                "Read the CLI's settings: where the workfile and no-OS tree are, which board and template set to use.",
                { completions: [{ arg: "tool-config-get", kind: SUGGEST_KINDS.config_field }] },
            ),
            "tool-config-set": map(
                "tool-config-set",
                "Write one setting. Every command's inputs come from here, since the protocol commands take no options of their own.",
                { completions: [{ arg: "tool-config-set", kind: SUGGEST_KINDS.config_field }] },
            ),
            "create-workfile": map(
                "create-workfile",
                "Start an empty workfile at the configured path, targeting the configured board or platform.",
            ),
            "list-devices": map(
                "list-devices",
                "List the schemas a node can be an instance of: no-OS drivers, platform peripherals and core types.",
            ),
            add: map(
                "add",
                "Instantiate a schema as a named node. The device key is the schema; the workfile is flat, so --to may only name the root.",
                {
                    completions: [
                        { arg: "add", kind: SUGGEST_KINDS.device },
                        { arg: "to", kind: SUGGEST_KINDS.path },
                    ],
                },
            ),
            read: map(
                "read",
                "Read the whole workfile, one node's properties, or one property. Paths are at most <node> <property> deep.",
                { completions: positional_path("read") },
            ),
            update: map(
                "update",
                "Set one property of one node. Properties are fixed by the node's schema, so an unknown name is refused rather than inserted.",
                {
                    completions: [
                        { arg: "update", kind: SUGGEST_KINDS.path },
                        { arg: "with", kind: SUGGEST_KINDS.value },
                    ],
                },
            ),
            delete: map(
                "delete",
                "Remove a node, or clear one property's value. A node other nodes reference needs --force, which clears those references too.",
                { completions: positional_path("delete") },
            ),
            rename: map(
                "rename",
                "Rename a node, rewriting every reference to it. Properties cannot be renamed: their names are the C struct's field names.",
                { completions: positional_path("rename") },
            ),
            move: map(
                "move",
                "Not supported: the workfile is a flat symbol table, so no node has a parent to move between.",
                {
                    completions: [
                        ...positional_path("move"),
                        { arg: "to", kind: SUGGEST_KINDS.path },
                    ],
                },
            ),
            validate: map(
                "validate",
                "Check every node against its schema and report what is missing, unset or inconsistent.",
            ),
            generate: map(
                "generate",
                "Render the workfile into a buildable no-OS project: sources, headers, CMake and Kconfig.",
                { timeout_ms: undefined },
            ),
            build: map(
                "build",
                "Build the generated project with no-OS's CMake flow, producing a flashable binary.",
                { timeout_ms: undefined },
            ),
            deploy: map(
                "deploy",
                "Flash the built binary to the configured board with the configured debug probe.",
                { timeout_ms: undefined },
            ),
            "list-intelligence": map(
                "list-intelligence",
                "List the suggestion kinds this tool answers, and what arguments each one takes.",
                { timeout_ms: COMPLETION_TIMEOUT_MS },
            ),
            suggest: map(
                "suggest",
                "Answer one suggestion kind: node names, a node's properties, a property's candidate values, device keys, settings.",
                { timeout_ms: COMPLETION_TIMEOUT_MS },
            ),
        },
    };
}
