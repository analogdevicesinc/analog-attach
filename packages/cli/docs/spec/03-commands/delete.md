# delete

Removes a node the overlay adds, a property the overlay sets, or the whole
overlay's content. A shared command: §2 to §8 as the linux backend does it,
§9 as the noos backend does it (a node, a property's value, or every node).

## 1. Synopsis

```
analog-attach [--json] delete [<path> [<property>]] [--force]
```

Grammar: rule `delete` in `01-grammar.abnf`.

| Argument | Meaning | Default |
|---|---|---|
| `<path>` | The node. | none: the whole overlay (§5) |
| `<property>` | A property the overlay sets on the node. | none: the node (§6) |
| `--force` | Delete instead of previewing: without `<path>` the whole overlay, with `<path>` a node that has children. | off |

## 2. Terms

| Term | Meaning |
|---|---|
| Overlay node | A node in a fragment's `__overlay__` body, or the body itself (which stands for the fragment's target). |
| Added node | An overlay node at a path the base doesn't have. |
| Preview | A response that says what a delete would remove and removes nothing. |

## 3. Resources

The command needs the base and the overlay (COM-070, 02-common §8.2, §8.3).

## 4. Input

**DELETE-001** The CLI shall not check `<path>` or `<property>` per GRM-020 to
GRM-023 or GRM-030. A path such as `&adc` or `adc x` is looked up as written
and names no node (DELETE-021). A label-first path with an empty segment
names the node without it (`adc//channel@0` is `adc/channel@0`). One
trailing `/` is ignored, as GRM-024 says. (Open issue D-3.)

## 5. The whole overlay

**DELETE-010** When no `<path>` is given and `--force` isn't, the CLI shall
write nothing and answer with a preview of the overlay. It counts, over every
fragment's `__overlay__` body, each node in the body with all its descendants,
the properties of those nodes, and the properties set directly in the body.

**DELETE-011** While in human mode, the preview of DELETE-010 shall be `Would
delete <n> node(s) and <m> property(ies)`, followed by one line per counted
node: two spaces and its path from its fragment's target, segments joined by
`/` (`adi,ad7124-8@2/channel@0`).

**DELETE-012** While in JSON mode, the preview of DELETE-010 shall be a
`DeletePreview` (`04-protocol/delete.schema.json#/$defs/linux-preview`): `ok` `true`, `severity`
`"warn"`, `message` as in DELETE-011, `node_count`, `property_count`, and
`paths`, an array of the counted nodes' paths from their fragment's target
(`[["adi,ad7124-8@2"], ["adi,ad7124-8@2", "channel@0"]]`).

**DELETE-013** When no `<path>` is given and `--force` is, the CLI shall
remove every node under the overlay's root (all fragments, and other root
nodes such as `__overrides__`), keeping the header, and save the overlay. The
result is `Deleted all overlay content from <overlay file>` in human mode and
`{"ok": true, "message": "Deleted all overlay content", "severity": "info"}`
in JSON mode. (Open issue D-2.)

## 6. A node

**DELETE-020** When `<path>` is `/` and no `<property>` is given, the CLI
shall refuse with `Cannot delete the root node`.

**DELETE-021** The CLI shall resolve `<path>` per GRM-025 to GRM-027 among
the overlay's nodes only. If no overlay node is at that path, then the CLI
shall refuse with the message of READ-021. This includes a base node the
overlay has no node for (`delete spidev0`), and the body of a fragment whose
`target` is a label that neither the base nor the overlay defines, with
everything in it: `delete nolabel` and `delete nolabel/foo` give `Not found:
nolabel` and `Not found: nolabel/foo`. (Open issue D-6.)

**DELETE-022** If the node is in the base, then the CLI shall refuse with
`<path> is part of the base device tree (<base file>), not this overlay;
delete only removes overlay-added nodes`, in both modes. (`delete spi0` when the
overlay has a fragment for `spi0`.)

**DELETE-023** If the node is the body of a fragment whose target is a path
the base lacks (`target-path = "/nothere"`), then the CLI shall refuse with
`Cannot delete the root node`, in both modes. The nodes in that body are added nodes
and can be deleted (`delete /nothere/baz`).

**DELETE-024** When the added node has children and `--force` isn't given,
the CLI shall write nothing and answer with a preview of the node: in human
mode the lines of DELETE-011, in JSON mode a `DeletePreview`
(`04-protocol/delete.schema.json#/$defs/linux-preview`). It counts the node and its descendants
(`node_count`) and their properties (`property_count`), and lists each of them
from the node, starting with `<key>` (`paths`, starting with `[<key>]`).

