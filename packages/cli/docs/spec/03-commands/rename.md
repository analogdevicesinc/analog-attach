# rename

Renames a node the overlay adds, and keeps its `reg` in step with a new unit
address. A shared command: §2 to §7 as the linux backend does it, §8 as the
noos backend does it (a node and every reference to it).

## 1. Synopsis

```
analog-attach [--json] rename <path> <new-name>
```

Grammar: rule `rename` in `01-grammar.abnf`. Both positionals are required
(GRM-004).

| Argument | Meaning |
|---|---|
| `<path>` | The node: an added node (delete.md §2). |
| `<new-name>` | `<name>` or `<name>@<unit-address>` (GRM-050). |

## 2. Resources

The command needs the base and the overlay (COM-070, 02-common §8.2, §8.3).
It uses the bindings when they load (02-common §8.4), only to decide the
unit address's radix (RENAME-030).

## 3. Input

**RENAME-001** The CLI shall not check `<path>` per GRM-020 to GRM-023 (open
issue D-3 of `delete.md`), and shall not check `<new-name>` at all: any
string is accepted, including one with `/`, whitespace or nothing before `@`.
(Open issue N-1.)

## 4. The node

**RENAME-010** The CLI shall resolve `<path>` among the overlay's nodes per
DELETE-021, refusing with the message of READ-021 when none is there. The
nodes of a fragment whose `target` is an unresolved label are never found
(`delete.md` D-6).

**RENAME-011** If the node is in the base, then the CLI shall refuse with
`<path> is part of the base device tree (<base file>), not this overlay;
rename only applies to overlay-added nodes`, in both modes.

**RENAME-012** If the node is the body of a fragment whose target is a path
the base lacks (`target-path = "/nothere"`), then the CLI shall refuse with
`Cannot rename the root node`, in both modes. (`rename / <name>` is
RENAME-010's `Not found: /`: the root is no node of the overlay.)

## 5. The new name

**RENAME-020** The CLI shall split `<new-name>` at its first `@`. When there is
no `@`, the node keeps its unit address: `rename adc myadc` on `adc@2` gives
`myadc@2`. When there is an `@` with something after it, that is the new unit
address. When `@` ends the name, the node is left without a unit address.
(Open issue N-2.)

**RENAME-021** If the parent already has a child, in the base or the overlay,
with the new key (name and unit address), and that key isn't the node's own,
then the CLI shall refuse with `<new-name> already exists under the same
parent`.

**RENAME-022** The CLI shall keep the node's labels, properties and children.
References to its labels stay valid.

## 6. reg

**RENAME-030** The CLI shall read a new unit address in decimal when the
parent's binding (that of the parent's first compatible the CLI finds a
binding for) names children of the new name in decimal (a pattern such as
`^channel@([0-9]|1[0-5])$`), and in hexadecimal otherwise, or when the
bindings don't load.

**RENAME-031** When `<new-name>` gives a unit address that reads as a number
in that radix, the CLI shall set `reg` to that address: the parent's
`#address-cells` cells of address, most significant first, followed by
`#size-cells` cells of 0, the counts found as ADD-048 finds them. When the
node had a `reg`, the CLI shall replace it whole and give the note `reg first
cell set to <address>` (`<address>` in decimal). When it had none, the CLI
shall add it and give the note `reg created`. (Open issue N-3.)

**RENAME-032** When the unit address doesn't read as a number in that radix
(`adc@zz`, or `channel@a` under a decimal parent), or isn't given, the CLI
shall leave `reg` as it is, without a note.

## 7. Result

**RENAME-040** On success, the CLI shall save the overlay.

**RENAME-041** The CLI shall give the address warnings for the renamed node
per `validate.md` VALIDATE-113: clashes with its siblings (an equal address,
or under a parent with `#size-cells` more than 0 an overlapping range,
VALIDATE-100), and a chip select the controller's `cs-gpios` lacks
(VALIDATE-103). Each warning is
`warning: <message>`, followed by two spaces and its hint on the next line
when it has one.

