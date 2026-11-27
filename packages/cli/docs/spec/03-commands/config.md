# config

Shows the settings and their values, sets or resets one, or rebuilds the
backend's caches. `config` is the front end's: it works with no backend set
(COM-013), and the settings it knows are `backend` and those of the
backend's section of the settings files (`02-common.md` §8.1, COM-131). Where the backend is linux, setting `linux` also
builds the binding caches, and `config var` shows and sets the variables
of the project's scripts and the commands it runs (§9). Where the backend is noos, writing a setting
checks it against the checkouts on disk, and `target` against the boards
and chips they have (§10).

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
analog-attach [--json] config var [<NAME>]                    # where the backend is linux
analog-attach [--json] config var <NAME> <value>
analog-attach [--json] config var <NAME> --secret
analog-attach [--json] config var <NAME> --reset
```

Grammar: rule `config` in `01-grammar.abnf`.

| Argument | Meaning | Default |
|---|---|---|
| `<key>` | A setting: `backend`, or one of the backend's (in its section, COM-131). | none: every setting (§3) |
| `<value>` | The value to set (§4); several only for a `path_list`. | none: show the setting |
| `--global` | Set or reset in the global settings file instead of the local one (§8). | off |
| `--reset` | Remove `<key>` from the settings file (§6). | off |
| `--reload` | Rebuild the backend's caches (§7). | off |
| `var` | Where the backend is linux: the scripts' variables and the executable variables, not a setting (§9). | |
| `--secret` | With `var <NAME>`: make it a secret, its value never stored (§9). | off |

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
settings, then the CLI shall report `Unknown config field: <key>.[ Did you
mean <close>?] Valid fields: <keys>.`, `<close>` the keys a few edits from
`<key>` (`02-common.md` COM-140), `<keys>` being `backend` and the backend's keys in order,
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
the caches with `--reload` (§7). Where the backend is linux, `<key>` `var`
is §9, after CONFIG-001 and before CONFIG-002; `--secret` with another
`<key>`, or none, is the input error `--secret is for a variable:
analog-attach config var <NAME> --secret`. A `--reload` with `--secret` is
CONFIG-001's.

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
`unset`.

**CONFIG-013** While in human mode, when showing one setting, the CLI shall
write:

```
<key>[  (required)]

  Value:        <value>[  (<source>)]
  Description:  <description>
[  Options:      <option>, <option>, …]
```

The labels are padded to fourteen characters. `<value>` is `(not set)` for
an unset setting; a path from the home directory is written with `~`, and a
`path_list` has one path per line, the others under the first. `<source>` is
`default`, `local` or `global`, left out when unset. The description and the
options are wrapped at 80 characters, the continuation lines under the
first. The options are there for a setting that has them (`backend`,
`overlay-syntax`, `output`; where the backend is noos, the booleans, `probe`, and
`target` as scanned, CONFIG-510). When the setting is required and unset, an
empty line and its hint follow. On a terminal the key is bold and
`(required)`, the source and `(not set)` dim.

**CONFIG-017** When showing one setting that takes any value, the CLI shall
offer the values the backend finds for it, which it doesn't require: in JSON
the entry's `suggestions` (each `{ value, display_string? }`), in human mode a
`Found:` line after the options, one value per line, the others under the
first, each followed by its description, dim. Where the backend is noos:
for `capi-path`, the capi checkouts in the current directory or any above it,
in the home directory, and one or two levels into either (`~/work/capi`),
nearest first; for `module-paths`, the module repositories beside the
configured `capi-path`, each described `<name> (<type>)`. They are looked for
only for one setting, not for the whole list (a scan of folders); none found,
there is no `suggestions` and no `Found:` line.

**CONFIG-016** While in human mode, when showing every setting, the CLI
shall write `Local:  <file>` and `Global: <file>` (the settings files, the
home directory written `~`), an empty line, then for each category in order
(`General` for `backend`; where the backend is linux, `Workspace` and
`Build`; where it is noos, `Sources`, `Target`, `Workfile`, `Project` and
`Build`) the line `  <category>` and one line per setting: two spaces, `*`
for a required setting or a space, a space, the key padded to the longest
key plus two, the value (`(not set)` when unset) padded to the longest
value line plus two, and its source (none when unset), trailing spaces
removed. Values are written as in CONFIG-013: a path from the home directory
with `~`, a `path_list` one path per line, the others on the lines below,
under the first. Categories are separated by an empty line. When a setting
is required, the CLI shall then write an empty line and `  * required`. On a
terminal the categories are bold, and the sources, `(not set)` and `*
required` dim. Where the backend is linux, the CLI shall then, after the
hints of CONFIG-014, write an empty line and the variables, as CONFIG-301
writes them.

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

Where the backend is linux and no `<key>` is given, the object also has
`variables`, as CONFIG-301 gives it.

## 4. Setting a field

`config <key> <value>` writes the local settings file, or the global one
with `--global` (§8): `backend` at the top level, the backend's settings in
its section (COM-129). `backend` is written to the local file only
(`02-common.md` COM-136): `config --global backend <id>` is refused with
`backend belongs to the project and can't be in the global settings: set it
without --global, in the project's directory`, refused like a value
(COM-043).
`config --global backend --reset` still removes it from the global file. It doesn't use workspace loading (COM-070): it is how
a broken configuration gets fixed, so problems of COM-123, COM-132 and
COM-133 in the files don't stop it.

