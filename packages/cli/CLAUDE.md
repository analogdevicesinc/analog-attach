# CLAUDE.md

## Overview

`@analog-attach/cli` is the `analog-attach` binary: a CLI for AI coding assistants (and people) to
configure peripherals, with one backend per ecosystem. `linux` configures Linux device tree overlays
(it wraps `attach-lib`); `noos` configures no-OS CAPI projects (it wraps `attach-no-os-lib`). Both
libraries are bundled at build time. The project's `backend` setting picks one. The design and its
numbered decisions are in `docs/merged-cli-design.md`; the observable behaviour is in `docs/spec/`.

## Commands

- `yarn build`: `scripts/bundle-dt-schema.sh` (the Linux backend's bundled dt-schema and tools, see
  below), then `tsc -p src/tsconfig.json` for the type check (errors block the build), then `tsup`
  for `dist/cli.js` and its chunks, then a copy of attach-no-os-lib's `src/codegen/templates` to
  `bundled/noos/templates`.
- `yarn test --run`: Vitest (inline `import.meta.vitest` blocks plus the `*.test.ts` files under
  `src/`). `yarn lint`: ESLint on `src`. `yarn clean`: `dist`, `tsconfig.tsbuildinfo`,
  `node_modules`.
- From the repo root: `yarn build:cli` builds attach-lib, attach-no-os-lib and then this package;
  `yarn test:cli`, `yarn lint:cli`.
- `yarn dev-link`: build and symlink `dist/cli.js` to `~/.local/bin/analog-attach`;
  `yarn dev-unlink` removes the link. To try the published shape instead, `yarn pack` in this
  directory and `npm install -g` the tgz (what `.github/workflows/package-cli.yml` does).

## Architecture

`src/` has three parts. The front end (`src/front/`) owns everything a user sees: argv and the
grammar, help, `--json`, exit statuses, the settings files, prompts, colours, shell completion,
skills and the bare run. A backend (`src/backends/<id>/`) is a library behind the interface
(`src/interface/`): it gets parsed arguments and a `Session`, and returns an `Outcome`. It never
reads argv or a settings file, never writes to stdout or stderr, and never opens a prompt itself.

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
    | `refuse(message, { severity?, text? })` | 0 | `ok: false` |
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

- `src/bin/cli.ts`: `main` with the real process. Ctrl-C outside a prompt aborts the session's
  signal, and the run exits 130.
- `src/front/main.ts`: `main(argv, deps: MainDeps)` is one run. It reads `backend`, loads that
  backend from the registry, opens the settings with its specs, builds the routes and runs the words.
  Everything it touches comes in through `MainDeps` (streams, location, tty, environment, prompter,
  signal, `package_root`, registry), so tests drive it in-process.
  - `strip_json` takes `--json` out of the words wherever it is (before a `--`).
  - `__complete -- <words>` goes to `complete.ts`.
  - The bare run (no words, no `--json`, on a terminal) goes to `setup.ts`. Off a terminal, or with
    `--quiet` alone, it prints the usage.
  - `help [<command>...]` is `<command>... --help`.
  - `PROGRAM` is `analog-attach`. `assets_directory(package_root, id)` is `bundled/<id>`.
- `src/front/registry.ts`: `BACKENDS`, one dynamic import per backend, so each is its own chunk and a
  no-OS run never loads attach-lib.
- `src/front/routes.ts`: the route table, the one place that knows the grammar.
  - `SHARED` / `SHARED_ROUTES` hold the shared commands with the positionals of `01-grammar.abnf`,
    plus the backend's flags merged in.
  - The backend's `extra` commands, then the front end's own (`config`, `skill`, `completion`).
  - `build_routes` makes the table. `build_application` makes the stricli app from it, and
    `complete.ts` uses the same table, so help, parsing and completion can't drift.
  - A shared command the backend leaves out stays routed but hidden. It exits 2 with
    `<route> is not supported by the <id> backend` (`other_backends` names the ones that have it).
    With no backend, every shared command points to `config backend`.
- `src/front/session.ts`: `create_session` builds the `Session`.
  - It carries `program`, `mode` (`text` / `json` / `complete`), `cwd`, `settings`, `state_dir`
    (`.analog-attach/<id>/`, `state_directory`), `assets_dir`, `style`, `signal`.
  - `prompter` is set only on a terminal without `--json` or `--quiet`.
  - `say` writes a result line on stdout, in order with the prompts. It works in text mode only,
    with a prompter, and throws otherwise.
  - `warn` writes a line on stderr in every mode. `progress` (`start_progress`) shows a long step
    on stderr. In `complete` mode, `warn` and `progress` print nothing.
