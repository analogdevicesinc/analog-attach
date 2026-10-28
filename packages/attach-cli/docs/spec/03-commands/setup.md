# The setup run

A bare `attach-linux` on a terminal sets up a workspace: it asks for the Linux
tree, the base devicetree and the overlay workfile, saves them and builds the
binding caches. It names the workfile but doesn't create it: `init` does
(`init.md` INIT-018). It isn't a command: it has no name, no options and no
JSON mode.

Its questions used to be `init`'s. They keep their numbers here: `INIT-0nn`
is `SETUP-0nn` for the requirements of §3 to §7.

## 1. Synopsis

```
attach-linux
```

Grammar: an empty `command-line` in `01-grammar.abnf` (GRM-003, GRM-005).

## 2. Terms

| Term | Meaning |
|---|---|
| Plan | The Linux tree, the devicetree and the overlay choice (*keep* the configured path, or a new file name) that the setup run sets up. |
| Current settings | The settings of `config.toml`, when it loads without problems (COM-120 to COM-124). |

The setup run doesn't use `load_workspace`: it needs no resource, and checks
the answers itself.

## 3. When it runs

**SETUP-001** While in human mode, when argv is empty and the run is a
terminal run (COM-012), the CLI shall run the setup run.

**SETUP-002** When argv is empty in a run that isn't a terminal run, or argv
is the one element `--quiet`, the CLI shall write the usage as GRM-005 says,
and ask nothing.

## 4. The configuration

**SETUP-010** The CLI shall read `config.toml` before anything else.

**SETUP-011** If `config.toml` isn't valid TOML (COM-121), then the CLI shall
write `.attach-linux/config.toml: <parser message>` to standard error and exit
with status 2, without asking anything.

**SETUP-012** If `config.toml` is valid TOML but has other problems (COM-122,
COM-123), then the CLI shall go on as if no field were set. (Open issue S-1.)

## 5. Carrying out the plan

**SETUP-030** The CLI shall first write `linux`, `devicetree` and `overlay`
to `config.toml` (COM-129), `overlay` being the kept path or the new file name
made absolute against the CWD, then write `Saved linux, devicetree and overlay
to .attach-linux/config.toml.` and an empty line.

**SETUP-031** If `config.toml` then fails to load (an unknown key, kept by
COM-129), then the CLI shall refuse with the configuration errors as COM-072
words them. (Open issue S-1.)

**SETUP-032** When the caches are current for the Linux tree (COM-116), the
CLI shall leave them. Otherwise it shall build them (COM-112 to COM-114).

**SETUP-033** If the build can't start or fails, then the CLI shall refuse
with `<reason>`, a newline, and `Fix the problem, then run 'attach-linux
config --reload' to build the binding caches and 'attach-linux init' to create
the workfile.`. `<reason>` is the configuration errors as COM-072 words them,
or `Compiling binding schemas failed:` followed by a newline and the tool's
error output.

**SETUP-034** The setup run shall create no overlay file, and change no
file the configured overlay names. (`config overlay <name>` names one the same
way, `config.md` CONFIG-106.)

**SETUP-035** The CLI shall carry out SETUP-030 to SETUP-033 in that order
and stop at the first failure. What was written before the failure stays: a
failed cache build leaves `linux`, `devicetree` and `overlay` saved. (Open
issue S-3.)

**SETUP-036** The setup run shall not change `overlay-syntax`,
`preprocess-command` or the `deploy-*` fields, and shall not run `init` or
`add`.

## 6. Result

