# init

Creates the overlay workfile of a workspace whose Linux tree and base
devicetree are configured, or keeps the configured one, and writes the
starter `aa_build.sh` and `aa_deploy.sh` that `build` and `deploy` run (by
default: `AA_BUILD` and `AA_DEPLOY`, 02-common.md COM-158), or keeps
them, with the project variables a starter it writes uses (§3.2). It never
asks. The setup run only names the workfile; `init` is what creates it.
`init --restore <build|deploy>` writes one starter again.

The workspace itself is set up by the setup run (a bare `analog-attach`,
`setup.md`) or with `config linux <path>`, `config devicetree <path>` and
`config workfile <name>`
(`config.md`). `init` had `--linux`, `--devicetree` and `--overlay`, built
the caches and asked on a terminal; that is gone (an unknown flag,
GRM-004), and the questions are the setup run's. A shared command: §2 to §4
as the linux backend does it, §5 as the noos backend does it.

## 1. Synopsis

```
analog-attach [--json] init
analog-attach [--json] init --restore <build|deploy>     # where the backend is linux
```

Grammar: rule `init` in `01-grammar.abnf`.

| Option (linux) | Meaning |
|---|---|
| `--restore <build\|deploy>` | Write that script's starter (`aa_build.sh` or `aa_deploy.sh`) at the project root, over the file there, set the variables it uses that the project doesn't have (INIT-107), and do nothing else (INIT-104). |

## 2. Resources

**INIT-001** The CLI shall load the workspace with the bindings, the base
and the `workfile` setting (COM-070, 02-common §8.2, §8.4), and when they have
problems, report them per COM-071 or COM-072 and do nothing else. So `linux`,
`devicetree` and `workfile` must be set, the Linux tree must have its binding
caches, and the base must preprocess and parse. The unset fields give the
setup hint of 02-common §8.1, which names the setup run and the `config`
commands of those fields only.

**INIT-002** `init` shall neither read nor check the overlay file, beyond
whether the configured one exists (INIT-018) and can be created (INIT-019).

## 3. The workfile

**INIT-010** to **INIT-017** *Withdrawn.* (Reading `config.toml` itself, the
`--linux`, `--devicetree` and `--overlay` options and their checks. The
configuration requirements are `setup.md` SETUP-010 to SETUP-012 now; the
overlay name check is SETUP-092.)

**INIT-018** When the configured workfile's file exists, the CLI shall keep
it. Otherwise (the setup run or `config workfile` named it, SETUP-030,
`config.md` CONFIG-106) the CLI shall create it at that path. It never picks
another name and never overwrites a file.

**INIT-019** If the configured workfile can't be created, because its path
names something that isn't a file or its directory doesn't exist, then the
CLI shall refuse (COM-040, COM-041) with `Cannot create the workfile:
<problem>. Configure another with 'analog-attach config workfile <name>'.`,
`<problem>`
being `<path> is not a file` or `<directory> is not a directory`, both
absolute.

**INIT-030** to **INIT-033** *Withdrawn.* (Saving `linux` and `devicetree`
and building the caches: `setup.md` SETUP-030 to SETUP-033. `init` builds no
cache.)

**INIT-034** When INIT-018 creates the overlay, the CLI shall write an empty
overlay (`/dts-v1/;`, `/plugin/;`, an empty root node) to the file. It shall
change neither the setting nor, when it keeps one, the file.

**INIT-035** *Withdrawn.* (The order of the steps: `setup.md` SETUP-035.)

**INIT-036** `init` shall change no setting, build no cache, and not run
`add`. The project variables it sets with a starter (INIT-107) are no
setting: they are the starter's.

### 3.1 The scripts

**INIT-100** When INIT-018 has created or kept the workfile, the CLI shall
write, for `aa_build.sh` then `aa_deploy.sh` at the project root (02-common.md
§8.6), the script's starter when no file of that name is there, executable
(mode 0755). The starters are POSIX `sh`: `aa_build.sh` compiles with dtc
(build.md BUILD-034), `aa_deploy.sh` copies to a Raspberry Pi running Kuiper
and reboots it (deploy.md DEPLOY-033).

**INIT-101** When a file of that name is there, the CLI shall keep it as it
is: a script is the user's to edit once written, and `init` never replaces
one.

