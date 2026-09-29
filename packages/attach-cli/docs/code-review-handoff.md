# Code review handoff — board-description intelligence layer

Review date: 2026-09-28. Branch `dpetri/devicetree`, uncommitted working tree (30 files; no commits beyond upstream).
Scope: the board-description layer — `attach-lib/src/Intelligence/board/`, `attach-lib/src/Intelligence/layers/`,
`attach-cli/src/board.ts`, `suggest value` / `suggest board-slot`, completion changes, and related edits.

## Status at review time

- `tsc` clean; attach-lib 282 tests and attach-cli 98 tests pass. **None of the findings below are caught by existing tests.**
- Most bugs were reproduced end to end with the freshly built CLI against the Pi 4 base tree (`~/rpi-4.dts`) and the
  bundled `pmd-rpi-intz` board. The completion bug was reproduced in real bash 5.3 and zsh 5.9 via pty.
- Nothing in the repo was modified by the review. Reproduction sandboxes and scripts are in `/tmp/cr-review/`
  (`diff.patch` is the reviewed diff; `v1`…`v19` are per-finding verification sandboxes). `/tmp` may not survive a reboot.
- Line numbers refer to the working tree at review time and may drift.

## Fix status (tier-1 + minimal #8, tier-2)

Implemented per `docs/tier1-fix-handoff.md`, `docs/tier2-fix-handoff.md` and `docs/tier3-fix-handoff.md`. Tests: attach-lib 305 (was 301), attach-cli 150 (was 137), tsc clean, build clean.

