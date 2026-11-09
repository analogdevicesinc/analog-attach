# build

Compiles the overlay into a binary `.dtbo`, or, where the `output` setting
is `full`, writes the base devicetree with the overlay applied and compiles
it into a `.dtb` (for boards that boot a full devicetree only). A shared
command: §2 to §4 as the linux backend does it (with the dtc on PATH or the `build-command`
setting), §5 as the noos backend does it (the generated project, built with
CMake or the `build-command` setting).

## 1. Synopsis

```
analog-attach [--json] build
analog-attach [--json] build [--clean]     # where the backend is noos
```

Grammar: rule `build` in `01-grammar.abnf`. Where the backend is linux, the
command takes no arguments or options.

| Option (noos) | Meaning | Default |
|---|---|---|
| `--clean` | Delete the project's build directory first, so CMake configures afresh. | off |

## 2. Terms

| Term | Meaning |
|---|---|
| Overlay file | The file the `workfile` setting names, as it is on disk. |
| Build folder | The `build-dir` setting: `build` in the directory that holds `.analog-attach/` when unset, a relative value resolved the same way (02-common.md §8.1). |
| Output file | In the build folder, the overlay file's name with `.dtso` replaced by `.dtbo`, or with `.dtbo` appended when it doesn't end in `.dtso` (`overlay.dtso` → `<build folder>/overlay.dtbo`, `my.dts` → `<build folder>/my.dts.dtbo`). Where `output` is `full`, `.dtb` in place of `.dtbo` (`<build folder>/overlay.dtb`, `<build folder>/my.dts.dtb`). |
| Full devicetree file | Where `output` is `full`: in the build folder, the overlay file's name with `.dtso` replaced by `.dts`, or with `.dts` appended (`<build folder>/overlay.dts`, `<build folder>/my.dts.dts`). |
| dtc | The `dtc` on PATH, 1.6.0 or later (02-common.md COM-118). |

## 3. Resources

The command needs the tools (dtc, and dt-schema with its dt-validate,
02-common.md COM-118 and COM-119), the base and the overlay (COM-070;
02-common.md §8.2 for the base, §8.3 for the overlay). The overlay has to
parse against the base even though dtc compiles the file on its own. With
`build-command` set it needs only the `workfile` setting (BUILD-007).

## 4. Requirements

**BUILD-001** When the workspace can't be loaded, the CLI shall report it per
COM-071 or COM-072 and compile nothing. A dtc that isn't on PATH is the
problem `{ "field": "dtc", "kind": "missing", "error_type": "tool-missing",
"message": "dtc not found on PATH" }`, with the hint that says how to install
it (COM-118).

**BUILD-002** Where `output` is `overlay`, the CLI shall run the shell command `"<dtc>" -@ -I dts -O dtb
-o "<output file>" "<overlay file>"`, `<dtc>` being the absolute path of the
dtc found on PATH. Each value is put in double quotes, so paths may contain
spaces.

**BUILD-003** Where `output` is `overlay`, the CLI shall compile the overlay file as it is on disk: it
doesn't run `preprocess-command`, merge in the base, or validate against the
bindings. `-@` makes dtc emit `__symbols__` and `__fixups__`, so references to
base labels are resolved when the overlay is applied.

**BUILD-004** If dtc exits with a non-zero status, then the CLI shall refuse
(COM-040, COM-041) with `Build failed:`, a newline, and dtc's standard error
as it is. Human mode writes that, then a newline: dtc's own final newline
leaves an empty line at the end. JSON mode gives it as `message`, including
dtc's final newline.

**BUILD-005** Before it runs dtc, the CLI shall create the build folder and
its parents when they don't exist. When dtc succeeds, the CLI shall leave the output file as dtc
wrote it, replacing any earlier one. In human mode it writes `Build completed
successfully`, an empty line, then `  <output file>`, as the no-OS backend
does. In JSON mode it responds per `04-protocol/build.schema.json`: `{ "ok":
true, "message": "Compiled overlay", "severity": "info", "path": <output
file> }`, `path` being absolute.

**BUILD-006** The CLI shall change no file other than the output file, the
full devicetree file, the build folder, and the scratch files of 02-common.md
§8.2 and BUILD-014.

**BUILD-007** When `build-command` is set (and not empty), the CLI shall run
it instead of BUILD-002 to BUILD-006, with the shell, in the directory that
holds `.analog-attach/`, after the progress line `Building <overlay file>
with '<command>'`. `{workfile}` in it is the overlay file and `{output}` the
output file (the `.dtb` where `output` is `full`), each in double quotes. It needs only `workfile` to be set
(BUILD-001 with its problem alone); the file needn't exist, and nothing is
loaded or created. The command's standard output and standard error go to
standard error, line by line, as with noos's CMake (BUILD-511).

**BUILD-008** If the command exits with a non-zero status, then the CLI shall
refuse with `Build failed with exit code <n>`. Otherwise it shall respond
`{ "ok": true, "message": "Built <overlay file> with '<command>'",
"severity": "info" }`, with `path` the output file when that exists, and
write `Build completed successfully`, then an empty line and `  <output
file>` when it exists, in human mode.

