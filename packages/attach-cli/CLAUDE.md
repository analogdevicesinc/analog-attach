# CLAUDE.md

## Overview

`attach-cli` is the standalone `attach-linux` binary — a CLI tool for AI coding assistants to configure Linux device tree overlays. It wraps `attach-lib` (bundled at build time) and exposes all DTS/binding operations as subcommands.

## Commands

The `prebuild` step runs `tsc --noEmit` for type-checking; the actual output is produced by `tsup`. Type errors caught by `tsc` will block the build.

## Architecture

### Command structure

The entry point is `src/bin/cli.ts`, which strips the `--json` flag from argv before handing off to `commander`, then builds a `LocalContext` with `json: boolean` that every command receives. A bare `attach-linux` on a terminal (no arguments, no `--json`) runs `init`. In JSON mode, commander errors are routed through `input_error` (exit 2) via `exitOverride` / `configureOutput`.

### Command grammar

Every targeting command uses: `<command> <path> [<property>] [<value>...]`
- `<path>` is one `/`-separated token: label-first (`spi0/adc@0`) or absolute (`/soc/spi@7e204000`)
- `<property>` is a separate positional
- Values are positional tokens after the property (no `--with`)
- `--parent` (not `--to`) on `add`; `move` takes two positional paths
- `enable`/`disable` take a positional path (not `--node`)
- Shell completion works segment by segment within a single token

### JSON protocol mode

All commands accept a global `--json` flag (stripped in `cli.ts` before `commander` sees it) that switches output from human-readable `console.log` to JSON on stdout. The protocol layer lives in `src/protocol/`:

- `output.ts`: `respond()` / `respond_fail()` write JSON to stdout; `input_error()` writes to stderr with exit code 2; `cancelled()` prints to stdout with exit code 130 (a prompt stopped before anything was written); `diagnostic()` writes non-fatal info to stderr.
- `types.ts`: Typed response interfaces for each command (`AddResponse`, `ReadResponse`, `ValidationResponse`, etc.) as well as the shared `CommonResponse`.
- `descriptions.ts`: New description types (`DeviceDescription`, `PropertyDescription`, `TypeDescription`) for the `list` command.

Commands in `src/app.ts` are annotated with `// protocol commands` (used by AI tooling) vs `// human-only commands`.

### Configuration and workspace state

Config is parsed, not validated: `src/config/` turns config.toml into checked resources, and a command that gets them cannot fail because of the configuration.

- `settings.ts`: the `SETTINGS` registry, which config-set, config-get and completion all derive from. It holds only user settings, all from `.attach-linux/config.toml` (relative to CWD): `linux`, `devicetree`, `overlay`, `overlay-syntax`, `preprocess-command`, `deploy-*`. The environment is not read. `parse_settings` is strict: unknown keys and non-string or out-of-options values are errors. Paths are resolved to absolute and defaults are applied. `save_settings` writes in registry order and keeps unknown keys, so the next load still reports them.
- `workspace.ts`: `load_workspace(context, needs)` reads the settings and parses the requested resources:
  - `bindings`: the Linux tree has `Documentation/devicetree/bindings/` and `include/`, and the bundled dt-schema exists.
  - `tools`: the bundled dtc and dt-* binaries.
  - `base`: the DTS, run through `preprocess-command` into `.attach-linux/preprocessed.dts` on every invocation, then parsed.
  - `overlay`: a `Workfile` parsed against the base, with `print()` / `save()` honouring `overlay-syntax`.
  - `deploy`: the deploy fields plus the `.dtbo` derived from the overlay path.

  Errors from independent resources are collected and reported once (`report_config_errors`; exit 2 under `--json`). `parse_bindings` / `parse_overlay` are exported for callers that make bindings optional (`list value`, navigate completion) or that create the workfile first (`add`).
