/**
 * The interface between the `analog-attach` front end and an ecosystem backend (linux, noos).
 *
 * See packages/cli/docs/merged-cli-design.md.
 *
 * The split:
 *
 * - The front end owns what a user sees: argv and the grammar of the shared commands, help,
 *   `--json`, exit statuses, the settings files (global and project-local, `--global`,
 *   `--reset`), the `backend` setting, prompts, colours, the shell stub and `__complete`,
 *   installing skills, and the bare `analog-attach` run.
 * - A backend is a library. It never reads argv or the settings files, never touches
 *   stdout or stderr itself, and never opens a prompt itself. It gets parsed arguments and
 *   a `Session`, and returns an `Outcome`: the JSON response and the text to print instead
 *   of it. What it has to say before the end (an interactive command's lines between its
 *   questions) goes through `session.say`, notes and warnings through `session.warn`.
 *
 * A backend never depends on a CLI framework: the commands only it has (`move`, `generate`)
 * are declared as data too (`ExtraCommand`), and the front end turns them into routes.
 */

import type { CommonResponse, Responses, SetupResponse, Severity } from "./backend-responses";

// =====================================================================================
// Outcome: what a command returns
// =====================================================================================

/** Text styles, no-ops when stdout is not a terminal. */
export interface Style {
    bold(text: string): string;
    dim(text: string): string;
    cyan(text: string): string;
    red(text: string): string;
    yellow(text: string): string;
}

/** The text mode's output, rendered only when it is printed. */
export type Render = (style: Style) => string;

/**
 * A value, or how to get it. The front end forces it only when it prints it, so a text run
 * never builds the JSON response (`add`'s `missing_required` runs the intelligence stack
 * once per property; the interview asks for each as it comes) and a JSON run never renders
 * the text. A thunk runs after `run` has returned and must capture what it needs rather
 * than read the workfile again.
 */
export type Lazy<T> = T | (() => T | Promise<T>);

/**
 * How a command ended. The front end prints and picks the exit status:
 *
 * - `answer`: exit 0. `response` on stdout under `--json`, `text` otherwise. Both are
 *   lazy (`Lazy`, and a `Render` is only called when printed). `text` is what is left to
 *   print after what `run` already said through `session.say`: an interactive command
 *   has often said everything and gives `""`.
 * - `refused`: the command ran and says no. Exit 0 too, the response has `ok: false`. It is
 *   a plain `CommonResponse` whatever the command, which is also how `read` and `validate`,
 *   whose responses have no `ok`, refuse.
 * - `input-error`: what was typed can't be run (a bad value token, a missing argument the
 *   grammar can't express). The message on stderr, exit 2, in both modes.
 * - `cancelled`: a prompt was stopped before anything was written. The message on stdout,
 *   exit 130.
 *
 * Anything thrown is a crash: the message on stderr, exit 1.
 */
export type Outcome<R> =
    | { kind: "answer"; response: Lazy<R>; text: Render }
    | { kind: "refused"; response: CommonResponse & { ok: false }; text: Render }
    | { kind: "input-error"; message: string }
    | { kind: "cancelled"; message: string };

export function answer<R>(response: Lazy<R>, text: string | Render): Outcome<R> {
    return { kind: "answer", response, text: typeof text === "string" ? () => text : text };
}

/** The command ran and says no: `ok: false`, severity `error` unless told, the message as the text unless told. */
export function refuse(message: string, options: { severity?: Severity; text?: string | Render } = {}): Outcome<never> {
    const { severity = "error", text = message } = options;
    return { kind: "refused", response: { ok: false, message, severity }, text: typeof text === "string" ? () => text : text };
}

export function input_error(message: string): Outcome<never> {
    return { kind: "input-error", message };
}

export function cancelled(message: string): Outcome<never> {
    return { kind: "cancelled", message };
}

// =====================================================================================
// Session: what the front end gives every call
// =====================================================================================

