# config-set

Sets one config field. Setting `linux` also builds the binding caches.

## 1. Synopsis

```
attach-linux [--json] config-set <field> <value>
```

Grammar: rule `config-set` in `01-grammar.abnf`. The fields are those of
`02-common.md` §8.1.

## 2. Resources

`config-set` doesn't use workspace loading (COM-070): it is how a broken
configuration gets fixed, so problems of COM-122 and COM-123 elsewhere in
`config.toml` don't stop it.

## 3. Checks

The checks apply in this order; the first that fails refuses, and nothing is
written.

**CONFIGSET-001** If `<field>` isn't a field, then the CLI shall refuse with
`Unknown config field: <field>. Valid fields: linux, devicetree, overlay,
overlay-syntax, preprocess-command, deploy-ip, deploy-user, deploy-password`.

**CONFIGSET-002** If `config.toml` isn't valid TOML, then the CLI shall
refuse with COM-121's message. (Open issue CS-1.)

**CONFIGSET-003** The CLI shall check `<value>` as loading would check it in
`config.toml` (COM-123, COM-125). If that fails, then the CLI shall refuse
with the problem as COM-072 words it: `<field>: must not be empty — <description>`
or `overlay-syntax: "<value>" is not one of fragment | label — <description>`,
followed by an empty line and the field's hint when it has one.

**CONFIGSET-004** If the field is a path (`linux`, `devicetree`, `overlay`) and
`<value>`, resolved against the CWD, names nothing, then the CLI shall refuse
with `<field>: <absolute path> does not exist`. Whether it is a file or a
directory isn't checked here. (Open issue CS-2.)

**CONFIGSET-005** If the field is `linux` and the directory isn't a Linux tree
(COM-128), then the CLI shall refuse with `linux: no <dir>/ under <path> (not
a Linux source tree)`.

A leading `~` isn't expanded: the shell is expected to have done it.

## 4. Writing

**CONFIGSET-010** The CLI shall write the field to `config.toml` (COM-129), a
path made absolute, and keep the other keys.

**CONFIGSET-011** For a field other than `linux`, the CLI shall then answer
`Set <field> = <value>`, `<value>` as given (not made absolute).

## 5. Setting `linux`

**CONFIGSET-020** After writing `linux`, the CLI shall load the settings again
and build the caches (COM-112 to COM-114), even when they are current.

**CONFIGSET-021** When the build succeeds, the CLI shall answer `Set linux =
<value>; <summary>`, `<summary>` being the summary line of COM-112.

**CONFIGSET-022** If the settings fail to load or the build can't start
(COM-114), then the CLI shall refuse with `Set linux = <value>, but the
binding caches were not built:`, a newline, and the problems as COM-072 words
them.

**CONFIGSET-023** If compiling the schemas fails, then the CLI shall refuse
with `Set linux = <value>, but Compiling binding schemas failed:`, a newline,
the tool's error output, a newline, and `Fix the bindings and run
'attach-linux config-get --reload'.`

**CONFIGSET-024** In both cases of CONFIGSET-022 and CONFIGSET-023, `linux`
stays written (an exception to COM-042).

## 6. Result

**CONFIGSET-030** While in JSON mode, the CLI shall respond with a common
object (`04-protocol/config.schema.json#/$defs/set`), `severity` `info`, its
message the answer of CONFIGSET-011 or CONFIGSET-021. In human mode it shall
write that answer.

## 7. Open issues

**CS-1. A TOML syntax error is a refusal here,** where every other command
reports it as a configuration error (COM-071, exit 2 in JSON mode) and `init`
as an input error (INIT-011).

**CS-2. Path kinds aren't checked.** `config-set devicetree .` and
`config-set overlay <directory>` succeed; the next command that loads them
reports `is not a file` (COM-127). Nor is a `.dts` or `.dtso` extension
checked.

**CS-3. A refused `linux` is saved.** CONFIGSET-022 and CONFIGSET-023 answer
`ok: false` with `linux` written: an unknown key elsewhere in `config.toml`
(COM-122) makes every `config-set linux` refuse after saving.

**CS-4. The answer echoes the value as typed.** `Set devicetree = ./base.dts`
while `config.toml` gets the absolute path.

## 8. Examples

```
$ attach-linux --json config-set overlay-syntax label
{"ok":true,"message":"Set overlay-syntax = label","severity":"info"}
```

```
$ attach-linux config-set overlay-syntax xml
overlay-syntax: "xml" is not one of fragment | label — Output syntax for the overlay file: fragment (default) or label (&spi0 { … })
```

```
$ attach-linux config-set linux /tmp
linux: no Documentation/devicetree/bindings/ under /tmp (not a Linux source tree)
```

```
$ attach-linux --json config-set linux ~/linux_adi
Indexing device bindings and compiling binding schemas...                       (stderr)
Indexed 15401 compatibles from 4434 bindings and compiled binding schemas in 1m 23s   (stderr)
{"ok":true,"message":"Set linux = /home/u/linux_adi; Indexed 15401 compatibles from 4434 bindings and compiled binding schemas in 1m 23s","severity":"info"}
```

```
$ attach-linux --json config-set linux ~/linux_adi        # config.toml also has bogus = "x"
{"ok":false,"message":"Set linux = /home/u/linux_adi, but the binding caches were not built:\n.attach-linux/config.toml: unknown key bogus\n\nRemove unknown keys from .attach-linux/config.toml; valid keys are linux, devicetree, overlay, overlay-syntax, preprocess-command, deploy-ip, deploy-user, deploy-password.","severity":"error"}
```
