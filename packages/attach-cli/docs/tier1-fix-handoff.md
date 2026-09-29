# Fix handoff — tier-1 findings (#1, #2, #3) + minimal #8

Plan date: 2026-09-28. Branch `dpetri/devicetree`, uncommitted working tree (same state as `code-review-handoff.md`).
Findings are numbered as in `code-review-handoff.md`. Line numbers refer to the working tree at planning time and may drift.

## Status

- Nothing implemented yet. This document is the agreed plan.
- All three findings were re-confirmed live with the built CLI in `/tmp/cr-review/sandbox` (Pi 4 base, `pmd-rpi-intz`).
  For example, `suggest type adc/rdy-gpios` gives `enum[gpio, expgpio]` (so a one-step `gpio 21 …` is rejected), and
  `suggest type adc/reset-gpios` gives "not found in adi,ad7124-8 binding" (so it goes down the untyped path).

## Decisions (agreed with the user)

1. **`update` becomes an informed raw write.** It knows the *shape* it is writing (flag / strings / cells) and guarantees
   the result parses:
   - macros become their numbers;
   - `gpio` becomes `&gpio` when that label exists in the base tree or overlay;
   - an unknown word in a cell value is **rejected** with a clear message.
2. **The binding is only a shape hint in `update`.** It never causes a rejection. A missing binding, or one that can't
   be interpreted, still allows the write: the user or agent may know better, and `validate` catches mistakes afterwards.
3. **`suggest value` does the heavy lifting.** When linux/dt-schema are configured it resolves the node's binding and state,
   and annotates each suggestion with why it wouldn't fit. Suggestions are annotated, never dropped. Accepted cost: one
   binding parse per call, including `update --with <TAB>` completion.
4. **Minimal #8 is included** (surface `ValueSuggestion.note`), otherwise the new annotations never reach the caller.

Background: attach-lib's parser only accepts parenthesised cell expressions (`Parser.ts:955`). A bare `gpio` or
`IRQ_TYPE_EDGE_FALLING` inside `<…>` is therefore unparseable, which is where `Update would produce an unreadable overlay`
comes from.

---

## 1. `update` → informed raw write

`packages/attach-cli/src/commands/update/command.ts`

Replace the typed `set_property` path and `build_untyped_property` with a single builder:

```ts
type ShapeHint = "flag" | "strings" | "cells" | undefined;
build_raw_property(raw: string, name: string, hint: ShapeHint, is_label: (name: string) => boolean): DTProperty | undefined | { error: string }
```

**Deriving `hint` from the binding** (`shape_hint(definition)`):

| Binding definition | Hint |
|---|---|
| `boolean` | `flag` |
| `string_array`, `enum_array`/`fixed_index` whose enum type is all `STRING` | `strings` |
| `integer`, `enum_integer`, `const`, `number_array`, `array`, `matrix`, other `enum_array`/`fixed_index` | `cells` |
| `generic`, `object`, not in binding, binding unresolvable | `undefined` |

Binding resolution stays as it is today (`resolve_node_binding` + `narrow_and_populate`). Failures only emit the existing
`diagnostic(...)` and fall through to `hint = undefined`.

**Building the property:**
- **`flag`, or `true`/`false` with no hint:** keep today's add/remove semantics.
- **`strings`:** split on whitespace only; commas are preserved, so `adi,ad7124-8` stays one string. Written as a string or string list.
- **`cells`:** rows are separated by `,` and cells by whitespace (reuse `parse_value`/`parse_token`). Each token is resolved as:
  - number → number;
  - `GPIO_*`/`IRQ_TYPE_*` (the existing `ALL_MACROS`) → its numeric value;
  - `label` or `&label` found in the base tree (`base_dt.get_node_by_label`) or the overlay (`overlay.find_node({kind:"label"})`) → `tag_label`;
  - anything else → `{ error: "'foo' is not a number, a known macro, or a label in the base tree/overlay" }`.
- **No hint:** if every token resolves as a cell token → cells. If no token does → strings (so `status --with okay` stays a
  string). A mix of cell tokens and unknown words → the same error as above.

**What this fixes:**
- **#1:** `update spi0/cs-gpios --with "gpio 8 GPIO_ACTIVE_LOW,gpio 7 GPIO_ACTIVE_LOW,…"` writes
  `<&gpio 8 1>, <&gpio 7 1>, …` whatever the binding typing says.
- **#2:** `reset-gpios`, `interrupts-extended` and `rdy-gpios` can be written in one step, and nothing becomes `"gpio"` or `<gpio 19 IRQ_…>`.

The existing reparse guard (`Update would produce an unreadable overlay`) stays as a last line of defence.

