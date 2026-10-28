# import

Creates a workfile from an overlay of the Linux tree, or from any overlay
file, and makes it the configured overlay.

## 1. Synopsis

```
attach-linux [--json] import <overlay>
```

Grammar: rule `import` in `01-grammar.abnf`. `<overlay>` is a path, or the
path in the Linux tree, the file name or the stem of an indexed overlay.

## 2. Terms

| Term | Meaning |
|---|---|
| Overlay index | The overlay files of the Linux tree: `arch/arm/boot/dts/overlays/*-overlay.dts` and every `arch/*/boot/dts/**/*.dtso`, by their path relative to the tree. Built on every run. |
| Stem | A file name without `-overlay.dts`, `.dtso` or `.dts` at its end, in that order of preference: `rpi-ad7124-8-all-diff-overlay.dts` → `rpi-ad7124-8-all-diff`. |
| Board compatible | The `compatible` of the overlay's root node, found by a text scan of the preprocessed overlay. |

## 3. Resources

**IMPORT-001** The CLI shall load the settings first, and report their
problems per COM-071 or COM-072 without importing.

**IMPORT-002** The command needs the bindings and the base (COM-070). It
doesn't load the configured overlay: one that doesn't parse doesn't stop it.

## 4. Finding the overlay

**IMPORT-010** When `<overlay>`, resolved against the CWD, names a file, the
CLI shall import that file.

**IMPORT-011** Otherwise, the CLI shall look `<overlay>` up in the overlay
index: an entry matches when its path, its file name or its stem equals
`<overlay>`.

**IMPORT-012** If no entry matches, then the CLI shall refuse with `No overlay
named <overlay> in <linux> (list overlay <compatible> finds them), and no such
file`, in which `<compatible>` is literal.

**IMPORT-013** If several entries match, then the CLI shall refuse with
`Several overlays are named <overlay>; pass one of: <paths>`, `<paths>` being
their paths in the tree, sorted and separated by `, `.

## 5. Reading the overlay

**IMPORT-020** The CLI shall preprocess the overlay with `preprocess-command`
(COM-091), the output going to `.attach-linux/import.preprocessed.dts`.

**IMPORT-021** If preprocessing fails, then the CLI shall refuse with
`preprocessing <source> failed:`, a newline and the error (COM-094's
message).

**IMPORT-022** If the preprocessed overlay doesn't parse against the base,
then the CLI shall refuse with `<source> does not parse after preprocessing:
<parser message>`.

**IMPORT-023** The CLI shall remove a node `__overrides__` directly under the
overlay's root (the Raspberry Pi overlay parameters), and keep everything
else as written: every fragment, `__dormant__` bodies, the root `compatible`,
targets and references, none remapped.

`<source>` is the absolute path of the overlay file.

## 6. Writing

**IMPORT-030** The CLI shall write the overlay (COM-103) to a new file in the
CWD named `<stem>.dtso`, or `<stem>-<n>.dtso` with the smallest `<n>` from 1
that names no existing file, `<stem>` being the overlay file's stem. It never
overwrites a file.

**IMPORT-031** The CLI shall then set `overlay` to the new file's absolute
path (COM-129). A previously configured overlay file is left as it is.

## 7. Warnings

**IMPORT-040** The CLI shall grade the board compatible against the base's
root `compatible`, as `list overlay` does:

| `fit` | When | `reason` |
|---|---|---|
| `unknown` | The overlay has no root `compatible` | `no root compatible` |
| `compatible` | One of its compatibles is the base's | that compatible |
| `compatible` | One is a generic compatible of a family the base belongs to | `family: <compatible> → <family>` |
| `unknown` | One isn't `vendor,name` | `root compatible "<compatible>" isn't vendor,name` |
| `incompatible` | Otherwise | `overlay: <compatibles>; base: <compatibles>` |

The rows apply in order. The one family is `raspberrypi`: the generic
compatibles `brcm,bcm2835`, `brcm,bcm2708`, `brcm,bcm2709`, `brcm,bcm2836`
fit a base with any of `brcm,bcm2835`, `bcm2836`, `bcm2837`, `bcm2708`,
`bcm2709`, `bcm2710`, `bcm2711`, `bcm2712` (all `brcm,`).

**IMPORT-041** The CLI shall list each fragment whose `target` or
`target-path` names no node of the base or the overlay, as the fragment's
node name, the property, and the target (a label without `&`, or a path).

**IMPORT-042** The CLI shall list each reference in the imported overlay that
names no node of the base or the overlay, once per node, property and
reference.

**IMPORT-043** The warnings shall not stop the import.

## 8. Result

### 8.1 Human output

**IMPORT-050** While in human mode, the CLI shall write, in this order:

1. `Imported <shown> into <workfile>`, `<shown>` being the source relative to
   the Linux tree when it is inside it, and absolute otherwise.
2. When an overlay was configured before: `The configured overlay is now
   <workfile> (was <previous>, kept; switch back with: config overlay
   <previous>)`.
3. When IMPORT-023 removed `__overrides__`: `Dropped __overrides__ (the
   overlay's parameters)`.
4. When the fit is `incompatible`: `warning: this overlay is for another
   board: <overlay compatibles>` and `  (base: <base compatibles>)`, each list
   separated by `, `.
5. The targets of IMPORT-041: `warning: 1 fragment targets a node the base
   doesn't have:` or `warning: <n> fragments target nodes the base doesn't
   have:`, then one row `  <fragment>  <property> <target>` each, the fragment
   names padded to the longest.
6. The references of IMPORT-042: `warning: 1 reference points to a node
   neither the base nor the overlay has:` or `warning: <n> references point to
   nodes neither the base nor the overlay has:`, then one row per node and
   property:

   ```
     <node>  <property> → <references>
   ```

   with the references separated by `, ` and the node names padded to the
   longest, then the line
   `  fix with: update <node> <property> <value>, or delete <node> <property>`,
   in which `<node>`, `<property>` and `<value>` are literal. In the rows,
   `<node>` is the path from its deepest labelled node (`spi0/adc@0`), or the
   absolute path when no node on it has a label. Under a `target` that didn't
   resolve, it starts with that label (`nothere/x`); a `target-path` that
   didn't resolve is a path like any other (`/nope/path`).

`<workfile>` and `<previous>` are absolute paths.

### 8.2 JSON output

**IMPORT-060** While in JSON mode, the CLI shall respond with an object
conforming to `04-protocol/import.schema.json`:

| Field | Value |
|---|---|
| `message` | Line 1 of IMPORT-050 |
| `severity` | `warn` when the fit is `incompatible` or IMPORT-041 or IMPORT-042 found something, else `info` |
| `path` | The new workfile, absolute |
| `source` | The imported file, absolute |
| `replaced` | The overlay configured before, when there was one |
| `fit`, `reason` | IMPORT-040 |
| `unresolved_targets` | IMPORT-041: `{ fragment, property, target }` |
| `unresolved` | IMPORT-042: `{ path, property, reference }`, `reference` as written (`&label`, `&{/path}`) |

`unresolved[].path` is the node's absolute path as segments. Under a `target`
that didn't resolve, its first segment is the target as written (`["&nothere",
"x"]`, open issue IM-2); under a `target-path` that didn't resolve, the
segments are that path's (`["nope", "path"]`).

## 9. Open issues

**IM-1. A file in the CWD hides an indexed overlay of the same name.**
IMPORT-010 comes first, and IMPORT-030 names the workfile after the source:
after `import zynqmp-sck-kv-g-revB.dtso`, the same command again imports the
workfile `zynqmp-sck-kv-g-revB.dtso` the first run created, not the tree's
overlay.

**IM-2. `unresolved[].path` isn't always a node path.** Under a `target` that
didn't resolve it starts with `&<label>`, which no other path field does.
(Under an unresolved `target-path` it is the path's segments, a node that
doesn't exist but at least a path.) A fix would be a separate `target` field
and `path` relative to it.

**IM-3. The JSON output doesn't say `__overrides__` was dropped,** and its
message leaves out line 2 of IMPORT-050, which `replaced` gives instead.

## 10. Examples

```
$ attach-linux import rpi-ad7124-8-all-diff
Imported arch/arm/boot/dts/overlays/rpi-ad7124-8-all-diff-overlay.dts into /work/rpi-ad7124-8-all-diff.dtso
Dropped __overrides__ (the overlay's parameters)
```

```
$ attach-linux import ./mine-overlay.dts
Imported /work/mine-overlay.dts into /work/mine.dtso
The configured overlay is now /work/mine.dtso (was /work/rpi-ad7124-8-all-diff.dtso, kept; switch back with: config overlay /work/rpi-ad7124-8-all-diff.dtso)
warning: 1 fragment targets a node the base doesn't have:
  fragment@0  target nothere
warning: 1 reference points to a node neither the base nor the overlay has:
  nothere/x  p → &ghost
  fix with: update <node> <property> <value>, or delete <node> <property>
```

```
$ attach-linux --json import ./other-overlay.dts
{"ok":true,"message":"Imported /work/other-overlay.dts into /work/other.dtso","severity":"warn",
 "path":"/work/other.dtso","source":"/work/other-overlay.dts","replaced":"/work/mine.dtso",
 "fit":"incompatible","reason":"overlay: xlnx,zynqmp; base: raspberrypi,4-model-b, brcm,bcm2711",
 "unresolved_targets":[],"unresolved":[]}
```

```
$ attach-linux --json import nope
{"ok":false,"message":"No overlay named nope in /home/u/linux (list overlay <compatible> finds them), and no such file","severity":"error"}
```
