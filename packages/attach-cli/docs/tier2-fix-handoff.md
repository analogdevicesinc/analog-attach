# Fix handoff — tier-2 findings (#4, #6, #9, #10, #11)

Plan date: 2026-09-29. Branch `dpetri/devicetree`, uncommitted working tree (tier-1 fixes applied, see `tier1-fix-handoff.md`).
Findings are numbered as in `code-review-handoff.md`. Line numbers refer to the working tree at planning time and may drift.

## Status

- Nothing implemented yet. This document is the plan.
- Re-checked against the code after tier 1. Not re-run live: `/tmp/cr-review` no longer exists (see Verification for a
  fresh sandbox).
- **#9 is partly fixed by tier 1.** `update rf/reset-gpio --with "gpio 12 GPIO_ACTIVE_LOW"` now writes: the binding's
  `number[]` gives a `cells` hint, and `gpio` resolves to `&gpio`. Still broken:
  - `suggest type` reports `number[]`;
  - `check_value` puts a false `demands numbers` note on the board suggestion (`value-check.ts:72`).
- **#11 needs a checker change as well as a board-layer change:**
  - `set_property`'s matrix branch checks each row against `values[index] ?? values[0]` (`value-check.ts:239`), so a
    `<0>` row fails the 3-item check and gets a false note;
  - `extract_gpio_controller` (`query.ts:121`) only reads the first row, so a leading `<0>` loses the controller.

## Decisions

1. **One GPIO-property predicate**, taken from dt-schema's `gpio-consumer.yaml` (`(?<!,nr)-gpios?$`, plus `gpios`/`gpio`).
   Both `query.ts` retyping and the board layer use it.
2. **Signal kind comes from name tokens, as an ordered list.** Interrupt-style names offer interrupt lines first, and
   general-purpose lines stay as a fallback. Reset names offer only reset lines, as today.
3. **Dual-bus slots stay as one row per (slot, bus); they are not deduplicated.** Both placements are real, so each row's
   display names its own bus and `reg`. The message counts distinct slots.
4. **An unwired `reg` is flagged but not narrowed.** Slot fallback (every slot on the bus) stays; only the message changes.
   `validate` and `build` stay board-unaware.
5. **`<0>` is a valid phandle-array hole.** The kernel's `of_parse_phandle_with_args` treats phandle 0 as an empty entry,
   so the checker accepts a `[0]` row wherever the row template starts with a phandle.

---

## 1. #9 — shared `is_gpio_property`

`packages/attach-lib/src/Intelligence/query.ts`

- Add and export:
  ```ts
  export function is_gpio_property(key: string): boolean {
      return key === "gpios" || key === "gpio" || /(?<!,nr)-gpios?$/.test(key);
  }
  ```
  Export it from `src/Intelligence/index.ts`.
- Use it in the retype branch (~503), replacing `endsWith("-gpios") || === "gpios" || === "gpio"`.
  - Now retyped: `reset-gpio`, `enable-gpio`, `wlf,reset-gpio`, and similar singular names.
  - Untouched: `vendor,nr-gpios` counts.
- `board/layer.ts` (~167): replace the local `is_gpio_property` expression with the shared one.

## 2. #4 — GPIO property → signal kinds

`packages/attach-lib/src/Intelligence/board/layer.ts`, GPIO branch of `device_values` (~167)

Replace the reset/gpio split with `gpio_signal_kinds(property): SignalKind[]`:
1. Strip any vendor prefix (`adi,`) and the `-gpio(s)` suffix, then split on `-`.
2. If any token matches `/^n?(reset|rst)(b|n)?$/` → `["reset"]`.
3. Otherwise, if any token matches `/^n?(irq|int\d*|intr|interrupt|d?rdy|ready|alert|busy)$/` → `["interrupt", "gpio"]`.
4. Otherwise → `["gpio"]`.

Emit `connected_signals(slots, kind)` for each kind in order.

Polarity when `active` is unknown: interrupt-like and reset properties offer `GPIO_ACTIVE_LOW` first; everything else
offers `GPIO_ACTIVE_HIGH` first (unchanged). The open-drain note is carried as today.

