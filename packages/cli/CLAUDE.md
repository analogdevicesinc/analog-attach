# CLAUDE.md

## Overview

`@analog-attach/cli` is the `analog-attach` binary: a CLI for AI coding assistants (and people) to
configure peripherals, with one backend per ecosystem. `linux` configures Linux device tree overlays
(it wraps `attach-lib`); `noos` configures no-OS CAPI projects (it wraps `attach-no-os-lib`). Both
libraries are bundled at build time. The project's `backend` setting picks one. The observable
behaviour is in `docs/spec/`.

## Commands

- The Linux backend's tools are the system's, as users install them (see *System tools* in
  `src/backends/linux/CLAUDE.md`): `dtc` from the package manager, and `pipx install
  dtschema==2026.9`, then `pipx inject dtschema ruamel.yaml.clib`. attach-lib's tests, the
  functional tests and CI need them on PATH too.
- `yarn test --run`: Vitest (inline `import.meta.vitest` blocks plus the `*.test.ts` files under
  `src/`).
- From the repo root: `yarn build:cli` builds attach-lib, attach-no-os-lib and then this package;
  `yarn test:cli`, `yarn lint:cli`.
- To try the published shape instead of `yarn dev-link`, `yarn pack` in this directory and
  `npm install -g` the tgz (what `.github/workflows/package-cli.yml` does).

## Architecture

`src/` has three parts. The front end (`src/front/`) owns everything a user sees: argv and the
grammar, help, `--json`, exit statuses, the settings files, prompts, colours, shell completion,
skills and the bare run. A backend (`src/backends/<id>/`) is a library behind the interface
(`src/interface/`): it gets parsed arguments and a `Session`, and returns an `Outcome`. It never
reads argv or a settings file, never writes to stdout or stderr, and never opens a prompt itself.
What both backends share sits in `src/backends/shell.ts`: `project_root(session)` (the directory
that holds `.analog-attach/`) and `run` / `run_shell`, which pass a child's output on line by line
(to `session.progress`).

### Interface

- `src/interface/backend-interface.ts`: `Backend { id, title, version, words, settings,
  settings_hooks, commands, extra, setup?, skills, complete }`.
  - `words` names the shared placeholders per backend (`device`, `path`, `workfile`; Linux:
    `compatible` / `path` / `overlay`, noos: `schema` / `node` / `workfile`).
  - `commands: Commands` holds the shared commands. Each is a `command({ run, flags?, docs? })`, and
    one a backend leaves out answers "not supported by the <id> backend".
  - `extra` holds a backend's own commands as data: `ExtraCommand { docs, positionals, flags, group,
    schema, run }`. The front end turns them into routes.
  - `SettingSpec` / `SettingsView` / `SettingsHooks` (`check`, `options`, `changed`, `reload`).
  - `Slot` / `Completion` / `Candidate` for completion; `Prompter`, `PromptCancelled`, `Session`,
    `Progress`.
  - `Outcome<R>` and its constructors:

    | Constructor | Exit | Output |
    |---|---|---|
    | `answer(response, text)` | 0 | the response under `--json`, else the text |
    | `refuse(message, { type, severity?, text? })` | 0 | `ok: false` |
    | `input_error(message)` | 2 | the message on stderr |
    | `cancelled(message)` | 130 | the message on stdout |

    A response is `Lazy` and the text is a `Render` (`style => string`), so only the side that is
    printed is computed.
- `src/interface/backend-responses.ts`: the shared base responses (`CommonResponse`, `ReadResponse`,
  `AddResponse`, …, `Responses` by route). Each backend narrows them in its own protocol file:
  `src/backends/linux/protocol/types.ts` (`LinuxResponses`) and
  `src/backends/noos/protocol/responses.ts` (`NoosResponses`). A field renamed from a backend's old
  CLI stays in that backend's subtype, `deprecated`, for one release.

### Front end

`src/front/CLAUDE.md` describes each front-end file (main, routes, session, settings store,
output, prompter, completion, stubs, config, skill, setup). Read it before changing the front end.

### Contract test

`src/contract.test.ts` checks every backend of `BACKENDS` against the interface and the spec:
- every shared route is implemented or answers "not supported";
- every backend flag and completion slot reaches the backend;
- every `ExtraCommand.schema` exists;
- each shared and extra command (and `config`, `completion`, `skill`) has an answer case and a
  refusal or configuration-error case, run through `main` in a fixture workspace
  (`src/backends/linux/testing/fixture.ts`, `src/backends/noos/testing/fixture.ts`).

The `--json` output is validated with Ajv (2020-12) against `docs/spec/04-protocol`: a shared
command against `$defs/<id>` and the root, the others against their own schema. A Linux
configuration refusal (shape `config-refusal`) is also checked against
`common.schema.json#/$defs/config-refusal`, and a settings-file error of `config` against
`config-error.schema.json`. A new backend must be added to its `CHECKED` list with its cases. A
new command needs cases there too.

