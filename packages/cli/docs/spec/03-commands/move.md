# move

Moves a node the overlay adds to another parent. The linux backend's own
command: it exists where the backend is linux (COM-013).

## 1. Synopsis

```
analog-attach [--json] move <path> <destination>
```

Grammar: rule `move` in `01-grammar.abnf`. Both positionals are required:
a missing one is GRM-004's `Expected argument for path` or `Expected argument
for destination`, one line each.

| Argument | Meaning |
|---|---|
| `<path>` | The node to move: an added node (delete.md §2). |
| `<destination>` | The new parent: any node of the merged tree. |

## 2. Resources

The command needs the base and the overlay (COM-070, 02-common §8.2, §8.3).

## 3. Input

**MOVE-001** The CLI shall not check either path per GRM-020 to GRM-023 (open
issue D-3 of `delete.md`).

## 4. Requirements

**MOVE-010** The CLI shall resolve `<path>` among the overlay's nodes per
DELETE-021. If none is there, then the CLI shall refuse with the message of
READ-021. `/`, base nodes the overlay has no node for, and the nodes of a
fragment whose `target` is an unresolved label (`delete.md` D-6) give this
refusal.

**MOVE-011** If the node is in the base, then the CLI shall refuse with
`<path> is part of the base device tree (<base file>), not this overlay; move
only applies to overlay-added nodes`, in both modes.

**MOVE-012** If the node is the body of a fragment whose target is a path
the base lacks (`target-path = "/nothere"`), then the CLI shall refuse with
`Cannot move the root node`, in both modes.

**MOVE-013** The CLI shall resolve `<destination>` per GRM-025 to GRM-027: to
the overlay's node when there is one, else to the base's. If neither has it,
then the CLI shall refuse with `Couldn't find parent node <destination> in
<base file> or <overlay file>` in human mode, and `Parent node <destination>
not found` in JSON mode.

**MOVE-014** If the destination is the node itself or one of its descendants,
then the CLI shall refuse with `Cannot move <path> into itself or one of its
descendants`.

**MOVE-015** If the destination already has a child with the node's key, in
the base or the overlay, then the CLI shall refuse with `<destination> already
has a child named <key>`.

**MOVE-016** Otherwise, the CLI shall append the node, with its labels,
properties and descendants unchanged, to the overlay node for the
destination, adding a fragment for it when the destination is a base node the
overlay doesn't target yet (as ADD-052 does). It shall then remove the node
from its old place, prune empty fragments per DELETE-026, and save the
overlay.

**MOVE-017** The CLI shall not change the node's name, unit address or `reg`
for its new parent, and shall give no warning about address clashes or the
parent's bus kind. (Open issue M-1.)

**MOVE-018** On success, the CLI shall write `Moved <path> to <destination> in
<overlay file>` in human mode, and respond `{"ok": true, "message": "Moved
<path> to <destination>", "severity": "info"}` in JSON mode.

## 5. JSON responses

`04-protocol/move.schema.json`: a success (`ok` `true`, `severity` `"info"`)
or a refusal (`common.schema.json#/$defs/refusal`). There is no
command-specific field.

## 6. Open issues

**M-1. A moved node keeps an address that may not fit.** `move adc i2c1`
puts an SPI device with `reg = <2>` on an I2C bus without a word. `move adc2
adc` keeps `adc2`'s chip select under a node that isn't a bus. `add`, `rename`
and `update reg` warn about clashes. `move` doesn't, and doesn't pick a free
address.

**M-2. The parent not-found message differs between modes** (as A-2 in
`add.md`).

## 7. Examples

```
$ analog-attach move adc spi1
Moved adc to spi1 in /work/ad7124-8.dtso
$ analog-attach move adc adc/channel@0
Cannot move adc into itself or one of its descendants
$ analog-attach --json move adc/channel@0 adc
{"ok":false,"message":"adc already has a child named channel@0","severity":"error"}
```