The checks apply in this order; the first that fails is refused and nothing
is written: a refusal for a value the setting can't take (`02-common.md`
COM-043), an input error (COM-031) for a file that can't be written. A
refused value is written as
`<problem> — <description>`, followed by an empty line and the setting's hint
when it has one.

**CONFIG-102** If the file to write can't be read or isn't a JSON object
(COM-121), or the setting is the backend's and the file's active section
isn't an object (COM-134), then the CLI shall report its message as an
input error, as text in both modes: `<file>: <id>: must be an object —
<description>`. (Open issues CF-4, CF-10.)

**CONFIG-107** If the setting isn't a `path_list` and more than one
`<value>` is given, then the CLI shall report `<key> takes one value; got
<n>`.

**CONFIG-103** The CLI shall check `<value>` as reading would check it
(COM-123): `<key>: must not be empty`, `<key>: "<value>" is not one of <a> |
<b>`, and for `--global` a relative path, `<key>: "<value>" is relative; a
global path must be absolute or start with ~`. If that fails, then the CLI
shall report the problem as a refused value: `overlay-syntax: "xml" is not
one of fragment | reference — fragment: fragment@0 { target = <&spi0>; __overlay__ { … }; };  reference: &spi0 { … };`.

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
a setting with a default (`overlay-syntax`,
`interview`, `output`, `build-dir`; where the backend is noos, `workfile`, `bootstrap`, `interview`,
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
check the `linux` field and the installed dt-schema (COM-114), report their problems per COM-071 or COM-072, and otherwise build
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

## 9. Variables

Where the backend is linux, `build` and `deploy` run the project's
commands, the executable variables `AA_BUILD` and `AA_DEPLOY` (COM-158:
`./aa_build.sh` and `./aa_deploy.sh` by default), and every devicetree read goes
through `AA_PREPROCESS_COMMAND`. They get their variables in the
environment (`02-common.md` §8.6): the system variables the CLI computes,
named `AA_…` (COM-153), and the project's, which `config var` sets in the
local settings file (COM-154). `config var` also sets the executable
variables, in the same file, and resets them to their defaults. A
project variable is plain, with a value, or a secret, with none stored
(COM-157). `init` sets those a starter it writes uses, unless the project
has them (`init.md` INIT-107: for `aa_deploy.sh`, `BOARD_IP` `analog.local`,
`BOARD_USER` `analog` and the secret `BOARD_PASSWORD`); `config var` changes
them as any other. Like the settings, `config var` uses no workspace loading.

**CONFIG-300** When `<key>` is `var` and the settings files have problems
(CONFIG-005), the CLI shall report them as CONFIG-005 does and do nothing
else. With `--global`, it shall refuse with `Variables belong to the
project and can't be in the global settings: set them without --global`,
`error_type` `invalid-setting`.

**CONFIG-301** With no `<NAME>`, the CLI shall list every variable: the
system ones in the order of COM-153, then the executable ones in the order
of COM-158, then the project's in the order of the file. In JSON mode it responds per `config.schema.json#/$defs/variables`:
`message` `<n> variable(s)` and `variables`, one entry each:

| Field | Value |
|---|---|
| `name` | The name |
| `kind` | `system`, `executable`, `project` or `secret` |
| `description` | A system or executable variable's, as in COM-153 and COM-158; absent for the others |
| `value` | Its value as the settings stand: an executable variable's the command it runs (its default unless set); a system variable's that has none (a setting it follows unset, one for the other `output`, `AA_PREPROCESS_INPUT` and `AA_PREPROCESS_OUTPUT`) and a secret's are `null` |
| `runs` | An executable variable only: the step that runs it, `build`, `deploy` or `preprocess` |
| `default` | An executable variable only: its default |
| `scripts` | The steps whose commands get it (COM-156): a system variable's as in COM-153, a plain variable's `["build", "deploy", "preprocess"]`, a secret's `["deploy"]`; an executable variable's `[]` |
| `in_environment` | A secret only: `true` when the environment `config` runs in has a value for it that isn't empty, as `deploy` would read it (deploy.md DEPLOY-040) |

In human mode it writes `  Variables` (bold on a terminal), then one line per
variable: four spaces, the name padded to the longest name plus two, the
value (`(not set)` when it is `null`, a secret's `(secret, in the
environment)` or `(secret, not in the environment)`, a path from the home
directory with `~`, a command of several lines its first line then ` …`)
padded to the longest value, at least ten, plus two, and `<kind>,
<scripts>`, the scripts joined with `, ` and the last with ` and ` (`build,
deploy and preprocess`); for an executable variable `executable, run by
<step>`, `executable (default), run by <step>` while it is its default (dim
on a terminal, and so is `(not set)`). When the project has no variable, an empty line and
`  No project variables: analog-attach config var <NAME> <value>, or
--secret for a password.` (dim) follow.

**CONFIG-302** With `<NAME>` alone, the CLI shall show that variable: in
JSON mode as CONFIG-301 with `message` `1 variable(s)` and its entry alone;
in human mode as CONFIG-013 shows a setting, the labels `Value:` (a
command of several lines one line each, under the first), `Kind:`, then
`Scripts:` (joined with `, `), or for an executable variable `Runs:` and
`Default:` (then ` (in use)` when the value is the default), and, for a
system or executable variable, `Description:`. If
there is no variable of that name, then the CLI shall refuse with `Unknown
variable <NAME>.[ Did you mean <close>?] Set it with analog-attach config
var <NAME> <value>.`, `error_type` `not-found` (`<close>` per COM-140).

**CONFIG-303** With `<NAME> <value>`, the CLI shall store the plain variable
`<NAME>` with `<value>` in the local settings file (COM-154), replacing the
value it had, and answer `Set variable <NAME> = <value>`. More than one
`<value>` is the input error `A variable takes one value; got <n>. Quote a
value that has spaces.`. An empty `<value>` is refused with `<NAME>: must
not be empty: analog-attach config var <NAME> --reset removes it`,
`error_type` `invalid-setting`.

**CONFIG-304** With `<NAME> --secret`, the CLI shall store `<NAME>` as a
secret, `{ "secret": true }`, removing the value it had, and answer `Set
variable <NAME> as a secret`, then ` (its stored value removed)` when it was
a plain variable. A `<value>` with it is the input error `--secret takes no
value: a secret's value is never stored. Set it in the environment deploy
runs in, or deploy asks for it on a terminal.`.

**CONFIG-305** With `<NAME> --reset`, the CLI shall remove `<NAME>` from the
local settings file, removing the `variables` key when none is left, and
answer `Reset variable <NAME> (not set)`; one that isn't there is no error.
A `<value>` with it is the input error `--reset takes no value`, and
`--secret` with it `--reset and --secret don't go together`. Without
`<NAME>`, `--reset` and `--secret` are the input errors `--reset needs a
variable: analog-attach config var <NAME> --reset` and `--secret needs a
variable: analog-attach config var <NAME> --secret`.

**CONFIG-306** If `<NAME>` isn't a variable name (COM-154), then CONFIG-303
and CONFIG-304 shall refuse with `"<NAME>" is not a variable name: letters,
digits and _, not starting with a digit`; if it begins with `AA_` (in any
case) and isn't an executable variable's (COM-158), with `<NAME> starts with
AA_, the system variables' prefix`; both `error_type` `invalid-name`.
CONFIG-305 shall refuse a name that begins with `AA_`, but an executable
variable's, with `<NAME> is a system variable: linux computes it, and it
can't be reset`, `error_type` `read-only`.

**CONFIG-307** If `<NAME>` is a secret, then CONFIG-303 shall refuse with
`<NAME> is a secret, whose value is never stored: analog-attach config var
<NAME> --reset first to make it a plain variable`, `error_type`
`invalid-setting`, and store nothing.

**CONFIG-308** The answers of CONFIG-303 to CONFIG-305 shall be, in JSON
mode, a common object (`config.schema.json#/$defs/done`), `severity`
`info`; in human mode the line. A settings file that can't be read or
written is CONFIG-200's input error.

**CONFIG-309** The CLI shall keep the other keys of the file as CONFIG-201
does, and the other entries of `variables` as they are, an invalid one
included.

**CONFIG-310** Where the backend is noos, `var` is no key: it is CONFIG-101's
unknown field. `--secret` is CONFIG-004's input error.

**CONFIG-311** With `<NAME>` an executable variable (COM-158):
- `<NAME> <value>` shall store `<value>` as the command, as written (several
  lines included), and answer `Set variable <NAME> = <value>`. A `<value>`
  that is empty or only white space is refused with `<NAME>: must not be
  empty: analog-attach config var <NAME> --reset goes back to the default,
  <default>`, `error_type` `invalid-setting`.
- `<NAME> --reset` shall remove it from the file, as CONFIG-305, and answer
  `Reset variable <NAME> (default <default>)`.
- `<NAME> --secret` shall refuse with `<NAME> is a command linux runs, and
  can't be a secret: put a password in a secret of its own, which deploy
  gets`, `error_type` `invalid-setting`, and store nothing.

Setting `AA_BUILD` or `AA_DEPLOY` to another command leaves `aa_build.sh` and
`aa_deploy.sh` as they are: `build` and `deploy` run the command instead, and
no longer check the script (COM-150).

## 10. Where the backend is noos

`config` lists the settings of `02-common.md` COM-500 in five categories.
Writing one (§4) checks, after CONFIG-107, in this order; the first that
fails is a refused value (a refusal, `02-common.md` COM-043) and nothing is written.

**CONFIG-500** If the setting is `bootstrap`, `interview` or `example` and
`<value>` is neither `true` nor `false`, then the CLI shall report the
refused value `<key>: "<value>" is not true or false`. If it is `probe` and
`<value>` is neither `openocd` nor `jlink`, `probe: "<value>" is not one of
openocd | jlink` (CONFIG-103).

**CONFIG-501** If the setting is `target` and `<value>` is none of the
boards and chips of CONFIG-510, then the CLI shall report the refused value
`target: "<value>" is not one of <a> | <b> …`. With no board or chip found
(no `capi-path`, no `module-paths`), it shall report instead `Unknown target
'<value>': the configured modules have no boards or chips. Check capi-path
and module-paths`.

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

**CONFIG-505** `target` shall be the one setting for the board and its chip:
a board, which brings the chip it carries, or a chip, for one used without
a board (`init.md` INIT-503). Writing it writes nothing else. There is no
`board` or `platform` setting (an unknown key, CONFIG-101).

(CONFIG-506 and CONFIG-507, which kept a `board` and a `platform` setting in
agreement, are withdrawn with them.)

**CONFIG-508** With `--reload`, the CLI shall answer `Nothing to rebuild:
the noos backend keeps no caches` (CONFIG-020).

**CONFIG-510** The CLI shall take the options of `target` from the module
repositories of `module-paths`, read on every run: every board, then every
chip of a platform backend. They are the type of the field
(`{ "options": [...] }`, CONFIG-015) and the options shown after its
description (CONFIG-013); with none found, the type is `"string"` and no
options are shown. `bootstrap`, `interview` and `example` have the options
`true` and `false`, `probe` `openocd` and `jlink`.

**CONFIG-511** While in human mode, when `target` is shown required and
unset, the hint shall be `Run 'analog-attach config target <board or chip>'
('analog-attach list context' lists them).`; for `capi-path`, `Run
'analog-attach config capi-path <path>', or 'analog-attach' on a terminal
for the guided setup.` (COM-501, CONFIG-014).

## 11. Open issues

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

**CF-9. The table's hints aren't merged.** With `linux` and `devicetree`
unset, `config` writes two setup hints (`Run 'analog-attach' on a terminal,
or 'analog-attach config linux <path>', to set up a workspace.` and the same
for `devicetree`), where a command's configuration errors merge them into one
(`02-common.md` §8.1).

**CF-10. A settings file that can't be written is an input error in text.**
Setting or resetting with a file that can't be read or written (CONFIG-102,
CONFIG-200) exits 2 on standard error, as text even under `--json`, where
showing gives a `config-error` object (CONFIG-005) and a refused value is a
refusal (COM-043). See `02-common.md` C-11.

