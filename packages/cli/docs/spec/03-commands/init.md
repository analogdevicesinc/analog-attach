# init

Creates the overlay workfile of a workspace whose Linux tree and base
devicetree are configured, or keeps the configured one. It never asks. The
setup run only names the workfile; `init` is what creates it.

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
```

Grammar: rule `init` in `01-grammar.abnf`.

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
`add`.

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

**INIT-041** While in human mode, the CLI shall write:

```
Workspace ready

  Linux:       <linux>
  Devicetree:  <devicetree>
  Overlay:     <overlay> (created|kept)

Next steps:

  1. Search for devices to add to the overlay:
     analog-attach list devices [filter]

  2. Add one (it asks for the missing required properties):
     analog-attach add <compatible>

  Run analog-attach config --reload after the bindings of the Linux tree change.

```

In it, `[filter]` and `<compatible>` are literal.

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

None other. (I-1 to I-6 were about the options and the questions; the ones that
still apply are `setup.md` S-1 to S-3. I-7, a bare `analog-attach` with its
output redirected running `init`, was fixed by SETUP-001.)

## 7. Examples

```
$ analog-attach --json init
{"ok":true,"message":"Workspace ready: linux /home/u/linux_adi, devicetree /work/base.dts, overlay /work/overlay.dtso (created)",
 "severity":"info","path":"/work/overlay.dtso","created":true,"linux":"/home/u/linux_adi",
 "devicetree":"/work/base.dts","overlay":"/work/overlay.dtso"}
```

```
$ analog-attach --json init            # linux and devicetree set, workfile not
{"errors":[{"field":"workfile","kind":"missing","message":"Missing config field workfile",
  "description":"Path to the working DTSO overlay file (workfile)"}],
 "hints":["Run 'analog-attach' on a terminal, or 'analog-attach config workfile <name>', then 'analog-attach init', to set up a workspace."]}
                                      (stderr, exit 2)
```

```
$ analog-attach --json init            # workfile = "gone/x.dtso", no gone/
{"ok":false,"message":"Cannot create the workfile: /work/gone is not a directory. Configure another with 'analog-attach config workfile <name>'.",
 "severity":"error"}
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
{"ok":false,"message":"A workfile already exists at /home/u/proj/workfile.json","severity":"error"}
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
