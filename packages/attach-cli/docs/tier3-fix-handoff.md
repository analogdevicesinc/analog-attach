# Fix handoff — tier-3 findings (#5, #7, #12, #13, #14, #15)

Plan date: 2026-09-29. Branch `dpetri/devicetree`, uncommitted working tree (tier-1 and tier-2 fixes applied, see
`tier1-fix-handoff.md` and `tier2-fix-handoff.md`). Findings are numbered as in `code-review-handoff.md`. Line numbers
refer to the working tree at planning time and may drift.

## Status

- Nothing implemented yet. This document is the plan.
- Re-checked against the code after tier 2. Not re-run live: `/tmp/cr-review` no longer exists (see Verification).

## Decisions

1. **`load_board` never throws.** Read failures become its usual error string. Every caller already handles that
   string.
2. **Board errors go on stdout, in the response.** They go in the message, with severity `warn`, and no longer only to
   stderr. A broken board must never look like no board.
3. **Unknown keys are rejected; YAML merge keys are supported.** Only maps with a fixed schema are checked, and
   hyphenated spellings get a "did you mean" hint.
4. **Completion dequoting lives in the engine**, not the shell stubs, so one fix covers bash, zsh and fish.
5. **Pattern (child-node) rules get the layers but not the parent's placement.**

## Context

`docs/code-review-handoff.md` lists 15 findings on the board-description intelligence layer. Tier 1 and tier 2 fixed
#1–#4, #6 and #8–#11. This plan covers the six that are left:

- **#7 and #12:** a broken board crashes commands or silently disappears.
- **#13:** the board parser accepts malformed boards without complaint.
- **#5:** `--with` completion stops completing after the first TAB.
- **#14 and #15:** two latent lib bugs.

The goal: every board-touching command either works or says why the board was ignored, on stdout, in JSON. Each
finding gets an inline `import.meta.vitest` regression test, following package convention.

Order: #7 → #12 → #13 → #5 → #14 → #15. #12 builds on #7.

---

## 1. #7 — `load_board` never throws

`packages/attach-cli/src/board.ts`

- Wrap the resolve and read in `load_board` (`resolve_board_reference` + `readFileSync`) in try/catch.
- On failure, return the error string ``cannot read ${board_path}: ${error.message}``, following the function's existing
  "description or error string" contract. `statSync` can also throw (EACCES on a parent directory), so the resolve is
  inside the guard too.
- Callers need no change for the crash to go away:
  - `config.ts:100`: the `board` validate hook already maps a string to a config error, so `config-set board <file>`
    reports it instead of printing a stack trace.
  - `optional_board_layer` (`suggest/command.ts:191`) already treats a string as "ignore the board".
- **Test (board.ts):** create a temp YAML, `chmod 000` it, and expect `load_board` to return `/^cannot read .*: EACCES/`.
  Use `test.skipIf(process.getuid?.() === 0)`, since root can read the file anyway. Use `try/finally` for the temp-dir
  cleanup, which also fixes the lower-severity "test leaks its temp dir" item for this file.

## 2. #12 — a configured-but-broken board shows up in the JSON response

`packages/attach-cli/src/commands/suggest/command.ts`

- Change `optional_board_layer(config)` to return `{ layer?: BoardLayer; board_error?: string }`. Set `board_error` to
  ``board ${config.board} ignored: ${error}``. Remove the stderr `diagnostic(...)`, because the error now goes in the
  response message.
- **`suggest value` (≈line 339):** add a third message case. The current message is
  `No layer offers values … (no board loaded)` / info. When `board_error` is set, the message becomes
  ``No layer offers values for ${property_name}; ${board_error}`` with severity `warn`. The human path already prints
  `warn` messages. Extract this as an exported pure `no_layer_message(property_name, board_error?)` so it can be
  tested.
- **`suggest type` (≈line 745, 789):** when `board_error` is set, the response becomes
  ``Type of ${property_name}; ${board_error}`` with severity `warn`. In human mode, also print `warning: ${board_error}`
  after the type.
- **`suggest board-slot` (≈line 454):** it currently does `if (typeof board === "string") { return; }` silently, which
  is the "race" lower-severity item. Change it to `respond_fail` / `console.log` the error.
- **Tests:**
  - `no_layer_message` covers three cases: no board (info), broken board (warn and contains the error), and the
    message wording.
  - `optional_board_layer` with `{ board: "/nonexistent.yaml" }` returns a `board_error` that names the reference.

## 3. #13 — board parser rejects unknown keys and supports merge keys

`packages/attach-lib/src/Intelligence/board/parse.ts`

- Parse with `parse_yaml_string(content, { merge: true })`. yaml 2.x then resolves `<<: *anchor`, so a
  `{<<: *pmod, reg: 1}` slot inherits its signals. Merging is the natural YAML idiom for repeated slot templates, so
  supporting it is better than rejecting it.
- Add `known_keys(map, allowed: readonly string[], where)`.
  - Each key not in `allowed` fails with `${where}.${key}: unknown key`.
  - If `key.replaceAll("-", "_")` is allowed, the message adds `; did you mean "${fixed}"?`.
  - Call it only on fixed-schema maps:
    - root: `schema_version, board, host, gpio_controller, buses, slots, constraints, gpio_usage, free_gpios, conflicting_overlays`
    - bus: `node, chip_selects, reserved_addresses`
    - chip-select entry: `gpio, user`
    - slot: `bus, alt_bus, selected_by, reg, signals`
    - signal: `kind, gpio, reg, connected, active, open_drain`
  - User-keyed maps (`buses`, `slots`, `signals`, `chip_selects`, `reserved_addresses`, `gpio_usage`,
    `conflicting_overlays`) are not checked.
