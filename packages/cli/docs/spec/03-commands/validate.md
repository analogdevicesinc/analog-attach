# validate

Checks the overlay against its bindings with dt-validate. Also checks the
addresses and chip selects of the overlay's nodes. With `--full`, it also
checks the base devicetree with the overlay applied, and reports what the
overlay adds or sets there. A shared command: §2 to
§7 as the linux backend does it, §8 as the noos backend does it (the
workfile against its schemas, without a tool).

## 1. Synopsis

```
analog-attach [--json] validate
analog-attach [--json] validate [--full]     # where the backend is linux
```

Grammar: rule `validate` in `01-grammar.abnf`. The command takes no
arguments.

| Option (linux) | Meaning | Default |
|---|---|---|
| `--full` | Also check the base devicetree with the overlay applied (§5.1), whatever the `output` setting is. | off |

## 2. Terms

| Term | Meaning |
|---|---|
| Fragment | One target of the overlay (`fragment@N { target = …; __overlay__ { … } }`, or `&label { … }` in label syntax), counted from 0 in file order. |
| Validation tree | The devicetree source the CLI builds for dt-validate (§4). It has one node `node<N>` per fragment, so its paths are `/node<N>/…`. |
| Diagnostic | One entry of dt-validate's JSON output, or one address warning (§7). It has a level (`warning`, or anything else for an error), an optional node path, an optional property path, a message, and optionally a note and context lines. |
| Display path | A validation-tree path as human output shows it: `/node<N>` replaced by the fragment's target (§6.2). |
| Full tree | With `--full`: the base devicetree with the overlay applied, as `build` writes it where `output` is `full` (build.md §4.1). |
| Touched node | A node of the full tree that the overlay adds, or that is below one it adds, or a base node on which a fragment's body sets a property (any fragment for it). A base node the overlay only adds children to isn't touched. |

## 3. Resources

The command needs the bindings (with `validation.json`, 02-common.md §8.4),
the tools (dtc, dt-schema and its dt-validate, 02-common.md COM-118 and
COM-119), the base and the overlay (COM-070; §8.2, §8.3). With
`--full` it runs `preprocess-command` on the full tree too.

## 4. The validation tree

**VALIDATE-001** The CLI shall write the validation tree to
`.analog-attach/linux/temp.dts`. It is a `/plugin/` source whose root has
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
validated. (Open issue V-9; `--full` checks them, §5.1.)

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

**VALIDATE-010** The CLI shall compile the validation tree with the dtc
on PATH into `.analog-attach/linux/temp.dtb` (`<dtc> -I dts -O dtb -o <temp.dtb>
<temp.dts>`). If dtc fails, then the CLI shall report its standard error
(VALIDATE-013) and not run dt-validate.