export interface Session {
    /**
     * The name to put in hints: `analog-attach`. A backend never spells it in a message
     * itself (`Run '${program} init'`).
     */
    readonly program: string;
    /**
     * `complete` is a `__complete` call: no prompter, and `warn` and `progress` print
     * nothing, since the shell owns the terminal.
     */
    readonly mode: "text" | "json" | "complete";
    readonly cwd: string;
    readonly settings: SettingsView;
    /**
     * The backend's directory for derived state (Linux: the binding caches, the
     * preprocessed base). Project-local, e.g. `.analog-attach/linux/`; the backend creates it when it
     * first writes.
     */
    readonly state_dir: string;
    /** Where the backend's bundled files are (Linux: dt-schema, dtc, dt-validate). */
    readonly assets_dir: string;
    /**
     * Undefined when nothing may be asked: `--json`, `--quiet`, not a terminal. A backend
     * that needs an answer it can't get lists what is left instead.
     */
    readonly prompter?: Prompter;
    readonly style: Style;
    /**
     * A line of result text, printed now, in order with the prompts: what an interactive
     * command says between its questions (`add`: its notes and `Added …` before the
     * interview, the values it filled in without asking, what is still missing after).
     * Text mode only, and only while `prompter` is defined: a piped or `--json` run writes
     * stdout once, from the `Outcome`, and the front end throws if `say` is called without
     * a prompter.
     */
    say(line: string | Render): void;
    /**
     * One line on stderr, in every mode: a note, a warning, a hint. Notes and warnings
     * never share stdout with the result (COM-021/COM-022, revised: today's human mode
     * puts them on stdout except `update`'s; the merged CLI does what `update` does).
     */
    warn(message: string): void;
    /** A long step on stderr (building the binding caches, cmake). */
    progress(label: string): Progress;
    /** Aborted on Ctrl-C outside a prompt, for child processes and servers. */
    readonly signal: AbortSignal;
}

export interface Progress {
    update(detail: string): void;
    /** A child's output, passed through line by line (cmake, dt-validate). */
    line(text: string): void;
    done(summary?: string): void;
}

// =====================================================================================
// Settings
// =====================================================================================

/**
 * A setting the backend reads. The front end stores it (JSON, kebab-case keys, local wins
 * over global, D-02) in the backend's section of the settings files, an object named after
 * `Backend.id` (`{ "backend": "linux", "linux": { "devicetree": "…" } }`), so two backends
 * can each have a `workfile`. It lists it in `analog-attach config`, completes its values
 * and asks for it nowhere on its own: the backend's `setup` decides what the bare
 * `analog-attach` asks.
 *
 * `backend` itself is the front end's, at the top level, and never appears in a backend's list.
 */
export interface SettingSpec {
    /** kebab-case, as stored and as `analog-attach config` takes it. */
    key: string;
    /** The group `analog-attach config` lists it under, in the order of first appearance. */
    category: string;
    description: string;
    type: "path" | "path_list" | "string" | "numeric" | "bool";
    /**
     * Fixed options, or `dynamic`: asked from `SettingsHooks.options` (no-OS platforms,
     * boards and templates, which are scanned).
     */
    options?: readonly string[] | "dynamic";
    /** Display only: what a command needs is decided by the command. */
    required: boolean;
    default?: string;
    /** For a `path`: whether `analog-attach config` refuses one that doesn't exist (Linux `workfile` accepts a new file). */
    must_exist?: boolean;
    /** Printed when the setting is missing or invalid. */
    hint?: string;
    /**
     * Only the project's file may hold it (`backend`: the ecosystem belongs to the project). A
     * global write is refused, and a global value is left out and reported.
     */
    project_only?: boolean;
}

/**
 * The active backend's settings: its section of each file, plus the front end's `backend`.
 * Another backend's section is never seen through it, nor changed by it.
 */
