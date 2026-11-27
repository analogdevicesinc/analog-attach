# list

Lists what the bindings, the base and the overlay (the workfile) offer:
devices, a node's properties, the values for a property, the parents a device
can go under, the Linux tree's overlays (those that have a device, or all of
them), the nodes of the base with the overlay applied, and the targets a
project can be set up for. Nothing is written. `list devices`, `list context`,
`list property` and `list value` are shared commands: §4 to §7 and §10 as the
linux backend does them, §12 as the noos backend does them. `list parent`,
`list overlay` and `list node` are the linux backend's own (§8, §9, §11).

## 1. Synopsis

```
analog-attach [--json] list devices [<filter>]
analog-attach [--json] list context [<filter>]
analog-attach [--json] list property [<path> [<property>]]
analog-attach [--json] list value <path> <property> [<member>]
analog-attach [--json] list parent <compatible>
analog-attach [--json] list overlay [<compatible>]
analog-attach [--json] list node [<filter>]
analog-attach [--json] list devices [<filter>]                   # where the backend is noos
analog-attach [--json] list context                              # where the backend is noos
analog-attach [--json] list property [<node>]                    # where the backend is noos
analog-attach [--json] list value <node> <property> [<member>]   # where the backend is noos
```

Grammar: rule `list` in `01-grammar.abnf`. The `list-argument` elements per
kind:

```
list-args       = list-devices / list-context / list-property / list-value / list-parent / list-overlay / list-node
list-devices    = %s"devices" [ B element ]                    ; filter
list-context    = %s"context" [ B element ]                    ; filter (linux)
list-property   = %s"property" [ B element [ B element ] ]    ; path, property
list-value      = %s"value" B element B element [ B element ] ; path, property, member
list-parent     = %s"parent" B compatible
list-overlay    = %s"overlay" [ B compatible ]
list-node       = %s"node" [ B element ]                      ; filter
                  ; more elements are an input error (GRM-004)
```

The path is an element, not a `node-path`: `list` doesn't make the checks
GRM-020 to GRM-024 (LIST-004).

## 2. Terms

| Term | Meaning |
|---|---|
| Compat index | `.analog-attach/linux/compat-index.json`: every compatible string of the Linux tree's bindings, mapped to its binding file (02-common.md §8.4). |
| Node's binding | For a node with a `compatible`, the binding of its first compatible. For a node without one, the child-node pattern of its parent's binding that matches its name (`^channel@([0-9]|1[0-5])$`). |
| Narrowed binding | The node's binding with the `if`/`then`/`else` branches the node's own data selects applied: its properties and required list (CLAUDE.md "If/then narrowing"), without the peripheral properties that don't apply under the node's parent (LIST-038). |
| Merged node | The node as the base and the overlay together have it (`effective_node`). |
| Suggestion | `{ value, display_string?, note? }` (`04-protocol/common.schema.json#/$defs/suggestion`); `value` is ready to pass to `update` (GRM-070). |

## 3. All kinds

**LIST-001** *Withdrawn.* (A `list` without a kind listed the kinds. A bare
`list` now writes the group's usage, GRM-018, and `list --help` describes the
kinds, LIST-008.)

**LIST-002** If the word after `list` names no kind of the backend, then
the CLI shall report the input error `Unknown kind: <kind>.[ Did you mean
<close>?] The kinds: <kinds>.`, `<kinds>` the backend's kinds in the order
the help lists them, joined with `, `, and `<close>` those a few edits from
`<kind>` (COM-140). The same holds for `skill`: `Unknown skill command:
<word>. … The skill commands: install, uninstall.`

**LIST-003** *Withdrawn.* (The arguments after those of §1 were ignored. More
are now GRM-004's `Too many arguments, …`, and the third of `list value` is
a member, LIST-009.)

**LIST-004** The CLI shall resolve a path argument per GRM-025 to GRM-027
without checking it per GRM-020 to GRM-024. A path no node has (including
`&spi0`, or one with whitespace) is a refusal of the kind (`Node not found`),
not an input error. A path with `//` resolves as if the empty segment weren't
there. (Open issue L-1.)

**LIST-005** If a kind is missing a required argument, then the CLI shall
report an input error (COM-031) before loading the workspace, in both modes:
GRM-004's `Expected argument for <name>`, one line per missing argument
(`list value` alone gives `Expected argument for path` and `Expected argument
for property`). `list property` has no required argument (LIST-037).

**LIST-009** If `list value` is given a member, then the CLI shall report the
input error `A member is not supported by the linux backend: <member>`
(COM-031): Linux values have no members.

**LIST-006** The CLI shall load only the resources each kind needs (COM-070),
and report problems with them per COM-071 and COM-072:

| Kind | Needs |
|---|---|
| `devices` | bindings |
| `context` | the Linux tree (LIST-130) |
| `property` | bindings, base, overlay; base, overlay without a path (LIST-037) |
| `value` | base, overlay; bindings when they load (LIST-074) |
| `parent` | bindings, base |
| `overlay` | bindings, base; the Linux tree, base without a compatible (LIST-116) |
| `node` | base, overlay (LIST-140) |

`property`, `value` and `node` therefore need a configured workfile. Without one they
report `Missing config field workfile` (02-common.md §8.3).

**LIST-007** The CLI shall not write the workfile or the settings.

**LIST-008** `list --help` shall list the kinds of the backend, each with its
usage line and one-line description (GRM-014).

## 4. `list devices`

**LIST-010** When the filter is a compatible of the compat index, or exactly
one compatible contains it, and that binding parses, the CLI shall describe
that one device (LIST-012): `list devices ad7124-8` describes
`adi,ad7124-8`.

**LIST-011** Otherwise the CLI shall list every compatible of the compat index
that contains the filter as a substring, or every compatible when there is no
filter, grouped by category: ordered by category, then by compatible. A
compatible's category is its binding's folder under
`Documentation/devicetree/bindings/` (`iio/adc`), or the binding's file name
without `.yaml` for one directly under it (`trivial-devices`). In human mode
it shall write one line per compatible, `<compatible>  <category>`, the
compatibles padded to the longest, and nothing when none match. In JSON mode
it shall respond `{"ok": true, "message": "Found <n> devices", "severity":
"info", "devices": [{ key, tag }…], "names": [...]}`, `key` being the
compatible, `tag` its category and `names` the same keys in the same order
(deprecated). A filter that matches nothing isn't a refusal.

