# build

Compiles the overlay into a binary `.dtbo`. A shared command: §2 to §4 as
the linux backend does it, §5 as the noos backend does it (the generated
project, built with CMake or the `build-command` setting).

## 1. Synopsis

```
analog-attach [--json] build
analog-attach [--json] build [--board <board>] [--clean]     # where the backend is noos
```

Grammar: rule `build` in `01-grammar.abnf`. Where the backend is linux, the
command takes no arguments or options.

| Option (noos) | Meaning | Default |
|---|---|---|
| `--board <board>` | The board preset of the project to build. | the project's only preset |
| `--clean` | Delete the project's build directory first, so CMake configures afresh. | off |

## 2. Terms

| Term | Meaning |
|---|---|
| Overlay file | The file the `workfile` setting names, as it is on disk. |
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
<paths>" }`, with the hint `The analog-attach installation is incomplete;
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
(COM-040, COM-041) with `Build failed:`, a newline, and dtc's standard error
as it is. Human mode writes that, then a newline: dtc's own final newline
leaves an empty line at the end. JSON mode gives it as `message`, including
dtc's final newline.

**BUILD-005** When dtc succeeds, the CLI shall leave the output file as dtc
wrote it, replacing any earlier one. It writes `Wrote <output file>` in human
mode. In JSON mode it responds per `04-protocol/build.schema.json`: `{ "ok":
true, "message": "Compiled overlay", "severity": "info", "path": <output
file> }`, `path` being absolute.

**BUILD-006** The CLI shall change no file other than the output file and the
scratch files of 02-common.md §8.2.

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
with '<command>'`. `--board` and `--clean` change nothing in it (open issue
B-3). If it exits with a non-zero status, then the CLI shall refuse with
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
| No `--board`, and not exactly one preset that isn't hidden | `The project has <n> board presets (<names>); pass --board to pick one`, `<names>` `none` when there is none |
| `--board` names no preset | `The project has no preset for board '<board>'. It has: <names>. Regenerate it for that board.` |
| No `CMakeLists.txt` | `No CMakeLists.txt in <dir>` |
| No `project(<target>)` in it | `<file> declares no project()` |

The board is the preset's name, the target the `project()` name, and the
ELF `<dir>/build/<target>.elf`.

**BUILD-513** The CLI shall then check, and refuse with the first problem:
`cmake was not found on PATH. Install CMake 3.27.0 or newer.`; `CMake
<version> is too old; CAPI apps need 3.27.0 or newer.`; `ninja was not found
on PATH, and the generated preset uses it as the generator. Install it (apt
install ninja-build).`; `<capi> is not a capi checkout: it has no
sdk/cmake/capi_create_application.cmake. Check the capi-path setting.`; and,
for a preset whose `PLATFORM` is `maxim`, `MAXIM_SDK_PATH is not set.` or
`MAXIM_SDK_PATH is '<value>', which does not exist.`, followed by ` Set
MAXIM_SDK_PATH to the MaximSDK install (the directory holding Libraries/ and
Tools/).`

**BUILD-514** With `--clean`, the CLI shall delete `<dir>/build` before it
configures.

**BUILD-515** The CLI shall write the progress line `Building <target> for
<board>`, then run `cmake --preset <board>` and `cmake --build <dir>/build`
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
no ELF was found at <elf>", "severity": "warn"}` without `path`, and write
`Build reported success but no ELF was found at <elf>` in human mode.

**BUILD-522** The CLI shall change nothing but what the tools write (the
build directory, and what the command writes), and the settings and the
workfile not at all.

## 6. Open issues

**B-1. dtc's warnings are dropped.** On success, dtc's standard error
(warnings such as `unit_address_vs_reg`) is discarded and not shown.

**B-2. `build` doesn't validate.** An overlay that `validate` reports errors
for still compiles. It is up to the user to run `validate` first.

**B-3. `--board` and `--clean` are ignored with `build-command`.** The
command runs as it is, without a word: `build --clean` doesn't delete the
build directory, and `--board` only picks the preset the artifact is looked
up by (BUILD-502).

**B-4. Two wordings for an unset `capi-path`.** `build` and `deploy` say
`capi-path is not configured. Run: analog-attach config capi-path <path>`,
where every other command says `Setting "capi-path" is not configured. Run:
analog-attach config capi-path <value>` (`02-common.md` COM-512).

## 7. Examples

```
$ analog-attach build
Wrote /work/ad7124-8.dtbo
```

```
$ analog-attach --json build
{"ok":false,"message":"/work/ad7124-8.dtso:20.21-23.6: ERROR (duplicate_label): /fragment@1/__overlay__/temp@53: Duplicate label 'adxl345' on /fragment@1/__overlay__/temp@53 and /fragment@1/__overlay__/accel@53\nERROR: Input tree has errors, aborting (use -f to force output)\n","severity":"error"}
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
$ analog-attach --json build --board nope
{"ok":false,"message":"The project has no preset for board 'nope'. It has: testboard. Regenerate it for that board.","severity":"error"}
```

```
$ analog-attach --json build
{"ok":true,"message":"Built /work/out/work with 'echo hi'","severity":"info"}
```
