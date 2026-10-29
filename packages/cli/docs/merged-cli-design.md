# One CLI, two backends: merging attach-linux and attach-noos

A proposal for merging `attach-linux` (attach-cli) and `attach-noos` (attach-no-os-cli)
into one `aa` binary with a thin dispatch layer in front of a Linux backend and a no-OS
backend. IDs such as D-06 or C-17 refer to the merge review (`cli-diff.xlsx`).

## Summary

The dispatch is in-process. One `aa` binary owns everything a user sees: the grammar,
the settings, the output and the completion. The two backends are plain libraries that
implement a typed interface. Neither knows about a CLI framework or touches stdout or
stderr itself.

## Starting point

- **The command names already match.** Both CLIs have `config`, `init`,
  `list {devices,context,property,value}`, `add`, `import`, `read`, `update`, `delete`,
  `rename`, `validate`, `build`, `deploy`, `completion` and `skill`. Some commands exist
  on one side only:
  - Linux only: `move`, `enable`, `disable`, `list parent`, `list overlay`, and the
    hidden `ui`, which the merged CLI drops (decision 13)
  - no-OS only: `generate`
- **The JSON protocol is nearly the same.** `attach-cli/src/protocol/types.ts` and
  `attach-no-os-cli/src/protocol/responses.ts` both come from attach-meta's response
  schema: the same `CommonResponse`, `Property` and `Types` shapes. Linux adds a few
  fields, such as `min_items` / `max_items` on arrays.
- **no-OS already separates producing output from printing it.** Its commands end in
  `output(flags, text, response)`. Linux branches on `context.json` inside each command.
- **The frameworks differ.** Linux uses commander and no-OS uses stricli. The merged CLI
  uses stricli (D-01) and `@inquirer/prompts` (D-08).

## Why not a subprocess dispatch

attach-meta tried this before: `attach-meta/src/transport.ts` runs the backend binary
with `spawnSync` and reads JSON from its stdout. That design rules out:

- the text mode: the backend can only answer in JSON;
- interactive prompts: stdio is piped, so there is no add interview and no setup run;
- fast completion: every completion would start a second node process.

It also needs a manifest and protocol versioning between the two binaries. A
subprocess would make sense for backends written in other languages or released on
their own schedule. Here both are TypeScript in the same monorepo, so it only adds
costs.

## Layering

```
aa  (front end, stricli + @inquirer/prompts)
 ├─ grammar: the route map, positionals, flags, help, --json / --quiet
 ├─ settings: JSON files, global ~/.config plus project-local (local wins); reads `backend`
 ├─ output: respond / input_error / exit codes (D-06), text vs JSON
 ├─ completion: the shell stub, __complete, route and flag names
 ├─ skill install|uninstall, the bare `aa` setup run
 └─ dispatch(command, args) → backend.commands[command] ?? "not supported"
        │
        ├── linux backend  (today's attach-cli without bin/, app.ts and commander)
        └── noos backend   (today's attach-no-os-cli without the stricli wiring)
```

## The backend interface

The full interface is in [`backend-interface.ts`](../src/interface/backend-interface.ts), and the
`--json` responses it returns in [`backend-responses.ts`](../src/interface/backend-responses.ts). Both
type-check with attach-cli's compiler options. The top level:

```ts
interface Backend<R extends Responses = Responses> {
    readonly id: string;                      // the value of the `backend` setting
    readonly title: string;
    readonly version: string;
    readonly words: { device: string; path: string; workfile: string };  // "compatible" vs "schema" in shared help
    readonly settings: readonly SettingSpec[];
    readonly settings_hooks?: SettingsHooks;  // dynamic options, checks, rebuild on change, --reload
    readonly commands: Commands<R>;           // the shared commands it implements
    readonly extra?: Record<string, ExtraCommand>;  // move, enable, generate, …: as data, no framework
    readonly skills: readonly SkillSpec[];
    complete(slot: Slot, partial: string, session: Session): Promise<Completion>;
    setup?(session: InteractiveSession): Promise<Outcome<SetupResponse>>;
}

interface CommandImpl<A, R, S extends FlagSpecs = FlagSpecs> {
    readonly flags?: S;                       // flags only this backend adds (add --parent, build --board)
    readonly docs?: CommandDocumentation;
    run(args: A, flags: FlagValues<S>, session: Session): Promise<Outcome<R>>;
}

type Lazy<T> = T | (() => T | Promise<T>);           // forced only when printed

type Outcome<R> =
    | { kind: "answer"; response: Lazy<R>; text: Render }                              // exit 0
    | { kind: "refused"; response: CommonResponse & { ok: false }; text: Render }      // exit 0
    | { kind: "input-error"; message: string }                                         // exit 2
    | { kind: "cancelled"; message: string };                                          // exit 130
```

The file covers:

