# init

Sets up a workspace: the Linux tree, the base devicetree and the overlay
workfile, and the binding caches.

## 1. Synopsis

```
attach-linux [--json] init [--linux <path>] [--devicetree <path>] [--overlay <name>]
attach-linux
```

Grammar: rule `init` in `01-grammar.abnf`. A bare `attach-linux` is `init`
when standard input is a terminal (GRM-003), even when standard output isn't;
it asks only in a terminal run (COM-012). (Open issue I-7.)

| Option | Meaning | Default |
|---|---|---|
| `--linux <path>` | The Linux source tree. | the configured `linux` |
| `--devicetree <path>` | The base `.dts` file. | the configured `devicetree` |
| `--overlay <name>` | Create a new workfile `<name>.dtso` (`.dtso` added when missing). | keep the configured overlay, or create `overlay.dtso` |

## 2. Terms

| Term | Meaning |
|---|---|
| Plan | The Linux tree, the devicetree and the overlay choice (*keep* a path, or *create* a file name) that `init` sets up. |
| Asking run | A terminal run (COM-012) in human mode in which `--linux` and `--devicetree` aren't both given. |
| Wizard | An asking run with none of the three options. |
| Current settings | The settings of `config.toml`, when it loads without problems (COM-120 to COM-124). |

`init` doesn't use `load_workspace`: it needs no resource, and checks what it
is given itself.

## 3. The configuration

**INIT-010** The CLI shall read `config.toml` before anything else.

**INIT-011** If `config.toml` isn't valid TOML (COM-121), then the CLI shall
write `.attach-linux/config.toml: <parser message>` to standard error and exit
with status 2, in both modes, without asking anything. (Open issue I-2.)

**INIT-012** If `config.toml` is valid TOML but has other problems (COM-122,
COM-123), then the CLI shall go on as if no field were set. (Open issue I-1.)

## 4. The plan, without asking

Applies when the run isn't an asking run: JSON mode, a run that isn't a
terminal run, or both `--linux` and `--devicetree` given.

**INIT-013** If neither `--linux` nor the current settings give a Linux tree,
then the CLI shall write `init needs --linux <path>: no Linux tree is
configured` to standard error and exit with status 2, in both modes. Then,
the same for the devicetree: `init needs --devicetree <path>: no base
devicetree is configured`. In both messages `<path>` is literal.

**INIT-014** The CLI shall check the Linux tree, then the devicetree, then the
overlay, and stop at the first that fails. A path given or configured is
expanded (a leading `~` or `~/` is the home directory) and made absolute
against the CWD.

**INIT-015** If the Linux tree doesn't exist, then the CLI shall refuse
with `linux: Path does not exist: <path>`. If it isn't a Linux tree
(COM-128), then the CLI shall refuse with `linux: no <dir>/ under <path> (not a
Linux source tree)`.

**INIT-016** If the devicetree doesn't exist, then the CLI shall refuse with
`devicetree: Path does not exist: <path>`. If it isn't a file, then the CLI
shall refuse with `devicetree: Not a file: <path>`. Its extension isn't
checked.

**INIT-017** Where `--overlay <name>` is given, the CLI shall plan to create
`<name>`, with `.dtso` appended unless it already ends with it, relative to
the CWD. If that file exists, then the CLI shall refuse with `<file> already
exists; use it with 'config overlay <file>' or pick another name`. If its
directory doesn't exist, then the CLI shall refuse with `<directory> is not a
directory`, `<directory>` absolute. It never overwrites a file.

**INIT-018** Where `--overlay` isn't given, the CLI shall keep the configured
overlay when its file exists, and otherwise plan to create `overlay.dtso`, or
`overlay-<n>.dtso` with the smallest `<n>` from 1 that names no file in the
CWD.

## 5. Carrying out the plan

**INIT-030** The CLI shall first write `linux` and `devicetree` to
`config.toml` (COM-129). In human mode it shall then write `Saved linux and
devicetree to .attach-linux/config.toml.` and an empty line.

**INIT-031** If `config.toml` then fails to load (an unknown key, kept by
COM-129), then the CLI shall refuse with the configuration errors as COM-072
words them, in both modes. (Open issue I-1.)

**INIT-032** When the caches are current for the Linux tree (COM-116), the
CLI shall leave them. Otherwise it shall build them (COM-112 to COM-114).

**INIT-033** If the build can't start or fails, then the CLI shall refuse with
`<reason>`, a newline, and `Fix the problem, then run 'attach-linux config
--reload' to build the binding caches and 'attach-linux init' again.`.
`<reason>` is the configuration errors as COM-072 words them, or
`Compiling binding schemas failed:` followed by a newline and the tool's
error output.

**INIT-034** When the plan creates the overlay, the CLI shall write an empty
overlay (`/dts-v1/;`, `/plugin/;`, an empty root node) to the file and set
`overlay` to its absolute path. When it keeps one, the CLI shall change
neither the file nor the setting.

