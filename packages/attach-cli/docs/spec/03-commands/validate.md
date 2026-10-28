# validate

Checks the overlay against its bindings with dt-validate. Also checks the
addresses and chip selects of the overlay's nodes.

## 1. Synopsis

```
attach-linux [--json] validate
```

Grammar: rule `validate` in `01-grammar.abnf`. The command takes no arguments
or options.

## 2. Terms

| Term | Meaning |
|---|---|
| Fragment | One target of the overlay (`fragment@N { target = …; __overlay__ { … } }`, or `&label { … }` in label syntax), counted from 0 in file order. |
| Validation tree | The devicetree source the CLI builds for dt-validate (§4). It has one node `node<N>` per fragment, so its paths are `/node<N>/…`. |
| Diagnostic | One entry of dt-validate's JSON output, or one address warning (§7). It has a level (`warning`, or anything else for an error), an optional node path, an optional property path, a message, and optionally a note and context lines. |
| Display path | A validation-tree path as human output shows it: `/node<N>` replaced by the fragment's target (§6.2). |

## 3. Resources

The command needs the bindings (with `validation.json`, 02-common.md §8.4),
the bundled tools, the base and the overlay (COM-070; §8.2, §8.3).

## 4. The validation tree

**VALIDATE-001** The CLI shall write the validation tree to
`.attach-linux/temp.dts`. It is a `/plugin/` source whose root has
`compatible = "goo"`, `model = "goo"`, `#address-cells = <1>` and
`#size-cells = <1>`, and one child `node<N>` per fragment, in order. (`<1>`
is devicetree syntax and literal; `<N>` is the fragment's number.)

**VALIDATE-002** Each `node<N>` shall have `#address-cells` and `#size-cells`
equal to those of the base node the fragment targets (by `target` label or
path, or `target-path`), each defaulting to 1 and 0 when the base node lacks
them or the target isn't in the base.

**VALIDATE-003** Each `node<N>` shall hold the children of the fragment's
`__overlay__` body as written, with their labels, properties and children. A
fragment without an `__overlay__` body (only `__dormant__`) gives an empty
`node<N>`. Base nodes aren't in the validation tree, and neither are the
properties set directly in a body, on the fragment's target (`&spi0 {
cs-gpios = …; status = "okay"; };`): only the nodes the overlay writes are
validated. (Open issue V-9.)

**VALIDATE-004** For each label that a fragment's body references, the base
defines and the overlay doesn't, the CLI shall add a stub of that base node
to the first `node<N>` that references it: the node's labels and name, its
`#…-cells` properties and its `…-controller` flags, and nothing else. Specifiers
such as `<&gpio 26 1>` (literal devicetree syntax) can then be decoded. A label that is in neither the base
nor the overlay gets no stub (VALIDATE-030).

**VALIDATE-005** When a fragment's body has `interrupts` somewhere, but no
`interrupt-parent` naming a label anywhere in it, the CLI shall add to its
`node<N>` `interrupt-parent = <&fake_intc_<N>>` and a node `fake_intc_<N>` with
`#interrupt-cells = <1>` and `interrupt-controller`. `<N>` is the fragment's
number; the other `<`, `>` and `&` are literal devicetree syntax.

## 5. Running the tools

**VALIDATE-010** The CLI shall compile the validation tree with the bundled
dtc into `.attach-linux/temp.dtb` (`<dtc> -I dts -O dtb -o <temp.dtb>
<temp.dts>`). If dtc fails, then the CLI shall report its standard error
(VALIDATE-013) and not run dt-validate.

**VALIDATE-011** The CLI shall delete `.attach-linux/error.json` when it
exists, then run the bundled dt-validate as `<dt-validate> -s
<validation.json> <temp.dtb> --json-output <error.json>`. A non-zero exit
status isn't a failure when `error.json` was written: dt-validate exits
non-zero when it finds errors.