export interface SettingsView {
    /**
     * The effective value: local, then global, then the default, the files layered section
     * by section. Always a string, as on
     * disk; `numeric` and `bool` are parsed by the reader. Paths are absolute: a local
     * setting's relative path is resolved against the project root (the directory that
     * holds `.analog-attach/`), and a global setting's path is absolute or starts with `~`, since
     * `analog-attach config --global` refuses a relative one (exit 2). Undefined for a `path_list`.
     */
    get(key: string): string | undefined;
    /** A `path_list`: stored as a JSON array, each entry resolved as `get` resolves a path. */
    paths(key: string): readonly string[] | undefined;
    /** Where the effective value comes from, for messages. */
    origin(key: string): { scope: "local" | "global"; file: string } | "default" | "unset";
    /**
     * Writes one setting, through the checks of `analog-attach config <key> <value>`: the
     * `SettingSpec` (type, options, `must_exist`), then `SettingsHooks.check`, whose `also`
     * settings go in the same write. It never runs `SettingsHooks.changed`: a backend that
     * writes a setting rebuilds what depends on it itself, when it needs to (the Linux
     * setup run builds the binding caches only when they aren't current). Used by `setup`
     * and by commands that change the configured workfile (Linux `import`).
     */
    set(key: string, value: string | readonly string[], scope?: "local" | "global"): Promise<SettingWrite>;
    reset(key: string, scope?: "local" | "global"): Promise<SettingWrite>;
}

export type SettingWrite = { ok: true; file: string } | { ok: false; message: string };

/**
 * Optional hooks into `analog-attach config`. Without them a setting is checked only against its
 * `SettingSpec` (type, options, `must_exist`).
 */
export interface SettingsHooks {
    /** The options of a `dynamic` setting. */
    options?(key: string, session: Session): Promise<string[]>;
    /**
     * Before a write. `also` are settings to change with it, in the same write (a setting
     * another one follows from); `null` resets one. `scope` is the file the write goes to,
     * so a hook can tell which of the other settings it leaves in effect.
     */
    check?(key: string, value: string, session: Session, scope: "local" | "global"): Promise<
        | { ok: true; also?: Readonly<Record<string, string | null>> }
        | { ok: false; message: string }
    >;
    /**
     * After `analog-attach config <key> <value>` or `analog-attach config <key> --reset`
     * wrote, and only then (`SettingsView.set` never calls it): rebuild what depends on
     * the keys (Linux: `linux` rebuilds the binding caches). An outcome takes the place of
     * the front end's own answer (`Set linux = …`), so the command ends with one;
     * `undefined` keeps it.
     */
    changed?(keys: readonly string[], session: Session): Promise<Outcome<CommonResponse> | undefined>;
    /** `analog-attach config --reload`. Without it, `--reload` says there is nothing to rebuild. */
    reload?(session: Session): Promise<Outcome<CommonResponse>>;
}

// =====================================================================================
// Prompts
// =====================================================================================

export interface Choice<T> {
    name: string;
    value: T;
    description?: string;
    /** Shown but not pickable; a string says why. */
    disabled?: boolean | string;
}

/**
 * Thrown by every prompt on Ctrl-C or Ctrl-D. Uncaught, the front end prints its message
 * on stdout and exits 130, as `cancelled()` does. A prompt throws it with no message
 * (`Cancelled.`); a backend may rethrow one with its own (`Setup cancelled.`).
 *
 * Uncaught means nothing was written. A command that has already written something must
 * catch it and return an `answer`: `add` after the node is saved exits 0, the node added.
 */
export class PromptCancelled extends Error {
    constructor(message = "Cancelled.") {
        super(message);
        this.name = "PromptCancelled";
    }
}

/**
 * Prompts, as @inquirer/prompts has them (D-08). A test passes its own.
 *
 * `terminal` is the way out for what no prompt type covers: Linux's in-place editing of a
 * multi-cell value (each cell asked under the value so far, then erased). It is there only
 * when stdin and stdout are a terminal, and a backend must fall back to plain prompts
 * without it.
 */