**LIST-012** The description of a device, in human mode, shall be these
lines:

```
<compatible>
  <title>
  <description>
  binding: <binding file>
  <n> properties, <m> child node patterns
```

The title and description lines are left out when the binding has none.
`<description>` is the binding's text as written: only its first line is
indented, and a text that ends in a newline is followed by an empty line
(open issue L-3). `<n>` counts the binding's unconditional properties
and `<m>` its child-node patterns. The binding's property patterns are
neither counted nor listed, here or in JSON mode (open issue L-9).

**LIST-013** In JSON mode the description shall be `{"ok": true, "message":
"Device <compatible>", "severity": "info", "devices": [{ key }], "device":
<device>, "names": [<compatible>]}` (`04-protocol/list-devices.schema.json`),
`<device>` being `{ key, compatible, title?, description?, binding,
properties, children }`, `key` and `compatible` the compatible.
`device.properties` lists the binding's properties in its order as `{ name,
description?, type, display, dt_type, required }` (the property description of
`common.schema.json`, `dt_type` per LIST-057), `required` being the unconditional required list (no
narrowing: there is no node). `device.children` lists the child-node
patterns as `{ pattern, name, description?, properties }`, where `name` is the
pattern's literal start (after `^`, with parenthesised literal text
unwrapped), followed by `N` when it ends in `@` (`channel@N` for
`^channel@([0-9]|1[0-5])$`, `fan-` for `^fan-[0-9]+$`), or the pattern itself
when it has no literal start. `display` writes arrays as
`<type>[]`, without the item counts `list property` shows (open issue L-4).

## 5. `list property <path>`

**LIST-030** If the path names no node of the merged tree, then the CLI shall
refuse: `Node <path> not found` in JSON mode, `Node not found: <path>` in human
mode.

**LIST-031** If the node's binding can't be found, then the CLI shall refuse
with the reason:

| Case | Message |
|---|---|
| The node's compatible has no binding | `No binding found for <compatible>` |
| The binding doesn't parse | `Failed to parse binding <file>` |
| `compatible` isn't a string list | `Unexpected compatible value` |
| No compatible, and no parent | `Node has no compatible and no parent to check patternProperties against` |
| No compatible, nor has the parent | `Node has no compatible and its parent also has no compatible` |
| No compatible, and the parent's `compatible` isn't a string list | `Unexpected value in compatible of parent node` |
| The parent's compatible has no binding | `Failed to find binding for <parent compatible>` |
| The parent's binding doesn't parse | `Failed to parse binding <file>` |
| No child-node pattern matches | `Node does not match any patternProperties of <parent compatible>` |

**LIST-032** The CLI shall list, in this order: the narrowed binding's
properties in binding order; then the binding's property patterns; then its
child-node patterns.

**LIST-038** The node's binding, narrowed or not, shall leave out the
peripheral properties that don't apply under the node's parent, the bus
controller when there is one:
1. the vendor SPI peripheral properties of another controller (`pl022,*`,
   `cdns,*`, `fsl,*`, `nvidia,*`, `st,spi-midi-ns`, `controller-data`) (CLAUDE.md
   "SPI vendor peripheral-props filtering");
2. under a parent whose name doesn't match the `$nodename` pattern of the Linux
   tree's `spi/spi-controller.yaml` (`spi@7e204000` does, `i2c@7e804000`
   doesn't), the SPI peripheral properties: those of
   `spi/spi-peripheral-props.yaml` but `reg`, of the vendor files its `allOf`
   names, and of the child nodes of `spi-controller.yaml` (`spi-cpha`,
   `spi-cpol`, `spi-3wire`), the binding's own definitions of them included. A
   property the narrowed binding requires stays.

dt-validate still accepts them where the binding does (an ADXL345 on I2C with
`spi-cpha`); the CLI doesn't offer them there.

**LIST-039** The populated type of `reg` shall follow the node's parent, the
counts being the parent's `#address-cells` and `#size-cells` (1 and 0 when
unset): where the binding leaves `reg` open (`number[]`), each entry is a row
of address + size numbers of 0 to 4294967295 (`number[][]` under a parent of
1 and 1 cells), with the binding's row counts. A child node bound by the
node's pattern reads them from the node itself (its value, else the value the
binding pins, else 1 and 0). Under an SPI controller with `num-cs` (and 1 and
0 cells), each number is at most `num-cs` - 1, also where the binding types
`reg`. A parent of 0 address cells, or no known parent, leaves `reg` as the
binding gives it.

**LIST-033** A property's entry shall be its name, followed by ` (<marks>)`
when it has marks: `set` when the merged node has it, `required` when the
narrowed binding requires it, joined by `, ` (`compatible (set, required)`).
Its type is the populated type of `list property <path> <property>` (LIST-054),
written as LIST-052 writes it (`number[]`, `number[2]`).

**LIST-034** A property pattern's entry shall be `<names> (pattern <regex>)`
or `<names> (pattern <regex>; set: <set>)`, where `<set>` lists the node's
properties the pattern matches, joined by `, `. `<names>` is what the pattern
matches: the names joined by `, ` when there are at most three, `<first> …
<last>` when there are more, or `<stem>…` when the pattern fixes only a start.
A pattern that isn't anchored with `^`, or fixes nothing, shows the regex
itself and only `(pattern)` / `(pattern; set: …)`.
The entry has no type: the type a selected pattern gives (LIST-055) needs a
name, so `list property <path> <property>` gives it, and in JSON mode so does
the entry in `properties` of each name in `<set>` (LIST-036).

