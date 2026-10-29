# read

Shows a node or a property as the base and the overlay together have it, or
the whole overlay. A shared command: §2 to §8 as the linux backend does it,
§9 as the noos backend does it (a node, a property of it, or the
workfile).

## 1. Synopsis

```
analog-attach [--json] read [<path> [<property>]] [--quiet]
analog-attach [--json] read [<node> [<property>]] [--quiet]     # where the backend is noos
```

Grammar: rule `read` in `01-grammar.abnf`.

| Argument | Meaning | Default |
|---|---|---|
| `<path>` | The node: a node path (GRM-020). | none: the whole overlay (§5) |
| `<property>` | One property of the node (GRM-030). | none: the node (§6) |
| `--quiet` | Leave out what the binding says: the description, allowed values, suggestions, providers to add and missing required properties. | off |

## 2. Terms

| Term | Meaning |
|---|---|
| Merged node | The node as the merged tree has it: the base's properties and children, with the overlay's applied. A property the overlay sets replaces the base's value in place. A property only the overlay sets comes after the base's. |
| Source | Where a property's value comes from: `overlay` when an overlay node for the node sets it (in any fragment), `base` otherwise. |
| Reached | A node is reached when the overlay has a node at its path, or when the target of one of the overlay's fragments is inside it. |
| Origin | `overlay` when the base doesn't have the node, `both` when the base has it and the overlay has a node at its path, `base` otherwise. |
| Collapsed child | A child of the read node that the overlay doesn't reach. Only its name and labels are shown. |

## 3. Resources

The command needs the base and the overlay (COM-070, 02-common §8.2, §8.3).
It uses the bindings when they load (02-common §8.4).

**READ-001** If the bindings can't be loaded, then the CLI shall read without
them: no description, `Allowed:` or `Default:` line and no missing required
properties, and no configuration error for the bindings. The suggestions
that don't come from a binding are still given (READ-033): `read adc reg`
still suggests `2 — matches the unit address of adi,ad7124-8@2`.

## 4. Input

**READ-002** When `<path>` is given, the CLI shall check it per GRM-020 to
GRM-024, and report an input error when it fails (COM-031: standard error,
status 2, in both modes).

**READ-003** When `<property>` is given, the CLI shall check it per GRM-030,
and report an input error when it fails (COM-031).

These checks run after the workspace is loaded, so a configuration error
is reported first.

## 5. The whole overlay

**READ-010** While in human mode, when no `<path>` is given, the CLI shall
write the overlay file's content as the CLI would save it, in the configured
overlay syntax (02-common §8.3).

**READ-011** While in JSON mode, when no `<path>` is given, the CLI shall
respond with a node object `{"kind": "node", "key": "/", "properties": [],
"children": […]}` (schema `read.schema.json#/$defs/overlay`). `children` is,
in file order, every node directly inside every fragment's `__overlay__` body,
converted per READ-050 and READ-051 with their own children. Properties set
directly in an `__overlay__` body, fragment targets, `__dormant__` bodies and
other root nodes (`__overrides__`) are left out. Their properties have no
`source`; the root and every node have `origin` `"overlay"`. (Open issue
R-1.)

## 6. A node

**READ-020** The CLI shall resolve `<path>` per GRM-025 to GRM-027: to the
overlay's node when the overlay has one, else to the base's.

**READ-021** If `<path>` names no node of the merged tree, then the CLI shall
refuse with `Not found: <path>`. When `<path>` contains `/` and the part
before its last `/` names a node, the message is `Not found: <path> (the
property is a separate argument: <path> <property>)`, where the first
`<path>` is the placeholder and `<path> <property>` after `argument: ` is
literal.

**READ-022** When no `<property>` is given, the CLI shall show the merged
node: its labels, its key, every property with its source, and its children.
A child the overlay reaches is shown in the same way, recursively. A child it
doesn't reach is collapsed.

**READ-023** While in human mode, the CLI shall write the node as devicetree
source:

```
<label>: …<key> {
    <property line>[   // base]
    …
    <child, indented by four more spaces>
};
```