export interface Prompter {
    select<T>(question: { message: string; choices: readonly Choice<T>[]; default?: T; page_size?: number }): Promise<T>;
    input(question: {
        message: string;
        default?: string;
        /** `true`, or why the answer is refused (asked again). */
        validate?(answer: string): true | string;
        /** Tab completion on what is typed so far (Linux: the parent question completes paths). */
        complete?(partial: string): Promise<string[]>;
    }): Promise<string>;
    confirm(question: { message: string; default?: boolean }): Promise<boolean>;
    /** Several picks from a list (no-OS setup). `required`: at least one must be picked. */
    checkbox<T>(question: { message: string; choices: readonly Choice<T>[]; required?: boolean }): Promise<T[]>;
    /** A list narrowed as the user types (Linux: the .dts picker). */
    search<T>(question: { message: string; source(term: string, signal: AbortSignal): Promise<readonly Choice<T>[]> }): Promise<T>;
    readonly terminal?: RawTerminal;
}

export interface RawTerminal {
    readonly input: NodeJS.ReadStream;
    readonly output: NodeJS.WriteStream;
}

// =====================================================================================
// Completion
// =====================================================================================

/**
 * What the word being completed is. The front end completes command and flag names
 * itself, knows which slot each positional of a shared command is, and asks the backend
 * for the rest. The word is passed whole: a backend that completes a path segment by
 * segment (Linux) returns whole words, marking a stem with `partial`.
 */
export type Slot =
    /** `read`, `update`, `delete`, `rename`, `list property` and `list value`'s node. */
    | { kind: "path"; command: string }
    /** `read`, `update`, `list property` and `list value`: any property; `delete`: only what the workfile sets. */
    | { kind: "property"; command: string; path: string }
    /** `update`'s value tokens and `list value`'s member; `prior` are the tokens typed before it. */
    | { kind: "value"; command: string; path: string; property: string; prior: readonly string[] }
    /** `add`'s device and `list devices`' filter. */
    | { kind: "device"; command: string }
    /** `import`'s source. */
    | { kind: "source" }
    /** A flag's value, on a shared command or an extra one (`add --parent`, `build --board`). */
    | { kind: "flag"; command: string; flag: string; prior: readonly string[] }
    /** A positional of an extra command, named by the command (`move`'s destination). */
    | { kind: "extra"; command: string; id: string; prior: readonly string[] };

export interface Candidate {
    value: string;
    /** Shown next to the value by zsh and fish. */
    description?: string;
    /** The heading it is listed under (zsh); bash and fish ignore it. */
    group?: string;
    /** Completion adds no space after it. */
    partial?: boolean;
}

/**
 * What `complete` offers. `fallback` lets the shell complete file or directory names too,
 * after the candidates (Linux `import <source>`: the overlays of the index, or any file).
 * The front end uses the same for its own path settings in `analog-attach config`.
 */
export interface Completion {
    candidates: Candidate[];
    fallback?: "files" | "dirs";
}

// =====================================================================================
// Commands
// =====================================================================================

export type FlagSpec =
    | { kind: "boolean"; brief: string; hidden?: boolean }
    | { kind: "value"; brief: string; placeholder: string; hidden?: boolean }
    /** Repeatable, or one comma-separated value: no-OS `add --as adc,dac`. */
    | { kind: "values"; brief: string; placeholder: string; hidden?: boolean };

/**
 * `json` and `help` are the front end's, on every command. `quiet` is an argument of the
 * commands that have it (each says what it means there), not a backend flag.
 */
export type FlagSpecs = Readonly<Record<string, FlagSpec>>;

export type FlagValues<S extends FlagSpecs> = {
    readonly [K in keyof S]?: S[K] extends { kind: "boolean" } ? boolean
        : S[K] extends { kind: "values" } ? readonly string[]
        : string;
};

/** Help where the backend's words differ from the shared ones. */
export interface CommandDocumentation {
    brief?: string;
    full?: string;
    /** Placeholders by argument name: `{ device: "compatible" }` on Linux, `{ device: "schema" }` on no-OS. */
    placeholders?: Readonly<Record<string, string>>;
    /** Examples for the help, without the program name. */
    examples?: readonly string[];
}