### 4.1 Where `output` is `full`

**BUILD-010** The CLI shall write the full devicetree file, creating the
build folder when it doesn't exist and replacing any earlier file, before it
compiles: `/dts-v1/;`, the line `#include "<base>"`, then for each fragment
of the overlay with an `__overlay__`, in file order (the order dtc applies
them in), an empty line and a block `<reference> {`, the body's properties
and child nodes as the overlay is printed (one tab in), and `};`. `<base>` is
the `devicetree` file relative to the full devicetree file's directory, where
cpp looks first, or its absolute path when the two share no directory but
the root. This is how a kernel board file is written (`#include
"zynq-coraz7s.dtsi"`, then `&spi0 { … }`), and dtc applies the blocks over
the base as the loader would apply the overlay.

**BUILD-011** A block's `<reference>` shall be `&<label>` when the fragment
targets a label the base has for the node it resolves to; `/` when it
resolves to the root and its body has no label; and `&{<path>}` otherwise,
`<path>` being where the target resolves to (a label the overlay defines
resolves to where its node lands, 02-common.md §8.3), so a block may come
before the one that defines its label. A label on the body goes before the
reference (`<label>: <reference> {`); dtc takes one there, so each further
label gets an empty block `<label>: <reference> {` `};` of its own.

**BUILD-012** The CLI shall leave out `__dormant__` bodies and the root's
nodes that aren't fragments (`__overrides__`), as the kernel's overlay apply
does.

**BUILD-013** If a fragment's target resolves to no node (it has none, or
names a label neither the base nor the overlay has), then the CLI shall
refuse with `Build failed: the target of <fragments> is in neither the base
devicetree nor the overlay`, `<fragments>` being those fragments' names
(`fragment@0`) joined by `, `, and write nothing.

**BUILD-014** The CLI shall run `preprocess-command` on the full devicetree
file as on the base (COM-091), with `{output}`
`.analog-attach/linux/build.preprocessed.dts` and `{linux}` the `linux` field.
If it exits with a non-zero status, then the CLI shall refuse with `Build
failed: preprocessing <full devicetree file> failed:`, a newline and its
standard error, trimmed. Otherwise it shall run BUILD-002's command with the
preprocessed file as input, and BUILD-004 applies.

**BUILD-015** When dtc succeeds, the CLI shall leave the output file as dtc
wrote it. In human mode it writes `Build completed successfully`, an empty
line, then `  <full devicetree file>` and `  <output file>`, one per line. In
JSON mode it responds per `04-protocol/build.schema.json`: `{ "ok": true,
"message": "Compiled devicetree", "severity": "info", "path": <output file>,
"source": <full devicetree file> }`, both absolute.

## 5. Where the backend is noos

The project is the directory `generate` writes (`generate.md` GENERATE-010):
the `project-path` setting, or `out/<project-name>` in the directory that
holds `.analog-attach/`, `<project-name>` being the `project-name` setting
or the name of the workfile's directory. `build` doesn't read the workfile.

### 5.1 The project

**BUILD-500** If the project directory doesn't exist, then the CLI shall
refuse with `Project path does not exist: <dir>. Run: analog-attach
generate`; if it isn't a directory, with `Project path is not a directory:
<dir>`.

### 5.2 With `build-command`

**BUILD-501** When `build-command` is set, the CLI shall run it with the
shell in the project directory, after the progress line `Building <dir>
with '<command>'`. `--clean` changes nothing in it (open issue B-3). If it exits with a non-zero status, then the CLI shall refuse with
`Build failed with exit code <n>`.

**BUILD-502** When it succeeds, the artifact shall be the ELF CMake would
have written (BUILD-512), when `capi-path` is set, the project's presets and
`CMakeLists.txt` give it, and the file exists; otherwise there is none. The
JSON message is `Built <dir> with '<command>'`.

### 5.3 With CMake

**BUILD-510** When `build-command` isn't set and `capi-path` isn't
configured, the CLI shall refuse with `capi-path is not configured. Run:
analog-attach config capi-path <path>` (open issue B-4).

**BUILD-511** The CLI shall write the progress line, then every line the
tools write to their standard output or standard error, to standard error,
in both modes (`02-common.md` COM-514). On a terminal the progress line is
kept under the tool's lines and rewritten as they come.

**BUILD-512** The CLI shall read the project's `CMakePresets.json` and
`CMakeLists.txt`, and refuse with the first of these that applies:

| Problem | Message |
|---|---|
| No presets file | `No CMakePresets.json in <dir>. Is this a generated project? Run: analog-attach generate` |
| Not JSON | `<file> is not valid JSON` |
| No `configurePresets` | `<file> has no configurePresets` |
| Not exactly one preset that isn't hidden (a generated project has one, for the board it was generated for) | `The project has <n> board presets (<names>), not the one a generated project has. Generate it again: analog-attach generate`, `<names>` `none` when there is none |
| No `CMakeLists.txt` | `No CMakeLists.txt in <dir>` |
| No `project(<target>)` in it | `<file> declares no project()` |

The board is the preset's name, the target the `project()` name, the build
folder `<build>` the `build-dir` setting resolved against `<dir>` (`build`
when unset; `02-common.md` §8.1), and the ELF `<build>/<target>.elf`.
Several build folders can sit side by side in one project (`build-debug`,
`build-release`).

**BUILD-513** The CLI shall then check, and refuse with every problem it
finds, their messages joined with a space, in this order:
`cmake was not found on PATH. Install CMake 3.27.0 or newer.`; `CMake
<version> is too old; CAPI apps need 3.27.0 or newer.`; `ninja was not found
on PATH, and the generated preset uses it as the generator. Install it (apt
install ninja-build).`; `<capi> is not a capi checkout: it has no
sdk/cmake/capi_create_application.cmake. Check the capi-path setting.`; and,
for a preset whose `PLATFORM` is `maxim`, `MAXIM_SDK_PATH is not set.` or
`MAXIM_SDK_PATH is '<value>', which does not exist.`, followed by ` Set
MAXIM_SDK_PATH to the MaximSDK install (the directory holding Libraries/ and
Tools/).`

**BUILD-514** With `--clean`, the CLI shall delete `<build>` before it
configures.

**BUILD-515** The CLI shall write the progress line `Building <target> for
<board>`, then run `cmake --preset <board> -B <build>` and `cmake --build <build>`
in the project directory, with `CAPI_DIR` set to `capi-path` in their
environment. If the first exits with a non-zero status, then the CLI shall
refuse with `CMake configure failed with exit code <n>`; if the second
does, with `Build failed with exit code <n>`.

### 5.4 The result

**BUILD-520** When the build succeeds and the ELF exists, the CLI shall
respond `{"ok": true, "message": "Built <target> for <board>: <elf>",
"severity": "info", "path": <elf>}` (`04-protocol/build.schema.json#/$defs/noos`;
with `build-command`, BUILD-502's message, and `path` only when there is an
artifact). In human mode it shall write `Build completed successfully`, then
an empty line and `  <elf>` when there is one.

