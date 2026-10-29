# update

Sets a property of a node, sets a flag, reads a property, or creates a child
node. A shared command: §2 to §8 as the linux backend does it, §9 as the
noos backend does it (it sets, reads, or with `--suggest` lists the values
of one property; there are no flags and no child nodes).

## 1. Synopsis

```
analog-attach [--json] update <path> <property> [<value>...] [--quiet]
analog-attach [--json] update <path> <child-name>            [--quiet]
analog-attach [--json] update <node> <property> [<value> | <member> <value>] [--quiet]
analog-attach [--json] update <node> <property> [<member>] --suggest     # noos
```

Grammar: rule `update` in `01-grammar.abnf`. Values: `value` (GRM-070 to
GRM-072).

| Argument | Meaning |
|---|---|
| `<path>` | The node: a node path (GRM-020). It may be a base node, an overlay node, or a base node the overlay changes. |
| `<property>` | The property name. A name with `@` may be a child node instead (§8). |
| `<value>...` | The value tokens. Without any, `update` sets a flag or reads (§5). A value starting with `-` needs `--` before it (GRM-012): `update adc offset -- -5`. |
| `--quiet` | When reading: as `read --quiet`, leave out what the binding says (description, suggestions, a child's missing required properties). When creating a child: list its missing required properties instead of asking. |

## 2. Terms

| Term | Meaning |
|---|---|
| Target node | The node `<path>` resolves to (GRM-025 to GRM-027), in the overlay or the base. |
| Base target | A target node that the base has, whether or not the overlay already changes it. |
| Overlay node | A target node that only the overlay has (the overlay adds it). |
| Definition | What the target node's binding says about `<property>`: by name, else by a property pattern of the binding. |
| Shape hint | What the definition gives the value: `flag`, `strings` (a string or list of strings, string enums included), `cells` (numbers, references, matrices), or none (no binding, no definition, or an untyped one). The hint shapes the value and never refuses it, except for `flag` (UPDATE-030). |
| Merged node | The target node as the base and the overlay together have it. |

## 3. Resources

The command needs the bindings, the base and the overlay (COM-070). It never
creates the workfile: with none configured it reports the configuration error
`Missing config field workfile` (COM-071, COM-072).

## 4. Before the workspace

**UPDATE-001** If `<path>` is missing, then the CLI shall report the input
error `Missing: path`. If `<property>` is missing, then the CLI shall report
the input error `Missing: property name`. Both go to standard error with
status 2, in both modes (COM-031).

**UPDATE-002** The CLI shall check `<path>` per GRM-020 to GRM-024 and report
an input error when it fails. It shall not apply GRM-030 to `<property>`
(Open issue U-5).

**UPDATE-003** If the target node exists in neither the overlay nor the base,
then the CLI shall refuse with `Not found: <path>`. When the text after the
last `/` of `<path>` names no node but the text before it does, the message is
`Not found: <path> (the property is a separate argument: <path> <property>)`,
where the first `<path>` is the placeholder and `<path> <property>` after
`argument: ` is literal.

## 5. What `update` does

**UPDATE-010** When `<property>` contains `@`, the CLI shall first apply §8.
It shall apply UPDATE-011 to UPDATE-014 only when §8 doesn't handle it.

**UPDATE-011** When no value is given and the shape hint is `flag`, the CLI
shall set the flag (UPDATE-020).

**UPDATE-012** When no value is given and there is no shape hint, the CLI
shall read the property (§7) if the merged node has it with a value, and set
it as a flag (UPDATE-020) otherwise. A property that is already a flag is set
again: `update` doesn't read flags.

**UPDATE-013** When no value is given and the shape hint is `strings` or
`cells`, the CLI shall read the property (§7).

**UPDATE-014** When values are given, the CLI shall set the value (§6), or
refuse per UPDATE-030 when the shape hint is `flag`.

### 5.1 Schema diagnostics

**UPDATE-015** When values are given, the CLI shall write one line to
standard error in both modes when the value can't be checked against a
binding, and then go on:

| Case | Line |
|---|---|
| No binding resolves for the target node | `Property <property> written without schema validation: <reason>` (`<reason>` for example `No binding found for spidev`) |
| The binding's `if`/`then` branches can't be resolved | `Property <property> written without schema validation: failed to narrow binding` |
| The binding doesn't define the property | `Property <property> not defined by <compatible> binding; written without schema validation`, or `… not defined by pattern "<pattern>" of <compatible>; …` for a child node matched by its parent's pattern |

These lines don't make the response a warning (UPDATE-091).

## 6. Setting

### 6.1 Flags

**UPDATE-020** When setting a flag, the CLI shall write `<property>;` to the
node (§6.4), check and write the overlay (UPDATE-060), and report `Set flag
<property> on <path>`.

### 6.2 The value

The CLI joins the value tokens with one space and parses them into rows of
cells (GRM-070 to GRM-072). This section says what each cell becomes.

**UPDATE-030** If the shape hint is `flag` and a value is given, then the CLI
shall refuse with ``<property> is a flag: `update <path> ` sets it, `delete
<path> ` clears it`` (sic, Open issue U-2). Only the first `<property>` is a
placeholder: both `<path>` are literal.

**UPDATE-031** Where the shape hint is `strings`, the CLI shall write each
whitespace-separated word of the joined value as a string, `,` included: one
word gives a string (`"okay"`), several give a string list (`"a", "b"`).
Words that are numbers, macros or labels stay strings. If the joined value is
empty or only whitespace (`update n p ""`), then the CLI shall refuse with
`Value must not be empty`.

**UPDATE-032** Where the shape hint is `cells`, the CLI shall resolve each
cell by UPDATE-034 and write the rows as cell arrays: one row as `<…>`,
several as `<…>, <…>`. If a cell doesn't resolve, then the CLI shall refuse
with `'<cell>' is not a number, a known macro, or a label in the base
tree/overlay`, naming the first such cell. An empty value (`""`, or only
whitespace) has no cells and is written as the empty cell list `<>`, without
a refusal; it counts as 0 values for UPDATE-040 (Open issue U-13).

**UPDATE-033** Where there is no shape hint, the CLI shall infer:

| Value | Written as |
|---|---|
| Empty, or only whitespace | The empty cell list `<>` (Open issue U-13) |
| One decimal number | One cell |
| One word that resolves (UPDATE-034) | One cell |
| One word that doesn't resolve | A string |
| Several cells, all resolving | Cells, per UPDATE-032 |
| Several cells, none resolving | A string list of every cell, the rows' `,` dropped |
| Several cells, some resolving | Refused, per UPDATE-032's message for the first that doesn't |

A `,` always separates rows (GRM-070), so a word that contains one is
several cells here: `adi,ad7124-8` with no shape hint is written
`"adi", "ad7124-8"` (Open issue U-15).

**UPDATE-034** The CLI shall resolve a cell as follows, in order:

1. a decimal number (`dec-int`): the number;
2. a hexadecimal number (`hex-int`): the number, written in hexadecimal
   (`0X1f` is written `0x1f`);
3. one of the macros below: its numeric value, written as the number (the
   macro name isn't kept);
4. a word that names a node of the base or the overlay, with or without a
   leading `&`: a reference `&<word>` to it;
5. otherwise it doesn't resolve.

| Macros | Values |
|---|---|
| `IRQ_TYPE_NONE`, `IRQ_TYPE_EDGE_RISING`, `IRQ_TYPE_EDGE_FALLING`, `IRQ_TYPE_EDGE_BOTH`, `IRQ_TYPE_LEVEL_HIGH`, `IRQ_TYPE_LEVEL_LOW` | 0, 1, 2, 3, 4, 8 |
| `GPIO_ACTIVE_HIGH`, `GPIO_ACTIVE_LOW`, `GPIO_PUSH_PULL`, `GPIO_SINGLE_ENDED`, `GPIO_LINE_OPEN_SOURCE`, `GPIO_LINE_OPEN_DRAIN`, `GPIO_OPEN_DRAIN`, `GPIO_OPEN_SOURCE`, `GPIO_PERSISTENT`, `GPIO_TRANSITORY`, `GPIO_PULL_UP`, `GPIO_PULL_DOWN`, `GPIO_PULL_DISABLE` | 0, 1, 0, 2, 0, 4, 6, 2, 0, 8, 16, 32, 64 |

The CLI doesn't check that a number fits a 32-bit cell (Open issue U-7). A
word in step 4 may be a label or a path, but `&{/path}` doesn't resolve, and a
path is written as `&/path`, which the reparse check refuses (Open issue U-6).

### 6.3 Value count

**UPDATE-040** When the definition bounds the number of values (minItems /
maxItems of a value array, or of a specifier list whose entries have a known
width, such as `interrupts` under a known interrupt parent), and the written
value has a count outside them, the CLI shall write the value and give the
warning `warning: <property> takes <bound>, got <count>`. `<bound>` is
`<n> value` or `<n> values` for a fixed count, `<min> to <max> values`, or
`at least <min> values`. `<count>` counts every cell and every string. Lists
whose entries name a phandle (`clocks`, `dmas`, `*-gpios`) have no bounds.

### 6.4 Where the value goes

**UPDATE-050** Where the target node is a base target, the CLI shall write the
property into the overlay's fragment for that node, matched by the node its
target resolves to (`&i2c_arm` and `&i2c1` are one node). When the overlay
has no fragment for it, the CLI shall add one, in the configured overlay
syntax (02-common.md §8.3).

**UPDATE-051** Where the target node is an overlay node, the CLI shall write
the property into the overlay node or fragment that already holds it (the one
whose value applies, when several do), or into the node itself when none
holds it.

**UPDATE-052** When the property already exists where UPDATE-050 or UPDATE-051
writes, the CLI shall replace its value in place, keeping its position.
Otherwise it shall append the property to the node's properties.

### 6.5 Writing

**UPDATE-060** Before writing, the CLI shall print the whole overlay and parse
it again against the base. If that fails, then the CLI shall refuse with
`Update would produce an unreadable overlay: <error>` and leave the file as it
was.

**UPDATE-061** When the check passes, the CLI shall write the overlay file.

**UPDATE-062** On success, the CLI shall report `Set <property> on <path>`,
followed by `; renamed to <key>` when UPDATE-071 renamed the node. `<path>` is
`<path>` as given.

### 6.6 reg and the unit address

**UPDATE-070** When `<property>` is `reg` and the target node is an overlay
node, the CLI shall read the new address from the first `#address-cells`
cells of `reg` (the parent's count, as ADD-048 finds it) and compare it with
the node's unit address. The unit address is read and written in decimal
when the parent's binding names this child in decimal (a pattern such as
`^channel@([0-9]|1[0-5])$`), and in hexadecimal otherwise.

**UPDATE-071** When the address differs from the unit address, or the node has
none, the CLI shall rename the node to `<name>@<address>`, its children moving
with it.

**UPDATE-072** If a sibling in the merged tree already has the name
`<name>@<address>`, then the CLI shall refuse with `reg update would create a
naming conflict; not written`.

**UPDATE-073** When `reg` has cells that aren't numbers, the CLI shall write
it, keep the name, and write `reg contains non-numeric cells; node not
renamed` to standard error.

**UPDATE-074** When `<property>` is `reg` and the target node is a base
target, the CLI shall write it, keep the name, and write `an overlay can't
rename a base node; reg written but name unchanged` to standard error.

**UPDATE-075** After writing `reg`, the CLI shall give the address warnings for
the node: clashes with siblings at the same address, and a chip select its
controller's `cs-gpios` lacks. Their wording is in `validate.md`.

### 6.7 interrupts and interrupt-parent

**UPDATE-080** When `<property>` is `interrupts`, the value was built (§6.2,
cells or strings), the target node was in the overlay before this command
(Open issue U-8), and that overlay node has no `interrupt-parent`, the CLI
shall look up the interrupt parent the node inherits in the base tree.
Starting at the node's parent and going up, the first node that has
`#interrupt-cells` is the interrupt parent, and the first that has an
`interrupt-parent` the base can resolve gives the node it references. That
node (the controller, or the one with `interrupt-parent`) is `<from>`. The
overlay's nodes and properties, and the target node's own base
`interrupt-parent`, aren't looked at (Open issue U-12).

**UPDATE-081** When an interrupt parent is inherited and it has a label, the
CLI shall write `interrupt-parent = <&<label>>` to the node (§6.4) and add the
detail `Set interrupt-parent = <&<label>> on <node path> (inherited from
<from>)`, `<node path>` being the absolute path. The `<&` and `>` around
`<label>` are literal.

**UPDATE-082** When UPDATE-081 applies and the interrupt parent's
`#interrupt-cells` differs from the number of cells in the first row of
`interrupts`, the CLI shall give the warning `<label> has #interrupt-cells =
<<n>> but interrupts has <m> cells; set interrupt-parent explicitly`. The
outer `<` and `>` around `<n>` are literal. A value written as strings has no
cell row and gets no warning.

**UPDATE-083** If no interrupt parent is inherited, then the CLI shall give the
warning `No interrupt-parent inherited for <node path>; set one: update <node
path> interrupt-parent <controller>`, where `<controller>` is literal. If the
inherited one has no label, then the CLI shall give the warning `Inherited
interrupt-parent at <from> has no label; cannot write &{/path} in a plugin`.
In both cases `interrupts` is still written.

### 6.8 Output of a set

**UPDATE-090** While in human mode, the CLI shall write the report
(UPDATE-020, UPDATE-062) to standard output, then the detail of UPDATE-081, if
any, on its own line.

**UPDATE-091** In both modes, the CLI shall write the diagnostics and warnings
of UPDATE-015, UPDATE-040, UPDATE-073 to UPDATE-075 and UPDATE-082 to
UPDATE-083 to standard error, before the report (COM-021, COM-022).

**UPDATE-100** While in JSON mode, on a set the CLI shall respond `{ "ok":
true, "message": <report>, "severity": <severity> }`, conforming to
`04-protocol/update.schema.json#/$defs/set`. `<report>` is the report,
followed by `; ` and the detail of UPDATE-081 when there is one. `<severity>`
is `"warn"` when a warning of UPDATE-040, UPDATE-075, UPDATE-082 or UPDATE-083
was given, and `"info"` otherwise.

## 7. Reading

**UPDATE-110** When §5 reads, the CLI shall show the property as `read <path>
<property>` shows it (`read.md`), from the merged node. If the merged node
doesn't have the property, then the CLI shall refuse with `Not found:
<property> on <path>`.

**UPDATE-111** While in human mode, the CLI shall write the property as a DTS
line (`spi-max-frequency = <1000000>;`). Without `--quiet`, the line ends
with `   // base` when its value comes from the base, and the binding's
description, allowed values, suggestions and providers to add follow it
(READ-032). With `--quiet`, the DTS line is all.

**UPDATE-112** While in JSON mode, the CLI shall respond with the property
object of `04-protocol/read.schema.json#/$defs/read-property`: `kind`,
`key`, `type`, `value`, `source` (`base` or `overlay`), and, without
`--quiet`, `description` when the binding gives one and `suggestions` (`{
values, can_create }`, READ-035) when there are any.

**UPDATE-113** When reading, the CLI shall write nothing to the overlay and
give no diagnostics of UPDATE-015.

## 8. Child nodes

Applies when `<property>` contains `@`.

**UPDATE-120** When the merged node has a child named `<property>`, whether
the overlay adds it, changes it, or only the base has it, and no value is
given, the CLI shall show the child as `read <path>/<property>` shows it
(`read.md` READ-022 to READ-026, `--quiet` included). In JSON mode that is
read's node (`04-protocol/read.schema.json#/$defs/read-node`).

**UPDATE-121** When the merged node has a child named `<property>` and values
are given, the CLI shall refuse with UPDATE-122's message and write nothing.

**UPDATE-122** When the target node has no such child and `<property>`
matches a child-node pattern of the target node's binding:

- If values are given, then the CLI shall refuse with ``<property> is a child
  node; set its properties with `update <path>/<property> <prop> <value>` ``.
  `<prop>` and `<value>` are literal.
- Otherwise the CLI shall create the child (UPDATE-123).

**UPDATE-123** When creating a child `<name>@<unit>`, the CLI shall add an
empty node `<name>@<unit>` without a label under the target node (into the
overlay per UPDATE-050 or UPDATE-051). When `<unit>` is a number in the radix
of UPDATE-070, the CLI shall also write `reg` for it (as ADD-048 encodes it)
and add to an overlay-only parent whichever of `#address-cells = <1>` and
`#size-cells = <0>` it lacks (ADD-049). The CLI shall then write the overlay
and report `Added <property> to <path>`.

**UPDATE-124** When `<property>` contains `@` and neither UPDATE-120 to
UPDATE-122 applies (no binding, or no pattern matches), the CLI shall handle
it as a property name by §5. With no value that sets a flag named
`<property>` (Open issue U-4).

### 8.1 The child's missing required properties

**UPDATE-125** After creating the child, the CLI shall find its missing
required properties as `add` does (`add.md` §11) and:

- in JSON mode, respond conforming to
  `04-protocol/update.schema.json#/$defs/child-created`: `ok` true, `message`
  the report of UPDATE-123, `severity` `"info"`, `path` the child's path, and
  `missing_required` per ADD-110;
- in a human-mode run that isn't a terminal run, or with `--quiet`, list them
  per ADD-111, naming the child `<path>/<property>`;
- in a terminal run without `--quiet`, fill the pinned values per ADD-112 and
  run the interview per ADD-115 to ADD-125. ADD-113 and ADD-114 (values from
  the binding's examples) don't apply.

## 9. Where the backend is noos

A node's properties are its schema's, so `update` sets one of them and never
adds one. `<node>` is a node name (GRM-080); GRM-070 to GRM-074 don't apply:
the value is parsed by the property's kind (UPDATE-510).

**UPDATE-500** If `<node>` or `<property>` is missing, then the CLI shall
report the input error `Nothing to update: pass <node> <property> <value>.
Use 'analog-attach read' to see the nodes and 'analog-attach read <node>' to
see their properties.`, `<node>`, `<property>` and `<value>` literal.

**UPDATE-501** If more than two values are given, then the CLI shall report
the input error `Too many values for <node>.<property>: pass one value, a
comma-separated list, or a union's member and its value`. Two values are a
union's member and its value, written `<member>,<value>` (UPDATE-510).

**UPDATE-502** The checks of UPDATE-500 and UPDATE-501 come before the
workfile is loaded; the CLI then loads it (`02-common.md` COM-512).

**UPDATE-503** If `<property>` is `$compatible`, `platform` or `board`, then
the CLI shall refuse with `'<property>' describes the node rather than
configuring it, and cannot be set`.

**UPDATE-504** If `<node>` names no node, then the CLI shall refuse as
`read` does (`read.md` READ-505); if it names an external node, with `Node
'<node>' has no properties to configure`.

**UPDATE-505** The property shall be found as `read` finds it (READ-504:
`init_param` is `$init_param`). If the schema has no such property, then the
CLI shall refuse with `'<node>' has no property '<property>', and one cannot
be added: its properties are fixed by its schema (<schema>). Available:
<names>`.

**UPDATE-510** The CLI shall parse the value by the property's kind, and
report a value it can't parse as an input error (COM-031):

| Kind | Accepted | Message when not |
|---|---|---|
| number | anything JavaScript's `Number` reads (`3`, `0x10`, `1e3`) | `'<value>' is not a number` |
| boolean | `true`, `1`, `false`, `0`, in any case | `'<value>' is not a boolean (expected true or false)` |
| enum | one of the options, or a number equal to a numeric one | `'<value>' is not one of: <options>` (joined with `, `) |
| union | `<member>` or `<member>,<value>` | `'<member>' is not a member of '<property>'. Available: <members>`, or `'<value>' has <n> elements; a union takes <member> or <member>,<value>` |
| array | elements separated by `,` (or a JSON array), each parsed by the element's kind, at most the array's size | `'<property>' holds at most <size> elements, got <n>` |
| any other (include, string, raw, …) | the text as given | — |

`<member>` and `<value>` in the union's second message are literal. A
union member given alone is set with no value.

**UPDATE-511** The CLI shall not check that a value naming a node (an
include, a union member's value) names one: `validate` reports it
(`Target symbol '<name>' not found`, VALIDATE-500; open issue U-16).

**UPDATE-520** The CLI shall set the value as the user's (bootstrap no longer
changes it), run bootstrap (`add.md` ADD-520) with the nodes that were
referenced before, so that a node the change left unused is deleted, and
write the workfile. It shall answer `Set <node>.<property> = <value>`,
`<property>` the property's full name (`$init_param`) and `<value>` as
stored, a union's as `<member> = <value>`: in JSON mode with `severity`
`info` (`update.schema.json#/$defs/noos`), in human mode followed by the
bootstrap report (`add.md` ADD-525).

**UPDATE-521** If setting the value or bootstrap fails, then the CLI shall
refuse with the problem, or `Set <node>.<property> = <value>, but bootstrap
failed: <problem>`, and write nothing.

**UPDATE-530** With `--suggest`, the CLI shall answer what `list value
<node> <property> [<member>]` answers (`list.md` LIST-530), the one value
being the union member. If two values are given, then the CLI shall report
the input error `--suggest takes at most a union member after the
property`.

**UPDATE-540** Without a value, the CLI shall read the property as `read
<node> <property>` does (`read.md` READ-503, READ-513), `--quiet` included.

## 10. Open issues

**U-1.** *Fixed.* (`update` wrote its warnings to standard error and `add`
to standard output in human mode. Every command now writes them to standard
error, COM-022.)

**U-2. The flag refusal has no property name.** UPDATE-030's message reads
``spi-cpol is a flag: `update <path> ` sets it, `delete <path> ` clears it``:
the commands it suggests lack the property.

**U-4. A name with `@` becomes a flag.** `update spi0 adc@5` (no binding
pattern matches), or `update adc channel@99` (outside `^channel@([0-9]|1[0-5])$`),
writes the flag property `adc@5;` (or `channel@99;`), which dtc rejects
(`Bad character '@' in property name`). `validate` reports it as a `dtc
error` only for a flag inside a node the overlay adds (`channel@99` in
`adc`): it doesn't check the properties of a base node's fragment, so
`adc@5;` under `spi0` passes `validate` and fails later in dtc.

**U-5. Property names aren't checked.** GRM-030 isn't applied: `update adc
spi0/x 1` gets as far as the reparse check (`Update would produce an
unreadable overlay: … '/' …`) instead of `pass node and property separately`,
and `update adc "" 1` gives `Update would produce an unreadable overlay: …
Failed to consume specific char token: '=' …` instead of `Missing: property
name`.

**U-6. Paths as references.** A word that is a node path (`/soc`) resolves in
UPDATE-034 step 4 and is written `&/soc`, which the reparse check refuses.
`&{/soc}`, the DTS form, doesn't resolve: with a `cells` shape hint it is
refused as unknown (`update adc interrupt-parent '&{/soc}'`), and with no
hint it is written as the string `"&{/soc}"` (UPDATE-033).

**U-7. Numbers aren't range-checked.** `99999999999999999999` is written as a
cell as is. dtc fails on it later.

**U-8. No implicit interrupt-parent on a base node the overlay doesn't
change yet.** UPDATE-080 needs the node to be in the overlay before the
command, so `update spidev1 interrupts 3 4` on an untouched base node writes
no `interrupt-parent`, while the same command on a base node the overlay
already has a fragment for does.

**U-10. A refused value stays in memory.** (From the source, not reproduced.)
UPDATE-060 and UPDATE-072 refuse after the value has been placed in the
in-memory overlay. A single `update` exits without writing, but the `add`
interview (ADD-123) keeps the same overlay, so a later successful answer
writes the refused value when the user skips (`-`) the refused property.

**U-11. The interrupt cell check looks at the first row only.** UPDATE-082
compares `#interrupt-cells` with the first row's cell count, so `interrupts
= <1 2>, <3>` passes against two cells.

**U-12. The inherited interrupt-parent ignores the overlay and the node's own
base value.** UPDATE-080 walks the base tree from the node's parent up, and
resolves an ancestor's `interrupt-parent` in the base only. After `update
spi0 interrupt-parent gpio`, `update dac interrupts 5 2` still writes
`interrupt-parent = <&gicv2>` (inherited from `/`), which overrides what the
overlay set on `spi0`. `hdmi0` has `interrupt-parent = <&aon_intr>` in the
base; after `update hdmi0 status okay`, `update hdmi0 interrupts 1` writes
`interrupt-parent = <&gicv2>` into the fragment, replacing the node's own
parent. The lookup also runs for a value that isn't cells: `update spidev1
interrupts hello` (spidev1 already in the overlay) writes `interrupts =
"hello"` and an `interrupt-parent`. A fix would be to start at the node
itself and walk the merged tree (the lib's `overlay_lookup`, which nothing
uses yet), and to skip the lookup when `interrupts` isn't cells.

**U-13. An empty value is written as `<>`.** Only the `strings` shape hint
refuses an empty value (UPDATE-031). With the `cells` hint or none,
`update adc spi-max-frequency ""` replaces the value with
`spi-max-frequency = <>;`, and `update adc foo ""` writes `foo = <>;`. Only
a binding that bounds the count says anything (`warning: diff-channels takes
2 values, got 0`). A fix would be to refuse an empty value whatever the hint, with
UPDATE-031's `Value must not be empty`.

**U-15. With no shape hint a `,` splits a word.** `,` separates rows
(GRM-070), and a row of words that don't resolve becomes strings
(UPDATE-033). So on a node whose binding doesn't resolve, `update n
compatible adi,ad7124-8` writes `compatible = "adi", "ad7124-8";`, which
names no binding. A fix would be to keep a value with no resolving cell as
one string per whitespace-separated word, `,` included, as UPDATE-031 does.

**U-16. A reference to a node that doesn't exist is accepted.** Where the
backend is noos, `update tp3_ip comm_init spi_dev tp3_spi_dev` with no node
`tp3_spi_dev` answers `Set tp3_ip.comm_init = spi_dev = tp3_spi_dev`, and
only `validate` reports `Target symbol 'tp3_spi_dev' not found`
(UPDATE-511). A union change can leave the same dangling reference after
bootstrap deletes the old member's node. A fix would be to refuse a name
that is no node, listing the candidates of `list value`.

## 11. Examples

```
$ analog-attach update adc spi-max-frequency 1000000
Set spi-max-frequency on adc
```

```
$ analog-attach update adc reg 5
warning: chip select 5 has no cs-gpios entry: spi@7e204000 has chip selects 0-1
  Use one of those, or add a GPIO for it to cs-gpios of /soc/spi@7e204000
Set reg on adc; renamed to adi,ad7124-8@5
```

(The two warning lines are on standard error.)

```
$ analog-attach update dac interrupts 5 2
Property interrupts not defined by adi,ad5592r binding; written without schema validation
gicv2 has #interrupt-cells = <3> but interrupts has 2 cells; set interrupt-parent explicitly
Set interrupts on dac
Set interrupt-parent = <&gicv2> on /soc/spi@7e204000/adi,ad5592r@3 (inherited from /)
```

```
$ analog-attach update adc/channel@1 diff-channels 1
warning: diff-channels takes 2 values, got 1
Set diff-channels on adc/channel@1
```

```
$ analog-attach update adc channel@0 </dev/null
Added channel@0 to adc
Missing required: diff-channels
Set them with: update adc/channel@0 <property> <value>
```

```
$ analog-attach update adc channel@0
channel@0 {
    reg = <0>;
    diff-channels = <0 17>;
};
$ analog-attach update adc channel@0 reg 3
channel@0 is a child node; set its properties with `update adc/channel@0 <prop> <value>`
```

```
$ analog-attach --json update adc reg 0
{"ok":true,"message":"Set reg on adc; renamed to adi,ad7124-8@0","severity":"warn"}
```

```
$ analog-attach --json update adc spi-max-frequency
{"kind":"property","key":"spi-max-frequency","type":{"kind":"number","subtype":"int"},
 "value":1000000,"source":"overlay","description":"Maximum SPI clocking speed of the device in Hz."}
```

(Wrapped here; the CLI writes one line.)

Where the backend is noos:

```
$ analog-attach update test_gpio0 number 3
Set test_gpio0.number = 3
$ analog-attach --json update tp3_ip comm_init spi_dev mydev2
{"ok":true,"message":"Set tp3_ip.comm_init = spi_dev = mydev2","severity":"info"}
$ analog-attach --json update testpart_ip comm_init --suggest
{"ok":true,"message":"2 suggestions","severity":"info","suggestions":[{"value":"spi_dev"},{"value":"i2c_dev"}]}
$ analog-attach update testpart_spi_dev max_speed_hz abc
'abc' is not a number                              (stderr, exit 2)
$ analog-attach --json update testpart '$compatible' x
{"ok":false,"message":"'$compatible' describes the node rather than configuring it, and cannot be set","severity":"error"}
```