| # | Finding | Status |
|---|---------|--------|
| **1** | Bus-node `cs-gpios` suggestion can never be written | **Fixed.** `update` now uses `build_raw_property` (informed raw write): macros → numbers, labels → `&label`, binding only provides a shape hint. Multi-row `*-gpios` typed as `matrix` when `maxItems > 1` (`query.ts`). End-to-end test: 6-row cs-gpios round-trips through format → parse → build → print → reparse. |
| **2** | `suggest value` ignores binding and current state | **Fixed.** `suggest_value` now passes real node data (`dt_to_validator_input`) to the intelligence stack and annotates each suggestion with binding-check notes via `check_value`. Interrupt-parent note added to board layer when inherited controller differs from board controller. |
| **3** | Only first overlay fragment considered for siblings | **Fixed.** `placement_from_overlay` walks all fragments via `get_fragments()` loop with three cases: root = parent, root is ancestor (descend), root is sibling (property patch). `get_fragment_root_path` made public. Tests: disabled sibling in separate fragment excluded, device in second `&spi0` fragment counted, ancestor fragment descended. |
| **4** | GPIO property → signal kinds wrong | **Fixed.** `gpio_signal_kinds(property)` maps name tokens to `SignalKind[]`: reset → `["reset"]`, interrupt-like (rdy, irq, int, alert, …) → `["interrupt", "gpio"]`, other → `["gpio"]`. Interrupt and reset properties offer `GPIO_ACTIVE_LOW` first. Tests: rdy-gpios, irq-gpios, nreset-gpios, enable-gpios. |
| **6** | Dual-bus slots collapsed into one row | **Fixed.** `describe_placement(board, slot, bus_name)` gives bus-specific display. `suggest_placement` emits one row per (slot, bus). CLI `placement_message` counts distinct slots separately from placements. Tests: quikeval listed once per bus with distinct displays. |
| **8** | `ValueSuggestion.note` dropped | **Fixed (minimal).** `note?: string` added to protocol `Suggestion`. `to_suggestion` surfaces `note` and appends `(note)` to `display_string` when not already present. Tests: note carried, dedup, absent. |
| **9** | Singular `-gpio` names not retyped | **Fixed.** Shared `is_gpio_property(key)` predicate in `query.ts` (exported from `Intelligence/index.ts`) uses `(?<!,nr)-gpios?$` regex. Used in both `query.ts` retype branch and `board/layer.ts`. Tests: table of true/false matches, singular `reset-gpio` typed as `fixed_index`. |
| **10** | `slot_message` missing cases | **Fixed.** 5-case evaluation: bus node → unwired reg → slotless bus (with reserved addresses) → narrowed → ambiguous. `SlotInference.unwired_reg` set when bus has chip selects but reg doesn't match any. `BoardLayer.bus_of_node` added. Tests: all 5 cases. |
| **11** | `<0>` placeholders in `cs-gpios` | **Fixed.** `bus_node_values` emits `[0n]` rows for gaps with note. `extract_gpio_controller` skips `<0>` rows. `check_value` matrix branch accepts `[0n]` as a phandle-array hole. End-to-end: gapped cs-gpios round-trips through format → parse → build → print → reparse with `<0>`. |
| **5** | Multi-word `--with` completion dead-ends | **Fixed.** `shell_dequote` added to `complete.ts`; applied to all words at the top of `run_complete`. Bash stub replaced `compgen -W` re-filter with direct `COMPREPLY` assignment and conditional `printf %q` quoting. Tests: dequote table, quoted-prefix matching, stub no longer contains `compgen -W`. |
| **7** | Unreadable board file throws | **Fixed.** `load_board` wraps resolve+read in try/catch; returns `cannot read …: EACCES` instead of throwing. Test: `chmod 000` file returns error string. |
| **12** | Broken board invisible in JSON | **Fixed.** `optional_board_layer` returns `{ layer?, board_error? }`. `suggest value` uses `no_layer_message` for warn severity. `suggest type` appends `board_error` to message with warn. `suggest board-slot` now `respond_fail`s instead of returning silently. Tests: `no_layer_message` cases, `optional_board_layer` with nonexistent path. |
| **13** | Board parser ignores unknown keys | **Fixed.** `known_keys` validation added to parse.ts for root, bus, chip-select, slot, and signal maps. Hyphenated spellings get `did you mean` hints. YAML merge keys (`<<`) supported via `{ merge: true }`. Tests: `chip-selects` → `chip_selects` hint, `alt-bus` → `alt_bus` hint, unknown root key, merge-key slot inherits signals. |
| **14** | Placement leaks into pattern_properties | **Fixed.** `populate_parsed_binding` passes layers without placement for pattern properties. Test: top-level `reg` gets board suggestions, pattern `reg` gets none. |
| **15** | `pwms` phandle off-by-one | **Fixed.** `minItems`/`maxItems` changed to `Number(new_length) + 1`. Test: `#pwm-cells = <2>` produces row with 3 prefixItems and min/max 3. |

## Suggested order

1. **#1, #2, #3** — they break the SKILL.md board workflow directly (suggested values can't be applied, or the free/in-use state is wrong).
2. **#4, #6, #9, #10, #11** — wrong or missing suggestions.
3. **#7, #12, #13** — error handling / silent degradation.
4. **#5, #8** — completion and output (lost warning).
5. **#14, #15** — latent.

