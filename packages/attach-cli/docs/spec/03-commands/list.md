# list

Lists what the bindings, the base and the overlay offer: devices, a node's
properties, the values for a property, the parents a device can go under, and
the Linux tree's overlays that have a device. Nothing is written.

## 1. Synopsis

```
attach-linux [--json] list
attach-linux [--json] list device [<filter>]
attach-linux [--json] list property <path> [<property>]
attach-linux [--json] list value <path> <property>
attach-linux [--json] list parent <compatible>
attach-linux [--json] list overlay <compatible>
```

Grammar: rule `list` in `01-grammar.abnf`. The `list-argument` elements per
kind:

```
list-args       = list-device / list-property / list-value / list-parent / list-overlay
list-device     = %s"device" [ B element ]                     ; filter
list-property   = %s"property" B element [ B element ]        ; path, property
list-value      = %s"value" B element B element               ; path, property
list-parent     = %s"parent" B compatible
list-overlay    = %s"overlay" B compatible
                  ; every kind ignores elements after those above (LIST-003)
```

The path is an element, not a `node-path`: `list` doesn't make the checks
GRM-020 to GRM-024 (LIST-004).

## 2. Terms

| Term | Meaning |
|---|---|
| Compat index | `.attach-linux/compat-index.json`: every compatible string of the Linux tree's bindings, mapped to its binding file (02-common.md §8.4). |
| Node's binding | For a node with a `compatible`, the binding of its first compatible. For a node without one, the child-node pattern of its parent's binding that matches its name (`^channel@([0-9]|1[0-5])$`). |
| Narrowed binding | The node's binding with the `if`/`then`/`else` branches the node's own data selects applied: its properties and required list (CLAUDE.md "If/then narrowing"). |
| Merged node | The node as the base and the overlay together have it (`effective_node`). |
| Suggestion | `{ value, display_string?, note? }` (`04-protocol/common.schema.json#/$defs/suggestion`); `value` is ready to pass to `update` (GRM-070). |

## 3. All kinds

**LIST-001** When no kind is given, the CLI shall list the five kinds without
loading the workspace. In human mode it shall write, for each kind, a line
`<kind> <args>` and a line with four spaces and its summary:

| Kind | Args | Summary |
|---|---|---|
| `device` | `[compatible]` | `Device bindings by compatible string` |
| `property` | `<path> [property]` | `Properties of a node from its binding` |
| `value` | `<path> <property>` | `Concrete values for a property` |
| `parent` | `<compatible>` | `Valid parent buses for a device` |
| `overlay` | `<compatible>` | `Overlays in the Linux tree with a device, and whether they fit the board` |

The Args column is literal: `<path>`, `<property>` and `<compatible>` are
printed as is.

In JSON mode it shall respond `{"ok": true, "message": "5 list kinds
available", "severity": "info", "intelligence": [...]}` with one entry per
kind, `{ kind, description: <summary>, args: [{ name: "args", description:
<args>, required: false }] }` (`04-protocol/list.schema.json#/$defs/kinds`).

**LIST-002** If the kind is none of the five, then the CLI shall refuse with
`Unknown list kind: <kind>. Valid kinds: device, property, value, parent,
overlay`, without loading the workspace.

**LIST-003** The CLI shall ignore the arguments after those §1 gives each
kind: `list value adc reg extra` is `list value adc reg`.

**LIST-004** The CLI shall resolve a path argument per GRM-025 to GRM-027
without checking it per GRM-020 to GRM-024. A path no node has (including
`&spi0`, or one with whitespace) is a refusal of the kind (`Node not found`),
not an input error. A path with `//` resolves as if the empty segment weren't
there. (Open issue L-1.)

**LIST-005** If a kind is missing a required argument, then the CLI shall
report an input error (COM-031, COM-033) before loading the workspace:

| Kind | JSON mode (standard error, exit 2) | Human mode (standard output, exit 0) |
|---|---|---|
| `property` | `path is required for list property` | `Missing: path (list property <path> [property])` |
| `value` | `path and property are required for list value` | `Missing: path and property (list value <path> <property>)` |
| `parent` | `compatible string is required for list parent` | `Missing: compatible (list parent <compatible>)` |
| `overlay` | `compatible string is required for list overlay` | `Missing: compatible (list overlay <compatible>)` |

In the human-mode messages, `<path>`, `<property>` and `<compatible>` are
literal.