**VALIDATE-011** The CLI shall delete `.analog-attach/linux/error.json` when it
exists, then run the dt-validate on PATH as `<dt-validate> -s
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

**VALIDATE-013** A tool failure (VALIDATE-010, VALIDATE-012) shall be a
refusal (`02-common.md` COM-040). Human mode writes `dtc error:` or
`dt-validate error:` on a line, then the tool's standard error as it is, then
a newline: the tool's own final newline leaves an empty line at the end. The
unreadable-output message is written alone, as one line. JSON mode gives the
standard error unchanged, final newline included, as the message: `{ "ok":
false, "message": <text>, "severity": "error", "error_type": "tool-failed"
}`.

### 5.1 With `--full`

**VALIDATE-040** Where `--full` is given, after VALIDATE-010 to VALIDATE-012
have run on the validation tree without a tool failure, the CLI shall write
the full tree to `.analog-attach/linux/full.dts` as build.md BUILD-010 to
BUILD-012 write the full devicetree file, followed by an empty line and
`/ {`, `/delete-node/ aliases;`, `/delete-node/ __overrides__;` (one tab in)
and `};`, and preprocess it as BUILD-014 does, into
`.analog-attach/linux/full.preprocessed.dts`. It does so whatever `output`
is, and writes nothing in the build folder. (Open issue V-14.)

**VALIDATE-041** If a fragment's target resolves to no node, or preprocessing
fails, then the CLI shall report one tool failure (VALIDATE-013) with the
message `full devicetree not written: <reason>`, `<reason>` being
BUILD-013's or BUILD-014's text after `Build failed: `, written alone in
human mode.

**VALIDATE-042** The CLI shall then compile the preprocessed full tree with
dtc into `.analog-attach/linux/full.dtb` and run dt-validate on it
into `.analog-attach/linux/full-error.json`, as VALIDATE-010 to VALIDATE-013
do for the validation tree; a tool failure there is reported the same way.

**VALIDATE-043** Of the full run's diagnostics, the CLI shall report those
whose node is a touched node, but not one that the validation tree's run
already has: a diagnostic of the same node (its validation-tree path read as
the absolute path it stands for, `/node<N>` being fragment N's target), the
same property path and the same `message`. (Open issue V-13.)

**VALIDATE-044** A reported full-run diagnostic's JSON `path` shall be its
node's absolute path split at `/`, followed by its property path
(`["soc", "spi@7e204000", "status"]`), and its `message` as VALIDATE-022.
Its display path shall be label-first: the absolute path with its longest
leading part that has a label in the base or the overlay replaced by that
label (`spi0`, `spi0/adc@0`), or the absolute path when none has.

**VALIDATE-045** The full run's other diagnostics (without a node, or on a
node that isn't touched) shall be counted and not reported. In JSON mode the
response has `base_findings`, that count, 0 included; without `--full` it has
none. In human mode, when the count isn't 0, the CLI shall write `<n> more
finding(s) in the base devicetree` after VALIDATE-026's line.

**VALIDATE-046** With `--full`, the diagnostics are the validation tree's,
then the reported full-run ones, then the address warnings of §7.4, and
VALIDATE-021 to VALIDATE-026 apply to them all; VALIDATE-026's counts are of
the reported ones.

## 6. Results

**VALIDATE-020** The CLI shall report dt-validate's diagnostics followed by
the address warnings of §7.4, all as diagnostics (with `--full`,
VALIDATE-046).

### 6.1 JSON output

**VALIDATE-021** While in JSON mode, the CLI shall respond per
`04-protocol/validate.schema.json`: `{ "ok": true, "message": "<n> error(s),
<m> warning(s)", "severity": <severity>, "errors": [...], "warnings": [...]
}`, `<severity>` being `"error"` when there are errors, else `"warn"` when
there are warnings, else `"info"` (`02-common.md` COM-050), and each entry `{
"kind": "generic", "path": <segments>, "message": <text>, "error_type":
<type> }` (VALIDATE-029).
A diagnostic of level `warning` goes to `warnings`, any other to `errors`, both
in the order of VALIDATE-020.

**VALIDATE-022** An entry's `path` shall be the diagnostic's validation-tree
node path split at `/` without empty segments, followed by its property path
(`["node0", "adc@5", "reg"]`). An entry's `message` shall be dt-validate's
`formatted` text when there is one (for an address warning with a hint,
`<message>; <hint>`), and its `message` otherwise. (Open issue V-16.)

**VALIDATE-029** An entry's `error_type` (`02-common.md` COM-051) shall be
`resource-conflict` for an address warning (§7); `missing-required` for a
dt-validate diagnostic whose message ends `is a required property` or has `is
a dependency of`; and `out-of-range` for every other diagnostic (a type, a
range, a count, a property the binding doesn't define).

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
are errors, it shall end with `<n> error(s), <m> warning(s)`.

**VALIDATE-027** The exit status shall be 0 whatever the diagnostics.

### 6.3 Files

**VALIDATE-028** The CLI shall change no file other than `temp.dts`,
`temp.dtb` and `error.json` in `.analog-attach/linux/` (with `--full`, also
`full.dts`, `full.preprocessed.dts`, `full.dtb` and `full-error.json`), and
the scratch files of 02-common.md §8.2. It never changes the overlay.

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
the parent's `#address-cells` and `#size-cells` (a cell written as an
expression counting as its value, as in ADD-047; from the overlay's
fragments for the parent, a later one's value winning as in dtc, else the
base's, else 1 and 0, as in ADD-048), and:
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

### 7.2 Chip selects past the controller's

**VALIDATE-103** A child of a controller with `num-cs` or `cs-gpios`
*overflows* when it is enabled and an address of its `reg` is at least the
controller's chip-select count: the larger of `num-cs` and the number of
`cs-gpios` entries, as Linux's SPI core counts them (with `num-cs = <4>` and
one entry, chip selects 1 to 3 are the controller's own). An entry is a
phandle followed by its provider's `#gpio-cells` cells, or a lone 0 (the
controller's own chip select). The provider is the node the phandle names in
the base, and its `#gpio-cells` is read from the merged tree. A controller
with neither, or whose `cs-gpios` entries can't be counted, isn't checked: a
phandle to a node the base doesn't have (a GPIO expander the overlay adds), a
provider without `#gpio-cells`, or a number other than 0 where an entry
starts. (Open issue V-10.)