**INIT-102** If a starter can't be written (a directory of that name, a
folder that can't be written to), then the CLI shall warn `warning: the
starter <script> was not written: <problem>` on standard error and go on;
the workfile is still created or kept, and the response leaves the script
out (INIT-040).

**INIT-103** Each starter shall begin with comments that say what it does
and that it runs while `AA_BUILD` (`AA_DEPLOY`) is its default `./aa_build.sh`
(`./aa_deploy.sh`), with the `config var` command that runs another, the variables it reads (02-common.md COM-153; for `aa_deploy.sh`, `BOARD_IP`,
`BOARD_USER` and the secret `BOARD_PASSWORD`, that `init` sets them to
INIT-107's values, and the `config var` commands that change them), and how
to write it again (`init --restore`).

**INIT-104** With `--restore <script>`, `<script>` `build` or `deploy`, the
CLI shall write that script's starter at the project root, executable,
replacing the file there, set its variables (INIT-107), and do nothing else:
it loads no workspace, so it needs no setting, and it leaves the workfile and
the other script alone.

**INIT-105** If `<script>` is neither, then the CLI shall refuse with
`Unknown script '<script>'. Restore one of: build, deploy`, `error_type`
`unknown-choice`. If the starter can't be written (a directory of that name,
among others), then it shall refuse with `Cannot write the starter <script
file>: <problem>`, `error_type` `write-failed`, `<problem>` `<path> is not a
file` for a directory.

**INIT-106** When `--restore` has written the starter, the CLI shall write
`Wrote the starter <script file>: <path>` in human mode, then a line for each
variable INIT-107 set, as `config var` answers (`config.md` CONFIG-303,
CONFIG-304): `Set variable <NAME> = <value>`, or `Set variable <NAME> as a
secret`. In JSON mode it shall respond `{ "ok": true, "message": "Wrote the
starter <script file>: <path>", "severity": "info", "path": <path>,
"created": <created>, "variables": <set> }`
(`init.schema.json#/$defs/linux-restored`), `created` `false` when it
replaced a file, `<set>` as INIT-110. `<path>` is absolute.

### 3.2 The starters' variables

A starter reads its board from project variables (02-common.md §8.6, COM-154):
`aa_deploy.sh` copies to a Raspberry Pi running Kuiper, whose image has the user
`analog` and the hostname `analog`, which mDNS gives as `analog.local`.
`init` sets them with the starter, so the first `deploy` reaches such a
board as it comes; `config var` changes them for another.

**INIT-107** When INIT-100 or INIT-104 has written a starter, the CLI shall
set, in the order below, each project variable the starter uses that the
project doesn't have (INIT-108), as `config var` stores it (COM-154): for
`aa_build.sh` none; for `aa_deploy.sh`:

| Variable | Set to |
|---|---|
| `BOARD_IP` | `analog.local` (`config var BOARD_IP analog.local`) |
| `BOARD_USER` | `analog` (`config var BOARD_USER analog`) |
| `BOARD_PASSWORD` | a secret, by its name alone (`config var BOARD_PASSWORD --secret`): no value is stored or given (COM-157); `deploy` takes it from its environment or asks for it (deploy.md DEPLOY-040 to DEPLOY-042) |

A script INIT-101 keeps is the user's: the CLI shall set none of its
variables.

**INIT-108** The CLI shall never change a variable the project has: one of
that name, plain or a secret, whatever its value, is kept as it is (a plain
`BOARD_PASSWORD` stays plain).

**INIT-109** If a variable can't be written (the settings file can't be
read or written), then the CLI shall warn `warning: the variable <NAME> of
<script file> was not set: <problem>` on standard error and go on: the
starter is written, the workfile created or kept, and the response leaves
the variable out.

**INIT-110** The CLI shall report the variables INIT-107 set, and only them:
in JSON mode, `variables` on each `scripts` entry (INIT-040) and on the
`--restore` response (INIT-106), in the order set, each `{ "name": <NAME>,
"secret": false, "value": <value> }` or, for a secret, `{ "name": <NAME>,
"secret": true }`; `[]` when none was set. In human mode, INIT-041's
`Variables:` line and INIT-106's lines.

## 4. Result

**INIT-040** While in JSON mode, the CLI shall respond with an object
conforming to `04-protocol/init.schema.json`:

| Field | Value |
|---|---|
| `message` | `Workspace ready: linux <linux>, devicetree <devicetree>, overlay <overlay> (<created\|kept>)` |
| `path` | The workfile's absolute path |
| `created` | `true` when INIT-034 created the workfile |
| `linux`, `devicetree` | The absolute paths configured |
| `overlay` | The same as `path` (deprecated) |
| `scripts` | `aa_build.sh` then `aa_deploy.sh`, each `{ "path": <absolute path>, "created": <true when INIT-100 wrote it>, "variables": <the variables INIT-107 set with it, INIT-110> }`; one INIT-102 couldn't write is left out |