Numbering here follows the reviewer's severity order, which differs slightly from the earlier chat summary
(there, "singular `*-gpio`" was #3 and "first fragment only" was #4; here they are #9 and #3).

When fixing, add a regression test per finding (inline `import.meta.vitest` blocks per package convention).

---

## Confirmed findings

### 1. Bus-node `cs-gpios` suggestion can never be written — FIXED
`packages/attach-lib/src/Intelligence/board/layer.ts:85`

**Fix:** `update` replaced with `build_raw_property` (informed raw write) in `src/commands/update/command.ts`. Old `set_property`/`build_untyped_property` path removed; validation logic moved to `src/value-check.ts` as `check_value` (dry-run checker for `suggest value`). `query.ts` `*-gpios` branch now uses `extract_gpio_controller` to read nested data shapes and emits `matrix` type when `maxItems > 1`. New files: `src/value-check.ts`. Regression tests: `build_raw_property` macros/labels/errors, end-to-end 6-row cs-gpios round-trip, `query.ts` nested-data/maxItems-1/string-data tests.

~~SKILL.md board-workflow step 4 tells the AI to apply this suggestion, but `update` can't write it.~~ `*-gpios` properties
~~are only typed as a single-row `enum_array` / `fixed_index` (or left generic), and `set_property` rejects multi-row input.~~

- Pi 4 base: spi0 already has `cs-gpios = <&gpio 8 1>, <&gpio 7 1>`. `update spi0/cs-gpios --with "gpio 8 GPIO_ACTIVE_LOW,gpio 7 GPIO_ACTIVE_LOW,..."`
  (the exact `suggest value spi0/cs-gpios` output) ~~fails with `Property 'cs-gpios' couldn't be interpreted!`~~ now writes `<&gpio 8 1>, <&gpio 7 1>, …` as expected.
- ~~Base without cs-gpios: step 1 writes `cs-gpios = <&gpio>;`, then the full value is rejected with `does not accept comma-separated rows`.~~
  The two-step recipe is no longer needed; the full value is accepted in one step.
- ~~Result: a truncated `cs-gpios` in the overlay that would drop CE0/CE1 if deployed; devices on CS2–CS5 can't be finished.~~

### 2. `suggest value` ignores the node's binding and current state — FIXED
`packages/attach-cli/src/commands/suggest/command.ts:247`

**Fix:** `suggest_value` now resolves the node's binding via `resolve_write_target` + `resolve_binding_for_data`, passes real node data (`dt_to_validator_input`) to the intelligence stack, and annotates each suggestion with binding-check notes via `annotate_suggestions` → `check_value`. Board layer adds `effective_interrupt_parent` note when the inherited controller differs from the board's. SKILL.md two-step `*-gpios` recipe removed. New imports in suggest: `dt_to_validator_input`, `build_raw_property`, `shape_hint`, `parse_value`, `check_value`, `resolve_write_target`.

~~It queries the board layer with data `"{}"`, so it offers `--with` strings (bare labels and macros) that `update` can only
write when the binding types those cells — often it doesn't.~~

- ~~`adi,ad7124-8` at spi0 reg 0:~~ `update` now uses `build_raw_property` which resolves labels and macros directly, so `interrupts-extended` and `reset-gpios` values write correctly in one step.
- ~~The two-step `*-gpios` recipe leaves a stray `reset-gpios = "gpio";`.~~ One-step writes now work; two-step recipe removed from SKILL.md.
- `interrupts` before `interrupt-parent` is set: `suggest value` now annotates with `needs interrupt-parent = <&gpio> (currently <&gic>); set it first`.
- ~~A binding-defined `rdy-gpios` pasted in one step is rejected~~ `build_raw_property` with a `cells` hint resolves the label and macros without going through the binding's enum check.

### 3. Only the first overlay fragment on a bus is considered for siblings — FIXED
`packages/attach-lib/src/Intelligence/layers/placement.ts:69`

**Fix:** `placement_from_overlay` rewritten to walk all fragments via `overlay.get_fragments()`. Three cases handled per fragment: root = parent path (children are patches), root is ancestor of parent (descend `__overlay__`), root's parent = parent path (sibling property patch). `DeviceTreeOverlay.get_fragment_root_path` made public. Regression tests: sibling disabled via separate `target = <&spidev0>` fragment excluded, device in second `&spi0` fragment counted, fragment targeting `/soc` ancestor descended.

~~`placement_from_overlay` collects siblings only from the first fragment rooted at the parent path. Fragments that target
a sibling directly, and devices in a second fragment on the same bus, are ignored.~~

- `disable --node spidev0` writes `fragment@1 { target = <&spidev0>; __overlay__ { status = "disabled"; }; }`. `suggest value ad7124/reg` now correctly excludes `spidev@0` from siblings.
- A `dac@2` in a second `target = <&spi0>` fragment now appears as a sibling, so its chip select is flagged as in use.

### 4. GPIO property → signal kind mapping is name-only and too narrow — FIXED
`packages/attach-lib/src/Intelligence/board/layer.ts:125`

**Fix:** `gpio_signal_kinds(property)` in `board/layer.ts` strips the vendor prefix and `-gpio(s)` suffix, then maps name tokens to an ordered `SignalKind[]`: reset/rst → `["reset"]`, interrupt-like (irq, int, intr, rdy, ready, alert, busy) → `["interrupt", "gpio"]`, other → `["gpio"]`. `device_values` iterates each kind in order, so interrupt lines are offered first. Interrupt-like and reset properties offer `GPIO_ACTIVE_LOW` first (matching typical hardware). Regression tests: rdy-gpios at reg 2 gives GPIO19 LOW then HIGH, rdy-gpios at reg 0 gives GPIO19 before GPIO22, irq-gpios includes psm.alert with open-drain note, nreset-gpios gives only the reset line.

~~`reset-gpio(s)` → reset; every other `*-gpios` → gpio. Interrupt-style lines (`rdy-gpios`, `irq-gpios`, `interrupt-gpios`)
never offer the slot's wired interrupt line.~~

- ~~ad7124 at spi0 reg 2 (narrowed to `spi_pmod1`, int line GPIO19; the binding example wires `rdy-gpios` to the IRQ):
  `suggest value ad7124/rdy-gpios` → info `Found 0 value(s) ...; narrowed to spi_pmod1`.~~ Now offers `gpio 19 GPIO_ACTIVE_LOW — spi_pmod1.int`.
- ~~At reg 0 it offers only `gpio 22 ... — quikeval.gpio`, another slot's unrelated line.~~ Now offers GPIO19 (interrupt) before GPIO22 (gpio).
- ~~adis16475 `irq-gpios` / `interrupt-gpios` return 0, which reads as "nothing wired".~~ Now includes interrupt lines and psm.alert.

### 5. Multi-word `--with` completion dead-ends after the first TAB — FIXED
`packages/attach-cli/src/commands/completion/command.ts:57`

**Fix:** `shell_dequote(word)` added to `complete.ts` — strips backslash escapes, single quotes, and double quotes (honouring `\"` `\\` `\$` `` \` `` inside double quotes). Applied to every word at the top of `run_complete`. Bash stub replaced `compgen -W "${values[*]}" -- "$cur"` with direct `COMPREPLY=( "${values[@]}" )` (the engine already filters). `printf %q` quoting skipped when `cur` starts with `"` or `'` (readline closes the quote itself). zsh and fish need no stub change. Regression tests: `shell_dequote` table (7 cases), quoted-prefix matching via `complete(["update", ..., '"ba'])`, stub no longer contains `compgen -W`.

~~The shell stubs pass the raw, still-escaped current word to `__complete`; both `filter_by_prefix` (`complete.ts:185`) and
`compgen` compare it against unescaped candidates. The new `printf %q` loop only fixes insertion.~~

- ~~`update ad7124/interrupts --with <TAB>` inserts the common prefix `19\ IRQ_TYPE_`. The next TAB sends `19\ IRQ_TYPE_`,
  which matches none of the 5 candidates → trigger type can never be completed.~~ `shell_dequote` strips the backslash escape and candidates match.
- ~~A quoted start (`"19 IRQ`) also returns nothing.~~ Dequoted to `19 IRQ` and candidates match.
- ~~Reproduced in bash 5.3 and zsh 5.9; fish works only by cycling its pager.~~

### 6. Dual-bus slots listed twice in `suggest board-slot` — FIXED
`packages/attach-cli/src/commands/suggest/command.ts:295`

**Fix:** `describe_placement(board, slot, bus_name)` added to `board/layer.ts` — gives bus-specific display text: primary bus shows `reg` and a switch note about the alt bus, alt bus shows `via <switch>`. `suggest_placement` emits one row per (slot, bus) pair instead of one per slot. CLI `placement_message` helper counts distinct slot ids separately from total placements: `"N placement(s) in M slot(s) on <board>"`. Regression tests: quikeval listed once per bus with distinct displays, message counts distinct slots.

~~`board_layer.suggest_placement` expands each candidate bus independently and `slots_on_bus` includes `alt_bus` slots, so a
dual-bus slot is emitted twice. The CLI keeps only `{slot, display}` and drops `parent` / `reg`, so the rows are identical.~~

- ~~`suggest board-slot adi,adxl355` → `7 slot(s) on PMD-RPI-INTZ` for a 6-slot board, listing
  `quikeval — spi0 reg 0 or i2c1 (SW1); gpio GPIO22` twice. SKILL.md step 2 says `add --to <slot's bus>`, but nothing
  distinguishes the spi0 row from the i2c1 row.~~ Now lists quikeval twice with distinct displays (one per bus), and the message says `6 placement(s) in 6 slot(s)`.

### 7. Unreadable board file throws out of every board-touching command — FIXED
`packages/attach-cli/src/board.ts:36`

**Fix:** `load_board` wraps both `resolve_board_reference` and `readFileSync` in try/catch. On failure, returns `cannot read ${path}: ${error.message}` — the function's existing "description or error string" contract. Callers need no change: `config.ts` validate hook already maps a string to a config error, and `optional_board_layer` already treats a string as "ignore the board" (now enhanced to surface it in the response — see #12). Temp-dir cleanup in existing test also fixed with `try/finally`. Regression test: `chmod 000` file returns `/^cannot read .*: EACCES/`, skipped under root.

~~`load_board` calls `fs.readFileSync` unguarded. Contradicts `optional_board_layer`'s "reported and ignored, not fatal" and
CLAUDE.md's "Commands never throw to the user".~~

- ~~Board pointed at a `chmod 000` YAML: `--json suggest value ad7124/interrupts`, `--json suggest type ad7124/reg`,
  `--json suggest board-slot`, and `config-set board <file>` each print a Node `EACCES` stack trace, exit 1, and write
  nothing to stdout. `suggest type` fails even though the board is optional for it.~~ All commands now return JSON with the error message.

### 8. `ValueSuggestion.note` dropped — open-drain pull-up warning lost — FIXED (minimal)
`packages/attach-cli/src/commands/suggest/command.ts:195`

**Fix:** `note?: string` added to protocol `Suggestion` type (`src/protocol/types.ts`). `to_suggestion` now passes `note` through and appends ` (<note>)` to `display_string` when the display doesn't already contain it. `suggest type` inherits the fix since it uses the same `to_suggestion`. Regression tests: `to_suggestion` carries note, dedup when note already in display, absent note yields no field.

~~`to_suggestion` keeps only `rows` and `display`.~~ The open-drain "needs a pull-up" caveat now reaches `suggest value`, `suggest type`, and completion output.

- Device under i2c1: `--json suggest value accel/interrupts` now includes `"note": "open-drain line: needs a pull-up"` and appends it to the display string.

### 9. Singular `*-gpio` names offered as GPIO tuples but not retyped — FIXED
`packages/attach-lib/src/Intelligence/board/layer.ts:122`

**Fix:** Shared `is_gpio_property(key)` predicate added to `query.ts` and exported from `Intelligence/index.ts`. Uses `(?<!,nr)-gpios?$` plus exact matches for `gpios` and `gpio` — matches dt-schema's `gpio-consumer.yaml`. Both `query.ts` retype branch and `board/layer.ts` GPIO branch now use it. Regression tests: `is_gpio_property` table (true for `gpios`, `gpio`, `reset-gpio`, `cs-gpios`, `wlf,reset-gpio`; false for `vendor,nr-gpios`, `gpio-controller`), singular `reset-gpio` typed as `fixed_index`.

~~The board layer treats `*-gpio` (e.g. `reset-gpio`) as GPIO properties, but `query_devicetree` (`query.ts:493`) only
retypes `-gpios`, `gpios`, and `gpio`.~~

- ~~`atmel,at86rf233` (binding declares `reset-gpio`) at spi0 reg 1: `suggest value rf/reset-gpio` offers
  `gpio 12 GPIO_ACTIVE_LOW` while `suggest type` reports `number[]`. Both `update rf/reset-gpio --with gpio` and
  `--with "gpio 12 GPIO_ACTIVE_LOW"` fail with `Update would produce an unreadable overlay`.~~ `suggest type` now shows the tuple (phandle, number, macro), `suggest value` has no `demands numbers` note, and `update` succeeds.

### 10. `slot_message` warnings are wrong in several cases — FIXED
`packages/attach-cli/src/commands/suggest/command.ts:213`

**Fix:** `slot_message` rewritten with a 5-case evaluation order: (1) the node is itself a board bus → info with cs-gpios status; (2) the parent is not a board bus → unchanged; (3) `unwired_reg` → warn with the wired chip selects; (4) no slots on the bus → warn with reserved addresses if any; (5) narrowed or ambiguous → unchanged. `SlotInference` gained `unwired_reg?: bigint`, set when the bus has chip selects, `reg` is defined, but no `chip_selects` entry has that `reg`. `BoardLayer` gained `bus_of_node(devicetree, node_path)` for case 1. Regression tests: all 5 cases.

~~Built from parent-bus inference only.~~

- ~~`suggest value spi0/reg` warns `parent of /soc/spi@7e204000 is not a bus on PMD-RPI-INTZ` — spi0 *is* the board bus.~~ Now says `spi0 is a bus on PMD-RPI-INTZ; the board provides cs-gpios for it`.
- ~~Device on `&i2c0` (declared for the EEPROM, no slots) → `ambiguous: 0 slots on i2c0 (), ask the user which slot the device is plugged into`.~~ Now says `i2c0 has no slots on PMD-RPI-INTZ (reserved: 0x50 HAT ID EEPROM)`.
- ~~Device with reg 7 on spi0 (board wires CS 0–5) → `ambiguous: 3 slots ... ask the user`; the unwired reg is never
  flagged, and validate/build pass.~~ Now says `reg 7 is not a chip select wired on spi0 (board wires 0, 1, 2, 3, 4, 5); use one of those or check the wiring`.

### 11. `cs-gpios` rows have no `<0>` placeholders for chip-select gaps — FIXED
`packages/attach-lib/src/Intelligence/board/layer.ts:83`

**Fix:** Three changes. (1) `bus_node_values` in `board/layer.ts` emits rows for reg `0..max(cs.reg)`, with `[0n]` for each gap. Display: `"3 chip selects — GPIO8, GPIO7, <0>, GPIO18"`. Note: `"CS2 not wired (<0> placeholder)"`. The bundled board (CS 0–5) is unchanged. (2) `extract_gpio_controller` in `query.ts` for nested data uses the first row whose first cell is a string, skipping `<0>` holes (was: unconditionally read `data[0][0]`, which missed the controller when a `[0]` hole came first). (3) `check_value` matrix branch in `value-check.ts` accepts a row that is exactly `[0n]` as a phandle-array hole when the row template starts with a PHANDLE enum. Regression tests: gapped cs-gpios rows and note, bundled fixture gets no note, `[[0], ["gpio", 7, 1]]` still gets matrix typing, `<0>` row passes/fails against phandle/number templates, end-to-end gapped cs-gpios round-trip.

~~Rows are emitted one per declared chip select in sorted order. `cs-gpios` is positional, so any gap shifts later entries.~~

- ~~`chip_selects {0: gpio 8, 1: gpio 7, 3: gpio 18}` → `gpio 8 ...,gpio 7 ...,gpio 18 ...`; GPIO18 becomes CS2 and a device
  at `reg = <3>` fails in the kernel with `cs3 >= max 3`.~~ Now emits `<&gpio 8 1>, <&gpio 7 1>, <0>, <&gpio 18 1>`.
- The parser accepts the gap silently. Bundled board (CS 0–5) is unaffected.

### 12. Broken-but-configured board looks identical to no board in JSON — FIXED
`packages/attach-cli/src/commands/suggest/command.ts:251`

**Fix:** `optional_board_layer` returns `{ layer?, board_error? }` instead of `BoardLayer | undefined`. When `board_error` is set: `suggest value` uses `no_layer_message(property_name, board_error)` → `severity: "warn"` with the error in the message; `suggest type` sets `severity: "warn"` and appends the board error, plus prints `warning:` in human mode; `suggest board-slot` now `respond_fail`s with the error instead of returning silently. Removed the `diagnostic(...)` stderr-only message. Regression tests: `no_layer_message` (no board → info, broken board → warn with error), `optional_board_layer` with nonexistent path returns `board_error`.

~~Board set to a missing file, or a YAML with `bus: "&spi9"`: `--json suggest value ad7124/interrupts` exits 0 with
ok/info `No layer offers values ... (no board loaded)` and empty suggestions — byte-identical to the unconfigured case —
while `config-get board` still shows a board. The real error goes only to stderr.~~ Now `severity: "warn"` and message names the board error.
- ~~`suggest type` also drops its suggestions with no stdout signal.~~ Now warns in JSON and human mode.

### 13. Board parser silently ignores unknown keys — FIXED
`packages/attach-lib/src/Intelligence/board/parse.ts:88`

**Fix:** `known_keys(map, allowed, where)` added to `parse.ts`. Called on every fixed-schema map (root, bus, chip-select entry, slot, signal). Each unknown key fails with `${where}.${key}: unknown key`. If `key.replaceAll("-", "_")` is in the allowed set, the message adds `; did you mean "${fixed}"?`. User-keyed maps (`buses`, `slots`, `signals`, etc.) are not checked. YAML merge keys (`<<`) supported via `parse_yaml_string(content, { merge: true })`, so `{<<: *anchor, reg: 1}` correctly inherits the anchor's fields. Regression tests: `chip-selects` → `chip_selects` hint, `alt-bus` → `alt_bus` hint, unknown root key, merge-key slot inherits signals.

~~Malformed boards validate and then silently degrade suggestions.~~

- ~~`chip-selects:` under spi0 passes `config-set board`.~~ Now rejected with `buses.spi0.chip-selects: unknown key; did you mean "chip_selects"?`.
- ~~Misspelled `alt-bus:` drops that slot from i2c1.~~ Now rejected with `slots.c.alt-bus: unknown key; did you mean "alt_bus"?`.
- ~~A slot written as `{<<: *pmod, reg: 1}` loses its signals.~~ Merge keys now resolved by the YAML parser.

### 14. Parent placement leaks into `pattern_properties` (child-node) rules — FIXED
`packages/attach-lib/src/Attach/Attach.ts:188`

**Fix:** `populate_parsed_binding` passes `{ layers: options.layers }` (without `placement`) for pattern properties. Pattern rules describe child nodes, so the parent's placement doesn't apply. The board layer already returns `lower` unchanged when `placement` is undefined. Regression test: handcrafted `ParsedBinding` with `reg` in both `properties` and `pattern_properties`; top-level `reg` gets board suggestions via placement, pattern `reg` gets none.

~~`populate_parsed_binding` passes the node's placement to every `pattern_properties` rule, which describe child nodes.~~

- ~~`new_populated_binding(adi,ad7124.yaml, ..., adc@0 on spi0, {layers: [board_layer], placement})` gives the
  `^channel@([0-9]|1[0-5])$` rule's `reg` (an ADC channel index) six suggestions like
  `0 — GPIO8 (spi_pmod1.cs1, quikeval.cs), in use by spidev@0`.~~ Pattern `reg` now gets no placement-based suggestions.
- ~~Latent in the CLI (reads only `.properties`), but wrong for any lib consumer that renders child forms.~~

### 15. `pwms` phandle off-by-one left unfixed — FIXED
`packages/attach-lib/src/Intelligence/query.ts:438`

**Fix:** Changed `minItems`/`maxItems` from `Number(new_length)` to `Number(new_length) + 1`, matching the `dmas` and `*-gpios` branches. Regression test: PWM controller with `#pwm-cells = <2>`, matrix-typed `pwms` property with data `[["pwm"]]` → row has 3 prefixItems and `minItems === maxItems === 3`.

~~The diff fixes `*-gpios` (`minItems = #gpio-cells + 1`) but the `pwms` branch of the same function still sets
`minItems = maxItems = #pwm-cells` while `prefixItems` holds the phandle plus `#pwm-cells` cells.~~

- ~~With `#pwm-cells = <2>` and a matrix-typed `pwms`, the row has 3 prefixItems but min/max 2.~~ Now min/max 3, matching prefixItems.

---

## Lower-severity (verified, cut from the main list)

- `suggest board-slot` ~~returns silently if the board file changes between its two reads (race).~~ now `respond_fail`s the error (fixed in #12).
- ~~`refine_properties` is not idempotent; running it twice doubles suggestions (latent).~~ Fixed (tier 4 B1).
- ~~Integer-like YAML keys are reordered, and `0` and `"0"` silently collapse into one key.~~ Fixed: `mapAsMap: true` + duplicate-key check (tier 4 B3).
- ~~`suggest_placement` drops the parent candidate for a board bus with no slots, hiding valid buses (latent).~~ Fixed (tier 4 B4).
- ~~Label regex accepts `-`, which dtc doesn't allow in labels.~~ Fixed (tier 4 B5).
- ~~The `board.ts` test leaks its temp dir if an assertion fails.~~ Fixed with `try/finally` in #7.
- ~~`target = <&{/path}>` fragments lose their bus prefix (dtc can't compile that form anyway).~~ Fixed: normalised to `target-path` (tier 4 A2).
- ~~New placement display strings have a double slash (`//soc/...`), copied from existing `suggest parent`.~~ Fixed: `parent_path_string` (tier 4 B8).
- ~~The reg suggestion's `slot` field names only the first owner of a shared chip select.~~ Fixed: `ValueSuggestion.slots` (tier 4 B6).
- ~~Docs promise board suggestions on `suggest type`, but that never works for base-tree bus nodes.~~ Fixed (tier 4 C4).

### Cleanups (~13 confirmed)

- ~~Prop-ref parsing duplicated.~~ Fixed: `parse_property_reference` in utilities.ts (tier 4 C2).
- ~~`load_trees` extracted but only half used.~~ Fixed: shared `load_trees`/`load_base` in utilities.ts (tier 4 C1).
- ~~`refine_parsed_binding` unused.~~ Removed (tier 4 B2).
- ~~`resolve_bus_paths` recomputed per property.~~ Fixed: computed once per `refine_properties` call (tier 4 B7).
- ~~Board YAML and base DTS each parsed twice per command.~~ Fixed: `resolve_config` returns parsed context/board (tier 4 C3).
- ~~A subshell fork per completion candidate in the shell stubs.~~ Fixed: `printf -v` (tier 4 C5).
- ~~`fixture.ts` lives in `src/` rather than a test directory.~~ Moved to `test/fixtures/board/` (tier 4 B9).

## ~~Outside this diff~~ Fixed (tier 4 A1)

~~`DeviceTreeOverlay.print()` writes `target = <&&spi0>` for overlays written in the `&label { }` form. Every `update` on
such an overlay then fails with "unreadable overlay".~~ Fixed: `Parser.ts` stores bare label names; print/reparse roundtrip works.