### Spec layout

`docs/spec/` mirrors the observable behaviour:
- `00-overview.md` (terms, and §2.1 the schema convention: `$defs/base`, `$defs/linux`,
  `$defs/noos`, root `anyOf`);
- `01-grammar.abnf` / `01-grammar.md`;
- `02-common.md` (modes, streams, exit statuses, settings, workspace loading);
- `03-commands/<command>.md`: a shared command's Linux behaviour in its numbered sections, and the
  no-OS backend's in *Where the backend is noos*;
- `04-protocol/*.schema.json`;
- `05-completion.md`.

## Linux backend

`src/backends/linux/CLAUDE.md` has the Linux backend: grammar, settings and workspace state, caches,
bindings and value suggestions, system tools, full devicetree output, each command, the add
interview, overlays. Read it before changing Linux behaviour.

## no-OS backend

`src/backends/noos/CLAUDE.md` has the no-OS backend: settings injection, workfile, bootstrap,
interview, setup, generate, build and deploy, protocol. Read it before changing no-OS behaviour.

## Key Conventions

- A command loads what it needs (Linux: `load_workspace(session, needs)`; noos: `install` +
  `load_context`), calls the lib, and returns an `Outcome`: `answer`, `refuse`, `input_error` or
  `cancelled`. Commands never throw to the user: a problem is a refusal or an input error.
- A backend writes nothing itself: no `console.*`, no `process.stdout` / `process.stderr`, no
  `process.exit`. Lines between an interactive command's questions go through `session.say`, notes
  and warnings through `session.warn`, long steps through `session.progress`. Hints name the
  program through `session.program`, never a literal.
- `big_int_replacer` (`src/front/output.ts`) is the `JSON.stringify` replacer whenever output
  contains `BigInt` values (DTS cell arrays are always `bigint`). The front end applies it to
  responses.
- Inline tests use Vitest's `includeSource` feature: `if (import.meta.vitest)` blocks sit directly
  in source files (see `src/backends/linux/commands/add/command.ts`). Backend tests drive the real
  `main` through the fixtures in `src/backends/*/testing/`.
- TypeScript is configured with `noUncheckedIndexedAccess`, `noPropertyAccessFromIndexSignature`, and
  `verbatimModuleSyntax`, which is stricter than the monorepo baseline. Index access always needs an
  `undefined` check.
- snake_case names and 4-space indentation. Lint (`unicorn/prevent-abbreviations`, in
  unicorn's recommended set) rejects abbreviated variable names such as `dir` or `args`.

## Working rules

### Definition of done

Before saying a task is done, run the verify of the side you changed from the repo root
(`scripts/verify.sh`) and fix every error, including pre-existing lint errors in files you edited:

| Changed | Run | What it runs |
|---|---|---|
| The Linux side only: attach-lib, `src/backends/linux/` | `yarn verify:linux` | attach-lib: build, type-check, tests, lint; the CLI: build, lint, tests without the noos backend |
| The no-OS side only: attach-no-os-lib, `src/backends/noos/` | `yarn verify:no-os` | attach-no-os-lib: build, tests, lint; the CLI: build, lint, tests without the linux backend |
| Anything common (the front end, the interface, `shell.ts`, the contract test, `04-protocol`, `scripts/`), or both sides | `yarn verify` | all of it: attach-lib, attach-no-os-lib, then the CLI (`tsc` build, lint, tests) |

Never run the other side's builds or tests for a change of one side: a Linux change runs nothing
no-OS. A side's verify builds the other lib only when its `dist/` is missing, as the CLI's build
needs it, and leaves out the other backend's tests (its `src/backends/<id>/` files and the contract
test's `the <id> backend` cases, so a backend-only test there goes under a `describe` of that
prefix). The full `yarn verify` is also the check before a push or a handoff.

