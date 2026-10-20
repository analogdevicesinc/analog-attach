# CLAUDE.md

## Overview

`attach-cli` is the standalone `attach-linux` binary — a CLI tool for AI coding assistants to configure Linux device tree overlays. It wraps `attach-lib` (bundled at build time) and exposes all DTS/binding operations as subcommands.

## Commands

The `prebuild` step runs `tsc --noEmit` for type-checking; the actual output is produced by `tsup`. Type errors caught by `tsc` will block the build.

## Architecture

### Command structure

The entry point is `src/bin/cli.ts`, which strips the `--json` flag from argv before handing off to `commander`, then builds a `LocalContext` with `json: boolean` that every command receives. In JSON mode, commander errors are routed through `input_error` (exit 2) via `exitOverride` / `configureOutput`.

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

- `output.ts`: `respond()` / `respond_fail()` write JSON to stdout; `input_error()` writes to stderr with exit code 2; `diagnostic()` writes non-fatal info to stderr.
- `types.ts`: Typed response interfaces for each command (`AddResponse`, `ReadResponse`, `ValidationResponse`, etc.) as well as the shared `CommonResponse`.
- `descriptions.ts`: New description types (`DeviceDescription`, `PropertyDescription`, `TypeDescription`) for the `list` command.

Commands in `src/app.ts` are annotated with `// protocol commands` (used by AI tooling) vs `// human-only commands`.

### Configuration and workspace state

Config is parsed, not validated: `src/config/` turns env vars and config.toml into checked resources, and a command that gets them cannot fail because of the configuration.

- `settings.ts`: the `SETTINGS` registry, which config-set, config-get and completion all derive from. It holds only user settings: `linux` / `devicetree` from `ATTACH_LINUX` / `ATTACH_DEVICETREE`, and `overlay`, `overlay-syntax`, `preprocess-command`, `deploy-*` from `.attach-linux/config.toml` (relative to CWD). `parse_settings` is strict: unknown keys, non-string or out-of-options values, and env keys written in TOML are all errors. Paths are resolved to absolute and defaults are applied. `save_settings` writes in registry order and keeps unknown keys, so the next load still reports them.
- `workspace.ts`: `load_workspace(context, needs)` reads the settings and parses the requested resources:
  - `bindings`: the Linux tree has `Documentation/devicetree/bindings/` and `include/`, and the bundled dt-schema exists.
  - `tools`: the bundled dtc and dt-* binaries.
  - `base`: the DTS, run through `preprocess-command` into `.attach-linux/preprocessed.dts` on every invocation, then parsed.
  - `overlay`: a `Workfile` parsed against the base, with `print()` / `save()` honouring `overlay-syntax`.
  - `deploy`: the deploy fields plus the `.dtbo` derived from the overlay path.

  Errors from independent resources are collected and reported once (`report_config_errors`; exit 2 under `--json`). `parse_bindings` / `parse_overlay` are exported for callers that make bindings optional (`list value`, navigate completion) or that create the workfile first (`add`).
- `cache.ts`: derived state under `.attach-linux/` that never goes into config.toml. `compat-index.json` maps compatible → binding YAML. `validation.json` is the `dt-mk-schema` output and has a `validation.stamp.json` next to it. Both are rebuilt when stale (mtime-based, or when the linux/dt-schema paths differ); `stale_reason` says why. While they build, `src/progress.ts` prints why and a counter on stderr (in every mode). Shell completion calls `disable_index_build()`, so it never builds the index: no index completes nothing, and a stale one is used as is.

Path helpers in `src/utilities.ts`: `parse_node_path`, `parse_property_name`, `parse_target`, `resolve_path`, `not_found_message`.

### Dependency on attach-lib

`attach-lib` is a dev dependency resolved from the workspace. `tsup` bundles it into the output via `noExternal: ["attach-lib"]`, so the published `dist/` is self-contained. The `yaml` package is intentionally kept external.

### Property patterns

