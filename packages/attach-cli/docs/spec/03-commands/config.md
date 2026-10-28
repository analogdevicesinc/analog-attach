# config

Shows the config fields and their values, sets or resets one field, or
rebuilds the binding caches. Setting `linux` also builds the caches.

`config` replaces `config-get` and `config-set`, which are gone (an unknown
command: COM-031, COM-032). Their requirements keep their numbers here:
`CONFIGGET-0nn` is `CONFIG-0nn` and `CONFIGSET-0nn` is `CONFIG-1nn`. The
`CONFIG-2nn` block is `--reset`, which is new.

## 1. Synopsis

```
attach-linux [--json] config [<key>]
attach-linux [--json] config <key> <value>
attach-linux [--json] config <key> --reset
attach-linux [--json] config --reload
```

Grammar: rule `config` in `01-grammar.abnf`. The fields are those of
`02-common.md` §8.1.

| Argument | Meaning | Default |
|---|---|---|
| `<key>` | A config field. | none: every field (§3) |
| `<value>` | The value to set (§4). | none: show the field |
| `--reset` | Remove `<key>` from `config.toml` (§6). | off |
| `--reload` | Rebuild the binding caches (§7). | off |

## 2. Choosing what to do

The checks apply in this order; the first that matches decides.

**CONFIG-001** If `--reload` is given with `<key>` or `--reset`, then the
CLI shall refuse with `--reload rebuilds the caches and takes no other
argument`. (Was CONFIGGET-020.)

**CONFIG-002** If `--reset` is given without `<key>`, then the CLI shall
refuse with `--reset needs a key: attach-linux config <key> --reset`, where
`<key>` is literal.

**CONFIG-101** If `<key>` isn't a field, then the CLI shall refuse with
`Unknown config field: <key>. Valid fields: linux, devicetree, overlay,
overlay-syntax, preprocess-command, deploy-ip, deploy-user,
deploy-password`, whatever else is given.

**CONFIG-003** If `--reset` is given with `<value>`, then the CLI shall
refuse with `--reset takes no value`.

**CONFIG-004** The CLI shall then show every field when neither `<key>` nor
an option is given (§3), show `<key>` when it is given alone (§3), set it
when `<value>` is given (§4, §5), reset it with `--reset` (§6), and rebuild
the caches with `--reload` (§7).

## 3. Showing fields

**CONFIG-005** When showing, the CLI shall load the settings (COM-120 to
COM-124) and, when they have problems, report them per COM-071 or COM-072 and
do nothing else. It needs no other resource: an unset or wrong path is
shown, not reported. (Was CONFIGGET-001.)

**CONFIG-010** Without `<key>`, the CLI shall show every field, in the order
of the table in `02-common.md` §8.1. With `<key>`, it shall show that field
only.

**CONFIG-011** *Withdrawn.* (`config-get` ignored a name that wasn't a field;
`config` refuses it, CONFIG-101.)

**CONFIG-012** A field's value is the setting as loaded: a path absolute
(COM-125), a field that isn't set its default, and a field with neither
unset. The CLI shall show `deploy-password` as it is stored. (Open issue
CF-2.)

**CONFIG-013** While in human mode, the CLI shall write for each field
shown:

```
<field>[ [required]]: <shown value>
  <description>[ [<option> | <option>]]

```

`<shown value>` is `(not set)` for an unset field, `<value> (default)` when the
value equals the default (set or not), and `<value>` otherwise. The options
follow the description for a field that has them (`overlay-syntax`).

**CONFIG-014** While in human mode, when a field shown is required and
unset, the CLI shall then write an empty line and the hints of those fields
(`02-common.md` §8.1), each once, in field order.

**CONFIG-015** While in JSON mode, the CLI shall respond with an object
conforming to `config.schema.json#/$defs/fields`: `message` `<n> config
field(s)`, `<n>` the number of fields shown (8, or 1 with `<key>`), and
`configs`, one entry per field:

| Field | Value |
|---|---|
| `field_name` | The key |
| `description` | As in the table of §8.1 |
| `type` | `"path"`, `"string"`, or `{ "options": [...] }` |
| `required` | As in the table of §8.1 |
| `default` | The default, or `null` |
| `value` | The value of CONFIG-012, or `null` when unset |

## 4. Setting a field

