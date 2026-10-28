# config-get

Shows the config fields and their values, or rebuilds the binding caches.

## 1. Synopsis

```
attach-linux [--json] config-get [<field>...]
attach-linux [--json] config-get --reload
```

Grammar: rule `config-get` in `01-grammar.abnf`. The fields are those of
`02-common.md` §8.1.

## 2. Resources

**CONFIGGET-001** The CLI shall load the settings (COM-120 to COM-124) and,
when they have problems, report them per COM-071 or COM-072 and do nothing
else. It needs no other resource: an unset or wrong path is shown, not
reported.

## 3. Showing fields

**CONFIGGET-010** Without field names, the CLI shall show every field. With
field names, it shall show the fields named, in the order of the table in
`02-common.md` §8.1 whatever the order given, each once.

**CONFIGGET-011** The CLI shall ignore a name that isn't a field. (Open issue
CG-1.)

**CONFIGGET-012** A field's value is the setting as loaded: a path absolute
(COM-125), a field that isn't set its default, and a field with neither
unset. The CLI shall show `deploy-password` as it is stored. (Open issue
CG-2.)

**CONFIGGET-013** While in human mode, the CLI shall write for each field
shown:

```
<field>[ [required]]: <shown value>
  <description>[ [<option> | <option>]]

```

`<shown value>` is `(not set)` for an unset field, `<value> (default)` when the
value equals the default (set or not), and `<value>` otherwise. The options
follow the description for a field that has them (`overlay-syntax`).

**CONFIGGET-014** While in human mode, when a field shown is required and
unset, the CLI shall then write an empty line and the hints of those fields
(`02-common.md` §8.1), each once, in field order.

**CONFIGGET-015** While in JSON mode, the CLI shall respond with an object
conforming to `config.schema.json#/$defs/fields`: `message` `<n> config
field(s)`, `<n>` the number of fields shown, and `configs`, one entry per
field:

| Field | Value |
|---|---|
| `field_name` | The key |
| `description` | As in the table of §8.1 |
| `type` | `"path"`, `"string"`, or `{ "options": [...] }` |
| `required` | As in the table of §8.1 |
| `default` | The default, or `null` |
| `value` | The value of CONFIGGET-012, or `null` when unset |

## 4. `--reload`

**CONFIGGET-020** If `--reload` is given with field names, then the CLI shall
refuse with `--reload rebuilds the caches and takes no field names`.

**CONFIGGET-021** With `--reload`, the CLI shall check the `linux` field, the
bundled dt-schema and the bundled tools (COM-114), report their problems per
COM-071 or COM-072, and otherwise build the caches (COM-112, COM-113), even
when they are current.

**CONFIGGET-022** When the build succeeds, the CLI shall write `Rebuilt the
binding index and validation.json.` in human mode, and in JSON mode respond
with a common object (`config.schema.json#/$defs/reloaded`) whose message is
the summary line of COM-112 (`Indexed <n> compatibles from <m> bindings and
compiled binding schemas in <duration>`).

**CONFIGGET-023** If compiling the schemas fails, then the CLI shall refuse
with `Compiling binding schemas failed:`, a newline, and the tool's error
output.

## 5. Open issues

**CG-1. Unknown field names are ignored.** `config-get nope` prints nothing
and exits 0; in JSON mode it answers `0 config field(s)`. `config-set` refuses
the same name.

**CG-2. `deploy-password` is shown in the clear,** in both modes.

**CG-3. `(default)` hides an explicit setting.** A field set to its default
looks the same as one left unset.

## 6. Examples

```
$ attach-linux config-get overlay-syntax nope
overlay-syntax: fragment (default)
  Output syntax for the overlay file: fragment (default) or label (&spi0 { … }) [fragment | label]

```

```
$ attach-linux --json config-get linux overlay-syntax
{"ok":true,"message":"2 config field(s)","severity":"info","configs":[
 {"field_name":"linux","description":"Path to Linux kernel source tree (setting it builds the binding caches)",
  "type":"path","required":true,"default":null,"value":null},
 {"field_name":"overlay-syntax","description":"Output syntax for the overlay file: fragment (default) or label (&spi0 { … })",
  "type":{"options":["fragment","label"]},"required":false,"default":"fragment","value":"fragment"}]}
```

```
$ attach-linux --json config-get --reload          # linux not set
{"errors":[{"field":"linux","kind":"missing","message":"Missing config field linux",
 "description":"Path to Linux kernel source tree (setting it builds the binding caches)"}],
 "hints":["Run 'attach-linux init' on a terminal, or 'attach-linux init --linux <path> --devicetree <path>', to set up a workspace."]}
                                                   (stderr, exit 2)
```

```
$ attach-linux config-get --reload
Indexing device bindings and compiling binding schemas...                       (stderr)
Indexed 15401 compatibles from 4434 bindings and compiled binding schemas in 1m 22s   (stderr)
Rebuilt the binding index and validation.json.
```
