# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

`attach-cli` is the standalone `attach-linux` binary — a CLI tool for AI coding assistants to configure Linux device tree overlays. It wraps `attach-lib` (bundled at build time) and exposes all DTS/binding operations as subcommands.

## Commands

All of the following should be run from the monorepo root via `yarn workspace attach-cli <script>` or from this package directly with `yarn <script>`.

```bash
# From monorepo root
yarn build:attach-cli             # type-check + bundle
yarn workspace attach-cli test --run          # all unit tests
yarn workspace attach-cli test --run <file>   # single test file

# From this package directory
yarn build                        # prebuild (tsc type-check) then tsup bundle
yarn dev-link                     # build + symlink dist/cli.js to ~/.local/bin/attach-linux
yarn test                         # vitest (watch mode)
yarn test --run                   # vitest single-run
yarn coverage                     # run tests with coverage
```

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

Every command resolves its paths as: `--flag` → `config.toml` value → `undefined` (print diagnostic and return).

### Dependency on attach-lib

`attach-lib` is a dev dependency resolved from the workspace. `tsup` bundles it into the output via `noExternal: ["attach-lib"]`, so the published `dist/` is self-contained. The `yaml` package is intentionally kept external.

### Bundled dt-schema

A bundled copy of `dt-schema` lives at `bundled/dt-schema/` inside the package. Commands accept `--dt-schema` to override this path, but the bundled version is used by default. The path is resolved at runtime relative to the dist directory in `src/commands/skill/utilities.ts:getBundledDtSchemaPath`.

### update --with value format

The `--with` argument for `update` uses a custom mini-syntax parsed in `src/commands/update/command.ts:parse_value`:
- Single number: `0`
- Single string: `some_label`
- Boolean flag: `true` / `false`
- Array: `a b c` (space-separated items)
- Matrix rows: `a b,c d` (comma separates rows, space separates items within a row) — emits a true multi-row matrix, `prop = <a b>, <c d>;`

Comma is only a row separator; it can't appear in labels, macros, or numbers. Numbers are parsed as `bigint`. Strings that aren't numbers stay as strings.

### Skill installation

`installSkill` / `uninstallSkill` commands copy `SKILL.md` to `~/.claude/skills/attach-linux/SKILL.md`. The same logic runs as a `postinstall` script (`scripts/postinstall.js`) but prompts interactively and skips in CI (`CI` env var).

## Key Conventions

- All commands follow the pattern: validate flag paths → parse files → call `attach-lib` → `console.log` or `respond()` output. Commands never throw to the user; they print a diagnostic and return early.
- `bigIntReplacer` in `src/utilities.ts` must be passed to `JSON.stringify` whenever output contains `BigInt` values (DTS cell arrays are always `bigint`).
- Inline tests use Vitest's `includeSource` feature — `if (import.meta.vitest)` blocks sit directly in source files (see `src/commands/add/command.ts`).
- TypeScript is configured with `noUncheckedIndexedAccess`, `noPropertyAccessFromIndexSignature`, and `verbatimModuleSyntax` — stricter than the monorepo baseline. Index access always requires a `undefined` check.
