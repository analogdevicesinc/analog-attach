# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## About This Package

`attach-lib` is the core, UI-free library for Device Tree Source (DTS) parsing, binding processing, and schema validation. It is consumed by the VS Code extension and webviews. Built with Vite (dual ESM/CJS output), tested with Vitest.

## Commands

Run from `packages/attach-lib/`:

```bash
yarn test                # Run all tests (watch mode)
yarn test -- run         # Run tests once
yarn test -- run --reporter=verbose  # Single test with details
yarn test -- run <filename>          # Run a specific test file
yarn coverage            # Run tests with v8 coverage report
yarn build               # Build dist/ (ESM + CJS)
yarn watch               # Incremental build
```

Run from the monorepo root (`~/analog-attach/`):

```bash
yarn build:attach-lib    # Build this package
yarn test                # Run all tests across packages
yarn lint                # ESLint over src
```

There is no top-level test script that isolates just this package — use `cd packages/attach-lib && yarn test`.

## Architecture

### Entry Points

- `src/index.ts` — Node.js entry (full API, including fs-dependent modules)
- `src/browser.ts` — Browser/webview entry (only fs-free exports like `BigIntSerializer`)

### Core Modules

**DTS parsing — new (`src/dts/`)**
A rewrite of the DTS parser with a different AST and internal structure. Types: `DTS<T>`, `DTNode<T>`, `DTProperty`, `Bits` enum. Introduces `LexerInputStream` and `TokenStream` abstractions. Public API: `parse_dts`, `parse_dto`, `printDts`. This module is **not yet wired into the rest of the codebase** — nothing in `src/` imports from it except `src/utilities.ts` (type-only import). It is not re-exported from `src/index.ts`.

**DTS parsing — legacy (`src/dts_legacy/`)**
The currently active DTS implementation. Types: `DtsDocument`, `DtsNode`, `DtsProperty`. Consumed by `dtso/`, `DtQuery`, and re-exported from `src/index.ts`. Public API: `parse_dts`, `parseDtsWithLabelMap`, `ensure_node_by_path`, `printDts`, `mergeDocument`, `mergeNode`, `markNodesModified`, `search_node_in_dts`, `search_node_in_unresolved_overlays`. See `src/dts_legacy/README.md` for detailed semantics on overlay merge rules, printer options (phandle injection, path/property order overrides), and known parser limitations.

**DTSO parsing (`src/dtso/`)**
Handles Device Tree Overlay (`.dtso`) files. Built on top of `dts_legacy/` — imports its AST types, parser, and merge helpers directly.

**Binding processor (`src/binding-processor/`)**
Transforms raw YAML binding schemas into a UI-ready representation. Pipeline:

1. `RefResolver` — dereferences `$ref` chains via `@apidevtools/json-schema-ref-parser`
2. `PropertyResolver` — flattens `patternProperties` into `properties` (regex expansion via `src/RegexExpansion.ts`)
3. `RedefinitionMerger` — resolves `allOf`/`oneOf`/`if-then-else` into property constraints
4. `CanaryInserter` — injects `__canary__` sentinel properties to make implicit `if/then` branches detectable by AJV
5. `JSONSchemaFixups` — patches quirks in real-world ADI bindings before validation

The output is a `ParsedBinding` that can be fed to AJV for validation and fed to the frontend for rendering. See `src/PROCESS.md` for the rationale and worked examples.

**`Attach` class (`src/Attach.ts`)**
Orchestrates the full binding pipeline. Entry point for the extension: `Attach.new().parse_binding(bindingPath, linuxPath, dtSchemaPath)`.

**`DtQuery` (`src/DtQuery.ts`)**
Queries a parsed DTS document for nodes, properties, and references.

**Utility types (`src/result.ts`, `src/option.ts`)**
Custom `Result<T, E>` and `Option<T>` types used throughout. Use `Result.Ok`/`Result.Err` and `Option.Some`/`Option.None` constructors; check with `Result.is_ok`/`Result.is_err` and `Option.is_some`/`Option.is_none`.

### Test Layout

Tests live in `test/` (not `src/test/`). Fixtures are in `test/dts_source/`, `test/expected/`, `test/dt-schema/`, `test/linux/`, and `test/schemas/`. `test/testing_utils.ts` has shared helpers.

The `vitest.config.ts` excludes `out/` and ignores `linux/`, `dt-schema/`, and `node_modules/` in watch mode.

## Key Conventions

- **TypeScript strict mode** throughout. No `any` without justification.
- Module imports use `.js` extensions (ESM-style, resolved by bundler).
- The DTS AST uses non-enumerable `order` fields on nodes/properties for stable merge/print ordering — do not serialize them directly.
- The `__canary__` property name is a protocol between `CanaryInserter` and the AJV validation step; do not reuse it for other purposes.
- Commit messages: short imperative present tense (e.g., `attach-lib: handle negative scalars in property values`).