**RENAME-042** While in human mode, the CLI shall write to standard output
the note of RENAME-031, if any, and `Renamed <path> to <new-name> in <overlay
file>`, and the warnings of RENAME-041 to standard error (COM-021).

**RENAME-043** While in JSON mode, the CLI shall write the warnings of
RENAME-041 to standard error (COM-021), and respond with `ok` `true`,
`message` `Renamed <path> to <new-name>`, followed by `; <note>` when
RENAME-031 gives one, and `severity` `"warn"` when there is at least one
warning, `"info"` otherwise (`04-protocol/rename.schema.json`).

## 8. Where the backend is noos

**RENAME-500** The CLI shall load the workfile (`02-common.md` COM-512),
then refuse, with the first that applies:

| Problem | Message |
|---|---|
| `<new-name>` isn't a C identifier (a letter or `_`, then letters, digits and `_`) | `Symbol '<new-name>' is not a valid C name` |
| `<path>` names no node | `Symbol '<path>' not found` (open issue N-5) |
| The workfile has a node `<new-name>` (`<path>` itself included) | `Symbol '<new-name>' already exists` |
| `<new-name>` is one of the platform's ops | `Symbol '<new-name>' conflicts with platform ops` |

**RENAME-501** Otherwise the CLI shall rename the node, rewrite every
property value that names it, write the workfile without running bootstrap,
and answer `Renamed '<path>' to '<new-name>'` (`severity` `info`). An
external node is renamed the same way (open issue N-4).

## 9. Open issues

**N-1. `rename` can write an overlay that doesn't parse.** The new name isn't
checked, and the overlay isn't parsed again before it is saved. `rename adc
foo/bar`, `rename adc "a b"` and `rename adc ""` (which gives `adc: @2 { … }`)
are saved. The next command then fails with `overlay: … does not parse`. A
fix: refuse names that aren't valid node names, as `update` does with its
parse-back check.

**N-2. `name@` drops the unit address.** `add --name adc@` is refused
(ADD-043). `rename adc adc@` renames the node to `adc` and leaves its `reg`.

**N-3. `reg` is replaced, not its first cell.** The note says `reg first cell
set to <n>`, but the whole `reg` is rewritten. Its size cells become 0 and any
entries after the first are dropped, so renaming a memory-mapped node loses
its size.

**N-4. Renaming an external node stores it.** Where the backend is noos,
`rename testpart_ops myops` answers `Renamed 'testpart_ops' to 'myops'`,
but the workfile then stores a node `myops`, and the references to the ops
table still name `testpart_ops`, which bootstrap supplies again. A fix
would be to refuse an external node, as `update` does (`update.md`
UPDATE-504).

**N-5. The not-found wording differs from the other commands.** Where the
backend is noos, `rename nope x` refuses with `Symbol 'nope' not found`,
while `read`, `update` and `delete` say `Node 'nope' not found. Available:
…` (`read.md` READ-505). A fix would be to look the node up as they do.

## 10. Examples

```
$ analog-attach rename adc adc@5
reg first cell set to 5
Renamed adc to adc@5 in /work/ad7124-8.dtso
warning: chip select 5 has no cs-gpios entry: spi@7e204000 has chip selects 0-1
  Use one of those, or add a GPIO for it to cs-gpios of /soc/spi@7e204000
```

(The two warning lines are on standard error.)

```
$ analog-attach --json rename adc adc@0
{"ok":true,"message":"Renamed adc to adc@0; reg first cell set to 0","severity":"warn"}
```

with on standard error:

```
warning: chip select 0 is already used by spidev@0
  If adc@0 replaces it: disable /soc/spi@7e204000/spidev@0
```

```
$ analog-attach rename adc/channel@0 channel@10
reg first cell set to 10
Renamed adc/channel@0 to channel@10 in /work/ad7124-8.dtso
```

(The ad7124 binding names channels in decimal, so `reg = <10>`.)

Where the backend is noos:

```
$ analog-attach --json rename tp3 sensor3
{"ok":true,"message":"Renamed 'tp3' to 'sensor3'","severity":"info"}
$ analog-attach --json rename sensor3 tp2
{"ok":false,"message":"Symbol 'tp2' already exists","severity":"error"}
```
