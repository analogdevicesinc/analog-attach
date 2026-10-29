# add

Adds a device node to the overlay (the workfile). A shared command: §2 to
§11 as the linux backend does it (the device is a compatible), §12 as the
noos backend does it (the device is a schema, a driver or an eval board).

## 1. Synopsis

```
analog-attach [--json] add <compatible> [--parent <path>] [--name <name>]
                                       [--label <label>] [--template <template>] [--quiet]
analog-attach [--json] add <device> [--name <name>] [--as <interface>[,<interface>…]]...
                                    [--quiet]          # where the backend is noos
```

Grammar: rule `add` in `01-grammar.abnf`.

| Argument | Meaning | Default |
|---|---|---|
| `<compatible>` | The device's compatible string. It selects the binding. Optional in the grammar (the shared `[<device>]`), required here (ADD-005). | |
| `--parent <path>` | The node to add it under: a node path (GRM-020). | chosen (§5) |
| `--name <name>` | The node name, optionally with `@<unit-address>`. Only with `--template required`. | `<compatible>` |
| `--label <label>` | The node's label. | generated (ADD-041) |
| `--template <template>` | What the node starts from (GRM-060). | `required` |
| `--quiet` | Don't ask for missing required properties; list them. | off |

## 2. Terms

| Term | Meaning |
|---|---|
| Valid parents | The nodes `list parent <compatible>` lists, in its order: the base's nodes that the binding allows as a parent. Computed from the base only. |
| Bus kind | `spi` or `i2c`. A node's bus kind comes from its name (`spi`, `i2c`), or else from the first of its compatibles that contains the word `spi` or `i2c`. Other nodes have none. |
| Copy template | `example:<N>` or `overlay:<ref>`. |
| Interactive run | A terminal run (COM-012) in human mode without `--quiet`. |
| New node | The node this command adds. Its *key* is its name with the unit address (`adi,ad7124-8@2`). |

## 3. Resources

The command needs the bindings, the base and the overlay (COM-070, ADD-012).

## 4. Before the workspace

**ADD-005** If `<compatible>` is missing, then the CLI shall report the input
error `Missing: compatible (add <compatible>)` (COM-031: standard error,
status 2, in both modes), `<compatible>` literal.

**ADD-001** When `--parent` is given, the CLI shall check it as a node path
(GRM-020 to GRM-024) before anything else, and report an input error when it
fails (COM-031).

**ADD-002** The CLI shall check `--template` (GRM-060) after `--parent`, and
report an input error when it fails (COM-031): `Unknown --template <value>
(use required, example:<N> or overlay:<name>)`.

**ADD-003** If the template is a copy template and `--name` is given, then the
CLI shall refuse with `--name doesn't apply with --template <template>: the
node keeps its name (rename it afterwards)`, `<template>` being the template as
given.

**ADD-004** The CLI shall do the checks ADD-005 and ADD-001 to ADD-003
without loading the workspace: a run they stop gives no configuration
error.

## 5. Workspace and binding

**ADD-010** When the workspace can't be loaded, the CLI shall report it per
COM-071 or COM-072 and add nothing.

**ADD-011** *Withdrawn.* (With no overlay configured, `add` created
`<device>.dtso`. It now needs one, ADD-012; `init` creates it.)

