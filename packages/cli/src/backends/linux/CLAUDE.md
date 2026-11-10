# CLAUDE.md: the Linux backend

Part of `packages/cli/CLAUDE.md` (read that first).

`src/backends/linux/index.ts`:
- the shared commands;
- the extras `move`, `enable`, `disable`, `list parent`, `list overlay`;
- `setup`, `complete`, `linux_settings_hooks`;
- the skill `analog-attach-linux`.

Paths in this section are under `src/backends/linux/` unless they say otherwise.

## Command grammar

Every targeting command uses `<command> <path> [<property>] [<value>...]`:
- `<path>` is one `/`-separated token: label-first (`spi0/adc@0`) or absolute (`/soc/spi@7e204000`).
- `<property>` is a separate positional.
- Values are positional tokens after the property.
- `add` takes `--parent`; `move` takes two positional paths.
- `enable` / `disable` take a positional path.
- Shell completion works segment by segment within a single token.

Path helpers are in `utilities.ts`: `parse_node_path`, `parse_property_name`, `parse_target`,
`resolve_path`, `not_found_message`.

## Settings and workspace state

Config is parsed, not validated. `config/` turns the settings into checked resources, and a command
that gets them cannot fail because of the configuration.

- `config/settings.ts`: `SETTINGS`, the backend's `SettingSpec`s:
  - `linux`, `devicetree`, `workfile` (the overlay), `overlay-syntax`, `preprocess-command`;
  - `interview` (`false`: `add` and `update <path> <child>` ask nothing on a terminal, the
    parent question included);
  - `output` (`overlay`, the default, or `full`: see *Full devicetree*), `build-command`,
    `build-dir` (a string, `build` by default), `deploy-command`;
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
  false, outcome }`. It resolves `build-dir` against `project_root` (`build_folder`). The resources
  it can parse:
  - `linux`: the checked Linux tree alone (`list context`).
  - `bindings`: the Linux tree has `Documentation/devicetree/bindings/` and `include/`, and
    dt-schema 2026.9 is installed (`parse_dt_schema`, looked up once per load).
  - `tools`: dtc, the `dt-mk-schema` command (`mk_schema_command`) and dt-validate, from PATH.
  - `base`: the DTS, run through `preprocess-command` into `<state_dir>/preprocessed.dts` on every
    invocation, then parsed.
  - `overlay`: a `Workfile` parsed against the base, with `print()` / `save()` honouring
    `overlay-syntax`.
  - `overlay_path`: the configured workfile's path, whether its file exists or not (`init`).
  - `deploy`: the deploy fields plus the file `build` wrote, from `derive_build_files` (in the
    build folder, named after the workfile: the `.dtbo`, or the `.dtb` under `output` `full`).

  `build` and `deploy` with `build-command` / `deploy-command` set load only `overlay_path` and run
  the command with `run_shell` in the project root.

  Errors from independent resources are collected and reported once (`format_config_errors`,
  `config_errors_outcome`) as a refusal, exit 0, in both modes. Under `--json` it also carries
  `errors` and `hints` (`ConfigRefusal`, `$defs/config-refusal`). `parse_bindings` /
  `parse_overlay` / `optional_bindings` serve the callers that make bindings optional (`list
  value`, completion).
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
    checks the Linux tree and the installed dt-schema first) and the setup run (`ensure_caches`,
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

## read

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

## Full devicetree

With `output` `full`, `build` writes the base with the overlay applied instead of a `.dtbo`
(`derive_build_files`: `build/<stem>.dts` and `.dtb`), for boards that boot one devicetree.
- `write_full_devicetree` (`full-devicetree.ts`) prints it with the lib's
  `DeviceTreeOverlay.print_full(include)`: an `#include` of the base (`include_path`, relative
  when the two share a directory), then one `&label { … }` block per fragment. It then
  preprocesses it with `preprocess-command` into `<state_dir>/build.preprocessed.dts`, which dtc
  compiles.
- `deploy` copies the `.dtb` to `/boot/devicetree.dtb` (`REMOTE_PATHS`).
- `{output}` / `{dtbo}` of `build-command` / `deploy-command` name the `.dtb`; no `.dts` is
  written for them.

## System tools