**LIST-035** A child-node pattern's entry shall be `<names> (child node
<regex>; present: <children>)`, `<children>` being the node's children the
pattern matches joined by `, `, or `none`. `<names>` is as in LIST-034.
Example: `channel@0 … channel@15 (child node ^channel@([0-9]|1[0-5])$;
present: channel@0)`.

**LIST-036** In human mode the CLI shall write one entry per line: for a
property `<name>  <marks>  <type>`, the name and the marks (`(set, required)`,
or nothing) padded to their longest and the type last; for a pattern its entry.
In JSON mode it shall respond `{"ok": true, "message": <m>, "severity": "info",
"names": [...], "properties": [...], "child_patterns": [...], "suggestions": [...]}`
(`04-protocol/list-property.schema.json`): `names` has one string per entry,
the property's name or the pattern's regex; `properties` has one `{ name,
type, display, dt_type, required, set, default?, pinned? }` per property, then one per
property the merged node has that only a property pattern defines (`pinctrl-0` by
`^pinctrl-[0-9]+$`), in node order, described as `list property <path> <property>`
describes it (LIST-054, LIST-055), `display` being its type
written out, `dt_type` its type in dt-schema's words (LIST-057), `default` the binding's default as LIST-054 gives it and `pinned` the value the narrowed binding pins it to (LIST-056); `child_patterns` has the
regex of each child-node pattern, as in `names`; `suggestions` (deprecated) has one suggestion per entry: for a
property `{ value: <name> }`, plus `display_string: <entry>` when it has
marks; for a pattern `{ value: <regex>, display_string: <entry> }`. `<m>` is `Found <n> properties`, followed by `,
<p> property pattern(s)` when there are property patterns and ` and <c> child
node pattern(s)` when there are child-node patterns.

**LIST-037** Without a path, the CLI shall list the nodes of the overlay's
`__overlay__` bodies, depth first in file order, each once (a node two
fragments write is one): its first label, or its parent's path, `/` and its
name (`ad7124_8`, `ad7124_8/channel@0`, `spi0/dac@1`; under a `target-path`
the path itself, `/vdd`). It loads the base and the overlay, not the bindings.
In human mode it shall write one path per line, and nothing when there is none.
In JSON mode it shall respond `{"ok": true, "message": "<n> node[s]",
"severity": "info", "names": [...], "suggestions": [{ value, display_string? }…]}`,
`display_string` being the node's first compatible when it has one (as the
noos backend does, LIST-520).

## 6. `list property <path> <property>`

**LIST-050** The CLI shall resolve the node per LIST-030 and its binding per
LIST-031, then narrow the binding against the node (CLAUDE.md "If/then
narrowing"). If narrowing fails, then the CLI shall refuse with `Failed to
narrow binding for <compatible>`, or `Failed to validate against pattern
"<regex>" of <parent compatible>` for a node bound by a parent's pattern.

**LIST-051** The CLI shall look the property up by name in the narrowed
properties, then by the binding's property patterns. If neither has it, then
the CLI shall refuse with `Property <property> not found in <origin>`, where
`<origin>` is `<compatible> binding`, or `pattern "<regex>" of <parent
compatible>`.

**LIST-055** Where the first property pattern that matches the property says
nothing of its value (`"^in[13]-supply$": true`), the CLI shall give the
property the type of the first pattern of the schemas dt-validate checks every
node against (`select: true`: dt-core.yaml's `.*-supply$`, `.*-names$` and
`^#.*-cells$`, pinctrl-consumer.yaml's `^pinctrl-[0-9]+$`, the unit suffixes
of property-units.yaml) that matches the name, with the binding's description:
`in1-supply` is a phandle, `adi,ch0-microvolt` an `int32` matrix. A property
no pattern of the binding matches stays not found (LIST-051), and a pattern
that types its names keeps its own type. `update` (its Definition) and `list
value` (LIST-073) look the property up the same way.

**LIST-052** In human mode the CLI shall write:

```
<property>[ (required)]: <type>
  <description, one line per non-empty line, trimmed>
  const: <json>
  default: <json>
  min: <n>
  max: <n>
```

Each line after the first only when the binding gives it. `(required)` follows
the narrowed required list. `<type>` is written per LIST-053. A phandle enum's
default is the value currently set, not a constraint, so it shows no
`default:` line.

**LIST-053** The CLI shall write a type as: `number`, `string`, `bool`;
`enum(<a> | <b> | …)`; `<item>[<count>]` for an array, `<count>` being
`<n>` for a fixed count, `<min>..<max>` for a range, `<min>..` for a minimum
above 1 and nothing otherwise (`number[2]`, `number[][]`); `(<a>, <b>, …)`
for a tuple. A phandle whose targets are known is an enum of their labels
(`enum(gpio | gicv2 | aon_intr)`); a list of them is
`(enum(clk_osc | … ))[]`. A list of them whose row the lib shaped (`clocks`:
the provider, then the cells its `#clock-cells` asks for) is counted in cells,
the binding's rows times the row's width: `(enum(clk_osc | … ))[1]` for one
clock, `(enum(clk_osc | … ), number)[2]` once a provider with
`#clock-cells = <1>` is set (`min_items` / `max_items` the same, LIST-054).

**LIST-054** In JSON mode the CLI shall respond `{"ok": true, "message":
"Type of <property>", "severity": "info", "property": { name, description?,
type, display, dt_type, required, set, default?, pinned? }, "type": <type>,
"description"?: <description>}`
(`04-protocol/list-property.schema.json`). `display` is the type as LIST-053
writes it, `required` follows the narrowed required list, and `set` says whether
the merged node has the property, `dt_type` is per LIST-057, and `pinned` is per LIST-056. The top-level
`type` and `description` repeat those of `property` (deprecated). `type` has
`min_items` / `max_items` per CLAUDE.md "update value format". The response
doesn't give the property's range (open issue L-5).

**LIST-056** When the narrowed binding allows a property one value only, the
CLI shall give it as `pinned`, as `update` takes it and `list value` lists it
(LIST-076: the value `pinned by the binding`): a `const` or a one-option enum
(`#address-cells`: `"1"`; `clock-names: const: mclk`: `"mclk"`), or `""` for a
flag the narrowed binding requires (`spi-cpol` of `adi,ad5592r`). A choice, a
default, an optional flag and a phandle have no `pinned`.