- `src/front/settings-store.ts`: `open_settings` behind `SettingsView`.
  - The files are the project-local `.analog-attach/config.json` (`CONFIG_DIRECTORY`,
    `CONFIG_FILE`, under `find_project_root`) and the global
    `$XDG_CONFIG_HOME/analog-attach/config.json`. Local wins over global, then the spec's default.
  - Each file is a JSON object: `backend` at the top level, and each backend's settings in an
    object named after its id, its section (`{ "backend": "linux", "linux": { … }, "noos": { … }
    }`). Keys are kebab-case; values are strings, except a `path_list`, which is an array.
  - `open_settings({ files, top, sections, active })`: `top` is `[backend_setting(ids)]`,
    `sections` the registry's ids, `active` the backend's `{ id, specs }` (none when no backend is
    set). The store reads and writes only the active section, so each backend keeps its own
    `workfile` and `config backend <id>` only changes which section is used. Local and global
    layer section by section.
  - The parse is strict: a non-object file, a wrong type, a value outside its options, a section
    that isn't an object, or (in the local file) an unknown key is an error. Unknown keys are
    those of neither the top level (`backend`, the section ids) nor the active section; the
    message names a section key `<id>.<key>` (`unknown key linux.foo`). Other sections are kept
    verbatim and never checked. A flat file of the old format fails with these errors (no
    migration).
  - Errors are values: the store always opens and leaves an invalid value out. A file that isn't a
    JSON object is never written over, nor an active section that isn't one written into.
  - `BACKEND_KEY` (`backend`) is the front end's own key (`backend_setting`).
- `src/front/output.ts`: `print_outcome` / `run_outcome` print an `Outcome` and give its exit status
  (`EXIT_OK`, `EXIT_CRASH`, `EXIT_INPUT_ERROR`, `EXIT_CANCELLED`). Also `big_int_replacer` and
  `capture_stream` for tests.
- `src/front/prompter.ts`: `create_prompter`, on `@inquirer/prompts` (`select`, `confirm`,
  `checkbox`, `search`, and a custom `input` with Tab completion). Ctrl-C and Ctrl-D throw
  `PromptCancelled`, which prints with exit 130 when nothing catches it.
- `src/front/complete.ts`: `complete_words` answers `__complete`. It completes command and flag
  names and `config`'s keys and values itself. For a positional it builds the `Slot` (`path`,
  `property`, `value`, `device`, `source`, `flag`, `extra`) and asks `backend.complete`, whose
  `Completion` `completion_lines` renders. Nothing goes to stderr, and a failing source gives no
  candidates.
- `src/front/stubs.ts`: the shell stubs (`completion_script`) and `completion [<shell>] [--install |
  --uninstall]` (`completion_route`, `install_completion`). The stubs only hand the words to
  `analog-attach __complete` and render what it prints.
  - The directives are `__ANALOG_ATTACH_COMPLETE_FILES__` / `DIRS__` / `NOSPACE__` / `GROUP__`. A
    `FILES` or `DIRS` line may be followed by candidates (`Completion.fallback`).
  - zsh lists each group under its heading. The stub sets `list-grouped false` for analog-attach
    unless the user has set it. bash and fish skip the group lines.
- `src/front/config.ts`: `config_route` / `run_config`.

  | Command | Does |
  |---|---|
  | `config [<key>]` | show every setting, or one |
  | `config <key> <value>... [--global]` | set it |
  | `config <key> --reset [--global]` | remove it from the file |
  | `config --reload` | run the backend's `settings_hooks.reload` |

  After a set or reset, the backend's `settings_hooks.changed` runs, and its outcome replaces the
  front end's answer. Without a backend, `config` still knows `backend`.
- `src/front/skill.ts`: `skill install <name> [--force]` / `skill uninstall <name>` (`skill_routes`,
  `install_skill`). They copy one of `Backend.skills` to `~/.claude/skills/<name>/` (Linux:
  `analog-attach-linux` from `skills/linux/`; noos: `analog-attach-noos` from `skills/noos/`).
  Installing needs `claude` on PATH (`claude_on_path`).
- `src/front/setup.ts`: `bare_run`.
  1. With no backend set, it asks which (by `title`) and saves `backend`.
  2. It runs the backend's `setup`. When the response is `ready`, it runs the backend's `init` and
     ends with that outcome.
  3. If the backend has no `setup`, it lists the required settings that are unset.
- `src/front/testing/fake-backend.ts`: a backend for the front end's own tests.

### Contract test

`src/contract.test.ts` checks every backend of `BACKENDS` against the interface and the spec:
- every shared route is implemented or answers "not supported";
- every backend flag and completion slot reaches the backend;
- every `ExtraCommand.schema` exists;
- each shared and extra command (and `config`, `completion`, `skill`) has an answer case and a
  refusal or configuration-error case, run through `main` in a fixture workspace
  (`src/backends/linux/testing/fixture.ts`, `src/backends/noos/testing/fixture.ts`).

The `--json` output is validated with Ajv (2020-12) against `docs/spec/04-protocol`: a shared
command against `$defs/<id>` and the root, the others against their own schema, and a configuration
error against `config-error.schema.json`. A new backend must be added to its `CHECKED` list with
its cases. A new command needs cases there too.

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