/**
 * A backend's implementation of a shared command. `S` are the flags it adds to the
 * command (Linux: `add --parent --label --template`; no-OS: `add --as`, `build --board
 * --clean`). The front end shows only the active backend's.
 *
 * `run` is a method, so a `CommandImpl` with specific flags fits the `FlagSpecs` slot in
 * `Commands`; `command()` infers `S` from the specs.
 */
export interface CommandImpl<A, R, S extends FlagSpecs = FlagSpecs> {
    readonly flags?: S;
    readonly docs?: CommandDocumentation;
    run(arguments_: A, flags: FlagValues<S>, session: Session): Promise<Outcome<R>>;
}

export function command<A, R, S extends FlagSpecs = Record<never, never>>(impl: CommandImpl<A, R, S>): CommandImpl<A, R, S> {
    return impl;
}

// The arguments of the shared commands: the positionals, named, as the grammar has them,
// plus `quiet` where it exists. Paths, property names and values are the raw words: the
// backend parses them (Linux `spi0/adc@0`, no-OS a flat node name).

export type InitArguments = Readonly<Record<never, never>>;
export interface ListDevicesArguments { readonly filter?: string }
export type ListContextArguments = Readonly<Record<never, never>>;
/** No-OS takes only `[node]`; it refuses a property. */
export interface ListPropertyArguments { readonly path?: string; readonly property?: string }
/** `member`: a union member (no-OS). Linux refuses one. */
export interface ListValueArguments { readonly path: string; readonly property: string; readonly member?: string }
export interface AddArguments {
    /** A compatible on Linux, a schema key on no-OS. Optional: no-OS lists the devices without one. */
    readonly device?: string;
    /** `--name` on both. */
    readonly name?: string;
    /** Don't ask for what is left; list it. */
    readonly quiet: boolean;
}
export interface ImportArguments { readonly source: string }
export interface ReadArguments {
    readonly path?: string;
    readonly property?: string;
    /** Only the values. */
    readonly quiet: boolean;
}
export interface UpdateArguments {
    readonly path?: string;
    readonly property?: string;
    /** Every word after the property (Linux: joined and parsed as a value; no-OS: a value, or a member and its value). */
    readonly values: readonly string[];
    /** Reading: only the value. Creating a child node: don't ask. */
    readonly quiet: boolean;
}
export interface DeleteArguments { readonly path?: string; readonly property?: string; readonly force: boolean }
export interface RenameArguments { readonly path: string; readonly name: string }
export type ValidateArguments = Readonly<Record<never, never>>;
export type BuildArguments = Readonly<Record<never, never>>;
export type DeployArguments = Readonly<Record<never, never>>;

/**
 * The shared commands. A backend leaves out what it doesn't implement; the front end
 * still knows the command and answers "not supported by the <id> backend" (Linux
 * `list context` today, C-05, C-17).
 */
export interface Commands<R extends Responses = Responses> {
    readonly init?: CommandImpl<InitArguments, R["init"]>;
    readonly list?: {
        readonly devices?: CommandImpl<ListDevicesArguments, R["list devices"]>;
        readonly context?: CommandImpl<ListContextArguments, R["list context"]>;
        readonly property?: CommandImpl<ListPropertyArguments, R["list property"]>;
        readonly value?: CommandImpl<ListValueArguments, R["list value"]>;
    };
    readonly add?: CommandImpl<AddArguments, R["add"]>;
    readonly import?: CommandImpl<ImportArguments, R["import"]>;
    readonly read?: CommandImpl<ReadArguments, R["read"]>;
    readonly update?: CommandImpl<UpdateArguments, R["update"]>;
    readonly delete?: CommandImpl<DeleteArguments, R["delete"]>;
    readonly rename?: CommandImpl<RenameArguments, R["rename"]>;
    readonly validate?: CommandImpl<ValidateArguments, R["validate"]>;
    readonly build?: CommandImpl<BuildArguments, R["build"]>;
    readonly deploy?: CommandImpl<DeployArguments, R["deploy"]>;
}