**CF-12. `capi-path` takes a module checkout the setup refuses.** `config
capi-path` accepts any directory with a `module.yml` (CONFIG-503), while the
setup run asks for one whose `module.yml` has `name: capi` (`setup.md`
SETUP-512). The fixture checkout (`name: capi-test`) can be set by `config`
and not chosen in the setup.

(CF-1, `config-get` ignoring unknown names, was fixed by CONFIG-101. CF-2,
`deploy-password` shown in the clear, is gone with the setting: a password
is a secret now, CONFIG-304.)

**CF-13. A secret's value can't be checked before `deploy`.** `config var`
says whether the environment has it (`in_environment`), not whether it is
right: a wrong password is found by `aa_deploy.sh` (deploy.md DEPLOY-033).

## 12. Examples

```
$ analog-attach config overlay-syntax
overlay-syntax

  Value:        fragment  (default)
  Description:  fragment: fragment@0 { target = <&spi0>; __overlay__ { … }; };
                reference: &spi0 { … };
  Options:      fragment, reference
```

```
$ analog-attach config
Local:  ~/work/.analog-attach/config.json
Global: ~/.config/analog-attach/config.json

  General
  * backend             linux                                                    local

  Workspace
  * linux               ~/linux_rpi                                              local
  * devicetree          ~/linux_rpi/arch/arm/boot/dts/broadcom/bcm2711-rpi-4-b.dts  local
    workfile            ~/work/overlay.dtso                                      local
    overlay-syntax      fragment                                                 default
    interview           true                                                     default

  Build
    output              overlay                                                  default
    build-dir           build                                                    default

  * required

  Variables
    AA_PROJECT             ~/work                              system, build, deploy and preprocess
    AA_OUTPUT              overlay                             system, build and deploy
    AA_BUILD_DIR           ~/work/build                        system, build and deploy
    AA_DTSO                ~/work/overlay.dtso                 system, build and deploy
    AA_DTBO                ~/work/build/overlay.dtbo           system, build and deploy
    AA_DTS                 (not set)                           system, build
    AA_DTB                 (not set)                           system, build and deploy
    AA_DTC                 /usr/bin/dtc                        system, build
    AA_LINUX               ~/linux_rpi                         system, build, deploy and preprocess
    AA_PREPROCESS_INPUT    (not set)                           system, preprocess
    AA_PREPROCESS_OUTPUT   (not set)                           system, preprocess
    AA_BUILD               make -C fw …                        executable, run by build
    AA_DEPLOY              ./aa_deploy.sh                         executable (default), run by deploy
    AA_PREPROCESS_COMMAND  cpp -nostdinc -undef -x assembler-with-cpp -P -I "$AA_LINUX/include" -o "$AA_PREPROCESS_OUTPUT" "$AA_PREPROCESS_INPUT"executable (default), run by preprocess
    BOARD_IP               192.168.2.10                        project, build, deploy and preprocess
    BOARD_USER             analog                              project, build, deploy and preprocess
    BOARD_PASSWORD         (secret, not in the environment)    secret, deploy
```