`config <key> <value>` doesn't use workspace loading (COM-070): it is how a
broken configuration gets fixed, so problems of COM-122 and COM-123
elsewhere in `config.toml` don't stop it.

The checks apply in this order; the first that fails refuses, and nothing is
written.

**CONFIG-102** If `config.toml` isn't valid TOML, then the CLI shall
refuse with COM-121's message. (Open issue CF-4.)

**CONFIG-103** The CLI shall check `<value>` as loading would check it in
`config.toml` (COM-123, COM-125). If that fails, then the CLI shall refuse
with the problem as COM-072 words it: `<key>: must not be empty — <description>`
or `overlay-syntax: "<value>" is not one of fragment | label — <description>`,
followed by an empty line and the field's hint when it has one.

**CONFIG-104** If the field is a path (`linux`, `devicetree`, `overlay`) and
`<value>`, resolved against the CWD, names nothing, then the CLI shall refuse
with `<key>: <absolute path> does not exist`. Whether it is a file or a
directory isn't checked here. (Open issue CF-5.)

**CONFIG-105** If the field is `linux` and the directory isn't a Linux tree
(COM-128), then the CLI shall refuse with `linux: no <dir>/ under <path> (not
a Linux source tree)`.

A leading `~` isn't expanded: the shell is expected to have done it.

**CONFIG-110** The CLI shall write the field to `config.toml` (COM-129), a
path made absolute, and keep the other keys.

**CONFIG-111** For a field other than `linux`, the CLI shall then answer
`Set <key> = <value>`, `<value>` as given (not made absolute).

## 5. Setting `linux`

**CONFIG-120** After writing `linux`, the CLI shall load the settings again
and build the caches (COM-112 to COM-114), even when they are current.

**CONFIG-121** When the build succeeds, the CLI shall answer `Set linux =
<value>; <summary>`, `<summary>` being the summary line of COM-112.

**CONFIG-122** If the settings fail to load or the build can't start
(COM-114), then the CLI shall refuse with `Set linux = <value>, but the
binding caches were not built:`, a newline, and the problems as COM-072 words
them.

**CONFIG-123** If compiling the schemas fails, then the CLI shall refuse
with `Set linux = <value>, but Compiling binding schemas failed:`, a newline,
the tool's error output, a newline, and `Fix the bindings and run
'attach-linux config --reload'.`

**CONFIG-124** In both cases of CONFIG-122 and CONFIG-123, `linux`
stays written (an exception to COM-042).

**CONFIG-130** While in JSON mode, the CLI shall respond with a common
object (`04-protocol/config.schema.json#/$defs/set`), `severity` `info`, its
message the answer of CONFIG-111 or CONFIG-121. In human mode it shall
write that answer.

## 6. Resetting a field

Like setting, resetting doesn't use workspace loading, so problems of COM-122
and COM-123 elsewhere in `config.toml` don't stop it.

**CONFIG-200** If `config.toml` isn't valid TOML, then the CLI shall refuse
with COM-121's message, and write nothing.

**CONFIG-201** The CLI shall remove `<key>` from `config.toml` and keep the
other keys, unknown ones included, in the order of COM-129. When `config.toml`
doesn't exist, the CLI shall write nothing. Resetting a field that isn't set
is not an error.

**CONFIG-202** The CLI shall then answer `Reset <key> (default: <default>)`
for a field with a default (`overlay-syntax`, `preprocess-command`) and
`Reset <key> (not set)` for the others: in JSON mode as a common object
(`config.schema.json#/$defs/reset`), `severity` `info`, and in human mode as
the line.

**CONFIG-203** Resetting `linux` shall leave the caches as they are; a
command that needs the bindings then reports `linux` as missing (COM-072).
Resetting `overlay` shall leave the overlay file as it is.

## 7. `--reload`

**CONFIG-021** With `--reload`, the CLI shall check the `linux` field, the
bundled dt-schema and the bundled tools (COM-114), report their problems per
COM-071 or COM-072, and otherwise build the caches (COM-112, COM-113), even
when they are current.

**CONFIG-022** When the build succeeds, the CLI shall write `Rebuilt the
binding index and validation.json.` in human mode, and in JSON mode respond
with a common object (`config.schema.json#/$defs/reloaded`) whose message is
the summary line of COM-112 (`Indexed <n> compatibles from <m> bindings and
compiled binding schemas in <duration>`).