The labels come first, each followed by `: `. A property line is
`<name>;` for a flag, and otherwise the property as devicetree source
(`reg = <0x7e204000 0x200>;`, `cs-gpios = <&gpio 0x8 0x1>, <&gpio 0x7 0x1>;`),
with the values written as the source has them. `   // base` (three spaces)
follows the line of a property whose source is `base`. A collapsed child is
one line: `<labels><key> { … };   // base`.

**READ-024** While in JSON mode, the CLI shall respond with the node per
READ-052 (schema `read.schema.json#/$defs/read-node`).

**READ-025** Where the bindings load, `--quiet` isn't given and the node's
binding is found, the CLI shall give the node's missing required properties
(as `add` §11 defines them). In human mode, it shall write `Missing required:
<p1>, <p2>, …` after the node, and nothing when none are missing. Without a
binding there is no line. JSON mode doesn't give them.

**READ-026** Where `--quiet` is given, the CLI shall show the node as
READ-022 to READ-024 say, `// base` marks included, without the missing
required properties.

## 7. A property

**READ-030** If the merged node has no property `<property>`, then the CLI
shall refuse with `Not found: <property> on <path>`, even when the binding
defines the property.

**READ-031** While in human mode, without `--quiet`, the CLI shall write the
property line of READ-023, with `   // base` when its source is `base`,
followed by the details of READ-032: lines 1 to 3 when the node's binding is
found and defines the property, and the suggestions (line 4) whenever there
are any, with or without a binding (`read spidev0 reg`, spidev having no
binding, suggests `0 — matches the unit address of spidev@0`).

**READ-032** The details are these lines, each indented by two spaces, in this
order:

1. The binding's description, one line per non-empty line, each trimmed. The
   last line is followed by three spaces and `(<binding file name>)`. With no
   description, the line is `(<binding file name>)` alone.
2. `Allowed: <allowed>`, when the binding restricts the value, and the
   property isn't a phandle. `<allowed>` is the `const` as JSON, or the enum
   options joined by ` | `, or the range as `<min>..<max>`, `>= <min>` or
   `<= <max>`. A range that only states the limits of an 8, 16, 32 or 64-bit
   signed or unsigned cell gives no line.
3. `Default: <default>`, the binding's default as JSON, when it has one.
4. The suggestions (READ-033), when there are any.
5. `Or add your own: analog-attach add <compatible>` (`, ` between several),
   when the property names a provider the user can add (READ-036).

**READ-033** The suggestions are what `list value` gives, followed by the
phandle's other candidates (marked `disabled`, `enabled`, `enabled by the
overlay`). When an `Allowed:` line lists enum options, a suggestion that only
repeats one of those options is left out. When every remaining suggestion's
display is its value, the line is `Suggestions: <v1>, <v2>, …`. Otherwise it is
`Suggestions:` followed by one line per suggestion, indented by four spaces:
the display when it starts with the value, else the value, two spaces and the
display.

**READ-034** While in human mode, with `--quiet`, the CLI shall write `true`
for a flag, and otherwise the property line of READ-023 without the `// base`
mark (`reg = <2>;`). (Open issue R-2.)

**READ-035** While in JSON mode, the CLI shall respond with the property per
READ-050, plus `source`, plus `description` when the binding describes it,
plus `suggestions` when there are suggestions (READ-033, unfiltered) or
providers to add (READ-036): `{ "values": [<suggestion>, …], "can_create":
[<suggestion>, …] }`, `values` always there (empty when there are none),
`can_create` only when it isn't empty (schema
`read.schema.json#/$defs/read-property`). With `--quiet`, `description` and
`suggestions` are left out.

**READ-036** The providers a user can add for a property instead of naming
one the tree has are attach-lib's `creatable_providers`: `fixed-clock` for
`clocks` and `regulator-fixed` for a `*-supply`, none for any other
property. In JSON each is `{ "value": <compatible>, "display_string": "add
<compatible>" }`, `<compatible>` being what `add` takes. They don't depend on
the binding.

## 8. JSON conversion

**READ-050** The CLI shall give a property as `{"kind": "property", "key":
<name>, "type": <type>, "value": <value>}`, the type inferred from the value as
written and not from the binding:

| Value as written | `type` | `value` |
|---|---|---|
| Flag (`spi-cpol;`) | `{"kind": "bool"}` | `true` |
| No value at all | `{"kind": "string"}` | `null` |
| Empty cell list (`<>`) | `{"kind": "array", "items": {"kind": "number", "subtype": "int"}}` | `[]` |
| One string (`""` included) | `{"kind": "string"}` | the string |
| One cell that is a number (`<2>`) | `{"kind": "number", "subtype": "int"}` | the number |
| One cell that is a reference or an expression (`<&gpio>`, `<(1+2)>`) | `{"kind": "string"}` | the string, as below |
| One group of several cells (`<19 2>`, `<&spi0_pins &spi0_cs_pins>`) | `{"kind": "array", "items": {"kind": "number", "subtype": "int"}}`, references or not | array of the cells |
| Several strings or groups (`"tx", "rx"`, `<&gpio 8 1>, <&gpio 7 1>`) | `{"kind": "array", "items": <type of the first>}` | array of the values |

Inside cells, a number is a JSON number, a phandle reference is the string
`&<label>` (or the path for a path reference), and a macro or expression is the
string as written. A reference outside cells is a string the same way.

**READ-051** The CLI shall give a node as `{"kind": "node", "key": <key>,
"properties": […], "children": […], "alias": <labels>}`, `alias` being the
array of its labels (empty when it has none).

**READ-052** For `read <path>`, the CLI shall give each property per READ-050
with `source`, and each node per READ-051 with `origin`, its children
recursively. A collapsed child (READ-022) has its key, labels and `origin`
`"base"`, and no properties and no children.

## 9. Where the backend is noos

The workfile is flat, so a path is one node name (GRM-080). The grammar
checks of GRM-020 to GRM-030 don't apply.

**READ-500** The CLI shall load the workfile (`02-common.md` COM-512). With
no `<node>` (or an empty one), the response shall be the workfile as a node:
`key` the workfile's file name without its extension, `origin` `internal`,
the properties `platform` and `board` (`null` when the workfile has none),
each of type `string`, and one child per stored node, in the workfile's
order (READ-501). External nodes are not among the children.

**READ-501** With `<node>`, the response shall be that node: `key` its name,
`origin` `internal` for a stored node or `external` for one the workfile
only names (overview §4), `alias` `[]`, `children` `[]`, and as properties
first `$compatible` (the schema, type `string`), then each property of its
schema in the schema's order, with its type (READ-510) and its value (`null`
when unset).

**READ-502** For an external node, the properties after `$compatible` shall
be `$symbol` (the C symbol) and `$provides` (what it provides), both of type
`string`.