**LIST-057** In JSON mode the CLI shall give each property description
(LIST-013, LIST-036, LIST-054; `read`'s READ-035)
`dt_type`: the property's type in dt-schema's words, then what the binding
constrains it to, each part after ` · `:

- The type is the name of the `types.yaml` definition the processed schema
  gives the property (`uint32`, `uint64-array`, `string`, `string-array`,
  `phandle`, `phandle-array`, `address`, `uint32-matrix`, `flag`), the binding's
  own `$ref` or the one dt-schema gives its name (`reg` an `address`, a
  `-supply` a `phandle`, a `-microvolt` an `int32-matrix`), or `node` for a
  property whose value is a node. A property dt-schema allows several types is
  `<a> | <b>` (`uint32-array | string-array`), without constraints; `flag`,
  `node` and `phandle` have none either.
- A list's count: `<n> item(s)`, `<a> to <b> items`, `at least <n> items`; a
  matrix's (`address`, `phandle-array`, `*-matrix`): `<n> row(s)`, `<a> to <b>
  rows`, then ` of <n> cell(s)` or ` of <a> to <b> cells` when the binding
  sizes a row. Nothing for one or more (an unset minimum is 1), nor for a
  row only `types.yaml` sizes (up to 1024 cells of a `phandle-array`, 5 of an
  `address`). A `string` (one string) has no count.
- The values: `one of <n>` for an enum of `<n>` options (an option may be a
  whole list, `compatible`'s fallbacks), `const <v>` for a single one (`const
  28`, `const "mclk"`), `<a> to <b>` for a number range narrower than the
  type's; `each ` before them after a count of more than one item, and for a
  matrix only when its rows have one cell. A phandle's options are the tree's
  candidates, not a constraint, and are left out.

`uint32`, `uint32 · 0 to 10000000`, `uint64-array · 2 to 4 items`,
`uint32-array · 2 items · each 0 to 29`, `string-array · 1 item · one of 2`,
`string · one of 5`, `phandle-array · 1 row of 2 cells`, `address · 1 row of 1
cell · 0 to 15`, `uint64-matrix · 3 to 64 rows of 2 cells`, `flag`. It is
`untyped` where the binding gives the property no type (`adi,muxout-select` of
`adi,adf4377`, whose name dt-schema types two ways); `read` gives `untyped`
also where no binding defines the property (`status` of a `spidev` node). On a
node (`list property <path>`, `read`) the constraints are those of the type as
the node's place shapes it, as `type`'s are: `interrupts` under a GPIO
interrupt parent is `uint32-matrix · 1 row of 2 cells`, `clocks` with a
`fixed-clock` `phandle-array · 1 row of 1 cell` and with the RPi 4's cprman
(`#clock-cells = <1>`) `phandle-array · 1 row of 2 cells`, where `list devices` gives
`uint32-matrix · 1 row` and `phandle-array · 1 row`. The type comes from the processed
schema only, never from a table of property names; `display` (LIST-053) stays
beside it (open issue L-4). The human output doesn't show it.

## 7. `list value <path> <property>`

**LIST-070** If the path names no node of the merged tree, then the CLI shall
refuse per LIST-030.

**LIST-071** The CLI shall ask linux-lib's default intelligence stack for the
property's values, giving it the node's place in the overlay, the merged tree
as the context devicetree (so the overlay's own nodes are candidates), the
node's data, and, when the node's binding resolves, its narrowed properties
and required list. A property named by a binding pattern is offered to the
stack under its own name. For `clocks` the stack's values are the labelled,
enabled nodes with `#clock-cells` (fixed clocks and clock controllers alike),
those whose `#clock-cells` is `<0>` first.

**LIST-072** When the property is `clocks` or ends in `-supply`, the CLI shall
put the values that name a node the overlay adds (its label is the overlay's
and not the base's) before the others, keeping the order within each group.
For other properties the stack's order stays (the node's interrupt parent
first, its own base `interrupt-parent` or the one it inherits).

**LIST-073** When the node's binding resolves, the CLI shall check each value
against the binding's definition of the property (LIST-051, LIST-055),
narrowed with the value in place, and add a note to a value that fails: `not defined by <origin>;
validate may reject it` when the binding doesn't define the property (origin
per LIST-051), or the value check's message otherwise. Notes join with `; `.
A `clocks` value naming a provider whose `#clock-cells` is more than `<0>` is
not checked against the definition: it is the first step of a clock, the
cells come after it (ADD-128).

**LIST-074** Where the bindings or their caches don't load, the CLI shall still
list the values, unchecked, and end the message with `; not checked against a
binding (<reason>)`. It shall do the same when the node's binding doesn't
resolve, `<reason>` being the LIST-031 message. (With the default
`AA_PREPROCESS_COMMAND`, `linux` must still be set: the base needs it when the
command contains `AA_LINUX`, 02-common.md COM-092.)

**LIST-075** A value's `display_string` shall be the stack's display,
followed by ` (<note>)` when it has a note the display doesn't already contain.
`note` is set when there is one.

**LIST-076** The message shall be `Found <parts>`, the parts being `<n>
value(s) pinned by the binding` and `<n> value(s) from the context devicetree`
for those that aren't zero, joined by `; `, or `No values for <property>` when
there are none. LIST-074 may add to it.

**LIST-077** In human mode the CLI shall write one line per value,
`<value>\t<display_string>`, or the message alone when there are none, then
the line of LIST-080 when there is one. In JSON mode it shall respond `{"ok":
true, "message": <m>, "severity": "info", "suggestions": [...]}`, also when
there are none, plus `can_create` per LIST-080
(`04-protocol/list-value.schema.json`).

**LIST-078** The CLI shall list only the stack's values. The other candidates
`add` and `read` show under a phandle property (a disabled interrupt
controller, marked `disabled`) aren't listed. `*-gpios` properties get no
values.

**LIST-079** When an option of the binding is a whole list, written all at
once (the root's fallback `compatible`: `["raspberrypi,4-model-b",
"brcm,bcm2711"]`; `adi,range-microamp` of `adi,ad5758`: `[0, 20000]`, …;
`data-lanes` of a media sensor: `[1, 2]` or `[1, 2, 3, 4]`), the CLI shall
offer each list as one value, its entries joined by a space
(`raspberrypi,4-model-b brcm,bcm2711`, displayed `"raspberrypi,4-model-b",
"brcm,bcm2711"`; `0 20000`, displayed `<0 20000>`). In the protocol's `enum`
type (`list property`, `read`) such an option is `{"value": <the entries
joined by a space>, "list": <the entries>, "display_string": <the list as the
devicetree writes it>}`, its numbers as numbers in `list`
(`{"value": "0 20000", "list": [0, 20000], "display_string": "<0 20000>"}`):
`value` is a string because the option is a list, not because the property is
a string; an option that is one value has no `list`. The check of LIST-073
holds such a value to the options as a whole (UPDATE-041), so an option gets
no note; a value that is none of them gets `Values for property <property> are
<options>`, `<options>` being every option as JSON
(`[["raspberrypi,400","brcm,bcm2711"],…]`, `[[0,20000],[0,24000],…]`).

**LIST-080** When the property names a provider the user can add instead
(`fixed-clock` for `clocks`, `regulator-fixed` for a `*-supply`, as `read`
offers per READ-036), the CLI shall end the human output with `Or add your
own: analog-attach add <compatible>` (`, ` between several), and add to the
JSON response `"can_create": [{ "value": <compatible>, "display_string":
"add <compatible>" }, …]`, left out when there is none.

**LIST-081** For `reg`, the stack's values shall be the node's unit address
(`2 — matches the unit address of adi,ad7124-8@2`), then, under a parent of
1 and 0 cells with `num-cs` or `cs-gpios` (an SPI controller), its chip
selects 0 to `<n>` - 1 not taken by an enabled sibling, each displayed `<cs> —
free chip select`, then the taken ones, `<cs>` noted `in use by <sibling>`;
the unit address's chip select isn't repeated. `<n>` is the larger of `num-cs`
and the number of `cs-gpios` entries (a `<0>` entry is a native chip select).
The unit address's value is noted `in use by <sibling>` when a sibling takes
it, otherwise, at `<n>` or above, `past the controller's <n> chip selects`
when the controller has `num-cs`, else `no cs-gpios entry`: the chip selects
`validate.md` VALIDATE-104 warns about. A sibling occupies the address `add`
skips (ADD-047): its `reg`'s, else its hexadecimal unit address.

## 8. `list parent <compatible>`

The linux backend's own command (`04-protocol/list-parent.schema.json`).

**LIST-090** If no binding has the compatible, then the CLI shall write the
message of `add.md` ADD-013 (`Unknown compatible '<compatible>'.[ Did you
mean <close>?] See: analog-attach list devices`) in human mode, and respond `{"ok": true,
"message": <that message>, "severity": "warn", "error_type":
"unknown-device-type", "suggestions": []}` in JSON
mode (open issue L-6). If the binding doesn't parse,
then the CLI shall refuse with `Failed to parse binding <file>`.

**LIST-091** The CLI shall list the valid parents from the base only, in this
order:

1. When one of the binding's compatibles is `fixed-clock`: the nodes named
   `clocks` without `#clock-cells`, or `/` when there are none.
2. Else, when one is `regulator-fixed`: `/`.
3. Else: when the binding defines `spi-max-frequency`, the SPI buses; then,
   when one of the binding's examples has a node named `i2c…` opening a
   block, the I2C buses.

A bus is a node named `spi` (or `i2c`) that has `compatible`, `#address-cells`
and `#size-cells`, whatever its `status`, in tree order. A device that fits
none of these has no valid parents.

**LIST-092** Each parent shall be the suggestion `{ value: <label>,
display_string: <path> }`, the label being the node's last label, or its path
when it has none (an unlabelled `clocks` node is `/clocks`, not its name, which
can be another node's label: the Raspberry Pi's `clocks: cprman@7e101000`). `/` is `{ value: "/",
display_string: "/" }`. In human mode the CLI shall write one line per parent,
`<value>  <display_string>` (`spi  /soc/spi@7e204000`). In JSON mode it shall
respond `{"ok": true, "message": "Found <n> valid parents", "severity":
"info", "suggestions": [...]}`.

**LIST-093** `add` takes the parent from this list (ADD-020 to ADD-022,
ADD-062, ADD-072).

## 9. `list overlay [<compatible>]`

The linux backend's own command (`04-protocol/list-overlay.schema.json`).

**LIST-110** The CLI shall scan the Linux tree's overlays on every run: the
files `arch/arm/boot/dts/overlays/*-overlay.dts` and every `*.dtso` under
`arch/*/boot/dts/`. For each it shall read, as text with quoted `#include`
files inlined, its root `compatible` and every other `compatible` property
(those of the nodes it adds, and of the nodes it changes). Comments and the
`"compatible=…"` strings of `__overrides__` aren't read.

**LIST-111** The CLI shall list the overlays whose scan (LIST-110) has
`<compatible>`, and those whose scan has another compatible of the same
binding (the *sibling* compatibles, from the compat index), the latter marked
`matched: <sibling>`, the first sibling in sorted order that it has. An
overlay that has the compatible itself is never marked.

**LIST-112** The CLI shall grade each overlay's root compatible against the
base's root compatible:

| Fit | When | `reason` |
|---|---|---|
| `compatible` | One of the overlay's root compatibles is one of the base's | that compatible |
| `compatible` | One is a generic compatible of a family the base belongs to | `family: <compatible> → <family>` |
| `unknown` | The overlay has no root compatible | `no root compatible` |
| `unknown` | One isn't `vendor,name` | `root compatible "<c>" isn't vendor,name` |
| `incompatible` | Otherwise | `overlay: <its compatibles>; base: <the base's>` |

The rows are tried in that order. The one family is `raspberrypi`: the
generic compatibles `brcm,bcm2835`, `brcm,bcm2708`, `brcm,bcm2709`,
`brcm,bcm2836`, and the bases `brcm,bcm2835`, `brcm,bcm2836`, `brcm,bcm2837`,
`brcm,bcm2708`, `brcm,bcm2709`, `brcm,bcm2710`, `brcm,bcm2711`, `brcm,bcm2712`.

**LIST-113** The CLI shall order the overlays by fit (`compatible`, then
`unknown`, then `incompatible`), then the unmarked before the marked, then by
file name (locale order).

**LIST-114** In human mode the CLI shall write one line per overlay: the file
name padded to the longest, two spaces, `<fit> (<reason>)`, and `  via
<matched>` when marked. When there are none, it shall write `No overlay in
<linux> has <compatible>`. In JSON mode it shall respond `{"ok": true,
"message": "<n> overlays with <compatible>", "severity": "info", "overlays":
[...]}`, each `{ name, path, devices, fit, reason, matched? }`, `name` being
the file name (what `import` and `add --template overlay:` take), `path`
absolute and `devices` the compatibles other than the root's that the scan
(LIST-110) has, in file order (`04-protocol/list-overlay.schema.json`).

**LIST-115** A compatible no binding has, or no overlay adds, gives an empty
list, not a refusal.

**LIST-116** Without `<compatible>`, the CLI shall list every overlay of the
scan (LIST-110), none marked, graded (LIST-112) and ordered (LIST-113) as
with one. It shall need only the `linux` setting's Linux tree and the base,
not the bindings. In human mode each line is LIST-114's, followed by `  adds
<devices>` (comma-separated) when the overlay adds a compatible; when there
are none, it shall write `No overlay in <linux>`. In JSON mode the message is
`<n> overlays`.

## 10. `list context`

**LIST-130** The CLI shall list the base devicetrees of the Linux tree: every
`.dts` file under `arch/<arch>/boot/dts/` of each architecture that has that
directory, the overlays (`*-overlay.dts` under `arch/arm/boot/dts/overlays/`,
as `import` finds them) left out, by architecture and then by the file's path
under that directory, both sorted. It shall need only the `linux` setting, a
Linux tree with `Documentation/devicetree/bindings/` and `include/` (COM-071
when it isn't): no caches, base or workfile. A tree with no `.dts` lists none,
which isn't a refusal.

**LIST-131** In human mode it shall write each file's absolute path, the form
`config devicetree` takes, one a line, the configured `devicetree`'s followed
by ` (configured)`; then an empty line (when there was a file), `<n>
devicetree[s] in <linux>.` and `Use: analog-attach config devicetree <path>`.

**LIST-132** In JSON mode it shall respond `{"ok": true, "message": "<n>
devicetree[s]", "severity": "info", "devicetrees": [{ path, arch, name,
configured? }…]}` (`04-protocol/list-context.schema.json`), `path` the
absolute path, `arch` the architecture, `name` the path under
`arch/<arch>/boot/dts/` (`broadcom/bcm2711-rpi-4-b.dts`) and `configured`
true on the configured `devicetree`'s.

**LIST-133** With a filter, the CLI shall list only the files of LIST-130
whose path in the Linux tree (`arch/arm/boot/dts/broadcom/bcm2711-rpi-4-b.dts`)
contains it as a substring, case-sensitive: `list context rpi-4` lists the
Raspberry Pi 4's of every architecture, `list context arm64/` those of arm64.
LIST-131 and LIST-132 hold for what is left, `<n>` its count. A filter that
matches nothing lists none, which isn't a refusal.

## 11. `list node [<filter>]`

The linux backend's own command (`04-protocol/list-node.schema.json`): it
finds a node anywhere in the merged tree, whose base nodes `read` gives
collapsed below what the overlay reaches (READ-022), by its name, a label or a
compatible. The GUI's devicetree search reads it once and filters it as the
user types.

**LIST-140** The CLI shall list every node of the merged tree, the base
devicetree with the overlay applied (`DeviceTreeOverlay.merged_tree()`, the
tree `read` and `list value` see), depth first in tree order, the root `/`
first, each once. It shall need the base and the overlay, not the bindings,
and parse them once: what it gives of each node comes from that one walk. A
fragment whose target names no node isn't in the merged tree, so neither are
its nodes (as READ-011).

**LIST-141** For each node it shall give: `path`, absolute (what `read`
takes); `key`, its name with its unit address (`gpio@7e200000`; `/` for the
root); `labels`, the base's then the overlay's; `compatible`, its compatible
strings in order (none without the property); `status`, its `status` property
when it has one; `origin`, as `read`'s (`internal` when the overlay adds the
node or has a node at its path, `external` when only the base has it);
`change`, `added` when none of its properties is the base's and the overlay
sets one or adds the node, else `changed` when the overlay sets a property of
it, else `none` (the GUI's new and changed tags); and `has_children`. It shall
give no property: `read <path>` does.

**LIST-142** In human mode the CLI shall write one line per node, in aligned
columns, each padded to its longest and two spaces apart: the path, the
labels each as `&<label>` (space-separated), the compatibles (`, `-separated)
and the tags, in parentheses and `, `-separated, `new` for `added`, `changed`
for `changed`, then `off` when the status is neither `okay` nor `ok`; the
line ends where its last non-empty column does. Then an empty line (when there
was a node), `<message>.` and `Use: analog-attach read <path>`. In JSON mode
it shall respond `{"ok": true, "message": "<n> node[s]", "severity": "info",
"nodes": [{ path, key, labels, compatible, status?, origin, change,
has_children }…]}`.

**LIST-143** With a filter, the CLI shall list only the nodes of LIST-140
whose key, one of whose labels or one of whose compatibles contains it as a
substring, case-insensitive, a leading `&` and surrounding whitespace ignored
(`list node &led_act` finds `/leds/led-act`; `list node bcm2835-spi` the SPI
controllers). The message is then `<n> node[s] match[es] "<filter>"` (`1 node
matches`), the filter as given, trimmed. The path above a node isn't matched
(`list node soc` doesn't list every node under `/soc`). A filter that matches
nothing lists none, which isn't a refusal; one that is empty once the `&` is
dropped lists every node.

## 12. Where the backend is noos

Each kind loads the workfile first and refuses as `02-common.md` COM-512
says (`list context` loads only the settings). A node is one node name
(GRM-080); `list parent`, `list overlay` and `list node` are unknown commands (COM-015).

### 12.1 `list devices`

**LIST-500** The CLI shall list what `add` takes (`add.md` ADD-500), in this
order: the eval boards (tag `eval boards`), the drivers (tag `drivers`), then
the schemas available to the workfile's platform, grouped by the module that
ships them (tag the module's name), each group in the module's order. With
a filter, it shall keep the keys that contain it as a substring. In JSON
mode it shall respond `{"ok": true, "message": "<n> schema[s] available",
"severity": "info", "devices": [{ tag, key }…]}`, `key` being what `add`
takes; there is no `device` and no `names`. A filter that matches nothing
isn't a refusal.

**LIST-501** In human mode it shall write, per tag, `  <label>:`, then
`    <key>` per key and an empty line, then `Use: analog-attach add <key>
[--name <node name>]`; with no key, `No schemas available.` The label is
the tag, except `eval boards (the part on it, wired: add by name)`, `drivers
(a bare part, wired by hand: add by name)`, and `platform (<platform>)` for
a module named `platform`.

### 12.2 `list context`

**LIST-512** If `list context` is given a filter, then the CLI shall report
the input error `A filter is not supported by the noos backend: <filter>`
(COM-031), before loading anything.

**LIST-510** The CLI shall list the chips (platforms) and boards the module
repositories of `module-paths` describe, without a workfile. If
`capi-path` isn't configured, or the chips or boards can't be read, then it
shall refuse with that problem (`Setting "capi-path" is not configured.
Run: analog-attach config capi-path <value>`). In JSON mode it shall respond
`{"ok": true, "message": "<n> board[s] on <m> chip[s]", "severity": "info",
"platforms": [{ name, vendor, description?, boards }…], "boards": [{ name,
platform?, vendor?, description? }…]}` (`04-protocol/list-context.schema.json`),
the platforms sorted by name, `vendor` the platform's vendor or its name,
`description` its CPU, `boards` the names of the boards carrying it, sorted;
the boards in the order the repositories give them. No module repository
gives `0 boards on 0 chips`, not a refusal.

**LIST-511** In human mode it shall write, per chip, `  <chip> (<vendor>)`,
then `      <board>` per board, or `      no board: target the chip with
'analog-attach config target <chip>'` when none carries it, `<chip>` the
chip's name, and an empty line; then `<n> board[s] on <m> chip[s].` and
`Use: analog-attach config target <board>, then analog-attach init`.

### 12.3 `list property`

**LIST-520** With no `<node>`, the CLI shall list the stored nodes, in the
workfile's order (external nodes are left out). In JSON mode it shall
respond `{"ok": true, "message": "<n> node[s]", "severity": "info", "names":
[...], "suggestions": [{ value, display_string }…]}`, `display_string` being
the node's `$compatible`; in human mode, the names one per line, and nothing
when there is none.

**LIST-521** With `<node>`, the CLI shall list the node's properties that
the schema doesn't disable, in order, named without their `$` (READ-504). A
node the workfile doesn't have is refused as READ-505 says; an external node
with `Node '<node>' has no properties to configure`. In JSON mode it shall
respond `{"ok": true, "message": "<n> propert(y|ies) on <node>", "severity":
"info", "names": [...], "suggestions": [{ value, display_string }…]}`,
`display_string` being the type (`read.md` READ-510), followed by `
(<marks>)` when there are marks: `required`, `set`, or `required, set`. In
human mode it shall write one line per property, `<name>  <type>  <marks>`,
the columns padded.

**LIST-522** If a `<property>` is given, then the CLI shall report the input
error `list property takes only a node: 'analog-attach read <node>
<property>' describes one property` (open issue L-11).