**Moving the validation logic:** `set_property`, `set_array_property`, `build_row_cells`, `enum_accepts`,
`macro_enum_values` and `to_cell_value` move unchanged (with their existing tests) to a new
`packages/attach-cli/src/value-check.ts`. There they become the dry-run checker for `suggest value`:

```ts
check_value(parsed, definition): true | string
```

It is `set_property` run against a scratch node.

## 2. `suggest value` → binding- and state-aware

`packages/attach-cli/src/commands/suggest/command.ts` (`suggest_value`, currently ~218)

**Shared target resolution.** Extract `update`'s target resolution (current lines 75–111: `found` / `base_reference` /
`is_base_target` / `binding_node` / `binding_parent` / `parent_name`) into a helper in `src/utilities.ts`, e.g.
`resolve_write_target(overlay, base_dt, node_identifier)`. Both `update` and `suggest value` use it.

**Flow:**
1. **Placement and data.** Compute placement as today. Pass the node's real data into the stack instead of `"{}"`:
   `dt_to_validator_input(binding_node, binding ?? empty)`, serialised with `bigIntReplacer`.
2. **Board-layer suggestions.** `stack.suggest_values(...)` as today.
3. **Binding check.** If `linux` and `dtSchema` are configured and exist (use `resolved.config`; they stay optional so
   board-only use still works), resolve the binding once. For each suggestion:
   - Build a *preview* node: a `structuredClone` of `binding_node` with the property replaced by
     `build_raw_property(format_value(rows), …)`.
   - Run `narrow_and_populate(preview)`, so `*-gpios` typing sees the controller from the candidate value itself.
   - Look up the definition, then annotate:
     - not in binding → `not defined by <origin>; validate may reject it`;
     - `generic`/`object` → no note, since the binding doesn't constrain it;
     - `check_value` fails → its message as a note, e.g. `interrupts` under an inherited GIC gives "accepts between 3 and 3 items".
4. **Messages.** If no binding check ran, append `; not checked against a binding (<reason>)` to the message. `severity`
   stays as it is.

The binding checker lives in a small testable function:

```ts
annotate(suggestions, type_for: (preview: DTNode) => ResolvedProperty | undefined | "unresolved")
```

### Board layer: actionable interrupt-parent note

`packages/attach-lib/src/Intelligence/board/layer.ts`, `interrupts` branch (~105).

Compute the node's effective interrupt-parent:
- first `JSON.parse(context.data)["interrupt-parent"]` (unwrapping `["gpio"]`);
- otherwise walk the base-tree ancestors of `placement.parent_path` for an `interrupt-parent` property (use `cell_extract_first_value`).

If the result isn't the board controller, set `note: "needs interrupt-parent = <&gpio> (currently <&X>); set it first"`.
This works without a binding. The existing open-drain note is combined with it using `; `.

### `*-gpios` typing with more than one row

`packages/attach-lib/src/Intelligence/query.ts`, the `-gpios` branch (~493). Without this change the checker would falsely flag `cs-gpios`.

- Read the controller from `data` in any of these shapes: `"gpio"`, `["gpio"]`, `["gpio", 21, 1]`, `[["gpio", 8, 1], …]`.
  The first string cell of the first row is the controller. Today nested data falls through and stays `generic`,
  which is where "couldn't be interpreted" comes from.
- Row bounds come from the binding (`array`/`matrix` min/max; `generic` → 1..unbounded). `cs-gpios` in
  `spi-controller.yaml` has no `maxItems`.
- If max rows is 1: keep today's shapes (`enum_array` phandle, or a `fixed_index` of phandle + cells), so the
  extension's forms don't change (the extension consumes this via `populate_*`).
