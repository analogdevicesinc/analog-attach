# Fix handoff: tier 4 (lower-severity items, cleanups, `<&&spi0>`)

Plan date: 2026-09-29. Branch `dpetri/devicetree`, uncommitted working tree. Tier 1–3 fixes are already applied (see
`tier1-fix-handoff.md`, `tier2-fix-handoff.md`, `tier3-fix-handoff.md`). The items come from `code-review-handoff.md`,
sections "Lower-severity", "Cleanups" and "Outside this diff". Line numbers refer to the working tree at planning time
and may drift.

## Status

- Nothing implemented yet. This document is the plan.
- Every item was re-checked against the code after tier 3 by reading it, not by running it live.
- `/tmp/cr-review` no longer exists (see Verification).

## Decisions

1. **Parse once, and pass the result along.** `resolve_config` returns the parsed context `DeviceTree` and
   `BoardDescription` from its validate step. Commands receive them instead of re-parsing. No memoization.
2. **Dedup covers all commands.** Every command uses the shared `load_trees` / `load_base` and the prop-ref parser,
   not only suggest and update. JSON error-message casing is normalised.
3. **`target = <&{/p}>` is resolved and normalised.** Lookups handle path elements. `parse_dto` rewrites the form to
   `target-path = "/p"`, because dtc can't emit fixups for `&{/p}` in a plugin.
4. **Board fixtures move under `attach-lib/test/`** as plain data files (`.yaml` / `.dts`) that the tests read with
   `fs`, so nothing imports across tsconfig's `rootDir: src`.
5. **`ValueSuggestion.slot` becomes `slots: string[]`.** A shared chip select names every owner.
   `PlacementSuggestion.slot` stays singular, because a placement belongs to exactly one slot.

## Context

Tiers 1–3 fixed all 15 numbered review findings. What's left:

- the verified lower-severity items;
- about 13 cleanups;
- one bug outside the diff. Printing an overlay written in the `&label { }` form gives `target = <&&spi0>`, which no
  longer reparses, so every later `update` on that overlay fails with "unreadable overlay".

The goal is to clear the whole list. Each behavioural fix gets an inline `import.meta.vitest` regression test, following
package convention. Cleanups must keep the existing tests green.

**Build note:** CLI tests run against `attach-lib/dist`, because `node_modules/attach-lib` points at `dist/index.js`.
Run `yarn workspace attach-lib build` after the lib changes and before the CLI tests.

### Review item → section

| Review item | Section |
|---|---|
| `DeviceTreeOverlay.print()` writes `<&&spi0>` (outside this diff) | A1 |
| `target = <&{/path}>` fragments lose their bus prefix | A2 |
| `refine_properties` not idempotent | B1 |
| `refine_parsed_binding` unused | B2 |
| Integer-like YAML keys reordered, `0`/`"0"` collapse | B3 |
| `suggest_placement` drops slotless board bus | B4 |
| Label regex accepts `-` | B5 |
| Reg suggestion `slot` names only the first owner | B6 |
| `resolve_bus_paths` recomputed per property | B7 |
| Double slash `//soc/...` in display strings | B8 |
| `fixture.ts` lives in `src/` | B9 |
| `load_trees` extracted but only half used | C1 |
| Prop-ref parsing duplicated | C2 |
| Board YAML and base DTS parsed twice per command | C3 |
| Docs promise board suggestions on `suggest type` for base-tree bus nodes | C4 |
| Subshell fork per completion candidate | C5 |

Suggested order:

1. **A1, A2.** A1 is the only user-visible breakage.
2. **B9.** The fixture move touches the test blocks the later B items edit.
3. **B1–B8.**
4. **Rebuild attach-lib.**
5. **C3 → C1 → C2 → C4 → C5.** C1 depends on C3's signatures.

---

## A. Overlay references (attach-lib `Devicetree/`)

### A1. `<&&spi0>`: the parser stores the `&` in the label name

**Root cause.** For the top-level `&label { }` form, `parse_dto` builds the `target` cell with the name set to
``name: `&${current.value}` `` (`src/Devicetree/Parser/Parser.ts:225`). The lexer has already removed the sigil
(`Lexer.ts:100`), and every other code path stores bare names:

- `create_label_fragment` / `PropertyBuilder.tag_label`
- `parse_cell_array`

`print_references` (`Printer.ts:196-211`) adds `&` back when printing, so the output is `<&&spi0>`. On reparse, the lexer
reads the first `&` as a Char token, and `parse_cell_array` fails with "Expecting a reference, number or expression".