**CONFIG-023** If compiling the schemas fails, then the CLI shall refuse
with `Compiling binding schemas failed:`, a newline, and the tool's error
output.

## 8. Open issues

**CF-2. `deploy-password` is shown in the clear,** in both modes.

**CF-3. `(default)` hides an explicit setting.** A field set to its default
looks the same as one left unset.

**CF-4. A TOML syntax error is a refusal when setting or resetting,** where
every other command, and `config` when showing, reports it as a configuration
error (COM-071, exit 2 in JSON mode), and `init` as an input error
(INIT-011).

**CF-5. Path kinds aren't checked.** `config devicetree .` and `config
overlay <directory>` succeed; the next command that loads them reports `is
not a file` (COM-127). Nor is a `.dts` or `.dtso` extension checked.

**CF-6. A refused `linux` is saved.** CONFIG-122 and CONFIG-123 answer
`ok: false` with `linux` written: an unknown key elsewhere in `config.toml`
(COM-122) makes every `config linux <path>` refuse after saving.

**CF-7. The answer echoes the value as typed.** `Set devicetree = ./base.dts`
while `config.toml` gets the absolute path.

(CF-1, `config-get` ignoring unknown names, was fixed by CONFIG-101.)

## 9. Examples

```
$ attach-linux config overlay-syntax
overlay-syntax: fragment (default)
  Output syntax for the overlay file: fragment (default) or label (&spi0 { … }) [fragment | label]

```

```
$ attach-linux --json config linux
{"ok":true,"message":"1 config field(s)","severity":"info","configs":[
 {"field_name":"linux","description":"Path to Linux kernel source tree (setting it builds the binding caches)",
  "type":"path","required":true,"default":null,"value":null}]}
```

```
$ attach-linux config nope
Unknown config field: nope. Valid fields: linux, devicetree, overlay, overlay-syntax, preprocess-command, deploy-ip, deploy-user, deploy-password
```

```
$ attach-linux --json config overlay-syntax label
{"ok":true,"message":"Set overlay-syntax = label","severity":"info"}
```

```
$ attach-linux config overlay-syntax xml
overlay-syntax: "xml" is not one of fragment | label — Output syntax for the overlay file: fragment (default) or label (&spi0 { … })
```

```
$ attach-linux config overlay-syntax --reset
Reset overlay-syntax (default: fragment)
$ attach-linux --json config deploy-ip --reset
{"ok":true,"message":"Reset deploy-ip (not set)","severity":"info"}
```

```
$ attach-linux config linux /tmp
linux: no Documentation/devicetree/bindings/ under /tmp (not a Linux source tree)
```

```
$ attach-linux --json config linux ~/linux_adi
Indexing device bindings and compiling binding schemas...                       (stderr)
Indexed 15401 compatibles from 4434 bindings and compiled binding schemas in 1m 23s   (stderr)
{"ok":true,"message":"Set linux = /home/u/linux_adi; Indexed 15401 compatibles from 4434 bindings and compiled binding schemas in 1m 23s","severity":"info"}
```

```
$ attach-linux --json config linux ~/linux_adi        # config.toml also has bogus = "x"
{"ok":false,"message":"Set linux = /home/u/linux_adi, but the binding caches were not built:\n.attach-linux/config.toml: unknown key bogus\n\nRemove unknown keys from .attach-linux/config.toml; valid keys are linux, devicetree, overlay, overlay-syntax, preprocess-command, deploy-ip, deploy-user, deploy-password.","severity":"error"}
```

```
$ attach-linux --json config --reload          # linux not set
{"errors":[{"field":"linux","kind":"missing","message":"Missing config field linux",
 "description":"Path to Linux kernel source tree (setting it builds the binding caches)"}],
 "hints":["Run 'attach-linux init' on a terminal, or 'attach-linux init --linux <path> --devicetree <path>', to set up a workspace."]}
                                                   (stderr, exit 2)
```

```
$ attach-linux config --reload
Indexing device bindings and compiling binding schemas...                       (stderr)
Indexed 15401 compatibles from 4434 bindings and compiled binding schemas in 1m 23s   (stderr)
Rebuilt the binding index and validation.json.
```
