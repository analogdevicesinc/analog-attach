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

Most tests import from the built package (`from 'attach-lib'`, resolved via a workspace symlink at `node_modules/attach-lib` → `dist/`), so `yarn build` before `yarn test` if `dist/` is stale. A few tests (e.g. `test/DTSParser.test.ts`, `test/DTSParserRoundtrip.test.ts`) import directly from `../src` and don't need a build. Some source files also carry inline `import.meta.vitest` doctests (e.g. `src/DTBuilder/DTBuilder.ts`, `src/binding-processor/fixups/*.ts`) picked up via `includeSource` in `vitest.config.ts` — these run alongside the `test/*.test.ts` files.

## Architecture

### Entry Points

- `src/index.ts` — Node.js entry (full API, including fs-dependent modules)
- `src/browser.ts` — Browser/webview entry (only fs-free exports like `BigIntSerializer`)

### Core Modules

**DTS parsing — new (`src/dts/`)**
A rewrite of the DTS parser with a different AST and internal structure. Types: `DTS<T>`, `DTNode<T>`, `DTProperty`, `Bits` enum. Introduces `LexerInputStream` and `TokenStream` abstractions. Public API: `parse_dts`, `parse_dto`, `printDts`. This module is **not yet wired into the rest of the codebase** — nothing in `src/` imports from it except `src/utilities.ts` (type-only import) and `src/Devicetree.ts` (see below). It is not re-exported from `src/index.ts`.

**DTS parsing — legacy (`src/dts_legacy/`)**
The currently active DTS implementation. Types: `DtsDocument`, `DtsNode`, `DtsProperty`. Consumed by `dtso/`, `DtQuery`, and re-exported from `src/index.ts`. Public API: `parse_dts`, `parseDtsWithLabelMap`, `ensure_node_by_path`, `printDts`, `mergeDocument`, `mergeNode`, `markNodesModified`, `search_node_in_dts`, `search_node_in_unresolved_overlays`. See `src/dts_legacy/README.md` for detailed semantics on overlay merge rules, printer options (phandle injection, path/property order overrides), and known parser limitations.

**`Devicetree.ts` (`src/Devicetree.ts`) — WIP**
An in-progress ergonomic wrapper (`DeviceTree`, `DeviceTreeOverlay` classes) built on top of the *new* `src/dts/` AST, not `dts_legacy/`. Provides tree traversal (`as_stream`, DFS/BFS) and mutation helpers (`add_fragment`, `set_status`, `remove_node`, etc.), using `src/DTBuilder/` to construct nodes/properties. Not yet exported from `src/index.ts` or consumed elsewhere — active development area, expect API churn.

**Node/property builder (`src/DTBuilder/`)**
Fluent builders (`NodeBuilder`, `PropertyBuilder`) for constructing `src/dts/` AST nodes and properties programmatically, used by `Devicetree.ts`. Split into `DTBuilder.ts` (builder classes), `Types.ts` (cell/value input types), `TypeUtilities.ts` (helper type-level utilities like `AddCallOnce`).

**DTSO parsing (`src/dtso/`)**
Handles Device Tree Overlay (`.dtso`) files. Built on top of `dts_legacy/` — imports its AST types, parser, and merge helpers directly.

**Binding processor (`src/binding-processor/`)**
Transforms raw YAML binding schemas into a UI-ready representation. Pipeline:

1. `RefResolver` — dereferences `$ref` chains via `@apidevtools/json-schema-ref-parser`
2. `PropertyResolver` — flattens `patternProperties` into `properties` (regex expansion via `src/RegexExpansion.ts`)
3. `RedefinitionMerger` — resolves `allOf`/`oneOf`/`if-then-else` into property constraints
4. `CanaryInserter` — injects `__canary__` sentinel properties to make implicit `if/then` branches detectable by AJV
5. `JSONSchemaFixups` — patches quirks in real-world ADI bindings before validation (individual fixups live in `src/binding-processor/fixups/`)

The output is a `ParsedBinding` that can be fed to AJV for validation and fed to the frontend for rendering. See `src/PROCESS.md` for the rationale and worked examples, and `src/BINDINGS.md` for real-world binding quirks encountered in ADI/Linux schemas.

**`Attach` class (`src/Attach.ts`)**
Orchestrates the full binding pipeline. Entry point for the extension: `Attach.new().parse_binding(bindingPath, linuxPath, dtSchemaPath)`. Also owns incremental re-validation: `update_binding_by_changes(data)` re-runs the compiled AJV validator against edited DTS-derived JSON, walks `__canary__` errors to figure out which `if/then` branches now apply, and translates the rest of the AJV errors into typed `BindingErrors` (missing required property, number-limit violation, failed dependency, generic).

**`DtQuery` (`src/DtQuery.ts`)**
Queries a parsed DTS document (`dts_legacy` `DtsDocument`) for nodes, properties, and references — e.g. `suggest_parents`, `query_devicetree`, `insert_known_structures`, `extract_compatible`.

**Utility types (`src/result.ts`, `src/option.ts`)**
Custom `Result<T, E>` and `Option<T>` types used throughout. Use `Result.Ok`/`Result.Err` and `Option.Some`/`Option.None` constructors; check with `Result.is_ok`/`Result.is_err` and `Option.is_some`/`Option.is_none`.

### Test Layout

Tests live in `test/` (not `src/test/`). Fixtures are in `test/dts_source/`, `test/expected/`, `test/dt-schema/`, `test/linux/`, and `test/schemas/`. `test/testing_utils.ts` has shared helpers.

`test/legacy/` holds an older copy of the DTS parser tests plus a large `.dtb` fixture cache; `vitest.config.ts` excludes `test/legacy/**` from runs. `test/dt-schema` and `test/linux` are symlinks (see `.gitignore`) into local checkouts of the dt-schema meta-schemas and a Linux kernel tree, used as real-world binding corpora by tests like `BindingParserCompletion.test.ts`.

The `vitest.config.ts` excludes `out/` and ignores `linux/`, `dt-schema/`, and `node_modules/` in watch mode.

## Key Conventions

- **TypeScript strict mode** throughout. No `any` without justification.
- Module imports use `.js` extensions (ESM-style, resolved by bundler).
- The DTS AST uses non-enumerable `order` fields on nodes/properties for stable merge/print ordering — do not serialize them directly.
- The `__canary__` property name is a protocol between `CanaryInserter` and the AJV validation step; do not reuse it for other purposes.
- Commit messages: short imperative present tense, prefixed with `attach-lib:` (e.g. `attach-lib: handle negative scalars in property values`).
