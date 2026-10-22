# Handoff: corpus triage (the 433 other validate errors)

Plan date: 2026-10-22. Branch `dpetri/attach-linux`. The corpus harness (`yarn corpus`, `scripts/corpus.mjs`) and its baseline
(`corpus-snapshots/`, commit `afda7c4` and before) are committed. `corpus-snapshots/TRIAGE.md` has the class table.
This document plans the triage still open there. Nothing is implemented yet.

## Status

- Done: the raw-bytes class (647 errors) is explained. A hand-written dts with no attach-cli gives the same message, because
  dt-validate leaves a property no schema defines as raw bytes (`TRIAGE.md`).
- Open: everything below. **No root cause is established for any item.** The "Hypothesis" lines come from reading a few
  samples against the overlay source, not from a run that separates our output from upstream's.
- The classes overlap (one error can match two queries), so their counts don't add up to 433.

## Setup

- Build first: `yarn verify` (the harness runs `dist/cli.js`).
- The pinned tree is in `~/.cache/attach-corpus/linux-16bea53d3413` once `yarn corpus` has run (one fetch, about 20 s).
- Every item's repro is `node scripts/repros/corpus-class.mjs '<regex>' [--raw]` (new, reads `corpus-snapshots/`, changes
  nothing). It prints the error count, then one line per overlay.
- The method for every item: take 3 overlays from the class, read the overlay source and the node's binding in the pinned
  tree, and decide per overlay: **upstream** (the overlay or the binding is wrong or out of date), **expected** (the overlay
  relies on something the kernel supplies, such as a dummy regulator), or **ours** (the stand-in tree from
  `build_validation_dts`, `src/commands/validate/command.ts:162`, differs from what dtc would produce from the original).
  The only decisive test for "ours" is the original text vs. the stand-in dts (`.attach-linux/temp.dts`) for the same node.
  A full-tree dt-validate run is not possible: it crashes with `KeyError: '/'` in dtschema's `fixup_gpios`.
- Findings go in the item's section here. `TRIAGE.md` is updated once, at the end, by the main agent.

## Ownership (for parallel agents)

| Group | Items | Writes only |
|---|---|---|
| A | CT1, CT2, CT3 | this doc (their own sections), `test/fixtures/corpus/ct1/` … `ct3/` |
| B | CT4, CT5, CT6 | this doc (their own sections), `test/fixtures/corpus/ct4/` … `ct6/` |
| C | CT7 | this doc (its section), `test/fixtures/corpus/ct7/` |
| D | CT8 | `scripts/corpus-bisect.sh` |

Agents never commit and don't edit `TRIAGE.md`, `src/` or `corpus-snapshots/`. Anything that turns out to be ours becomes
a new item (CT9+) with its own failing test, and is not fixed here.

---

## CT1 Required properties missing

- **ID:** CT1, `'X' is a required property` (supplies, `scl-gpios`, `#address-cells`, `data-lanes`).
- **Repro:** `node scripts/repros/corpus-class.mjs 'is a required property'`
  Expected: errors only where the overlay really lacks the property. Actual: 121 errors in 47 overlays (e.g.
  `ad2s1210@0: 'avdd-supply'`, `admv1013@0: 'vcc-amp1-supply'`, `pcm5142@4c: 'AVDD-supply'`, `i2c@0: 'scl-gpios'`).
- **Root cause:** not established. Hypothesis: the overlays don't describe regulators (the kernel falls back to a dummy
  regulator), and `i2c-gpio` overlays use the old `gpios` property. Both would be expected or upstream. To rule out
  "ours": for each sample, check that the overlay has no `*-supply` or `*-gpios` the stand-in drops (stubs, label
  references, `__overrides__`). `build_validation_dts` is `src/commands/validate/command.ts:162`.
- **Proposed fix:** none expected. Open design choice if they are expected: (a) leave as is, (b) validate could downgrade
  `*-supply` required errors to warnings, since the kernel supplies dummy regulators (less noise, but hides a real
  missing supply on boards without one), (c) filter in the harness only (no product change).
- **Tests to add:** a fixture per sample under `test/fixtures/corpus/ct1/` and, only if one is ours, a failing test in
  `validate/command.ts`.
- **Status:** `open`