**Other symptoms of the same cause:**

- `find_fragment` (`DevicetreeOverlay.ts:130-131`) compares `"&spi0"` with `"spi0"`, so `add_fragment` creates a
  duplicate fragment instead of reusing `fragment@0`.
- `validate2` (`attach-cli/src/commands/validate2/command.ts:215`) passes the raw name to `get_node_by_label` and never
  finds the target node.

**Fix:**

- In `Parser.ts:225`, use `name: current.value`.
- Keep the defensive `&`-stripping at `DevicetreeOverlay.ts:446` and `attach-cli/src/utilities.ts:203`. It is harmless.

**Tests** (inline in `DevicetreeOverlay.ts`):

- Take `&spi0 { dev@0 { ... }; };`, then `print()` it and reparse. Reparsing succeeds and the target element name is
  `"spi0"`.
- `add_fragment({ kind: "label", name: "spi0" })` on that overlay reuses the existing fragment.
- Tighten `test/DTSParser.test.ts:298-371` (fixture `references.dtso`) to also assert `name`. Today it only checks
  `kind === "label"`.

### A2. `target = <&{/path}>` fragments

**Root cause.** `get_fragment_root_path` (`DevicetreeOverlay.ts:443-455`) skips any `target` element that isn't a label.
With no `target-path` to fall back on, it returns `undefined`. The effects:

- **`find_node` by label.** `abs_node_path` becomes `/adc@0` instead of `/soc/spi@7e204000/adc@0`.
- **`find_node` by path.** Never finds the node.
- **`placement_from_overlay`.** Takes siblings from the base root, and skips the fragment's sibling patches.
- **`remove_by_base_path` / `remove_property_by_path`.** Skip these fragments.
- **`find_fragment`.** Never reuses a `target = <&{…}>` fragment.

The top-level `&{/path} { }` form already becomes `target-path` (`Parser.ts:231-243`) and works.

**Fix:**

- **`get_fragment_root_path`.** When `element.kind === "path"`, return `element.path`, checked against `base_dts` the
  same way the label branch is.
- **`find_fragment` (`:136-145`).** A `DTPath` target also matches a `target` cell holding the same path.
- **`parse_dto` normalisation.** In explicit `fragment@N` nodes, a `target` property whose only element is a `path`
  reference is rewritten to `target-path = "/p"`. After that, printed overlays compile with dtc.

**Tests:**

- A fragment with `target = <&{/soc/spi@7e204000}>` parses to `target-path = "/soc/spi@7e204000"`.
- `find_node` on that fragment returns `node_path === "/soc/spi@7e204000/adc@0"`.
- `placement_from_overlay` (inline in `placement.ts`) returns the SPI bus siblings, not the root's children.

## B. Board / intelligence layer (attach-lib `Intelligence/`)

### B1. `refine_properties` is idempotent

**Root cause.** In `board/layer.ts:257-264`, `refine_properties` appends to `property.suggestions ?? []`. Lower layers
`structuredClone` the property, so the field survives, and a second run appends the board suggestions again.

In the CLI, `binding-resolution.ts:135-137` writes the result back into shared state
(`match.rule.properties = Attach.populate_properties(...)`), so every extra `narrow_and_populate` call makes it grow.

**Fix:**

- In `refine_properties`, set `lower = (property.suggestions ?? []).filter(s => s.source !== name)` before appending.
- In `binding-resolution.ts:135`, stop reassigning `match.rule.properties` and use a local variable instead.

**Test:** running `refine_properties` twice gives the same suggestions as running it once.

### B2. Remove the unused `refine_parsed_binding`

`layers/stack.ts:40-49` has no callers in any package. It still passes `placement` to pattern properties, which is the
#14 leak.

**Fix:**

- Delete it.
- Drop its mention in `docs/board-constraints-plan.md:76`.

### B3. Integer-like YAML keys (`board/parse.ts`)

**Root cause.** `parse_yaml_string(content, { merge: true })` (`:213`) returns plain JS objects. That has two effects:

- **Keys are reordered.** Integer-like keys are enumerated first, in numeric order.
- **Keys collapse.** `0` and `"0"` become the same string key, so the second value silently replaces the first. yaml's
  `uniqueKeys` check doesn't catch this, because to yaml they are different scalars.

Reordering matters for slot and signal order ("board-file order" in `slots.ts:41`) and for `reserved_addresses`, which is
never sorted.

**Fix:**