`src/backends/linux/index.ts`:
- the shared commands;
- the extras `move`, `enable`, `disable`, `list parent`, `list overlay`;
- `setup`, `complete`, `linux_settings_hooks`;
- the skill `analog-attach-linux`.

Paths in this section are under `src/backends/linux/` unless they say otherwise.

### Command grammar

Every targeting command uses `<command> <path> [<property>] [<value>...]`:
- `<path>` is one `/`-separated token: label-first (`spi0/adc@0`) or absolute (`/soc/spi@7e204000`).
- `<property>` is a separate positional.
- Values are positional tokens after the property.
- `add` takes `--parent`; `move` takes two positional paths.
- `enable` / `disable` take a positional path.
- Shell completion works segment by segment within a single token.

Path helpers are in `utilities.ts`: `parse_node_path`, `parse_property_name`, `parse_target`,
`resolve_path`, `not_found_message`.

### Settings and workspace state

Config is parsed, not validated. `config/` turns the settings into checked resources, and a command
that gets them cannot fail because of the configuration.

- `config/settings.ts`: `SETTINGS`, the backend's `SettingSpec`s:
  - `linux`, `devicetree`, `workfile` (the overlay), `overlay-syntax`, `preprocess-command`;
  - `deploy-ip`, `deploy-user`, `deploy-password`.

  The front end stores and checks them, in the `linux` section of the settings files. `read_settings` gives them from `session.settings`, with
  defaults applied and paths absolute. The hint of a missing `linux`, `devicetree` or `workfile` is
  `setup_hint` / `missing_hint`.
- `config/hooks.ts`: `linux_settings_hooks`.
  - `config linux` needs a Linux tree.
  - `config workfile` accepts a file that doesn't exist yet when its directory does, since `init`
    creates it.
  - `changed` builds the caches after `config linux <path>`. `reload` is `config --reload`.
- `config/workspace.ts`: `load_workspace(session, needs)` returns `{ ok, workspace }` or `{ ok:
  false, outcome }`. The resources it can parse:
  - `bindings`: the Linux tree has `Documentation/devicetree/bindings/` and `include/`, and the
    bundled dt-schema exists.
  - `tools`: the bundled dtc and dt-* binaries.
  - `base`: the DTS, run through `preprocess-command` into `<state_dir>/preprocessed.dts` on every
    invocation, then parsed.
  - `overlay`: a `Workfile` parsed against the base, with `print()` / `save()` honouring
    `overlay-syntax`.
  - `overlay_path`: the configured workfile's path, whether its file exists or not (`init`).
  - `deploy`: the deploy fields plus the `.dtbo` from `derive_dtbo_path`.

  Errors from independent resources are collected and reported once (`format_config_errors`,
  `config_errors_outcome`). Under `--json` that is JSON on stderr with exit 2
  (`config-error.schema.json`). `parse_bindings` / `parse_overlay` / `optional_bindings` serve the
  callers that make bindings optional (`list value`, completion).
- `config/cache.ts`: derived state in `session.state_dir` (`.analog-attach/linux/`), never a setting.
  - `compat-index.json` maps compatible → binding YAML.
  - `validation.json` is the `dt-mk-schema -j` output, with `validation.stamp.json` next to it.
    `build_validation_schema` writes a temp file and renames it, so a failed build leaves the old
    file.
  - Commands never build the caches. `rebuild_caches` (`config/rebuild.ts`) runs `dt-mk-schema`,
    then derives the index from its output (`build_compat_index`). A failed compile writes
    neither cache, so the previous pair stays.
  - `build_compat_index` (`utilities.ts`) reads each Linux tree binding's processed `compatible`
    in `validation.json` and never parses a binding. When several list a compatible, `claim`
    ranks them: the file named after it, then one that lists it first, then one with its own
    `select` (naming conventions such as `arm/qcom-soc.yaml`), then a fallback. Check a change
    to it against the whole tree (the old and new index of `~/linux_rpi`), not only the tests.
  - Only three paths call it: `config linux <path>`, `config --reload` (`reload_caches`, which
    checks the Linux tree, bundled dt-schema and tools first) and the setup run (`ensure_caches`,
    which skips the build when `caches_current` says both are current). Progress goes through
    `session.progress`; `progress.ts` only formats the duration.
  - `parse_bindings` fails with a `config --reload` hint when either file is missing, so a command
    that has `bindings` can rely on both. A cache older than the bindings, or built for another
    Linux tree, only gives `cache_warning`, through `session.warn`. In completion it prints nothing.
  - `Bindings` is `{ linux, dt_schema, processed_schema }`, the last being `validation.json`. Its
    `generated-types` give the properties a binding leaves untyped the type another binding
    declares (`nvmem-cells`, `sound-dai`, `mux-controls`).
  - Commands pass the whole `Bindings` to `Attach.parse` (`resolve_node_binding`,
    `child_unit_radix`, `add`, `list`). Only `find_binding` (`utilities.ts`) uses `linux` and
    `dt_schema` alone.