### 12.4 `list value`

**LIST-530** The CLI shall answer the values `<property>` of `<node>` can
take, then the schemas a node could be created from for it. If the node has
no such property, then it shall refuse with `'<node>' has no property
'<property>'`; a node it doesn't have, as READ-505
says. The values are by type: `true` and `false` for a boolean, the options
of an enum, the listed values of a number, the stored nodes of the right
schema for a reference (an include, a driver's ops or init parameter, the
platform ops and extra), the members of a union with no `<member>`, the
member's values with one; a string or a raw value has none. In JSON mode it
shall respond `{"ok": true, "message": "<n> suggestion[s]", "severity":
"info", "suggestions": [...]}`, the values as `{ value }`, then each schema
as `{ value: <schema>, display_string: "<schema> (can create)" }`
(`04-protocol/list-value.schema.json#/$defs/noos`). If the member isn't one
of the union's, or the suggestions can't be computed, then it shall refuse
with the problem.

**LIST-531** In human mode it shall write the values one per line, then (an
empty line after any value) `Can create:` and `  <schema>` per schema; with
neither, `No suggestions.`

## 13. Open issues

**L-1. `list` paths skip the path checks.** `list property &spi0` says `Node
not found: &spi0` where `read`, `update` and `add --parent` say `Use the bare
form: spi0` (GRM-021); `spi0//spidev@0` resolves; a path with a space is "not
found". `list property <path> a/b` looks up a property named `a/b` (`Property
a/b not found in <compatible> binding`), where GRM-030 would refuse it. The
completion of `&spi0/` is the exception: it offers the base's children
(`05-completion.md` CO-12).

**L-3. A multi-line description is indented on its first line only** in
`list devices <compatible>`, and one that ends in a newline leaves an empty
line before `binding:` (`list devices adi,ad7124-8`). A fix would be to indent
every line of the trimmed text.

**L-4. Two type notations.** `list devices` writes arrays as `number[]` and
`list property` (a node's listing and one property alike) as `number[2]` /
`number[]`: the same property shows different types. In `list devices`' JSON the `display` of `diff-channels` is
`number[]` while its `type` has `min_items` and `max_items` 2. `dt_type`
(LIST-057) is a third notation, dt-schema's, and the same in every command
(`uint32-array · 2 items` for `diff-channels`); `display` is to go once the GUI
prints `dt_type` instead.

**L-5. `list property <path> <property>` in JSON loses information.** Human
mode shows `const`, `min` and `max`; the JSON `property` has `required`,
`set`, `default` and `pinned` (LIST-054, LIST-056), but no range, except as
words in `dt_type` (`uint32 · 0 to 15`, LIST-057).

**L-6. `list parent` with an unknown compatible isn't a refusal.** It is `ok:
true` with severity `warn` and error type `unknown-device-type` (LIST-090),
while `add` refuses the same compatible with the same message (ADD-013).

**L-8. `list value` and `add` disagree on phandle candidates.** `list value adc
interrupt-parent` gives `gicv2` and `gpio`; `add`'s `missing_required` for
the same property also gives `aon_intr` marked `disabled` (LIST-078).

**L-9. `list devices` leaves out property patterns.** `list devices
adi,adt7475` says `6 properties, 1 child node patterns`, and its JSON
`device` has no entry for `^adi,bypass-attenuator-in[0-4]$`,
`^adi,pin(5|10)-function$` or `^adi,pin(9|14)-function$`, which `list
property` of such a node lists (LIST-034). A fix would be a `patterns` list
in `device`, described like `properties`, and a count in the human line.

**L-11. The `list property` input error names no node.** `list property
testpart x` says `'analog-attach read <node> x' describes one property`,
`<node>` written as is, where it could give the command to run, `read
testpart x` (LIST-522).

## 14. Examples

```
$ analog-attach list parent adi,ad7124-8
spi  /soc/spi@7e204000
spi1  /soc/spi@7e215080
…
spi6  /soc/spi@7e204c00