- Parse with `{ merge: true, mapAsMap: true }`.
- Adapt `is_map`, `map_at`, `optional` and `known_keys` to `Map`.
- Replace the `Object.entries` walks (`:90,106,133,165,167,174,182`) and the `map["x"]` reads.
- Change `key_as_int` to take `unknown`:
  - accept number keys and `/^\d+$/` strings;
  - reject two keys that normalise to the same int with `${where}: duplicate key 0`.
- Output types don't change, and all changes stay inside `parse.ts`.

**Tests:**

- `0` and `"0"` both under `chip_selects` → rejected with `duplicate key`.
- Slot ids `"10"`, `"2"`, `a` keep file order in `board.slots`.
- `reserved_addresses` keep file order.

### B4. `suggest_placement` keeps board buses with no slots

In `layer.ts:266-296`, when a board bus has no slots, `entries` is empty and the parent candidate disappears. This is
latent, because the CLI filters out rows without a slot (`suggest/command.ts:488-491`).

**Fix:** `return entries.length > 0 ? entries : [candidate];`

**Test:** a board bus with no slots (like i2c0) is still returned as a candidate.

### B5. The label regex rejects `-`

`parse.ts:48` uses `/^&[A-Za-z_][\w-]*$/`, but dtc labels are `[a-zA-Z_][a-zA-Z0-9_]*` (see `Lexer.ts:22`).

**Fix:** `/^&[A-Za-z_]\w*$/`

**Test:** `"&my-bus"` as a `bus.node` is rejected.

### B6. Every owner of a shared chip select is listed

In `layer.ts:169-180`, the display lists every `cs.users` entry, but the `slot` field comes from `board.slots.find(...)`
and so names only the first owner (reg 0 → `spi_pmod1`, missing `quikeval`).

**Fix:**

- In `ValueSuggestion` (`layers/types.ts:40`), replace `slot?: string` with `slots?: string[]`.
- In `layer.ts:169-180`, collect the owners with `.filter`.
- Update the `suggestion()` helper (`:129-135`) and the tests that read `.slot`:
  - `layer.ts:326,346,394,511,518`
  - `attach-cli suggest/command.ts:892,899`
- The CLI protocol `Suggestion` doesn't expose the field, so JSON output is unchanged.

**Test:** reg 0 on spi0 has `slots: ["spi_pmod1", "quikeval"]`.

### B7. Compute `resolve_bus_paths` once per refine

`refine_properties` calls `suggest_values` once per property. Each call recomputes `resolve_bus_paths` (one label lookup
per bus), `bus_at_path` and `slots_for_placement`. All three depend only on `context`, not on the property.

**Fix:**

- Split `suggest_values` into an inner function that takes the precomputed `{ bus_paths, own_bus, inference }`.
- `refine_properties` computes those once, before its `.map`.
- Public `suggest_values` computes them itself and delegates to the inner function.
- `infer_slots` and `bus_of_node` stay as they are, since each is called once.

No new tests; the existing board-layer tests cover this.

### B8. Display strings no longer start with `//`

`suggest_parents` (`parents.ts:85,94,103`) builds paths as `['/', 'soc', 'spi@…']`, so `path.join("/")` gives
`//soc/spi@…`. The copies are:

- `layers/devicetree.ts:16` (new code)
- `attach-cli/src/commands/suggest/command.ts:125-126` (`suggest parent`, already at HEAD)

`layer.ts:269` already has the correct conversion inline.

**Fix:**

- Export `parent_path_string(p: PathAndLabel)` from `Intelligence/parents.ts`, taking the logic from `layer.ts:269`.
- Use it at `devicetree.ts:16`, `layer.ts:269`, and `suggest/command.ts:125-126`. At that last site it covers both the
  `display_string` and the `value` fallback when there is no label.
- Check SKILL.md examples for `//` paths.

**Test:** placement and parent display strings start with a single `/`.

### B9. Move the board fixtures to `test/`

`src/Intelligence/board/fixture.ts` exports only two template strings: `PMD_RPI_INTZ_FIXTURE` and `RPI_BASE_FIXTURE`. Its
importers are:

- `slots.ts:5` and `layer.ts:15`: static top-level imports used only in the vitest blocks;
- `Attach.ts:358`: `await import` inside its vitest block.

It isn't exported and doesn't reach `dist`, but it counts toward coverage.

**Fix:**

- Write the strings to data files:
  - `attach-lib/test/fixtures/board/pmd-rpi-intz.yaml`
  - `attach-lib/test/fixtures/board/rpi-base.dts`
