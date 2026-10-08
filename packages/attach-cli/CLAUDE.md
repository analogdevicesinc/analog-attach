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

`src/config.ts` manages `.attach-linux/config.toml` (relative to CWD) and environment variables:
- **Environment variables**: `ATTACH_LINUX`, `ATTACH_DT_SCHEMA`, `ATTACH_CONTEXT` replace config.toml for these three fields. `config-set` rejects them with an export hint; legacy TOML values are ignored with a warning.
- **config.toml**: stores `overlay`, `board`, `overlay-syntax`, `build-command`, `preprocess-command`, and other fields.
- `compat-index.json`: a binding compatibility index keyed by compatible string → YAML file path; rebuilt when stale (mtime-based or when the linux/dt-schema paths differ).

`resolve_config` (`src/resolve-config.ts`) returns `{ values, config, parsed }`. The `parsed: ParsedConfig` object holds the pre-parsed `DeviceTree` and `BoardDescription` when `context` / `board` were among the required fields.

Path helpers in `src/utilities.ts`: `parse_node_path`, `parse_property_name`, `parse_target`, `resolve_path`, `base_target`, `not_found_message`, `overlay_print_options`, `write_overlay`.

### Dependency on attach-lib

`attach-lib` is a dev dependency resolved from the workspace. `tsup` bundles it into the output via `noExternal: ["attach-lib"]`, so the published `dist/` is self-contained. The `yaml` package is intentionally kept external.

### Board descriptions

The optional `board` config field names an add-on board (HAT, …) description: a path, or a bundled name resolved to `bundled/boards/<name>.yaml` (`src/board.ts`, `getBundledBoardsPath`). All board logic lives in attach-lib's Intelligence module as the third context layer (`board_layer`, see `packages/attach-lib/src/Intelligence/CLAUDE.md`); the CLI only loads the file, appends the layer to `IntelligenceStack.default()`, and formats results — `list value` / `list slot`, plus `suggestions` on `list property` via `resolve_node_binding`'s `options`. Slot inference is stateless (parent bus + `reg`, via `placement_from_overlay`). Lib suggestions are structured cell rows; `format_value` (`src/commands/update/command.ts`) turns them into value strings and is the inverse of `parse_value`.

A board may ship an overlay for its onboard devices (`overlay:` in the YAML, relative to the board file, resolved by `resolve_board_overlay`; files live in `bundled/overlays/`). `create-workfile` then writes that overlay instead of the empty skeleton (`prepare_board_workfile`): it runs `preprocess-command` (default mirrors kbuild's `cpp` flags, `{linux}` = the configured tree; persisted to config on first use), parses it, and drops `__overrides__`. Command templates go through `substitute_command` / `is_tool_available` in `src/utilities.ts`.

### Bundled dt-schema

A bundled copy of `dt-schema` lives at `bundled/dt-schema/` inside the package. The environment variable `ATTACH_DT_SCHEMA` overrides this path; the bundled version is the fallback. The path is resolved at runtime relative to the dist directory in `src/commands/skill/utilities.ts:getBundledDtSchemaPath`.

### Overlay syntax

The `overlay-syntax` config field controls the output format: `fragment` (default, `fragment@N { target = <&label>; __overlay__ { … } }`) or `label` (`&label { … }`). All overlay writes go through `write_overlay` / `overlay_print_options` in `src/utilities.ts`. The printer lives in `attach-lib/src/Devicetree/Printer.ts`.

### update value format

The value tokens after the property name in `update <path> <prop> <value...>` use a mini-syntax parsed in `src/commands/update/command.ts:parse_value`. Each token is resolved by `build_raw_property`:
- Numbers → `bigint` cell values
- Known macros (`GPIO_ACTIVE_LOW`, `IRQ_TYPE_EDGE_FALLING`, etc.) → their numeric values
- Labels that exist in the base tree or overlay (bare or `&label`) → phandle references (`&label`)
- Unknown words in a cell context → **rejected** with a clear error message

The binding provides only a shape hint (`flag` / `strings` / `cells` / undefined) and never causes a rejection. `update <path> <prop>` with no value sets a flag or reads the property (see `decide_update`).

### list command and hidden __list

`suggest`, `list-devices` and `list-intelligence` were replaced by a unified `list` command tree: `list device`, `list property`, `list value`, `list parent`, `list slot`. A hidden `__list` command handles completion-only kinds. The manifest's `suggest` key points at `__list`.

### Naming, unit addresses and labels

`add` auto-picks unit addresses (when the binding defines `reg`), generates default labels from the compatible, and refuses duplicates. `rename` syncs reg↔unit address. `update reg` renames the node. Child nodes (channels etc.) are created through `update <path> <child-name>`. The lib helpers are in `UnitAddress.ts` and `Labels.ts`.

### Interrupt-parent

Setting `interrupts` without an explicit `interrupt-parent` writes the inherited one automatically and warns on cell-count mismatches. The lib's `interrupt_parent.ts` provides the path-based inheritance walk.

### SPI vendor peripheral-props filtering

`VendorPeripheralFilter.ts` in the lib removes vendor-specific SPI peripheral properties (pl022, cdns, fsl, nvidia, st) unless they match the parent controller's compatible. Applied at binding parse time.

## Key Conventions

- All commands follow the pattern: validate paths → parse files → call `attach-lib` → `console.log` or `respond()` output. Commands never throw to the user; they print a diagnostic and return early.
- `bigIntReplacer` in `src/utilities.ts` must be passed to `JSON.stringify` whenever output contains `BigInt` values (DTS cell arrays are always `bigint`).
- Inline tests use Vitest's `includeSource` feature — `if (import.meta.vitest)` blocks sit directly in source files (see `src/commands/add/command.ts`).
- TypeScript is configured with `noUncheckedIndexedAccess`, `noPropertyAccessFromIndexSignature`, and `verbatimModuleSyntax` — stricter than the monorepo baseline. Index access always requires a `undefined` check.