**LIST-006** The CLI shall load only the resources each kind needs (COM-070),
and report problems with them per COM-071 and COM-072:

| Kind | Needs |
|---|---|
| `device` | bindings |
| `property` | bindings, base, overlay |
| `value` | base, overlay; bindings when they load (LIST-074) |
| `parent` | bindings, base |
| `overlay` | bindings, base |

`property` and `value` therefore need a configured overlay. Without one they
report `Missing config field overlay` (02-common.md §8.3).

**LIST-007** The CLI shall not write the overlay or the config.

## 4. `list device`

**LIST-010** When the filter is a compatible of the compat index and that
binding parses, the CLI shall describe that one device (LIST-012).

**LIST-011** Otherwise the CLI shall list every compatible of the compat index
that contains the filter as a substring, or every compatible when there is no
filter, in the compat index's order. In human mode it shall write one per line,
and nothing when none match. In JSON mode it shall respond `{"ok": true,
"message": "Found <n> devices", "severity": "info", "names": [...]}`. A filter
that matches nothing isn't a refusal. (Open issue L-2.)

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
"Device <compatible>", "severity": "info", "device": <device>}`
(`list.schema.json#/$defs/device-response`). `device.properties` lists the
binding's properties in its order as `{ name, description?, type: { type,
display }, required }`, `required` being the unconditional required list
(no narrowing: there is no node). `device.children` lists the child-node
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

**LIST-033** A property's entry shall be its name, followed by ` (<marks>)`
when it has marks: `set` when the merged node has it, `required` when the
narrowed binding requires it, joined by `, ` (`compatible (set, required)`).

**LIST-034** A property pattern's entry shall be `<names> (pattern <regex>)`
or `<names> (pattern <regex>; set: <set>)`, where `<set>` lists the node's
properties the pattern matches, joined by `, `. `<names>` is what the pattern
matches: the names joined by `, ` when there are at most three, `<first> …
<last>` when there are more, or `<stem>…` when the pattern fixes only a start.
A pattern that isn't anchored with `^`, or fixes nothing, shows the regex
itself and only `(pattern)` / `(pattern; set: …)`.

**LIST-035** A child-node pattern's entry shall be `<names> (child node
<regex>; present: <children>)`, `<children>` being the node's children the
pattern matches joined by `, `, or `none`. `<names>` is as in LIST-034.
Example: `channel@0 … channel@15 (child node ^channel@([0-9]|1[0-5])$;
present: channel@0)`.

**LIST-036** In human mode the CLI shall write one entry per line. In JSON mode
it shall respond `{"ok": true, "message": <m>, "severity": "info",
"suggestions": [...]}` (`list.schema.json#/$defs/suggestions-response`) with
one suggestion per entry: for a property `{ value: <name> }`, plus
`display_string: <entry>` when it has marks; for a pattern `{ value: <regex>,
display_string: <entry> }`. `<m>` is `Found <n> properties`, followed by `,
<p> property pattern(s)` when there are property patterns and ` and <c> child
node pattern(s)` when there are child-node patterns.

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

**LIST-052** In human mode the CLI shall write:

```
<property>[ (required)]: <type>
  <description, one line per non-empty line, trimmed>
  const: <json>
  default: <json>
  min: <n>
  max: <n>
  <suggestion value>\t<suggestion display>
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
`(enum(clk_osc | … ))[]`.

**LIST-054** In JSON mode the CLI shall respond `{"ok": true, "message":
"Type of <property>", "severity": "info", "type": <type>, "description"?:
<description>, "suggestions"?: [...]}` (`list.schema.json#/$defs/type-response`),
`suggestions` only when the binding's definition offers values. `type` has
`min_items` / `max_items` per CLAUDE.md "update value format". The response
doesn't say whether the property is required, nor its const, default or
range (open issue L-5).

## 7. `list value <path> <property>`

**LIST-070** If the path names no node of the merged tree, then the CLI shall
refuse per LIST-030.

