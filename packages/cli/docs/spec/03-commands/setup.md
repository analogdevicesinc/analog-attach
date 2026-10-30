# The setup run

A bare `analog-attach` on a terminal sets up the project: it asks which
backend the project targets when none is set, then runs the backend's setup.
Where the backend is linux, that asks for the Linux tree, the base
devicetree and the workfile's name, saves them, builds the binding caches,
and then runs `init`, which creates the workfile (`init.md` INIT-018).
Where the backend is noos, it asks where capi is, which module repositories
to use and which board, saving each answer at once, and offers to run
`init` (§9). It isn't a command: it has no name, no options and no JSON mode.

Its questions used to be `init`'s. They keep their numbers here: `INIT-0nn`
is `SETUP-0nn` for the requirements of §3, §4 and §6 to §8.

## 1. Synopsis

```
analog-attach
```

Grammar: an empty `command-line` in `01-grammar.abnf` (GRM-003, GRM-005).

## 2. Terms

| Term | Meaning |
|---|---|
| Checkbox question | A question with a list of choices, each checked or not: ↑ and ↓ move, Space checks, `a` checks all, `i` inverts, Enter submits. |
| Plan | Where the backend is linux: the Linux tree, the devicetree and the workfile choice (*keep* the configured path, or a new file name) that the setup run sets up. |
| Current settings | The effective values of the settings (COM-124), the invalid ones left out. |
| List question | A question with a list of choices: ↑ and ↓ move the highlight, Enter picks it. The highlight starts on the first choice, or on the one named as the default. |
| Line question | A question answered with a line of text, with an Enter default shown in parentheses when it has one; Tab completes file system paths. A refused answer is shown under the prompt, and the question stays. |

The setup run doesn't use workspace loading: it needs no resource, and
checks the answers itself.

## 3. When it runs

**SETUP-001** While in human mode, when argv is empty and the run is a
terminal run (COM-012), the CLI shall run the setup run.

**SETUP-002** When argv is empty in a run that isn't a terminal run, or argv
is the one element `--quiet`, the CLI shall write the usage as GRM-005 says,
and ask nothing.

## 4. The configuration

**SETUP-010** The CLI shall read the settings files before anything else.

**SETUP-011** If a settings file can't be read or isn't a JSON object
(COM-121), then the CLI shall write the problem as COM-072 words it (the
message, an empty line and `Fix or remove <file>.`) to standard error and
exit with status 2, without asking anything. The same holds when the active
section of a file isn't an object (COM-134), the problem worded with its
hint (`Make <id> an object in <file>; …`): before the backend question when
`backend` is set, and right after it otherwise, the backend just saved
(SETUP-021) being the one whose section can't be written. An old flat file
stops the run this way (`02-common.md` §8.1).

