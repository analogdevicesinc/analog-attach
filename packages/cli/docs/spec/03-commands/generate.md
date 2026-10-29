# generate

Renders the workfile into a CAPI project: the CMake files, the board
parameters and the C sources that `build` compiles and `deploy` flashes. The
no-OS backend's own command; the linux backend doesn't have it (an unknown
command, COM-015).

## 1. Synopsis

```
analog-attach [--json] generate [--output <directory>] [--project-template <template>] [--board <board>]
```

Grammar: rule `generate` in `01-grammar.abnf`. It takes no positionals.

| Option | Meaning | Default |
|---|---|---|
| `--output <directory>` | The project directory, resolved against the CWD. | the `project-path` setting, else `out/<project-name>` (GENERATE-010) |
| `--project-template <template>` | The template set: a bundled set's name (`capi`, `capi-iio`) or a directory. | the `project-template` setting, else `capi` |
| `--board <board>` | The board the project is for. | the workfile's board, else the only board carrying its chip |

## 2. Terms

| Term | Meaning |
|---|---|
| Template set | A directory with a `project_structure.json` and the Eta templates it names. The bundled ones are under the installation's `bundled/noos/templates/`: `capi` (the parts' examples, or the user's `app_main()` in `src/app.c`) and `capi-iio` (an IIO application, extending `capi`). |
| Project structure | `project_structure.json`: `{ "extends"?: <set>, "files": [{ "template", "output", "protect" }…] }`. Each entry renders one file; `extends` names a set whose templates fill in the ones this set doesn't have. |
| Protected file | An entry with `protect: true` (`src/app.c` in `capi`): the user's file, written only when it doesn't exist. |
| Project name | The `project-name` setting, else the name of the directory that holds the workfile. |

## 3. Checks

**GENERATE-001** The CLI shall load the workfile (`02-common.md` COM-512)
and refuse as it says. If the workfile's platform has no vendor, then it
shall refuse with `Platform vendor not found in workfile`.

**GENERATE-002** The CLI shall resolve the board from `--board`, else the
workfile's board, else the one board carrying the workfile's chip, and
refuse with the first problem:

| Problem | Message |
|---|---|
| A board no module repository has | `Unknown board '<board>'. Configured platforms support: <boards>` |
| A board carrying another chip | `Board '<board>' carries <chip>, but this workfile targets <workfile chip>` |
| No board given, none carries the chip | `No board carries <chip>, so one cannot be chosen for you` |
| No board given, several carry it | `More than one board carries <chip>: <boards>. Pick one.`, the boards sorted |

The board only names the project in the response; the files are rendered
for the workfile's board (open issue GE-3).

**GENERATE-003** The CLI shall resolve the template set from
`--project-template`, else the `project-template` setting, else `capi`. A
value that is absolute or has a `/` or `\` is a directory, resolved against
the CWD; any other names a bundled set. If the directory doesn't exist, then
the CLI shall refuse with `Template set '<template>' not found at
'<directory>'.`, followed by ` Available sets: <sets>` (the bundled ones,
sorted) when there is one; if it has no `project_structure.json`, with
`Template set '<template>' has no 'project_structure.json' (looked in
'<directory>')`.

**GENERATE-004** If the project structure isn't what §2 says, then the CLI
shall refuse with the problem, before anything is written, among them:
`Could not read project structure '<file>': <problem>`, `Project structure
'<file>' must be an object with a 'files' array`, `Project structure
'<file>' extends an unusable set: <problem>`, `Project structure '<file>'
extends itself`, `Project structure entry #<n> needs string 'template' and
'output'`, `Project structure entry #<n> ('<output>') needs a boolean
'protect'`, `Project structure entry '<output>' references missing template
'<template>'`. `<n>` counts from 0.

## 4. The project

**GENERATE-010** The project directory shall be `--output` resolved against
the CWD, else the `project-path` setting, else `out/<project name>` in the
directory that holds `.analog-attach/`. `build` and `deploy` act on the
same directory without `--output` (`build.md` §5).

**GENERATE-011** The CLI shall render the entries of the project structure
in order, each to `<project directory>/<output>`, creating the directories
it needs and replacing a file that is there. A protected file that exists
shall be left as it is and not listed. Every template gets the same input:
the workfile, its nodes laid out so a node comes after the ones it
references by value, the project name, the platform and board, `capi-path`,
and the `example` setting (whether `src/main.c` runs each part's example).

**GENERATE-012** If a template fails, then the CLI shall refuse with its
message, the files rendered before it being written (open issue GE-1): the
`capi-iio` set with no IIO device gives `The capi-iio template set serves
IIO devices, and the workfile has none. Add a part with: analog-attach add
<driver>`, a workfile with no board `A CAPI application is built for a
board, and the workfile names none`.

**GENERATE-013** The CLI shall not validate the workfile first (open issue
GE-2), and shall change no setting and not the workfile.

## 5. Output

**GENERATE-030** In human mode the CLI shall write:

```
Generated project '<name>' (board: <board>, templates: <template>)

  Files created:
    <file>
    …

  <n> file[s] created
