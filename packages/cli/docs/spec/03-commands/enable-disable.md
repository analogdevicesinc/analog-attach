# enable, disable

Set a node's `status` to `"okay"` (`enable`) or `"disabled"` (`disable`) in the
overlay. The linux backend's own commands: they exist where the backend is
linux (COM-013).

## 1. Synopsis

```
analog-attach [--json] enable <path>
analog-attach [--json] disable <path>
```

Grammar: rules `enable` and `disable` in `01-grammar.abnf`. The positional is
optional for the grammar and required by the command (ENABLE-001).

In this chapter, `<status>` is `okay` for `enable` and `disabled` for
`disable`, and `<Verb>d` is `Enabled` or `Disabled`.

## 2. Resources

The command needs the base and the overlay (COM-070, 02-common §8.2, §8.3).

## 3. Input

**ENABLE-001** If `<path>` isn't given, then the CLI shall report the input
error `Missing: path` (COM-031: standard error, status 2, in both modes)
before loading the workspace.

**ENABLE-002** The CLI shall not check `<path>` per GRM-020 to GRM-023 (open
issue D-3 of `delete.md`). An empty path, or one with `&` or whitespace,
names no node (ENABLE-010). A path with an empty segment names the node
without it: `enable spi0//spidev@0` and `enable /soc//spi@7e204000` succeed.

## 4. Requirements

**ENABLE-010** The CLI shall resolve `<path>` per GRM-025 to GRM-027: to the
overlay's node when there is one, else to the base's. If neither has it, then
the CLI shall refuse with `Couldn't find node <path> in <base file> or
<overlay file>` in human mode, and `Not found: <path>` in JSON mode. A
fragment whose `target` is an unresolved label, and the nodes in it, aren't
found (`delete.md` D-6).

**ENABLE-011** The CLI shall set `status = "<status>"` on the first overlay
node at the node's path, in file order, replacing a `status` that node already
has. When the overlay has no node there (a base node it doesn't target), the
CLI shall add a fragment for it first: targeting the node's first label, or
its path (`target-path`) when it has none, in the configured overlay syntax
(02-common §8.3). (Open issue E-1.)

**ENABLE-012** The CLI shall write the status whatever the node's current
status, in the base or the overlay: `enable` on a node that is already
enabled still writes `status = "okay"`.

**ENABLE-013** On success, the CLI shall save the overlay, write `<Verb>d
<path> in <overlay file>` in human mode, and respond `{"ok": true, "message":
"<Verb>d <path>", "severity": "info"}` in JSON mode.

## 5. JSON responses

`04-protocol/enable-disable.schema.json`: a success (`ok` `true`, `severity`
`"info"`) or a refusal (`common.schema.json#/$defs/refusal`). There is no
command-specific field.

## 6. Open issues

**E-1. In an overlay with several fragments for a node, `enable` can have no
effect.** The status goes into the first fragment for the node, but a later
fragment's `status` wins, as in dtc. With `fragment@0` and `fragment@1` both
for `&spi0`, the second setting `status = "disabled"`, `enable spi0` writes
`"okay"` into `fragment@0`, reports `Enabled spi0`, and `read spi0 status`
still shows `"disabled"`. `update` writes to the fragment whose value
applies (`update.md`). `enable` and `disable` should do the same.

**E-2. The not-found message differs between modes, and from `read`'s.**

## 7. Examples

```
$ analog-attach disable spi0/spidev@0
Disabled spi0/spidev@0 in /work/ad7124-8.dtso
$ analog-attach read spi0/spidev@0 status
status = "disabled";
```

The overlay gets, when it had no fragment for the node:

```
	fragment@1 {
		target = <&spidev0>;
		__overlay__ {
			status = "disabled";
		};
	};
```

and for a node without a label (`disable /memory@0`), `target-path =
"/memory@0";`.

```
$ analog-attach --json enable nope
{"ok":false,"message":"Not found: nope","severity":"error"}
```
