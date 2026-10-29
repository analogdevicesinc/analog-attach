# Corpus baseline

Generated 2026-10-22 by the CLI's `yarn corpus`, regenerated 2026-10-29 by `yarn workspace attach-lib corpus:overlays` with the same results: the 435 RPi overlays of `analogdevicesinc/linux` at `16bea53d3413` (`rpi-6.12.y`), against that tree's `bcm2711-rpi-4-b.dts`.
The script fetches that commit itself (shallow, sparse) into `~/.cache/attach-corpus`; the pin is `LINUX_COMMIT` in `corpus/overlays/corpus.mjs`.
`yarn workspace attach-lib corpus:overlays:diff [filter]` reruns and lists new and removed errors, crashes, changed parse results and changed warnings (exit 1 on a regression).
Both call attach-lib's built `dist/` (build it first) and the CLI's bundled dtc / dt-mk-schema / dt-validate.

| | overlays |
|---|---|
| parse ok | 435 |
| parse or validate crash | 0 |
| validate clean | 199 |
| validate reports errors | 236 (1080 errors) |

## Error classes

| class | errors | overlays | verdict |
|---|---|---|---|
| `b'\x00…' is not of type 'object', 'integer', 'array', …` (`brcm,pins`/`function`/`pull`, but also `buswidth`, `fps`, `rotate`, `adi,clk-div-mode`, …) | 647 | 144 (80 have nothing else) | Not ours: dt-validate leaves a property no YAML schema defines as raw bytes, and `dt-core.yaml` rejects those. Checked with a 9-line hand-written dts and no attach-cli: `brcm,pins`, `brcm,function` and an invented `foo,made-up` all give this message, `status` doesn't. The overlay's own text has the same values as the stand-in tree (`brcm,pins = <19>`). 96 of the 103 distinct properties are in no compiled schema (590 errors); the other 7 (`debug`, `set`, `init`, `bgr`, `firmware`, `ready`, `adi,quad-se-mode`; 57 errors) match a name in some schema but weren't checked against the node's own binding. |
| everything else | 433 | 156 | Not triaged one by one. The most frequent are upstream overlays that don't satisfy their binding: a missing `*-supply` (`admv1013`, `pcm512x`), `Unevaluated properties`, node names that don't match the schema (`mcp251xfd@0` vs `^can(@.*)?$`), a missing `#address-cells` (`ad5592r`), and `reg` too short on `fixedregulator@0`. |

## Not done

- No error is classified as "our bug" yet. Doing that means taking a sample of each class in the second row and checking it against the binding.
- The 7 raw-bytes properties that appear in some schema (57 errors): check whether the node's own binding defines them.
- A full-tree reference isn't possible: dt-validate crashes on the whole merged tree (`KeyError: '/'` in dtschema's `fixup_gpios`), which is why validate checks a stand-in tree.
- No minimal `.dtso` repros under `test/fixtures/corpus/`, no bisect script, and `list value` output isn't snapshotted.