**INIT-041** While in human mode, the CLI shall write:

```
Workspace ready

  Linux:         <linux>
  Devicetree:    <devicetree>
  Overlay:       <overlay> (created|kept)
  aa_build.sh:   <path> (created|kept)
  aa_deploy.sh:  <path> (created|kept)
  Variables:     <NAME> = <value>, …, <NAME> as a secret (set now)

Next steps:

  1. Search for devices to add to the overlay:
     analog-attach list devices [filter]

  2. Add one (it asks for the missing required properties):
     analog-attach add <compatible>

  Run analog-attach config --reload after the bindings of the Linux tree change.
  Change a variable with analog-attach config var <NAME> <value>.

```

In it, `[filter]`, `<compatible>`, `<NAME>` and `<value>` of the last line
are literal. A script INIT-102 couldn't write has no line. The `Variables:`
line names the variables INIT-107 set, in the order set, a plain one `<NAME>
= <value>`, a secret `<NAME> as a secret`, joined with `, `; it and the last
line are there only when one was set.

**INIT-042** The CLI shall colour the human output (bold headings, dim
remarks, cyan codes and commands) only when standard output is a terminal.

**INIT-050** to **INIT-092** *Withdrawn.* (The questions: `setup.md`
SETUP-050 to SETUP-092, same numbers.)

## 5. Where the backend is noos

`init` creates the workfile for the configured target. It never keeps an
existing one: a workfile is the user's design, and an empty one would
replace it.

**INIT-500** The CLI shall resolve `workfile` (`02-common.md` COM-512). It
needs no workfile and, unless the target needs them, no other resource.

**INIT-502** If the workfile's file exists, then the CLI shall refuse with
`A workfile already exists at <path>` (JSON), or in human mode the lines `A
workfile already exists at <path>.` and `Delete it, or point the 'workfile'
setting somewhere else.`. The file is left as it is.

**INIT-509** If `capi-path` is not set, then the CLI shall refuse, before
looking at the target, with `Setting "capi-path" is not configured. Run:
analog-attach config capi-path <value>, or analog-attach for the guided
setup`: without it there are no boards or chips to find.

**INIT-503** The target shall be the `target` setting: when it names a
board, that board, with the chip it carries as the platform; when it names a
chip, that chip, with no board.

**INIT-504** If `target` is not set, then the CLI shall refuse with `No
target configured. Run: analog-attach config target <board or chip>, or
analog-attach for the guided setup` (JSON). In human mode it shall write
instead `No target configured.`, an empty line, the four rows
`analog-attach config target <board>` (`a board brings its chip`),
`analog-attach config target <chip>` (`for a chip with no board of its
own`), `analog-attach list context` (`the boards and chips there are`) and
`analog-attach` (`the guided setup, which asks for what is missing`), each
two spaces in, then an empty line,
`Available chips:`, an empty line, and for each chip of the module
repositories its name two spaces in, its platform module and CPU (`<module>,
<cpu>`, wrapped at 76 characters) six spaces in, and an empty line. When the
chips can't be listed, their error replaces `Available chips:` and the list.
(Open issue I-8.)

**INIT-505** If `target` names neither a board nor a chip of the module
repositories, then the CLI shall refuse with `Unknown target '<target>'. It
can be a board or a chip: <names>`, the boards then the chips joined with
`, ` (`config.md` CONFIG-501).

