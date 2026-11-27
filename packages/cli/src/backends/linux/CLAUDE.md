# CLAUDE.md: the Linux backend

Part of `packages/cli/CLAUDE.md` (read that first).

`src/backends/linux/index.ts`:
- the shared commands;
- the extras `move`, `enable`, `disable`, `list parent`, `list overlay`, `list node`;
- `setup`, `complete`, `linux_settings_hooks`;
- `variables` (`linux_variables`, `scripts.ts`: see *Build and deploy commands*);
- the skill `analog-attach-linux`.

Paths in this section are under `src/backends/linux/` unless they say otherwise.

## Settings and workspace state

Config is parsed, not validated. `config/` turns the settings into checked resources, and a command
that gets them cannot fail because of the configuration.

- `config/settings.ts`: `SETTINGS`, the backend's `SettingSpec`s:
  - `linux`, `devicetree`, `workfile` (the overlay), `overlay-syntax`;
  - `interview` (`false`: `add` and `update <path> <child>` ask nothing on a terminal, the
    parent question included);
  - `output` (`overlay`, the default, or `devicetree`: see *Full devicetree*), `build-dir` (a
    string, `build` by default).

  The front end stores and checks them, in the `linux` section of the settings files. `read_settings` gives them from `session.settings`, with
  defaults applied and paths absolute. The hint of a missing `linux`, `devicetree` or `workfile` is
  `setup_hint` / `missing_hint`. What `aa_build.sh` and `aa_deploy.sh` need of the board (its
  address, a password) are the project's variables, not settings (see *Build and deploy
  commands*).
- The commands the CLI runs are executable variables, not settings (`EXECUTABLES`,
  `EXECUTABLE_NAMES`, spec COM-158): `AA_BUILD` (`./aa_build.sh`), `AA_DEPLOY`
  (`./aa_deploy.sh`) and `AA_PREPROCESS_COMMAND` (`DEFAULT_PREPROCESS_COMMAND`, cpp). The front
  end stores one in `variables` only once it is changed (`config var <NAME> <command>`, `--reset`
  for the default) and gives it through `SettingsView.executable(name)`, which is the default
  while it isn't set. `read_settings` reads them into `preprocess_command`, `build_command` and
  `deploy_command`. They are never secrets, and no command gets them in its environment. The
  old `preprocess-command` setting is an unknown key now (no migration).
- `config/hooks.ts`: `linux_settings_hooks`.
  - `config linux` needs a Linux tree.
  - `config workfile` accepts a file that doesn't exist yet when its directory does, since `init`
    creates it.
  - `changed` builds the caches after `config linux <path>`. `reload` is `config --reload`.