A binding's patternProperties are split by the lib (`Bindings/PatternKind.ts`): object schemas and patterns with an `@` are child nodes (`NodeBinding.child_nodes`, matched by `match_pattern_rule`); the rest name properties (`NodeBinding.property_patterns`, e.g. `^adi,bypass-attenuator-in[0-4]$`), with the same fixups and types as named properties. `find_property_definition` (`src/binding-resolution.ts`) looks a property up by name, then by property pattern; `update`'s shape hint, the suggestion check, `list value` and `property_info` (`read`, `list property <path> <prop>`) all go through it. `list property <path>` shows the names a pattern matches (the lib's `expand_pattern`: `channel@0 … channel@15`, or a stem such as `fan-…`), with the regex as the JSON value. Completion of the property positional (`binding_property_suggestions`) adds `pattern_candidates`: the pattern names not set or present yet, or the stem as a `partial` suggestion, which the shell completes without a trailing space. Unanchored patterns (`-supply$`) offer nothing.

### Value suggestions

`list value` asks attach-lib's `IntelligenceStack.default()` for values (binding and base-devicetree layers, see `packages/attach-lib/src/Intelligence/CLAUDE.md`), placing the node with `placement_from_overlay`. The data paths are `resolve_target_binding` / `value_suggestions` / `property_info` in `src/commands/list/suggest.ts`, which `read` (and `update` without a value, via `read_target`) reuse for the description, allowed values and suggestions under a property; `src/node-state.ts` gives a node's missing required properties. Lib suggestions are structured cell rows; `format_suggestion` (`src/commands/update/command.ts`) turns them into value strings and is the inverse of `parse_value`. Command templates (`preprocess-command`, the build command) go through `substitute_command` / `is_tool_available` in `src/utilities.ts`.

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

The binding provides only a shape hint (`flag` / `strings` / `cells` / undefined) and never causes a rejection. `update <path> <prop>` with no value sets a flag or reads the property (see `decide_update`).

### list command and hidden __list

`suggest`, `list-devices` and `list-intelligence` were replaced by a unified `list` command tree: `list device`, `list property`, `list value`, `list parent`. A hidden `__list` command handles completion-only kinds. The manifest's `suggest` key points at `__list`.

### Naming, unit addresses and labels

`add` auto-picks unit addresses (when the binding defines `reg`), generates default labels from the compatible, and refuses duplicates. The tree logic is the lib's `add_node` (`Devicetree/AddNode.ts`), which returns structured notes and refusals; the command only resolves the parent identifier, checks the binding for `reg`, and formats messages. When no overlay is configured, `add` uses an in-memory `new_workfile` that is written (and saved to config) only if the add succeeds. After the add, the node's missing required properties (`src/node-state.ts`) are asked for on a terminal (`src/commands/add/interview.ts`, which writes each answer through update's `apply_update`), or listed (piped, `--no-interview`, `AddResponse.missing_required` under `--json`). `rename` syncs reg↔unit address. `update reg` renames the node. Unit addresses are hex, except that child nodes whose parent binding names them in decimal (`^channel@([0-9]|1[0-5])$`) use decimal: the lib's `unit_radix` probes the patterns and `child_unit_radix` (`src/binding-resolution.ts`) reads them from the parent's binding; `update <path> <child@n>`, `update reg` and `rename` pass the radix on. `add` stays hex, since devices sit on buses where dtc requires it. `add --from-example` (`src/commands/add/example.ts`) instead preprocesses each binding example with `preprocess-command` (into `.attach-linux/example.dts`), finds the node with the compatible or another compatible of the same binding (via the compat index), picks the first example whose wrapper is on the parent's bus (`bus_kind`), and copies the node as it is (taken labels in the copy get free ones, and the copy's references to them follow); the lib's `unresolved_references` then lists the references that resolve to nothing (`AddResponse.unresolved`). Child nodes (channels etc.) are created through `update <path> <child-name>`. The lib helpers are in `UnitAddress.ts` and `Labels.ts`; `DeviceTreeOverlay.ensure_node(path)` gives the overlay node to write into for any absolute path, creating a fragment for base-only nodes.

### Reg clashes

`src/reg-conflicts.ts` turns the lib's `reg_conflicts` / `sibling_reg_conflicts` (`Devicetree/RegConflicts.ts`) into warnings worded for the bus (chip select, I2C address, overlapping range), with a "disable <base node>" hint when the other node comes from the base tree. `validate` appends them to the dt-validate diagnostics (mapped to the `/nodeN` validation path so they group with them) and leaves out base-only clashes; `update … reg`, `rename` and `add` warn about the node they touched (on stderr under `--json`). Buses are checked whatever their own status, since a bus is often enabled later.

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