**DELETE-025** Otherwise, the CLI shall remove the added node with all its
descendants and save the overlay.

**DELETE-026** When a removal leaves a fragment's `__overlay__` body with no
properties and no nodes, the CLI shall remove that fragment and renumber the
remaining fragments `fragment@0`, `fragment@1`, … in order.

**DELETE-027** On success, the CLI shall write `Deleted <path> from <overlay
file>` in human mode, and respond `{"ok": true, "message": "Deleted <path>",
"severity": "info"}` in JSON mode.

## 7. A property

**DELETE-030** When `<property>` is given, the CLI shall remove `<property>`
from every overlay node at the node's path, in every fragment, so that the
base's value, if any, applies again. The node may be in the base or added.
The fragments are pruned per DELETE-026, and the overlay is saved.

**DELETE-031** If no overlay node at the path sets `<property>`, or the path
names no overlay node, then the CLI shall refuse with `Not found: <property>
on <path>`. A property only the base sets can't be deleted.

**DELETE-032** On success, the CLI shall write `Removed <property> from <path>
in <overlay file>` in human mode, and respond `{"ok": true, "message":
"Removed <property> from <path>", "severity": "info"}` in JSON mode.

## 8. JSON responses

`04-protocol/delete.schema.json`: a preview (DELETE-012, DELETE-024), a success
(`CommonResponse` with `ok` `true`, `severity` `"info"`) or a refusal.

## 9. Where the backend is noos

A property is part of its node's schema, so deleting it clears its value. A
node is previewed first when other nodes reference it; the whole workfile
always is.

**DELETE-500** The CLI shall load the workfile (`02-common.md` COM-512). If
`<node>` names no node, then the CLI shall refuse as `read` does (`read.md`
READ-505), and the same for `<property>`.

**DELETE-501** When `<node>` is referenced by properties of other nodes and
`--force` isn't given, the CLI shall respond with a preview and change
nothing: `severity` `warn`, `message` `'<node>' is referenced by <n>
propert(y|ies); deleting it would clear (that reference|those references).
Re-run with --force.`, `node_count` 1, `property_count` `<n>`, and `paths`
`[<node>]` followed by `[<owner>, <property>]` per reference
(`delete.schema.json#/$defs/noos-preview`). In human mode it shall write
`<node>: referenced by`, an empty line, `  <owner>.<property>` per
reference, an empty line, and `Nothing was changed. Re-run with --force to
delete the node and clear those references.`.

**DELETE-502** Without `<node>`, when the workfile has nodes and `--force`
isn't given, the CLI shall respond with a preview: `message` `Deleting the
root removes every node in the workfile (<n> node[s]). Re-run with
--force.`, `node_count` `<n>`, `property_count` the number of properties of
those nodes, `paths` `[<name>]` per node. In human mode it shall write
`<workfile>: would delete <n> node[s]` (`<workfile>` the file name without
its extension), an empty line, `  <name>` per node, an empty line, and
`Nothing was changed. Re-run with --force to delete them all.`. The nodes
counted are every node the workfile has, the external ones included (open
issue D-7).

**DELETE-503** Without `<node>`, when the workfile has no nodes, the CLI
shall answer `Nothing to delete: the workfile has no nodes`.

**DELETE-510** With `<node> <property>`, the CLI shall clear the property's
value (READ-504 finds it), mark it as cleared so that bootstrap doesn't fill
it again, run bootstrap (`add.md` ADD-520), write the workfile, and answer
`Reset <node>.<property>`. It needs no `--force`.

**DELETE-511** With `<node>`, when nothing references it or `--force` is
given, the CLI shall clear each reference to it (marked cleared, as in
DELETE-510), remove the node, run bootstrap, write the workfile, and answer
`Deleted '<node>'`, or `Deleted '<node>' and cleared <n> reference[s] to
it`. If a reference can't be cleared, then the CLI shall refuse with
`Cannot delete '<node>': <owner>.<property> references it and could not be
cleared (<problem>). Delete '<owner>' instead.`.

**DELETE-512** Without `<node>`, with `--force`, the CLI shall remove every
node, write the workfile without running bootstrap, and answer `Deleted <n>
node[s]`.

**DELETE-513** If bootstrap fails, then the CLI shall refuse with
`<answer>, but bootstrap failed: <problem>` and write nothing.

**DELETE-514** In human mode, the answer of DELETE-510 and DELETE-511 shall
be followed by the bootstrap report (`add.md` ADD-525). In JSON mode every
answer has `severity` `info`.

## 10. Open issues

**D-2. The overlay preview doesn't count everything `--force` deletes.**
DELETE-010 counts only `__overlay__` bodies. `delete --force` also removes
`__overrides__`, `__dormant__` bodies and every other root node. A preview of
`0 node(s) and 3 property(ies)` can delete an `__overrides__` node with its
parameters.

**D-3. No path checks.** `delete` skips GRM-020 to GRM-023, so `delete &adc`
says `Not found: &adc` instead of `Use the bare form: adc`, and `delete
adc//channel@0` deletes `adc/channel@0` instead of reporting `empty segment
in path: adc//channel@0`. `move`, `rename`, `enable` and `disable` do the
same (`01-grammar.md` G-1).