**ADD-012** If no workfile is configured, or the configured workfile can't be
read (the file doesn't exist) or parsed, then the CLI shall report it per
COM-071 or COM-072 and add nothing. `add` never creates the workfile.

**ADD-013** If no binding has `<compatible>` in its `compatible` list, then the
CLI shall refuse with `Failed to find binding for <compatible>`.

## 6. Parent

Applies to `--template required` without `--parent`. The copy templates place
the node by ADD-060 and ADD-070.

**ADD-020** If the valid parents are none, or only `/`, then the CLI shall add
the node under `/`, without a question or a note.

**ADD-021** While the run is interactive, when the valid parents include a
node other than `/`, the CLI shall ask for the parent (§6.1) before the node
exists.

**ADD-022** While the run isn't interactive, when the valid parents include a
node other than `/`, the CLI shall take the first valid parent and give the
note `Parent: <parent> (use --parent to choose another)`, `<parent>` being its
label, or its path when it has none.

### 6.1 The parent question

**ADD-023** The CLI shall write `Where does <compatible> go? (Enter takes a, a
letter picks, or type a label or path, Ctrl-D stops)`, then one line per valid
parent (format ADD-121), then the prompt `parent [a]: `. Each option's value is
the parent's label, or its path when it has none. Its display is its path.

**ADD-024** When the answer is empty, the CLI shall take the first valid
parent. When it is a letter code (ADD-120) in range, the CLI shall take that
option. Any other single word is a node path; a trailing `/` other than `/`
itself is dropped.

**ADD-025** If the answer is `-`, then the CLI shall write `A parent is
needed: pick a to <last>, or type a label or path` and ask again. (`pick a`
when there is one option.) If the answer is more than one word, then the CLI
shall write `A parent is one label or path` and ask again.

**ADD-026** If the typed node path fails GRM-020 to GRM-023, then the CLI shall
write that error and ask again. If it names no node of the merged tree, then
the CLI shall write `Couldn't find parent node <answer> in <base file> or
<overlay file>` and ask again.

**ADD-027** When Tab is pressed at the parent prompt, the CLI shall complete
segment by segment: with no `/` typed yet, the labels of the valid parents
followed by `/`; after a `/`, the children of the node typed so far.

**ADD-028** When the question is stopped (Ctrl-C or end of input), the CLI
shall write `No parent chosen; nothing added.` to standard output and exit
with status 130 (COM-060), without creating or changing a file.

## 7. Placing the node (`--template required`)

**ADD-030** If `--parent` names no node of the merged tree, then the CLI shall
refuse. The message is `Parent node <parent> not found` in JSON mode, and
`Couldn't find parent node <parent> in <base file> or <overlay file>` in human
mode.

**ADD-031** The CLI shall check, in this order, and refuse at the first that
fails: the parent (ADD-030), the label (ADD-040), an empty unit address
(ADD-043), a child with the same key (ADD-050). (The copy templates check
the key before the label, ADD-066.)

### 7.1 Label

**ADD-040** Where `--label` is given, the CLI shall label the node with it.
If it isn't a valid label (GRM-040), then the CLI shall refuse with `Invalid
label: <label> (must match [A-Za-z_][A-Za-z0-9_]*)`. If the base or the overlay
already uses it, then the CLI shall refuse with `Label <label> is already used
by <path>`.

**ADD-041** Where `--label` isn't given, the CLI shall label the node with
the compatible after its first `,`, every character other than a letter, a
digit or `_` replaced by `_`. When that starts with a digit, the vendor
(sanitised the same way) and `_` go in front, or only `_` when there is no
vendor. When the label is taken, the CLI shall use `<label>_<n>` with the
smallest `<n>` from 1 that is free. (`adi,ad7124-8` → `ad7124_8`, then
`ad7124_8_1`.)

### 7.2 Name and unit address

**ADD-042** The CLI shall name the node `--name`, or `<compatible>` when
`--name` isn't given, split per GRM-050.

**ADD-043** If the name ends in `@` (an empty unit address), then the CLI shall
refuse with `Empty unit address (name@ is invalid)`.

**ADD-044** Where the name has a unit address, the CLI shall keep it. When it
is hexadecimal (`hex-unit`), the CLI shall write a `reg` for that address
(ADD-048). When it isn't, the CLI shall write no `reg`, and give the note
`Non-hex unit address "<unit>"; no reg created`.

**ADD-045** Where the name has no unit address and the binding doesn't define
`reg`, the node shall have no unit address and no `reg`.

**ADD-046** Where the name has no unit address, the binding defines `reg`
and the parent is memory-mapped, the node shall have no unit address and no
`reg`, and the CLI shall give the note `The parent is memory-mapped; set the
address with: update <path> reg <address> <size>`, `<path>` being the new
node's absolute path; `<address> <size>` is literal. A parent is
memory-mapped when it has `#size-cells` other than 0, or has no
`#size-cells` and is in the base.

**ADD-047** Where the name has no unit address, the binding defines `reg`
and the parent isn't memory-mapped, the CLI shall give the node the lowest
address from 0 that no enabled child of the parent occupies. A child occupies
the address its `reg` gives, or when it has no `reg`, its hexadecimal unit
address. A child whose `reg` the CLI can't read (its first `<…>` doesn't
start with `#address-cells` numbers) occupies nothing, even when its unit
address is hexadecimal (open issue A-6). When the address is not 0, the CLI
shall give the note (two lines):

```
Picked <what> <address> (taken: <occupants>).
To change it: rename <label> <base-name>@<n>
```

`<what>` and `<address>` follow the parent's bus kind: `chip select` in
decimal for SPI, `address` as `0x`-prefixed hexadecimal for I2C, `unit
address` in hexadecimal otherwise. `<occupants>` lists every occupied address
in ascending order as `<address> by <name>`, with the names of the children
at one address joined by ` and `, the entries joined by `, `. `<n>` is
literal. Example:
`Picked chip select 2 (taken: 0 by spidev@0 and adc@0, 1 by spidev@1).`

**ADD-048** When the node gets an address, the CLI shall write `reg` with
the parent's `#address-cells` cells of address (most significant first)
followed by `#size-cells` cells of 0. Each count comes from the overlay's
node, else the base's, else 1 for the address and 0 for the size. When the
size is more than 0 cells, the CLI shall give the note `reg size set to 0;
update reg with the real size`.

**ADD-049** When the node has a unit address and the parent is a node the
overlay adds (not in the base), the CLI shall write to the parent
whichever of `#address-cells = <1>` and `#size-cells = <0>` it lacks. A base
parent is left alone.

**ADD-050** If the parent already has a child with the new node's key, in the
base or the overlay, then the CLI shall refuse with `<parent> already has a
child named <key>`. `<parent>` is:

| Parent from | `<parent>` |
|---|---|
| `--parent` | as given, a trailing `/` dropped |
| The parent question (ADD-024) | the answer: the option's value, or the typed label or path |
| ADD-022 | the parent's absolute path, not the label its note shows (open issue A-5) |
| ADD-020 | `/` |
| ADD-062 | the parent's label, or its path when it has none |
| ADD-072, the target in the base | the target as the overlay writes it, with the nodes between it and the copied node (`spi0`, `i2cbus`): a label of the template overlay may mean nothing in the workspace (open issue A-5) |
| ADD-072, the target not in the base | the parent's label, or its path when it has none |

### 7.3 Content

**ADD-051** The new node shall have the label, the `compatible` property set
to `<compatible>`, and `reg` when ADD-044 or ADD-047 gives one. Nothing else.

**ADD-052** When the parent is a base node the overlay doesn't target yet,
the CLI shall add a target for it to the overlay, in the configured
overlay syntax (fragment or `&label`).

## 8. `--template example:<N>`