The backend ships no tools (their licences: dtc is GPL, dt-schema pulls in GPL code). It runs what
is on PATH, looked up on every run (`config/tools.ts`, spec COM-118 / COM-119):
- `find_dtc`: `dtc`, 1.6.0 or later (`DTC_MINIMUM`); a version it can't read is taken.
- `find_dt_schema`: `dt-mk-schema`, whose first line names its Python (`script_interpreter`:
  `#!<path>`, `#!/usr/bin/env <name>`, pip's long-path `#!/bin/sh` form). That Python answers a
  probe (`importlib`, without importing dtschema) with the directory holding the `dtschema`
  package (`DtSchemaInstall.root`, `Bindings.dt_schema`, which the binding parser reads) and its
  version. Only `DT_SCHEMA_VERSION` (2026.9) is taken; attach-lib's `vitest.globalSetup.ts` and
  `corpus/overlays/corpus.mjs` pin the same, so bump them together.
- `find_dt_validate`: `dt-validate`.
- `find_preprocessor`: the first word of `preprocess-command` (`cpp` by default), found when its
  `--version` runs; no version is required. `parse_base` reports it on `preprocess-command`.
- A problem is a `ToolProblem` with the install command as its hint (`install_command` per
  `SystemTool`, dtc or cpp, from `/etc/os-release`; `dt_schema_hint` with pipx); `workspace.ts`
  turns it into a `tool-missing` configuration error. `check_tools(program, preprocess_command)`
  is the setup run's report.
- `mk_schema_command`: the installed Python on `<assets_dir>/dt-mk-schema.py` (the build copies
  `scripts/dt-mk-schema.py` there), else the installed `dt-mk-schema`. The script runs
  dt-schema's per-file `process_schema` on a process pool, then hands the results to the
  upstream loop, so the output stays dt-schema's own.
- The cache stamps carry `dt_schema` and `dt_schema_version`: another installation makes the
  caches stale.

Tests never use the machine's tools: the fixture (`testing/fixture.ts`, `write_fake_tools`) puts
a fake dt-schema 2026.9 (a `python3` that answers the probe, a `dt-mk-schema` it runs) and fake
`dtc` / `dt-validate` first on PATH for each `run`.

## Overlay syntax

The `overlay-syntax` setting picks the output format:
- `fragment` (default): `fragment@N { target = <&label>; __overlay__ { … } }`;
- `label`: `&label { … }`.

All overlay writes go through the `Workfile` from `load_workspace`. The printer lives in
`attach-lib/src/Devicetree/syntax/Printer.ts`.

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
- Lists whose entries name a phandle (clocks, dmas, `*-gpios`) have none, since each entry has as
  many cells as its provider.

`update <path> <prop>` with no value sets a flag or reads the property (see `decide_update`).

## list

The shared `list devices`, `list property` and `list value`, plus the backend's own `list parent`
(`commands/list/placement.ts`) and `list overlay` (`commands/list/overlay.ts`). `list context`
(`commands/list/context.ts`) lists the base devicetrees of the Linux tree (`base_devicetrees`).

`list overlay <compatible>` reads the overlay index and grades each overlay with `board_fit`
(`board-fit.ts`):
- It compares the overlay's root compatible with the base's, loosened by the `FAMILIES` table for
  generic SoC compatibles (`brcm,bcm2835` = any Pi). Compatible ones come first.
- It also lists the overlays that add another compatible of the device's binding
  (`binding_siblings` in `utilities.ts`, `overlays_matching`). These are marked `matched` / `via`
  and come after the exact ones of their fit.

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

## import

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

## add

`add` auto-picks unit addresses (when the binding defines `reg`), generates default labels from the
compatible, and refuses duplicates.
- The tree logic is the lib's `add_node` (`Devicetree/AddNode.ts`), which returns structured notes
  and refusals. The command only resolves the parent identifier, checks the binding for `reg`, and
  formats messages.
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

A required `*-gpios` is asked row by row (`question_entries`' GPIO branch, when
`PropertyInfo.gpio_rows` and `phandle_options` are both there: `property_info` sets them from the
lib's `gpio_pick` while no controller is set, the rows being the type's).
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

## Overlay fragments

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

## Reg clashes

`reg-conflicts.ts` (`reg_warnings`) turns the lib's `reg_conflicts` / `sibling_reg_conflicts`
(`Devicetree/checks/RegConflicts.ts`) into warnings worded for the bus: chip select, I2C address,
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