- `cache.ts`: derived state under `.attach-linux/` that never goes into config.toml. `compat-index.json` maps compatible → binding YAML. `validation.json` is the `dt-mk-schema -j` output and has a `validation.stamp.json` next to it (`build_validation_schema` writes a temp file and renames it, so a failed build leaves the old file). Commands never build them: `rebuild_caches` (`config/rebuild.ts`) builds both at once, the index in this process while `dt-mk-schema` runs as a child, and only `config-set linux`, `config-get --reload` (a bare `config-get`, no field names) and `init` call it (`init` through `ensure_caches`, which skips the build when `caches_current` says both are current for the Linux tree) (`reload_caches` checks the Linux tree, bundled dt-schema and tools first; progress on stderr via `src/progress.ts`). `parse_bindings` fails with a `config-get --reload` hint when either file is missing, so a command that has `bindings` can rely on both. A cache older than the bindings, or built for another Linux tree, only gives `cache_warning` (printed on stderr by `load_workspace`; shell completion calls `silence_cache_warnings()`). `Bindings` is `{ linux, dt_schema, processed_schema }`, the last being `validation.json`: `dt-mk-schema -j` output whose `generated-types` give the properties a binding leaves untyped the type another binding declares (`nvmem-cells`, `sound-dai`, `mux-controls`). Commands pass the whole `Bindings` to `Attach.parse` (`resolve_node_binding`, `child_unit_radix`, `add`, `list`); only `find_binding` and the compat index build (`build_compat_index`, which reads `compatible` only) use `linux` and `dt_schema` alone.
- The overlay index (`src/overlay-index.ts`, not cached) maps each overlay file in the Linux tree (RPi `*-overlay.dts`, every `*.dtso`) to the compatibles of the devices it adds and its root compatible (the board), from a text scan with quoted `#include`s inlined. `overlay_index` builds it on every call (about 10 ms for an RPi tree), so it is never stale; completion of `import` only lists the files (`overlay_files`).

Path helpers in `src/utilities.ts`: `parse_node_path`, `parse_property_name`, `parse_target`, `resolve_path`, `not_found_message`.

### Dependency on attach-lib

`attach-lib` is a dev dependency resolved from the workspace. `tsup` bundles it into the output via `noExternal: ["attach-lib"]`, so the published `dist/` is self-contained. The `yaml` package is intentionally kept external.

### Property patterns

A binding's patternProperties are split by the lib (`Bindings/PatternKind.ts`): object schemas and patterns with an `@` are child nodes (`NodeBinding.child_nodes`, matched by `match_pattern_rule`); the rest name properties (`NodeBinding.property_patterns`, e.g. `^adi,bypass-attenuator-in[0-4]$`), with the same fixups and types as named properties. `find_property_definition` (`src/binding-resolution.ts`) looks a property up by name, then by property pattern; `update`'s shape hint, the suggestion check, `list value` and `property_info` (`read`, `list property <path> <prop>`) all go through it. `list property <path>` shows the names a pattern matches (the lib's `expand_pattern`: `channel@0 … channel@15`, or a stem such as `fan-…`), with the regex as the JSON value. Completion of the property positional (`navigate_candidates`, on the node as the base and the overlay together have it: `navigate_node` / `effective_target_node`, which `list property <path>` uses too) adds `pattern_candidates`: the pattern names not set or present yet, or the stem as a `partial` suggestion, which the shell completes without a trailing space. Unanchored patterns (`-supply$`) offer nothing. The candidates come in two groups (`Suggestion.group`): `set` (the children and every property the node has) and `not set` (the binding's unset properties and the pattern names). `__complete` prints a `__ATTACH_COMPLETE_GROUP__` line before each group, and `short_description` cuts a display that repeats the value down to its note (`reg (required)` → `required`). zsh lists each group under its heading, one line per candidate in the engine's order (the stub sets `list-grouped false` for attach-linux unless the user has set it); bash and fish skip the group lines.

### If/then narrowing

`NodeBinding.properties` and `.required_properties` are the binding's unconditional lists. `narrow_and_populate(node)` also returns `required_properties` once the node's data has selected its `if/then/else` branches (ad5592r requires `spi-cpol`, ad5593r forbids it), and `narrowed_binding(binding, node)` (`src/binding-resolution.ts`) gives the binding with both narrowed lists, the binding itself when narrowing fails. `node_missing_required`, `property_info`'s `required`, `value_suggestions` (the lists passed to the intelligence stack, so a required flag gets its pinned `true`), `list property <path>` and completion (`suggest_navigate`) use it; `navigate_candidates` stays pure.