(The value columns are as wide as their longest value plus two; shortened
here.)

```
$ analog-attach --json config build-dir
{"ok":true,"message":"1 config field(s)","severity":"info","configs":[
 {"field_name":"build-dir","category":"Build","description":"Folder aa_build.sh writes its output to and aa_deploy.sh takes it from, relative to the project unless absolute; the scripts get it as $AA_BUILD_DIR",
  "type":"string","required":false,"default":"build","value":"build","source":"default"}]}
```

```
$ analog-attach config nope
Unknown config field: nope. Valid fields: backend, linux, devicetree, workfile, overlay-syntax, interview, output, build-dir, var.
                                                   (stderr, exit 2)
```

```
$ analog-attach config var BOARD_IP 192.168.2.10
Set variable BOARD_IP = 192.168.2.10
$ analog-attach config var BOARD_PASSWORD --secret
Set variable BOARD_PASSWORD as a secret
$ BOARD_PASSWORD=analog analog-attach --json config var BOARD_PASSWORD
{"ok":true,"message":"1 variable(s)","severity":"info","variables":[{"name":"BOARD_PASSWORD","kind":"secret","value":null,"scripts":["deploy"],"in_environment":true}]}
$ analog-attach --json config var AA_DTBO x
{"ok":false,"message":"AA_DTBO starts with AA_, the system variables' prefix","severity":"error","error_type":"invalid-name"}
$ cat .analog-attach/config.json
{
  "backend": "linux",
  "linux": {
    "workfile": "overlay.dtso",
    "variables": {
      "BOARD_IP": "192.168.2.10",
      "BOARD_PASSWORD": {
        "secret": true
      }
    }
  }
}
```