```

`<file>` being each file written, as an absolute path, in the order of
GENERATE-011, and `<template>` the set as GENERATE-003 got it.

**GENERATE-040** In JSON mode the CLI shall respond `{"ok": true, "message":
"Generated '<name>' in <directory> (board: <board>, templates: <template>,
<n> file[s])", "severity": "info"}` (`04-protocol/generate.schema.json`).
The files aren't listed.

## 6. Open issues

**GE-1. A failed `generate` leaves a partial project.** The files rendered
before the failing template stay: `generate --project-template capi-iio
--output gen3` with no IIO device refuses, and `gen3` has
`CMakeLists.txt`, `module.yml`, `CMakePresets.json`, `project.conf` and
three sources, but no `src/main.c`. A fix would be to render every file
first and write them once all have rendered.

**GE-2. `generate` doesn't validate.** A workfile `validate` reports errors
for (a required value left empty, a missing chip select) is generated
without a word, and the error comes from the compiler, if at all.

**GE-3. `--board` only names the project.** The templates take the board
from the workfile: `generate --board twobusboard` with a workfile for
`otherboard` says `board: twobusboard`, and `CMakePresets.json`,
`module.yml` and `src/bsp/parameters.h` are for `otherboard`. A workfile
that targets only a chip can't be generated at all: `--board` gives `A CAPI
application is built for a board, and the workfile names none`, and without
it, `More than one board carries othersoc: otherboard, twobusboard. Pick
one.` asks for a choice that can't be made. A fix would be to pass the
resolved board to the templates.

**GE-4. "Files created" lists replaced files.** A second `generate` lists the
files it rewrote as created (`8 files created`, `src/app.c` being kept).

## 7. Examples

```
$ analog-attach generate
Generated project 'work' (board: testboard, templates: capi)

  Files created:
    /work/out/work/CMakeLists.txt
    /work/out/work/module.yml
    /work/out/work/CMakePresets.json
    /work/out/work/project.conf
    /work/out/work/src/bsp/parameters.h
    /work/out/work/src/common/common_data.h
    /work/out/work/src/common/common_data.c
    /work/out/work/src/main.c
    /work/out/work/src/app.c

  9 files created
```

```
$ analog-attach --json generate --output gen2
{"ok":true,"message":"Generated 'work' in /work/gen2 (board: testboard, templates: capi, 9 files)","severity":"info"}
```

```
$ analog-attach --json generate --project-template nope
{"ok":false,"message":"Template set 'nope' not found at '<installation>/bundled/noos/templates/nope'. Available sets: capi, capi-iio","severity":"error"}
```

```
$ analog-attach --json generate --board otherboard
{"ok":false,"message":"Board 'otherboard' carries othersoc, but this workfile targets testsoc","severity":"error"}
```