- The overlay index (`overlay-index.ts`, not cached) maps each overlay file in the Linux tree (RPi
  `*-overlay.dts`, every `*.dtso`) to two things: the compatibles of the devices it adds, and its root
  compatible (the board).
  - It comes from a text scan with quoted `#include`s inlined.
  - `overlay_index` builds it on every call (about 10 ms for an RPi tree), so it is never stale.
  - Completion of `import` only lists the files (`overlay_files`).

### Property patterns

The lib (`Bindings/PatternKind.ts`) splits a binding's patternProperties in two:
- object schemas and patterns with an `@` are child nodes (`NodeBinding.child_nodes`, matched by
  `match_pattern_rule`);
- the rest name properties (`NodeBinding.property_patterns`, e.g. `^adi,bypass-attenuator-in[0-4]$`),
  with the same fixups and types as named properties.

`find_property_definition` (`binding-resolution.ts`) looks a property up by name, then by property
pattern. These all go through it: `update`'s shape hint, the suggestion check, `list value` and
`property_info` (`read`, `list property <path> <prop>`).

`list property <path>` shows the names a pattern matches (the lib's `expand_pattern`: `channel@0 …
channel@15`, or a stem such as `fan-…`), with the regex as the JSON value.

Completion of the property positional (`navigate_candidates` in `commands/list/suggest.ts`) works on
the node as the base and the overlay together have it (`navigate_node` / `effective_target_node`,
which `list property <path>` uses too).
- It adds `pattern_candidates`: the pattern names not set or present yet, or the stem as a
  `partial` suggestion, which the shell completes without a trailing space. Unanchored patterns
  (`-supply$`) offer nothing.
- The candidates come in two groups (`Suggestion.group`): `set` (the children and every property
  the node has) and `not set` (the binding's unset properties and the pattern names).
- `__complete` prints a group line before each group. `short_description` (`complete.ts`) cuts a
  display that repeats the value down to its note (`reg (required)` → `required`).

### If/then narrowing

`NodeBinding.properties` and `.required_properties` are the binding's unconditional lists.
`narrow_and_populate(node)` also returns `required_properties` once the node's data has selected
its `if/then/else` branches: ad5592r requires `spi-cpol`, ad5593r forbids it.

`narrowed_binding(binding, node)` (`binding-resolution.ts`) gives the binding with both lists
narrowed, or the binding itself when narrowing fails. These use it:
- `node_missing_required`;
- `property_info`'s `required`;
- `value_suggestions` (the lists passed to the intelligence stack, so a required flag gets its
  pinned `true`);
- `list property <path>`;
- completion (`commands/list/data.ts`).

`navigate_candidates` stays pure.

### Value suggestions

`list value` asks attach-lib's `IntelligenceStack.default()` for values: the binding and
base-devicetree layers (see `packages/attach-lib/src/Intelligence/CLAUDE.md`).
- It places the node with `placement_from_overlay`. The context devicetree is the base with the
  overlay applied (`DeviceTreeOverlay.merged_tree()`), so the overlay's own nodes (a regulator it
  adds, a controller it enables) are candidates. For `clocks` and `*-supply`, the ones the overlay
  adds come first.
- `resolve_target_binding` fills phandle enums from the same tree.
- The data paths are `resolve_target_binding` / `value_suggestions` / `property_info` in
  `commands/list/suggest.ts`. `read`, and `update` without a value (via `read_target`), reuse them
  for the description, allowed values and suggestions under a property.
- `node-state.ts` gives a node's missing required properties, and `property_details` for read and
  the add interview.
- The binding layer suggests every option of a single-value enum, the binding's default first.
  `format_details` (`commands/read/command.ts`) leaves out the suggestions that only repeat the
  `Allowed:` line.
- A phandle enum (`PropertyInfo.phandle_options`) gets no `Allowed:` line. The options the
  suggestions leave out follow them as `other_candidates`, marked disabled, enabled, or enabled by
  the overlay. They are never the interview's Enter default.
- A suggestion's `note` comes only from the CLI (those marks). The devicetree layer gives clocks,
  supplies and interrupt parents none.
- Lib suggestions are structured cell rows. `format_suggestion` (`property-value.ts`) turns them into
  value strings and is the inverse of `parse_value`.
- Command templates (`preprocess-command`, the build command) go through `substitute_command` /
  `is_tool_available` in `utilities.ts`.

### read

`read <path>` shows the node as the base and the overlay together have it (`effective_node`), so
base-only nodes (`spi0`) are readable too.
- Each property carries its `source` (`base` / `overlay`). The human output marks base values
  `// base`; `--quiet` doesn't.
- Children the overlay reaches are read in full. The rest collapse to their name and labels
  (`ReadNode.origin` `base`, no properties or children).
- The JSON has no `missing_required`; human mode prints `Missing required:`.
- A property's `suggestions` is `{ values, can_create }`. `can_create` is the lib's
  `creatable_providers` (`fixed-clock` for `clocks`, `regulator-fixed` for `*-supply`), which human
  mode prints as `Or add your own: analog-attach add <compatible>`.

`update <path> <prop>` without a value decides between reading and setting a flag on the same
merged node (`decide_update`). `delete`'s property positional completes only what the overlay
sets, while read and update offer the merged node's.

### Bundled dt-schema and tools

The backend's `assets_dir` is `bundled/linux/`. It holds:
- `dt-schema/`: the dt-schema YAML schemas used by the binding parser;
- `tools/`: PyInstaller-built binaries of `dt-mk-schema` and `dt-validate`, plus a statically
  linked `dtc` (v1.8.1, built without libyaml).

`scripts/bundle-dt-schema.sh` builds them on demand. It clones dt-schema at a pinned commit into
`dt-schema/` and dtc into `dtc/` (both gitignored, like `bundled/`), and runs as part of
`yarn build`.
- `dt-mk-schema` is built from `scripts/dt-mk-schema.py`. It runs dt-schema's per-file
  `process_schema` on a process pool, then hands the results to the upstream loop, so the output
  stays dt-schema's own.
- The venv gets `ruamel.yaml.clib`: without the C loader, loading YAML is most of the run.
- `tools/.recipe` holds a hash of the script and the entry point. Changing either rebuilds the
  tools on the next `yarn build`; otherwise the script exits early.

`getBundledDtSchemaPath` / `getBundledToolsPath` (`commands/skill/utilities.ts`) resolve them from
`assets_dir`.

### Overlay syntax

The `overlay-syntax` setting picks the output format:
- `fragment` (default): `fragment@N { target = <&label>; __overlay__ { … } }`;
- `label`: `&label { … }`.

All overlay writes go through the `Workfile` from `load_workspace`. The printer lives in
`attach-lib/src/Devicetree/Printer.ts`.

### update value format

`parse_value` (`property-value.ts`) parses the value tokens after the property name in
`update <path> <prop> <value...>`. `build_raw_property` resolves each token:
- Numbers → `bigint` cell values.
- Known macros (`GPIO_ACTIVE_LOW`, `IRQ_TYPE_EDGE_FALLING`, etc.) → their numeric values.
- Labels that exist in the base tree or overlay (bare or `&label`) → phandle references (`&label`).
- Unknown words in a cell context → **rejected** with a clear error message.

The binding gives only a shape hint (`flag` / `strings` / `cells` / undefined) and never causes a
rejection.

A value count outside the binding's minItems/maxItems is written with a warning (`count_warning`
in `item-count.ts`). The same bounds show in the type (`number[2]`, protocol `min_items` /
`max_items`).
- Value arrays (number, string, enum) have bounds.
- So does a specifier list whose entries have a known width: `interrupts` once the lib has shaped
  it for the interrupt-parent (entries × `#interrupt-cells`, so `[2]` for one gpio interrupt).