Effect:
- ad7124 at spi0 reg 2: `rdy-gpios` → `gpio 19 GPIO_ACTIVE_LOW — spi_pmod1.int`, then `… HIGH …`.
- At reg 0: GPIO19 (spi_pmod1.int) is listed before GPIO22 (quikeval.gpio).
- `irq-gpios` / `interrupt-gpios` on i2c1 list the int lines and psm.alert.

## 3. #6 — distinct rows for dual-bus slots

**Lib** (`board/layer.ts`)
- Add and export `describe_placement(board, slot, bus_name)`:
  - on the slot's primary bus → `quikeval — spi0 reg 0 (SW1 selects i2c1 instead); gpio GPIO22`;
  - on its `alt_bus` → `quikeval — i2c1 via SW1; gpio GPIO22`, with no `reg` (the address comes from the device);
  - for a single-bus slot → the same text as `describe_slot`.
- `suggest_placement` (~222) uses it for `display`. `describe_slot` stays as it is, for the plain slot list.

**CLI** (`src/commands/suggest/command.ts`, `suggest_board_slot` ~435)
- Keep `value = slot id`. The display now carries the bus (for `add --to`) and the `reg`.
- Message: `N placement(s) in M slot(s) on <board> can host <compatible>`, where M counts distinct slot ids. Extract it
  into a small function so it can be unit-tested.

## 4. #10 — correct `slot_message`

**Lib**
- `SlotInference` (`board/slots.ts`) gains `unwired_reg?: bigint`. It is set when the bus has chip selects, `reg` is
  defined, and no `chip_selects` entry has that `reg`. The `slots` fallback is unchanged.
- `BoardLayer` gains `bus_of_node(devicetree, node_path): BoardBus | undefined` (`bus_at_path` over
  `resolve_bus_paths`). Reuse it in `suggest_values` (~197).

**CLI** `slot_message` (`src/commands/suggest/command.ts:212`), evaluated in this order:
1. **The node is itself a board bus** → info: `…; spi0 is a bus on <board>; the board provides cs-gpios for it`. Use
   `no values for it` instead when the bus has no chip selects.
2. **The parent is not a board bus** → unchanged.
3. **`unwired_reg`** → warn:
   `…; reg 7 is not a chip select wired on spi0 (board wires 0, 1, 2, 3, 4, 5); use one of those or check the wiring`.
4. **No slots on the bus** → warn: `…; i2c0 has no slots on <board> (reserved: 0x50 HAT ID EEPROM)`. The part in brackets
   appears only when the bus has reserved addresses.
5. **Narrowed or ambiguous** → unchanged.

## 5. #11 — `<0>` placeholders in `cs-gpios`

- **`board/layer.ts` `bus_node_values` (~110).** Emit rows for reg `0..max(cs.reg)`, with `[0n]` for each gap.
  - Display: `4 chip selects — GPIO8, GPIO7, <0>, GPIO18`.
  - Note: `CS2 not wired (<0> placeholder)`, listing every gap.
  - The bundled board (CS 0–5) is unchanged.
- **`query.ts` `extract_gpio_controller` (~121).** For nested data, use the first row whose first cell is a string.
- **`attach-cli/src/value-check.ts`, matrix branch of `set_property` (~238).** Accept a row that is exactly `[0n]` as a
  hole, emitted as `<0>`, when that row's template (`fixed_index` or `enum_array`) starts with a PHANDLE enum. Any other
  template still rejects it.
- `update` needs no change. `format_value` gives `…,0,…`, and `build_raw_property` with the `cells` hint writes `<0>`.

## 6. Docs

- **`code-review-handoff.md`:** add #4, #6, #9, #10, #11 rows to the fix-status table and mark each finding FIXED, in the
  same style as tier 1.
- **`SKILL.md`, board workflow step 2:** the `board-slot` display names the bus (`--to`) and the chip select (`reg`). A
  slot listed twice can be switched between buses: ask which position its switch is in.
- **`SKILL.md`, "How to read `suggest value`":**
  - interrupt-style `*-gpios` (`rdy`, `irq`, `int`, …) offer the slot's interrupt line;
  - the `reg … is not a chip select wired` warning means pick a wired chip select;
  - `<0>` rows in `cs-gpios` are intentional placeholders.
- **`packages/attach-lib/CLAUDE.md`:** one line each on the name-token mapping and `unwired_reg`, only if the board
  section describes those details.

---

## Regression tests