## CT2 Properties the binding doesn't know

- **ID:** CT2, `do not match any of the regexes` and `Unevaluated properties are not allowed`.
- **Repro:** `node scripts/repros/corpus-class.mjs 'do not match any of the regexes'` (122 errors, 60 overlays) and
  `node scripts/repros/corpus-class.mjs 'Unevaluated properties are not allowed'` (61 errors, 47 overlays).
  Samples: `imx219`/`arducam`: `clock-names`, `orientation`, `rotation`; `tlv320aic32x4`: `#gpio-cells`,
  `gpio-controller`; `i2c-gpio-rtc`: `#address-cells`, `#size-cells`; `pca9544`: `i2c@0`…`i2c@3`.
- **Root cause:** not established. Hypothesis: the properties are real but the binding in `rpi-6.12.y` lags the downstream
  driver (the RPi tree carries drivers upstream hasn't documented). For each sample, grep the binding YAML for the property.
  Three outcomes: absent (upstream), present under a `$ref` or `allOf` branch that dtschema didn't apply (look at the
  node's `compatible`), or dropped by the stand-in (compare against `temp.dts`).
- **Proposed fix:** none expected. If many are "absent from the binding", option (a) leave, (b) a per-binding allow list
  in the harness. Not in the product.
- **Tests to add:** fixtures under `test/fixtures/corpus/ct2/`. A failing test only for an "ours" case.
- **Status:** `open`

## CT3 Node names that don't match the schema

- **ID:** CT3, `$nodename: 'ds1307@68' does not match '^rtc…'`.
- **Repro:** `node scripts/repros/corpus-class.mjs 'nodename'`. Actual: 35 errors in 27 overlays.
- **Root cause:** not established. Hypothesis: the overlays name nodes after the chip (`ds1307@68`), the schema wants the
  generic name (`rtc@68`). Check that the stand-in keeps the overlay's node name unchanged (it should: `node4` wraps
  the fragment, the child keeps its name).
- **Proposed fix:** none for the stand-in. Open design choice if upstream: leave, or add `validate` guidance for
  generic node names. Skip unless asked.
- **Tests to add:** one fixture (`ct3/`), plus a check that `build_validation_dts` keeps a child's name.
- **Status:** `open`

## CT4 Compatible and `oneOf` failures

- **ID:** CT4, `compatible … is too short`, `… is not one of […]`, `'oneOf' conditional failed`.
- **Repro:** `node scripts/repros/corpus-class.mjs '^[^:]*: compatible|oneOf. conditional'`. Actual: 25 errors in 18 overlays.
- **Root cause:** partly established. `media-center`: the overlay itself has `compatible = "ilitek,ili9341"` (one string), so
  `is too short` is upstream: the schema for that device wants a second entry. Not checked for the other samples
  (`adafruit18@0 jianda,jd-t18003-t01`, `ad2s1210@0 oneOf`, `ksz9477 ports:port@0`).
- **Proposed fix:** none expected. Verify that the stand-in preserves multi-string compatibles (`compatible = "a", "b"`
  must reach the dtb as two strings): a small test in `validate/command.ts`.
- **Tests to add:** `build_validation_dts` keeps a two-string compatible. Fixtures under `ct4/`.
- **Status:** `open`

## CT5 Graph, clock and value constraints (highest chance of "ours")

- **ID:** CT5, `port@N:endpoint`, `data-lanes`, `clock-names:0`, `#clock-cells`, `pwms … too long`.
- **Repro:** `node scripts/repros/corpus-class.mjs 'port|endpoint|clock-names:|#clock-cells|pwms|data-lanes'`.
  Actual: 53 errors in 24 overlays. Samples: `imx290`/`imx327`/`imx462`/`imx258`: `endpoint: 'data-lanes' is a required
  property`; `imx500`: `data-lanes:0: 2 was expected`; `camera-mux-4port`: `clock-names:0: 'inck' was expected`;
  `rpi-ad9545-hmc7044`: `#clock-cells: 0 was expected`; `pwm-gpio-fan`: `pwms … is too long`.