| Part | What it defines |
|---|---|
| Protocol | The base `--json` shapes and the `Responses` map. A backend's own map extends it with subtypes (Linux `read` adds `source`). |
| Outcome | How a command ends, with the exit status the front end gives each kind (D-06). The response and the text are both lazy: only the one that is printed is built. A crash is a throw (exit 1). |
| Session | What every call gets: the program name for hints (`aa` or a shim's name), the mode, the settings view, the state and asset directories, the prompter, styles, `say` (result text printed while an interactive command runs), `warn` (stderr), `progress`, an abort signal. |
| Settings | `SettingSpec` (key, category, type, options, `must_exist`), `SettingsView` (effective value and where it comes from, `paths` for a list, `set`, `reset`), and the `SettingsHooks` for `aa config`. |
| Prompts | `Prompter`: select, input with Tab completion, confirm, search, and a raw-terminal escape hatch for Linux's in-place editing. `PromptCancelled` carries the message printed with exit 130. |
| Completion | `Slot` (which word is being completed), `Candidate` (value, description, group, partial), and `Completion` (the candidates, plus a file or directory fallback for the shell). |
| Commands | The arguments of each shared command, `CommandImpl`, `Commands`, and `ExtraCommand` for backend-only routes, each naming the schema of its response. |
| Setup and skills | `SetupResponse` (with `ready`, so the bare `aa` runs `init`, C-01) and `SkillSpec`. |

## Design decisions

1. **The front end owns the grammar of the shared commands.** `read <path> [property]`
   is declared once, so the two backends can't drift apart. `<path>` is opaque to the
   front end: Linux parses `spi0/adc@0`, no-OS reads a flat node name. Both grammars
   fit without special cases.
2. **Backend-only commands come from their backend** (`extra`). They are declared as
   data, so a backend needs no CLI framework, and mounted only when that backend is
   active: on the other backend they are not known commands, which C-17 / D-16 allow. A command that is shared but missing from
   one backend (`list context` on Linux) answers "list context is not supported
   by the linux backend".
3. **The backend is picked before routing.** The bin reads the settings, loads the
   backend with a dynamic `import()` and builds the route map. Help then matches the
   active backend, and a no-OS run never loads attach-lib or the bundled dt-schema.
   With no backend set, the bare `aa` asks for one first, and every other command
   points to `aa config backend <linux|noos>` (D-12, C-01).
4. **Completion is split.** The front end completes route and flag names. For a
   positional it calls `backend.complete(slot, …)`. The `Candidate` type carries
   Linux's `group` (zsh headings) and `partial` (no trailing space, for a path segment
   or a pattern stem). stricli's per-parameter hooks only return strings, so `aa`
   needs its own `__complete` front end in place of stricli's `proposeCompletions`.
5. **The protocol types live in one small shared package.** They are generated from
   the JSON Schemas of the spec (`docs/spec/04-protocol`), or checked against them, and
   both backends import them.
6. **Prompts come through the `Session`.** A backend never opens a readline itself, so
   `--json`, `--quiet` and piped runs never ask, whatever the backend.
7. **An interactive command prints as it goes.** `add` says its notes and `Added …`, then
   asks, printing the values it fills in between the questions, then says what is still
   missing; the setup run has a banner and a "Saved" line between its questions and its
   summary. That text can't wait for the `Outcome`, so it goes through `session.say`,
   which prints at once in text mode and is allowed only while `session.prompter` is
   defined. A piped or `--json` run therefore still writes stdout exactly once, from the
   `Outcome`, and the front end can enforce it.
8. **Notes and warnings go to stderr in both modes.** Today COM-022 puts them on stdout
   in human mode, except `update`'s (U-1), the cache warning and the build progress. The
   merged CLI does what `update` does: `session.warn` is stderr whatever the mode, and a
   backend never looks at the mode to place a note. COM-021/COM-022 and the `add`,
   `import` and `rename` chapters change with the port of the Linux commands (migration
   step 2), not before, since the spec mirrors the shipped CLI.
9. **The response is built only when it is printed.** `add` under `--json` runs the
   intelligence stack once per missing property for `missing_required`; a text run must
   not pay for that before its first question. `Outcome.answer` takes a `Lazy<R>` (a
   value, or a possibly async thunk), and `text` is a `Render`, already a thunk.
10. **Writing a setting never rebuilds.** `SettingsView.set` runs the setting's checks
    and the backend's `check` hook, never `changed`. The callers want different things:
    `config linux` rebuilds the caches always, `config --reload` after checking the
    tools, the setup run only when they aren't current. A `set` that does nothing more
    lets each decide, and `import` writing `overlay` can't start a rebuild by accident.
    `changed` runs after `aa config <key> <value>` alone, and its outcome takes the place
    of the "Set" answer, so the command still ends with one outcome.
11. **Relative paths resolve against the project root.** A local setting's relative path
    resolves against the directory that holds `.aa/`, as `.attach-linux/config.toml`'s
    resolve against the CWD today, so converted configs keep pointing at the same files.
    A global setting has no such anchor: its paths must be absolute or start with `~`,
    and `aa config --global` refuses a relative one. A `path_list` is a JSON array, read
    with `SettingsView.paths`, so no separator or quoting rule is invented.
12. **Completion can hand back to the shell.** `complete` returns the candidates and an
    optional `files` or `dirs` fallback, which the front end turns into the stub's
    existing file and directory directives. `import <source>` takes a file path as well
    as an overlay of the index; today it completes only the index.