**D-4. A base node is refused in two ways.** `delete spi0` says the node is
part of the base when the overlay has a fragment for it, and `Not found:
spidev0` when it hasn't (DELETE-021, DELETE-022).

**D-5. Preview paths are relative.** `paths` in a preview start at the
fragment's target or at the deleted node, unlike the absolute paths the
other responses give (overview §3.5).

**D-6. A fragment behind an unresolved label can't be edited.** An overlay
can have a fragment whose `target` is a label that neither the base nor the
overlay defines (`import` keeps such fragments and warns about them). Its
body and every node in it are unreachable: `delete nolabel`, `delete
nolabel/foo`, `delete nolabel/foo bar`, `rename nolabel/foo x`, `move
nolabel/foo spi0`, `enable nolabel`, and `read` and `update` too, all say
`Not found`. A fragment with an unknown `target-path` doesn't have the
problem: its nodes are found by that path (DELETE-023). The only way to remove the fragment is `delete --force`, which
empties the whole overlay, or editing the file. A fix would be to resolve a
label-first path whose first segment is an unresolved fragment target to
that fragment's body, as for a `target-path`.

**D-7. External nodes are counted, listed and deleted as if stored.** Where
the backend is noos, the root preview (DELETE-502) lists the external nodes
the workfile names (`testpart_ops`, `bsp_test_spi_cfg_handle`) among those
it would delete, so `node_count` is 13 for 10 stored nodes, and `delete
testpart_ops --force` "deletes" an ops table the workfile never stored,
clearing the two properties that name it. A fix would be to count and
delete stored nodes only, and refuse an external one as `update` does
(`update.md` UPDATE-504).

## 11. Examples

```
$ analog-attach delete
Would delete 2 node(s) and 8 property(ies)
  adi,ad7124-8@2
  adi,ad7124-8@2/channel@0
```

```
$ analog-attach delete adc
Would delete 2 node(s) and 7 property(ies)
  adi,ad7124-8@2
  adi,ad7124-8@2/channel@0
$ analog-attach delete adc --force
Deleted adc from /work/ad7124-8.dtso
```

```
$ analog-attach --json delete adc
{"ok":true,"message":"Would delete 2 node(s) and 7 property(ies)","severity":"warn",
 "node_count":2,"property_count":7,"paths":[["adi,ad7124-8@2"],["adi,ad7124-8@2","channel@0"]]}
$ analog-attach --json delete adc --force
{"ok":true,"message":"Deleted adc","severity":"info"}
```

```
$ analog-attach delete spi0 status
Removed status from spi0 in /work/ad7124-8.dtso
$ analog-attach delete spi0 compatible
Not found: compatible on spi0
```

Where the backend is noos:

```
$ analog-attach delete testpart_spi_dev
testpart_spi_dev: referenced by

  testpart_ip.comm_init

Nothing was changed. Re-run with --force to delete the node and clear those references.
$ analog-attach --json delete testpart_spi_dev
{"ok":true,"message":"'testpart_spi_dev' is referenced by 1 property; deleting it would clear that reference. Re-run with --force.",
 "severity":"warn","node_count":1,"property_count":1,"paths":[["testpart_spi_dev"],["testpart_ip","comm_init"]]}
$ analog-attach --json delete testpart_spi_dev --force
{"ok":true,"message":"Deleted 'testpart_spi_dev' and cleared 1 reference to it","severity":"info"}
```
