# Command-line grammar

The grammar is in [`01-grammar.abnf`](01-grammar.abnf). This chapter says how
to read it and states the rules ABNF can't express. What a command does with
well-formed input is in its chapter under `03-commands/`.

## 1. Two layers

The shell gives the CLI an argument vector (argv), already split into
elements. The grammar has two layers:

- **Layer 1** matches argv. Its terminals are whole elements, and `B` stands
  for the boundary between two elements. `B` is written `%x00` only so the
  file is valid ABNF; no NUL character is involved.
- **Layer 2** matches the characters inside one element: paths, property
  names, labels, node names, templates and `update` values.

A rule such as `add = %s"add" B compatible *( B add-option )` therefore means
the element `add`, then one element matching `compatible`, then zero or more
options.

## 2. Argument vector

**GRM-001** When argv contains an element equal to `--json`, the CLI shall
remove the first such element, run in JSON mode, and parse the remaining
elements with this grammar. Later `--json` elements are ordinary elements:
in `--json add x --label --json`, the second one is the value of `--label`.

**GRM-002** When the first element of argv is `__complete`, the CLI shall run
shell completion with the elements after the first `--`, or with all elements
after `__complete` when there is no `--`, and then exit with status 0. GRM-001
doesn't apply to such a run. (Specified in `05-completion.md`.)

**GRM-003** While in human mode, when argv is empty and the run is a
terminal run (COM-012), the CLI shall run the setup run (`setup.md`).

**GRM-004** When argv (after GRM-001) matches no `command-line`, the CLI shall
report an input error (COM-030) giving the reason, worded as commander words
it: `error: unknown command '<name>'`, `error: missing required argument
'<name>'`, `error: unknown option '<option>'`, `error: option '<flags>'
argument missing` (`<flags>` as declared: `--linux <path>`), `error: too many
arguments for '<command>'. Expected <n> argument<s> but got <m>.`, where
`<s>` is `s` unless `<n>` is 1. When commander finds a close match for an
unknown command or option, a second line follows: `(Did you mean <match>?)`
(`move a` gives `(Did you mean move?)`, `--quiet=x` gives `(Did you mean
--quiet?)`).

**GRM-005** While in human mode, when argv is empty and the run isn't a
terminal run, or argv is the one element `--quiet`, the CLI shall write the
program's usage to standard error and exit with status 1. (In JSON mode, see open issue C-2 in `02-common.md`.)

The grammar accepts any element as a `list` kind, a `completion` shell or a
`ui` port; what the command does with one it can't use is in its chapter
(`list.md` LIST-002, `05-completion.md` CO-6, `ui.md` UI-001). Those aren't
commander's input errors.

## 3. Options

**GRM-010** The CLI shall accept a command's options in any position after
the command name: before, between or after its positionals.

**GRM-011** The CLI shall accept the value of an option that takes one either
as the next element (`--parent spi0`) or in the same element after `=`
(`--parent=spi0`).

**GRM-012** When an element is `--`, the CLI shall read every element after
it as a positional, even one that starts with `-`.

**GRM-013** If an element starts with `-`, is longer than `-`, isn't after
`--`, and is neither an option of the command nor the value of the option
before it, then the CLI shall report an input error (`error: unknown option
'<element>'`, GRM-004). A lone `-` is a positional: `read -` refuses with
`Not found: -`.

**GRM-014** When a command's options include `--help` or `-h`, the CLI shall
print that command's help and do nothing else.

**GRM-015** When an element before `--` is `--version` or `-V`, the CLI
shall print the version and do nothing else, before or after the command:
`attach-linux add x -V` prints `0.1.0`. This holds even where the element
would be an option's value: `add x --label -V` prints the version, while
`--label=-V` is the label `-V`. (Open issue G-2.)

## 4. Node paths

A node path is one element. It has three forms:

| Form | Example | Means |
|---|---|---|
| Absolute | `/soc/spi@7e204000` | The node at that path |
| Label | `spi0` | The node with that label |
| Label-first | `spi0/adc@0` | The child `adc@0` of the node labelled `spi0` (more segments go deeper) |

GRM-020 to GRM-023 are the path checks. Only these commands apply them; the
others take any element as a path and report a path that names no node as
not found (open issue G-1). GRM-024 holds for every command: the others'
node lookup ignores a trailing `/` too (`enable spi0/`, `delete
ad7124_8/channel@0/`).

| Command | Checked |
|---|---|
| `add` | `--parent`, and a parent typed at the parent question |
| `read` | the path, and the property name (GRM-030) |
| `update` | the path (not the property name) |

**GRM-020** If a node path is empty, then the CLI shall report the input
error `Missing: path`.

**GRM-021** If a node path starts with `&`, then the CLI shall report the
input error `Use the bare form: <bare>`, where `<bare>` is the path without
`&`, or without `&{` and `}` when it is written `&{…}`.

**GRM-022** If a node path contains whitespace, then the CLI shall report the
input error `a path is one token (join segments with /)`.

**GRM-023** If a node path contains `//`, then the CLI shall report the input
error `empty segment in path: <path>`.

**GRM-024** The CLI shall ignore one trailing `/` of a node path other than
`/`: `spi0/` is `spi0`.

The checks GRM-020 to GRM-023 apply in that order. GRM-021 to GRM-023 are
stricter than layer 2 of the ABNF says: `path-char` doesn't name every
whitespace character JavaScript's `\s` matches (U+00A0, U+2028, …), and the
CLI refuses those too.

### 4.1 Resolution

**GRM-025** The CLI shall resolve an absolute path to the node at that path
in the merged tree.

**GRM-026** The CLI shall resolve a label to the node that has that label in
the base or the overlay.