export interface PositionalSpec {
    /** The key in `args`. */
    name: string;
    placeholder: string;
    brief: string;
    optional?: boolean;
    /** Takes every remaining word; only the last one may. */
    variadic?: boolean;
    /** How to complete it; `prior` are the positionals before it. Without it, nothing is offered. */
    slot?(prior: readonly string[]): Slot;
}

/**
 * A command only this backend has: Linux `move`, `enable`, `disable`, `list parent`,
 * `list overlay`; no-OS `generate`. Keyed by its route (`"list parent"`). It exists only
 * while this backend is active: on the other one it is not a known command.
 *
 * Linux's hidden `ui` is not carried over: it ran the CLI binary as a child, which a
 * backend can't do once it is a library.
 */
export interface ExtraCommand<S extends FlagSpecs = FlagSpecs, R extends object = object> {
    readonly docs: CommandDocumentation & { brief: string };
    readonly positionals: readonly PositionalSpec[];
    readonly flags?: S;
    readonly hidden?: boolean;
    /** Where it goes in `analog-attach --help`. */
    readonly group?: "setup" | "edit" | "build" | "tooling";
    /**
     * The JSON Schema of its `--json` response, relative to docs/spec/04-protocol
     * (`list-parent.schema.json`). The contract test validates the response against it.
     */
    readonly schema: string;
    run(arguments_: Readonly<Record<string, string | readonly string[] | undefined>>, flags: FlagValues<S>, session: Session): Promise<Outcome<R>>;
}

// =====================================================================================
// Setup and skills
// =====================================================================================

/** A session that can ask: the bare `analog-attach` on a terminal. */
export type InteractiveSession = Session & { readonly prompter: Prompter };

export interface SkillSpec {
    /** What `analog-attach skill install <name>` takes. */
    name: string;
    /** "Linux device tree overlays": completes "Claude Code now helps with …". */
    about: string;
    /** The skill's directory, copied as is. */
    source_dir: string;
}

// =====================================================================================
// Backend
// =====================================================================================

export interface Backend<R extends Responses = Responses> {
    /** The value of the `backend` setting. */
    readonly id: string;
    /** For `analog-attach config backend` and the bare `analog-attach`'s first question: "Linux device tree overlays". */
    readonly title: string;
    readonly version: string;
    /** The shared help's words for the backend's things: `{ device: "compatible", path: "path", workfile: "overlay" }`. */
    readonly words: { readonly device: string; readonly path: string; readonly workfile: string };
    readonly settings: readonly SettingSpec[];
    readonly settings_hooks?: SettingsHooks;
    readonly commands: Commands<R>;
    readonly extra?: Readonly<Record<string, ExtraCommand>>;
    readonly skills: readonly SkillSpec[];
    /**
     * Candidates for one word. Must be fast and silent: it runs on every Tab, so no cache
     * builds and no output (the session's `warn` and `progress` already print nothing).
     */
    complete(slot: Slot, partial: string, session: Session): Promise<Completion>;
    /**
     * The bare `analog-attach`'s questions once the backend is chosen, written through
     * `session.settings`. Without it, the bare `analog-attach` lists the required settings
     * that are unset.
     */
    setup?(session: InteractiveSession): Promise<Outcome<SetupResponse>>;
}

/**
 * The registry the front end has: one loader per backend, imported only when that
 * backend is active, so a no-OS run never loads attach-lib or the bundled dt-schema.
 *
 *   export const BACKENDS: Registry = {
 *       linux: () => import("../backends/linux/index").then(module => module.backend),
 *       noos: () => import("../backends/noos/index").then(module => module.backend),
 *   };
 *
 * (src/front/registry.ts).
 */
export type BackendLoader = () => Promise<Backend>;