**VALIDATE-012** If dt-validate exits with a non-zero status and wrote no
`error.json`, then the CLI shall report its standard error (VALIDATE-013) as
`dt-validate error:` in human mode. If `error.json` can't be read, isn't
JSON, or isn't an array, then the CLI shall report `dt-validate output
unreadable: <why>`, `<why>` being the read error, `not valid JSON` or `not an
array`. A dt-validate that exits with status 0 without writing `error.json`
gets the read error (`ENOENT: no such file or directory, open '<file>'`), not
its standard error.

**VALIDATE-013** A tool failure (VALIDATE-010, VALIDATE-012) shall be one
error without a path. Human mode writes `dtc error:` or `dt-validate error:` on
a line, then the tool's standard error as it is, then a newline: the tool's
own final newline leaves an empty line at the end. The unreadable-output
message is written alone, as one line. JSON mode gives the standard error
unchanged, final newline included, and responds `{ "errors": [{ "kind":
"generic", "path": [], "message": <text> }], "warnings": [] }`.

## 6. Results

**VALIDATE-020** The CLI shall report dt-validate's diagnostics followed by
the address warnings of §7.4, all as diagnostics.

### 6.1 JSON output

**VALIDATE-021** While in JSON mode, the CLI shall respond per
`04-protocol/validate.schema.json`: `{ "errors": [...], "warnings": [...] }`,
each entry `{ "kind": "generic", "path": <segments>, "message": <text> }`.
A diagnostic of level `warning` goes to `warnings`, any other to `errors`, both
in the order of VALIDATE-020.

**VALIDATE-022** An entry's `path` shall be the diagnostic's validation-tree
node path split at `/` without empty segments, followed by its property path
(`["node0", "adc@5", "reg"]`). An entry's `message` shall be dt-validate's
`formatted` text when there is one (for an address warning with a hint,
`<message>; <hint>`), and its `message` otherwise.

### 6.2 Human output

**VALIDATE-023** While in human mode, the CLI shall first write a line
`<level>: <message>` for each diagnostic without a node, `<level>` being
`warning` or `error`.

**VALIDATE-024** It shall then write the diagnostics with a node, grouped by
display path: the groups in the order of their first diagnostic, errors
before warnings, the error groups before groups that have only warnings. A
group is a line `<display path>:` followed by, for each diagnostic:

```
  <level>: <property path>: <message>
    note: <note>
    context: <context line>
```

`<property path>` is the property path joined by `/` (`reg/0/0`), or `(node)`
when it is empty. The note line is there only when the diagnostic has a note.
There is one context line per context entry, written as JSON when it isn't a
string. Human mode shows dt-validate's `message`, not its `formatted` text.

**VALIDATE-025** The display path of `/node<N><rest>` shall be
`<target><rest>`, `<target>` being the first label of fragment N's `target`,
or else its `target-path`. When the target is `/`, it shall be `<rest>`, or
`/` when `<rest>` is empty. A path
of another form, or of a fragment with neither, is shown unchanged.

**VALIDATE-026** When there are no errors, the CLI shall end with `No
errors!`, or `No errors! (<n> warning(s))` when there are warnings. When there
are errors, there is no summary line.

**VALIDATE-027** The exit status shall be 0 whatever the diagnostics.

### 6.3 Files

**VALIDATE-028** The CLI shall change no file other than `temp.dts`,
`temp.dtb` and `error.json` in `.attach-linux/`, and the scratch files of
02-common.md §8.2. It never changes the overlay.

### 6.4 References

**VALIDATE-030** The CLI shall not report a reference to a label that is in
neither the base nor the overlay. dtc accepts it in a `/plugin/` source as a
fixup, and dt-validate decodes the specifiers after it without the provider's
cell count (Open issue V-2). `import` and `add --template` report such
references (`unresolved`).

## 7. Address warnings

The CLI checks the addresses the merged tree's nodes claim. `add`, `update
<path> reg`, `rename` and `validate` report the results with the wording of
this section. The other chapters cite it.

### 7.1 Clashes

**VALIDATE-100** Two children of one node *clash* when both are enabled (no
`status`, or `status` of `okay` or `ok`), both have a `reg` that decodes with
the parent's `#address-cells` and `#size-cells` (from the first overlay node
for the parent, else the base's, else 1 and 0, as in ADD-048; open issue
V-11), and:
- the parent's `#size-cells` is 0, and an address of one equals an address of
  the other; or
- the parent's `#size-cells` is more than 0, and a range of one overlaps a
  range of the other, a size of 0 counting as 1.