**ADD-060** Where the template is `example:<N>`, the CLI shall preprocess each
example of the binding with `preprocess-command` and take, from example `<N>`
(counted from 1 in the binding's `examples` list), the first node whose
`compatible` contains `<compatible>` or another compatible of the binding.

**ADD-061** If the binding has fewer than `<N>` examples, if example `<N>`
doesn't compile, or if it has no such node, then the CLI shall refuse. The
messages:

| Case | Message |
|---|---|
| No examples | `There is no example <N>: <file> has no examples` |
| Fewer than `<N>` | `There is no example <N>: <file> has <count> example<s><use>` |
| Doesn't compile | `Example <N> of <file> doesn't compile: <error><use>` |
| No node for the device | `Example <N> of <file> has no node for <compatible><use>` |

`<file>` is the binding's file name. `<use>` is `; use <list>`, `<list>` being
the examples that do have a node for the device, as `example:<i>` followed by
` (SPI)` or ` (I2C)` when the example's node is on such a bus, joined by `, `.
It is empty when there are none.

**ADD-062** Where `--parent` is given, the CLI shall use it, refusing per
ADD-030 when it names no node. Otherwise the CLI shall use the first valid
parent of the example's bus kind, or the first valid parent when none is of
that kind, or `/` when there are none. It shall then give the note `Parent:
<parent> (use --parent to choose another)`, or, when no valid parent is of the
example's kind, `Parent: <parent> (no <BUS> bus for example <N>; use --parent
to choose another)`. There is no note for `/`. The CLI doesn't ask, even in an
interactive run.

**ADD-063** The CLI shall copy the example's node as written: its name and
unit address, its properties, its children and their references.

**ADD-064** When the example's node doesn't list `<compatible>` in its
`compatible`, the CLI shall replace that property with `compatible =
"<compatible>"` and give the note `The example is for <first compatible>;
compatible set to <compatible>`.

**ADD-065** The copied node shall have one label. Where `--label` is given,
the CLI shall check it per ADD-040 and use it. Otherwise the CLI shall use the
node's first label, or generate one per ADD-041 when it has none. The
children keep all their labels. When the node's first label, or a label of a
child, is taken, the CLI shall use `<label>_<n>` per ADD-041 and give the
note `Label <old> is taken; labelled <new> instead`. References inside the
copy to any label the node or a child had shall follow it to its new label.

**ADD-066** If the parent already has a child with the copied node's key,
then the CLI shall refuse per ADD-050, before checking `--label`. When the
copied node has a unit address, ADD-049 applies.

**ADD-067** After the parent note, the CLI shall give the note `Copied example
<N> of <file>`, followed by ` (<bus>)` when the example's node is on an SPI or
I2C bus (`spi`, `i2c`). Where `--parent` is given and its bus kind differs from
the example's, the CLI shall also give `Example <N> is on <BUS>; the parent is
<BUS>`. (`<BUS>` is `SPI` or `I2C`.)

## 9. `--template overlay:<ref>`

**ADD-070** Where the template is `overlay:<ref>`, the CLI shall find the
overlay as `import` does: `<ref>` as a file path when such a file exists,
else as a path, file name or stem in the Linux tree's overlay index. If none
matches, then the CLI shall refuse with `No overlay named <ref> in <linux>
(list overlay <compatible> finds them), and no such file`, `<linux>` being
the Linux tree; `<compatible>` is literal. If several match, then the CLI
shall refuse with `Several overlays are named <ref>; pass one of: <files>`.

**ADD-071** The CLI shall preprocess the overlay with `preprocess-command`
and take the first node, in file order, whose `compatible` contains
`<compatible>` or another compatible of the binding, looking in the bodies of
`__overlay__` first and in those of `__dormant__` when no `__overlay__` body
has one. The refusals:

| Case | Message |
|---|---|
| `preprocess-command` fails | `preprocessing <source> failed:`, then the command's output on the following lines |
| It doesn't parse | `<source> does not parse after preprocessing: <error>` |
| It has no such node | `<overlay> has no node for <compatible>` |

`<source>` is the overlay file's absolute path. `<overlay>` is its path
relative to the Linux tree, or its absolute path when it is outside the tree.

**ADD-072** Where `--parent` is given, the CLI shall use it, refusing per
ADD-030 when it names no node. Otherwise the CLI shall use the node the
fragment's target names when the base has it. When the base lacks it, the CLI
shall use the first valid parent of the target's bus kind (from the target's
last segment: `spi7`, `i2c_arm`, `/soc/spi@7e204000`), or the first valid
parent, or `/`, and give one of these warnings:

| Placed under | Warning |
|---|---|
| A valid parent of the target's kind | `warning: the overlay puts it in <target>, which the base doesn't have; using <parent> (first <BUS> bus)` |
| The first valid parent, none being of the kind | `… using <parent> (no <BUS> bus; the first valid parent)` |
| The first valid parent, the target having no kind | `… using <parent> (the first valid parent)` |
| `/` | `… the node is under / (move it with: move <label> <parent>)` |

`<target>` is where the overlay puts the node, as it writes it: the
fragment's target with the nodes between it and the copied node (`spi7`,
`spi7/mux`). `<label>` is the copied node's label. In the last row
`<parent>` is literal.

**ADD-073** The CLI shall copy the node with its children per ADD-063 to
ADD-066, worded with `overlay's node` for `example` (`The overlay's node is
for <c>; compatible set to <compatible>`). Nothing else of the overlay is
copied.