**LIST-071** The CLI shall ask attach-lib's default intelligence stack for the
property's values, giving it the node's place in the overlay, the merged tree
as the context devicetree (so the overlay's own nodes are candidates), the
node's data, and, when the node's binding resolves, its narrowed properties
and required list. A property named by a binding pattern is offered to the
stack under its own name.

**LIST-072** When the property is `clocks` or ends in `-supply`, the CLI shall
put the values that name a node the overlay adds (its label is the overlay's
and not the base's) before the others, keeping the order within each group.
For other properties the stack's order stays (the inherited interrupt parent
first).

**LIST-073** When the node's binding resolves, the CLI shall check each value
against the binding's definition of the property, narrowed with the value
in place, and add a note to a value that fails: `not defined by <origin>;
validate may reject it` when the binding doesn't define the property (origin
per LIST-051), or the value check's message otherwise. Notes join with `; `.

**LIST-074** Where the bindings or their caches don't load, the CLI shall still
list the values, unchecked, and end the message with `; not checked against a
binding (<reason>)`. It shall do the same when the node's binding doesn't
resolve, `<reason>` being the LIST-031 message. (With the default
`preprocess-command`, `linux` must still be set: the base needs it when the
command contains `{linux}`, 02-common.md COM-092.)

**LIST-075** A value's `display_string` shall be the stack's display,
followed by ` (<note>)` when it has a note the display doesn't already contain.
`note` is set when there is one.

**LIST-076** The message shall be `Found <parts>`, the parts being `<n>
value(s) pinned by the binding` and `<n> value(s) from the context devicetree`
for those that aren't zero, joined by `; `, or `No values for <property>` when
there are none. LIST-074 may add to it.

**LIST-077** In human mode the CLI shall write one line per value,
`<value>\t<display_string>`, or the message alone when there are none. In JSON
mode it shall respond `{"ok": true, "message": <m>, "severity": "info",
"suggestions": [...]}`, also when there are none.

**LIST-078** The CLI shall list only the stack's values. The other candidates
`add` and `read` show under a phandle property (a disabled interrupt
controller, marked `disabled`) aren't listed. `*-gpios` properties get no
values.

**LIST-079** When the binding's options for a string property are fallback
lists (the root's `compatible`: `["raspberrypi,4-model-b",
"brcm,bcm2711"]`), the CLI shall offer each list as one string, its strings
joined by `,` (`raspberrypi,4-model-b,brcm,bcm2711`, displayed in double
quotes). The check of LIST-073 then fails each of them and adds the note
`Values for property compatible are <options>`, `<options>` being every
option as JSON (`[["raspberrypi,400","brcm,bcm2711"],…]`). (Open issue
L-10.)

## 8. `list parent <compatible>`

**LIST-090** If no binding has the compatible, then the CLI shall write
`Failed to find binding for <compatible>` in human mode, and respond `{"ok":
true, "message": "No binding found for <compatible>", "severity": "warn",
"suggestions": []}` in JSON mode (open issue L-6). If the binding doesn't parse,
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
when it has none (for a `clocks` node: its name). `/` is `{ value: "/",
display_string: "/" }`. In human mode the CLI shall write one line per parent,
`<value>  <display_string>` (`spi  /soc/spi@7e204000`). In JSON mode it shall
respond `{"ok": true, "message": "Found <n> valid parents", "severity":
"info", "suggestions": [...]}`.

**LIST-093** `add` takes the parent from this list (ADD-020 to ADD-022,
ADD-062, ADD-072).

## 9. `list overlay <compatible>`

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
[...]}`, each `{ name, path, fit, reason, matched? }`, `name` being the file
name (what `import` and `add --template overlay:` take) and `path` absolute
(`list.schema.json#/$defs/overlay-response`).

**LIST-115** A compatible no binding has, or no overlay adds, gives an empty
list, not a refusal.

## 10. Open issues

**L-1. `list` paths skip the path checks.** `list property &spi0` says `Node
not found: &spi0` where every other command says `Use the bare form: spi0`
(GRM-021); `spi0//spidev@0` resolves; a path with a space is "not found".
`list property <path> a/b` reads `<path>/a` as the node and `b` as the
property, where GRM-030 would refuse it. The hidden `__list children` (and so
the completion of `&spi0/`) is the exception: `__list children &spi0`
succeeds, with the base's children only (`__list.md` IL-3).

**L-2. `list device` filters by substring.** The help says "Filter by
prefix" (`list device adi`), but `list device 7124-` lists `adi,ad7124-4` and
`adi,ad7124-8`. The names aren't sorted either.

**L-3. A multi-line description is indented on its first line only** in
`list device <compatible>`, and one that ends in a newline leaves an empty
line before `binding:` (`list device adi,ad7124-8`). A fix would be to indent
every line of the trimmed text.