**BUILD-521** When the CMake build succeeds but the ELF doesn't exist, the
CLI shall respond `{"ok": true, "message": "Built <target> for <board>, but
no ELF was found at <elf>", "severity": "warn", "error_type":
"output-missing"}` without `path`, and write
`Build reported success but no ELF was found at <elf>` in human mode.

**BUILD-522** The CLI shall change nothing but what the tools write (the
build directory, and what the command writes), and the settings and the
workfile not at all.

## 6. Open issues

**B-1. dtc's warnings are dropped.** On success, dtc's standard error
(warnings such as `unit_address_vs_reg`) is discarded and not shown.

**B-2. `build` doesn't validate.** An overlay that `validate` reports errors
for still compiles. It is up to the user to run `validate` first.

**B-3. `--clean` is ignored with `build-command`.** The command runs as it
is, without a word: `build --clean` doesn't delete the build directory.

**B-4. Two wordings for an unset `capi-path`.** `build` and `deploy` say
`capi-path is not configured. Run: analog-attach config capi-path <path>`,
where every other command says `Setting "capi-path" is not configured. Run:
analog-attach config capi-path <value>` (`02-common.md` COM-512).

**B-5. dtc's errors in a full build cite the preprocessed file.** dtc reads
`build.preprocessed.dts`, which `-P` leaves without line markers, so an
error's line is one of that file, not of the full devicetree file or the
base.

## 7. Examples

```
$ analog-attach build
Build completed successfully

  /work/build/ad7124-8.dtbo
```

Where `output` is `full`, on a Cora Z7S (`devicetree` the Linux tree's
`zynq-coraz7s.dts`, the workspace beside the Linux tree):

```
$ analog-attach build
Build completed successfully

  /home/me/cora/build/adxl355.dts
  /home/me/cora/build/adxl355.dtb
$ cat build/adxl355.dts
/dts-v1/;
#include "../../linux/arch/arm/boot/dts/xilinx/zynq-coraz7s.dts"

&spi0 {
	adxl355: adi,adxl355@0 {
		compatible = "adi,adxl355";
		reg = <0>;
	};
};
```

```
$ analog-attach --json build
{"ok":false,"message":"/work/ad7124-8.dtso:20.21-23.6: ERROR (duplicate_label): /fragment@1/__overlay__/temp@53: Duplicate label 'adxl345' on /fragment@1/__overlay__/temp@53 and /fragment@1/__overlay__/accel@53\nERROR: Input tree has errors, aborting (use -f to force output)\n","severity":"error","error_type":"tool-failed"}
```

Where the backend is noos (a stand-in capi that builds a host program,
`testboard` the project's preset; the tool's lines are on standard error):

```
$ analog-attach build
Building p_app for testboard
-- Configuring done (0.0s)
-- Generating done (0.0s)
-- Build files have been written to: /work/out/work/build
[1/2] Building C object CMakeFiles/p_app.dir/stub.c.o
[2/2] Linking C executable p_app.elf
Build completed successfully

  /work/out/work/build/p_app.elf
```


```
$ analog-attach --json build
{"ok":true,"message":"Built /work/out/work with 'echo hi'","severity":"info"}
```