- The bundled `pmd-rpi-intz.yaml` uses only known keys (checked). Existing test YAMLs could still hit the new check;
  these are `fixture.ts`, the board YAML in the suggest tests (`command.ts:971`) and the update tests. Fix them if they
  do.
- **Tests (parse.ts):**
  - `chip-selects:` under a bus returns `buses.spi0.chip-selects: unknown key; did you mean "chip_selects"?`.
  - `alt-bus` gets the same kind of message.
  - A made-up root key returns `foo: unknown key`.
  - An anchored slot template with `<<` merge keeps its signals.

## 4. #5 — multi-word `--with` completion

The engine compares candidates against the still-escaped word, e.g. `19\ IRQ_TYPE_` or `"19 IRQ`. Fix it in the
engine, because that fix covers all three shells.

`packages/attach-cli/src/commands/completion/complete.ts`

- Add exported `shell_dequote(word)`:
  - `\X` becomes `X` outside quotes.
  - `'…'` is literal.
  - `"…"` honours `\"` `\\` `\$` `` \` ``.
  - An unterminated quote runs to the end of the word.
- Apply it to every word at the top of `run_complete`, both the prefix and the committed words, since earlier `--with`
  values arrive escaped too. Candidates are emitted unescaped, as today.

`packages/attach-cli/src/commands/completion/command.ts`, bash stub

- Stop re-filtering with `compgen -W … -- "$cur"`, because the raw `cur` still defeats that filter. Use the engine's
  already-filtered output directly: `COMPREPLY=( "${values[@]}" )`.
- Keep the `printf %q` insertion loop, but skip it when `cur` starts with `"` or `'`. Inside an open quote, readline
  inserts the match as-is and closes the quote itself, and a `\ ` inside `"…"` would be literal.
- zsh (`_describe` matches against its own unquoted PREFIX) and fish need no stub change.

**Tests (completion-drift.test.ts):**
- A `shell_dequote` table: `19\ IRQ_TYPE_` → `19 IRQ_TYPE_`, `"19 IRQ` → `19 IRQ`, `'a b'` → `a b`, plain word
  unchanged, `a\\b` → `a\b`.
- `complete(["completion", "\"ba"])` → `bash`, which shows the quoted prefix now matches.
- A stub-content assertion that the bash stub no longer contains `compgen -W`.

**Manual check (needed, because bash word-splitting on `"`, which is in COMP_WORDBREAKS, can only be confirmed live):**
drive bash 5.3 and zsh 5.9 through a pty with Python's `pty` module in `/tmp` against the built CLI.
`update ad7124/interrupts --with <TAB><TAB>` must complete to a full `19 IRQ_TYPE_…` value, and so must a start with
`"19 IRQ<TAB>`. If bash splits on the opening quote, handle it in the stub by re-joining from `COMP_LINE`/`COMP_POINT`.

## 5. #14 — placement no longer leaks into `pattern_properties`

`packages/attach-lib/src/Attach/Attach.ts:186`

- In `populate_parsed_binding`, call `populate_properties` for pattern properties with the layers but without the
  placement: `options?.layers === undefined ? undefined : { layers: options.layers }`. Pattern rules describe child
  nodes, so the parent's placement doesn't apply. The board layer already returns `lower` unchanged when `placement`
  is undefined (`board/layer.ts:245,258`).
- **Test (inline in Attach.ts):**
  - Build a handcrafted `ParsedBinding` with `reg` in both `properties` and one `pattern_properties` entry.
  - Use `RPI_BASE_FIXTURE` / `PMD_RPI_INTZ_FIXTURE` from `Intelligence/board/fixture.ts`, a board layer, and a spi0
    placement.
  - Expect the top-level `reg` to have board suggestions and the pattern `reg` to have none.

## 6. #15 — `pwms` row length includes the phandle

`packages/attach-lib/src/Intelligence/query.ts:456`

- Change `minItems`/`maxItems` to `Number(new_length) + 1`, matching `dmas` (line 349) and `*-gpios`.
- **Test (query.ts inline):**
  - Use a DT with `pwm: pwm@… { #pwm-cells = <2>; }`.
  - Use a matrix `pwms` property with data `{"pwms": [["pwm"]]}`.
  - Expect the row to have 3 prefixItems and `minItems === maxItems === 3`.

---

## Docs

- `docs/code-review-handoff.md`: mark #5, #7, #12, #13, #14 and #15 fixed, in the same format as the existing rows.
  Update the test counts.
- Update SKILL.md or CLAUDE.md only if something user-visible changed there. Candidates are the board error now
  appearing in `suggest` messages, and merge keys in board YAML. The attach-lib CLAUDE.md board section may deserve a
  line on unknown-key rejection.

## Verification

1. `yarn workspace attach-lib test --run` and `yarn workspace attach-cli test --run`. Every new test fails before its
   fix and passes after.
2. `yarn build:attach-cli`, which also runs `tsc --noEmit`.
3. Run the end-to-end checks in a `/tmp` sandbox with `~/rpi-4.dts` and the bundled board:
   - `chmod 000` board, then `--json suggest type ad7124/reg` and `config-set board <file>`: both give a JSON/plain
     error, no stack trace. `suggest type` still returns the type, with a `warn`.
   - Board set to a missing file: `--json suggest value ad7124/interrupts` gives `severity: "warn"`, and the message
     names the board error.
   - Board with `chip-selects:`: `config-set board` is rejected with the "did you mean" message.
   - The bash and zsh pty completion check from §4.