- Lists whose entries name a phandle (clocks, dmas, `*-gpios`) have none, since each entry has as
  many cells as its provider.

`update <path> <prop>` with no value sets a flag or reads the property (see `decide_update`).

### list

The shared `list devices`, `list property` and `list value`, plus the backend's own `list parent`
(`commands/list/placement.ts`) and `list overlay` (`commands/list/overlay.ts`). The front end's
`list context` answers "not supported" here.

`list overlay <compatible>` reads the overlay index and grades each overlay with `board_fit`
(`board-fit.ts`):
- It compares the overlay's root compatible with the base's, loosened by the `FAMILIES` table for
  generic SoC compatibles (`brcm,bcm2835` = any Pi). Compatible ones come first.
- It also lists the overlays that add another compatible of the device's binding
  (`binding_siblings` in `utilities.ts`, `overlays_matching`). These are marked `matched` / `via`
  and come after the exact ones of their fit.

The hidden `__list` of attach-linux is withdrawn. `complete.ts` calls the data functions of
`commands/list/data.ts` directly.

### Setup run and init

The Linux `setup` (`commands/setup/command.ts`, spec `setup.md`) runs from the front end's bare run
once the backend is linux.
- It asks for the Linux tree, the base devicetree and the workfile's name (`ask_plan` with
  `step_linux`, `step_context`, `step_overlay` in `setup.ts`, through `session.prompter`).
- `find_linux_trees` lists any directory under ~ with `Documentation/devicetree/bindings/` and
  `include/`, whatever its name.
- The configured values are the Enter defaults. A configured workfile is kept (`k`) or replaced by
  a new name (`n`, refused when the file exists).
- The `.dts` search is the prompter's `search`.
- It saves the three settings, then builds the binding caches unless they are current
  (`ensure_caches`). It creates no file, and a failed build leaves the settings saved.
- Its response is `ready` when `init` can keep or create the workfile, and the front end then runs
  `init`. Otherwise it prints the summary (`format_summary` in `commands/init/command.ts`), which
  says `Workspace configured` and makes `analog-attach init` the first next step.
