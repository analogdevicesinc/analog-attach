# build

Runs the project's `AA_BUILD`, by default its `aa_build.sh`, which compiles the overlay into a
binary `.dtbo`, or, where the `output` setting is `devicetree`, compiles the
base devicetree with the overlay applied into a `.dtb` (for boards that boot a
full devicetree only), the CLI writing that devicetree first. A shared
command: §2 to §4 as the linux backend does it (with the project's
`AA_BUILD`), §5 as the noos backend does it (the generated project, built
with CMake or the `build-command` setting).

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
| Output file | In the build folder, the overlay file's name with `.dtso` replaced by `.dtbo`, or with `.dtbo` appended when it doesn't end in `.dtso` (`overlay.dtso` → `<build folder>/overlay.dtbo`, `my.dts` → `<build folder>/my.dts.dtbo`). Where `output` is `devicetree`, `.dtb` in place of `.dtbo` (`<build folder>/overlay.dtb`, `<build folder>/my.dts.dtb`). It is `$AA_DTBO`, or `$AA_DTB` (02-common.md COM-153). |
| Full devicetree file | Where `output` is `devicetree`: in the build folder, the overlay file's name with `.dtso` replaced by `.dts`, or with `.dts` appended (`<build folder>/overlay.dts`, `<build folder>/my.dts.dts`). |
| AA_BUILD | The executable variable the build runs (02-common.md COM-158): `./aa_build.sh` unless `config var AA_BUILD <command>` set another. |
| aa_build.sh | The file `aa_build.sh` in the directory that holds `.analog-attach/` (02-common.md §8.6), what `AA_BUILD` runs by default. `init` writes its starter (init.md INIT-100). |
| dtc | The `dtc` on PATH, 1.6.0 or later (02-common.md COM-118): `$AA_DTC`. |

## 3. Resources