- Delete `fixture.ts`.
- Inside each vitest block, read the fixtures with
  `fs.readFileSync(new URL("../../../test/fixtures/board/…", import.meta.url), "utf8")`. Adjust the relative depth for
  `Attach.ts`.
- There is no TS import across `rootDir: ./src`, so tsconfig and `vite build`/dts need no change.

## C. attach-cli cleanups

### C1. Shared `load_trees` / `load_base` (`src/utilities.ts`)

`load_trees` (`suggest/command.ts:160-176`) is used only by `suggest value` and `suggest type`. These places copy it by
hand:

| Location | Lines | Loads |
|---|---|---|
| suggest node-prop | `:549` | base + overlay |
| suggest navigate | `:647` | base + overlay |
| suggest parent | `:109` | base only |
| suggest board-slot | `:478` | base only |
| `add` | `:38-53` | base + overlay |
| `delete` | `:22-38` | base + overlay |
| `rename` | `:29-45` | base + overlay |
| `move` | `:29-45` | base + overlay |
| `validate` | `:30-47` | base + overlay |
| `update` | `:271-286` | base + overlay |
| `enable-disable` | `:29-43` | base + overlay |
| `get-schema` | `:29-36` | base only |

**Fix:**

- Move `load_trees` into `utilities.ts` and export it.
- Add `load_base` for base-only callers.
- Both take the already-parsed base `DeviceTree` from C3.
- Replace every copy in the table. `read` and `validate2` treat the base tree as optional, so they stay as they are.
- Normalise JSON error strings to the `load_trees` wording, and fix tests that assert the old casing (e.g. lowercase
  `failed to parse dts:` in delete/rename/move).

### C2. Shared prop-ref parser

`split_property_reference` in `utilities.ts:74-89` already exists (used by `read` and `rename`), but four other copies
remain:

- **`suggest/command.ts:179-187`, `parse_property_reference`.** Unlike `split_property_reference`, it handles `/prop` as
  a property of the root node.
- **`update/command.ts:253-258`.** An identical inline copy.
- **`suggest/command.ts:683-686` (navigate).** An inline `lastIndexOf("/")` split.
- **`delete/command.ts:213-217`.** Inline, with the same semantics as `split_property_reference`.

**Fix:**

- Move `parse_property_reference` into `utilities.ts`.
- Use it in `update` (`:253`), in suggest at `:272` and `:727`, and in navigate (`:683`).
- Change `delete` (`:213`) to call `split_property_reference`.
- Move the tests at `suggest/command.ts:904-935` along with the function.

### C3. Parse the context DTS and board once

**Root cause.** The `context` validate hook (`config.ts:79-83`) parses the whole DTS only to check that it is valid, and
the command then parses it again. The `board` hook (`:99-102`) calls `load_board` when `board` is required. In practice:

- **Every command that requires `context`** parses the DTS twice.
- **`suggest board-slot`**:
  - loads the board YAML twice (`:456` hook, then `:459`);
  - parses the DTS twice when a compatible is given;
  - reads `config.toml` twice, because it calls `resolve_config` twice.
- **`suggest value`** resolves the binding twice (`:305` → `:375`, and `annotate_suggestions` `:392`).

**Fix:**

- **`config.ts`:**
  - Add an optional `parse?: (value: string) => T | string` hook to `FieldSpec`. For `context` it returns a
    `DeviceTree`, for `board` a `BoardDescription`. It replaces their `validate`.
  - On success, `check_config` collects the parsed values into
    `parsed: ParsedConfig = { context?: DeviceTree; board?: BoardDescription }`.
  - `config-set` still uses the hook only to validate.
- **`resolve-config.ts`:** return `{ values, config, parsed }`, and drop the NOTE at `:10`.
- **Callers:**
  - `load_trees` / `load_base` take `parsed.context`.
  - `optional_board_layer` takes `BoardDescription | string | undefined`. Update its test at `suggest/command.ts:1205`.
- **`suggest board-slot`:** make one `resolve_config` call with
  `["board", ...(compatible ? ["linux", "dtSchema", "context"] : [])]`. This removes the second `load_board` and the
  second config read.
- **`suggest value`:** resolve the binding once and pass it to `annotate_suggestions`.

**Test:** `check_config` returns `parsed.context` / `parsed.board` for valid files.

### C4. Board suggestions from `suggest type` for base-tree nodes

