# Corpus baseline

Generated 2026-10-22 by `yarn corpus`: the 435 RPi overlays of `analogdevicesinc/linux` at `16bea53d3413` (`rpi-6.12.y`), against that tree's `bcm2711-rpi-4-b.dts`.
The script fetches that commit itself (shallow, sparse) into `~/.cache/attach-corpus`; the pin is `LINUX_COMMIT` in `scripts/corpus.mjs`.
`yarn corpus:diff [filter]` reruns and lists new and removed errors, crashes and changed imports (exit 1 on a regression).
Both run the built `dist/cli.js`, so build attach-lib and attach-cli first (`yarn verify`).

| | overlays |
|---|---|
| import ok | 435 |
| import or validate crash | 0 |
| validate clean | 199 |
| validate reports errors | 236 (1080 errors) |

## Error classes

| class | errors | overlays | verdict |
|---|---|---|---|
| `b'\x00…' is not of type 'object', 'integer', 'array', …` (`brcm,pins`/`function`/`pull`, but also `mclk-frequency`, `adi,clk-div-mode`, `bgr`, `buswidth`, …) | 647 | 144 (80 have nothing else) | Probably a validate limitation: dt-validate can't type the property, so it sees raw bytes. Not confirmed. `plans/followups.md` item 11 treated the `brcm,*` ones as won't fix; the same message on vendor properties of ADI and display bindings suggests it isn't pin-specific. |
| everything else | 433 | 156 | Not triaged one by one. The most frequent are upstream overlays that don't satisfy their binding: a missing `*-supply` (`admv1013`, `pcm512x`), `Unevaluated properties`, node names that don't match the schema (`mcp251xfd@0` vs `^can(@.*)?$`), a missing `#address-cells` (`ad5592r`), and `reg` too short on `fixedregulator@0`. |

## Not done

- No error is classified as "our bug" yet. Doing that means taking a sample of each class in the second row and checking it against the binding.
- The raw-bytes class needs one experiment: validate a hand-written overlay setting `bgr = <0>` on an ssd1306 and see whether dt-validate gives the same message with no import involved.
- No minimal `.dtso` repros under `test/fixtures/corpus/`, no bisect script, and `list value` output isn't snapshotted.
