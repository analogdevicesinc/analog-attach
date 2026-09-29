# Layered intelligence: board descriptions as a context layer

## Context

`pmd-rpi-intz.yaml` (in `~/claude_conversations`) records how the PMD-RPI-INTZ HAT fixes a Pi 4's wiring. For example, SPI PMOD #1 uses spi0 reg 0 (CE0/GPIO8), gets its interrupt on GPIO19 and its reset on GPIO21, and spi0 needs `cs-gpios` for CS2/CS3. Today the intelligence in attach-lib only knows what the binding and the base DTS allow. So the AI (or the user) has to guess board-specific values, as the notes in `packages/attach-cli/ad7124-8-annotated.dtso` point out ("reg = <0> //CS0 default => cross-reference intz ruleset", "interrupts = <19 2> … Default to PMD-RPI-INTZ P1 gpio19").

Configuring a peripheral draws on several **layers of context**. Each layer knows more about the concrete system than the one below it:

1. **Binding.** What the device's schema allows, plus structural knowledge about well-known properties. Today this is `insert_known_structures`.
2. **Devicetree.** What the base DTS provides: controllers, buses and phandles. Today this is `query_devicetree` and `suggest_parents`.
3. **Board.** How an add-on board (HAT, cape, shield, mezzanine…) wires peripherals to the host: slots, chip selects, interrupt, reset and GPIO lines. This layer is new.