The *clash address* is the first equal address, or for ranges the higher of
the two overlapping starts. The parent's own `status` doesn't matter: a bus
is often enabled later, and its devices clash then.

**VALIDATE-101** A clash shall be worded, from the side of node `<name>` with
the other node `<other>` (both by name with unit address):

| Parent | Message |
|---|---|
| `#size-cells` more than 0 | `reg overlaps <other> at 0x<address>` |
| SPI bus (by bus kind, add.md §2) | `chip select <address> is already used by <other>` |
| I2C bus | `address 0x<address> is already used by <other>` |
| any other | `reg 0x<address> is already used by <other>` |

`0x<address>` is lower-case hexadecimal, and a chip select is decimal.

**VALIDATE-102** When `<other>` isn't the overlay's (VALIDATE-110), the
warning shall have the hint `If <name> replaces it: disable <other path>`,
`<other path>` being its absolute path.

### 7.2 Chip selects without a `cs-gpios` entry

**VALIDATE-103** A child of a controller with `cs-gpios` *overflows* when it
is enabled and an address of its `reg` is at least the number of
`cs-gpios` entries. An entry is a phandle followed by its provider's
`#gpio-cells` cells, or a lone 0 (the controller's own chip select). The
provider is the node the phandle names in the base, and its `#gpio-cells` is
read from the merged tree. A controller without `cs-gpios`, or whose entries
can't be counted, isn't checked: a phandle to a node the base doesn't have (a
GPIO expander the overlay adds), a provider without `#gpio-cells`, or a
number other than 0 where an entry starts. (Open issue V-10.)

**VALIDATE-104** An overflow shall have the message `chip select <n> has no
cs-gpios entry: <controller> has <range>` and the hint `Use one of those, or
add a GPIO for it to cs-gpios of <controller path>`. `<n>` is the first such
address, `<controller>` the controller's name with unit address, and
`<range>` `chip select 0` for one entry or `chip selects 0-<k-1>` for `<k>`.

### 7.3 The overlay's nodes

**VALIDATE-110** A node is *the overlay's* when the overlay adds it, or when
the first overlay node for its path (in file order) sets its `reg` or
`status`. A base node the overlay only adds children to (pin groups under
`gpio`) isn't, and neither is one whose `reg` or `status` only a later
fragment for it sets. (Open issue V-11.)

### 7.4 When they are reported

**VALIDATE-111** `validate` shall report every clash in the merged tree in
which at least one node is the overlay's, from the side of the overlay's
node, or of the second one in the parent's child order when both are. It
shall report every overflow of a node that is the overlay's. It shall leave
out clashes and overflows of base nodes only. Clashes come first, then
overflows, each in tree order.

**VALIDATE-112** In `validate`, each warning shall be a diagnostic of level
`warning` on the node's validation-tree path (`/node<N>` and the node's path
inside fragment N, the first fragment that holds it), its property path
`["reg"]`, its message, and its hint as the note. A node that no fragment
holds keeps its absolute path.

**VALIDATE-113** `add`, `update <path> reg` and `rename` shall report, for the
node they added, changed or renamed (at its new path), every clash between it
and a sibling, whichever side is the overlay's, from its side, and its
overflow. `update` reports them only when the property is `reg`.

**VALIDATE-114** Outside `validate`, a warning shall be the line `warning:
<message>`, followed by `  <hint>` (two spaces) when it has a hint. The
streams:

| Command | Human mode | JSON mode |
|---|---|---|
| `add` | standard output | standard error |
| `rename` | standard output | standard error; the response's `severity` is `"warn"` when there is one |
| `update … reg` | standard error | standard error |

## 8. Open issues

**V-1. JSON paths are validation-tree paths.** `path` in the JSON response
starts with `node<N>` (VALIDATE-022), which names nothing in the base or the
overlay. Human output maps it to the target (VALIDATE-025); a JSON client has
to rebuild that mapping from the fragment order.

**V-2. Unresolved references aren't reported.** A reference to a label that
is in neither the base nor the overlay passes dtc and gives misleading
dt-validate errors (`interrupts: [[5], [1]] is too long`) instead of a message
naming the reference (VALIDATE-030).

