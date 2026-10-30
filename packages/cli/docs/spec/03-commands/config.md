# config

Shows the settings and their values, sets or resets one, or rebuilds the
backend's caches. `config` is the front end's: it works with no backend set
(COM-013), and the settings it knows are `backend` and those of the
backend's section of the settings files (`02-common.md` §8.1, COM-131). Where the backend is linux, setting `linux` also
builds the binding caches. Where the backend is noos, writing a setting
checks it against the checkouts on disk, and setting `board` or `platform`
can write the other (§9).

`config` replaces `config-get` and `config-set`, which are gone (an unknown
command: GRM-004). Their requirements keep their numbers here:
`CONFIGGET-0nn` is `CONFIG-0nn` and `CONFIGSET-0nn` is `CONFIG-1nn`. The
`CONFIG-2nn` block is `--reset`, and `CONFIG-14n` is `--global`.

## 1. Synopsis

```
analog-attach [--json] config [<key>]
analog-attach [--json] config <key> <value>... [--global]
analog-attach [--json] config <key> --reset [--global]
analog-attach [--json] config --reload
```

Grammar: rule `config` in `01-grammar.abnf`.

| Argument | Meaning | Default |
|---|---|---|
| `<key>` | A setting: `backend`, or one of the backend's (in its section, COM-131). | none: every setting (§3) |
| `<value>` | The value to set (§4); several only for a `path_list`. | none: show the setting |
| `--global` | Set or reset in the global settings file instead of the local one (§8). | off |
| `--reset` | Remove `<key>` from the settings file (§6). | off |
| `--reload` | Rebuild the backend's caches (§7). | off |

## 2. Choosing what to do

The checks apply in this order; the first that matches decides. Each is an
input error (COM-031).

**CONFIG-001** If `--reload` is given with `<key>`, `--reset` or `--global`,
then the CLI shall report `--reload rebuilds the caches and takes no other
argument`. (Was CONFIGGET-020.)

**CONFIG-002** If `--reset` is given without `<key>`, then the CLI shall
report `--reset needs a key: analog-attach config <key> --reset`, where
`<key>` is literal. If `--global` is given without `<key>`, then the CLI shall
report `--global needs a key: analog-attach config <key> <value> --global`.

