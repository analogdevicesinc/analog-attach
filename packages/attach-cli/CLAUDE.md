# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

`attach-cli` is the standalone `attach-linux` binary — a CLI tool for AI coding assistants to configure Linux device tree overlays. It wraps `attach-lib` (bundled at build time) and exposes all DTS/binding operations as subcommands.

## Commands

The `prebuild` step runs `tsc --noEmit` for type-checking; the actual output is produced by `tsup`. Type errors caught by `tsc` will block the build.

## Architecture

### Command structure

Commands are registered in `src/app.ts` using `commander`. Each command lives in `src/commands/<name>/command.ts` and exports a `build_<name>_command(ctx)` function. Adding a new command requires:
1. Creating `src/commands/<name>/command.ts`
2. Importing and registering it in `src/app.ts`

The entry point is `src/bin/cli.ts`, which strips the `--json` flag from argv before handing off to `commander`, then builds a `LocalContext` with `json: boolean` that every command receives.

### JSON protocol mode

All commands accept a global `--json` flag (stripped in `cli.ts` before `commander` sees it) that switches output from human-readable `console.log` to JSON on stdout. The protocol layer lives in `src/protocol/`:

- `output.ts`: `respond()` / `respond_fail()` write JSON to stdout; `input_error()` writes to stderr with exit code 2; `diagnostic()` writes non-fatal info to stderr.
- `types.ts`: Typed response interfaces for each command (`AddResponse`, `ReadResponse`, `ValidationResponse`, etc.) as well as the shared `CommonResponse`.

Commands in `src/app.ts` are annotated with `// protocol commands` (used by AI tooling) vs `// human-only commands`.

### Configuration and workspace state

`src/config.ts` manages two files in `.attach-linux/` (relative to CWD):
- `config.toml`: stores `linux`, `dt-schema`, `context`, `overlay` paths; loaded by every command that operates on files.
- `compat-index.json`: a binding compatibility index keyed by compatible string → YAML file path; rebuilt when stale (mtime-based).

`resolve_config` (`src/resolve-config.ts`) returns `{ values, config, parsed }`. The `parsed: ParsedConfig` object holds the pre-parsed `DeviceTree` and `BoardDescription` when `context` / `board` were among the required fields. Commands pass `parsed.context` to `load_trees` / `load_base` (`src/utilities.ts`) to avoid re-parsing.

`load_trees(ctx, path, overlay_path, base_dt?)` and `load_base(ctx, path, base_dt?)` live in `src/utilities.ts`. `parse_property_reference(args)` is also in `src/utilities.ts` — the canonical split for multi-segment node/property references.

Every command resolves its paths as: `--flag` → `config.toml` value → `undefined` (print diagnostic and return).

### Dependency on attach-lib

`attach-lib` is a dev dependency resolved from the workspace. `tsup` bundles it into the output via `noExternal: ["attach-lib"]`, so the published `dist/` is self-contained. The `yaml` package is intentionally kept external.

### Board descriptions

The optional `board` config field names an add-on board (HAT, …) description: a path, or a bundled name resolved to `bundled/boards/<name>.yaml` (`src/board.ts`, `getBundledBoardsPath`). All board logic lives in attach-lib's Intelligence module as the third context layer (`board_layer`, see `packages/attach-lib/src/Intelligence/CLAUDE.md`); the CLI only loads the file, appends the layer to `IntelligenceStack.default()`, and formats results — `suggest value` / `suggest board-slot`, plus `suggestions` on `suggest type` via `resolve_node_binding`'s `options`. Slot inference is stateless (parent bus + `reg`, via `placement_from_overlay`). Lib suggestions are structured cell rows; `format_value` (`src/commands/update/command.ts`) turns them into `--with` strings and is the inverse of `parse_value`.

A board may ship an overlay for its onboard devices (`overlay:` in the YAML, relative to the board file, resolved by `resolve_board_overlay`; files live in `bundled/overlays/`). `create-workfile` then writes that overlay instead of the empty skeleton (`prepare_board_workfile`): it runs `preprocess-command` (default mirrors kbuild's `cpp` flags, `{linux}` = the configured tree; persisted to config on first use), parses it, and drops `__overrides__`. Command templates go through `substitute_command` / `is_tool_available` in `src/utilities.ts`.

### Bundled dt-schema

A bundled copy of `dt-schema` lives at `bundled/dt-schema/` inside the package. Commands accept `--dt-schema` to override this path, but the bundled version is used by default. The path is resolved at runtime relative to the dist directory in `src/commands/skill/utilities.ts:getBundledDtSchemaPath`.

### update --with value format

The `--with` argument for `update` uses a custom mini-syntax parsed in `src/commands/update/command.ts:parse_value`. Each token is resolved by `build_raw_property`:
- Numbers → `bigint` cell values
- Known macros (`GPIO_ACTIVE_LOW`, `IRQ_TYPE_EDGE_FALLING`, etc.) → their numeric values
- Labels that exist in the base tree or overlay (bare or `&label`) → phandle references (`&label`)
- Unknown words in a cell context → **rejected** with a clear error message

The binding provides only a shape hint (`flag` / `strings` / `cells` / undefined) and never causes a rejection. With the `strings` hint, commas are preserved inside tokens (so `adi,ad7124-8` stays one string), and with no hint, inference picks strings when no token resolves as a cell.

Value formats:
- Single number: `0`
- Single string: `okay`
- Boolean flag: `true` / `false`
- Array: `"gpio 8 GPIO_ACTIVE_LOW"` (space-separated; macros and labels resolved)
- Matrix rows: `"gpio 8 1,gpio 7 1"` (comma separates rows) — produces `<&gpio 8 1>, <&gpio 7 1>;`

The old typed `set_property` path (strict binding validation in `update`) has been moved to `src/value-check.ts` as `check_value`, where it serves as a dry-run checker for `suggest value` annotations.

### suggest value binding check

When `linux`/`dt-schema` are configured, `suggest value` (`src/commands/suggest/command.ts`) annotates each suggestion with binding-check notes. For each suggestion it builds a preview node with the candidate value, runs `narrow_and_populate` on it, and calls `check_value` against the resulting definition. Notes appear in the `note` field of the `Suggestion` protocol type and are appended to `display_string`.

### Skill installation

`installSkill` / `uninstallSkill` commands copy `SKILL.md` to `~/.claude/skills/attach-linux/SKILL.md`. The same logic runs as a `postinstall` script (`scripts/postinstall.js`) but prompts interactively and skips in CI (`CI` env var).

## Key Conventions

- All commands follow the pattern: validate flag paths → parse files → call `attach-lib` → `console.log` or `respond()` output. Commands never throw to the user; they print a diagnostic and return early.
- `bigIntReplacer` in `src/utilities.ts` must be passed to `JSON.stringify` whenever output contains `BigInt` values (DTS cell arrays are always `bigint`).
- Inline tests use Vitest's `includeSource` feature — `if (import.meta.vitest)` blocks sit directly in source files (see `src/commands/add/command.ts`).
- TypeScript is configured with `noUncheckedIndexedAccess`, `noPropertyAccessFromIndexSignature`, and `verbatimModuleSyntax` — stricter than the monorepo baseline. Index access always requires a `undefined` check.