$ analog-attach list property
adc
adc/channel@0

$ analog-attach list property adc
compatible        (set, required)  enum(adi,ad7124-4 | adi,ad7124-8)
reg               (set, required)  number[1]
interrupts        (required)       (number, enum(IRQ_TYPE_NONE | …))[2]
interrupt-parent                   enum(gpio | gicv2 | aon_intr)
…
channel@0 … channel@15 (child node ^channel@([0-9]|1[0-5])$; present: channel@0)

$ analog-attach list property adc/channel@0 diff-channels
diff-channels (required): number[2]
  Many ADCs have dual Muxes to allow different input pins to be routed …
  min: 0
  max: 4294967295

$ analog-attach list value adc refin1-supply
vref	vref — regulator
cam1_reg	cam1_reg — regulator "cam1-reg"
cam_dummy_reg	cam_dummy_reg — regulator "cam-dummy-reg"
sd_vcc_reg	sd_vcc_reg — regulator "vcc-sd", 3.3 V
…

$ analog-attach --json list value adc clock-names
{"ok":true,"message":"Found 1 value(s) pinned by the binding","severity":"info",
 "suggestions":[{"value":"mclk","display_string":"\"mclk\" — the only value the binding allows"}]}

$ analog-attach list overlay
…
rpi-ad7124-8-all-diff-overlay.dts  compatible (family: brcm,bcm2835 → raspberrypi)  adds adi,ad7124-8
…