**VALIDATE-104** An overflow shall have the message `chip select <n> has no
cs-gpios entry: <controller> has <range>` and the hint `Use one of those, or
add a GPIO for it to cs-gpios of <controller path>` when the controller has
no `num-cs` (the driver may have more chip selects, but the tree names no
line for it), and otherwise the message `chip select <n> is past the
controller's chip selects: <controller> has <range>` and the hint `Use one of
those`. `<n>` is the first such address, `<controller>` the controller's name
with unit address, and `<range>` `chip select 0` for a count of one or `chip
selects 0-<k-1>` for `<k>`. `list value` and `read` note the same chip
selects (`list.md` LIST-081).

### 7.3 The overlay's nodes

**VALIDATE-110** A node is *the overlay's* when the overlay adds it, or when
any of the overlay's fragments for its path sets its `reg` or `status`: with
`&gpio { pins { brcm,pins = <4>; }; };` followed by `&gpio { reg =
<0x7e200000 0xb4>; };`, `gpio` is the overlay's. A base node the overlay only
adds children to (pin groups under `gpio`) isn't.

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
| `add` | standard error | standard error |
| `rename` | standard error | standard error; the response's `severity` is `"warn"` when there is one |
| `update … reg` | standard error | standard error |

## 8. Where the backend is noos

**VALIDATE-500** The CLI shall load the workfile (`02-common.md` COM-512) and
check each stored node against its schema: a value reference loop (one
error per node of the loop), a node that references itself, each property
(a required value left empty, a value the schema doesn't allow, a reference
to a node the workfile doesn't have or of the wrong schema or capability, a
union member), and the chip selects of the SPI devices. It shall respond
`{ "ok": true, "message": …, "severity": …, "errors": [...], "warnings": [...]
}` as VALIDATE-021 has it (`04-protocol/validate.schema.json#/$defs/noos`),
each entry `{ "kind": "generic", "path": <segments>, "message": <text>,
"error_type": <type> }`, `<type>` the one attach-no-os-lib gives the
finding, `path` the node, the
property and, in a union, the member (`["tp3_ip", "comm_init", "spi_dev"]`),
in that order. Nothing is run and nothing is written.

**VALIDATE-501** A finding shall be a warning when it is a required raw
value left empty that has no default (`Required property has no value; the
driver may need it`), or a capability mismatch that an override allows
(`Capability mismatch: ops is '<capability>', expected '<capabilities>'
(allowed by override)`); every other finding is an error.

**VALIDATE-502** In human mode, with no finding, the CLI shall write:

```
✓ Workfile is valid

  <n> node[s] checked
  0 errors, 0 warnings
```

`<n>` being the number of nodes of the workfile (open issue V-12). Otherwise
it shall write `✗ Workfile has errors` (or `⚠ Workfile has warnings` when
there is no error) and an empty line, then per node, in the order of the
findings, `  <node>`, one line `    ✗ <property>: <message>` (`⚠` for a
warning) per finding, `<property>` being the rest of the path joined with
`.`, and an empty line; then `  <e> error[s], <w> warning[s]`. A finding with
no node is listed under `(workfile)`.

## 9. Open issues

**V-1. JSON paths are validation-tree paths.** `path` in the JSON response
starts with `node<N>` (VALIDATE-022), which names nothing in the base or the
overlay. Human output maps it to the target (VALIDATE-025); a JSON client has
to rebuild that mapping from the fragment order.

**V-2. Unresolved references aren't reported.** A reference to a label that
is in neither the base nor the overlay passes dtc and gives misleading
dt-validate errors (`interrupts: [[5], [1]] is too long`) instead of a message
naming the reference (VALIDATE-030). The first example of `adi,adxl345.yaml`
hits it: after `add adi,adxl345 --template example:1 --parent i2c1`, which
lists `interrupt-parent → &gpio0` as unresolved, `validate` reports only
`interrupts: [[0], [4]] is too long`.

**V-3. The stand-in interrupt controller has one cell.** VALIDATE-005 gives a
fragment without an `interrupt-parent` label a controller with
`#interrupt-cells = <1>`, so a correct two-cell `interrupts` (inherited from
`gpio`) is reported as `too long`.

**V-5. Exit status 0 with errors.** `validate` can't fail a script or a CI
step (VALIDATE-027).

**V-9. Without `--full`, properties set on a fragment's target aren't
validated.** VALIDATE-003 copies only the nodes of a body, not its own
properties. With `&spi0 { status = "bogus"; };` as the whole overlay,
`validate` says `No errors!`: `status` isn't in `temp.dts`, and dt-validate
never sees it. A wrong `status`, `pinctrl-0` or `cs-gpios` on
a base node passes. `validate --full` checks them (§5.1), at the cost of a
second dt-validate run on the whole tree.