### Value suggestions

`list value` asks attach-lib's `IntelligenceStack.default()` for values (binding and base-devicetree layers, see `packages/attach-lib/src/Intelligence/CLAUDE.md`), placing the node with `placement_from_overlay` and passing the base with the overlay applied (`DeviceTreeOverlay.merged_tree()`) as the context devicetree, so the overlay's own nodes (a regulator it adds, a controller it enables) are candidates (for `clocks` and `*-supply`, the ones the overlay adds come first); `resolve_target_binding` fills phandle enums from the same tree. The data paths are `resolve_target_binding` / `value_suggestions` / `property_info` in `src/commands/list/suggest.ts`, which `read` (and `update` without a value, via `read_target`) reuse for the description, allowed values and suggestions under a property; `src/node-state.ts` gives a node's missing required properties, and `property_details` for read and the add interview. The binding layer suggests every option of a single-value enum (the binding's default first); `format_details` leaves out those that only repeat the `Allowed:` line. A phandle enum (`PropertyInfo.phandle_options`) gets no `Allowed:` line; the options the suggestions leave out follow them as `other_candidates`, marked disabled, enabled, or enabled by the overlay, and are never the interview's Enter default. A suggestion's `note` comes only from the CLI (those marks); the devicetree layer gives clocks, supplies and interrupt parents none. Lib suggestions are structured cell rows; `format_suggestion` (`src/commands/update/command.ts`) turns them into value strings and is the inverse of `parse_value`. Command templates (`preprocess-command`, the build command) go through `substitute_command` / `is_tool_available` in `src/utilities.ts`.

### read