**INIT-035** The CLI shall carry out INIT-030 to INIT-034 in that order and
stop at the first failure. What was written before the failure stays: a failed
cache build leaves `linux` and `devicetree` saved and creates no workfile.

**INIT-036** `init` shall not change `overlay-syntax`, `preprocess-command` or
the `deploy-*` fields, and shall not run `add`.

## 6. Result

**INIT-040** While in JSON mode, on success the CLI shall respond with an
object conforming to `04-protocol/init.schema.json`:

| Field | Value |
|---|---|
| `message` | `Workspace ready: linux <linux>, devicetree <devicetree>, overlay <overlay> (<created\|kept>)` |
| `linux`, `devicetree`, `overlay` | The absolute paths now configured |
| `created` | `true` when INIT-034 created the workfile |
| `indexed` | `true` when INIT-032 built the caches |

**INIT-041** While in human mode, on success the CLI shall write, after an
empty line when it built the caches:

```
Workspace ready

  Linux:       <linux>
  Devicetree:  <devicetree>
  Overlay:     <overlay> (created|kept)
  Caches:      built now|current

Next steps:

  1. Search for devices to add to the overlay:
     attach-linux list devices [filter]

  2. Add one (it asks for the missing required properties):
     attach-linux add <compatible>

  Run attach-linux config --reload after the bindings of the Linux tree change.

```

In it, `[filter]` and `<compatible>` are literal.

**INIT-042** The CLI shall colour the human output (bold headings, dim
remarks, cyan codes and commands) only when standard output is a terminal.

## 7. Asking

### 7.1 Which questions

**INIT-050** While the run is an asking run, the CLI shall ask for:

- the Linux tree when `--linux` isn't given and either this is the wizard or
  no Linux tree is configured (step 1);
- the devicetree when `--devicetree` isn't given and either this is the wizard
  or none is configured (step 2);
- the overlay when `--overlay` isn't given and either this is the wizard, or
  no configured overlay file exists and step 1 or step 2 was asked (step 3).

A value that isn't asked for comes from the option or the current settings,
checked per INIT-013 to INIT-018.

**INIT-051** Before the first question, the CLI shall write an empty line,
`attach-linux init`, a line of 17 `=`, an empty line, `This sets up the
workspace: a Linux kernel source tree, a base device tree and the overlay
file.` and an empty line. After each step it shall write an empty line.

**INIT-052** In each step, the configured value is the Enter default.

**INIT-053** At the line prompts, Tab shall complete file system paths.

**INIT-054** When a question is stopped (Ctrl-C or Ctrl-D, at a line prompt or
in the live filter), the CLI shall write an empty line and `Setup cancelled.`
to standard output and exit with status 130, without writing anything
(COM-060).

### 7.2 Step 1: the Linux tree

**INIT-060** The CLI shall write `Step 1: Linux kernel source tree`, the
explanation lines, `Searching for Linux source trees under ~...`, and look for
Linux trees (COM-128) under the home directory: breadth first, directory
names in order, skipping hidden directories and `node_modules`, `build`,
`dist`, `venv`, `__pycache__` and the other tool directories, and not looking
inside a tree found. It reads directories down to 4 levels below the home
directory and checks their subdirectories, so a tree is found up to 5 levels
down (`~/a/b/c/d/linux`). Before reading each directory it stops when it has
10 trees or 5 seconds have passed, so the last directory read may take the
count past 10.

**INIT-061** When trees are found or one is configured, the CLI shall list
them as `  <code>) <path>`, the configured one first and marked ` (current)`,
write `Pick one by its letter, or type a path.`, and prompt `Choose [a]: `.
Enter takes `a`. An answer that contains `/` or starts with `~` or `.` is a
path, checked per INIT-015; the problem is written without INIT-015's
`linux: ` prefix (`Path does not exist: <path>`) and the question asked again.
A letter code in range picks. Anything else writes `Please enter a to <last>,
or a path.` and asks again. The choice is confirmed with `Selected:
<path>`.

**INIT-062** When no tree is found and none is configured, the CLI shall
write `No Linux source trees found under ~.` and prompt `Linux source path: `
until it gets a valid tree; an empty answer asks again.

### 7.3 Step 2: the base devicetree

**INIT-070** The CLI shall write `Step 2: Base device tree (context)`,
`Choose how to select the base .dts file:` and the choices: `Keep <current>`
(when one is configured), `Search in the Linux tree`, `Enter path manually`,
`Export from remote device (coming soon)`, lettered from `a`; then prompt
`Choose [a]: `. Enter takes `a`. The last choice writes `Not yet available.
Please choose another option.`, and an answer that picks nothing writes
`Please enter a to <last>.`; both ask again.

**INIT-071** *Search* shall list the architectures of the Linux tree that
have `boot/dts/`, lettered, and prompt `Architecture: `, taking a letter code
or an architecture name (`Please enter a to <last>, or an architecture name.`
otherwise; an empty answer asks again). It shall then write `Scanning
<arch>/boot/dts/...` and `Found <n> .dts files.` and run the live filter
(§7.4) over the `.dts` files under it, as paths relative to it, sorted. When
there are no architectures or no files, the CLI shall say so and fall back to
*Enter path manually*.