**SETUP-012** If the settings files have other problems (COM-123, COM-132,
COM-133, or a section other than the active one that isn't an object),
then the CLI shall go on with the current settings: an unknown key is
ignored and an invalid value is left out. (Open issue S-1.)

## 5. The backend

**SETUP-020** When `backend` is unset, or names no known backend, the CLI
shall ask the list question `What does this project target?`, one choice
per known backend, `<title> (<id>)` (`Linux device tree overlays (linux)`),
in the registry's order.

**SETUP-021** The CLI shall then write `backend = <id>` to the local
settings file (COM-129), write `Saved backend = <id> to <file>.` (`<file>`
with the home directory written `~`) and an empty line, and go on with that
backend.

**SETUP-022** When the backend has no setup of its own, the CLI shall write
`<title> needs these settings:`, one line `  <key> — <description>` per
required setting that is unset, an empty line, and their distinct hints
(`Run 'analog-attach config <key> <value>'.` for one without), and exit with
status 0. When none is unset, it shall write `<title>: every required setting
is set`.

**SETUP-023** When the user stops the backend question (Ctrl-C or Ctrl-D),
the CLI shall write `Cancelled.` to standard output and exit with status
130, without writing anything (COM-060). (Open issue S-5.)

## 6. Carrying out the plan

Where the backend is linux:

**SETUP-030** The CLI shall first write `linux`, `devicetree` and `workfile`
to the `linux` section of the local settings file (COM-129), `workfile` being the kept path or the
new file name made absolute against the CWD, then write `Saved linux,
devicetree and workfile to <file>.` and an empty line, `<file>` relative to
the CWD when it is under it (`.analog-attach/config.json`), else absolute.

**SETUP-031** *Withdrawn.* (The settings were loaded again, strictly, after
saving, and an unknown key refused. Unknown keys are now kept and ignored,
SETUP-012.)

**SETUP-032** When the caches are current for the Linux tree (COM-116), the
CLI shall leave them. Otherwise it shall build them (COM-112 to COM-114).

**SETUP-033** If the build can't start or fails, then the CLI shall refuse
with `<reason>`, a newline, and `Fix the problem, then run 'analog-attach
config --reload' to build the binding caches and 'analog-attach init' to create
the workfile.`. `<reason>` is the configuration errors as COM-072 words them,
or `Compiling binding schemas failed:` followed by a newline and the tool's
error output.

**SETUP-034** The CLI shall not itself create the workfile: when the
workfile's file exists, or can be created (INIT-019), it shall run `init`
(SETUP-041), which keeps or creates it. Otherwise it shall create nothing.

**SETUP-035** The CLI shall carry out SETUP-030 to SETUP-034 in that order
and stop at the first failure. What was written before the failure stays: a
failed cache build leaves `linux`, `devicetree` and `workfile` saved. (Open
issue S-3.)

**SETUP-036** The setup run shall not change `overlay-syntax`,
`preprocess-command` or the `deploy-*` fields, and shall not run `add`.

## 7. Result

**SETUP-041** Where the backend is linux, when the workfile's file exists or
can be created, the CLI shall write an empty line when it built the caches,
then run `init` (`init.md`) and end with its result: `init`'s summary
(INIT-041), its `Overlay:` line ending in `(created)` or `(kept)`, and its
exit status. When the file can't be created, the CLI shall instead write the
summary with the heading `Workspace configured`, the `Overlay:` line ending
in `(not created yet)`, the line `  Caches:      built now|current` after it,
and next steps that start with `  1. Create the workfile:` and
`     analog-attach init`, the other two steps numbered 2 and 3, followed by
an empty line.

**SETUP-042** The CLI shall colour its output (bold headings, dim remarks,
cyan commands) only when standard output is a terminal.

## 8. Asking

Where the backend is linux:

### 8.1 The questions

**SETUP-050** The CLI shall ask for the Linux tree (step 1), the devicetree
(step 2) and the workfile (step 3), in that order.

**SETUP-051** Before the first question, the CLI shall write an empty line,
`analog-attach setup`, a line of 19 `=`, an empty line, `This sets up the
workspace: a Linux kernel source tree, a base device tree and the overlay
file.` and an empty line. After each step it shall write an empty line.

**SETUP-052** In each step, the configured value is the Enter default.

**SETUP-053** At the line questions, Tab shall complete file system paths.

**SETUP-054** When a question of the steps is stopped (Ctrl-C or Ctrl-D),
the CLI shall write `Setup cancelled.` to standard output and exit with
status 130, without writing anything (COM-060).

### 8.2 Step 1: the Linux tree

**SETUP-060** The CLI shall write `Step 1: Linux kernel source tree`, an
empty line, `analog-attach needs the path to a Linux kernel source tree`,
`(must contain Documentation/devicetree/bindings/ and include/)`, an empty
line, `Searching for Linux source trees under ~...` and an empty line, and
look for Linux trees (COM-128) under the home directory: breadth first,
directory names in order, skipping hidden directories and `node_modules`,
`build`, `dist`, `venv`, `__pycache__` and the other tool directories, and
not looking inside a tree found. It reads directories down to 4 levels below
the home directory and checks their subdirectories, so a tree is found up to
5 levels down (`~/a/b/c/d/linux`). Before reading each directory it stops
when it has 10 trees or 5 seconds have passed, so the last directory read may
take the count past 10.

**SETUP-061** When trees are found or one is configured, the CLI shall ask
the list question `Linux source tree`: the trees, the configured one first
and marked ` (current)`, then `Type a path`. Enter takes the first. `Type a
path` asks the line question `Linux source path`: an empty answer is refused
with `Type a path`; the answer is expanded (a leading `~` or `~/` is the home
directory) and made absolute against the CWD; when it doesn't exist it is
refused with `Path does not exist: <path>`, and when it isn't a Linux tree
(COM-128) with `no <dir>/ under <path> (not a Linux source tree)`. The choice
is confirmed with `Selected: <path>`.

**SETUP-062** When no tree is found and none is configured, the CLI shall
write `No Linux source trees found under ~.`, an empty line, `Tab-complete
available. Path must contain Documentation/devicetree/bindings/ and
include/.`, and ask the line question `Linux source path` of SETUP-061.

### 8.3 Step 2: the base devicetree

**SETUP-070** The CLI shall write `Step 2: Base device tree (context)` and
an empty line, and ask the list question `Choose how to select the base .dts
file`: `Keep <current>` (when one is configured), `Search in the Linux tree`,
`Enter path manually`, and `Export from remote device (coming soon)`, which
can't be picked (shown as `Not yet available`). Enter takes the first.

**SETUP-071** *Search* shall ask the list question `Architecture`: the
architectures of the Linux tree that have `boot/dts/`, sorted. It shall then
write `Scanning <arch>/boot/dts/...`, `Found <n> .dts files.` and an empty
line, and ask the search question of §8.4 over the `.dts` files under it, as
paths relative to it, sorted. When there are no architectures, the CLI shall
write `No architectures with device tree files found.` and `Falling back to
manual path entry.`, and when there are no files `No .dts files found.`, and
go on as *Enter path manually*.

**SETUP-072** *Enter path manually* shall write `Tab-complete available.`
and ask the line question `Path to .dts file` until the answer names an
existing path ending in `.dts`: an empty answer is refused with `Type a
path`, and the others with `Path does not exist: <path>` and `File must have
a .dts extension.`. (Open issue S-2.)

**SETUP-073** A file chosen by *Search* or *Enter path manually* is confirmed
with `Selected: <path>`, `<path>` absolute. *Keep* writes no confirmation.

### 8.4 The `.dts` search

**SETUP-080** The search question `Filter` shall list the files that contain
what is typed, ignoring case, in their order, and the choice `← back to the
architectures`: first while nothing is typed, last once something is. Typing
narrows the list; ↑ and ↓ move the highlight; Enter picks the highlighted
choice.

**SETUP-081** Picking `← back to the architectures` shall ask the
architecture question again (SETUP-071).

### 8.5 Step 3: the workfile

**SETUP-090** The CLI shall write `Step 3: Overlay workfile`, an empty line,
`The workfile is the overlay file your changes are written to.` and an empty
line.

**SETUP-091** When a workfile is configured, whether its file exists or not,
the CLI shall ask the line question `Overlay: [k]eep <path> / [n]ew`, Enter
default `k`. `k` or `keep` (any case) keep it; `n` or `new` go on to
SETUP-092; anything else is refused with `Please enter k to keep it or n for
a new one.`.

**SETUP-092** Otherwise, or after `n`, the CLI shall ask the line question
`Overlay file name`, Enter default the next free name of `init.md` INIT-018.
The answer is a file name relative to the CWD, with `.dtso` appended unless it
already ends with it. When that file exists, the answer is refused with
`<file> already exists; use it with 'config workfile <file>' or pick another
name`, and when its directory doesn't exist with `<directory> is not a
directory`, `<directory>` absolute. The name is only saved (SETUP-030);
`init` creates the file.

## 9. Where the backend is noos

The setup walks the settings in the order they depend on each other:
`capi-path`, `module-paths`, `target` (the board), then the workfile.
A step whose setting is already set is shown and skipped, so a second run
asks only what is still missing.

**SETUP-500** The CLI shall write `analog-attach setup` (bold) and an empty
line, then run the steps of SETUP-510 to SETUP-540 in order.

**SETUP-501** When a step writes a setting, the CLI shall write it to the
`noos` section of the local settings file at once, through the checks of `config` (`config.md`
§4, §9), and write `✓ <key> = <value>` (`<value>` a list joined with `, `).
When a step skips a setting that is set, it shall write `✓ <key>: <value>`.

**SETUP-502** If a write is refused, then the CLI shall refuse with the
refused value's message (COM-041) and stop. The settings written before it
stay.

**SETUP-503** When the user stops a question (Ctrl-C or Ctrl-D), the CLI
shall write `Stopped. What was answered is saved; run analog-attach again to
go on.` to standard output and exit with status 130. The settings already
written stay (open issue S-6).

**SETUP-510** When `capi-path` is set and names a directory with a
`module.yml` (`config.md` CONFIG-503), the CLI shall skip the step.
When it is set and doesn't, the CLI shall write `capi-path is <path>, which
is not a capi checkout.` (yellow) and ask.

**SETUP-511** The CLI shall look for capi checkouts in the CWD, in each
directory above it, and in the home directory, and in their subdirectories
and those subdirectories' `capi/` (hidden ones skipped, symbolic links to
directories followed), nearest first. When it finds any, it shall ask the
list question `Where is capi?`, one choice per checkout and last `Another
folder…`.

**SETUP-512** When it finds none, or after `Another folder…`, the CLI shall
ask the line question `Path to the capi repository`, `~` and relative paths
resolved against the home directory and the CWD. A directory counts as a
capi checkout when its `module.yml` has `name: capi`; any other answer is
refused with `No capi checkout there (looking for a module.yml with name:
capi)`. (Open issue `config.md` CF-12.)

**SETUP-520** When `module-paths` is set and not empty, the CLI shall skip
the step, showing the directories' names joined with `, `.

**SETUP-521** Otherwise the CLI shall look at the directories next to
`capi-path` (its parent's subdirectories) whose `module.yml` has a `type` of
`platform`, `driver_collection`, `utility` or `middleware`. When there are
any, it shall ask the checkbox question `Which module repositories should
rulesets come from?`, one row per directory, `<name>  <type>` (the module's
`name`, else the directory's; `_` in the type written as a space, dimmed),
none checked, and refuse an empty answer. It shall write the checked
directories as `module-paths`.

**SETUP-522** When there are none, the CLI shall write `No module
repositories next to <capi-path>.` (yellow) and `  Set them later:
analog-attach config module-paths <path> <path>...`, and go on.

**SETUP-530** When `target` is set, the CLI shall skip the step. Otherwise,
when the module repositories have boards, it shall ask the list question
`Which board?`, one row per board, `<name>  <chip>  <kinds>`: the chip padded
to nine characters (`?` when the board names none), and the peripheral kinds
its `board.yml` declares joined with `, ` (dimmed; `no board.yml
peripherals` when none), twelve rows at a time. It shall write the board as
`target` (`config.md` CONFIG-505). A chip with no board is set with `config
target <chip>`; the setup offers boards only.

**SETUP-531** When there are no boards, the CLI shall write `No boards in the
configured module repositories.` (yellow; or the scan's error), and `  Set
one later: analog-attach config target <board or chip>`, and skip the workfile step.

**SETUP-540** When a board is set, the CLI shall resolve `workfile`
(`02-common.md` COM-512). When its file exists, the CLI shall write `✓
workfile: <path>` (`<path>` relative to the CWD). Otherwise it shall ask the
confirmation `Create <path> for <board>?` (Enter: yes); after No, it shall
write `  Create it later: analog-attach init` (dimmed).

**SETUP-541** The CLI shall then write an empty line, `Next` (bold), and the
rows `analog-attach list devices` (`what can be added: eval boards,
drivers`), `analog-attach add <eval board>` (`e.g. analog-attach add
eval-adxl355-pmdz`), `analog-attach read` (`what the workfile holds`),
`analog-attach config` (`every setting, and how to change one`) and
`analog-attach --help` (`every command`), each two spaces in, the command
padded to the longest plus two.

**SETUP-542** When the confirmation of SETUP-540 was answered yes (the setup
response is `ready`), the CLI shall then write an empty line and run `init`
(`init.md` INIT-510), and end with its output and exit status. Otherwise it
shall exit with status 0.

**SETUP-543** The setup shall not change the settings of the `Workfile`,
`Project` and `Build` categories, and shall not run `add`.

## 10. Open issues

**S-1. Problems of the settings files go unreported.** With an unknown key
or an invalid value (COM-123, COM-132, COM-133), the setup run says nothing
(SETUP-012): the unknown key stays in the file, and an invalid value has no
Enter default. (The run used to refuse after saving, SETUP-031.)

**S-2. The `.dts` checks differ by path.** `config devicetree` only checks
that the path exists (`config.md` CONFIG-104), the configured value must be a
file with any extension (COM-127), and the manual entry must end in `.dts` but
may be a directory (SETUP-072).

**S-3. A refusal after SETUP-030 doesn't say what was saved,** although
`linux`, `devicetree` and `workfile` were written.

**S-4.** *Fixed.* (The line-based `.dts` filter for runs off a terminal was
dead code; the search question replaced both filters.)

**S-5. The two cancellations are worded differently.** Stopping the backend
question writes `Cancelled.` (SETUP-023), stopping a question of the Linux
steps `Setup cancelled.` (SETUP-054).

**S-6. Stopping the no-OS setup exits 130 after saving.** SETUP-503 exits
with status 130, which COM-060 keeps for a question stopped before anything
was written, although the settings answered before stay written (`✓
capi-path = …` was printed). The Linux setup saves nothing before its last
question. A fix would be to exit 0 once something is saved, as the add
interview does (`add.md` ADD-536).

## 11. Examples

```
$ analog-attach

analog-attach setup
===================

This sets up the workspace: a Linux kernel source tree, a base device tree and the overlay file.

Step 1: Linux kernel source tree
…
Saved linux, devicetree and workfile to .analog-attach/config.json.

Indexing device bindings and compiling binding schemas...                  (stderr)
Indexed 18052 compatibles from 5197 bindings and compiled binding schemas in 1m 14s   (stderr)

Workspace ready

  Linux:       /home/u/linux_rpi
  Devicetree:  /home/u/linux_rpi/arch/arm/boot/dts/broadcom/bcm2711-rpi-4-b.dts
  Overlay:     /work/overlay.dtso (created)

Next steps:

  1. Search for devices to add to the overlay:
     analog-attach list devices [filter]
…
```

In a directory with no settings, the backend comes first:

```
$ analog-attach
? What does this project target?
❯ Linux device tree overlays (linux)
  …
Saved backend = linux to ~/work/.analog-attach/config.json.

analog-attach setup
…
```

```
$ analog-attach < /dev/null
USAGE
  analog-attach config [--global] [--reset] [--reload] [<key>] [<value>...]
…                                                       (stdout, exit 0)
```

Where the backend is noos, a first run (the test fixtures as module
repositories):

```
$ analog-attach
analog-attach setup

? Where is capi?
❯ /home/u/eco/capi
  Another folder…
✓ capi-path = /home/u/eco/capi
? Which module repositories should rulesets come from?
❯◉ adc-drivers-test  driver collection
 ◉ drivers-test      driver collection
 ◉ platform-test     platform
✓ module-paths = /home/u/eco/adc-drivers, /home/u/eco/driver-collection, /home/u/eco/platform
? Which board?
❯ testboard    testsoc    spi, gpio_port, gpio_pin, mystery
  otherboard   othersoc   spi, gpio_port
  twobusboard  othersoc   spi, gpio_port
✓ board = testboard (and platform = testsoc)
? Create workfile.json for testboard? (Y/n) Yes

Next
  analog-attach list devices      what can be added: eval boards, drivers
  analog-attach add <eval board>  e.g. analog-attach add eval-adxl355-pmdz
  analog-attach read              what the workfile holds
  analog-attach config            every setting, and how to change one
  analog-attach --help            every command

Created a workfile for board testboard (platform testsoc)
  /home/u/eco/proj/workfile.json
```

A second run asks nothing:

```
$ analog-attach
analog-attach setup

✓ capi-path: /home/u/eco/capi
✓ module-paths: adc-drivers, driver-collection, platform
✓ board: testboard
✓ workfile: workfile.json

Next
…
```