Inline `import.meta.vitest` blocks, per package convention.

- **#9 (query.ts):**
  - `is_gpio_property` table: true for `gpios`, `gpio`, `reset-gpio`, `cs-gpios`; false for `vendor,nr-gpios`,
    `gpio-controller`;
  - `reset-gpio` with `["gpio"]` data is typed as a 3-item `fixed_index`.
- **#4 (layer.ts):**
  - `rdy-gpios` at spi0 reg 2 gives GPIO19 LOW then HIGH, from `spi_pmod1.int`;
  - at reg 0, GPIO19 comes before GPIO22;
  - `irq-gpios` / `interrupt-gpios` / `adi,int1-gpios` on i2c1 include psm.alert with the open-drain note;
  - `nreset-gpios` gives the reset line only;
  - the existing `enable-gpios` test still passes.
- **#6:**
  - lib: `suggest_placement` with spi0 and i2c1 candidates has quikeval once per bus, with the two displays;
  - CLI: the message helper counts distinct slots.
- **#10:**
  - `slots.ts`: `unwired_reg` is set for reg 7 and unset for reg 2;
  - CLI `slot_message` block (add `i2c0` with reserved addresses to its board YAML): cases for the bus node, the slotless
    bus and the unwired reg.
- **#11:**
  - `layer.ts`: chip selects `{0, 1, 3}` give rows `[…8…]`, `[…7…]`, `[0n]`, `[…18…]` plus the note, and the bundled
    fixture gets no note;
  - `query.ts`: `[[0], ["gpio", 7, 1]]` still gets the matrix typing;
  - `value-check`: a `<0>` row passes against a phandle template and fails against a number template;
  - end to end, next to tier 1's 6-row round-trip in `update/command.ts`: format → parse → `build_raw_property` →
    print → reparse gives `<&gpio 8 1>, <&gpio 7 1>, <0>, <&gpio 18 1>`.

## Verification

1. `yarn workspace attach-lib test --run`, `yarn workspace attach-cli test --run`, `yarn build:attach-cli` (runs tsc).
2. Set up a fresh sandbox:
   - a `/tmp/tier2/` directory whose `.attach-linux/config.toml` points at `~/linux`, `~/dt-schema`, `~/rpi-4.dts`, the
     bundled `pmd-rpi-intz` board, and a new `fragment@N`-form overlay. Avoid the `&label { }` form: it prints as
     `target = <&&spi0>` (see "Outside this diff" in `code-review-handoff.md`).
   - Run `node <repo>/packages/attach-cli/dist/cli.js` from there.
3. Replay the repros:
   - **#4:** add `adi,ad7124-8` on spi0 with `reg` 2. `suggest value ad7124/rdy-gpios` offers `gpio 19 …` and the message
     says `narrowed to spi_pmod1`. At reg 0, GPIO19 comes before GPIO22.
   - **#6:** `suggest board-slot adi,adxl355` lists quikeval once per bus with distinct displays, and the message counts
     6 slots.
   - **#9:** add `atmel,at86rf233` on spi0 at reg 1, then:
     - `suggest type rf/reset-gpio` shows the tuple (phandle, number, macro);
     - `suggest value rf/reset-gpio` has no `demands numbers` note;
     - `update rf/reset-gpio --with "gpio 12 GPIO_ACTIVE_LOW"` succeeds.
   - **#10:**
     - `suggest value spi0/reg` gives the bus-node info message;
     - a device on `&i2c0` gives the no-slots warning;
     - `reg` 7 on spi0 gives the unwired warning.
   - **#11:** use a copy of the board with chip selects `{0, 1, 3}`. `suggest value spi0/cs-gpios` shows the `<0>` row and
     its note. Then `update spi0/cs-gpios --with "<value>"`, and `read spi0/cs-gpios` shows
     `<&gpio 8 1>, <&gpio 7 1>, <0>, <&gpio 18 1>`.
4. `validate`, then `build` (dtc), on the resulting overlay.

## Out of scope

- #5, #7, #12, #13, #14, #15, and the lower-severity and cleanup lists in `code-review-handoff.md`.
- Board-aware `validate`: an unwired `reg` is reported only by `suggest value` (decision 4).
- Parser-side rejection of chip-select gaps: gaps are valid now that they emit `<0>`.