**INIT-072** *Enter path manually* shall prompt `Path to .dts file: ` until
the answer names an existing path ending in `.dts`: `Path does not exist:
<path>` and `File must have a .dts extension.` ask again, as does an empty
answer.

**INIT-073** A file chosen by *Search* or *Enter path manually* is confirmed
with `Selected: <path>`, `<path>` absolute. *Keep* writes no confirmation.

### 7.4 The live filter

**INIT-080** The live filter shall show a status line, up to 20 matching
files, and the line `Filter: <query>`. A file matches when it contains the
query, ignoring case. The status is `<n> matches`, `1 match`, `<first>-<last>
of <n> matches` when there are more than 20, or `No file matches "<query>"`.
The highlighted row is marked `>`; the matched text is bold; a row wider than
the terminal less 4 columns is cut with `…`.

**INIT-081** The live filter shall take these keys:

| Key | Effect |
|---|---|
| A printable character | Appended to the query; the highlight goes back to the first match |
| Backspace | Removes the last character of the query; as for a typed character, the highlight goes back to the first match and an earlier ↑ or ↓ no longer counts for Enter |
| Ctrl-U | Clears the query, the same way |
| ↓ / ↑ | Moves the highlight; the list scrolls with it |
| Enter | Picks the highlighted file. With an empty query, only once ↑ or ↓ has been pressed |
| Esc | Back to the architecture question |
| Ctrl-C, Ctrl-D | Cancel (INIT-054) |

### 7.5 Step 3: the overlay

**INIT-090** The CLI shall write `Step 3: Overlay workfile` and `The workfile
is the overlay file your changes are written to.`.

**INIT-091** When the configured overlay file exists, the CLI shall prompt
`Overlay: [k]eep <path> / [n]ew [k]: `. Enter, `k` or `keep` (any case) keep
it; `n` or `new` go on to INIT-092; anything else writes `Please enter k to
keep it or n for a new one.` and asks again.

**INIT-092** Otherwise, or after `n`, the CLI shall prompt `Overlay file name
[<default>]: `, `<default>` being the next free name of INIT-018. Enter takes
it; another answer is a name per INIT-017, whose problem is written and the
question asked again.

## 8. Open issues

**I-1. A config with an unknown key can't be fixed with `init`.** The help
says init is how a workspace gets fixed, but with an unknown key (or any
problem of COM-122, COM-123) `init` ignores every configured value
(INIT-012), so a bare `init --json` says no Linux tree is configured. With
`--linux` and `--devicetree` it saves them and then refuses on the same key
(INIT-031), which COM-129 has kept.

**I-2. A TOML syntax error is plain text in JSON mode.** INIT-011 writes the
human message to standard error, not the object of COM-071 that other
commands give.

**I-3. Input errors differ from the other commands.** In human mode `init`
writes its input errors to standard error with status 2 (INIT-011, INIT-013),
where the other commands write theirs to standard output with status 0
(COM-033).

**I-4. The `.dts` checks differ by path.** `--devicetree` and the configured
value must be files with any extension (INIT-016); the wizard's manual entry
must end in `.dts` but may be a directory (INIT-072).

**I-5. A refusal after INIT-030 doesn't say what was saved.** The response is
`ok: false` although `linux` and `devicetree` were written.

**I-6. Dead code.** The wizard's line-based filter (for a DTS search off a
terminal) can't run: the wizard only runs on a terminal, where the live filter
is used.

**I-7. A bare `attach-linux` with its output redirected runs `init`.** The
entry point checks only standard input (GRM-003), so `attach-linux > log` on a
terminal runs `init` without asking: it saves the configured values again, or
fails with `init needs --linux <path>` in a new directory. With standard input
not a terminal, a bare run prints the usage instead. A fix would be to check
both streams, as COM-012 does.

## 9. Examples

```
$ attach-linux --json init --linux ~/linux_adi --devicetree base.dts
Indexing device bindings and compiling binding schemas...                  (stderr)
Indexed 15401 compatibles from 4434 bindings and compiled binding schemas in 1m 7s   (stderr)
{"ok":true,"message":"Workspace ready: linux /home/u/linux_adi, devicetree /work/base.dts, overlay /work/overlay.dtso (created)",
 "severity":"info","linux":"/home/u/linux_adi","devicetree":"/work/base.dts",
 "overlay":"/work/overlay.dtso","created":true,"indexed":true}
```

```
$ attach-linux --json init
init needs --linux <path>: no Linux tree is configured                     (stderr, exit 2)
```

```
$ attach-linux --json init --overlay mine          # mine.dtso exists
{"ok":false,"message":"mine.dtso already exists; use it with 'config overlay mine.dtso' or pick another name","severity":"error"}
```