13. **`ui` is dropped.** It is a hidden proof of concept that runs the CLI binary as a
    child, found by `process.argv[1]`. A backend that is a library can't know that path,
    and an in-process `Session.run(argv)` would give every backend a door to any command
    for one page's sake. If a browser UI comes back, it is a front-end feature over the
    same in-process dispatch.
14. **Every extra command names its schema.** `ExtraCommand` is typed on its response
    and carries the file name of its JSON Schema under `docs/spec/04-protocol/`, so the
    contract test (migration step 6) covers `move`, `list parent` or `generate` as it
    covers the shared commands.

## Protocol alignments

Writing the shared response types shows where the two protocols differ today. Each one
is marked `ALIGN` in `backend-responses.ts` with the base it proposes. A field is required
where both backends always have it and optional where either may lack it. Where a base
renames or reshapes a field, the backend that has it today keeps the old one next to the
new, deprecated, until the shims are dropped (migration step 5):

| Response | Linux today | no-OS today | Proposed base |
|---|---|---|---|
| `init` | `linux`, `devicetree`, `overlay`, `created` | `path` | `path` (the workfile) and `created`; Linux adds its own fields and keeps `overlay` deprecated |
| `list devices` | `names: string[]`, or `device` when `list devices <compatible>` names one | `devices: { tag, key }[]` | no-OS's `devices`, with an optional `title`, plus `device` when the filter names exactly one; Linux keeps `names` deprecated |
| `list property` | `names: string[]`, or one `property` description | `suggestions: Suggestion[]` | Linux's |
| `list context` | not built yet (C-05) | platforms and boards | `CommonResponse`; each backend adds what it lists |
| `read` suggestions | `Suggestion[]` | `string[]` | `Suggestion[]` |
| `read` node `alias` | optional | required, always `[]` | optional |
| node `origin` | `base` / `overlay` / `both` | `internal` / `external` | a string; each backend narrows it |
| `add` `missing_required` | required | optional | required, `[]` when none |
| `read` `can_create` | optional | required | optional |

The other shared responses (`import`, `delete`, `validate`, `build`, `deploy`, and
`add` apart from `missing_required`) already fit: one side's shape is the base and the other's is a subtype of it.

## The hard parts

- **Interactive UI.** Linux's live filter (`src/live-filter.ts`) and the in-place
  editing of multi-cell values in the add interview are raw-terminal code, not plain
  prompts. Either `Prompter` exposes a raw-terminal capability, or they get rewritten
  as inquirer `createPrompt` custom prompts. The rewrite is cleaner but is real work.
- **Linux command bodies.** Every command has to return an `Outcome` instead of
  branching on `context.json` and calling `console.log`: result text into the `Render`
  or `session.say`, notes and warnings into `session.warn`, the response into a thunk
  where it is costly. The change is mechanical but touches every command, and it is
  most of the work.
- **Bundled assets.** `getBundledDtSchemaPath` and the bundled tool paths resolve
  relative to the Linux CLI's `dist/`. They break once the Linux backend is bundled
  into `aa`, so the asset root has to be passed in.
- **Undecided settings.** The `SettingSpec` design depends on two open questions:
  whether keys are scoped per backend (`linux.devicetree` or a flat `devicetree`), and
  K-01 (`overlay` → `workfile`).

## Migration path

Each step can ship on its own.

1. **Shared protocol.** Extract the protocol types into a shared package; both CLIs
   import it.
2. **Split the Linux commands.** Each command becomes `run_x(args, io) → Outcome`
   plus a thin commander adapter. `attach-linux` behaves as before, except that its
   notes and warnings move to stderr in human mode (decision 8): COM-021/COM-022 and
   the chapters that cite them change in the same diff.
3. **Backend adapters.** Define `Backend` and implement it for both backends, next to
   the existing CLIs.
4. **The `aa` front end.** Build `aa` on stricli with the dispatch. Keep
   `attach-linux` and `attach-noos` as shims (`aa` with the backend fixed), so
   existing scripts and skills keep working: the shims keep the grammar, the exit
   statuses and the text, and their JSON is the merged protocol with the old fields
   kept beside the new ones. The proof-of-concept page of `ui` reads `names` from
   `list devices`; it goes with `ui` (decision 13).
5. **Unify settings and tooling.** Move to the JSON settings (D-02), the unified
   completion and per-backend skills (C-25 / D-21), then drop the shims and the
   deprecated response fields.
6. **Contract test.** For each backend, every front-end route is either implemented
   or explicitly unsupported, and every `--json` response validates against the
   shared schemas, and every extra command's response against the schema it names.
   This generalises the existing `completion-drift.test.ts` of
   attach-cli.

## Spec

EARS already has a pattern for features that depend on a configuration. Shared
chapters keep plain requirements, and backend differences are written as
"Where the backend is linux, the CLI shall …". The grammar, common and protocol
chapters of `docs/spec/` become the spec of the front end. Each backend adds its own
optional-feature requirements in the chapters of the commands it implements, plus
chapters for its own commands.
