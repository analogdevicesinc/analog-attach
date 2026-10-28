# __list (hidden)

The engine behind `list property`, `list value`, `list parent` and shell
completion: one *suggestion kind* per call. It isn't in `--help`. Shell
completion (`__complete`, `05-completion.md`) calls it in the same process in
JSON mode and reads its responses; `list` calls it for the kinds above. Nothing
is written.

## 1. Synopsis

```
attach-linux [--json] __list <kind> [<arg>...]
```

Grammar: rule `internal-list` in `01-grammar.abnf`, with:

```
internal-list-args = kind *( B element )
kind            = %s"parent" / %s"device-key" / %s"overlay" / %s"template"
                / %s"node-prop" / %s"navigate" / %s"overlay-props"
                / %s"children" / %s"type" / %s"value"
```

## 2. Arguments

Kinds that take a node path join their arguments with `/` before using them
(`resolve_positional_path`): `__list children spi0 adc@0` is `spi0/adc@0`. An
argument starting with `/` keeps its leading `/`. Kinds that take a node and a
property (`type`, `value`) join all arguments with `/` and split at the last
`/` (`parse_property_reference`): `__list value adc reg` and `__list value
adc/reg` are the same call. As in `list`, none of the checks GRM-020 to GRM-024
are made (LIST-004).

## 3. Common

**INTLIST-001** If no kind is given, then the CLI shall report an input error:
`kind is required` in JSON mode (exit 2), `Missing: kind (first positional
argument)` in human mode.

**INTLIST-002** If the kind is unknown, then the CLI shall refuse with
`Unknown suggestion kind: <kind>`.

**INTLIST-003** Each kind shall respond, in JSON mode, with `{"ok": true,
"message": <m>, "severity": "info", "suggestions": [...]}`
(`list.schema.json#/$defs/suggestions-response`), except `type`
(LIST-054's response). A node that isn't there is a refusal `Node <path> not
found` (human mode: `Node not found: <path>`), except for `overlay-props`
(INTLIST-071) and the property case of `navigate` (INTLIST-052).

**INTLIST-004** In human mode each kind shall write one line per suggestion:
the value, or the value, two spaces and the display where noted.

## 4. Kinds

| Kind | Args | Loads | What it lists | `message` |
|---|---|---|---|---|
| `parent` | `<compatible>` | bindings, base | `list parent` (§8 of `list.md`) | `Found <n> valid parents` |
| `device-key` | `[<filter>]` | bindings | `{ value }` for each compat-index compatible containing the filter | `Found <n> devices` |
| `overlay` | `[<prefix>]` | bindings | `{ value: <file name>, display_string: <path in the tree> }` for each overlay file (LIST-110) whose file name starts with the prefix; no scan | `Found <n> overlays` |
| `template` | `<compatible>` | bindings, base | the `add --template` values (INTLIST-030) | `Found <n> templates` |
| `node-prop` | `<path>` | bindings, base, overlay | `list property <path>` (§5 of `list.md`) | as LIST-036 |
| `navigate` | `[<path>]` | base, overlay; bindings when they load | INTLIST-050 to INTLIST-053 | `Found <n> entry points` / `Found <n> items` |
| `overlay-props` | `[<path>]` | base, overlay | INTLIST-070, INTLIST-071 | `Found <n> properties` |
| `children` | `<path>` | base, overlay | `{ value }` for each child name of the node, found per INTLIST-012: the base's first, then the overlay's, each once | `Found <n> child node(s)` |
| `type` | `<path> <property>` | bindings, base, overlay | `list property <path> <property>` (§6 of `list.md`) | `Type of <property>` |
| `value` | `<path> <property>` | base, overlay; bindings when they load | `list value` (§7 of `list.md`) | as LIST-076 |

**INTLIST-010** The CLI shall behave for `parent`, `node-prop`, `type` and
`value` exactly as the `list` kinds the table names, including their
refusals, with the arguments joined per §2.

**INTLIST-011** A missing required argument shall be an input error, with
these messages in JSON mode, and in human mode the second:

| Kind | JSON mode | Human mode |
|---|---|---|
| `parent`, `template` | `compatible string is required for parent suggestions` / `… for template suggestions` | `Missing: compatible string` |
| `node-prop`, `children` | `node reference is required for node-prop suggestions` / `… for children suggestions` | `Missing: node reference` |
| `type`, `value` (no property after the last `/`) | `prop-ref must contain a node reference and a property name` | `Missing: prop-ref (node reference followed by property name)` |

**INTLIST-012** For `children`, and for `navigate` with a path, the CLI
shall find the node in the overlay by the path (resolved per GRM-025 to
GRM-027), and in the base only by an absolute path or a bare label (a
leading `&` removed). So:

- a label-first path to a node the overlay doesn't have (`spi0/spidev@0`,
  `gpio/dpi-gpio0`) names no node: both kinds refuse with `Node
  spi0/spidev@0 not found`, though `list property`, `list value` and `read`
  find it, and its absolute path works (open issue IL-3);