**Root cause.** SKILL.md (`:109`, `:628`) and CLAUDE.md (`:62`) promise board-derived suggestions from `suggest type`,
but they never appear for a base-tree node such as `spi0`. The reason is that `suggest_type` looks the node up with
`overlay.find_node(target)` (`suggest/command.ts:743`), which returns one of two things:

- "not found", if no fragment targets the node;
- otherwise, the fragment's `__overlay__` node with no `compatible` and no parent.

In both cases `resolve_node_binding` fails before it reaches the board layer. `suggest value` avoids this by using
`resolve_write_target` (`:288`, `utilities.ts:231-261`).

**Fix:**

- In `suggest_type`, call `resolve_write_target(node_identifier, overlay, base_dt)`.
- Pass `binding_node`, `binding_parent` and `parent_name` to `resolve_node_binding`.
- Call `narrow_and_populate(binding_node)`.
- Keep the "not found" error for `found === undefined && !is_base_target`, as `update` does.

**Test:** with the inline suggest fixture (`suggest/command.ts:988-1044`) and a board configured,
`suggest type spi0/cs-gpios` returns board suggestions.

- If the fixture's bcm2835-spi binding doesn't carry `cs-gpios` (normally it comes via the `spi-controller.yaml`
  `$ref`), test `reg` on a device whose parent is a base-only bus instead.
- Adjust the docs claim only if it still overstates what works.

### C5. Bash completion stub no longer forks per candidate

In the bash stub, `completion/command.ts:58-63` runs `COMPREPLY[i]=$(printf '%q' …)`, which forks a subshell for every
candidate that contains a space.

**Fix:**

- Fold the quoting into the first loop (`:47-51`) using the scalar `printf -v value '%q' "$value"`, which works on
  bash 3.1+, including macOS bash 3.2.
- Skip the quoting when `cur` starts with `"` or `'`, as tier 3 does.
- Fish (`:136-138`): replace the per-candidate loop with `printf '%s\n' $out`.

**Test** (`completion-drift.test.ts`): the bash stub doesn't contain `$(printf`.

**Manual check:** drive bash 5.3 through a pty (Python `pty`, in `/tmp`).
`update ad7124/interrupts --with <TAB><TAB>` should still complete to a full `19\ IRQ_TYPE_…` value.

---

## Docs

- **`docs/code-review-handoff.md`:**
  - Strike through each lower-severity and cleanup item, and add its fix note.
  - Mark "Outside this diff" fixed.
  - Update the test counts in "Fix status".
- **attach-lib `CLAUDE.md`:**
  - `ValueSuggestion.slots`.
  - Board YAML maps keep file order and reject duplicate integer keys.
  - `target = <&{/p}>` is normalised to `target-path`.
- **attach-cli `CLAUDE.md`:**
  - `resolve_config` returns `parsed`.
  - `load_trees`, `load_base` and `parse_property_reference` live in `utilities.ts`.
  - Adjust the `suggest type` board-suggestion line if needed (C4).

## Out of scope (noticed, not planned)

- **Inline tests in the bundle.** The tsup config has no `define: { "import.meta.vitest": "undefined" }`, so
  `dist/cli.js` ships the inline test blocks (10 `import.meta.vitest` references). It's a one-line fix, but raise it
  with the user first.
- **`find_node` for base-tree nodes.** `suggest node-prop`, `suggest navigate` and `validate` have the same limitation
  as C4.
- **`parse_dto` limits:**
  - It can't mix the `/ { fragment@… }` and `&label { }` forms, because it picks a branch from the first token.
  - `/delete-node/` and `/delete-property/` inside a `&label { }` body are silently dropped.
  - A label before the reference (`foo: &spi0 { }`) lands on the fragment, not the target.

## Verification

1. `yarn workspace attach-lib test --run`. Every new test fails before its fix and passes after.
2. `yarn workspace attach-lib build`, then `yarn workspace attach-cli test --run`.
3. `yarn build:attach-cli`, which also runs `tsc --noEmit`.
4. End-to-end in a `/tmp` sandbox with `~/rpi-4.dts` and the bundled `pmd-rpi-intz` board:
   - Overlay written as `&spi0 { adc@0 { … }; };`: `update adc/reg --with 0` succeeds, and the file contains
     `target = <&spi0>`.
   - Overlay with `target = <&{/soc/spi@7e204000}>`: the next `update` rewrites it to `target-path`, and `dtc -@`
     compiles it.
   - `--json suggest type spi0/cs-gpios` includes board suggestions.
   - `--json suggest parent` output has no `//` paths.
   - The bash pty completion check from C5.