**V-3. The stand-in interrupt controller has one cell.** VALIDATE-005 gives a
fragment without an `interrupt-parent` label a controller with
`#interrupt-cells = <1>`, so a correct two-cell `interrupts` (inherited from
`gpio`) is reported as `too long`.

**V-4. The response isn't a CommonResponse.** It has no `ok`, `message` or
`severity` (COM-050). A tool failure (VALIDATE-013) is an error with `path:
[]`, the same as a dt-validate diagnostic without a node.

**V-5. Exit status 0 with errors.** `validate` can't fail a script or a CI
step (VALIDATE-027).

**V-6. Tool paths aren't quoted.** The dtc and dt-validate commands
(VALIDATE-010, VALIDATE-011) put their paths in the shell command unquoted,
unlike `build`. A workspace or installation path with a space breaks them.

**V-7. `update`'s address warnings go to standard error in human mode**
(VALIDATE-114), while `add` and `rename` write them to standard output
(COM-022).

**V-8. No summary line when there are errors** (VALIDATE-026).

**V-9. Properties set on a fragment's target aren't validated.**
VALIDATE-003 copies only the nodes of a body, not its own properties. With
`&spi0 { cs-gpios = "foo"; status = "okay"; };` as the whole overlay,
`validate` says `No errors!`: `cs-gpios` isn't in `temp.dts`, and dt-validate
never sees it. A wrong `status`, `pinctrl-0` or `cs-gpios` on a base node
passes. A fix would be to put the target in the validation tree as the
merged node (the base node's properties with the overlay's applied), so its
binding checks them.

**V-10. A `cs-gpios` provider the overlay adds turns the check off.**
VALIDATE-103 looks the provider up in the base only. With `&{/} { exp: exp {
gpio-controller; #gpio-cells = <2>; }; };` and `&spi0 { cs-gpios = <&exp 1
0>; a@3 { reg = <3>; }; };`, `validate` gives no warning, while `<&gpio 1 0>`
gives `chip select 3 has no cs-gpios entry: spi@7e204000 has chip select 0`.
A fix would be to look the provider up in the merged tree.

**V-11. Only the first fragment for a node counts.** VALIDATE-110 reads
`reg` and `status` from the first overlay node for the path, and
VALIDATE-100 takes the parent's `#address-cells` and `#size-cells` from it
too. With `&gpio { pins { brcm,pins = <4>; }; };` followed by `&gpio { reg =
<0x7e200000 0xb4>; };`, `validate` gives no warning. With only the second
fragment it gives `reg overlaps gpiomem at 0x7e200000; If gpio@7e200000
replaces it: disable /soc/gpiomem`. Imported overlays often have several
fragments for one node. A fix would be to read the node as all its overlay
fragments together (`merged_overlay_node`), as `read` and `update` do.

## 9. Examples

Abridged (the group of `foo@7e200000` has three errors before its warnings):

```
$ attach-linux validate
spi0/adc@5:
  error: (node): {'compatible': ['adi,ad7124-8'], 'reg': [[5]], '$nodename': ['adc@5']} is not valid under any of the given schemas
    context: {"message":"'interrupts' is a required property","property_path":[],"schema_path":["anyOf",0,"required"],"schema":null}
    context: {"message":"'interrupts-extended' is a required property","property_path":[],"schema_path":["anyOf",1,"required"],"schema":null}
  warning: reg: chip select 5 has no cs-gpios entry: spi@7e204000 has chip selects 0-1
    note: Use one of those, or add a GPIO for it to cs-gpios of /soc/spi@7e204000
/soc/foo@7e200000:
  warning: reg: reg overlaps gpio@7e200000 at 0x7e200000
    note: If foo@7e200000 replaces it: disable /soc/gpio@7e200000
i2c_arm/temp@53:
  warning: reg: address 0x53 is already used by accel@53
```

```
$ attach-linux --json validate
{"errors":[],"warnings":[{"kind":"generic","path":["node0","u@48","reg"],"message":"address 0x48 is already used by t@48"}]}
```

```
$ attach-linux validate
i2c_arm/u@48:
  warning: reg: address 0x48 is already used by t@48
No errors! (1 warning(s))
```