- Cancelling it (Ctrl-C/Ctrl-D) exits 130 (`cancelled`). Stopping the add interview exits 0,
  since the node is added.

`init` (`commands/init/command.ts`, spec `init.md`) takes no options, never asks, builds no cache
and changes no setting.
- It loads `bindings`, `base` and `overlay_path`, so `linux`, `devicetree` and `workfile` must be
  configured; otherwise it gives the merged setup hint.
- `init_workfile` keeps the workfile when its file exists, or creates it empty at the configured
  path (`create_workfile`). It never picks another name.
- It refuses (`ok: false`) a path that isn't a file or whose directory is missing
  (`creation_problem` in `workfile.ts`, also used by `config workfile`).
- `InitResponse` (`protocol/types.ts`) is the base `{ path, created }` plus `linux`, `devicetree`
  and the deprecated `overlay`.

### import

`import <overlay>` (`commands/import/command.ts`) creates a workfile from an overlay of the Linux
tree, found by path, file name or stem in the overlay index (`find_overlay`), or from a file path.
- When a workfile is already configured, the new one replaces it in the settings and the old file
  is kept (`ImportResponse.replaced`).
- The overlay is preprocessed with `preprocess-command` (`run_preprocess` in `utilities.ts`, also
  used by the base and by `add --template`) and parsed against the base.