- `config/workspace.ts`: `load_workspace(session, needs)` returns `{ ok, workspace }` or `{ ok:
  false, outcome }`. It resolves `build-dir` against `project_root` (`build_folder`). The resources
  it can parse:
  - `linux`: the checked Linux tree alone (`list context`).
  - `bindings`: the Linux tree has `Documentation/devicetree/bindings/` and `include/`, and
    dt-schema 2026.9 is installed (`parse_dt_schema`, looked up once per load).
  - `tools`: dtc, the `dt-mk-schema` command (`mk_schema_command`) and dt-validate, from PATH,
    and the validate worker's command (`validate_worker`, see *System tools*).
  - `base`: the DTS, run through `AA_PREPROCESS_COMMAND` (`run_preprocess`, in
    `WorkspaceContext.cwd`, the session's) into `<state_dir>/preprocessed.<pid>.dts`, renamed to
    `preprocessed.dts`, on every invocation, then parsed. `linux` is loaded only when the command
    names `AA_LINUX` (COM-092). With the default
    command (`DEFAULT_PREPROCESS_COMMAND`), a process that runs several commands keeps the output
    (`config/preprocessed-base.ts`, spec COM-097) while the DTS and what it includes are
    unchanged: `included_files` follows `#include` / `/include/` where `-nostdinc -I
    "$AA_LINUX/include"` lets cpp look (`"…"` beside the includer, then the tree's `include/`;
    `<…>` in `include/`), and a `"…"` found in the tree stamps the file beside as absent. An include
    found in neither, or another command, keeps nothing (cpp runs every run, ~8 ms). The
    command's `-P` leaves no line markers, so the includes come from the sources, not the output.
    The tree itself is parsed every run: commands change it.
  - `overlay`: a `Workfile` parsed against the base, with `print()` / `save()` honouring
    `overlay-syntax`.
  - `overlay_path`: the configured workfile's path, whether its file exists or not (`init`).
  - `workfile_file`: the configured workfile's path with its file there, unread (`build` of an
    overlay, which `AA_BUILD` compiles).
  - `build_script` / `deploy_script`: the command `build` / `deploy` runs (`parse_script`). A
    command of the project's (`AA_BUILD` not its default) is taken unchecked. The default,
    `./aa_build.sh` / `./aa_deploy.sh`, must be an executable file at the project root
    (COM-150): a missing one is `not-generated` with the hint to `init --restore
    <build|deploy>` or set the variable (`restore_hint`); it is never written again here.
    `SCRIPTS` and `derive_build_files` are in `config/build-files.ts` (re-exported by
    `workspace.ts`, which can't be imported by `scripts.ts`).

  `build` loads `overlay_path`, `workfile_file` and `build_script` (under `output` `devicetree`,
  `base` and `overlay` in place of `workfile_file`); `deploy` loads `overlay_path` and
  `deploy_script`. `derive_build_files` names what `AA_BUILD` writes: in the build folder, named
  after the workfile, the `.dtbo`, or the `.dts` and `.dtb` under `output` `devicetree`.

  Errors from independent resources are collected and reported once (`format_config_errors`,
  `config_errors_outcome`) as a refusal, exit 0, in both modes. Under `--json` it also carries
  `errors` and `hints` (`ConfigRefusal`, `$defs/config-refusal`). `parse_bindings` /
  `parse_overlay` / `optional_bindings` serve the callers that make bindings optional (`list
  value`, completion).
- `config/cache.ts`: derived state in `session.state_dir` (`.analog-attach/linux/`), never a setting.
  - `compat-index.json` maps compatible → binding YAML. `load_compat_index` keeps it in memory
    for the rest of the process, while the file's size and mtime stay the same; `prepared_schemas`
    keeps the prepared schemas it read the same way.
  - `validation-cache/` (`validation_cache_path`) holds what derives from `validation.json`, the
    `dt-mk-schema -j` output, with `validation.stamp.json` next to it. `build_validation_schema`
    writes a temp file and renames it, so a failed build leaves the old file, and removes
    everything else in the folder. `move_flat_validation_cache` (spec COM-137, called first by
    `parse_caches`) moves an earlier version's flat `validation.json` and stamp into it.
  - `validation-cache/validation-subsets/` holds what `validate` gives dt-validate instead of the
    whole `validation.json` (`commands/validate/schema-subset.ts`, spec VALIDATE-014): the schemas
    it applies to every node, those the compatibles of `temp.dtb` pick, and what they `$ref`, one file
    per set of compatibles and `validation.json` (its size and mtime), the 16 used last kept.
    dt-validate spends most of a run loading and setting up the schema, so this takes a run from
    about 0.4s to 0.13s. The schemas dt-mk-schema gives a `select` from their `$nodename`
    (`spi-controller.yaml`, `i2c-controller.yaml`) are kept with the rest whose `select` isn't
    false, so the name-only bus stubs of `temp.dts` are checked as in a full run. `schema_subset` mirrors dt-schema's selection (`DTValidator.__init__`,
    `iter_errors`, `extract_node_compatibles`); check a change to it, or a dt-schema bump, against
    every binding (full and subset diagnostics the same), not only the tests. When dt-validate
    fails on a subset, `check` deletes it and runs again on `validation.json`. `--full` gets the
    whole file.
  - Under the GUI, the subset run goes to a long-lived dt-validate instead
    (`commands/validate/worker.ts`, `scripts/dt-validate-worker.py`, spec VALIDATE-015): the
    owner is the GUI's pid, `process.pid` for its own runs (`workspace.context.long_lived`, GUI-011)
    and `ANALOG_ATTACH_VALIDATE_WORKER` for the child runs its server starts (GUI-010), and
    `run_dt_validate` asks the worker of that pid, project and `ValidateWorker.key` on a Unix
    socket, about 65 ms a check instead of 175.
    - The worker runs dt-schema's own `schema_group(...).check_dtb` and writes `error.json` as
      dt-validate does, keeping the last 4 schemas loaded (keyed by path, size and mtime).
    - The first run finds none: it starts one (detached) and runs dt-validate itself. Any other
      trouble (an error, no answer in 15 s, an `error.json` that doesn't read) runs dt-validate
      too, so the worker can only be slower, never another answer. Nothing of it is reported.
    - It leaves (`os._exit`, even mid-check) when its owner is gone, after 15 minutes idle, or
      when a check passes 10 s, so a stuck check costs one slow run and the next run starts
      another worker. It removes its socket only when the file is still the one it bound.
    - The socket is 0600 in `analog-attach-<uid>` under `$XDG_RUNTIME_DIR` or the temp directory
      (`private_directory`: 0700, the user's own, not a link); without one (Windows) there is
      no worker.
    - The runs on `validation.json` (the subset's fallback, `--full`) never use it.
    - A change to the worker, or a dt-schema bump, is checked against dt-validate over every
      overlay of a Linux tree (import each, then `validate --json` with and without the variable,
      one worker serving them all in turn), not only the tests. A rebuild of the CLI rewrites the
      script, so the next run starts a new worker: don't rebuild while such a run goes on.
  - `validation-cache/binding-subset-<key>.json` (`config/binding-subset.ts`, spec COM-138) is
    what the binding parser reads instead of `validation.json`: its `generated-types`,
    `generated-pattern-types` and `select: true` schemas, about 0.24 MB instead of 21 MB, keyed by
    `validation.json`'s size and mtime (and `SUBSET_VERSION`: bump it when what it keeps changes).
    The first command that loads `bindings` writes it (temp file and rename) and removes the
    subsets of another key; with none, the parser gets `validation.json`. The lib then takes the
    `select: true` list from it instead of scanning every binding YAML, which halves a command
    such as `list property <path>` (about 0.9s to 0.45s).
  - `validation-cache/prepared-schemas-<key>.json` (`config/prepared-schemas.ts`, spec COM-139)
    is linux-lib's `PreparedSchemas`: the property types and the `select: true` definitions,
    dereferenced and fixed up, which a process otherwise builds before its first binding (about
    180 of 280 ms). `parse_bindings` gives the parser the saved ones (`Bindings.prepared`), else an
    `on_prepared` that writes the ones the first parse builds (temp file and rename) and removes
    the files of another key. The key is `validation.json`'s size and mtime, the Linux tree,
    dt-schema's root and version, and the CLI's own bundle file (size and mtime: every build
    rewrites it), since the lib's fixups are in them. It takes `list property <path>` from about
    0.45s to 0.28s, and a GUI value update from about 1.2s to 0.8s.
  - Commands never build the caches; they only write the subsets and prepared schemas above. `rebuild_caches`
    (`config/rebuild.ts`) runs `dt-mk-schema`, then derives the index from its output
    (`build_compat_index`). A failed compile writes neither cache, so the previous pair stays.
  - `build_compat_index` (`utilities.ts`) reads each Linux tree binding's processed `compatible`
    in `validation.json` and never parses a binding. When several list a compatible, `claim`
    ranks them: the file named after it, then one that lists it first, then one with its own
    `select` (naming conventions such as `arm/qcom-soc.yaml`), then a fallback. Check a change
    to it against the whole tree (the old and new index of `~/linux_rpi`), not only the tests.
  - Only three paths call it: `config linux <path>`, `config --reload` (`reload_caches`, which
    checks the Linux tree and the installed dt-schema first) and the setup run (`ensure_caches`,
    which skips the build when `caches_current` says both are current). Progress goes through
    `session.progress`; `progress.ts` only formats the duration.
  - `parse_bindings` fails with a `config --reload` hint when either file is missing, so a command
    that has `bindings` can rely on both. A cache older than the bindings, or built for another
    Linux tree, only gives `cache_warning`, through `session.warn`. In completion it prints nothing.
    `sources_mtime` walks the bindings and the `dtschema` package; a long-lived process
    (`context.long_lived`) walks them at most once per 5 s (`recent_sources_mtime`, COM-081),
    since the GUI's runs come in bursts.
  - `Bindings` is `{ linux, dt_schema, processed_schema, validation_schema }`: `processed_schema`
    is the binding subset (else `validation.json`), what `Attach.parse` reads, and
    `validation_schema` is `validation.json`, what `validate` gives dt-validate. The
    `generated-types` give the properties a binding leaves untyped the type another binding
    declares (`nvmem-cells`, `sound-dai`, `mux-controls`).
  - Commands parse a binding through `parse_binding_once` (`binding-resolution.ts`), which
    passes the whole `Bindings` to `Attach.parse` (`resolve_node_binding`, `child_unit_radix`,
    `add`, `list`) and keeps the result for the rest of the process, per `Bindings` object,
    binding and controller (`--trace` parses afresh). So a run that reads a node twice parses its
    binding once. With `Bindings.long_lived` (set from
    `session.long_lived`), `parse_kept` keeps it across runs too (spec COM-141): by binding,
    controller and what `Bindings` names, at most 64 (least recently used dropped), while the
    binding file, `processed_schema` and `validation.json` keep their size and mtime and
    `recent_sources_mtime` is the same, so a `$ref`'d file's change is seen within 5 s. That's
    what takes an `update` under the GUI from ~90 ms to ~25 ms (AJV compiling the binding was
    most of it). Only `find_binding` (`utilities.ts`) uses `linux` and `dt_schema` alone.
- The overlay index (`overlay-index.ts`, not cached) maps each overlay file in the Linux tree (RPi
  `*-overlay.dts`, every `*.dtso`) to two things: the compatibles of the devices it adds, and its root
  compatible (the board).
  - It comes from a text scan with quoted `#include`s inlined.
  - `overlay_index` builds it on every call (about 10 ms for an RPi tree), so it is never stale.
  - Completion of `import` only lists the files (`overlay_files`).

## Property patterns

The lib (`Bindings/schema/PatternKind.ts`) splits a binding's patternProperties in two:
- object schemas and patterns with an `@` are child nodes (`NodeBinding.child_nodes`, matched by
  `match_pattern_rule`);
- the rest name properties (`NodeBinding.property_patterns`, e.g. `^adi,bypass-attenuator-in[0-4]$`),
  with the same fixups and types as named properties.

`find_property_definition` (`binding-resolution.ts`) looks a property up by name, then by property
pattern (the lib's `property_definition`): a pattern that says nothing of the value
(`"^in[13]-supply$": true`) takes the type of the first of `NodeBinding.selected_patterns` (the
`select: true` schemas' patterns: dt-core's `.*-supply$`, the unit suffixes) that matches the name, with
the binding's description (spec LIST-055). These all go through it: `update`'s shape hint, the suggestion check, `list value` and
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

## If/then narrowing

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

## Value suggestions

`list value` asks linux-lib's `IntelligenceStack.default()` for values: the binding and
base-devicetree layers (see `packages/linux-lib/src/Intelligence/CLAUDE.md`).
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
- `PropertyInfo.dt_type` and the Linux `PropertyDescription.dt_type` (`list devices`, `list
  property`) come from `format_dt_type` (`protocol/binding-to-description.ts`, spec LIST-057):
  dt-schema's type name (the lib's `dt_type`) plus the constraints read from the shaped `value`
  (`uint32-array · 2 items · each 0 to 15`), `untyped` where there is none.
- `AA_PREPROCESS_COMMAND` runs through `run_preprocess` (`utilities.ts`): `sh -c` with
  `settings.preprocess_environment` (`preprocess_environment` in `scripts.ts`, set by
  `load_workspace`: COM-152's for `preprocess`, the project's plain variables included, no
  secret) plus `AA_PREPROCESS_INPUT`, `AA_PREPROCESS_OUTPUT` and `AA_LINUX`. Nothing in the
  command is substituted.

## read

`read <path>` shows the node as the base and the overlay together have it (`effective_node`), so
base-only nodes (`spi0`) are readable too.
- Each property carries its `source` (`base` / `overlay`). The human output marks base values
  `// base`; `--quiet` doesn't.
- Next to `value`, a property with numbers has `written` (`written_value` in
  `protocol/dt-to-protocol.ts`, through `read_property`, READ-054): each number as the file
  writes it (`"0x53"`, `"(-1)"`), in the same nesting, `with_binding_type` wrapping it as it
  wraps `value`.
- `read <path> <prop>` adds `dt_type` whenever a binding was looked up (`untyped` when none
  defines the property).
- Children the overlay reaches are read in full. The rest collapse to their name and labels
  (`ReadNode.origin` `external`, no properties or children).
- The JSON has no `missing_required`; human mode prints `Missing required:`.
- Without a path, human mode prints the overlay file and `--json` gives `read /` without the
  collapsed children and the `base` properties (`overlay_root`, spec READ-011): each overlay node
  where it goes, and what the overlay sets on a base node (a bus's `status`) on that node. A
  fragment whose target the base lacks isn't in the merged tree, so isn't there either (R-7).
- A property's `suggestions` is `{ values, can_create }`. `can_create` is the lib's
  `creatable_providers` (`fixed-clock` for `clocks`, `regulator-fixed` for `*-supply`), which human
  mode prints as `Or add your own: analog-attach add <compatible>`.

`update <path> <prop>` without a value decides between reading and setting a flag on the same
merged node (`decide_update`). A set answers `ok`, `message` and `severity` alone (UPDATE-101 is
withdrawn): the GUI reads the node again after it. `delete`'s property positional completes only
what the overlay sets, while read and update offer the merged node's.

## Build and deploy commands

`build` and `deploy` run the project's commands, `AA_BUILD` and `AA_DEPLOY`, by default
`./aa_build.sh` and `./aa_deploy.sh` at the project root (`SCRIPTS`, `config/build-files.ts`;
spec 02-common.md §8.6, COM-158, BUILD-030, DEPLOY-030). The CLI compiles and copies nothing
itself.
- A command's environment is `script_environment(step, …)` (COM-152), `step` `build`, `deploy`
  or `preprocess`: the CLI's own, without the `AA_…` it inherited (`RESERVED_PREFIX`) and, but
  for `deploy`, the secrets' names; then the system variables of that step that have a value;
  then the project's plain variables; then, for `deploy` only, the secrets.
  - The system variables (`system_variables`, COM-153), from the settings as they stand
    (`session_sources`): `AA_PROJECT` (the project root), `AA_OUTPUT`, `AA_BUILD_DIR`
    (absolute), `AA_DTSO` (the workfile), `AA_DTBO` (output `overlay`), `AA_DTS` (output
    `devicetree`: the preprocessed full devicetree, `<state_dir>/build.preprocessed.dts`),
    `AA_DTB` (output `devicetree`), `AA_DTC` (the dtc on PATH, `find_dtc`), `AA_LINUX`, and
    `AA_PREPROCESS_INPUT` / `AA_PREPROCESS_OUTPUT` (no value here: `run_preprocess` sets them
    for each run). `AA_DTS` and `AA_DTC` go to `build` only, `AA_PROJECT` and `AA_LINUX` to all
    three, the preprocessor's two to `preprocess` only. One with no value (its setting unset, or
    for the other `output`) is left out. `linux_variables` (the backend's `ScriptVariables`,
    with `executables: EXECUTABLES`) gives them to `config`, which lists them.
  - The project variables are `config var <NAME> <value>` (the front end's, in the local
    settings file); all three steps get them.
  - A secret (`config var <NAME> --secret`) is stored by name only and goes to `deploy` alone
    (`SECRET_SCRIPTS`): `build` and the preprocessor don't get an inherited variable of its name
    either. Its value is the caller's environment's (`secret_from`, DEPLOY-040; the GUI passes
    it as the run's `environment`), else, on a terminal, typed at the hidden `password` prompt
    once the rest has loaded (DEPLOY-041). In a piped or `--json` run a missing one is a
    configuration error naming it (`missing_secret`, DEPLOY-042), reported with the workspace's.
- `run_script` runs the command with `sh -c` (`run_shell` in `shell.ts`) in the project root,
  each line of both streams through `session.progress`, and keeps its stderr. The progress line
  is `Building <workfile> with AA_BUILD` / `Deploying <file> with AA_DEPLOY`. A non-zero exit,
  or a command that didn't start, is a `tool-failed` refusal (`script_failure`: `Build failed:
  AA_BUILD exited with status 2`, or `… did not run: <why>`), the message followed by the
  stderr, which the text leaves out since it was on the terminal already. A `build` whose
  command succeeded but whose file (`derive_build_files`) isn't there answers with an
  `output-missing` warning (`AA_BUILD succeeded, but <file> is not there`).
- The starters (`commands/init/starters.ts`, INIT-100 to INIT-106, POSIX sh): `aa_build.sh`
  compiles `AA_DTSO` into `AA_DTBO` (or `AA_DTS` into `AA_DTB`) with `$AA_DTC -@`.
  `aa_deploy.sh` copies the file over SSH (ssh, scp, sshpass; the variables `BOARD_IP`,
  `BOARD_USER` and the secret `BOARD_PASSWORD`) to a Raspberry Pi running Kuiper, a `.dtbo`
  into the boot folder's `overlays/` with `dtoverlay=<name>` added to `config.txt`, a `.dtb`
  over `/boot/devicetree.dtb`, and reboots it. Their headers say they run while `AA_BUILD`
  (`AA_DEPLOY`) is its default. `init` writes each one that is missing (see *Setup run and
  init*). The names of earlier releases, `build.sh` and `deploy.sh`, aren't run (no migration).
- Each starter has the project variables it uses beside it (`STARTER_VARIABLES` in
  `starters.ts`, one list per script, INIT-107): `aa_build.sh` none; `aa_deploy.sh` `BOARD_IP`
  `analog.local` and `BOARD_USER` `analog` (a Kuiper image's hostname over mDNS and user) and
  `BOARD_PASSWORD` a secret, its name alone. `set_starter_variables` sets, through
  `session.settings.set_variable`, each one `variables()` doesn't have; one the project has,
  whatever its value or kind, is kept (INIT-108), and one that can't be written is a warning
  (INIT-109). The starter's header says so, and how to change them (`config var`).

## Full devicetree

With `output` `devicetree`, `build` writes the base with the overlay applied, for boards that
boot one devicetree, and `AA_BUILD` compiles it (`derive_build_files`: `build/<stem>.dts`, and
the `.dtb` the script writes).
- `write_full_devicetree` (`full-devicetree.ts`) prints it with the lib's
  `DeviceTreeOverlay.print_full(include)`: an `#include` of the base (`include_path`, relative
  when the two share a directory), then one `&label { … }` block per fragment. It then
  preprocesses it with `AA_PREPROCESS_COMMAND` into `<state_dir>/build.preprocessed.dts`
  (`PREPROCESSED`), which the command compiles: `AA_DTS` into `AA_DTB`.
- A fragment whose target names no node leaves no full devicetree: `build` refuses it, error
  type `unresolved` (BUILD-013); a preprocessing failure is `tool-failed`.
- The blocks go in `applied_fragments`' order (BUILD-016): a fragment on a node a later fragment
  adds comes right after that one.
- A label of the overlay that the base has on another node is written `<label>_<n>`, with the
  overlay's references to it (BUILD-017); the workfile is unchanged.

## System tools

The backend ships no tools (their licences: dtc is GPL, dt-schema pulls in GPL code). It runs what
is on PATH, looked up on every run (`config/tools.ts`, spec COM-118 / COM-119). A process that
runs several commands looks up dt-schema and the preprocessor's version once (COM-097, COM-141),
again when their files change:
- `find_dtc`: `dtc`, 1.6.0 or later (`DTC_MINIMUM`); a version it can't read is taken.
- `find_dt_schema`: `dt-mk-schema`, whose first line names its Python (`script_interpreter`:
  `#!<path>`, `#!/usr/bin/env <name>`, pip's long-path `#!/bin/sh` form). That Python answers a
  probe (`importlib`, without importing dtschema) with the directory holding the `dtschema`
  package (`DtSchemaInstall.root`, `Bindings.dt_schema`, which the binding parser reads) and its
  version, read from the package's `version.py` (`importlib.metadata` only without one: importing
  it takes most of the probe's time), with no bytecode written into the package (that would make
  the caches look stale). The probe is kept (`found_dt_schemas`) per `PATH` and `PYTHONPATH`
  while `dt-mk-schema`, its Python and the package keep their size and mtime; a problem is
  probed afresh. Only `DT_SCHEMA_VERSION` (2026.9) is taken; linux-lib's `vitest.globalSetup.ts` and
  `corpus/overlays/corpus.mjs` pin the same, so bump them together.
- `find_dt_validate`: `dt-validate`.
- `find_preprocessor`: the tool of `AA_PREPROCESS_COMMAND` (`preprocess_tool`: the first word
  of a one-line command that starts with a program's name or path, `cpp` by default), found when
  its `--version` runs (kept per `PATH` and tool file, `preprocessor_version`); no version is
  required. A command it can't look into (several lines, a shell word in `SHELL_WORDS`, a
  variable or assignment first) is run unchecked (`tool: "sh"`). `parse_base` reports a problem
  on the field `AA_PREPROCESS_COMMAND`, with its description.
- A problem is a `ToolProblem` with the install command as its hint (`install_command` per
  `SystemTool`, dtc or cpp, from `/etc/os-release`; `dt_schema_hint` with pipx); `workspace.ts`
  turns it into a `tool-missing` configuration error. `check_tools(program, preprocess_command)`
  is the setup run's report.
- `mk_schema_command`: the installed Python on `<assets_dir>/dt-mk-schema.py` (the build copies
  `scripts/dt-mk-schema.py` there), else the installed `dt-mk-schema`. The script runs
  dt-schema's per-file `process_schema` on a process pool, then hands the results to the
  upstream loop, so the output stays dt-schema's own.
- `validate_worker`: the installed Python on `<assets_dir>/dt-validate-worker.py` (the build
  copies `scripts/dt-validate-worker.py` there), with its `key`: the Python, dt-schema's root and
  version, and the script's path, size and mtime. Without the script there is no worker.
- The cache stamps carry `dt_schema` and `dt_schema_version`: another installation makes the
  caches stale.

Tests never use the machine's tools: the fixture (`testing/fixture.ts`, `write_fake_tools`) puts
a fake dt-schema 2026.9 (a `python3` that answers the probe, a `dt-mk-schema` it runs) and fake
`dtc` / `dt-validate` first on PATH for each `run`.

## Overlay syntax

The `overlay-syntax` setting picks the output format:
- `fragment` (default): `fragment@N { target = <&label>; __overlay__ { … } }`;
- `reference`: `&label { … }`.

All overlay writes go through the `Workfile` from `load_workspace`. The printer lives in
`linux-lib/src/Devicetree/syntax/Printer.ts`.

## update value format

`parse_value` (`property-value.ts`) parses the value tokens after the property name in
`update <path> <prop> <value...>`. `build_raw_property` resolves each token:
- Numbers → `bigint` cell values.
- Known macros (`GPIO_ACTIVE_LOW`, `IRQ_TYPE_EDGE_FALLING`, etc.) → their numeric values.
- Labels that exist in the base tree or overlay (bare or `&label`) → phandle references (`&label`).
- Unknown words in a cell context → **rejected** with a clear error message.

The binding gives only a shape hint (`flag` / `strings` / `cells` / undefined) and the width of
its cells (`cell_bits`: the `typeSize` of a list, a scalar or a matrix's rows, else 32). Cells of
another width are written `/bits/ <n> <…>` (`PropertyBuilder.build_cell_array(bits)`), and a label
among them is its one rejection: dtc only takes a reference in a 32-bit cell (UPDATE-035).

A value count outside the binding's minItems/maxItems is written with a warning (`count_warning`
in `item-count.ts`). The same bounds show in the type (`number[2]`, protocol `min_items` /
`max_items`).
- Value arrays (number, string, enum) have bounds.
- So does a specifier list whose entries have a known width: `interrupts` once the lib has shaped
  it for the interrupt-parent (entries × `#interrupt-cells`, so `[2]` for one gpio interrupt).
- So does `clocks` once the lib has shaped its row for the provider (`matrix_counts` in
  `protocol/dt-to-protocol.ts`: the binding's rows × the row's width, so `[1]` before a provider
  is set and `[2]` for one clock of a `#clock-cells = <1>` provider). What `update` writes is
  counted in clocks, not cells (`clock_count_warning`, UPDATE-043: the value split by each
  provider's `#clock-cells`, the lib's `clock_specifiers`), through `written_count_warning`.
- Lists whose entries name a phandle (dmas, `*-gpios`) have none, since each entry has as
  many cells as its provider.

A value outside the binding's bounds or enum is written with a warning too (`value_warning` in
`value-check.ts`, UPDATE-041), each number as dtc stores it in its cell's width, signed only when
the cell allows a negative. `-1` is built as a negative number cell (printed `(-1)`), and in a cell
that holds numbers but allows no negative (a `uint32` such as `spi-max-frequency`) dtc stores it
wrapped, which dt-validate then takes: the warning names both (`spi-max-frequency is unsigned,
got -1 (stored as 4294967295)`, UPDATE-042). `0xffffffff` written as such isn't negative.

`update <path> <prop>` with no value sets a flag or reads the property (see `decide_update`).

## list

The shared `list devices`, `list property` and `list value`, plus the backend's own `list parent`
(`commands/list/placement.ts`) and `list overlay` (`commands/list/overlay.ts`). `list context`
(`commands/list/context.ts`) lists the base devicetrees of the Linux tree (`base_devicetrees`),
with a filter only those whose path in the tree contains it (`list context rpi-4`, LIST-133): a
skill finds the board's without reading all of them (about 1900, 300 KB of JSON). The GUI's
picker lists them all, without one. noos refuses a filter (LIST-512).

`list node [<filter>]` (`commands/list/node.ts`, LIST-140 to LIST-143) lists every node of the
merged tree in one walk (`merged_nodes`): path, labels, compatibles, status, `origin` as `read`
has it and `change` as the GUI's tree tags it, no properties. A filter keeps the nodes whose name,
label or compatible contains it, not their ancestors. The GUI's devicetree search reads it once,
without a filter, as its index: `read` collapses the base, so the tree alone can't search it.

`list overlay <compatible>` reads the overlay index and grades each overlay with `board_fit`
(`board-fit.ts`):
- It compares the overlay's root compatible with the base's, loosened by the `FAMILIES` table for
  generic SoC compatibles (`brcm,bcm2835` = any Pi). Compatible ones come first.
- It also lists the overlays that add another compatible of the device's binding
  (`binding_siblings` in `utilities.ts`, `overlays_matching`). These are marked `matched` / `via`
  and come after the exact ones of their fit.
- Without a compatible (`every_overlay`, spec LIST-116) it lists every overlay, none marked, and
  loads only `linux` and `base`, not the bindings. Each row carries `devices` (what the scan
  found it adds), which the human lines show as `adds …`. The GUI's Import searches this list.

The hidden `__list` of attach-linux is withdrawn. `complete.ts` calls the data functions of
`commands/list/data.ts` directly.

## Setup run and init

The Linux `setup` (`commands/setup/command.ts`, spec `setup.md`) runs from the front end's bare run
once the backend is linux.
- It first checks the tools (`step_tools`, SETUP-100+: dtc, the preprocessor, dt-schema):
  `✓` lines, or each problem with its hint, once the offer to run the pipx commands
  (`pipx_install`, output via `session.progress`), then `Check the tools again?` until they are
  there or the user says no (a refusal). dtc and cpp are never installed. Tests inject `check_tools`, `pipx` and `install` (`SetupOptions`).
- Like the noos setup, it walks the Linux tree, the base devicetree and the workfile (`run_steps`
  with `step_linux`, `step_context`, `step_overlay` in `setup.ts`, through `session.prompter`).
  - A setting that is set and valid is skipped (`✓ linux: <path>`); a set but invalid one is
    named and asked again.
  - Each answer is saved at once through `session.settings.set` (`SetupRun.save`, `✓ <key> =
    <value>`), so a stopped run keeps what was answered.
- `find_linux_trees` lists any directory under ~ with `Documentation/devicetree/bindings/` and
  `include/`, whatever its name.
- The `.dts` search is the prompter's `search`.
- The workfile:
  - unset: its name is asked (an existing file is refused), and `init` creates it;
  - set: it is kept. When its file doesn't exist yet, `Create <file>?` is asked.
- Then it builds the binding caches unless they are current (`ensure_caches`). It creates no
  file, and a failed build leaves the settings saved.
- Its response is `ready` when the file exists, was just named, or the user said yes, and the
  front end then runs `init`. Otherwise it prints the summary (`format_summary` in
  `commands/init/command.ts`), which says `Workspace configured` and makes `analog-attach init`
  the first next step.
- Cancelling it (Ctrl-C/Ctrl-D) exits 130 with `Stopped. What was answered is saved; …`
  (`cancelled`). Stopping the add interview exits 0, since the node is added.

`init` (`commands/init/command.ts`, spec `init.md`) never asks, builds no cache and changes no
setting; the only thing it writes to the settings file is a starter's variables.
- It loads `bindings`, `base` and `overlay_path`, so `linux`, `devicetree` and `workfile` must be
  configured; otherwise it gives the merged setup hint.
- `init_workfile` keeps the workfile when its file exists, or creates it empty at the configured
  path (`create_workfile`). It never picks another name.
- It refuses (`ok: false`) a path that isn't a file or whose directory is missing
  (`creation_problem` in `workfile.ts`, also used by `config workfile`).
- It then writes the starter `aa_build.sh` and `aa_deploy.sh` at the project root when they are missing
  (`write_starters` / `write_starter`, executable, INIT-100, INIT-101) and keeps one that is
  there, as the user edited it; one it can't write is a warning (INIT-102). With a starter it
  wrote, not one it kept, it sets that starter's variables (`set_variables`, INIT-107).
- `init --restore build|deploy` writes that starter over the file (`restore`, INIT-104 to
  INIT-106), sets its variables, and loads nothing else: `RestoreResponse` `{ path, created,
  variables }`; the text is `Wrote the starter …`, then `Set variable …` (`config var`'s
  wording, `variable_text`) for each variable set.
- `InitResponse` (`protocol/types.ts`) is the base `{ path, created }` plus `linux`, `devicetree`,
  the deprecated `overlay`, and `scripts` (each script's `path`, whether it was `created`, and
  the `variables` set with it, `ProjectVariable`s, `[]` when none; one not written is left
  out). `format_summary` adds the `Variables:` line and the `config var` hint when one was set
  (INIT-110).

## import

`import <overlay>` (`commands/import/command.ts`) creates a workfile from an overlay of the Linux
tree, found by path, file name or stem in the overlay index (`find_overlay`), or from a file path.
- When a workfile is already configured, the new one replaces it in the settings and the old file
  is kept (`ImportResponse.replaced`).
- The overlay is preprocessed with `AA_PREPROCESS_COMMAND` (`run_preprocess` in `utilities.ts`, also
  used by the base and by `add --template`) and parsed against the base.
- Its root `__overrides__` is dropped (the lib's `remove_root_node`); everything else is kept as
  written.
- `workfile_from_overlay` (`workfile.ts`) names the file after the overlay and saves the setting.
- Warnings: the board fit when incompatible (`board_fit` on the text scan's root compatible), and
  the lib's `unresolved_targets` / `unresolved_references`. `unresolved.ts` prints these: a
  heading per kind, one row per node and property, label-first paths via `display_path`. The
  copied `add --template` kinds share it for their errors, and `validate` its wording
  (`target_finding`, `reference_finding`).
- A target or reference that names no node is error type `unresolved` in `import`, `validate`
  and `build`'s full-devicetree refusal (BUILD-013); the Linux backend doesn't use
  `bad-reference`.

## add

`add` auto-picks unit addresses (when the binding defines `reg`), generates default labels from the
compatible, and refuses duplicates.
- The tree logic is the lib's `add_node` (`Devicetree/AddNode.ts`), which returns structured notes
  and refusals. The command only resolves the parent identifier, checks the binding for `reg`, and
  formats messages.
- Without `--name`, a taken name with no unit address to tell the nodes apart is numbered
  (`regulator-fixed-1`: the lib's `unique_node_name`, through `add_node`'s `number_name`, and in
  `copy_example_node`), with a `numbered-name` note (ADD-054, ADD-069). A taken `--name` is still
  refused.
- `AddResponse.label` is the node's label in every Linux add answer, `--dry-run` included.
- `add` needs a configured workfile whose file exists (`load_workspace` with `overlay`) and never
  creates one: with none configured it reports the setup hint.

### Parent

Without `--parent`, `add` takes the parent itself (`commands/add/parent.ts`: `default_parent` /
`pick_parent` / `parent_note`).
- On a terminal (`--template required`, no `--quiet`, `interview` on), the parent is the first
  question (`ask_parent` in `commands/add/interview.ts`): a lettered list of the `list parent`
  results.
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

### Templates

`add --template <required|example:N|overlay:name>` (`commands/add/template.ts`) says what the node
starts from:
- `required` is the bare node and the interview.
- `example:N` (`commands/add/example.ts`: `find_examples`, `pick_example`) preprocesses each binding
  example (into `<state_dir>/example.dts`). It copies the node of example N that has the compatible
  or another of its binding (`device_matcher`, via the compat index). Each `ExampleMatch` records
  the compatible of the binding it was found by (`compatible`). The `--template` completion
  (`template-suggest.ts`, `example_suggestions`) adds `, written for <it>` when the node doesn't
  list the compatible asked.
- `overlay:name` (`commands/add/overlay-template.ts`) finds the overlay as `import` does
  (`locate_overlay`). It copies the first node of the device in an `__overlay__` body, or in a
  `__dormant__` one when no live body has it, with its children.
  - Without `--parent`, the node goes in the fragment's target.
  - A target the base lacks gets the first `list parent` bus of its kind (`default_parent` /
    `target_bus` in `parent.ts`), with a warning.

Both copies go through `copy_example_node` (`example.ts`) and keep the node as written: taken
labels get free ones, and references to them follow; a node that doesn't list the compatible
asked gets it as its `compatible` (`compatible-replaced`). `--name` renames the copy (`copy_name`
/ `readdress`, spec ADD-068): a name with no unit address keeps the node's own and its `reg`;
another unit address rewrites `reg` as `add_node` does (`encode_reg_address` in the parent's
cells), or drops it for a unit address that isn't hex. The name is checked, then the key, then
`--label`. They never interview, and they list the references that resolve to nothing
(`AddResponse.unresolved`).

## Missing-required interview

After the add, the node's missing required properties (`node-state.ts`) are either asked for or
listed.
- They are asked for on a terminal: `missing-interview.ts` runs `commands/add/interview.ts`, which
  writes each answer through update's `apply_update`.
- They are listed when piped, with `--quiet` or `interview` off, or as
  `AddResponse.missing_required` under `--json`.

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

A required `*-gpios` or `clocks` is asked row by row (`question_entries`' row branch, when
`PropertyInfo.specifier_rows` (`kind` `gpio` or `clock`) and `phandle_options` are both there:
`property_info` sets them from the lib's `gpio_pick` / `clock_pick` while no controller or provider
is set, the rows being the type's). `question_entries` gets the cells after the phandle from
`RowCells` (`tree_row_cells(tree)`: the lib's `gpio_row_cells` and `clock_row_cells`). `clocks`
(ADD-128) asks the `provider`, then one `cell <k>` number per `#clock-cells`, none for a fixed
clock; what follows is said of the GPIO rows, and holds for the clock rows the same way.
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

## Unit addresses

`rename` syncs reg↔unit address, and `update reg` renames the node. Unit addresses are hex, except
for child nodes whose parent binding names them in decimal (`^channel@([0-9]|1[0-5])$`):
- The lib's `unit_radix` probes the patterns, and `child_unit_radix` (`binding-resolution.ts`)
  reads them from the parent's binding.
- `update <path> <child@n>`, `update reg` and `rename` pass the radix on.
- `add` stays hex, since devices sit on buses where dtc requires it.
- The lib's `encode_reg_address` writes the address cells in the unit address's radix (`0x1d`,
  or `10` for a decimal-radix child such as an ad7124 `channel@10`) and the size cells as `0`.
  `update … reg <value>` writes `reg` as typed (a hex literal stays hex).

## Overlay fragments

The lib helpers are in `UnitAddress.ts` and `Labels.ts`. `DeviceTreeOverlay.ensure_node(path)`
gives the overlay node to write into for any absolute path, creating a fragment for base-only nodes.

Fragments are matched by the node their target resolves to (`&i2c_arm` and `&i2c1` are one node).
An overlay can have several for one node (imports often do):
- `overlay_nodes_at` gives them in the order they apply (`applied_fragments`: file order, a
  fragment on a node a later fragment adds after that one);
- `overlay_properties` gives the values that apply (a later fragment wins, as in dtc);
- `property_node` gives the one holding a property;
- `merged_overlay_node` gives all of them as one node.

So `read` sees every fragment, `update` writes where the applied value is, and `remove_property`
removes it from all.

## enable / disable

`set_node_status` (`commands/enable-disable/command.ts`) writes `status` (ENABLE-011) only when
it differs from the node's without the overlay: the base's (enabled is `is_active`, disabled the
string `disabled`; another value, such as `fail`, is neither), or enabled for a node the overlay
adds. Otherwise (ENABLE-012) it removes the overlay's `status` from every overlay node at the
path with `remove_property`, whose `cleanup_empty_fragments` drops every fragment left empty
(spec E-3), and the message says `(as in the base: status removed from <file>)`, `(… nothing to
change in <file>)`, or `as the overlay adds it`. The overlay is saved only when it changed, so a
`disable` of a node the base already disables writes nothing.

## Reg clashes

`reg-conflicts.ts` (`reg_warnings`) turns the lib's `reg_conflicts` / `sibling_reg_conflicts`
(`Devicetree/checks/RegConflicts.ts`) into warnings worded for the bus: chip select, I2C address,
overlapping range. When the other node comes from the base tree, the warning adds a "disable <base
node>" hint.
- `validate` appends them to the dt-validate diagnostics, on the node's absolute path, which the
  validation tree's findings have too (`build_validation_tree`, spec VALIDATE-001), so they group
  with them, and leaves out base-only clashes.
- `update … reg`, `rename` and `add` warn about the node they touched, through `session.warn`.
- After them `validate` appends `unsigned_diagnostics` (VALIDATE-120): each
  property of an `__overlay__` body that holds a negative (`has_negative`, so an overlay without
  one looks up no binding) gets its definition as `update` finds it (`resolve_property_definition`)
  and, from `unsigned_finding`, the same "is unsigned" wording as `update`'s warning, on the
  property's absolute path (a fragment whose target resolves to no node is skipped). The GUI shows
  it on the node card for as long as the value stays.
- Then come `parent_diagnostics`, from `disabled_parent_warnings` (`disabled-parent.ts`,
  VALIDATE-130): each node the overlay adds directly under a base node (a device, not its
  channels) that is enabled while that node, as the merged tree has it, isn't (`is_active`), as a
  warning on the device's absolute path with no property, error type `unresolved` and the hint
  `Enable it: enable <parent path>`. Linux probes nothing under a node that is off, and
  dt-validate checks each node on its own. The GUI shows it on the device's card until the parent
  is enabled. On the RPi 4 base `i2c1` and `spi0` are off, so a functional test that counts
  warnings enables its bus first.
- Then `target_diagnostics` (VALIDATE-141): each fragment whose target resolves to no node
  (`target_node_path` undefined, so its nodes are under `/node<N>` in the validation tree), as a
  warning with no node, error type `unresolved`, in import's words (`target_finding`).
- Last, `reference_diagnostics` (VALIDATE-140): each reference of an `__overlay__` body that the
  lib's `reference_resolver` finds no node for (`unresolved_in`, the body walked at its
  validation-tree place), as an `unresolved` warning on the property's path, worded by
  `reference_finding` (`unresolved.ts`). Neither warning has a "did you mean" hint.
  dtc takes such a reference in an overlay as a fixup, which the board then can't resolve.
- With `--full`, a fragment target that names no node leaves no full devicetree: the full run is
  skipped (`check_full`'s `skipped`, VALIDATE-041), adding the nodeless `full devicetree not
  checked: …` warning and no `base_findings`. A preprocessing failure is still a refusal.
- Buses are checked whatever their own status, since a bus is often enabled later.
- A node counts as the overlay's when the overlay adds it or sets its reg or status. So a base node
  the overlay only adds children to (pin groups under gpio) keeps its base clashes out.
- The same warnings report an SPI device whose chip select has no entry in its controller's
  `cs-gpios` (`chip_select_overflows`). Entries are a phandle plus the provider's `#gpio-cells`,
  or a lone 0. Controllers without `cs-gpios` aren't checked, since their native chip select count
  is up to the driver.

## Interrupt-parent

Setting `interrupts` without an explicit `interrupt-parent` writes the inherited one automatically
and warns on cell-count mismatches. The lib's `interrupt_parent.ts` provides the path-based
inheritance walk.

## SPI vendor peripheral-props filtering

`Bindings/stages/VendorFilter.ts` in the lib removes vendor-specific SPI peripheral properties (pl022,
cdns, fsl, nvidia, st) unless they match the parent controller's compatible. Under a parent whose
name isn't an SPI controller's (`spi-controller.yaml`'s `$nodename`), it also removes the SPI
peripheral properties the binding doesn't require, as the Linux tree's `spi/` schemas name them
(`load_spi_peripherals`). It is applied at binding parse time and to every narrowed binding, when
a controller is given: `resolve_target_binding` passes the parent's compatibles and full name
(`WriteTarget.parent_full_name`). `update`'s own resolution passes none, so it writes a hidden
property without a warning (spec LIST-038).
