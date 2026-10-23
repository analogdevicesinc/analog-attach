# CLAUDE.md

## About This Package

`attach-lib` is the core, UI-free library for Device Tree Source (DTS) parsing, binding processing, and schema validation. It is consumed by the VS Code extension and webviews. Built with Vite (dual ESM/CJS output), tested with Vitest.

`plans/` (gitignored) contains working plans for Claude sessions — currently the Intelligence module structural dedup and behaviour findings.

## Commands

There is no top-level test script that isolates just this package — use `cd packages/attach-lib && yarn test`.

Lint with `yarn lint` (ESLint + unicorn, config in `eslint.config.mjs`, same as attach-cli).

Most tests import from the built package (`from 'attach-lib'`, resolved via a workspace symlink at `node_modules/attach-lib` → `dist/`), so `yarn build` before `yarn test` if `dist/` is stale. A few tests (e.g. `test/DTSParser.test.ts`, `test/DTSParserRoundtrip.test.ts`, the pipeline-stage tests) import directly from `../src` and don't need a build. Some source files also carry inline `import.meta.vitest` doctests (e.g. `src/Bindings/fixups/*.ts`, `src/Attach/Populate.ts`) picked up via `includeSource` in `vitest.config.ts` — these run alongside the `test/*.test.ts` files.

`test/BindingParserCompletion.test.ts` parses the whole Linux bindings tree (about 40s) and is off (`const run = false`); flip the flag to run it. Snapshots in `test/expected/` are the JSON a test compares with; setting a test's `debug: true` rewrites them instead.

## Architecture

### Core Modules

**Devicetree (`src/Devicetree/`)**
The DTS parser, printer and the ergonomic wrappers over them. `Parser/` holds the AST types (`DTS`, `DTO`, `DTNode`, `DTProperty`, `DTValue`, `Bits`), `Lexer`/`LexerInputStream`/`TokenStream` and `parse_dts` / `parse_dto` (they return `Result`; `format_parse_error` turns the error into a message with line and column); `Printer.ts` has `print_dts`, `print_dto`, `print_property`. `DeviceTree` (`Devicetree.ts`) wraps a base tree: `new_from_string` / `new_from_file`, traversal (`as_stream`, `Stream.ts`), lookup (`node_at`, `locate`, `resolve_identifier`) and mutation (`add_node`, `remove_node`, `move_node`, `rename_node`, `set_status`, `set_property`, …). `DeviceTreeOverlay` (`DevicetreeOverlay.ts`) is an overlay over a base tree: fragments (`add_fragment`, `ensure_node`), the overlay's own and merged view (`effective_children`, `merged_tree`, `all_labels`), and `print`. `NodeBuilder` / `PropertyBuilder` build nodes and properties programmatically (value input types in `Types.ts`, type-level helpers such as `AddCallOnce` in `TypeUtilities.ts`). `Access.ts` (property readers, `LocatedNode`), `AddNode.ts`, `Labels.ts` and `UnitAddress.ts` are the helpers the CLI builds on. Everything is re-exported selectively from `src/index.ts`. `Parser/README.md` still describes the old `DtsDocument` parser and is out of date.

**Overlay checks (`src/Devicetree/RegConflicts.ts`, `src/Devicetree/References.ts`)**
`reg_conflicts(overlay)` finds sibling nodes whose `reg` clashes. `unresolved_references(overlay, under?)` lists `&label` / `&{path}` references that name no node of the base tree or the overlay, and `unresolved_targets(overlay)` lists fragments whose `target` / `target-path` doesn't exist before the fragment is applied. Labels on `__overlay__` and inside `__dormant__` fragments count, as dtc resolves them too.

**Binding processor (`src/Bindings/`)**
Turns a raw YAML binding schema into a UI-ready `ParsedBinding`. Dependencies run one way: `Bindings` (schema → `ParsedBinding`) ← `Attach` (validation and state) ← the CLI. `Bindings/Context.ts` builds a `SchemaContext` (`$RefParser` plus the ordered `(url prefix, dir)` search paths) from `SchemaPaths = { linux, dt_schema }`, and `Bindings/Pipeline.ts`'s `process_binding(path, ctx)` runs the stages, returning `Result<DtBindingSchema, PipelineError>` (`{ stage, message }`):