- **Root cause:** not established. These are the likeliest to come from the stand-in, because the endpoint, its
  `remote-endpoint` target and the fragment that adds `data-lanes` can live in different fragments. A missing
  `data-lanes` that the overlay does set would be ours. Check first, for `imx290` and `imx327`: is `data-lanes` in the
  overlay text, and is it in `.attach-linux/temp.dts` for that endpoint?
- **Proposed fix:** if ours, the fix is in `build_validation_dts` (`src/commands/validate/command.ts:162`): decide between
  (a) merge every fragment targeting one node before building the stand-in (matches dtc), (b) keep fragments separate and
  copy endpoint properties to the stub. Pick after the check. If upstream, none.
- **Tests to add:** a failing test in `validate/command.ts` that builds the stand-in for the `imx290` overlay shape and
  expects `data-lanes` on the endpoint, and a fixture under `ct5/`.
- **Status:** `open`

## CT6 `reg` too short

- **ID:** CT6, `reg:0: [N] is too short` and `Unevaluated … ('reg' was unexpected)`.
- **Repro:** `node scripts/repros/corpus-class.mjs 'reg:0|too short'`. Actual: 18 errors in 14 overlays.
  Sample: `i2c-gpio`: `reg = <0xffffffff>` on `i2c@0` under `/`, with the base root at `#address-cells = <2>`.
- **Root cause:** not established. Hypothesis: the overlay sets a one-cell `reg` under a root with two address cells, so
  the real kernel would fail the same check (upstream). The stand-in takes its cells from the fragment target
  (`target_node`, `command.ts:172`; the `1n` default is at `command.ts:173`); confirm it takes them from the real target and not a default (`1n`) when the target
  is `target-path = "/"` or a label that doesn't resolve.
- **Proposed fix:** none if the target resolves. If it falls back to `1n` for a resolvable target, that is ours.
- **Tests to add:** `build_validation_dts` uses the target's `#address-cells` for `target-path = "/"` and for a label.
- **Status:** `open`

## CT7 Raw-bytes properties that appear in some schema

- **ID:** CT7, 7 properties (57 errors, 28 overlays): `debug`, `set`, `init`, `bgr`, `firmware`, `ready`,
  `adi,quad-se-mode`.
- **Repro:** `node scripts/repros/corpus-class.mjs ': (debug|set|init|bgr|firmware|ready|adi,quad-se-mode): b' --raw`
- **Root cause:** not established. These names occur somewhere in the compiled schema, but dt-validate still leaves them as
  raw bytes on these nodes. Hypothesis: the schema that has the name belongs to another device, so this node's type table
  has no entry (same cause as the main class). Check each against the node's own binding. `adi,quad-se-mode` is an ADI
  property and the first to check: if the binding defines it as an array or enum, the raw bytes would mean the type table is
  not applied to this node.
- **Proposed fix:** none expected for the others. If `adi,quad-se-mode` is defined for its node, report it upstream
  (dt-schema) with the 9-line repro from `TRIAGE.md`.
- **Tests to add:** none unless ours.
- **Status:** `open`

## CT8 Bisect script

- **ID:** CT8, `scripts/corpus-bisect.sh`.
- **Repro:** none (a new tool). Use: `scripts/corpus-bisect.sh <good> <bad> <overlay-filter>`.
- **Root cause:** n/a.
- **Proposed fix:** a script that runs `git bisect run` with `yarn verify`'s build steps, then
  `node scripts/corpus.mjs diff <filter>` (exit 1 on a regression, 0 otherwise, 125 when the build fails so bisect skips
  it). Needs a worktree, so the user's tree isn't touched: `git worktree add` a temp dir, build there, remove it at the end.
  Open choice: the corpus baseline must be the *good* commit's, so (a) the script checks out the baseline from `<good>`,
  or (b) it takes a baseline directory argument. (a) is simpler to use, (b) lets a baseline survive a commit that changed
  `corpus.mjs` itself.
- **Tests to add:** none automated. Show one real bisect on a deliberate regression (revert one commit in a scratch branch).
- **Status:** `open`

## Order

1. CT5 and CT6 first: the only ones with a plausible "ours" cause, and they decide whether anything needs fixing.
2. CT1, CT2, CT3, CT4, CT7 in parallel (read-only checks).
3. CT8 independent of the rest.
4. Last, the main agent updates `TRIAGE.md` and `yarn verify` is run once.