The command needs the `workfile` setting, a file there (`workfile: <path>
does not exist` otherwise, with the hint of 02-common.md §8.1; the CLI
doesn't read it), and, while `AA_BUILD` is its default, `aa_build.sh`
(02-common.md COM-150). Where `output` is
`devicetree` it needs the base and the overlay instead of the file alone
(COM-070; 02-common.md §8.2 for the base, §8.3 for the overlay), to write
the full devicetree file. Where it is `overlay`, it doesn't check the base
or the tools. What `AA_BUILD` needs is its own to check (the starter checks
dtc and the input file, BUILD-034).

## 4. Requirements

**BUILD-001** When the workspace can't be loaded, the CLI shall report it per
COM-071 or COM-072 and run nothing. While `AA_BUILD` is its default, a
`aa_build.sh` that is missing, isn't a file or isn't executable is a problem of
it (02-common.md COM-150).

**BUILD-002** *Withdrawn.* (Where `output` was `overlay`, the CLI ran dtc
itself, the `build-command` setting's default; `aa_build.sh` runs it now,
BUILD-030.)

**BUILD-003** Where `output` is `overlay`, the CLI shall run `AA_BUILD` on
the overlay file as it is on disk: it doesn't run `AA_PREPROCESS_COMMAND`, merge
in the base, or validate against the bindings. The starter compiles it with
`-@`, which makes dtc emit `__symbols__` and `__fixups__`, so references to
base labels are resolved when the overlay is applied.

**BUILD-004** *Withdrawn.* (dtc's failure was refused with `Build failed:`
and its standard error; a failing `aa_build.sh` is BUILD-031.)

**BUILD-005** *Withdrawn.* (The CLI created the build folder and answered
`Compiled overlay`; the starter creates the folder, and BUILD-032 is the
answer.)

**BUILD-006** The CLI shall change no file other than the full devicetree
file, the build folder it is in, and the scratch files of 02-common.md §8.2
and BUILD-014. What `AA_BUILD` writes is its own.

**BUILD-007** *Withdrawn.* (A `build-command` of the user's ran instead of
dtc; the setting is gone: `aa_build.sh` is the user's to edit, and `AA_BUILD`
runs another command, 02-common.md COM-158.)

**BUILD-008** *Withdrawn.* (`Build failed with exit code <n>`, and `Built
<overlay file> with '<command>'`, for a `build-command`; BUILD-031 and
BUILD-032.)

**BUILD-009** *Withdrawn.* (`{dtc}` and `{dts}` in a `build-command`; the
script gets `$AA_DTC` and `$AA_DTS`, 02-common.md COM-153.)

**BUILD-018** *Withdrawn.* (A `build-command` with no value built nothing.)

**BUILD-019** *Withdrawn.* (A `build-command` naming the other `output`'s
files was refused; the script gets only those of its `output`, COM-153.)

**BUILD-030** When the workspace has loaded (and where `output` is
`devicetree`, once the full devicetree file is written and preprocessed,
BUILD-010 to BUILD-014), the CLI shall run `AA_BUILD` per 02-common.md
COM-151, with the environment of COM-152 for `build`, after the progress
line `Building <overlay file> with AA_BUILD`.

**BUILD-031** If `AA_BUILD` exits with a non-zero status, or doesn't start,
then the CLI shall refuse (COM-040, COM-041) with `Build failed: AA_BUILD
exited with status <n>` (`Build failed: AA_BUILD did not run: <why>` when it
didn't start), `error_type` `tool-failed`. In JSON mode the message is
followed by a newline and the command's standard error, its lines joined with
newlines, when it wrote any; in human mode those lines are already on
standard error (COM-151), and standard output has the message alone.

**BUILD-032** When `AA_BUILD` succeeds and the output file exists, the CLI
shall write `Build completed successfully`, an empty line, then `  <output
file>` in human mode, as the no-OS backend does. In JSON mode it responds per
`04-protocol/build.schema.json`: `{ "ok": true, "message": "Built <overlay
file> with AA_BUILD", "severity": "info", "path": <output file> }`, `path`
being absolute.

**BUILD-033** When `AA_BUILD` succeeds but the output file doesn't exist,
the CLI shall warn `warning: AA_BUILD succeeded, but <output file> is not
there` on standard error and respond `{ "ok": true, "message": "AA_BUILD
succeeded, but <output file> is not there", "severity": "warn",
"error_type": "output-missing" }`, without `path`. Human mode writes `Build
completed successfully`, alone (where `output` is `devicetree`, then the
empty line and `  <full devicetree file>`).

**BUILD-034** The starter `aa_build.sh` (init.md INIT-100) shall compile the
input, `$AA_DTSO` (where `$AA_OUTPUT` is `devicetree`, `$AA_DTS`), into the
output, `$AA_DTBO` (or `$AA_DTB`): it exits with status 1 and `aa_build.sh: dtc
1.6.0 or later is not on PATH: install it (the device-tree-compiler
package)` on standard error when `$AA_DTC` is empty, or `aa_build.sh: <input>
not found` when the input isn't a file; otherwise it creates
`$AA_BUILD_DIR`, writes the line `dtc -@ -I dts -O dtb -o <output> <input>`,
and runs `"$AA_DTC" -@ -I dts -O dtb -o "<output>" "<input>"`, exiting with
dtc's status. dtc's errors and warnings come on standard error.

### 4.1 Where `output` is `devicetree`

The build is two steps on the full devicetree file the CLI writes
(BUILD-010): `AA_PREPROCESS_COMMAND` on it (BUILD-014), then `AA_BUILD` on the
preprocessed file, its `$AA_DTS`, into the output file, its `$AA_DTB`. The
help of `build` says so.

**BUILD-010** The CLI shall write the full devicetree file, creating the
build folder when it doesn't exist and replacing any earlier file, before it
compiles: `/dts-v1/;`, the line `#include "<base>"`, then for each fragment
of the overlay with an `__overlay__`, in the order of BUILD-016, an empty line and a block `<reference> {`, the body's properties
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
resolves to where its node lands, before the base's label of that name; a
`target-path` that isn't absolute, `spi0/spidev@0`, begins with an alias of
the base's `/aliases`, as the loader reads it). A label on the body goes
before the reference (`<label>: <reference> {`); dtc takes one there, so each further
label gets an empty block `<label>: <reference> {` `};` of its own.

**BUILD-012** The CLI shall leave out `__dormant__` bodies and the root's
nodes that aren't fragments (`__overrides__`), as the kernel's overlay apply
does.

**BUILD-013** If a fragment's target resolves to no node (it has none,
names a label neither the base nor the overlay has, or one only a
`__dormant__` body defines, or a `target-path` begins with an alias the base
doesn't have), then the CLI shall
refuse with `Build failed: the target of <fragments> is in neither the base
devicetree nor the overlay`, `<fragments>` being those fragments' names
(`fragment@0`) joined by `, `, error type `unresolved` (`02-common.md`
COM-052, as `validate` and `import` type a target that names no node), and
write nothing.

**BUILD-014** The CLI shall run `AA_PREPROCESS_COMMAND` on the full devicetree
file as on the base (COM-091), with `$AA_PREPROCESS_INPUT` the full devicetree
file, `$AA_PREPROCESS_OUTPUT` `.analog-attach/linux/build.preprocessed.dts` and
`$AA_LINUX` the `linux` field.
If it exits with a non-zero status, then the CLI shall refuse with `Build
failed: preprocessing <full devicetree file> failed:`, a newline and its
standard error, trimmed, and not run `AA_BUILD`. Otherwise the preprocessed
file is `$AA_DTS` (02-common.md COM-153), what the starter compiles
(BUILD-034), and BUILD-030 applies.

**BUILD-015** When `AA_BUILD` succeeds and the output file exists, the CLI
shall write `Build completed successfully`, an empty line, then `  <full
devicetree file>` and `  <output file>`, one per line, in human mode. In JSON
mode it responds per `04-protocol/build.schema.json`: BUILD-032's response
with `"source": <full devicetree file>`, both absolute. BUILD-033's response
has `source` too.

**BUILD-016** The blocks shall be in file order, except that a block whose
target isn't there yet waits. A target is there when it is a base node or a
node an earlier block adds; one that isn't is a node the overlay adds in a
later fragment (`target = <&ft5406>` before the fragment that adds `ft5406:
ts@38`). A waiting block shall come right after the block that makes its
target exist, several waiting blocks in file order. Its properties then
replace those of the block that adds the node, as the Raspberry Pi loader
merges a fragment aimed at the overlay's own node into that node. A block
that still waits after the last one makes BUILD-013's refusal: its node is
added only by a `__dormant__` body, which BUILD-012 leaves out.

**BUILD-017** A label the overlay defines that the base has on another node
shall be written as `<label>_<n>`, `<n>` the first number from 1 for which
neither the base, the overlay nor an earlier renaming has that label, as
`add` picks a free label.
So shall the overlay's `&<label>` references to it: in an overlay its own
label wins (BUILD-011), as dtc resolves an overlay's references. The base's
references keep the base's node, and the overlay file itself is unchanged.
Example: uart0 adds `uart0_pins: uart0_ovl_pins` under `&gpio`. The RPi 4
base already has `uart0_pins`, so the full devicetree file has
`uart0_pins_1: uart0_ovl_pins`, and the overlay's `pinctrl-0 =
<&uart0_pins>` becomes `<&uart0_pins_1>`.

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

**B-2. `build` doesn't validate.** An overlay that `validate` reports errors
for still compiles. It is up to the user to run `validate` first.

**B-3. `--clean` is ignored with `build-command`.** The command runs as it
is, without a word: `build --clean` doesn't delete the build directory.

**B-4. Three wordings for an unset `capi-path`.** `build` and `deploy` say
`capi-path is not configured. Run: analog-attach config capi-path <path>`,
`init` adds `, or analog-attach for the guided setup` (INIT-509), and the
other commands say `Setting "capi-path" is not configured. Run: analog-attach
config capi-path <value>` (`02-common.md` COM-512).

**B-5. dtc's errors in a full build cite the preprocessed file.** The starter's dtc reads
`build.preprocessed.dts`, which `-P` leaves without line markers, so an
error's line is one of that file, not of the full devicetree file or the
base.

**B-6. A reference the base lacks gets dtc's raw error.** An overlay for
another board (a Pi 5 overlay on a Pi 4 base) references labels the base
doesn't have, and the build fails with dtc's `Reference to non-existent node
or label "rp1_…"` on the preprocessed file (B-5), not with a message naming
the reference and the fragment. `import` warns of the board fit beforehand.

**B-7. A stale output file looks like a success.** The CLI checks that the
output file exists after `AA_BUILD` (BUILD-033), not that the command wrote
it: a script that does nothing but succeed, with a `.dtbo` of an earlier
build in the folder, gives BUILD-032.

## 7. Examples

```
$ analog-attach build
Building /work/ad7124-8.dtso with AA_BUILD
dtc -@ -I dts -O dtb -o /work/build/ad7124-8.dtbo /work/ad7124-8.dtso
Build completed successfully

  /work/build/ad7124-8.dtbo
```

The first two lines are on standard error. With `AA_BUILD` another
command, `aa_build.sh` isn't needed:

```
$ analog-attach config var AA_BUILD 'make -C overlays "$AA_DTBO"'
Set variable AA_BUILD = make -C overlays "$AA_DTBO"
$ analog-attach build
Building /work/ad7124-8.dtso with AA_BUILD
make: Entering directory '/work/overlays'
…
Build completed successfully

  /work/build/ad7124-8.dtbo
```

With `AA_BUILD` its default and no `aa_build.sh`:

```
$ analog-attach build
aa_build.sh not found in /work

Run 'analog-attach init --restore build' to write the starter aa_build.sh, or set AA_BUILD to another command ('analog-attach config var AA_BUILD <command>').
```

Where `output` is `devicetree`, on a Cora Z7S (`devicetree` the Linux tree's
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
{"ok":false,"message":"Build failed: AA_BUILD exited with status 2\n/work/ad7124-8.dtso:20.21-23.6: ERROR (duplicate_label): /fragment@1/__overlay__/temp@53: Duplicate label 'adxl345' on /fragment@1/__overlay__/temp@53 and /fragment@1/__overlay__/accel@53\nERROR: Input tree has errors, aborting (use -f to force output)","severity":"error","error_type":"tool-failed"}
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