A Stop hook (`.claude/hooks/stop-verify.sh`) runs the same choice when attach-lib, attach-no-os-lib,
the CLI or `scripts/` changed, and blocks on failure; a change to the spec's prose alone runs
nothing. Never report completion with failing lint or type checks.

### Spec

`docs/spec/` is the natural-language mirror of the CLI's observable behaviour: what it accepts,
prints, writes to stdout/stderr, exits with, asks, and writes to the workspace. It has:
- the grammar (`01-grammar.abnf`);
- EARS requirements with IDs (`ADD-NNN`, `COM-NNN`, …);
- each chapter's open issues;
- the JSON Schemas of the `--json` responses (`04-protocol/`).

Rules:
- Before changing observable behaviour, find the requirements that cover it (grep the IDs and the
  messages, and read `02-common.md`).
- Check for conflicts with other chapters. Look for a command that already does the same thing, so
  its code and wording are reused and behaviour stays common.
- Update the spec in the same diff: requirements, messages, schemas, open issues (drop fixed ones,
  add new ones). Never renumber an ID; mark a removed one *withdrawn*.
- Validate a changed schema against real `--json` output. `src/contract.test.ts` does it for its
  cases, so add one for new output.
- A change that contradicts the spec without updating it is not done.

### Build order

The CLI consumes the *built* attach-lib and attach-no-os-lib. After changing either, rebuild it
(`yarn workspace attach-lib build`, `yarn workspace attach-no-os-lib build`) before running CLI
tests or checking by hand. Yarn 4 does not run `pre*`/`post*` lifecycle hooks, so call build steps
explicitly. Run attach-lib's tests with `--exclude test/BindingParserCompletion.test.ts`.

### Corpus

The Raspberry Pi overlay corpus is attach-lib's (`packages/attach-lib/corpus/overlays/`, `yarn workspace attach-lib corpus:overlays:diff`); it doesn't show property-type changes (the processed schema's), so check those with its `repros/processed-types.mjs <binding> <property>`, and the binding types as a whole against dt-schema's with `yarn workspace attach-lib corpus:oracle:diff`.

### Plans and notes

`plans/` (gitignored) holds working plans and progress notes for Claude sessions. Findings from
manual reviews of the tool go in a notes file at the package root (`notes.txt`, `notes_1.txt`, …);
the user says which one when it's needed.

### Scope and git

- Change only the files and packages in scope. Ask before touching the notes files, other packages'
  plans, or any `CLAUDE.md`.
- Never commit, amend, rebase or rewrite history unless asked. Subagents and forks never commit.
- "Commit" means the full working diff unless told otherwise. Never revert uncommitted changes you
  didn't make.
- Parallel agents get disjoint file lists, and the main agent runs the verify of the changed side
  (*Definition of done*) and waits for review before any commit.

### Working through findings

When going through a list of findings, take one at a time: explain the issue and the proposed fix,
then wait for confirmation before editing. Don't move on to the next item.
For an ambiguous request ("show me first", "test this e2e"), restate it in 2–3 bullets and wait for
an OK.

### Domain notes

- "Test e2e" / "test this manually" means running the real CLI by hand against demo files, not
  writing automated e2e tests.
- Interrupt cell counts come from the chosen interrupt-parent's `#interrupt-cells`, not from the
  specifier count.