- If max rows is greater than 1: use `matrix` with one row template: a `fixed_index` of [phandle, (#gpio-cells − 1)
  numbers, GPIO macro] once the controller is known, otherwise a `[phandle]`-only row (same pattern as `dmas`).

## 3. Placement over all fragments

`packages/attach-lib/src/Intelligence/layers/placement.ts` (`placement_from_overlay`, ~69)

- Make `DeviceTreeOverlay.get_fragment_root_path` public (`packages/attach-lib/src/Devicetree/DevicetreeOverlay.ts:435`).
- Replace the single `overlay.find_node(parent_path)` lookup with a pass over `overlay.get_fragments()`, in order, for
  each fragment with root `R` and `__overlay__` node `O`:
  - `R === parent_path` → every child of `O` is a child patch.
  - `R` is an ancestor of `parent_path` → descend `O` along the relative segments (exact `get_full_node_name` match).
    If found, its children are child patches.
  - `parent_path_of(R) === parent_path` (the fragment targets a sibling directly, e.g. `target = <&spidev0>`) → `O`'s
    *properties* patch the child named `basename(R)`.
- Patches merge over the base children with the existing rule (overlay properties win, later fragments win). The
  disabled filter and own-name exclusion stay as they are.

## 4. Minimal #8

`packages/attach-cli/src/commands/suggest/command.ts:195` (`to_suggestion`), `packages/attach-cli/src/protocol/types.ts:108`

- Add optional `note?: string` to the protocol `Suggestion`.
- `to_suggestion` sets `note`, and appends ` (<note>)` to `display_string` unless the display already contains it.
- Human output already prints `display_string`.
- `suggest type` gets the same notes, since it uses `to_suggestion`.

## 5. Docs

- **`SKILL.md`:**
  - Remove the two-step `*-gpios` recipe (~667).
  - `update` section (~546): explain that values are written as given, with macros turned into numbers, labels into
    `&label`, and unknown words rejected; the binding only picks string vs cells; run `validate` afterwards.
  - Explain how to read `suggest value` notes (`needs interrupt-parent…`, `not defined by…`).
  - Fix the error table row `Property in binding demands numbers` (~887): `update` no longer emits it.
  - Line 40, `suggest value` needs: `linux`/`dt-schema` are optional and enable the binding check.
- **`packages/attach-cli/CLAUDE.md`:** update the "update --with value format" section (label/macro resolution, the
  strings hint keeps commas, the reject rule) and the board section (binding check in `suggest value`).

---

## Regression tests

Inline `import.meta.vitest` blocks, per package convention; at least one per finding.

- **update (#1/#2):**
  - `build_raw_property`: macros become numbers; base and overlay labels become `&label`; `&gpio` is accepted.
  - An unknown word gives an error.
  - The `strings` hint keeps `"gpio"` as a string and `adi,ad7124-8` intact.
  - With no hint, `okay` becomes a string.
  - Flags work as before.
- **#1 end to end:** base with `gpio` + `spi0` (with `cs-gpios = <&gpio 8 1>, <&gpio 7 1>`). Place the 6-row value from
  `board_layer`'s `cs-gpios` suggestion, `print()`, reparse, and assert `<&gpio 8 1>, <&gpio 7 1>, <&gpio 20 1>…`.
- **query.ts:**
  - nested data typed as a matrix of 3-item rows;
  - `maxItems: 1` stays `fixed_index`;
  - `"gpio"` string data is typed (no longer stays `generic`).
- **value-check / annotate (#2):**
  - `interrupts` with the GIC inherited gets a note;
  - `reset-gpios` missing from the binding gets "not defined by";
  - a one-step `rdy-gpios` gets no note (preview typing);
  - multi-row `cs-gpios` gets no note.
- **board layer (#2):** interrupt-parent note present when inherited from the GIC, absent when `data` has `interrupt-parent: gpio`.
- **placement (#3):**
  - a sibling disabled via a `target = <&spidev0>` fragment is excluded;
  - a device in a second `&spi0` fragment is counted;
  - a fragment targeting an ancestor is descended.
- **#8:** `to_suggestion` carries `note` and appends it to the display once.

## Verification

1. `yarn workspace attach-lib test --run`, `yarn workspace attach-cli test --run`, `yarn build:attach-cli` (runs tsc).
2. Copy `/tmp/cr-review/sandbox` to a fresh directory with `config.toml` pointing at its own overlay, then replay the
   `code-review-handoff.md` repros with the new `dist/cli.js`:
   - **#1:** `suggest value spi0/cs-gpios`, then `update spi0/cs-gpios --with "<that value>"`, then `read spi0/cs-gpios`.
   - **#2:** for an ad7124 at reg 0:
     - `update` of `interrupts-extended`, `reset-gpios` and `rdy-gpios` with the suggested values in one step succeeds;
     - `suggest value ad7124/interrupts` before `interrupt-parent` is set shows the note;
     - `suggest value ad7124/reset-gpios` shows "not defined by adi,ad7124-8 binding".
   - **#3:** `disable --node spidev0`, then `suggest value ad7124/reg` no longer shows `in use by spidev@0`. A `dac@2` in a
     second `&spi0` fragment marks CS2 in use.
   - `update ad7124/foo --with "bogus 1"` is rejected with the unknown-word message.
3. `validate`, then `build` (dtc) on the resulting overlay to confirm it compiles.
4. Spot-check `update … --with <TAB>` completion still returns values; it is slower now because of the binding parse.

Watch out for the issue listed under "Outside this diff" in `code-review-handoff.md`: overlays written in the
`&label { }` form print as `target = <&&spi0>`. Use `fragment@N` overlays when reproducing.

## Out of scope

Tier 2+ findings other than #8, e.g. #9 (singular `*-gpio` retyping) and #11 (`<0>` placeholders for chip-select gaps).
With `update` as a raw write, #11's `<0>` rows already write fine once the board layer emits them.