(INIT-506, a `board` that carries another chip than `platform`, is
withdrawn: one setting can't disagree with itself.)

**INIT-507** The CLI shall create the workfile's directory when it doesn't
exist, and write the workfile `{ "platform": "<chip>", "board": "<board>",
"symbols": {} }` (no `board` for a platform target), indented by two spaces
(`02-common.md` COM-513).

**INIT-508** `init` shall change no setting and not run `add`.

**INIT-510** When it created the workfile, the CLI shall answer `Created a
workfile for board <board> (platform <chip>)`, or `Created a workfile for
platform <chip>`: in JSON mode with `path` (absolute) and `created` `true`
(`init.schema.json#/$defs/noos`), in human mode as that line and the path two
spaces in.

## 6. Open issues

**I-8. The no-target refusal can list no chips under its heading.** With no
module repositories that define chips, the human text of INIT-504 ends with
`Available chips:` and nothing after it. A fix would be to say that no
module repository defines a chip and point at `config module-paths`.

**I-9. An invalid variable of a starter's is replaced.** INIT-108 keeps the
variables the project has, which are the valid ones: an entry of that name
the settings file has but reading leaves out (COM-155: an empty value, `{
"secret": false }`) is written over with INIT-107's. Reading reports it, so
it is seen, but it isn't kept as the user wrote it.

None other. (I-1 to I-6 were about the options and the questions; the ones that
still apply are `setup.md` S-1 and S-2. I-7, a bare `analog-attach` with its
output redirected running `init`, was fixed by SETUP-001.)

## 7. Examples

```
$ analog-attach --json init
{"ok":true,"message":"Workspace ready: linux /home/u/linux_adi, devicetree /work/base.dts, overlay /work/overlay.dtso (created)",
 "severity":"info","path":"/work/overlay.dtso","created":true,"linux":"/home/u/linux_adi",
 "devicetree":"/work/base.dts","overlay":"/work/overlay.dtso",
 "scripts":[{"path":"/work/aa_build.sh","created":true,"variables":[]},
  {"path":"/work/aa_deploy.sh","created":true,"variables":[{"name":"BOARD_IP","secret":false,"value":"analog.local"},
   {"name":"BOARD_USER","secret":false,"value":"analog"},{"name":"BOARD_PASSWORD","secret":true}]}]}
```

```
$ analog-attach init                     # a new project
Workspace ready

  Linux:         /home/u/linux_adi
  Devicetree:    /work/base.dts
  Overlay:       /work/overlay.dtso (created)
  aa_build.sh:   /work/aa_build.sh (created)
  aa_deploy.sh:  /work/aa_deploy.sh (created)
  Variables:     BOARD_IP = analog.local, BOARD_USER = analog, BOARD_PASSWORD as a secret (set now)

Next steps:
…
  Run analog-attach config --reload after the bindings of the Linux tree change.
  Change a variable with analog-attach config var <NAME> <value>.
```

```
$ analog-attach config var BOARD_IP 192.168.2.10
Set variable BOARD_IP = 192.168.2.10
$ analog-attach config var BOARD_USER --reset
Reset variable BOARD_USER (not set)
$ analog-attach init --restore deploy
Wrote the starter aa_deploy.sh: /work/aa_deploy.sh
Set variable BOARD_USER = analog
$ analog-attach --json init --restore deploy
{"ok":true,"message":"Wrote the starter aa_deploy.sh: /work/aa_deploy.sh","severity":"info","path":"/work/aa_deploy.sh","created":false,"variables":[]}
$ analog-attach --json init --restore all
{"ok":false,"message":"Unknown script 'all'. Restore one of: build, deploy","severity":"error","error_type":"unknown-choice"}
```

```
$ analog-attach --json init            # linux and devicetree set, workfile not
{"ok":false,"message":"Missing config field workfile","severity":"error","error_type":"missing-setting",
 "errors":[{"field":"workfile","kind":"missing","error_type":"missing-setting","message":"Missing config field workfile",
  "description":"Path to the working DTSO overlay file (workfile)"}],
 "hints":["Run 'analog-attach' on a terminal, or 'analog-attach config workfile <name>', then 'analog-attach init', to set up a workspace."]}
```

```
$ analog-attach --json init            # workfile = "gone/x.dtso", no gone/
{"ok":false,"message":"Cannot create the workfile: /work/gone is not a directory. Configure another with 'analog-attach config workfile <name>'.",
 "severity":"error","error_type":"write-failed"}
```

```
$ analog-attach init --linux ~/linux
No flag registered for --linux                           (stderr, exit 2)
```

Where the backend is noos:

```
$ analog-attach init
Created a workfile for board testboard (platform testsoc)
  /home/u/proj/workfile.json
$ analog-attach --json init
{"ok":false,"message":"A workfile already exists at /home/u/proj/workfile.json","severity":"error","error_type":"workfile-exists"}
```

```
$ analog-attach init            # target not set
No target configured.

  analog-attach config target <board>    a board brings its chip
  analog-attach config target <chip>     for a chip with no board of its own
  analog-attach list context             the boards and chips there are
  analog-attach                          the guided setup, which asks for what is missing

Available chips:

  testsoc
      platform-test, cortex-m4

  othersoc
      platform-test, cortex-m4

  boardless
      platform-test, cortex-m0
```