1. `RefResolver` — `dereference` / `bundle` resolve `$ref` chains via `@apidevtools/json-schema-ref-parser`; `resolve_references` also collects the referenced schema files
2. `PropertyResolver` — fills the `property: true` placeholders from the referenced files
3. `RedefinitionMerger` — merges the `allOf` re-definitions of a property into its root definition
4. `CanaryInserter` — injects the `CANARY` (`__canary__`) sentinel property into `allOf` `then`/`else` branches to make implicit `if/then` branches detectable by AJV
5. `JSONSchemaFixups` — patches quirks of real-world bindings before validation. One walk (`FixupWalker.ts`, modelled on dt-schema's `fixups.py`) applies node fixups to every node schema and property fixups to every property, property patterns included; each fixup in `Bindings/fixups/` names its dt-schema counterpart (`reg`, `string_to_array`, `names`, `items_size`, `interrupts`, `remove_invalid_keys`). `collapse_allOf`, `mark_ifs`, `mark_integers` and `mark_matrix` are ours, as dt-schema keeps the `types.yaml` `$ref`s and gets property types from them where we dereference
6. `JSONSchemaTranslate` — builds the `ParsedBinding`. `patternProperties` are split by `Bindings/PatternKind.ts`: object schemas and `@` patterns become child-node rules (`pattern_properties`), the rest name properties (`property_patterns`); `false` entries are dropped

A property's type is an `AttachType` (`Bindings/StructuralTypes.ts`): `flag`, `scalar` (one `Cell`), `list` (`item` one `Cell` for every value, or one per position, with optional `minItems` / `maxItems` / `typeSize` / `unique`), `matrix` (`rows` of lists), `node` (child properties) or `unknown`. A `Cell` is a `number` (optional range), an `enum` (`enum_type` says whether its options are numbers, strings, macros or phandle names; an option may be a whole list of strings, the fallback `compatible`s), a `string`, or `any` (a number, label or macro expression). A const is a one-option enum that is also the default. `is_list`, `is_open_list` and `list_cell` narrow them.

`src/RegexExpansion.ts`'s `expand_pattern(pattern, cap = 32)` turns a binding pattern into the names it matches (`^channel@([0-9]|1[0-5])$` → channel@0 … channel@15), or into the literal stem when it is unbounded or larger than the cap (`^fan-[0-9]+$` → "fan-"). The CLI uses it for completion and `list property`.

The output is a `ParsedBinding` that can be fed to AJV for validation and to the frontend for rendering.

**`Attach` class (`src/Attach/`)**
`Attach.parse(bindingPath, { linux, dt_schema }, options?)` runs the pipeline and returns `Result<Attach, BindingParseError>`: an `Attach` holding the `readonly parsed_binding` and its compiled validators (`patterns` lists the child-node patterns). `Validation.ts` has `create_ajv()` (with the `typeSize` keyword of dt-schema's `validator.py`), `compile_targets`, `narrow(target, data)` and the pure `translate_ajv_errors`. `update_binding_by_changes(data)` re-runs the compiled AJV validator against edited DTS-derived JSON (`DTxBinding.ts`: `dt_to_validator_input`, `validator_input_json`), walks `__canary__` errors to figure out which `if/then` branches now apply, and translates the rest of the AJV errors into typed `BindingErrors` (`Errors.ts`: missing required property, number-limit violation, failed dependency, generic); `update_pattern_binding_by_changes(pattern, data)` does the same for a child-node pattern. `Populate.ts` has the free functions `populate_binding(binding, devicetree, data, options?)` and `populate_properties`, which run the Intelligence stack over a binding (`PopulateOptions`: extra `layers`, the node's `placement`, `parent_name`; child-node patterns get the layers but not the placement).

**Intelligence (`src/Intelligence/`)**
Suggestions for configuring a peripheral, organised as layers of context (binding → devicetree → board). Details — layer operations, `IntelligenceStack`, board YAML parsing gotchas — are in `src/Intelligence/CLAUDE.md`.

### Test Layout

`test/legacy/` holds an older copy of the DTS parser tests plus a large `.dtb` fixture cache; `vitest.config.ts` excludes `test/legacy/**` from runs. `test/dt-schema` and `test/linux` are symlinks (see `.gitignore`) into local checkouts of the dt-schema meta-schemas and a Linux kernel tree, used as real-world binding corpora by tests like `BindingParserCompletion.test.ts`.
## Key Conventions

- No `any` without justification.
- The `__canary__` property name (`CANARY`, exported by `CanaryInserter`) is a protocol between `CanaryInserter` and the AJV validation step (`Validation.ts`); do not reuse it for other purposes.
- Fixups take a schema and return one; the walker clones the binding once. A new per-property fixup goes in `Bindings/fixups/` with a comment naming its dt-schema counterpart and is added to `FIXUPS` in `JSONSchemaFixups.ts`.
- Commit messages: short imperative present tense, prefixed with `attach-lib:` (e.g. `attach-lib: handle negative scalars in property values`).