Further layers (a specific carrier-board revision, a user's own wiring notes, …) should be addable later without changing consumers.

Goal: add a generic **layer abstraction** to attach-lib's Intelligence module, express the two existing layers through it without changing their behaviour, and add the board layer. attach-cli becomes a thin consumer. It loads the board file, builds the layer stack and formats the results.

Decisions:
- **All the intelligence logic lives in attach-lib.** attach-lib stays fs-free for this feature: it parses board YAML from a string.
- **A layer can do two things.**
  - `refine_properties`: schema-level refinement. This is what layers 1 and 2 already do; the board layer uses it to attach concrete candidate values to properties.
  - `suggest_values` / `suggest_placement`: concrete, ready-to-use candidates.
- **Slot binding is stateless.** The slot is inferred from the parent bus plus `reg`. If that's ambiguous, candidates for every slot on the bus are returned, each labelled with its slot.
- **The board file is chosen by one CLI config field, `board`.** It accepts either a path or the name of a board bundled with the CLI in `attach-cli/bundled/boards/`.
- **Existing exports are unchanged.** `query_devicetree`, `insert_known_structures`, `suggest_parents` and `Attach.populate_*` keep their signatures and output, so the extension needs no changes.

## attach-lib

### 1. Layer abstraction — `src/Intelligence/layers/`

`types.ts`:
```ts
// Where a node sits, derived from the overlay + base tree. Board layers need it to infer the slot.
type NodePlacement = {
    node_path: string;                      // absolute
    parent_path: string;                    // absolute
    reg?: bigint;                           // first cell of the node's reg
    siblings: { name: string; reg?: bigint }[];
    is_bus_node: boolean;                   // the node itself is a bus (e.g. spi0 for cs-gpios)
};

type PropertyContext = {
    devicetree: DeviceTree;                 // base tree
    data: string;                           // current node values as validator-input JSON (as today)
    parent_name?: string;                   // existing query_devicetree semantics
    placement?: NodePlacement;
};

// One DTS cell element. Structured, so every consumer can serialise it its own way.
type SuggestedCell = bigint | { label: string } | { macro: string };

type ValueSuggestion = {
    rows: SuggestedCell[][];                // `<a b>, <c d>` → [[a, b], [c, d]]
    display: string;                        // "19 IRQ_TYPE_EDGE_FALLING — spi_pmod1.int"
    source: string;                         // layer name, e.g. "board:pmd-rpi-intz"
    slot?: string;                          // provenance for board suggestions
    note?: string;                          // "in use by adc@0"
};

type PlacementSuggestion = {
    parent: PathAndLabel;
    reg?: bigint;
    slot?: string;
    display: string;
    source: string;
};

interface IntelligenceLayer {
    readonly name: string;
    refine_properties?(properties: ResolvedProperty[], context: PropertyContext): ResolvedProperty[];
    suggest_values?(property: string, context: PropertyContext, lower: ValueSuggestion[]): ValueSuggestion[];
    suggest_placement?(binding: ParsedBinding, devicetree: DeviceTree, lower: PlacementSuggestion[]): PlacementSuggestion[];
}
```
Every operation is optional, so a layer only implements what it knows. Each fold passes lower layers' results upward, so a higher layer can annotate, narrow or extend them.

`stack.ts`: `IntelligenceStack.new(layers)` stores the layers lowest first and has `refine_properties`, `refine_parsed_binding` (properties plus pattern properties), `suggest_values` and `suggest_placement`. Each one folds over the layers in order. `IntelligenceStack.default(devicetree)` returns `[binding_layer, devicetree_layer]`, and `.with(...extra)` appends more layers.

`binding.ts`: `binding_layer` wraps `insert_known_structures` in its `refine_properties`.

`devicetree.ts`: `devicetree_layer` wraps `query_devicetree` in `refine_properties` and maps `suggest_parents` into `PlacementSuggestion`s in `suggest_placement`.
- Today's composition is `insert_known_structures(query_devicetree(…))`. The two functions touch disjoint keys (known structures: `reg`, `spi-*`, unit suffixes…; devicetree: phandle and `*-gpios` properties), so folding binding → devicetree gives the same result. A test pins this.

`placement.ts`: `placement_from_overlay(overlay, found: FoundNodeResult): NodePlacement`.
- It uses `found.node_path`, the parent's children in the overlay, and the base tree's children at the same path.
- Base-tree children with `status = "disabled"` don't count as occupying a `reg`. For example, the Pi's `spidev@0` is usually disabled by the overlay.

### 2. Additive type change — `src/Attach/AttachTypes.ts`

`ResolvedProperty` gets `suggestions?: ValueSuggestion[]`. This is how `refine_properties` carries concrete candidates, so the extension UI can show them as quick-picks and `suggest type` can show them later. Nothing else in `StructuralTypes` changes; the board layer never narrows the allowed values, because a user can always rewire.

`Attach.populate_properties` / `populate_parsed_binding` / `new_populated_binding` get an optional trailing `options?: { layers?: IntelligenceLayer[]; placement?: NodePlacement }`. Without it they build `IntelligenceStack.default` and behave exactly as today.

### 3. Board layer — `src/Intelligence/board/`

`types.ts` — `BoardDescription`:
- `board` and `host` names.
- `gpio_controller` (`"&gpio"`).
- `buses`: keyed by name, each with `node` (a label reference), optional `chip_selects: Record<reg, { gpio, user }>`, and optional `reserved_addresses`.
- `slots`: keyed by id, each with `bus`, optional `alt_bus` + `selected_by`, optional `reg`, and `signals`.
- A signal has `kind: interrupt | reset | chip-select | gpio`, `gpio`, optional `reg` (chip selects), `connected` (default true), `active: high | low`, and `open_drain`.
- `constraints`, `gpio_usage`, `free_gpios` and `conflicting_overlays` are carried through untouched. They're for AI/human reading and possible later validation work.

`parse.ts`: `parse_board_description(yaml: string): BoardDescription | string`. It returns an error string, matching the `DeviceTree.new_from_string` convention. It uses the lib's existing `yaml` dependency plus a hand-written structural check, with no new dependencies.

`slots.ts`, pure functions:
- `resolve_bus_paths(board, devicetree)` maps `&spi0` → an absolute path via `get_node_by_label`.
- `slots_for_placement(board, bus_paths, placement)` returns `{ slots, narrowed }`. For SPI it matches `reg` against the slot's `reg` or its chip-select signals' `reg`. If nothing matches, it returns every slot on that bus with `narrowed: false`.

`layer.ts`: `board_layer(board: BoardDescription): IntelligenceLayer`, named `board:<board>`.
- `suggest_values(property, ctx, lower)` needs `ctx.placement` and returns `lower` unchanged when the parent isn't a board bus. Rules:
  - `reg` under a board SPI bus: one suggestion per chip select, e.g. `[[2n]]` with display `"2 — GPIO20 (spi_pmod1.cs2)"` and `note` set when a sibling uses it. No suggestions under I2C, because the device fixes the address.
  - `interrupts`: for each connected `interrupt` signal in the candidate slots, one suggestion per `INTERRUPT_MACROS` entry except `IRQ_TYPE_NONE`: `[[19n, {macro}]]`.
  - `interrupts-extended`: the same with a `{label: "gpio"}` first cell.
  - `interrupt-parent`: `[[{label: "gpio"}]]`, from `gpio_controller`.
  - `reset-gpios` / `reset-gpio`: `[[{label}, n, {macro: GPIO_ACTIVE_LOW|HIGH}]]` for `reset` signals.
  - Other `*-gpios`: the same for `gpio`-kind signals.
  - `cs-gpios` when `placement.is_bus_node`: a single suggestion with one row per chip select in `reg` order, generated from `chip_selects`.
- `refine_properties(props, ctx)`: for each property, set `suggestions = this.suggest_values(key, ctx, existing ?? [])`. The shape of `value` is left alone.
- `suggest_placement(binding, dt, lower)`:
  - Every lower suggestion whose parent is a board bus is expanded into one entry per slot on that bus (`slot`, `reg`, display `"spi_pmod1 — spi0 reg 0; int GPIO19, reset GPIO21"`).
  - `alt_bus` counts as a match.
  - Parents that aren't board buses pass through unchanged.
- `list_slots()` lists all slots, for when no binding is available.

### 4. Exports and docs
- `src/Intelligence/index.ts` exports the layer types, `IntelligenceStack`, `binding_layer`, `devicetree_layer`, `placement_from_overlay`, `BoardDescription`, `parse_board_description` and `board_layer`.
- `attach-lib/CLAUDE.md`, Architecture section: an "Intelligence layers" paragraph covering the layer contract, order, and how to add a layer. While there, replace the stale `DtQuery` / `dts_legacy` text with the current `Intelligence/` layout.

## attach-cli

Kept deliberately small: load the board, build the stack, format the output.

1. **Board file.**
   - `bundled/boards/pmd-rpi-intz.yaml` holds the tightened schema from §3.
   - `getBundledBoardsPath()` goes in `src/commands/skill/utilities.ts`, next to `getBundledDtSchemaPath`.
   - New `src/board.ts`:
     - `resolve_board_reference(ref)` treats `ref` as a path if one exists; otherwise it resolves to `bundled/boards/<ref>.yaml`.
     - `load_board(ref): BoardDescription | string` reads the file and calls `parse_board_description`.
     - `list_bundled_boards()`.
2. **Config** (`src/config.ts`). Add `board?: string` and a registry entry: `type: "string"`, `required: false`, `validate` = `load_board` error. Add `"board"` to the registry totality test. `check_config` only validates the fields a command asks for, so a broken `board` can't affect other commands.
3. **Binding resolution** (`src/binding-resolution.ts`). `resolve_node_binding` takes optional `options?: { layers, placement }` and passes it through to `Attach.new_populated_binding` / `populate_*`. When a board is configured, `suggest type` therefore comes back with `suggestions` on board-relevant properties. The protocol `TypeResponse` gets an optional `suggestions: Suggestion[]`.
4. **Formatting** (`src/commands/update/command.ts`). Add `format_value(rows: SuggestedCell[][]): string`, the inverse of `parse_value`:
   - rows are joined with `,` and cells with spaces;
   - labels are written bare and macros by name.
   - An inline round-trip test checks that `parse_value(format_value(x))` produces the same shape.
5. **Suggest kinds** (`src/commands/suggest/command.ts`):
   - `value <prop-ref>`:
     - parse the prop-ref the way `suggest_type` does;
     - load the trees, then `placement_from_overlay`;
     - build `IntelligenceStack.default(base_dt).with(board_layer(...))` if `board` is set;
     - call `stack.suggest_values`;
     - map each result to `{ value: format_value(rows), display_string: display }`.
     - The message says `"narrowed to spi_pmod1"` / `"ambiguous: 2 slots on i2c1"` (severity `warn`) / `"no layer offers values for <prop>"`.
     - It needs only `context` + `overlay` (no `linux` / `dt-schema`).
   - `board-slot [compatible]`: requires `board`.
     - Without an argument it lists `board_layer.list_slots()`.
     - With one it uses the `suggest_parent` path to get the binding, calls `stack.suggest_placement`, and keeps the entries that have a `slot`.
   - `suggest parent` is unchanged.
   - Optional: a local `load_trees(ctx, config)` helper, because the DTS+DTSO parse/error block would now appear 5–6 times.
6. **Listing and completion.**
   - `list-intelligence`: add `value` and `board-slot` with descriptions aimed at the AI ("call before `update --with` when a board is configured; if message says ambiguous, ask the user which slot"), and update the kind count.
   - `completion/spec.ts`: add `"value"` to `SuggestKind` and `update.flags["--with"] = { kind: "suggest", suggest: "value" }`.
   - `complete.ts`: `case "value": return capture_suggest(kind, positionals)`.
   - The drift test gets a `--with` case.
7. **Docs.**
   - `SKILL.md` §9: document `value` and `board-slot`, plus the workflow: if `config-get board` is set, run `suggest board-slot <compatible>` → ask the user → `add --to <bus>` → `suggest value <node>/reg|interrupts|reset-gpios` → `update`. Also add a line about `board` to the config section.
   - `CLAUDE.md`: a short "Board descriptions" paragraph saying the logic lives in attach-lib's board layer; the CLI only resolves and loads the file.

## Files

**attach-lib.**
- New: `src/Intelligence/layers/{types,stack,binding,devicetree,placement}.ts`, `src/Intelligence/board/{types,parse,slots,layer}.ts`.
- Modified: `src/Intelligence/index.ts`, `src/Attach/AttachTypes.ts`, `src/Attach/Attach.ts`, `CLAUDE.md`.

**attach-cli.**
- New: `src/board.ts`, `bundled/boards/pmd-rpi-intz.yaml`.
- Modified: `src/config.ts`, `src/binding-resolution.ts`, `src/commands/update/command.ts`, `src/commands/suggest/command.ts`, `src/commands/list-intelligence/command.ts`, `src/commands/completion/{spec,complete}.ts`, `src/commands/skill/utilities.ts`, `src/protocol/types.ts`, `src/completion-drift.test.ts`, `SKILL.md`, `CLAUDE.md`.

**Extension.** No changes. It keeps calling `query_devicetree` / `insert_known_structures` directly, and can adopt `IntelligenceStack` later.

## Verification

1. attach-lib: `cd packages/attach-lib && yarn build && yarn test -- run`. New inline tests cover:
   - **Stack.** `IntelligenceStack.default` produces the same output as `insert_known_structures(query_devicetree(…))` on existing fixtures (behaviour preserved), and a higher layer sees `lower` results.
   - **`parse_board_description`.** The bundled file parses; schema errors produce readable strings.
   - **`slots_for_placement`.** spi0 reg 0 → spi_pmod1; reg 2 → spi_pmod1 via CS2; i2c1 → ambiguous with 4 slots (quikeval via `alt_bus`).
   - **`board_layer.suggest_values`.** Each property rule, including the `cs-gpios` rows and a chip select marked in use.
   - **`placement_from_overlay`.** Overlay siblings plus base-tree siblings, with disabled base nodes ignored.
   - **`board_layer.suggest_placement`.** SPI parents are expanded into slots; non-board parents pass through.
2. attach-cli:
   - `yarn workspace attach-cli test --run`: the `format_value` round-trip through `parse_value` + `set_property` against a stub binding gives e.g. `interrupts = <19 2>`, plus the config totality and completion drift tests.
   - `yarn build:attach-lib && yarn workspace attach-cli build` must pass tsc.
3. Manual run in `packages/attach-cli` with the existing `.attach-linux/config.toml` (context `~/rpi-4.dts`):
   ```
   attach-linux config-set board pmd-rpi-intz
   attach-linux --json suggest board-slot adi,ad7124-8     # spi_pmod1, spi_pmod2, quikeval
   attach-linux add adi,ad7124-8 --to spi0 --name adc@0 --label ad7124
   attach-linux update ad7124/reg --with 0
   attach-linux --json suggest value ad7124/interrupts     # "19 IRQ_TYPE_…", message "narrowed to spi_pmod1"
   attach-linux --json suggest value ad7124/reg            # 0..5, reg 0 marked in use
   attach-linux --json suggest value spi0/cs-gpios
   attach-linux --json suggest type ad7124/interrupts      # type unchanged, plus suggestions
   attach-linux update ad7124/interrupts --with "19 IRQ_TYPE_EDGE_FALLING" && attach-linux read ad7124/interrupts
   ```
   Also check:
   - `--with` completion via the `__complete` path lists the same values.
   - With `board` unset, `suggest value` returns an empty result with an info message, `board-slot` emits the standard missing-config input error, and every other kind behaves exactly as before.
   - The extension still builds against the new attach-lib.