**READ-503** With `<node> <property>`, the response shall be the property as
in READ-501, with its effective value (bootstrap's rules applied), and
`suggestions`: `values`, each `{ "value": <v> }`, what `update` can set
(`list.md` LIST-530 without the schemas), and `can_create`, each `{ "value":
<schema> }`, the schemas the user could add to provide one; both `[]` when
there are none.

**READ-504** When `<property>` names no property of the node but `$<property>`
does, the CLI shall read `$<property>`: `read testpart init_param` reads
`$init_param`, whose name a shell would otherwise expand. An exact name wins.

**READ-505** If `<node>` names no stored or external node, then the CLI shall
refuse with `Node '<node>' not found. Available: <names>`, `<names>` every
node the workfile has (stored, then external), joined with `, `. If
`<property>` names no property, then it shall refuse with `Property
'<property>' not found. Available: <names>`, the node's properties in order;
for an external node, `Node '<node>' is not a struct or descriptor`.

**READ-506** If computing the suggestions or the effective value fails, then
the CLI shall write `Warning: could not compute suggestions: <problem>` or
`Warning: could not apply overrides: <problem>` to standard error and go on
with none, or with the stored value.

**READ-510** The CLI shall give a property's type from its schema: `number`
(`subtype` `float` for a floating-point C type, else `int`), `bool`, `enum`
with the options as values, `array` with the element's type, and for a union
a `tuple` of an `enum` of the members (`display_string` `<member>
(<schema>)`) and a `string`; every other kind (include, string, raw, ops,
init_param, …) is `string`. A union's value is `[<member>, <value>]`, a
reference the name of the node it names.

**READ-511** While in human mode, with no `<node>`, the CLI shall write
`Platform: <chip>`, `Board:    <board>` (only when there is a board), an
empty line, `Nodes:`, an empty line, and per stored node `  <name>  <schema>
<n> value[s] from bootstrap` (the last part only when bootstrap filled some;
the columns padded to the longest plus two), then an empty line; `No nodes
defined.` instead of the heading and rows when there are none. With
`--quiet`, the node names, one per line.

**READ-512** While in human mode, with `<node>`, the CLI shall write the
name, then two spaces in the schema and its description (when it has one),
an empty line, and a table: `  Property  Type  Value`, a rule of `─`, and per
property `* ` (required) or two spaces, its name, its kind (`number`,
`string`, `boolean`, `enum`, `include`, `union`, `array`, `raw`, …) and its
value (`-` when unset, `(<schema>)` for an unset include, `<member> =
<value>` for a union, followed by ` (auto)` when bootstrap set it, or `-
(cleared)`), then an empty line and the legend:

```
* = required   (auto) = set by bootstrap   (cleared) = you set it to nothing
```

For an external node it shall write instead, after the empty line, the
lines `  Symbol:        <symbol>` and `  Provides:      <provides>`, an empty
line and `  Defined by the library; nothing to configure.`. With `--quiet`, `<property> <value>` per line (the value left
out when unset).

**READ-513** While in human mode, with `<node> <property>`, the CLI shall
write the name, an empty line, and the lines `Type:`, `Required:` (`yes` or
`no`), `Value:` (`(not set)` when unset), `Set by:` (`bootstrap (follows the
rules until you change it)`, `you`, or `you (cleared: left empty, bootstrap
will not fill it)`; left out when unset), `Default:` and `Description:` when
there are any, each label padded to 15 characters two spaces in; then by
kind `Constraints:` (`minimum`, `maximum`), `Options:` (`● <value>  (current)`
or `○ <value>`, for an enum or a boolean), `Members:` (`● <member> <schema>
(selected)` or `○ …`), or for an array `Max size:` and the format line
`analog-attach update <node> <property> value1,value2,value3`; then
`Suggestions:` (`• <value>`, not for an enum or a boolean) and `Can create:`
(`+ <schema>`) when there are any. With `--quiet`, the value alone (empty
when unset).

## 10. Open issues

**R-1. `read --json` without a path loses where nodes go.** The children of
every fragment are flattened into one list under `/`. A client can't tell
which node each one is added to, and properties the overlay sets on base nodes
(`status = "okay"` on `spi0`) are missing. Human mode prints the file.

**R-2. `read --quiet <path> <property>` prints the whole line.** The help says
"Print only the value", but the output is `reg = <2>;`, not `<2>`.

**R-3. The JSON `type` of a read is the value's, not the binding's.** `reg =
<2>` is a `number` even when the binding gives an array of addresses, and
`interrupt-parent` is a `string`. `list property` has the binding's type.

**R-4. Large cells lose precision in JSON.** Cell values are converted to JSON
numbers, so a 64-bit value above 2^53 is rounded.

**R-5. The "separate argument" hint misfires.** `read adc/channel@0` on a node
without that child says `Not found: adc/channel@0 (the property is a separate
argument: <path> <property>)`, because `adc` resolves. The same message is
used by `delete`, `move`, `rename` and `update`.

**R-6. An unknown chip lists no chips without module repositories.** With
`capi-path` set and `module-paths` unset, a workfile for `testsoc` gives
`Unknown chip 'testsoc'. Configured platforms support: ` with nothing after
the colon (`02-common.md` COM-512). A fix would be to say that no module
repository is configured and point at `config module-paths`.

## 11. Examples

```
$ analog-attach read spi0
spi0: spi: spi@7e204000 {
    compatible = "brcm,bcm2835-spi";   // base
    reg = <0x7e204000 0x200>;   // base
    …
    status = "okay";
    …
    spidev0: spidev@0 { … };   // base
    spidev1: spidev@1 { … };   // base
    adc: adi,ad7124-8@2 {
        compatible = "adi,ad7124-8";
        reg = <2>;
        #address-cells = <1>;
        #size-cells = <0>;
        spi-max-frequency = <1000000>;
        channel@0 {
            reg = <0>;
        };
    };
};
```

```
$ analog-attach read adc reg
reg = <2>;
  SPI chip select number for the device   (adi,ad7124.yaml)
  Suggestions:
    2 — matches the unit address of adi,ad7124-8@2
```

```
$ analog-attach read spi0 compatible
compatible = "brcm,bcm2835-spi";   // base
  Compatible of the SPI device.   (brcm,bcm2835-spi.yaml)
  Allowed: brcm,bcm2835-spi | brcm,bcm2711-spi | brcm,bcm7211-spi
  Suggestions:
    brcm,bcm2835-spi  "brcm,bcm2835-spi"
    brcm,bcm2711-spi  "brcm,bcm2711-spi"
    brcm,bcm7211-spi  "brcm,bcm7211-spi"
```

```
$ analog-attach --json read adc/channel@0
{"kind":"node","key":"channel@0","properties":[{"kind":"property","key":"reg",
 "type":{"kind":"number","subtype":"int"},"value":0,"source":"overlay"}],
 "children":[],"alias":[],"origin":"overlay"}
```

(Wrapped here; the CLI writes one line.)

```
$ analog-attach read adc refin1-supply
refin1-supply = <&vdd_3v3_reg>;
  refin1 supply can be used as reference for conversion.   (adi,ad7124.yaml)
  Suggestions:
    cam1_reg — regulator "cam1-reg"
    vdd_3v3_reg — regulator "3v3", 3.3 V, always on
    …
  Or add your own: analog-attach add regulator-fixed
```

Where the backend is noos:

```
$ analog-attach read testpart_spi_dev
testpart_spi_dev
  test_spi_device
  One device on a SPI bus

  Property      Type     Value
  ─────────────────────────────────────────
* controller    include  bsp_test_spi_cfg_handle (auto)
* max_speed_hz  number   1000000 (auto)
  mode          enum     TEST_SPI_MODE_0 (auto)
  native_cs     number   1 (auto)
  cs_gpio       include  (test_gpio_pin)
  cs_gpio_num   number   -

* = required   (auto) = set by bootstrap   (cleared) = you set it to nothing
```

```
$ analog-attach read testpart_ip comm_init
comm_init

  Type:          union
  Required:      yes
  Value:         spi_dev = testpart_spi_dev
  Set by:        bootstrap (follows the rules until you change it)
  Description:   Bus device this part is attached to

  Members:
    ● spi_dev     test_spi_device  (selected)
    ○ i2c_dev     test_i2c_device

  Suggestions:
    • spi_dev
    • i2c_dev
```

```
$ analog-attach --json read testpart_ip comm_init
{"kind":"property","key":"comm_init","type":{"kind":"tuple","items":[{"kind":"enum","options":[
 {"value":"spi_dev","display_string":"spi_dev (test_spi_device)"},{"value":"i2c_dev","display_string":"i2c_dev (test_i2c_device)"}]},
 {"kind":"string"}]},"value":["spi_dev","testpart_spi_dev"],
 "suggestions":{"values":[{"value":"spi_dev"},{"value":"i2c_dev"}],"can_create":[]}}
$ analog-attach --json read testpart_ops
{"kind":"node","key":"testpart_ops","properties":[
 {"kind":"property","key":"$compatible","type":{"kind":"string"},"value":"testpart_ops"},
 {"kind":"property","key":"$symbol","type":{"kind":"string"},"value":"testpart_ops"},
 {"kind":"property","key":"$provides","type":{"kind":"string"},"value":"test_sensor_ops"}],
 "children":[],"origin":"external","alias":[]}
```

(Wrapped here; the CLI writes one line.)