**ADD-074** The CLI shall give these notes, in this order: `Copied <node>
from <overlay>` (`from a dormant fragment of <overlay>` for a `__dormant__`
body); when the overlay has more nodes for the device, `The overlay has <n>
more node<s> for <compatible>, not copied: <nodes>`; the board-fit warning
when the overlay's board isn't the base's (as `import` words it); the warning
of ADD-072; the notes of ADD-064 and ADD-065. `<overlay>` is as in ADD-071.
`<node>` is the copied node's path as the overlay writes it, `<target>` of
ADD-072 followed by `/` and its key (`spi7/adc@1`, `i2cbus/adxl345@53`;
`/<key>` under the root).
`<nodes>` are the other nodes' paths in that form, joined by `, `.

## 10. Result

### 10.1 Writing

**ADD-080** When the node is added, the CLI shall write the overlay file.

**ADD-081** When the CLI refuses, it shall write neither the overlay nor the
settings (COM-042).

### 10.2 Human output

**ADD-090** While in human mode, the CLI shall write, in this order, items 1
to 4 to standard error (COM-021) and items 5 and 6 to standard output:

1. the parent note (ADD-022, ADD-062), if any;
2. the notes of the placement (ADD-044 to ADD-048) or of the copy (ADD-064 to
   ADD-067, ADD-072 to ADD-074);
3. the address warnings for the new node: clashes with siblings at the same
   address and a chip select that the controller's `cs-gpios` lacks
   (`validate.md` §7, VALIDATE-113);
4. for a copy template, the references in the new node that name no node of
   the merged tree (ADD-091);
5. `Added <key> (label: <label>) to <overlay file>`;
6. the missing required properties (§11).

In an interactive run, items 5 and 6 come as the run goes, before and with
the interview (§11.3), and nothing is written after it ends.

**ADD-091** The unresolved references block is:

```
error: <n> reference<s> point<s> to <a node|nodes> neither the base nor the overlay has:
  <node>  <property> → <reference>[, <reference>…]
  fix with: update <node> <property> <value>, or delete <node> <property>
```

In the last line, `<node> <property> <value>` and `<node> <property>` are
literal.

One row per node and property, in tree order. `<node>` is label-first where
possible, padded to the longest. The heading is `error: 1 reference points to
a node neither the base nor the overlay has:` for one reference.

### 10.3 JSON output

**ADD-100** While in JSON mode, on success the CLI shall respond with an
object conforming to `04-protocol/add.schema.json`:

| Field | Value |
|---|---|
| `ok` | `true` |
| `severity` | `"info"` |
| `message` | `Added <key> (label: <label>)` |
| `key` | The new node's key |
| `path` | The new node's path (§3.5 of the overview) |
| `template` | `required`, `example:<N>` or `overlay:<ref>` |
| `missing_required` | §11.1 |
| `unresolved` | Copy templates only: the references of ADD-091, each `{ path, property, reference }`, `reference` as written (`&label`, `&{/path}`) |

**ADD-101** While in JSON mode, the CLI shall write the notes and warnings of
ADD-090 items 1 to 3 to standard error (COM-021), and write neither the
references block nor the `Added` line.

**ADD-102** While in JSON mode, the CLI shall not fill or ask for anything
(COM-011): the node is as §7 to §9 leave it.

## 11. Missing required properties

The missing required properties are those the binding requires, after its
`if`/`then` branches are resolved against the node, that the node lacks in
the merged tree. They are ordered so a property comes after those it depends
on (`interrupt-parent` before `interrupts`).

### 11.1 Listed

**ADD-110** While in JSON mode, the CLI shall give each missing property in
`missing_required` as `{ property, description?, suggestions }`:
`description` is the binding's, and `suggestions` are the values `list value`
would give, followed by the other candidates. Each other candidate has its
mark in `note` (`disabled`, `enabled`, `enabled by the overlay`). A value of
`list value` may have a `note` too, from the binding: for a required flag,
`Property <property> is a flag and can be set to appear with 'true' or
disappear with 'false'`.

**ADD-111** In a human-mode run that isn't interactive, or with a copy
template, the CLI shall write, when properties are missing:

```
Missing required: <p1>, <p2>, …
Set them with: update <label> <property> <value>
```

and nothing when none are missing. `<property> <value>` is literal.

### 11.2 Filled without asking

**ADD-112** While the run is interactive and the template is `required`,
before any question, the CLI shall set each missing property the binding pins
to one value: a `const`, a one-option enum, or a flag the resolved binding
requires. The CLI shall write one line for each: `Set <property> = <value>
(the only value the binding allows)`, or `Set <property> (a flag the binding
requires)`. Setting one can make the binding require more, so the CLI shall
repeat this until no property is left that it hasn't tried. If a write fails,
then the CLI shall write `Couldn't set <shown> (<why>): <error>` and go on.
The warnings of the write go to standard error, as `update` writes them
(`update.md` UPDATE-091).

**ADD-113** While the run is interactive and the template is `required`, when
the parent has a bus kind and the binding has an example whose node sits on a
bus of that kind, the CLI shall write from the first such example
`spi-max-frequency` (SPI) or `reg` (I2C) when the example sets it, as `update`
would, and write the line `Set <property> = <<value>> (from example <i>)`.
`<value>` is decimal for `spi-max-frequency` and `0x`-hexadecimal for `reg`.
When `reg` renames the node, the line ends with `; renamed to <key>`. These
properties are filled even when they aren't missing. The warnings of the
write (an address clash) go to standard error, as `update` writes them
(`update.md` UPDATE-091).