```
$ analog-attach config var AA_BUILD 'make -C fw
make overlay'
Set variable AA_BUILD = make -C fw
make overlay
$ analog-attach config var AA_BUILD
AA_BUILD

  Value:        make -C fw
                make overlay
  Kind:         executable
  Runs:         build
  Default:      ./aa_build.sh
  Description:  The command build runs, in the project root: by default the
                project's aa_build.sh
$ analog-attach --json config var AA_DEPLOY
{"ok":true,"message":"1 variable(s)","severity":"info","variables":[{"name":"AA_DEPLOY","kind":"executable","description":"The command deploy runs, in the project root: by default the project's aa_deploy.sh","value":"./aa_deploy.sh","runs":"deploy","default":"./aa_deploy.sh","scripts":[]}]}
$ analog-attach config var AA_BUILD --reset
Reset variable AA_BUILD (default ./aa_build.sh)
```

```
$ analog-attach --json config overlay-syntax reference --global
{"ok":true,"message":"Set overlay-syntax = reference (global)","severity":"info"}
```

```
$ analog-attach config overlay-syntax xml
overlay-syntax: "xml" is not one of fragment | reference — fragment: fragment@0 { target = <&spi0>; __overlay__ { … }; };  reference: &spi0 { … };
```

```
$ analog-attach config overlay-syntax --reset
Reset overlay-syntax (default: fragment)
$ analog-attach --json config build-dir --reset
{"ok":true,"message":"Reset build-dir (default: build)","severity":"info"}
```