**V-10. A `cs-gpios` provider the overlay adds turns the check off.**
VALIDATE-103 looks the provider up in the base only. With `&{/} { exp: exp {
gpio-controller; #gpio-cells = <2>; }; };` and `&spi0 { cs-gpios = <&exp 1
0>; a@3 { reg = <3>; }; };`, `validate` gives no warning, while `<&gpio 1 0>`
gives `chip select 3 has no cs-gpios entry: spi@7e204000 has chip select 0`.
A fix would be to look the provider up in the merged tree.

**V-12. The node count includes the external nodes.** `<n> nodes checked`
(VALIDATE-502) counts every node the workfile has, external ones too, which
`validate` doesn't check.

**V-13. A touched base node brings its own findings.** VALIDATE-043 reports
every finding of a base node the overlay sets a property on, also those
about properties only the base has: with `status = "okay"` on spi0, the RPi
4's `Unevaluated properties are not allowed ('dma-names', 'dmas' were
unexpected)` on spi0 is reported, though the overlay didn't write it.

**V-14. `/aliases` and `/__overrides__` aren't checked.** VALIDATE-040
deletes both from the full tree: dt-schema's gpio fixup crashes on the RPi
4's `/aliases` (`KeyError: '/'`), and its `/__overrides__` refers to
`/aliases`. A node the overlay adds under either isn't checked.

**V-15. Two path forms in one response.** With `--full`, JSON `path`s of the
validation tree's diagnostics start with `node<N>` (V-1), and those of the
full run with the absolute path (VALIDATE-044).

**V-16. JSON messages name the scratch file.** dt-validate's `formatted` text
(VALIDATE-022) starts with the file it checked and ends with the schema's
`$id`: `.analog-attach/linux/temp.dtb: accelerometer@2a (adi,adxl345):
interrupts: [[0], [4]] is too long\n\tfrom schema $id:
http://devicetree.org/schemas/iio/accel/adi,adxl345.yaml`. The file is a
scratch file of the CLI's (VALIDATE-028), not one the user wrote. Human mode
(VALIDATE-024) shows dt-validate's `message`, without either.

**V-17. A malformed `*-gpios` stops `--full`.** With `&spi0 { cs-gpios =
"foo"; };`, dt-validate's GPIO fixup reads the string as a phandle and fails
(`KeyError: 1718578944`, the bytes of `foo`), so `validate --full` refuses
with `tool-failed` and dt-validate's traceback (VALIDATE-013) instead of a
finding. Plain `validate` says `No errors!` (V-9).

## 10. Examples

Abridged (the group of `foo@7e200000` has three errors before its warnings):

```
$ analog-attach validate
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
4 error(s), 3 warning(s)
```

```
$ analog-attach --json validate
{"ok":true,"message":"0 error(s), 1 warning(s)","severity":"warn","errors":[],
 "warnings":[{"kind":"generic","path":["node0","u@48","reg"],"message":"address 0x48 is already used by t@48",
 "error_type":"resource-conflict"}]}
```

(Wrapped here; the CLI writes one line.)

```
$ analog-attach validate
i2c_arm/u@48:
  warning: reg: address 0x48 is already used by t@48
No errors! (1 warning(s))
```

With `--full`, after `update spi0 status bogus` (abridged; the RPi 4 base):

```
$ analog-attach validate --full
spi0:
  error: (node): Unevaluated properties are not allowed ('dma-names', 'dmas' were unexpected)
  error: status: ['bogus'] is not valid under any of the given schemas
    context: {"message":"['bogus'] is not of type 'object'",…}
    context: {"message":"'bogus' is not one of ['okay', 'disabled', 'reserved', 'fail', 'fail-needs-probe']",…}
2 error(s), 0 warning(s)
220 more finding(s) in the base devicetree
```

Where the backend is noos (`mydev` a `test_spi_device` with no chip select,
`test_gpio0` a `test_gpio_pin` left empty):

```
$ analog-attach validate
✗ Workfile has errors

  mydev
    ✗ native_cs: needs one of: cs_gpio, native_cs other than 0
    ✗ cs_gpio: needs one of: cs_gpio, native_cs other than 0

  test_gpio0
    ✗ port_handle: Required property has no value
    ✗ number: Required property has no value

  4 errors, 0 warnings
```

```
$ analog-attach --json validate
{"ok":true,"message":"0 error(s), 1 warning(s)","severity":"warn","errors":[],
 "warnings":[{"kind":"generic","path":["testpart_cfg","calib"],"message":"Required property has no value; the driver may need it",
 "error_type":"missing-required"}]}
```

(Wrapped here; the CLI writes one line.)

(`calib` a required raw value of the schema.)