**ADD-114** The CLI shall skip a value of ADD-113 the node already has. It
shall keep the node's own `reg` when a sibling with the same name is at the
example's address, writing `Kept the address: <name>@<hex> is there already
(from example <i>)`. It shall never take the chip select (SPI `reg`) from an
example.

### 11.3 The interview

**ADD-115** While the run is interactive and the template is `required`, when
properties are still missing after ADD-112 to ADD-114, the CLI shall write an
empty line, then `<n> required propert<y|ies> to set (Enter takes the default,
a letter picks an option, - skips, Ctrl-D stops)`, and ask for each in order.

**ADD-116** For each property, the CLI shall write an empty line, `[<i>/<n>]
<property>`, the binding's description, type, allowed values and suggestions
as `read` shows them, and then ask (ADD-117 to ADD-119, ADD-126). It shall
build each question after the previous answer is written, so an earlier answer
(`interrupt-parent`) shapes a later question (`interrupts`).

**ADD-117** For a property asked on one line, the prompt shall be `<property>
[<first suggestion>]: `, or `<property>: ` without suggestions. Enter takes the
first suggestion. `-` skips the property. Any other answer is the value,
written as `update <label> <property> <answer>` would write it. When there is
no suggestion, Enter writes `No suggestion to take: type a value, or Enter again
to skip`, and a second Enter skips.

**ADD-118** For a property with a closed set of values (an enum, or a phandle
whose possible targets are known), the CLI shall list the options per ADD-121
and accept an option by its letter code or by its value: a number, a label
with or without `&` (`&ab` for a label that looks like a code), or a string in
double quotes. An enum array of any length accepts several picks on one line.

**ADD-119** For a fixed-size array (a binding `minItems` equal to `maxItems`,
`interrupts` once the interrupt parent is known), the CLI shall ask one entry
per line. The prompt is `<property> <i>/<n> (<kind>) [<default>]: ` for a
number or string entry, `<kind>` being `number` or `string`, and
`<property> <i>/<n> [<code>]: ` for an entry with options (an enum cell such
as the `IRQ_TYPE_*` of `interrupts`), `<code>` being the letter of its
default. ` [<default>]` and ` [<code>]` are left out when the entry has no
default.

**ADD-126** A `*-gpios` property is asked row by row: the controller (a
lettered pick, enabled controllers first; Enter takes the first enabled one,
or on rows after the first the previous row's), then the line number, then
the flags (a lettered `GPIO_*` pick, Enter taking `GPIO_ACTIVE_HIGH`). The
prompt is `<place> <entry> [<default>]: `, `<entry>` being `controller`,
`line`, `cell <k>` for the `<k>`th number cell (from 2), or `flags`, and `<place>`
being `<property> row <r>/<count>` for a fixed row count, `<property> row
<r>` for a range or no count, and `<property>` when the binding allows one
row. A fixed count asks every row. Otherwise the CLI shall ask rows until it
has the minimum (at least one), then ask `<property>: another row? (y adds
one, Enter = done) ` after each row, up to the maximum when there is one.
Enter, `n` or `-` ends the rows, `y` or `yes` adds one, and any other answer
writes `Answer y for another row, or Enter when done` and asks again.

**ADD-127** In a terminal run, the entries of one property (ADD-119, ADD-126)
are asked in place: under the value so far, each erased once answered, so
the value line is what stays.

**ADD-120** Options shall be coded `a` … `z`, `aa` … `az`, `ba` …, as
spreadsheet columns are. A letter code in range always picks; a number is
always a value.

**ADD-121** An option line shall be two spaces, the code right-aligned to the
longest code, `) `, and the display. When the display doesn't start with the
value, the line shows the value, two spaces, and the display.

**ADD-122** If an answer is malformed, then the CLI shall write why and ask
the same entry again: `One value per line`, `<answer> is not a number or a
known macro`, `One pick: pick a to <last>`, `Not an option: pick a to <last>,
or type one of the values (&label or "text" for one that looks like a
letter)`, `No default: <type a value|pick a to <last>>, or - to skip`.

**ADD-123** When an answer is written, the CLI shall write `update`'s
message for it. If the write fails, then the CLI shall write `update`'s
error and ask the same property again. The warnings of the write go to
standard error, as `update` writes them (`update.md` UPDATE-091).
(See `update.md` U-10: a refused value may stay in the overlay in memory and
be written with a later answer.)

**ADD-124** When the interview is stopped (Ctrl-C or end of input), the CLI
shall stop asking and keep the node and every answer already written. The
exit status is 0: the node is added (COM-060 doesn't apply).

**ADD-125** After the interview, or after ADD-112 to ADD-114 when nothing is
left to ask, the CLI shall write `All required properties are set.`, or the
lines of ADD-111 for what is still missing. When nothing was missing and
ADD-112 to ADD-114 set nothing, the CLI shall write neither.

## 12. Where the backend is noos

The workfile is flat: every node is at its root, so `add` has no parent, no
label and no template. What `add` is given decides the node's schema;
bootstrap then fills in what leaves no room for choice, and the interview
asks for the rest.

### 12.1 The device

**ADD-500** The CLI shall take `<device>` (`list devices`, `list.md`
LIST-500) as, in this order: a schema, when a module defines a schema of
that key; an eval board (`eval-<part>`), which names the driver it carries;
a driver. A schema wins over a driver of the same name.

**ADD-501** If `<device>` is missing, then the CLI shall report the input
error `Nothing to add: pass <schema> (see: analog-attach list devices)`, or
with `--name <name>` `Cannot add '<name>' without a schema: a node is an
instance of a schema, and there is no default schema. See: analog-attach
list devices`. `<schema>` is literal.

**ADD-502** The CLI shall then load the workfile (`02-common.md` COM-512).
If `<device>` is neither a schema, an eval board nor a driver, then the CLI
shall refuse with `Unknown schema '<device>'. See: analog-attach list
devices`.

**ADD-503** For a driver (or an eval board), the CLI shall add the driver's
root: the generic handle the part is used through. Where `project-template`
is `capi-iio`, the root shall be the driver's IIO device instead.

**ADD-504** `--as <interface>` shall pick which root of a driver that
implements several interfaces (an ADC and a DAC on one chip) to add; it may
be comma-separated or repeated. The first interface is the node of ADD-510;
each further one is added as another node, `<driver>_<interface>` (made
unique per ADD-511), on the same chip: it shares the first node's
init_param. If `<device>` is a schema, then the CLI shall report the input
error `--as picks a driver's interface, and '<device>' is a schema, not a
driver`. An interface the driver doesn't implement is refused with the
lib's message.

**ADD-505** If the driver implements several interfaces and `--as` isn't
given, then the CLI shall refuse with `Driver '<driver>' can be added as
<i1> or <i2> (<root1>, <root2>). Pass --as <i1> or --as <i2>, or --as
<i1>,<i2> for all of them on one chip`.

**ADD-506** For an eval board, the CLI shall also add the eval board's node,
which names the part (`eval_<part>`), so that its pinout wires the part.

### 12.2 The node

**ADD-510** The node's name shall be `--name`, else: for a schema, the
schema's key without a leading `capi_` and a trailing `_pin`, numbered with
the lowest free number from 0 (`gpio0`, `gpio1`; `_` before the number when
the key ends in a digit); for a driver or an eval board, the driver's name,
or `<driver>_<interface>` with `--as`, made unique per ADD-511.

**ADD-511** A name made unique shall be the name itself when the workfile
has no node of that name, else the name with `_1`, `_2`, … appended, the
first that is free.

**ADD-512** If the workfile already has a node of that name, then the CLI
shall refuse with `'<name>' already exists. Pass --name to choose another
name.`.

**ADD-513** The CLI shall add the node at the root with the schema's
properties, resolved for the workfile's board, and, for a driver, name the
driver on it so that nothing below it is guessed.

### 12.3 Bootstrap

**ADD-520** Where the `bootstrap` setting is `true` (the default), after
adding, the CLI shall run bootstrap over the whole workfile: fill every
value that has a default or one possible value, create or connect the nodes
those values need, decide the chip select and the wiring where the board
settles them, and delete the nodes it made that nothing uses any more. It
shall stop at what is a choice (several nodes could be named). Where it is
`false`, nothing is filled.

**ADD-521** If bootstrap fails, then the CLI shall refuse with `Added
'<name>', but bootstrap failed: <problem>`, and write nothing (open issue
A-8).

**ADD-522** The CLI shall then write the workfile once (`02-common.md`
COM-513) and validate it (`validate.md` VALIDATE-500).

### 12.4 Result

**ADD-523** While in JSON mode, the CLI shall respond with an object
conforming to `add.schema.json#/$defs/noos`, `severity` `info`:

| Field | Value |
|---|---|
| `message` | `Added '<name>' (<what>) and <n> node[s] below it; <state>`, or `Added '<name>' (<what>)` where bootstrap is off |
| `key` | `<device>` as given |
| `path` | `[<name>]` |
| `missing_required` | §12.5: the open items of the nodes `add` made (the new node, the `--as` nodes, the eval board's, and those bootstrap created); `[]` where bootstrap is off |

`<what>` is the schema, or `<schema>, for driver <driver>` for a driver or
an eval board. `<n>` counts the stored nodes bootstrap created. `<state>` is
`the workfile is valid`, or `<e> problem[s] left - run: analog-attach
validate`, `<e>` the errors of VALIDATE-500.

**ADD-524** While in human mode, the CLI shall write to standard output the
lines `Added '<name>' (<what>)`, `Added '<side>' on the same chip` for each
further `--as` node, `On eval board '<node>' (<eval board>)` for an eval
board, `  <workfile path>`, the bootstrap report (ADD-525), an empty line,
and `The workfile is valid.` or `<e> problem[s] left. Run: analog-attach
validate`.

**ADD-525** The bootstrap report shall be these blocks, each after an empty
line, and only those that have entries:

| Block | Heading, then the rows |
|---|---|
| Revised | `Bootstrap brought its own values in line with the current rules:`; `  * <node>.<property> <old> -> <new>`, or `  - <node>.<property> <old> (no longer applies, removed)` |
| Deleted | `Bootstrap deleted what nothing uses any more:`; `  x <node>` |
| Kept | `'<node>' is no longer used, but holds values you set, so it was kept.` and `  Delete it with: analog-attach delete <node>` |
| Filled | `Bootstrap filled in defaults, values with only one option, and the nodes they need:`; `  + <node> (<schema>) for <node>.<property>[.<member>]` for each node created, `  > <node>.<property>[.<member>] <node> (already in the workfile)` for each existing node connected, `  ~ <node> (from the board/driver, not stored)` for each external node named, `  = <node>.<property> <value> (<from>)` for each value filled, `<from>` `default` or `only value` |
| Chip select | `Chip-select for <node>: <how>`, `<how>` `native line <n> of <peripheral>`, `GPIO <port> pin <n>, at <board pin>` or `unresolved` |
| Wiring | `Wire <part> to <board> over <BUS> (<peripheral>):` and `  <connector> pin <pin> (<role>) -> <board pin>` per connection, or `Wiring <part> over <BUS> (<peripheral>):` with none; then `  ! <problem>` per problem, `  Its bus is on: <SIGNAL> <board pin>, …`, and with free chip-select pins `  Free pins for its chip-select: <board pin> = <port> <n>, …` (six at most, then `, and <k> more`) and `  To use one: add a pin node, set its port_handle and number, and point <device>.cs_gpio at it.` |
| Choices | `Bootstrap stopped at what is a choice - pick one each:`; `  ? <node>.<property>[.<member>] <option> \| <option> …` (`nothing configured provides one` when none); then `  e.g. analog-attach update <node> <property> [<member> ]<option>` for the first that has options |
| Still needed | `Still yours to set - required, and nothing to fill them from:`; `  ! <node>.<property> <kind> <about>[ (you cleared it)]`; then `  e.g. analog-attach update <node> <property> <value>   ('analog-attach read <node> <property>' says more)` for the first |

`<node>.<property>` columns are padded to 32 characters, `<kind>` (`number`,
`string`, `include`, …) to 8. `<board pin>` is `<connector> pin <pin>`,
followed by ` (<chip pin>)` when the board's pinout names the chip pin.
`<about>` is the validator's reason when it says more than "required", else
the property's description, else `no description`. In the e.g. lines,
`<value>` is literal. The blocks cover the whole workfile, not only the nodes
`add` made (open issue A-7).

### 12.5 Missing required values

**ADD-526** The open items shall be, in this order: the choices bootstrap
stopped at, each `{ node, property, description?, suggestions }` with the
options as suggestions (`property` `<property>.<member>` and each suggestion
`<member> <option>` for a union member); then the required values still
empty that no rule could fill, read from validation (VALIDATE-500), each
with the values `list value` suggests (`list.md` LIST-530). `description` is
the validator's reason, else the property's description, when either says
something.

### 12.6 The interview

**ADD-530** While in human mode, in a terminal run without `--quiet`, where
the `interview` setting is `true` (the default), after writing the lines of
ADD-524 the CLI shall ask for the open items of the whole workfile
(ADD-526: choices with options first, then values), one at a time, running
bootstrap again after each answer, since one answer can settle others. With
`--json`, `--quiet`, a run that isn't a terminal run or `interview` `false`,
it shall only list them (ADD-524).

**ADD-531** When there are open items, the CLI shall first write an empty
line and `A few things only you can tell (Ctrl+C stops; what is answered is
kept)`, the first part bold and the parenthesis dim.

**ADD-532** For a choice, the CLI shall ask the list question `<node>.<property>[.<member>]:
pick one`, one choice per option and last `Skip for now`, twelve rows at a
time.

**ADD-533** For a value, when `list value` suggests any, the CLI shall ask
the list question `<node>.<property> (<kind>): <about>`, one choice per
suggestion, then `Type a value…` and `Skip for now`. With no suggestion, or
after `Type a value…`, it shall ask the line question `<node>.<property>
(<kind>): <about> (empty to skip)`, refusing a value `update` would refuse
(`update.md` UPDATE-510) and taking an empty answer as a skip. `<about>` is as
in ADD-525, `required` when there is nothing else to say.

**ADD-534** The CLI shall set each answer as `update` sets a value (a union
member's answer as `<member>,<option>`), write the workfile, and write
`✓ <node>.<property>[.<member>] = <answer>`. If setting it fails, then the
CLI shall write `  <node>.<property>: <problem>` (red) and skip the item. A
skipped item isn't asked again in the same run.

**ADD-535** When no open item is left, the CLI shall write an empty line and
`The workfile is valid.` or `<e> problem[s] left. Run: analog-attach
validate`, and exit with status 0. When nothing was answered, it shall write
nothing more.

**ADD-536** When the user stops a question (Ctrl-C or Ctrl-D), the CLI shall
write the workfile with what was answered, then an empty line and `Stopped.
` followed by the line of ADD-535, and exit with status 0: the node is
added.

## 13. Open issues

**A-1. Human-mode refusals exit 0.** See C-1 in `02-common.md`.

**A-2. The parent-not-found message differs between modes.** JSON mode
says `Parent node <parent> not found` and human mode `Couldn't find parent
node <parent> in <base> or <overlay>` (ADD-030).

**A-3. Valid parents come from the base only.** A bus the overlay adds is
never a valid parent (ADD-020 to ADD-022), so a device whose only bus is in
the overlay goes under `/` with no note. `--parent` accepts it.

**A-4. `adi,ad5593r` gets SPI parents.** It shares the ad5592r binding, which
allows SPI, so `list parent` and ADD-022 offer SPI buses for an I2C device.

**A-5. The duplicate refusal names the parent in a form the user didn't
see.** ADD-050 shows the parent ADD-022 chose by its absolute path, while
ADD-022's note names it by its label. For an overlay template it shows
the fragment's target as the template overlay writes it, which can be a
label of that overlay and means nothing in the workspace: `add adi,adxl345
--template overlay:i2c-sensor`, run twice, gives `i2cbus already has a child
named adxl345@53` (`i2cbus` is a label of `i2c-buses.dtsi`; the node is under
`/soc/i2c@7e804000`). A fix would be to name the parent by its label in the
merged tree, or its path, in every case.

**A-6. A child with an unreadable `reg` frees its address.** (From the
source, not reproduced.) ADD-047 falls back to the unit address only when a
child has no `reg`. A child whose `reg` can't be read (its first `<…>`
doesn't start with `#address-cells` numbers) occupies nothing, so `add` may
pick the address its unit address names. A fix would be to fall back to the
unit address whenever the `reg` can't be read.

**A-7. The human report and the interview cover the whole workfile, the
JSON list only what `add` made.** The bootstrap report (ADD-525) and the
interview (ADD-530) take every open item of the workfile, so after `add
testpart --name tp2` they also list `mydev.native_cs` and `mydev.cs_gpio`
of the existing node it connected, while `missing_required` has only the
items of the nodes `add` created (ADD-523), here none. A fix would be one
rule for both: the new nodes and those they connect to.

**A-8. A failed bootstrap says the node was added.** ADD-521 refuses with
`Added '<name>', but bootstrap failed: …` although nothing is written. A fix
would be `Cannot add '<name>': bootstrap failed: …`, or to write the node
without bootstrap's changes.

## 14. Examples

```
$ analog-attach add adi,ad7124-8 --parent spi0 </dev/null
Picked chip select 2 (taken: 0 by spidev@0, 1 by spidev@1).
To change it: rename ad7124_8 adi,ad7124-8@<n>
warning: chip select 2 has no cs-gpios entry: spi@7e204000 has chip selects 0-1
  Use one of those, or add a GPIO for it to cs-gpios of /soc/spi@7e204000
Added adi,ad7124-8@2 (label: ad7124_8) to /work/overlay.dtso
Missing required: interrupt-parent, interrupts
Set them with: update ad7124_8 <property> <value>
```

(The first four lines are on standard error.)

```
$ analog-attach --json add adi,ad7124-8 --parent spi0
{"ok":true,"message":"Added adi,ad7124-8@3 (label: ad7124_8_1)","severity":"info",
 "key":"adi,ad7124-8@3","path":["soc","spi@7e204000","adi,ad7124-8@3"],"template":"required",
 "missing_required":[
   {"property":"interrupt-parent","suggestions":[
     {"value":"gicv2","display_string":"gicv2 — interrupt controller, #interrupt-cells = <3>; inherited from /"},
     {"value":"gpio","display_string":"gpio — interrupt controller, #interrupt-cells = <2>"},
     {"value":"aon_intr","display_string":"aon_intr (disabled)","note":"disabled"}]},
   {"property":"interrupts","description":"IRQ line for the ADC","suggestions":[]}]}
```

(Wrapped here; the CLI writes one line. The notes go to standard error.)

Where the backend is noos:

```
$ analog-attach add eval-testpart </dev/null
Added 'testpart' (test_sensor, for driver testpart)
On eval board 'eval_testpart' (eval-testpart)
  /home/u/proj/workfile.json

Bootstrap filled in defaults, values with only one option, and the nodes they need:
  + testpart_cfg                     (test_sensor_config) for testpart.$init_param
  + testpart_ip                      (testpart_init_param) for testpart_cfg.extra
  + testpart_spi_dev                 (test_spi_device) for testpart_ip.comm_init.spi_dev
  ~ testpart_ops                     (from the board/driver, not stored)
  ~ bsp_test_spi_cfg_handle          (from the board/driver, not stored)
  = testpart_ip.comm_type            TESTPART_SPI (default)
  = testpart_ip.dev_ready            true (default)
  = testpart_spi_dev.max_speed_hz    1000000 (default)
  = testpart_spi_dev.mode            TEST_SPI_MODE_0 (only value)
  = testpart_spi_dev.native_cs       0x1 (only value)

Chip-select for testpart_spi_dev: native line 0 of bsp_test_spi_cfg

Wire eval-testpart to testboard over SPI (bsp_test_spi_cfg):
  P1 pin 2 (spi_mosi)      -> PMOD pin 2 (T0_5)
  P1 pin 3 (spi_miso)      -> PMOD pin 3 (T0_6)
  P1 pin 4 (spi_sck)       -> PMOD pin 4 (T0_7)
  P1 pin 1 (spi_cs)        -> PMOD pin 1 (T0_4)

The workfile is valid.
```

```
$ analog-attach --json add test_gpio_pin
{"ok":true,"message":"Added 'test_gpio0' (test_gpio_pin) and 0 nodes below it; 2 problems left - run: analog-attach validate",
 "severity":"info","key":"test_gpio_pin","path":["test_gpio0"],
 "missing_required":[
   {"node":"test_gpio0","property":"port_handle","description":"Port this pin belongs to",
    "suggestions":[{"value":"bsp_test_gpio0_cfg_handle"},{"value":"bsp_test_gpio1_cfg_handle"}]},
   {"node":"test_gpio0","property":"number","description":"Pin number within its port","suggestions":[]}]}
```

(Wrapped here; the CLI writes one line.)

```
$ analog-attach --json add dualpart
{"ok":false,"message":"Driver 'dualpart' can be added as test_adc or test_dac (test_adc, test_dac). Pass --as test_adc or --as test_dac, or --as test_adc,test_dac for all of them on one chip","severity":"error"}
$ analog-attach add test_adc --as adc
--as picks a driver's interface, and 'test_adc' is a schema, not a driver
                                                   (stderr, exit 2)
```

On a terminal, the interview follows the report (`add test_gpio_pin`):

```
…
2 problems left. Run: analog-attach validate

A few things only you can tell (Ctrl+C stops; what is answered is kept)
? test_gpio0.port_handle: pick one
❯ bsp_test_gpio0_cfg_handle
  bsp_test_gpio1_cfg_handle
  Skip for now
✓ test_gpio0.port_handle = bsp_test_gpio0_cfg_handle
? test_gpio0.number (number): Pin number within its port (empty to skip) 3
✓ test_gpio0.number = 3

The workfile is valid.
```