$ analog-attach list overlay adi,ad7124-8
rpi-ad7124-8-all-diff-overlay.dts  compatible (family: brcm,bcm2835 → raspberrypi)
rpi-cn0554-overlay.dts             compatible (family: brcm,bcm2835 → raspberrypi)
rpi-cn0556-overlay.dts             compatible (family: brcm,bcm2835 → raspberrypi)
rpi-ad7124-overlay.dts             compatible (family: brcm,bcm2835 → raspberrypi)  via adi,ad7124-4
rpi-cn0508-overlay.dts             compatible (family: brcm,bcm2835 → raspberrypi)  via adi,ad7124-4

$ analog-attach list node bcm2835-spi
/soc/spi@7e204000  &spi0 &spi  brcm,bcm2835-spi  (off)
/soc/spi@7e204600  &spi3       brcm,bcm2835-spi  (off)
/soc/spi@7e204800  &spi4       brcm,bcm2835-spi  (off)
/soc/spi@7e204a00  &spi5       brcm,bcm2835-spi  (off)
/soc/spi@7e204c00  &spi6       brcm,bcm2835-spi  (off)

5 nodes match "bcm2835-spi".
Use: analog-attach read <path>

$ analog-attach --json list node led_act
{"ok":true,"message":"1 node matches \"led_act\"","severity":"info","nodes":[{"path":"/leds/led-act",
 "key":"led-act","labels":["led_act"],"compatible":[],"origin":"external","change":"none","has_children":false}]}
