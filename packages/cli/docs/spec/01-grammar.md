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

**GRM-001** The CLI shall remove every element equal to `--json` that comes
before the first `--`, run in JSON mode when it removed one, and parse the
remaining elements with this grammar. A `--json` after `--` is an ordinary
element: in `add x -- --json`, it is a positional. A `--json` where an
option's value would be is removed too: `--json add x --label` and `add x
--label --json` both report `Expected input for flag --label`.

**GRM-002** When the first element of argv is `__complete`, the CLI shall run
shell completion with the elements after the first `--`, or with all elements
after `__complete` when there is no `--`, and then exit with status 0. GRM-001
doesn't apply to such a run. (Specified in `05-completion.md`.) The commands
of the grammar are the shared ones and those of the backend (COM-013): the
rules of `01-grammar.abnf` marked `linux` exist where the backend is linux.

**GRM-003** While in human mode, when argv is empty and the run is a
terminal run (COM-012), the CLI shall run the setup run (`setup.md`).

**GRM-004** When argv (after GRM-001) matches no `command-line`, the CLI shall
report an input error (COM-031) giving the reason, worded as the argument
parser (stricli) words it:

| Problem | Message |
|---|---|
| unknown command | ``No command registered for `<words>` `` (all the words from the unknown one on, joined with spaces), with `` , did you mean `<match>`?`` before the end when one is close (`` No command registered for `nope`, did you mean `move`? ``) |
| unknown flag | `No flag registered for --<name>`, with `, did you mean --<match>?` when one is close |
| unknown short flag | `No alias registered for -<letter>` (the first letter only: `-abc` gives `-a`) |
| a flag's value missing | `Expected input for flag --<name>` |
| a required positional missing | `Expected argument for <name>` (`rename a` gives `Expected argument for new-name`) |
| too many positionals | `Too many arguments, expected <n> but encountered "<element>"` |
| a flag's value that doesn't parse | `Failed to parse "<value>" for <name>: <reason>` (`--quiet=x`: `Cannot convert x to a boolean`) |
| a flag given twice | `Too many arguments for --<name>, encountered "<value>" after "<value>"` |

**GRM-005** When argv is empty and the run isn't a terminal run, or argv is
the one element `--quiet`, the CLI shall write the program's usage to
standard output and exit with status 0. In JSON mode (`analog-attach
--json`), it shall write the usage to standard error and exit with status 2.

**GRM-008** The usage and the help of the program shall list the commands of
the backend: the shared ones it provides and its own (COM-015), each in its
group, then the line `Backend: <id> (<title>).`, followed by ` Another:
'analog-attach config backend <other>'.` when there is one other backend,
or ` Others: 'analog-attach config backend <a|b>'.` when there are several.
With no backend set, that line is COM-014's message. Where the backend is
linux, the line is `Backend: linux (Linux device tree overlays). Another:
'analog-attach config backend noos'.`.

The grammar accepts any element as a `completion` shell; what the command
does with one it doesn't know is in `05-completion.md` (COMPL-101).

## 3. Options

**GRM-010** The CLI shall accept a command's options in any position after
the command name: before, between or after its positionals.

**GRM-011** The CLI shall accept the value of an option that takes one either
as the next element (`--parent spi0`) or in the same element after `=`
(`--parent=spi0`).

**GRM-012** When an element is `--`, the CLI shall read every element after
it as a positional, even one that starts with `-`.

**GRM-013** If an element before `--` is `-` and a letter, or `--` and two
or more characters, and is neither an option of the command nor the value of
the option before it, then the CLI shall report an input error (GRM-004). An
element that is `-` alone, `-` and a digit (`-5`, `-0x10`), or `--` and one
character (`--x`) is a positional: `read -` refuses with `Not found: -`.
(Open issue G-3.)

**GRM-014** When a command's options include `--help` or `-h`, the CLI shall
print that command's help on standard output and do nothing else, in both
modes.

**GRM-015** When the first element is `--version` or `-v`, the CLI shall
print the version (`0.1.0`) on standard output and do nothing else, in both
modes, whatever follows. After a command, `--version` is an unknown flag and
`-v` an unknown short flag (GRM-004).

**GRM-016** When the first element is `help`, the CLI shall do what the
elements after it followed by `--help` do: `help read` is `read --help`, and
`help` alone is `--help`.

**GRM-017** The CLI shall accept a value for a flag that takes none, given
after `=`: `true`, `false` and the other words of stricli's boolean parser
(`--quiet=true`). Any other value is GRM-004's parse failure.

**GRM-018** When argv is only the name of a group of commands (`list`,
`skill`), the CLI shall write the group's usage, its commands and its flags
to standard output and exit with status 0, in both modes. (Open issue G-4.)

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

A value element that starts with `-` and a digit is a positional (GRM-013),
so a negative number needs no `--`: `update adc offset -5`. A word that
starts with `-` and a letter does: `update adc label -- -x`.

## 10. Where the backend is noos

The workfile is flat: its nodes have names, not paths, and no labels or unit
addresses.

**GRM-080** Where the backend is noos, the CLI shall read a node positional
(`noos-node`) as one node name of the workfile, as it is: `/` and `@` are
part of the name, and GRM-020 to GRM-030 don't apply (`read testpart/`
names no node: GRM-024 doesn't apply either). An empty node name is the same
as none for `read` and `delete`; for the other commands it names no node. A
name the workfile doesn't have is refused by the command
(`03-commands/read.md` READ-505).

**GRM-081** Where the backend is noos, the CLI shall pass an `update`
command's value elements to the command unjoined: one element is the value,
two are a union's member and its value (`03-commands/update.md` UPDATE-501,
UPDATE-510). GRM-070 to GRM-074 don't apply.

**GRM-082** Where the backend is noos, the CLI shall read `add --as` as a
list of interfaces separated by `,`, and a repeated `--as` as more of them
(`03-commands/add.md` ADD-504).

## 11. Positionals by command

The arguments each command takes, as declared. The command chapters give
their meaning. Rows marked *linux* exist where the backend is linux, rows
marked *noos* where it is noos.

| Command | Positionals | Options |
|---|---|---|
| `config` | `[key] [value...]` | `--global`, `--reset`, `--reload` |
| `init` | | |
| `import` | `<source>` | |
| `add` | `[device]` (linux: `[compatible]`) | `--name <name>`, `--quiet`; linux: `--parent <path>`, `--label <label>`, `--template <template>`; noos: `--as <interface>` |
| `read` | `[path] [property]` | `--quiet` |
| `update` | `[path] [property] [value...]` | `--quiet`; noos: `--suggest` |
| `delete` | `[path] [property]` | `--force` |
| `rename` | `<path> <new-name>` | |
| `list devices` | `[filter]` | |
| `list property` | `[path] [property]` | |
| `list value` | `<path> <property> [member]` | |
| `list context` (noos) | | |
| `list parent` (linux) | `<compatible>` | |
| `list overlay` (linux) | `<compatible>` | |
| `move` (linux) | `<path> <destination>` | |
| `enable`, `disable` (linux) | `[path]` | |
| `validate` | | |
| `build` | | noos: `--board <board>`, `--clean` |
| `deploy` | | noos: `--board <board>`, `--probe <probe>` |
| `generate` (noos) | | `--output <directory>`, `--project-template <template>`, `--board <board>` |
| `completion` | `[shell]` | `--install`, `--uninstall` |
| `skill install` | `<name>` | `--force` |
| `skill uninstall` | `<name>` | |

Positionals shown as `[…]` are optional for the grammar. What a command does
without them is in its chapter: `read` with no path prints the workfile,
`delete` with no path previews deleting all of it, `add` reports `Missing:
compatible (add <compatible>)`, `enable`, `disable` and `update` report
`Missing: path`. `list` alone, and `skill` alone, print their usage with
status 0. Where the backend is linux, `list value` with a member reports the
input error `A member is not supported by the linux backend: <member>`, and
`list context` is not supported (COM-015). Where the backend is noos, `list
property` with a property is the input error of `03-commands/list.md`
LIST-522, and `update` with more than two values that of UPDATE-501.

## 12. Open issues

**G-1. The path checks are applied by three commands only.** `delete`,
`move`, `rename`, `enable`, `disable` and `list` skip GRM-020 to
GRM-023 (a trailing `/` still works, GRM-024): `&spi0` gives a not-found
message instead of `Use the bare form`, and `spi0//x` resolves. `update`
skips GRM-030 (`update.md` U-5).

**G-2.** *Fixed.* (`-V` couldn't be an option's value. The version flag is
now `-v` or `--version`, and only as the first element, GRM-015.)

**G-3. Some elements that look like flags are positionals.** stricli reads
an element as a flag only when it is `-` and a letter or `--` and two or more
characters (GRM-013). So `read --x` and `read --q` refuse with `Not found:
--x` where `read --qu` gives `No flag registered for --qu, did you mean
--quiet?`, and a mistyped one-letter long flag is silently taken as a path or
a value. Negative numbers (`update adc offset -5`) work without `--` for the
same reason.

**G-4. A group alone answers usage even under `--json`.** `analog-attach
--json list` writes the text usage on standard output with status 0
(GRM-018), while the program's usage under `--json` goes to standard error
with status 2 (GRM-005).