**CONFIG-101** If `<key>` is neither `backend` nor one of the backend's
settings, then the CLI shall report `Unknown config field: <key>. Valid
fields: <keys>.`, `<keys>` being `backend` and the backend's keys in order,
joined with `, `, whatever else is given. With no backend set, `<keys>` is
`backend` and the message ends with ` Choose a backend first: 'analog-attach
config backend <ids>'.` (COM-014's `<ids>`).

**CONFIG-003** If `--reset` is given with `<value>`, then the CLI shall
report `--reset takes no value`.

**CONFIG-141** If `--global` is given with `<key>` and neither `<value>` nor
`--reset`, then the CLI shall report `--global applies when setting or
resetting: analog-attach config <key> <value> --global`, `<value>` literal.

**CONFIG-004** The CLI shall then show every setting when neither `<key>` nor
an option is given (§3), show `<key>` when it is given alone (§3), set it
when `<value>` is given (§4, §5), reset it with `--reset` (§6), and rebuild
the caches with `--reload` (§7).

## 3. Showing settings

**CONFIG-005** When showing, the CLI shall read both settings files and,
when they have problems (COM-121 to COM-123, COM-132 to COM-134), report
them as an input error:
in human mode COM-072's text, in JSON mode an object conforming to
`config-error.schema.json` (each error with its `hint`), on standard error
with status 2, and do nothing else. It needs no other resource: an unset or
wrong path is shown, not reported. A section other than the active one is
not read (COM-135), so its keys are no problem. (Was CONFIGGET-001.)

**CONFIG-010** Without `<key>`, the CLI shall show every setting: `backend`,
then the backend's, in the order of the tables in `02-common.md` §8.1, their
values from the active section (COM-124); another backend's section is not
shown. With no backend set, that is `backend` alone. With `<key>`, it shall
show that setting only.

**CONFIG-011** *Withdrawn.* (`config-get` ignored a name that wasn't a field;
`config` refuses it, CONFIG-101.)

**CONFIG-012** A setting's value is its effective value (COM-124): a path
absolute (COM-125), a setting that is set in neither file its default, and a
setting with neither unset. Its source is `local`, `global`, `default` or
`unset`. The CLI shall show `deploy-password` as it is stored. (Open issue
CF-2.)

**CONFIG-013** While in human mode, when showing one setting, the CLI shall
write:

```
<key>[ [required]]: <shown value>
  <description>[ [<option> | <option>]]
```

`<shown value>` is `(not set)` for an unset setting, and otherwise the value
followed by ` (default)`, ` (local)` or ` (global)`, its source. A
`path_list` is its paths joined with `, `. The options follow the description
for a setting that has them (`backend`, `overlay-syntax`; where the backend
is noos, the booleans, `probe`, and `board` and `platform` as scanned,
CONFIG-510). When the setting
is required and unset, an empty line and its hint follow.

**CONFIG-016** While in human mode, when showing every setting, the CLI
shall write `Local:  <file>` and `Global: <file>` (the settings files, the
home directory written `~`), an empty line, then for each category in order
(`General` for `backend`; where the backend is linux, `Workspace` and
`Deploy`; where it is noos, `Sources`, `Target`, `Workfile`, `Project` and
`Build`) the line `  <category>` and one line per setting: two spaces, `*`
for a required setting or a space, a space, the key padded to the longest
key plus two, the shown value (`(not set)` when unset) padded to the longest
value plus two, and its source (none when unset), trailing spaces removed.
Categories are separated by an empty line. When a setting is required, the
CLI shall then write an empty line and `  * required`.

**CONFIG-014** While in human mode, when a setting shown is required and
unset, the CLI shall then write an empty line and its hint, one line per
distinct hint: for `backend`, `Run 'analog-attach' on a terminal, or
'analog-attach config backend <ids>'.`; for the backend's, the setting's hint
(`02-common.md` §8.1). The setup hints of several settings are not merged.
(Open issue CF-9.)

**CONFIG-015** While in JSON mode, the CLI shall respond with an object
conforming to `config.schema.json#/$defs/fields`: `message` `<n> config
field(s)`, `<n>` the number of settings shown, and `configs`, one entry per
setting:

| Field | Value |
|---|---|
| `field_name` | The key |
| `category` | As in CONFIG-016 |
| `description` | As in the tables of §8.1 |
| `type` | `"path"`, `"path_list"`, `"string"`, `"numeric"`, `"bool"`, or `{ "options": [...] }` |
| `required` | As in the tables of §8.1 |
| `default` | The default, or `null` |
| `value` | The value of CONFIG-012 (an array for a `path_list`), or `null` when unset |
| `source` | As in CONFIG-012 |

## 4. Setting a field

`config <key> <value>` writes the local settings file, or the global one
with `--global` (§8): `backend` at the top level, the backend's settings in
its section (COM-129). It doesn't use workspace loading (COM-070): it is how
a broken configuration gets fixed, so problems of COM-123, COM-132 and
COM-133 in the files don't stop it.

The checks apply in this order; the first that fails is an input error
(COM-031) and nothing is written. A refused value is written as
`<problem> — <description>`, followed by an empty line and the setting's hint
when it has one.

**CONFIG-102** If the file to write can't be read or isn't a JSON object
(COM-121), or the setting is the backend's and the file's active section
isn't an object (COM-134), then the CLI shall report its message as a
refused value: `<file>: <id>: must be an object — <description>`. (Open
issue CF-4.)

**CONFIG-107** If the setting isn't a `path_list` and more than one
`<value>` is given, then the CLI shall report `<key> takes one value; got
<n>`.

**CONFIG-103** The CLI shall check `<value>` as reading would check it
(COM-123): `<key>: must not be empty`, `<key>: "<value>" is not one of <a> |
<b>`, and for `--global` a relative path, `<key>: "<value>" is relative; a
global path must be absolute or start with ~`. If that fails, then the CLI
shall report the problem as a refused value: `overlay-syntax: "xml" is not
one of fragment | label — Output syntax for the overlay file: fragment
(default) or label (&spi0 { … })`.

**CONFIG-104** Where the backend is linux, if the setting is `linux` or
`devicetree` and `<value>`, resolved against the CWD, names nothing, then the
CLI shall report the refused value `<key>: <absolute path> does not exist`.
Whether it is a file or a directory isn't checked here. (Open issue CF-5.)

**CONFIG-106** Where the backend is linux, the setting `workfile` may name a
file that doesn't exist yet, which `init` creates (`init.md` INIT-018):
`<value>` is a path, or a file name in the CWD (it is resolved against the CWD
either way). If it names nothing and its directory doesn't exist, then the
CLI shall report the refused value `workfile: <absolute directory> is not a
directory`.

**CONFIG-105** Where the backend is linux, if the setting is `linux` and the
directory isn't a Linux tree (COM-128), then the CLI shall report the refused
value `linux: no <dir>/ under <path> (not a Linux source tree)`.

A path that starts with `~` is stored as typed, in either file, and
expanded when read (COM-125); any other local path is stored absolute.

**CONFIG-110** The CLI shall write the setting (COM-129), a local path made
absolute unless it starts with `~`, and keep the other keys and the other
sections.

**CONFIG-112** When the setting is `backend`, the CLI shall write it at the
top level and leave every section as it is (COM-135). The settings of the
backend it names are then those its section holds: none for a backend that
was never configured here, the earlier ones for a backend switched back to.

**CONFIG-111** The CLI shall then answer `Set <key> = <value>`, `<value>` as
given (not made absolute; several joined with `, `), followed by ` (global)`
with `--global`. Where the backend is linux, for a `workfile` that names
nothing the answer is `Set workfile = <absolute path> (not created yet:
'analog-attach init' creates it)`. (Open issue CF-7.)

## 5. Setting `linux`

Where the backend is linux:

**CONFIG-120** After writing `linux`, the CLI shall read the settings again
and build the caches (COM-112 to COM-114), even when they are current.

**CONFIG-121** When the build succeeds, the CLI shall answer `Set linux =
<path>[ (global)]; <summary>`, `<path>` the effective value (absolute) and
`<summary>` the summary line of COM-112.

**CONFIG-122** If the build can't start (COM-114), then the CLI shall refuse
with `Set linux = <path>, but the binding caches were not built:`, a newline,
and the problems as COM-072 words them.

**CONFIG-123** If compiling the schemas fails, then the CLI shall refuse
with `Set linux = <path>, but Compiling binding schemas failed:`, a newline,
the tool's error output, a newline, and `Fix the bindings and run
'analog-attach config --reload'.`

**CONFIG-124** In both cases of CONFIG-122 and CONFIG-123, `linux`
stays written (an exception to COM-042).

**CONFIG-130** While in JSON mode, the CLI shall respond with a common
object (`04-protocol/config.schema.json#/$defs/done`), `severity` `info`, its
message the answer of CONFIG-111 or CONFIG-121. In human mode it shall
write that answer.

## 6. Resetting a field

Like setting, resetting doesn't use workspace loading, so problems of COM-123,
COM-132 and COM-133 in the files don't stop it.

**CONFIG-200** If the file to write can't be read or isn't a JSON object
(COM-121), or the setting is the backend's and the file's active section
isn't an object (COM-134), then the CLI shall report its message as an input
error, and write nothing.

**CONFIG-201** The CLI shall remove `<key>` from the local file, or the
global one with `--global` (a backend's setting from the active section),
and keep the other keys, unknown ones included, and the other sections, in
the order of COM-129. Resetting a setting that isn't set is not an error;
the same key in another backend's section is not that setting.

**CONFIG-202** The CLI shall then answer `Reset <key>`, then ` (global)`
with `--global`, then what applies now: ` (still set in the <scope> config:
<value>)` when the other file still sets it, else ` (default: <default>)` for
a setting with a default (`overlay-syntax`, `preprocess-command`; where
the backend is noos, `workfile`, `bootstrap`, `interview`,
`project-template`, `example`, `probe`), else `
(not set)`: in JSON mode as a common object (`config.schema.json#/$defs/done`),
`severity` `info`, and in human mode as the line.

**CONFIG-203** Where the backend is linux, resetting `linux` shall leave the
caches as they are; a command that needs the bindings then reports `linux` as
missing (COM-072). Resetting `workfile` shall leave the workfile as it is.

## 7. `--reload`

**CONFIG-020** If the backend keeps no caches, or no backend is set, then
the CLI shall answer `Nothing to rebuild: the <id> backend keeps no caches`
or `Nothing to rebuild: no backend is set`.

**CONFIG-021** Where the backend is linux, with `--reload`, the CLI shall
check the `linux` field, the bundled dt-schema and the bundled tools
(COM-114), report their problems per COM-071 or COM-072, and otherwise build
the caches (COM-112, COM-113), even when they are current.

**CONFIG-022** When the build succeeds, the CLI shall write `Rebuilt the
binding index and validation.json.` in human mode, and in JSON mode respond
with a common object (`config.schema.json#/$defs/done`) whose message is
the summary line of COM-112 (`Indexed <n> compatibles from <m> bindings and
compiled binding schemas in <duration>`).

**CONFIG-023** If compiling the schemas fails, then the CLI shall refuse
with `Compiling binding schemas failed:`, a newline, and the tool's error
output.

## 8. `--global`

**CONFIG-140** With `--global`, the CLI shall set or reset the setting in the
global settings file (`02-common.md` §8.1), a backend's setting in the
backend's section of it, and leave the local file as it is. A local value of the same setting still wins (COM-124): `config
overlay-syntax --reset` then answers `Reset overlay-syntax (still set in the
global config: label)`, and the global value shows with source `global`.

**CONFIG-142** The CLI shall store a global path as typed: absolute, or
starting with `~` (CONFIG-103), so the global file stays valid for another
home directory.

## 9. Where the backend is noos

`config` lists the settings of `02-common.md` COM-500 in five categories.
Writing one (§4) checks, after CONFIG-107, in this order; the first that
fails is a refused value (an input error, COM-031) and nothing is written.

**CONFIG-500** If the setting is `bootstrap`, `interview` or `example` and
`<value>` is neither `true` nor `false`, then the CLI shall report the
refused value `<key>: "<value>" is not true or false`. If it is `probe` and
`<value>` is neither `openocd` nor `jlink`, `probe: "<value>" is not one of
openocd | jlink` (CONFIG-103).

**CONFIG-501** If the setting is `board` or `platform` and `<value>` is not
one of the boards, or chips, of CONFIG-510, then the CLI shall report the
refused value `<key>: "<value>" is not one of <a> | <b> …`. With no board or
chip found (no `capi-path`, no `module-paths`), the list is empty (open
issue CF-11).

**CONFIG-502** If the setting is `capi-path` or `module-paths` and a path,
resolved against the CWD, names nothing, then the CLI shall report the
refused value `<key>: <absolute path> does not exist`.

**CONFIG-503** If the setting is `capi-path` and the directory has no
`module.yml` that parses as a YAML object, then the CLI shall report the
refused value `capi-path: <path> is not a capi checkout (it has no
module.yml)`. The module's name isn't checked here (the setup run checks
it, `setup.md` SETUP-512; open issue CF-12).

**CONFIG-504** If the setting is `project-template` and `<value>` is neither
a bundled template set nor a directory with a `project_structure.json`, then
the CLI shall report the refused value `project-template: <problem>`:
`Template set '<value>' not found at '<bundled directory>/<value>'. Available
sets: capi, capi-iio` for a name, `Template set '<value>' has no
'project_structure.json' (looked in '<value>')` for a directory.

**CONFIG-505** When the setting is `board`, the CLI shall also write
`platform` with the chip the board carries, to the same file and section
(`noos`). When the setting is `platform` and `board` is set to a board that
carries another chip, the CLI shall also remove `board` from the same file
and section. The answer of
CONFIG-111 then ends with ` (and <changes>)`, one entry per other setting
whose effective value changed, joined with `, `: `platform = <chip>`, or
`reset board`. A write that changes nothing else has no such ending.

**CONFIG-506** If after the write the effective `board` and `platform`
would disagree because one of them is set in the other settings file, then
the CLI shall report the refused value `Board '<board>' carries <chip>, not
<platform>, and <key> '<value>' is set in <file>, which this write does not
change. Clear it there, or write the setting to that file instead.`, `<key>`
and `<value>` naming the setting the other file holds and `<file>` that
file's path.

**CONFIG-507** Resetting `board` or `platform` shall remove that key only:
`config board --reset` leaves `platform`.

**CONFIG-508** With `--reload`, the CLI shall answer `Nothing to rebuild:
the noos backend keeps no caches` (CONFIG-020).

**CONFIG-510** The CLI shall take the options of `board` and `platform` from
the module repositories of `module-paths`, read on every run: every board,
and every chip of a platform backend. They are the type of the field
(`{ "options": [...] }`, CONFIG-015) and the options shown after its
description (CONFIG-013); with none found, the type is `"string"` and no
options are shown. `bootstrap`, `interview` and `example` have the options
`true` and `false`, `probe` `openocd` and `jlink`.

**CONFIG-511** While in human mode, when `board` is shown required and
unset, the hint shall be `Run 'analog-attach config board <name>'
('analog-attach list context' lists them).`; for `capi-path`, `Run
'analog-attach config capi-path <path>', or 'analog-attach' on a terminal
for the guided setup.` (COM-501, CONFIG-014).

## 10. Open issues

**CF-2. `deploy-password` is shown in the clear,** in both modes.

**CF-3.** *Fixed.* (`(default)` hid an explicit setting. The shown value now
names its source, CONFIG-013.)

**CF-4. A settings file that isn't JSON is an input error here and goes
unreported elsewhere.** `config` reports it (CONFIG-005, CONFIG-102), every
other command reads the file as empty (`02-common.md` C-3).

**CF-5. Path kinds aren't checked.** `config devicetree .` and `config
workfile /tmp` succeed; the next command that loads them reports `is not a
file` (COM-127). Nor is a `.dts` or `.dtso` extension checked.

**CF-6. A refused `linux` is saved.** CONFIG-122 and CONFIG-123 answer
`ok: false` with `linux` written.

**CF-7. The answer echoes the value as typed.** `Set devicetree = ./base.dts`
while the file gets the absolute path. `linux` and a new `workfile` are
echoed absolute (CONFIG-111, CONFIG-121).

**CF-8.** *Fixed.* (Switching backends left the other backend's keys in the
flat file, where they were unknown keys that made `config` refuse to show
anything. Each backend's settings are now in their own section, COM-131,
COM-135, CONFIG-112.)

**CF-9. The table's hints aren't merged.** With `linux` and `devicetree`
unset, `config` writes two setup hints (`Run 'analog-attach' on a terminal,
or 'analog-attach config linux <path>', to set up a workspace.` and the same
for `devicetree`), where a command's configuration errors merge them into one
(`02-common.md` §8.1).

**CF-10. A refused value and an unreadable file are input errors, a refused
`linux` build a refusal.** CONFIG-102 to CONFIG-106 exit 2 on standard error
in both modes, as text even under `--json` (not a `config-error` object),
while CONFIG-122, CONFIG-123 and CONFIG-023 are refusals (`02-common.md`
C-11).

**CF-11. `board` can't be set before `capi-path`, and says so badly.** With
`capi-path` unset there are no boards (CONFIG-510), so `config board
testboard` refuses `board: "testboard" is not one of  — Board a new
workfile targets; …` with an empty list, rather than saying that
`capi-path` (or `module-paths`) is needed first. A fix would be to name the
missing setting when the scan finds nothing.

**CF-12. `capi-path` takes a module checkout the setup refuses.** `config
capi-path` accepts any directory with a `module.yml` (CONFIG-503), while the
setup run asks for one whose `module.yml` has `name: capi` (`setup.md`
SETUP-512). The fixture checkout (`name: capi-test`) can be set by `config`
and not chosen in the setup.

(CF-1, `config-get` ignoring unknown names, was fixed by CONFIG-101.)

## 11. Examples

```
$ analog-attach config overlay-syntax
overlay-syntax: fragment (default)
  Output syntax for the overlay file: fragment (default) or label (&spi0 { … }) [fragment | label]
```

```
$ analog-attach config
Local:  ~/work/.analog-attach/config.json
Global: ~/.config/analog-attach/config.json

  General
  * backend             linux                                                                       local

  Workspace
  * linux               /home/u/linux_rpi                                                           local
  * devicetree          /home/u/linux_rpi/arch/arm/boot/dts/broadcom/bcm2711-rpi-4-b.dts            local
    workfile            /home/u/work/overlay.dtso                                                   local
    overlay-syntax      fragment                                                                    default
    preprocess-command  cpp -nostdinc -undef -x assembler-with-cpp -P -I {linux}/include -o {output} {input}  default

  Deploy
    deploy-ip           (not set)
    deploy-user         pi                                                                          global
    deploy-password     (not set)

  * required
```

(The value column is as wide as the longest value plus two; shortened here.)

```
$ analog-attach --json config deploy-user
{"ok":true,"message":"1 config field(s)","severity":"info","configs":[
 {"field_name":"deploy-user","category":"Deploy","description":"SSH username on the remote device",
  "type":"string","required":false,"default":null,"value":"pi","source":"global"}]}
```

```
$ analog-attach config nope
Unknown config field: nope. Valid fields: backend, linux, devicetree, workfile, overlay-syntax, preprocess-command, deploy-ip, deploy-user, deploy-password.
                                                   (stderr, exit 2)
```

```
$ analog-attach --json config overlay-syntax label --global
{"ok":true,"message":"Set overlay-syntax = label (global)","severity":"info"}
```

```
$ analog-attach config overlay-syntax xml
overlay-syntax: "xml" is not one of fragment | label — Output syntax for the overlay file: fragment (default) or label (&spi0 { … })
                                                   (stderr, exit 2)
```

```
$ analog-attach config overlay-syntax --reset
Reset overlay-syntax (default: fragment)
$ analog-attach --json config deploy-ip --reset
{"ok":true,"message":"Reset deploy-ip (not set)","severity":"info"}
```

```
$ analog-attach config linux /tmp
linux: no Documentation/devicetree/bindings/ under /tmp (not a Linux source tree) — Path to Linux kernel source tree (setting it builds the binding caches)

Run 'analog-attach' on a terminal, or 'analog-attach config linux <path>', to set up a workspace.
                                                   (stderr, exit 2)
```

```
$ analog-attach --json config linux ~/linux_rpi
Indexing device bindings and compiling binding schemas...                       (stderr)
Indexed 23309 compatibles from 5196 bindings and compiled binding schemas in 5.1s   (stderr)
{"ok":true,"message":"Set linux = /home/u/linux_rpi; Indexed 23309 compatibles from 5196 bindings and compiled binding schemas in 5.1s","severity":"info"}
```

```
$ analog-attach --json config            # the local file's linux section also has "bogus": "x"
{"errors":[{"field":"linux.bogus","kind":"unknown","message":"~/work/.analog-attach/config.json: unknown key linux.bogus",
 "hint":"Remove unknown keys from ~/work/.analog-attach/config.json; valid keys in linux are linux, devicetree, workfile, overlay-syntax, preprocess-command, deploy-ip, deploy-user, deploy-password."}],
 "hints":["Remove unknown keys from ~/work/.analog-attach/config.json; valid keys in linux are linux, devicetree, workfile, overlay-syntax, preprocess-command, deploy-ip, deploy-user, deploy-password."]}
                                                   (stderr, exit 2)
```

A file of the earlier flat format (COM-131):

```
$ cat .analog-attach/config.json
{ "backend": "linux", "linux": "/home/u/linux_rpi", "devicetree": "/home/u/base.dts" }
$ analog-attach config
Configuration errors:
  ~/work/.analog-attach/config.json: linux: must be an object
  ~/work/.analog-attach/config.json: unknown key devicetree

Make linux an object in ~/work/.analog-attach/config.json; valid top-level keys are backend and the backends' sections linux, noos, each an object of that backend's settings.
Remove unknown keys from ~/work/.analog-attach/config.json; valid top-level keys are backend and the backends' sections linux, noos, each an object of that backend's settings.
                                                   (stderr, exit 2)
```

Switching backends keeps both sections:

```
$ analog-attach config backend noos
Set backend = noos
$ analog-attach config board testboard
Set board = testboard (and platform = testsoc)
$ analog-attach config backend linux
Set backend = linux
$ cat .analog-attach/config.json
{
  "backend": "linux",
  "linux": {
    "devicetree": "/home/u/base.dts",
    "workfile": "/home/u/work/overlay.dtso"
  },
  "noos": {
    "capi-path": "/home/u/capi",
    "board": "testboard",
    "platform": "testsoc"
  }
}
```

```
$ analog-attach --json config --reload          # linux not set
{"errors":[{"field":"linux","kind":"missing","message":"Missing config field linux",
 "description":"Path to Linux kernel source tree (setting it builds the binding caches)"}],
 "hints":["Run 'analog-attach' on a terminal, or 'analog-attach config linux <path>', to set up a workspace."]}
                                                   (stderr, exit 2)
```

```
$ analog-attach config --reload
Indexing device bindings and compiling binding schemas...                       (stderr)
Indexed 23309 compatibles from 5196 bindings and compiled binding schemas in 5.1s   (stderr)
Rebuilt the binding index and validation.json.
```

Where the backend is noos:

```
$ analog-attach config
Local:  /home/u/proj/.analog-attach/config.json
Global: ~/.config/analog-attach/config.json

  General
  * backend           noos                local

  Sources
  * capi-path         /home/u/capi        local
    module-paths      /home/u/capi-maxim  local

  Target
  * board             max32655fthr        local
    platform          max32655            local

  Workfile
  * workfile          /home/u/proj/workfile.json  default
    bootstrap         true                default
    interview         true                default

  Project
    project-name      (not set)
    project-path      (not set)
    project-template  capi                default
    example           true                default

  Build
    build-command     (not set)
    deploy-command    (not set)
    probe             openocd             default

  * required
```

(Shortened: the value column is as wide as the longest value plus two.)

```
$ analog-attach config board testboard
Set board = testboard (and platform = testsoc)
$ analog-attach config platform othersoc
Set platform = othersoc (and reset board)
$ analog-attach config bootstrap yes
bootstrap: "yes" is not true or false — After 'add', fill in every value and node that leaves no room for choice (true/false)
                                                   (stderr, exit 2)
$ analog-attach config capi-path /tmp
capi-path: /tmp is not a capi checkout (it has no module.yml) — Path to the root of the capi repository

Run 'analog-attach config capi-path <path>', or 'analog-attach' on a terminal for the guided setup.
                                                   (stderr, exit 2)
$ analog-attach --json config --reload
{"ok":true,"message":"Nothing to rebuild: the noos backend keeps no caches","severity":"info"}
```