```
$ analog-attach config linux /tmp
linux: no Documentation/devicetree/bindings/ under /tmp (not a Linux source tree) — Path to Linux kernel source tree (setting it builds the binding caches)

Run 'analog-attach' on a terminal, or 'analog-attach config linux <path>', to set up a workspace.
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
 "hint":"Remove unknown keys from ~/work/.analog-attach/config.json; valid keys in linux are linux, devicetree, workfile, overlay-syntax, interview, output, build-dir, variables."}],
 "hints":["Remove unknown keys from ~/work/.analog-attach/config.json; valid keys in linux are linux, devicetree, workfile, overlay-syntax, interview, output, build-dir, variables."]}
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

Switching backends keeps both sections (here a project set to noos already,
which may switch to linux but not back, `02-common.md` COM-017):

```
$ analog-attach config target testboard
Set target = testboard
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
{"ok":false,"message":"Missing config field linux","severity":"error","error_type":"missing-setting",
 "errors":[{"field":"linux","kind":"missing","error_type":"missing-setting","message":"Missing config field linux",
 "description":"Path to Linux kernel source tree (setting it builds the binding caches)"}],
 "hints":["Run 'analog-attach' on a terminal, or 'analog-attach config linux <path>', to set up a workspace."]}
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
Local:  ~/proj/.analog-attach/config.json
Global: ~/.config/analog-attach/config.json

  General
  * backend           noos                    local

  Sources
  * capi-path         ~/capi                  local
    module-paths      ~/capi-maxim            local
                      ~/capi-noos
                      ~/capi-util

  Target
  * target            max32655fthr            local

  Workfile
  * workfile          ~/proj/workfile.json    default
    bootstrap         true                    default
    interview         true                    default

  Project
    project-name      (not set)
    project-path      (not set)
    project-template  capi                    default
    example           true                    default

  Build
    build-command     (not set)
    deploy-command    (not set)
    probe             openocd                 default

  * required
```

```
$ analog-attach config target testboard
Set target = testboard
$ analog-attach config target othersoc
Set target = othersoc
$ analog-attach config bootstrap yes
bootstrap: "yes" is not true or false — After 'add', fill in every value and node that leaves no room for choice (true/false)
$ analog-attach config capi-path /tmp
capi-path: /tmp is not a capi checkout (it has no module.yml) — Path to the root of the capi repository

Run 'analog-attach config capi-path <path>', or 'analog-attach' on a terminal for the guided setup.
$ analog-attach --json config --reload
{"ok":true,"message":"Nothing to rebuild: the noos backend keeps no caches","severity":"info"}
```