**SETUP-041** On success the CLI shall write, after an empty line when it
built the caches, `init`'s summary (`init.md` INIT-041) with the line
`  Caches:      built now|current` after the `Overlay:` line, and an empty
line. When the overlay's file exists, the `Overlay:` line ends in `(kept)`.
When it doesn't, the heading is `Workspace configured` instead of `Workspace
ready`, the `Overlay:` line ends in `(not created yet)`, and the next steps
start with `  1. Create the workfile:` and `     attach-linux init`, the other
two steps numbered 2 and 3.

**SETUP-042** The CLI shall colour its output (bold headings, dim remarks,
cyan codes and commands) only when standard output is a terminal.

## 7. Asking

### 7.1 The questions

**SETUP-050** The CLI shall ask for the Linux tree (step 1), the devicetree
(step 2) and the overlay (step 3), in that order.

**SETUP-051** Before the first question, the CLI shall write an empty line,
`attach-linux setup`, a line of 18 `=`, an empty line, `This sets up the
workspace: a Linux kernel source tree, a base device tree and the overlay
file.` and an empty line. After each step it shall write an empty line.

**SETUP-052** In each step, the configured value is the Enter default.

**SETUP-053** At the line prompts, Tab shall complete file system paths.

**SETUP-054** When a question is stopped (Ctrl-C or Ctrl-D, at a line prompt
or in the live filter), the CLI shall write an empty line and `Setup
cancelled.` to standard output and exit with status 130, without writing
anything (COM-060).

### 7.2 Step 1: the Linux tree

**SETUP-060** The CLI shall write `Step 1: Linux kernel source tree`, the
explanation lines, `Searching for Linux source trees under ~...`, and look for
Linux trees (COM-128) under the home directory: breadth first, directory
names in order, skipping hidden directories and `node_modules`, `build`,
`dist`, `venv`, `__pycache__` and the other tool directories, and not looking
inside a tree found. It reads directories down to 4 levels below the home
directory and checks their subdirectories, so a tree is found up to 5 levels
down (`~/a/b/c/d/linux`). Before reading each directory it stops when it has
10 trees or 5 seconds have passed, so the last directory read may take the
count past 10.

**SETUP-061** When trees are found or one is configured, the CLI shall list
them as `  <code>) <path>`, the configured one first and marked ` (current)`,
write `Pick one by its letter, or type a path.`, and prompt `Choose [a]: `.
Enter takes `a`. An answer that contains `/` or starts with `~` or `.` is a
path, expanded (a leading `~` or `~/` is the home directory) and made absolute
against the CWD. When it doesn't exist the CLI shall write `Path does not
exist: <path>`, and when it isn't a Linux tree (COM-128) `no <dir>/ under
<path> (not a Linux source tree)`, and ask again. A letter code in range
picks. Anything else writes `Please enter a to <last>, or a path.` and asks
again. The choice is confirmed with `Selected: <path>`.

**SETUP-062** When no tree is found and none is configured, the CLI shall
write `No Linux source trees found under ~.` and prompt `Linux source path: `
until it gets a valid tree; an empty answer asks again.

### 7.3 Step 2: the base devicetree

**SETUP-070** The CLI shall write `Step 2: Base device tree (context)`,
`Choose how to select the base .dts file:` and the choices: `Keep <current>`
(when one is configured), `Search in the Linux tree`, `Enter path manually`,
`Export from remote device (coming soon)`, lettered from `a`; then prompt
`Choose [a]: `. Enter takes `a`. The last choice writes `Not yet available.
Please choose another option.`, and an answer that picks nothing writes
`Please enter a to <last>.`; both ask again.

**SETUP-071** *Search* shall list the architectures of the Linux tree that
have `boot/dts/`, lettered, and prompt `Architecture: `, taking a letter code
or an architecture name (`Please enter a to <last>, or an architecture name.`
otherwise; an empty answer asks again). It shall then write `Scanning
<arch>/boot/dts/...` and `Found <n> .dts files.` and run the live filter
(§7.4) over the `.dts` files under it, as paths relative to it, sorted. When
there are no architectures or no files, the CLI shall say so and fall back to
*Enter path manually*.

**SETUP-072** *Enter path manually* shall prompt `Path to .dts file: ` until
the answer names an existing path ending in `.dts`: `Path does not exist:
<path>` and `File must have a .dts extension.` ask again, as does an empty
answer. (Open issue S-2.)

**SETUP-073** A file chosen by *Search* or *Enter path manually* is confirmed
with `Selected: <path>`, `<path>` absolute. *Keep* writes no confirmation.

### 7.4 The live filter

**SETUP-080** The live filter shall show a status line, up to 20 matching
files, and the line `Filter: <query>`. A file matches when it contains the
query, ignoring case. The status is `<n> matches`, `1 match`, `<first>-<last>
of <n> matches` when there are more than 20, or `No file matches "<query>"`.
The highlighted row is marked `>`; the matched text is bold; a row wider than
the terminal less 4 columns is cut with `…`.

**SETUP-081** The live filter shall take these keys:

| Key | Effect |
|---|---|
| A printable character | Appended to the query; the highlight goes back to the first match |
| Backspace | Removes the last character of the query; as for a typed character, the highlight goes back to the first match and an earlier ↑ or ↓ no longer counts for Enter |
| Ctrl-U | Clears the query, the same way |
| ↓ / ↑ | Moves the highlight; the list scrolls with it |
| Enter | Picks the highlighted file. With an empty query, only once ↑ or ↓ has been pressed |
| Esc | Back to the architecture question |
| Ctrl-C, Ctrl-D | Cancel (SETUP-054) |

### 7.5 Step 3: the overlay

**SETUP-090** The CLI shall write `Step 3: Overlay workfile` and `The workfile
is the overlay file your changes are written to.`.

**SETUP-091** When an overlay is configured, whether its file exists or not,
the CLI shall prompt
`Overlay: [k]eep <path> / [n]ew [k]: `. Enter, `k` or `keep` (any case) keep
it; `n` or `new` go on to SETUP-092; anything else writes `Please enter k to
keep it or n for a new one.` and asks again.

**SETUP-092** Otherwise, or after `n`, the CLI shall prompt `Overlay file name
[<default>]: `, `<default>` being the next free name of `init.md` INIT-018.
Enter takes it. Another answer is a file name relative to the CWD, with
`.dtso` appended unless it already ends with it. When that file exists, the
CLI shall write `<file> already exists; use it with 'config overlay <file>' or
pick another name`, and when its directory doesn't exist `<directory> is not a
directory`, `<directory>` absolute, and ask again. The name is only saved
(SETUP-030); `init` creates the file.

## 8. Open issues

**S-1. A config with an unknown key can't be fixed with the setup run.** With
an unknown key (or any problem of COM-122, COM-123) the setup run ignores
every configured value (SETUP-012), so no answer has a default. It then saves
`linux` and `devicetree` and refuses on the same key (SETUP-031), which
COM-129 has kept.

**S-2. The `.dts` checks differ by path.** `config devicetree` only checks
that the path exists (`config.md` CONFIG-104), the configured value must be a
file with any extension (COM-127), and the manual entry must end in `.dts` but
may be a directory (SETUP-072).

**S-3. A refusal after SETUP-030 doesn't say what was saved,** although
`linux`, `devicetree` and `overlay` were written.

**S-4. Dead code.** The line-based filter (for a DTS search off a terminal)
can't run: the setup run only runs on a terminal, where the live filter is
used.

## 9. Examples

```
$ attach-linux

attach-linux setup
==================

This sets up the workspace: a Linux kernel source tree, a base device tree and the overlay file.

Step 1: Linux kernel source tree
…
Saved linux, devicetree and overlay to .attach-linux/config.toml.

Indexing device bindings and compiling binding schemas...                  (stderr)
Indexed 15401 compatibles from 4434 bindings and compiled binding schemas in 1m 7s   (stderr)

Workspace configured

  Linux:       /home/u/linux_adi
  Devicetree:  /home/u/linux_adi/arch/arm/boot/dts/broadcom/bcm2711-rpi-4-b.dts
  Overlay:     /work/overlay.dtso (not created yet)
  Caches:      built now

Next steps:

  1. Create the workfile:
     attach-linux init
…
```

```
$ attach-linux < /dev/null
Usage: attach-linux [command] [options]
…                                                       (stderr, exit 1)
```
