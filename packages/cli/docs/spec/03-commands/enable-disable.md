# enable, disable

Set a node's `status` to `"okay"` (`enable`) or `"disabled"` (`disable`) in the
overlay, or remove the overlay's `status` when the node has that status
without it (ENABLE-012), so the overlay holds only what it changes. The linux
backend's own commands: they exist where the backend is linux (COM-013).

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

**ENABLE-011** When `<status>` isn't the node's status without the overlay
(ENABLE-012), the CLI shall set `status = "<status>"` on the overlay node
whose `status` applies (of the overlay nodes at the node's path that set one,
the last in file order, as a later fragment's value wins in dtc), replacing
it, else on the first overlay node at the node's path. When the overlay has
no node there (a base node it doesn't target), the CLI shall add a fragment
for it first: targeting the node's first label, or its path (`target-path`)
when it has none, in the configured overlay syntax (02-common §8.3).

**ENABLE-012** If `<status>` is the node's status without the overlay, then
the CLI shall not write it, and shall remove `status` from every overlay node
at the node's path that sets one, keeping their other properties and nodes; a
fragment whose `__overlay__` body is then left empty is removed, as DELETE-026
says. The node's status without the overlay is the base's for a node of the
base: enabled with no `status`, or with `"okay"` or `"ok"` (as VALIDATE-100
counts a node enabled), disabled with `"disabled"`, and neither with another
value (`"fail"`, `"reserved"`), which both commands write. A node the overlay
adds is enabled. The overlay's own status doesn't count: on a base node the
base disables, `enable` writes `status = "okay"` even when the overlay already
has it, and `disable` removes the overlay's `status = "okay"`.

**ENABLE-013** On success, when the overlay changed, the CLI shall save it. It
shall write, in human mode, `<Verb>d <path> in <overlay file>` when it wrote
the status, else `<Verb>d <path> (<why>: status removed from <overlay file>)`
when it removed one, or `<Verb>d <path> (<why>: nothing to change in <overlay
file>)` when the overlay had none, `<why>` being `as in the base` for a node
of the base and `as the overlay adds it` for a node the overlay adds. In JSON
mode it shall respond `{"ok": true, "message": "<message>", "severity":
"info"}`, `<message>` being the human line without the overlay file and the
word before it: `Disabled spi0/spidev@0`, `Disabled spi0 (as in the base:
status removed)`, `Enabled /memory@0 (as in the base: nothing to change)`.

## 5. JSON responses

`04-protocol/enable-disable.schema.json`: a success (`ok` `true`, `severity`
`"info"`) or a refusal (`common.schema.json#/$defs/refusal`). There is no
command-specific field.

## 6. Open issues

**E-2. The not-found message differs between modes, and from `read`'s.** In
human mode it is `Couldn't find node <path> in <base file> or <overlay file>`,
in JSON mode `Not found: <path>`. Neither names the closest labels or the
parent's children, as `read`, `update`, `delete`, `move` and `rename` do (`Not
found: spi0/nope. spi0 has: …`).

**E-3. Removing a status prunes every empty fragment, not only its own.**
ENABLE-012 removes the status through the same removal as `delete <path>
<property>` (DELETE-030), which drops each fragment whose `__overlay__` body is
empty after it, so an empty block elsewhere in the overlay (`&spi1 { };`,
written by hand) goes too, and the fragments are renumbered. Nothing that
applies changes.

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

On the Raspberry Pi 4 base, which disables `spi0`:

```
$ analog-attach enable spi0
Enabled spi0 in /work/ad7124-8.dtso
$ analog-attach disable spi0
Disabled spi0 (as in the base: status removed from /work/ad7124-8.dtso)
$ analog-attach --json disable spi0
{"ok":true,"message":"Disabled spi0 (as in the base: nothing to change)","severity":"info"}
```

The first writes `&spi0 { status = "okay"; };`; the second removes that
`status` and, as the block holds nothing else, the block.

```
$ analog-attach --json enable nope
{"ok":false,"message":"Not found: nope","severity":"error","error_type":"not-found"}
```