**GRM-027** The CLI shall resolve a label-first path by resolving its first
segment as a label, first in the base and then in the overlay, and appending
the remaining segments to that node's absolute path.

What a command does when the path names no node is in its chapter.

## 5. Property names

**GRM-030** If a property name is empty, then the CLI shall report the input
error `Missing: property name`. If it contains `/`, then the CLI shall report
the input error `pass node and property separately`. (Applied by `read` only;
see the table in §4. `update` reports the same `Missing: property name` when
the property is left out, but doesn't check an empty one or a `/`:
`update.md` UPDATE-001, U-5.)

## 6. Labels

**GRM-040** A label the user gives the CLI to create (`add --label`) shall
match `label`: a letter or `_`, then letters, digits and `_`. The command
chapter says what happens to one that doesn't.

## 7. Node names

**GRM-050** The CLI shall read a node name as `<base-name>@<unit-address>`,
splitting at the first `@`, or as a base name alone when there is no `@`.
What a command does with an empty base name or unit address is in its
chapter: `add` refuses `name@` (ADD-043), `rename` takes it and drops the
`@` (`rename.md` N-2).

## 8. Templates

**GRM-060** The CLI shall accept as `add --template` exactly the forms of
`template`: `required`, `example:<N>` with `<N>` an integer from 1 without
a sign or leading zeros, and `overlay:<ref>` with a non-empty `<ref>` that may
contain `:` and `/`. Anything else is an input error, with these messages:

| Input | Message |
|---|---|
| `example` | `--template example needs the example's number: example:<N> (the position in the binding's examples)` |
| `example:<x>`, `<x>` not a valid `<N>` | `--template example:<x>: the example number must be a positive integer (example:1, example:2, ...)` |
| `overlay` or `overlay:` | `--template overlay needs an overlay: overlay:<name> (a name from 'list overlay <compatible>', or a file path)` |
| anything else | `Unknown --template <input> (use required, example:<N> or overlay:<name>)` |

## 9. update values

The value of `update <path> <property> <value>...` may span several elements:
`update adc diff-channels 0 1`, or `update adc diff-channels "0 1"`.

**GRM-070** The CLI shall join an `update` command's value elements with one
space and parse the result as `value`: rows separated by `,`, each row cells
separated by whitespace (JavaScript `\s`, which is wider than ABNF's `WSP`).
Leading and trailing whitespace of the value and of each row is ignored.
GRM-074 is the exception.

**GRM-071** The CLI shall read a cell that matches `dec-int` as a decimal
number, a cell that matches `hex-int` as a hexadecimal number, and any other
cell as a word. (The ABNF alternatives overlap. This rule chooses.) Under
GRM-074 numbers are strings too.

**GRM-072** A value with one row is a list of cells, and a value with one
cell is that cell. A value with several rows is a list of rows:
`<&gpio 5 0>, <&gpio 6 0>` is written `gpio 5 0, gpio 6 0`.

**GRM-073** Words are interpreted (macro, label, string) by `update` and not
by the grammar; see `03-commands/update.md`.

**GRM-074** Where the binding gives the property strings (`update.md`
UPDATE-031), the CLI shall not parse the value as `value`: it shall split the
joined value at whitespace only and write each piece as a string, `,` and
numbers included. `update spi0 compatible "adi,x, y"` writes `compatible =
"adi,x,", "y";`. With no shape hint, a value of words that don't resolve is
parsed per GRM-070 and its `,` dropped: `adi,x` is written `"adi", "x"`
(`update.md` UPDATE-033, U-15).

A value element that starts with `-` is read as an option (GRM-013), so a
negative number needs `--` before it: `update adc offset -- -5`.

## 10. Positionals by command

The arguments each command takes, as declared. The command chapters give
their meaning.

| Command | Positionals | Options |
|---|---|---|
| `add` | `<compatible>` | `--parent <path>`, `--name <name>`, `--label <label>`, `--template <template>`, `--quiet` |
| `import` | `<overlay>` | |
| `read` | `[path] [property]` | `--quiet` |
| `update` | `[path] [property] [value...]` | `--quiet` |
| `delete` | `[path] [property]` | `--force` |
| `move` | `<path> <destination>` | |
| `rename` | `<path> <new-name>` | |
| `enable`, `disable` | `[path]` | |
| `list` | `[kind] [args...]` | |
| `build`, `validate`, `deploy` | | |
| `config` | `[key] [value]` | `--reset`, `--reload` |
| `init` | | |
| `install-skill` | | `--force` |
| `uninstall-skill` | | |
| `completion` | `[shell]` | `--install`, `--uninstall` |
| `__list` (hidden) | `[args...]` | |
| `ui` (hidden) | | `--port <number>`, `--open` |

Positionals shown as `[…]` are optional for the grammar. What a command does
without them is in its chapter: `read` with no path prints the overlay,
`delete` with no path previews deleting all of it, `enable`, `disable` and
`update` report `Missing: path`, and the `list` kinds have their own messages
(LIST-005).

## 11. Open issues

**G-1. The path checks are applied by three commands only.** `delete`,
`move`, `rename`, `enable`, `disable`, `list` and `__list` skip GRM-020 to
GRM-023 (a trailing `/` still works, GRM-024): `&spi0` gives a not-found
message instead of `Use the bare form`, and `spi0//x` resolves. `update`
skips GRM-030 (`update.md` U-5).

**G-2. `-V` can't be an option's value.** Commander reads the program's own
option `--version` anywhere in argv before the command reads its options, so `attach-linux add
adi,ad7124-8 --label -V` prints `0.1.0` and adds nothing (GRM-015), where
`--label -h` or `--label -x` are taken as the label. A fix would be to
register `--version` so it is recognised only before the command, or to
tell users to write `--label=-V`.