`read <path>` shows the node as the base and the overlay together have it (`effective_node`), so base-only nodes (`spi0`) are readable too. Each property carries its `source` (`base` / `overlay`; the human output marks base values `// base`, `--quiet` doesn't). Children the overlay reaches are read in full, the rest collapsed to their name and labels (`ReadNode.origin`, `collapsed`). `update <path> <prop>` without a value decides between reading and setting a flag on the same merged node. `delete`'s property positional completes only what the overlay sets (`overlay-props`), while read and update offer the merged node's.

### Bundled dt-schema and tools

`bundled/dt-schema/` contains the dt-schema YAML schemas used by the binding parser. `bundled/tools/` contains PyInstaller-built binaries of `dt-mk-schema` and `dt-validate`, plus a statically-linked `dtc` (v1.8.1, built without libyaml), all used by the validate command. These are built on demand by `scripts/bundle-dt-schema.sh` (which clones dt-schema at a pinned commit into `dt-schema/` and dtc into `dtc/`, both gitignored). The build script runs automatically as part of `yarn build`. The path helpers `getBundledDtSchemaPath` and `getBundledToolsPath` in `src/commands/skill/utilities.ts` resolve these at runtime relative to the dist directory.

### Overlay syntax

The `overlay-syntax` config field controls the output format: `fragment` (default, `fragment@N { target = <&label>; __overlay__ { … } }`) or `label` (`&label { … }`). All overlay writes go through the `Workfile` returned by `load_workspace` (`src/config/workspace.ts`). The printer lives in `attach-lib/src/Devicetree/Printer.ts`.

### update value format

The value tokens after the property name in `update <path> <prop> <value...>` use a mini-syntax parsed in `src/commands/update/command.ts:parse_value`. Each token is resolved by `build_raw_property`:
- Numbers → `bigint` cell values
- Known macros (`GPIO_ACTIVE_LOW`, `IRQ_TYPE_EDGE_FALLING`, etc.) → their numeric values
- Labels that exist in the base tree or overlay (bare or `&label`) → phandle references (`&label`)
- Unknown words in a cell context → **rejected** with a clear error message

The binding provides only a shape hint (`flag` / `strings` / `cells` / undefined) and never causes a rejection. A value count outside the binding's minItems/maxItems is written with a warning (`count_warning` in `src/item-count.ts`); the same bounds show in the type (`number[2]`, protocol `min_items` / `max_items`). Value arrays (number, string, enum) have bounds there, and so does a specifier list whose entries have a known width (`interrupts` once the lib has shaped it for the interrupt-parent: entries × `#interrupt-cells`, so `[2]` for one gpio interrupt). Lists whose entries name a phandle (clocks, dmas, `*-gpios`) have none, since each entry has as many cells as its provider. `update <path> <prop>` with no value sets a flag or reads the property (see `decide_update`).

### list command and hidden __list

`suggest`, `list-devices` and `list-intelligence` were replaced by a unified `list` command tree: `list device`, `list property`, `list value`, `list parent`, `list overlay`. `list overlay <compatible>` reads the overlay index and grades each overlay with `board_fit` (`src/board-fit.ts`): its root compatible against the base's, loosened by the `FAMILIES` table for generic SoC compatibles (`brcm,bcm2835` = any Pi); compatible ones come first. It also lists the overlays that add another compatible of the device's binding (`binding_siblings`, `overlays_matching`), marked `matched` / `via`, after the exact ones of their fit. A hidden `__list` command handles completion-only kinds.

### init

`init` (`src/commands/init/command.ts`) sets up a workspace: it saves `linux` and `devicetree`, builds the binding caches unless they are current (`ensure_caches`), then creates the overlay workfile or keeps the configured one (`InitResponse { linux, devicetree, overlay, created, indexed }`). The plan is pure (`plan_linux`, `plan_devicetree`, `plan_overlay`, `plan_from_flags`, checked with `check_linux` / `check_devicetree` from `src/setup.ts`); `execute_init` carries it out and stops at the first failure, so a failed cache build leaves linux and devicetree saved and no workfile. With `--linux` and `--devicetree`, `--json`, or off a terminal it never asks: a value left out comes from the config, and with none it is an input error (exit 2); a wrong path or an existing `--overlay` file is `ok: false`. On a terminal without options it is the wizard (`step_linux`, `step_context`, `step_overlay` in `setup.ts`; `find_linux_trees` lists any directory under ~ with `Documentation/devicetree/bindings/` and `include/`, whatever its name), the configured values being the Enter defaults and the overlay kept (`k`) or replaced (`n`); cancelling it (Ctrl-C/Ctrl-D) saves nothing and exits 130 (`cancelled`), while stopping the add interview exits 0, since the node is added; with only some options it asks for what is neither given nor configured. Overlay rules (`OverlayChoice`, `workfile_filename` / `workfile_problem` in `src/workfile.ts`): `--overlay <name>` creates `<name>.dtso` and never overwrites; without it the configured overlay is kept when its file exists, else the next free `overlay[-N].dtso` is created. `init` tolerates unknown config keys and refuses only a config.toml that doesn't parse. Colours (`bold` / `dim` / `cyan` in `setup.ts`) are printed only on a terminal. The wizard's `.dts` search uses the live filter of `src/live-filter.ts` on a terminal (pure `apply_key` / `render_frame`, wired to keypress events by `live_filter`: typing narrows, ↑/↓ move, Enter picks, and needs an arrow press when the filter is empty, Esc goes back to the architectures, Ctrl-C/D cancel) and the line prompt otherwise. `create-workfile` and `attach-manifest` were removed.

### import

`import <overlay>` (`src/commands/import/command.ts`) creates a workfile from an overlay of the Linux tree, found by path, file name or stem in the overlay index (`find_overlay`), or from a file path. When an overlay is already configured, the new workfile replaces it in the config and the old file is kept (`ImportResponse.replaced`). The overlay is preprocessed with `preprocess-command` (`run_preprocess` in `src/utilities.ts`, also used by the base, `import` and `add --template`), parsed against the base, and its root `__overrides__` is dropped (`remove_root_node`); everything else is kept as written. `workfile_from_overlay` (`src/workfile.ts`) names the file after the overlay and saves the setting. Warnings: the board fit when incompatible (`board_fit` on the text scan's root compatible), and the lib's `unresolved_targets` / `unresolved_references`, printed by `src/unresolved.ts` (a heading per kind, one row per node and property, label-first paths via `display_path`), which the copied `add --template` kinds share for their errors.

### Naming, unit addresses and labels

`add` auto-picks unit addresses (when the binding defines `reg`), generates default labels from the compatible, and refuses duplicates. The tree logic is the lib's `add_node` (`Devicetree/AddNode.ts`), which returns structured notes and refusals; the command only resolves the parent identifier, checks the binding for `reg`, and formats messages. When no overlay is configured, `add` uses an in-memory `new_workfile` that is written (and saved to config) only if the add succeeds. Without `--parent`, `add` takes the parent itself (`add/parent.ts`: `default_parent` / `pick_parent` / `parent_note`): on a terminal (`--template required`, no `--quiet`) it is the first question, a lettered list of the `list parent` results (`ask_parent` in `interview.ts`, its own readline, before the node exists and outside the `[1/N]` count; Enter takes the first, a typed label or path is checked like `--parent`, Tab completes segment by segment with `parent_completions`, Ctrl-C/Ctrl-D add nothing, create no workfile and exit 130 through `cancelled`); otherwise it is the first entry of `list parent` with the note `Parent: spi (use --parent to choose another)` (stderr under `--json`). A copied `example:N` takes the first bus of the example's kind (`ExampleMatch.bus`), with `(no I2C bus for example 1; …)` when the base has none. A device whose only valid parent is `/` stays under the root with no note and no question. `adi,ad5593r` shares ad5592r's binding, so `list parent` offers SPI buses for it (known limit). After the add, the node's missing required properties (`src/node-state.ts`) are asked for on a terminal (`src/missing-required.ts` runs `src/commands/add/interview.ts`, which writes each answer through update's `apply_update`; `question_entries` letters the options of an enum or phandle (`pick_code` / `code_index` in `interview.ts`: a…z, aa…, as spreadsheet columns), picked by letter or by value (a letter in range always picks; a number is always a value; `&ab` or `"a"` writes a value that looks like a code), and asks a fixed-size array such as `diff-channels` or shaped `interrupts` one cell per line), or listed (piped, `--quiet`, `AddResponse.missing_required` under `--json`). On a terminal the interview first sets, without asking and with one line each, the missing required properties the binding pins to one value (`fill_pinned` in `src/missing-required.ts`: the binding layer offers exactly one value, which covers a `const`, a one-option enum and a required flag) and the values of the binding's first example on the parent's bus (`bus_example_values` in `add/example.ts`: `spi-max-frequency` on SPI, `reg` on I2C, written through `apply_update`; the chip select never comes from an example; a sibling of the same name at the example's address keeps the node's own `reg`). They are left out of the question count. `--json`, piped runs, `--quiet` and copied templates fill nothing. The child interview (`update <path> <child>`) gets the pinned fill only. A required `*-gpios` is asked row by row (`question_entries`' GPIO branch, when `PropertyInfo.gpio_rows` and `phandle_options` are both there): the controller entry (enabled gpio-controllers first, then the disabled ones marked via `other_candidates`; Enter takes the first enabled one, and on rows 2 and later the previous row's) carries `Entry.after`, which rebuilds the entries after it from the lib's `gpio_row_cells` (line number, then a lettered `GPIO_*` flags pick, Enter = `GPIO_ACTIVE_HIGH`). `Question.rows` makes `run_interview` repeat the row: a fixed count asks all rows (`row 2/6`), a range asks the minimum and then `another row? (y adds one, Enter = done)` up to the maximum, unsized asks one and then "another?"; the rows go out as one comma-separated token list to `apply_update`. On a terminal a question of several entries (`several_entries`: a fixed-size array, shaped `interrupts`, `*-gpios` rows) is asked in place: each entry under the value so far (`format_cells`, with `Entry.reference`, set for any phandle pick, shown as `&label`), erased once answered (`open_prompt`'s `mark` / `erase`, the terminal rows counted with `screen_rows`), and the value line is what stays; a single pick is asked as before, and piped runs are unchanged. Optional `*-gpios` are not part of the interview, and `list value` offers no GPIO suggestions. `update`'s one `--quiet` is both its read flag (value only) and "don't ask" when it creates a child; the hidden `ui` passes `--quiet` only to `add`, since its runs are `--json` and never ask; of the setup commands it may run only `init --overlay <name>` (its "Create workfile" button tries `overlay`, `overlay-1`, … until one is free). `rename` syncs reg↔unit address. `update reg` renames the node. Unit addresses are hex, except that child nodes whose parent binding names them in decimal (`^channel@([0-9]|1[0-5])$`) use decimal: the lib's `unit_radix` probes the patterns and `child_unit_radix` (`src/binding-resolution.ts`) reads them from the parent's binding; `update <path> <child@n>`, `update reg` and `rename` pass the radix on. `add` stays hex, since devices sit on buses where dtc requires it. `add --template <required|example:N|overlay:name>` (`src/commands/add/template.ts`) says what the node starts from. `required` is the bare node and the interview. `example:N` (`example.ts`: `find_examples`, `pick_example`) preprocesses each binding example (into `.attach-linux/example.dts`) and copies the node of example N that has the compatible or another of its binding (`device_matcher`, via the compat index). `overlay:name` (`overlay-template.ts`) finds the overlay as `import` does (`locate_overlay`) and copies the first node of the device in an `__overlay__` body, or in a `__dormant__` one when no live body has it, with its children. Without `--parent` the node goes in the fragment's target; a target the base lacks gets the first `list parent` bus of its kind (`default_parent` / `target_bus` in `parent.ts`), with a warning. Both copies keep the node as written (taken labels get free ones, and references to them follow), never interview, and list the references that resolve to nothing (`AddResponse.unresolved`). Child nodes (channels etc.) are created through `update <path> <child-name>` (`create_child_node`), which then asks for (or lists, or returns as `UpdateChildResponse.missing_required`) the child's missing required properties exactly as `add` does: both go through `src/missing-required.ts` (`missing_required_of`, `describe_missing`, `ask_for_missing`). The lib helpers are in `UnitAddress.ts` and `Labels.ts`; `DeviceTreeOverlay.ensure_node(path)` gives the overlay node to write into for any absolute path, creating a fragment for base-only nodes. Fragments are matched by the node their target resolves to (`&i2c_arm` and `&i2c1` are one node). An overlay can have several for one node (imports often do); `overlay_nodes_at` gives them in file order, `overlay_properties` the values that apply (a later fragment wins, as in dtc), `property_node` the one holding a property, and `merged_overlay_node` all of them as one node, so `read` sees every fragment, `update` writes where the applied value is, and `remove_property` removes it from all.

### Reg clashes

`src/reg-conflicts.ts` turns the lib's `reg_conflicts` / `sibling_reg_conflicts` (`Devicetree/RegConflicts.ts`) into warnings worded for the bus (chip select, I2C address, overlapping range), with a "disable <base node>" hint when the other node comes from the base tree. `validate` appends them to the dt-validate diagnostics (mapped to the `/nodeN` validation path so they group with them) and leaves out base-only clashes; `update … reg`, `rename` and `add` warn about the node they touched (on stderr under `--json`). Buses are checked whatever their own status, since a bus is often enabled later. A node counts as the overlay's when the overlay adds it or sets its reg or status, so a base node it only adds children to (pin groups under gpio) keeps its base clashes out. The same warnings report an SPI device whose chip select has no entry in its controller's `cs-gpios` (`chip_select_overflows`; entries are a phandle plus the provider's `#gpio-cells`, or a lone 0); controllers without `cs-gpios` aren't checked, since their native chip select count is up to the driver.

### Interrupt-parent

Setting `interrupts` without an explicit `interrupt-parent` writes the inherited one automatically and warns on cell-count mismatches. The lib's `interrupt_parent.ts` provides the path-based inheritance walk.

### SPI vendor peripheral-props filtering

`VendorPeripheralFilter.ts` in the lib removes vendor-specific SPI peripheral properties (pl022, cdns, fsl, nvidia, st) unless they match the parent controller's compatible. Applied at binding parse time.

### Plans and backlog

`plans/` (gitignored) contains working plans and progress notes for Claude sessions. `plans/completed.md` summarises the delivered groups (F through E) and their key decisions. `plans/PROGRESS.md` has per-group commit hashes, test counts and deviations. `notes.txt` (gitignored) is the feature backlog.

## Key Conventions

- All commands follow the pattern: `load_workspace(context, needs)` → call `attach-lib` → `console.log` or `respond()` output. Commands never throw to the user; they print a diagnostic and return early.
- `bigIntReplacer` in `src/utilities.ts` must be passed to `JSON.stringify` whenever output contains `BigInt` values (DTS cell arrays are always `bigint`).
- Inline tests use Vitest's `includeSource` feature — `if (import.meta.vitest)` blocks sit directly in source files (see `src/commands/add/command.ts`).
- TypeScript is configured with `noUncheckedIndexedAccess`, `noPropertyAccessFromIndexSignature`, and `verbatimModuleSyntax` — stricter than the monorepo baseline. Index access always requires a `undefined` check.

## Working rules

### Definition of done

Before saying a task is done, run `yarn verify` from the repo root (attach-lib build → lib tests → lib lint → attach-cli build with `tsc` → CLI lint → CLI tests) and fix every error, including pre-existing lint errors in files you edited. A Stop hook (`.claude/hooks/stop-verify.sh`) runs it when attach-lib or attach-cli changed and blocks on failure. Never report completion with failing lint or type checks.

### Build order

attach-cli consumes the *built* attach-lib. After changing attach-lib, rebuild it (`yarn workspace attach-lib build`) before running CLI tests, regenerating snapshots or checking by hand. Yarn 4 does not run `pre*`/`post*` lifecycle hooks, so call build steps explicitly.

### Corpus

`yarn corpus:diff` (`scripts/corpus.mjs`, build the CLI first) imports and validates every Raspberry Pi overlay of a pinned Linux checkout through `dist/cli.js` and compares the JSON with `corpus-snapshots/`; `yarn corpus` rewrites them. It runs overlays in parallel, one temp workspace per worker (`CORPUS_JOBS`, default the CPUs minus one, at most 8): `config-set linux` in the first builds the binding caches (about 45 s), the others get a copy. The commands share `.attach-linux/` (the configured overlay, `preprocessed.dts`, `temp.dts`), so a workspace must never run two at once. A run takes about 4 minutes with 8 workers (11 minutes one at a time; each overlay costs about 1 s, mostly `dt-validate` loading the 21 MB schema). What it records comes from `dt-validate` and the lib's overlay checks, not from attach-lib's property types, so a change in those types (the processed schema's) does not show in it: after that change all 435 snapshots stayed identical although 75 overlays set `sound-dai`. Check a type change with `scripts/repros/processed-types.mjs <binding> <property>` instead.

### Scope and git

- Change only the files and packages in scope. Ask before touching `notes.txt`, other packages' plans, or any `CLAUDE.md`.
- Never commit, amend, rebase or rewrite history unless asked. Subagents and forks never commit.
- "Commit" means the full working diff unless told otherwise. Never revert uncommitted changes you didn't make.
- Parallel agents get disjoint file lists, and the main agent runs `yarn verify` and waits for review before any commit.

### Working through findings

When going through a list of findings, take one at a time: explain the issue and the proposed fix, then wait for confirmation before editing. Don't move on to the next item.
For an ambiguous request ("show me first", "test this e2e"), restate it in 2–3 bullets and wait for an OK.

### Domain notes

- "Test e2e" / "test this manually" means running the real CLI by hand against demo files, not writing automated e2e tests.
- Interrupt cell counts come from the chosen interrupt-parent's `#interrupt-cells`, not from the specifier count.
