# init

Creates the overlay workfile of a workspace whose Linux tree and base
devicetree are configured, or keeps the configured one. It never asks. The
setup run only names the workfile; `init` is what creates it.

The workspace itself is set up by the setup run (a bare `attach-linux`,
`setup.md`) or with `config linux <path>`, `config devicetree <path>` and
`config overlay <name>`
(`config.md`). `init` had `--linux`, `--devicetree` and `--overlay`, built
the caches and asked on a terminal; that is gone (an unknown option,
GRM-004), and the questions are the setup run's.

## 1. Synopsis

```
attach-linux [--json] init
```

Grammar: rule `init` in `01-grammar.abnf`.

## 2. Resources

**INIT-001** The CLI shall load the workspace with the bindings, the base
and the `overlay` setting (COM-070, 02-common §8.2, §8.4), and when they have
problems, report them per COM-071 or COM-072 and do nothing else. So `linux`,
`devicetree` and `overlay` must be set, the Linux tree must have its binding
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

**INIT-018** When the configured overlay's file exists, the CLI shall keep
it. Otherwise (the setup run or `config overlay` named it, SETUP-030,
`config.md` CONFIG-106) the CLI shall create it at that path. It never picks
another name and never overwrites a file.

**INIT-019** If the configured overlay can't be created, because its path
names something that isn't a file or its directory doesn't exist, then the
CLI shall refuse (COM-040, COM-041) with `Cannot create the workfile:
<problem>. Configure another with 'attach-linux config overlay <name>'.`,
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
| `linux`, `devicetree`, `overlay` | The absolute paths configured |
| `created` | `true` when INIT-034 created the workfile |

**INIT-041** While in human mode, the CLI shall write:

```
Workspace ready

  Linux:       <linux>
  Devicetree:  <devicetree>
  Overlay:     <overlay> (created|kept)

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

**INIT-050** to **INIT-092** *Withdrawn.* (The questions: `setup.md`
SETUP-050 to SETUP-092, same numbers.)

## 5. Open issues

None. (I-1 to I-6 were about the options and the questions; the ones that
still apply are `setup.md` S-1 to S-4. I-7, a bare `attach-linux` with its
output redirected running `init`, was fixed by SETUP-001.)

## 6. Examples

```
$ attach-linux --json init
{"ok":true,"message":"Workspace ready: linux /home/u/linux_adi, devicetree /work/base.dts, overlay /work/overlay.dtso (created)",
 "severity":"info","linux":"/home/u/linux_adi","devicetree":"/work/base.dts",
 "overlay":"/work/overlay.dtso","created":true}
```

```
$ attach-linux --json init            # linux and devicetree set, overlay not
{"errors":[{"field":"overlay","kind":"missing","message":"Missing config field overlay",
  "description":"Path to the working DTSO overlay file (workfile)"}],
 "hints":["Run 'attach-linux' on a terminal, or 'attach-linux config overlay <name>', then 'attach-linux init', to set up a workspace."]}
                                      (stderr, exit 2)
```

```
$ attach-linux --json init            # overlay = "gone/x.dtso", no gone/
{"ok":false,"message":"Cannot create the workfile: /work/gone is not a directory. Configure another with 'attach-linux config overlay <name>'.",
 "severity":"error"}
```

```
$ attach-linux init --linux ~/linux
error: unknown option '--linux'                          (stderr, exit 1)
```
