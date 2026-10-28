# build

Compiles the overlay into a binary `.dtbo`.

## 1. Synopsis

```
attach-linux [--json] build
```

Grammar: rule `build` in `01-grammar.abnf`. The command takes no arguments or
options.

## 2. Terms

| Term | Meaning |
|---|---|
| Overlay file | The file the `overlay` setting names, as it is on disk. |
| Output file | The overlay file's path with `.dtso` replaced by `.dtbo`, or with `.dtbo` appended when it doesn't end in `.dtso` (`overlay.dtso` → `overlay.dtbo`, `my.dts` → `my.dts.dtbo`). |
| Bundled dtc | The `dtc` binary in the installation's `bundled/tools/` (v1.8.1). |

## 3. Resources

The command needs the bundled tools, the base and the overlay (COM-070;
02-common.md §8.2 for the base, §8.3 for the overlay). The overlay has to
parse against the base even though dtc compiles the file on its own.

## 4. Requirements

**BUILD-001** When the workspace can't be loaded, the CLI shall report it per
COM-071 or COM-072 and compile nothing. A missing bundled tool is the problem
`{ "field": "tools", "kind": "missing", "message": "Bundled tools not found:
<paths>" }`, with the hint `The attach-linux installation is incomplete;
rebuild it (scripts/bundle-dt-schema.sh).`.

**BUILD-002** The CLI shall run the shell command `"<dtc>" -@ -I dts -O dtb
-o "<output file>" "<overlay file>"`, `<dtc>` being the bundled dtc's
absolute path. Each value is put in double quotes, so paths may contain
spaces.

**BUILD-003** The CLI shall compile the overlay file as it is on disk: it
doesn't run `preprocess-command`, merge in the base, or validate against the
bindings. `-@` makes dtc emit `__symbols__` and `__fixups__`, so references to
base labels are resolved when the overlay is applied.

**BUILD-004** If dtc exits with a non-zero status, then the CLI shall refuse
(COM-040, COM-041) with dtc's standard error as the reason. Human mode writes
the line `Build failed:`, then that text as it is, then a newline: dtc's own
final newline leaves an empty line at the end. JSON mode gives it unchanged
as `message`, including its final newline.

**BUILD-005** When dtc succeeds, the CLI shall leave the output file as dtc
wrote it, replacing any earlier one. It writes `Wrote <output file>` in human
mode. In JSON mode it responds per `04-protocol/build.schema.json`: `{ "ok":
true, "message": "Compiled overlay", "severity": "info", "path": <output
file> }`, `path` being absolute.

**BUILD-006** The CLI shall change no file other than the output file and the
scratch files of 02-common.md §8.2.

## 5. Open issues

**B-1. dtc's warnings are dropped.** On success, dtc's standard error
(warnings such as `unit_address_vs_reg`) is discarded and not shown.

**B-2. `build` doesn't validate.** An overlay that `validate` reports errors
for still compiles. It is up to the user to run `validate` first.

## 6. Examples

```
$ attach-linux build
Wrote /work/ad7124-8.dtbo
```

```
$ attach-linux --json build
{"ok":false,"message":"/work/ad7124-8.dtso:20.21-23.6: ERROR (duplicate_label): /fragment@1/__overlay__/temp@53: Duplicate label 'adxl345' on /fragment@1/__overlay__/temp@53 and /fragment@1/__overlay__/accel@53\nERROR: Input tree has errors, aborting (use -f to force output)\n","severity":"error"}
```