```

(`adc` is an `adi,ad7124-8` added under `spi0` with `--label adc`, and `vref`
a `regulator-fixed` the overlay adds.)

Where the backend is noos (the test fixture's capi, a workfile for
`testboard` with an `eval-testpart` added):

```
$ analog-attach list context
  boardless (testvendor)
      no board: target the chip with 'analog-attach config target boardless'

  othersoc (testvendor)
      otherboard
      twobusboard

  testsoc (testvendor)
      testboard

3 boards on 3 chips.
Use: analog-attach config target <board>, then analog-attach init

$ analog-attach list devices test_spi
  capi-test:
    test_spi_config
    test_spi_controller
    test_spi_device

  platform-test:
    test_spi_extra

  testboard:
    bsp_test_spi_cfg

Use: analog-attach add <key> [--name <node name>]

$ analog-attach list property testpart_spi_dev
controller    include  required, set
max_speed_hz  number   required, set
mode          enum     set
native_cs     number   set
cs_gpio       include
cs_gpio_num   number

$ analog-attach list value testpart_ip comm_init
spi_dev
i2c_dev

$ analog-attach list value testpart_ip comm_init spi_dev
testpart_spi_dev

Can create:
  test_spi_device

$ analog-attach --json list value testpart_ip comm_init spi_dev
{"ok":true,"message":"2 suggestions","severity":"info","suggestions":[{"value":"testpart_spi_dev"},
 {"value":"test_spi_device","display_string":"test_spi_device (can create)"}]}

$ analog-attach list property testpart x
list property takes only a node: 'analog-attach read <node> x' describes one property
```