- Its root `__overrides__` is dropped (the lib's `remove_root_node`); everything else is kept as
  written.
- `workfile_from_overlay` (`workfile.ts`) names the file after the overlay and saves the setting.
- Warnings: the board fit when incompatible (`board_fit` on the text scan's root compatible), and
  the lib's `unresolved_targets` / `unresolved_references`. `unresolved.ts` prints these: a
  heading per kind, one row per node and property, label-first paths via `display_path`. The
  copied `add --template` kinds share it for their errors.

### add

`add` auto-picks unit addresses (when the binding defines `reg`), generates default labels from the
compatible, and refuses duplicates.
- The tree logic is the lib's `add_node` (`Devicetree/AddNode.ts`), which returns structured notes
  and refusals. The command only resolves the parent identifier, checks the binding for `reg`, and
  formats messages.
- `add` needs a configured workfile whose file exists (`load_workspace` with `overlay`) and never
  creates one: with none configured it reports the setup hint.

#### Parent

Without `--parent`, `add` takes the parent itself (`commands/add/parent.ts`: `default_parent` /
`pick_parent` / `parent_note`).
- On a terminal (`--template required`, no `--quiet`), the parent is the first question
  (`ask_parent` in `commands/add/interview.ts`): a lettered list of the `list parent` results.
  - It comes before the node exists and outside the `[1/N]` count.
  - Enter takes the first. A typed label or path is checked like `--parent`.
  - Tab completes segment by segment (`parent_completions`).
  - Ctrl-C/Ctrl-D add nothing and exit 130.
- Otherwise the parent is the first entry of `list parent`, with the note `Parent: spi (use --parent
  to choose another)` through `session.warn`.
- A copied `example:N` takes the first bus of the example's kind (`ExampleMatch.bus`), with `(no
  I2C bus for example 1; …)` when the base has none.
- A device whose only valid parent is `/` stays under the root, with no note and no question.
- `adi,ad5593r` shares ad5592r's binding, so `list parent` offers SPI buses for it (known limit).

#### Templates

`add --template <required|example:N|overlay:name>` (`commands/add/template.ts`) says what the node
starts from:
- `required` is the bare node and the interview.
- `example:N` (`commands/add/example.ts`: `find_examples`, `pick_example`) preprocesses each binding
  example (into `<state_dir>/example.dts`). It copies the node of example N that has the compatible
  or another of its binding (`device_matcher`, via the compat index).
- `overlay:name` (`commands/add/overlay-template.ts`) finds the overlay as `import` does
  (`locate_overlay`). It copies the first node of the device in an `__overlay__` body, or in a
  `__dormant__` one when no live body has it, with its children.
  - Without `--parent`, the node goes in the fragment's target.
  - A target the base lacks gets the first `list parent` bus of its kind (`default_parent` /
    `target_bus` in `parent.ts`), with a warning.

Both copies keep the node as written: taken labels get free ones, and references to them follow.
They never interview, and they list the references that resolve to nothing
(`AddResponse.unresolved`).

### Missing-required interview

After the add, the node's missing required properties (`node-state.ts`) are either asked for or
listed.
- They are asked for on a terminal: `missing-interview.ts` runs `commands/add/interview.ts`, which
  writes each answer through update's `apply_update`.
- They are listed when piped, with `--quiet`, or as `AddResponse.missing_required` under `--json`.

How a question is asked:
- `question_entries` letters the options of an enum or phandle (`pick_code` / `code_index`: a…z,
  aa…, as spreadsheet columns).
- An option is picked by letter or by value. A letter in range always picks, and a number is always
  a value. `&ab` or `"a"` writes a value that looks like a code.
- A fixed-size array such as `diff-channels`, or a shaped `interrupts`, is asked one cell per line.

Filled without asking (on a terminal, before the questions, one line each, not counted):
- the missing required properties the binding pins to one value (`fill_pinned`: the binding layer
  offers exactly one value, which covers a `const`, a one-option enum and a required flag);
- the values of the binding's first example on the parent's bus (`bus_example_values` in
  `commands/add/example.ts`): `spi-max-frequency` on SPI, `reg` on I2C, written through
  `apply_update`.
  - The chip select never comes from an example.
  - A sibling of the same name at the example's address keeps the node's own `reg`.

`--json`, piped runs, `--quiet` and copied templates fill nothing. The child interview (`update
<path> <child>`) gets the pinned fill only.

A required `*-gpios` is asked row by row (`question_entries`' GPIO branch, when
`PropertyInfo.gpio_rows` and `phandle_options` are both there).
- The controller entry comes first: enabled gpio-controllers, then the disabled ones marked via
  `other_candidates`. Enter takes the first enabled one, and on rows 2 and later the previous
  row's.
- The controller entry carries `Entry.after`, which rebuilds the entries after it from the lib's
  `gpio_row_cells`: the line number, then a lettered `GPIO_*` flags pick (Enter =
  `GPIO_ACTIVE_HIGH`).
- `Question.rows` makes `run_interview` repeat the row:
  - a fixed count asks all rows (`row 2/6`);
  - a range asks the minimum and then `another row? (y adds one, Enter = done)` up to the maximum;
  - unsized asks one and then "another?".
- The rows go out as one comma-separated token list to `apply_update`.
- Optional `*-gpios` are not part of the interview, and `list value` offers no GPIO suggestions.

On a terminal, a question of several entries (`several_entries`: a fixed-size array, shaped
`interrupts`, `*-gpios` rows) is asked in place.
- Each entry is asked under the value so far (`format_cells`, with `Entry.reference`, set for any
  phandle pick, shown as `&label`).
- Each entry is erased once answered (`open_prompt`'s `mark` / `erase`, the terminal rows counted
  with `screen_rows`), and the value line is what stays.
- A single pick is asked as before, and piped runs are unchanged.

Child nodes (channels etc.) are created through `update <path> <child-name>` (`create_child_node`).
It then asks for (or lists, or returns as `UpdateChildResponse.missing_required`) the child's
missing required properties exactly as `add` does. Both go through `missing-required.ts`
(`missing_required_of`, `describe_missing`) and `missing-interview.ts` (`ask_for_missing`).
`update`'s one `--quiet` is both its read flag (value only) and "don't ask" when it creates a
child.

### Unit addresses

`rename` syncs reg↔unit address, and `update reg` renames the node. Unit addresses are hex, except
for child nodes whose parent binding names them in decimal (`^channel@([0-9]|1[0-5])$`):
- The lib's `unit_radix` probes the patterns, and `child_unit_radix` (`binding-resolution.ts`)
  reads them from the parent's binding.
- `update <path> <child@n>`, `update reg` and `rename` pass the radix on.
- `add` stays hex, since devices sit on buses where dtc requires it.

### Overlay fragments

The lib helpers are in `UnitAddress.ts` and `Labels.ts`. `DeviceTreeOverlay.ensure_node(path)`
gives the overlay node to write into for any absolute path, creating a fragment for base-only nodes.

Fragments are matched by the node their target resolves to (`&i2c_arm` and `&i2c1` are one node).
An overlay can have several for one node (imports often do):
- `overlay_nodes_at` gives them in file order;
- `overlay_properties` gives the values that apply (a later fragment wins, as in dtc);
- `property_node` gives the one holding a property;
- `merged_overlay_node` gives all of them as one node.

So `read` sees every fragment, `update` writes where the applied value is, and `remove_property`
removes it from all.

### Reg clashes

`reg-conflicts.ts` (`reg_warnings`) turns the lib's `reg_conflicts` / `sibling_reg_conflicts`
(`Devicetree/RegConflicts.ts`) into warnings worded for the bus: chip select, I2C address,
overlapping range. When the other node comes from the base tree, the warning adds a "disable <base
node>" hint.
- `validate` appends them to the dt-validate diagnostics, mapped to the `/nodeN` validation path so
  they group with them, and leaves out base-only clashes.
- `update … reg`, `rename` and `add` warn about the node they touched, through `session.warn`.
- Buses are checked whatever their own status, since a bus is often enabled later.
- A node counts as the overlay's when the overlay adds it or sets its reg or status. So a base node
  the overlay only adds children to (pin groups under gpio) keeps its base clashes out.
- The same warnings report an SPI device whose chip select has no entry in its controller's
  `cs-gpios` (`chip_select_overflows`). Entries are a phandle plus the provider's `#gpio-cells`,
  or a lone 0. Controllers without `cs-gpios` aren't checked, since their native chip select count
  is up to the driver.

### Interrupt-parent

Setting `interrupts` without an explicit `interrupt-parent` writes the inherited one automatically
and warns on cell-count mismatches. The lib's `interrupt_parent.ts` provides the path-based
inheritance walk.

### SPI vendor peripheral-props filtering

`VendorPeripheralFilter.ts` in the lib removes vendor-specific SPI peripheral properties (pl022,
cdns, fsl, nvidia, st) unless they match the parent controller's compatible. It is applied at
binding parse time.

## no-OS backend

`src/backends/noos/index.ts`:
- the shared commands, including `list context`;
- the extra `generate`;
- `setup`, `complete`, `noos_settings_hooks`;
- the skill `analog-attach-noos`.

attach-no-os-lib does the domain work (registry, workfile, bootstrap, codegen). The backend adapts
it to the interface.

- **Settings injection** (`settings.ts`): `SETTINGS` is the lib's `SETTINGS_DEFAULTS` as
  `SettingSpec`s, by the lib's categories:
  - sources: `capi-path`, `module-paths`;
  - target: `target` (a board, or a chip with no board);
  - workfile: `workfile`;
  - project: `project-name`, `project-path`, `project-template`;
  - build: `build-command`, `deploy-command`, `probe`, and `bootstrap`, `interview`, `example`.

  The lib reads settings and templates through module state. `install(session)` points it at the
  session before every call (`use_settings(session.settings)`, which sees the `noos` section, and
  `use_templates_root(<assets_dir>/templates)` when that exists). `noos_settings_hooks` gives
  `check` (`capi-path` / `module-paths` must be module checkouts; `target` must name a board or a
  chip, `resolve_target`) and `options` (for `target`, the boards then the chips; the template sets).
- **Workfile** (`commands/shared.ts`): `load_context` loads the workfile and registry,
  `save_workfile` writes it back. `get_project_path` gives `project-path`, else
  `out/<project-name>` under the project root.
- **Bootstrap** (`commands/bootstrap_run.ts`): after `add`, `update` and `delete` change the
  workfile, `run_bootstrap` fills what can be derived when the `bootstrap` setting is on.
  `describe_bootstrap` / `still_needed` say what it did and what is left.
- **Interview** (`commands/interview.ts`): `run_interview` runs after `add` on a terminal (a
  prompter, and the `interview` setting on). It asks one thing at a time:
  - a choice bootstrap stopped at, then a required value nothing could fill;
  - after each answer it runs bootstrap again and saves the workfile, so Ctrl-C keeps what was
    answered;
  - an answer goes through `update`'s parser and `set_value`.
- **Setup** (`commands/setup.ts`): `capi-path`, the module repositories next to it, the board, then
  the workfile. Each answer is written through the same checks `config` makes. The response is
  `ready` when the user wants the workfile, and the front end then runs `init`.
- **generate** (`commands/generate.ts`, an `ExtraCommand`, `generate.schema.json`) renders the
  workfile into the project with the template set. Its flags `--output`, `--project-template` and
  `--board` override the settings for one run.
- **build / deploy** (`commands/build.ts`, `commands/deploy.ts`, `build/cmake_build.ts`): with
  `build-command` / `deploy-command` set, the command runs in the project (`run_shell`). Otherwise
  the backend does a CMake preset build (`plan_build`, `preflight`, `cmake --preset <board>`,
  `cmake --build build`, `--target flash` for deploy). The tool's output goes through
  `session.progress` on stderr, so stdout keeps only the result.
- **Protocol** (`protocol/responses.ts`, `protocol/convert.ts`): the workfile's flat symbol table as
  the shared tree. Nodes sit under the root; a union value is a `[member, value]` tuple.
- `complete.ts` reads the workfile straight off disk on every Tab and never prints.
- Tests use `testing/fixture.ts`, which points at attach-no-os-lib's fixtures (a capi checkout, two
  platforms, a driver collection).

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

Before saying a task is done, run `yarn verify` from the repo root (`scripts/verify.sh`) and fix
every error, including pre-existing lint errors in files you edited. It runs:
1. attach-lib: build, type-check, tests, lint;
2. attach-no-os-lib: build, tests, lint;
3. @analog-attach/cli: build with `tsc`, lint, tests.

A Stop hook (`.claude/hooks/stop-verify.sh`) runs it when attach-lib, attach-no-os-lib or the CLI
changed, and blocks on failure. Never report completion with failing lint or type checks.

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

The Raspberry Pi overlay corpus is attach-lib's (`packages/attach-lib/corpus/overlays/`, `yarn workspace attach-lib corpus:overlays:diff`); it doesn't show property-type changes (the processed schema's), so check those with its `repros/processed-types.mjs <binding> <property>`.

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
- Parallel agents get disjoint file lists, and the main agent runs `yarn verify` and waits for
  review before any commit.

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