- `children &spi0` lists the base node's children only, without those the
  overlay adds under it (`navigate &spi0` is "not found", LIST-004).

### 4.1 `template`

**INTLIST-030** The CLI shall list `{ value: "required", display_string:
"interview for the required properties" }`; then, when the compatible has a
binding, `{ value: "example:<N>", display_string: <bus> }` for each example
that holds the device (ADD-060), `<bus>` being `SPI`, `I2C`, or `binding
example`; then `{ value: "overlay:<name>", display_string: "<fit>
(<reason>)[ via <matched>]" }` for each overlay `list overlay <compatible>`
gives, in its order. `<name>` is the file name, or the path in the tree when
the file name alone matches several overlays. In human mode each line is
`<value>  <display_string>`.

### 4.2 `navigate`

**INTLIST-050** Without a path, the CLI shall list the overlay's fragment
targets, each once, in file order: a label as the bare label, a path as the
path (`spi0`, `/`).

**INTLIST-051** With a path that names a node per INTLIST-012, the CLI
shall list, in this order: the node's children (`group: "set"`); the
narrowed binding's properties the merged node has; the node's properties the
binding doesn't name (all `"set"`); the binding's properties it doesn't have;
then the names the binding's patterns allow (all `"not set"`). A required
property has `display_string: "<name> (required)"`. The pattern names are
those of LIST-034 not yet set (`"<name> (pattern)"`) and the child names of
the child-node patterns not yet present (`"<name> (child node)"`), or the
pattern's stem as `{ value: <stem>, display_string: "<stem>… (<kind>
<regex>)", partial: true }` when it fixes only a start. An unanchored pattern
gives nothing. Without a binding, only the children and the node's properties
are listed.

**INTLIST-052** When the path names no node but its last segment is a
property of the node before it in the overlay, the CLI shall respond `{"ok":
true, "message": "<property> is a property", "severity": "info",
"suggestions": []}` in JSON mode and write nothing in human mode.

**INTLIST-053** In human mode the CLI shall write each suggestion's display,
or its value when it has none, without the groups.

### 4.3 `overlay-props`

**INTLIST-070** The CLI shall list `{ value: <name>, group: "set" }` for each
property the overlay sets on the node, the value that applies when several
fragments set one (the ones `delete <path> <property>` can remove).

**INTLIST-071** When the path is missing or names no node of the overlay, the
CLI shall respond with no suggestions (`Found 0 properties`), not a refusal.

## 5. Open issues

**IL-1. `value` and `type` join every argument.** `__list value adc
clock-names extra` reads node `adc/clock-names` and property `extra` (a
refusal), where `list value adc clock-names extra` ignores `extra`
(LIST-003).

**IL-2. `device-key` filters by substring, `overlay` by prefix.**

**IL-3. `navigate` and `children` miss base nodes under a label.** The base
lookup in `node_children` (`src/commands/list/suggest.ts`) goes through
attach-lib's `Devicetree.resolve_identifier`, which reads `spi0/spidev@0` as
one label name. `__list navigate spi0/spidev@0` and `__list children
spi0/spidev@0` refuse with `Node spi0/spidev@0 not found`, so `read
spi0/spidev@0 <Tab>` and `read spi0/spidev@0/<Tab>` complete nothing
(`05-completion.md` COMPL-051, COMPL-060), while `/soc/spi@7e204000/spidev@0`
works. The same function strips `&`, so `__list children &spi0` succeeds with
the base's children only, where every other `list` path with `&` is not
found (`list.md` L-1). A fix would be to look the base node up as
`effective_target_node` does (resolve the label-first path to an absolute
one first), and to treat `&` as `resolve_node_identifier` does.

## 6. Examples

```
$ attach-linux --json __list navigate
{"ok":true,"message":"Found 2 entry points","severity":"info","suggestions":[{"value":"spi0"},{"value":"/"}]}

$ attach-linux --json __list navigate adc/reg
{"ok":true,"message":"reg is a property","severity":"info","suggestions":[]}

$ attach-linux __list template adi,ad7124-8
required  interview for the required properties
example:1  SPI
overlay:rpi-ad7124-8-all-diff-overlay.dts  compatible (family: brcm,bcm2835 → raspberrypi)
…
overlay:rpi-ad7124-overlay.dts  compatible (family: brcm,bcm2835 → raspberrypi) via adi,ad7124-4
```
