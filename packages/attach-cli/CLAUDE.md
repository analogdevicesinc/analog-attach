# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

`attach-cli` is the standalone `attach` binary — a CLI tool for AI coding assistants to configure Linux device tree overlays. It wraps `attach-lib` (bundled at build time) and exposes all DTS/binding operations as subcommands.

## Commands

All of the following should be run from the monorepo root via `yarn workspace attach-cli <script>` or from this package directly with `yarn <script>`.

```bash
# From monorepo root
yarn build:attach-cli             # type-check + bundle
yarn workspace attach-cli test --run          # all unit tests
yarn workspace attach-cli test --run <file>   # single test file

# From this package directory
yarn build                        # prebuild (tsc type-check) then tsup bundle
yarn dev-link                     # build + symlink dist/cli.js to ~/.local/bin/attach
yarn test                         # vitest (watch mode)
yarn test --run                   # vitest single-run
yarn coverage                     # run tests with coverage
```

The `prebuild` step runs `tsc --noEmit` for type-checking; the actual output is produced by `tsup`. Type errors caught by `tsc` will block the build.

## Architecture

### Command structure

Commands are registered in `src/app.ts` using `@stricli/core`. Each command lives in `src/commands/<name>/command.ts` and exports a single `buildCommand(...)` value. Adding a new command requires:
1. Creating `src/commands/<name>/command.ts`
2. Importing and registering it in `src/app.ts`

Entry points are `src/bin/cli.ts` (the `attach` binary) and `src/bin/bash-complete.ts` (shell completion helper).

### Dependency on attach-lib

`attach-lib` is a dev dependency resolved from the workspace. `tsup` bundles it into the output via `noExternal: ["attach-lib"]`, so the published `dist/` is self-contained. The `yaml` package is intentionally kept external (it stays a runtime dependency in `node_modules`).

### Bundled dt-schema

A bundled copy of `dt-schema` lives at `bundled/dt-schema/` inside the package. Commands accept `--dt-schema` to override this path, but the bundled version is used by default. The path to the bundled copy is resolved at runtime relative to the dist directory in `src/commands/skill/utilities.ts:getBundledDtSchemaPath`.

### set-prop value format

The `--value` argument for `set-prop` uses a custom mini-syntax parsed in `src/commands/set-prop/command.ts:parse_value`:
- Single number: `0`
- Single string: `some_label`
- Boolean flag: `true` / `false`
- Array: `[item1; item2; item3]` (semicolon-separated, no trailing)
- Matrix row: `[a; b], [c; d]` (comma-separated bracket groups)

Numbers are parsed as `bigint`. Strings that aren't numbers stay as strings. This distinction drives which `create_cell_array` / `create_string_array` helper from `attach-lib` gets called.

### Skill installation

`installSkill` / `uninstallSkill` commands copy `SKILL.md` to `~/.claude/skills/attach/SKILL.md`. The same logic runs as a `postinstall` script (`scripts/postinstall.js`) but prompts interactively and skips in CI (`CI` env var). The installed skill teaches Claude Code how to use each CLI command.

## Key Conventions

- All commands follow the pattern: validate flag paths → parse files → call `attach-lib` → `console.log` output. Commands never throw to the user; they print a diagnostic and return early.
- `bigIntReplacer` in `src/utilities.ts` must be passed to `JSON.stringify` whenever output contains `BigInt` values (DTS cell arrays are always `bigint`).
- Inline tests use Vitest's `includeSource` feature — `if (import.meta.vitest)` blocks sit directly in source files (see `src/utilities.ts`).
- TypeScript is configured with `noUncheckedIndexedAccess`, `noPropertyAccessFromIndexSignature`, and `verbatimModuleSyntax` — stricter than the monorepo baseline. Index access always requires a `undefined` check.