**L-4. Two type notations.** `list device` writes arrays as `number[]` and
`list property` as `number[2]` / `number[]`: the same property shows
different types.

**L-5. `list property <path> <property>` in JSON loses information.** Human
mode shows `(required)`, `const`, `default`, `min`, `max`; the JSON response
has only `type`, `description` and `suggestions`. `src/protocol/descriptions.ts`
declares `PropertyDescriptionResponse` (with `required`) for this, unused.

**L-6. `list parent` with an unknown compatible isn't a refusal in JSON.** It
is `ok: true` with severity `warn` (COM-050 says `info`), while human mode
says `Failed to find binding`, the wording of a refusal.

**L-7. Vendor SPI properties come back after narrowing.** `list property` of
a node under `brcm,bcm2835-spi` lists `pl022,*`, `cdns,*`, `fsl,*`,
`nvidia,*`, `st,*` properties, and `list property spi0` lists
`#address-cells` twice. Parsing removes the vendor properties (CLAUDE.md "SPI
vendor peripheral-props filtering"), but the narrowed binding brings them
back. Completion (`__list navigate`) offers them too.

**L-8. `list value` and `add` disagree on phandle candidates.** `list value adc
interrupt-parent` gives `gicv2` and `gpio`; `add`'s `missing_required` for
the same property also gives `aon_intr` marked `disabled` (LIST-078).

**L-9. `list device` leaves out property patterns.** `list device
adi,adt7475` says `4 properties, 1 child node patterns`, and its JSON
`device` has no entry for `^adi,bypass-attenuator-in[0-4]$`,
`^adi,pin(5|10)-function$` or `^adi,pin(9|14)-function$`, which `list
property` of such a node lists (LIST-034). A fix would be a `patterns` list
in `device`, described like `properties`, and a count in the human line.

**L-10. Fallback compatibles are offered as one joined string.** `list value
/ compatible` (an RPi 4 base) offers `raspberrypi,4-model-b,brcm,bcm2711`,
each value with the note `Values for property compatible are [[…]]`
(LIST-079). Passed to `update / compatible`, it writes `compatible =
"raspberrypi,4-model-b,brcm,bcm2711";`, one string, not the two the binding
asks for. The binding layer (attach-lib `enum_value`) turns each option with
`String(option)`. A fix would be to keep a fallback list's strings apart in
the suggestion, and check and write them as a list of strings.

## 11. Examples

```
$ attach-linux list parent adi,ad7124-8
spi  /soc/spi@7e204000
spi1  /soc/spi@7e215080
…
spi6  /soc/spi@7e204c00

$ attach-linux list property adc
compatible (set, required)
reg (set, required)
interrupts (required)
interrupt-parent
…
channel@0 … channel@15 (child node ^channel@([0-9]|1[0-5])$; present: channel@0)

$ attach-linux list property adc/channel@0 diff-channels
diff-channels (required): number[2]
  Many ADCs have dual Muxes to allow different input pins to be routed …
  min: 0
  max: 4294967295

$ attach-linux list value adc refin1-supply
vref	vref — regulator
cam1_reg	cam1_reg — regulator "cam1-reg"
cam_dummy_reg	cam_dummy_reg — regulator "cam-dummy-reg"
sd_vcc_reg	sd_vcc_reg — regulator "vcc-sd", 3.3 V
…

$ attach-linux --json list value adc clock-names
{"ok":true,"message":"Found 1 value(s) pinned by the binding","severity":"info",
 "suggestions":[{"value":"mclk","display_string":"\"mclk\" — the only value the binding allows"}]}

$ attach-linux list overlay adi,ad7124-8
rpi-ad7124-8-all-diff-overlay.dts  compatible (family: brcm,bcm2835 → raspberrypi)
rpi-cn0554-overlay.dts             compatible (family: brcm,bcm2835 → raspberrypi)
rpi-cn0556-overlay.dts             compatible (family: brcm,bcm2835 → raspberrypi)
rpi-ad7124-overlay.dts             compatible (family: brcm,bcm2835 → raspberrypi)  via adi,ad7124-4
rpi-cn0508-overlay.dts             compatible (family: brcm,bcm2835 → raspberrypi)  via adi,ad7124-4
```

(`adc` is an `adi,ad7124-8` added under `spi0` with `--label adc`, and `vref`
a `regulator-fixed` the overlay adds.)
