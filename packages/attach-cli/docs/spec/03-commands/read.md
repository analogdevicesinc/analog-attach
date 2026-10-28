# read

Shows a node or a property as the base and the overlay together have it, or
the whole overlay.

## 1. Synopsis

```
attach-linux [--json] read [<path> [<property>]] [--quiet]
```

Grammar: rule `read` in `01-grammar.abnf`.

| Argument | Meaning | Default |
|---|---|---|
| `<path>` | The node: a node path (GRM-020). | none: the whole overlay (§5) |
| `<property>` | One property of the node (GRM-030). | none: the node (§6) |
| `--quiet` | Leave out what the binding says: the description, allowed values, suggestions and missing required properties. | off |

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
GRM-024, and report an input error when it fails.

**READ-003** When `<property>` is given, the CLI shall check it per GRM-030,
and report an input error when it fails.

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
other root nodes (`__overrides__`) are left out. These nodes have no `source`
or `origin`. (Open issue R-1.)

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
<p1>, <p2>, …` after the node, and nothing when none are missing. In JSON
mode, it shall add `missing_required`, an array of the names, which is
present (empty) when none are missing. Without a binding there is neither the
line nor the field.

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
READ-050, plus `source`, plus `description` when the binding describes it and
`suggestions` (READ-033, unfiltered) when there are any (schema
`read.schema.json#/$defs/read-property`). With `--quiet`, `description` and
`suggestions` are left out.

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
recursively. A collapsed child has `"collapsed": true`, no properties and no
children.

## 9. Open issues

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

## 10. Examples

```
$ attach-linux read spi0
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
$ attach-linux read adc reg
reg = <2>;
  SPI chip select number for the device   (adi,ad7124.yaml)
  Suggestions:
    2 — matches the unit address of adi,ad7124-8@2
```

```
$ attach-linux read spi0 compatible
compatible = "brcm,bcm2835-spi";   // base
  Compatible of the SPI device.   (brcm,bcm2835-spi.yaml)
  Allowed: brcm,bcm2835-spi | brcm,bcm2711-spi | brcm,bcm7211-spi
  Suggestions:
    brcm,bcm2835-spi  "brcm,bcm2835-spi"
    brcm,bcm2711-spi  "brcm,bcm2711-spi"
    brcm,bcm7211-spi  "brcm,bcm7211-spi"
```

```
$ attach-linux --json read adc/channel@0
{"kind":"node","key":"channel@0","properties":[{"kind":"property","key":"reg",
 "type":{"kind":"number","subtype":"int"},"value":0,"source":"overlay"}],
 "children":[],"alias":[],"origin":"overlay","missing_required":["diff-channels"]}
```

(Wrapped here; the CLI writes one line.)
