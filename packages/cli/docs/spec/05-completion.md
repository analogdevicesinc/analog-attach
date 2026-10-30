# Shell completion

Completion has two parts. The engine, `analog-attach __complete`, gets the words
typed so far and prints the candidates. The stubs that `analog-attach
completion <shell>` prints call the engine on every Tab press and render what
it prints. The engine knows the whole grammar, so the stubs never change when
a command or option is added.

Grammar: `complete` (in a comment of `01-grammar.abnf`) and `completion`. The
engine is the front end's: it completes the command names, the flags, and the
words of `config`, `completion` and `skill` itself, and asks the backend for
the other positionals and the flag values, in the same process. Where the
backend is linux, those candidates come from the same data as the `list`
commands (`03-commands/list.md`); where it is noos, from the workfile and
the module repositories (§11).

## 1. Terms

| Term | Meaning |
|---|---|
| Words | The elements `__complete` gets (COMPL-001). The last is the *current word*, the word under the cursor, possibly empty. The others are *committed*. |
| Candidate | One completion: a value, and optionally a description. |
| Directive | A line starting with `__ANALOG_ATTACH_COMPLETE_` that tells the stub what to do instead of, or as well as, listing candidates. |
| Source | Where the candidates for a position come from (§6). |
| Entry points | The nodes the overlay's fragments target, by the target as written (`spi0`, `i2c_arm`), each once, in file order. |

## 2. Invocation

**COMPL-001** When the first element of argv is `__complete`, the CLI shall
take as the words the elements after the first `--`, or all elements after
`__complete` when there is no `--` (GRM-002). It doesn't strip `--json` from
them (COMPL-020 handles it).

**COMPL-002** The CLI shall dequote each word as a POSIX shell would: text
between single quotes is literal; between double quotes, a backslash
before `"`, `\`, `$` or `` ` `` stands for that character; elsewhere, a
backslash stands for the next character. An unterminated quote runs to the
end of the word. (`'sp` is `sp`.)

**COMPL-003** The CLI shall exit with status 0, whatever the words.

**COMPL-004** The CLI shall write nothing to standard output but candidate
lines and directives, and nothing to standard error: not the cache warning
(COM-081), not a configuration error.

**COMPL-005** If a source can't load the workspace, or fails in any other way,
then it shall give no candidates.

## 3. Output

**COMPL-010** The CLI shall write one line per candidate: `<value>`, or
`<value><TAB><description>` when the candidate has a description.

**COMPL-011** The CLI shall offer only the candidates whose value starts
with the current word (case-sensitive).

**COMPL-012** When a position is to be completed as a file name, the CLI
shall write the line `__ANALOG_ATTACH_COMPLETE_FILES__` first, and as a
directory name the line `__ANALOG_ATTACH_COMPLETE_DIRS__`, followed by the
source's own candidates, if it has any (`import`, COMPL-072).

**COMPL-013** When there is no directive of COMPL-012, there is at least one
candidate, and every candidate is partial (a node path root followed by `/`,
COMPL-050, or a stem to type on, COMPL-063), the CLI shall write
`__ANALOG_ATTACH_COMPLETE_NOSPACE__` as the first line. The shell then adds
no space after the completion.

**COMPL-014** The CLI shall write the candidates that have no group first, in
their order. Then, for each group in the order it first appears, it shall
write the line `__ANALOG_ATTACH_COMPLETE_GROUP__<TAB><heading>` followed by the
group's candidates in their order.

## 4. The command

**COMPL-020** The CLI shall take the first committed word that doesn't start
with `-` as the command. Committed words before it are global options
(`--json`, `--help`, `--version`) and are ignored.

**COMPL-021** While there is no command and the current word starts with `-`,
the CLI shall offer `--json` (`Output as JSON`), `--help` (`Print help
information and exit`) and `--version` (`Print version information and
exit`).

**COMPL-022** While there is no command and the current word doesn't start
with `-`, the CLI shall offer the names of the commands the help lists
(GRM-008), in its order, each described by its one-line description, then
`help` (`Print help for a command`). A shared command the backend lacks
(COM-015) isn't offered.

**COMPL-023** If the command isn't a command of the program, then the CLI
shall offer nothing.

**COMPL-024** After `help`, the CLI shall offer the command names again, one
word at a time (`help list <Tab>` offers the `list` commands), and nothing
for a current word that starts with `-`.

## 5. Words after the command

**COMPL-030** The CLI shall read the committed words after the command as
positionals and options. A word that is `-` and more, but not `-` and a
digit, is an option: when the command has it and it takes a value, the next
word is its value. After a word `--`, every word is a positional. Every
other word is a positional.

**COMPL-031** When the last committed word is an option of the command that
takes a value, the CLI shall complete the current word from that option's
source (§6.2), or offer nothing when it has none.

**COMPL-032** When the current word starts with `-` but not `-` and a digit,
and no `--` came before it, the CLI shall offer the command's long options
that aren't among the committed words (one that may be given several times
stays), then `--json` (`Output as JSON`) unless it is among the committed
words, before the command too, then `--help` (`Print help information and exit`), each described by
its help text.

**COMPL-033** Otherwise the CLI shall complete the current word from the
source of the next positional (§6.1). When the command takes no more
positionals with a source, the CLI shall offer the options of COMPL-032.

**COMPL-034** For a group of commands (`list`, `skill`), the CLI shall
complete the word after the group's name from its commands, each with its
one-line description (where the backend is linux, `list` has `devices`,
`property`, `value`, `parent`, `overlay`), and the words after the command
from that command's sources (§6.1), counting from the word after it. The
words of the group and of its command are those that aren't options (`list
--json property <Tab>` completes a node path). After an unknown command it
shall offer nothing.

## 6. Sources

### 6.1 Positionals

| Command | 1st | 2nd | Later |
|---|---|---|---|
| `add` | device (COMPL-070) | | |
| `import` | overlay file (COMPL-072) | | |
| `read` | node path (§7) | property (COMPL-060) | |
| `update` | node path | property | value (COMPL-065), every one |
| `delete` | node path | property the overlay sets (COMPL-064) | |
| `move` | node path | node path | |
| `rename`, `enable`, `disable` | node path | | |
| `list devices`, `list parent`, `list overlay` | device | | |
| `list property` | node path | property | |
| `list value` | node path | property | nothing (a member, which the linux backend doesn't take) |
| `config` | setting (COMPL-080) | its value (COMPL-080) | |
| `completion` | `bash`, `fish`, `zsh` | | |
| `skill install`, `skill uninstall` | the backend's skills, described by what they help with | | |

`init`, `build`, `validate` and `deploy` complete only their options.
`move`, `enable`, `disable`, `list parent` and `list overlay` exist where the
backend is linux. Where the backend is noos, the sources of the rows are
§11's, and `generate` and `list context` complete only their options.

### 6.2 Option values

| Option | Source |
|---|---|
| `add --parent` | parent path (COMPL-052) |
| `add --template` | template (COMPL-071) |

Other options that take a value (`--name`, `--label`) offer nothing.

## 7. Node paths

Where the backend is linux (the noos backend's are COMPL-500). Paths are
completed one segment at a time, within one word.

**COMPL-050** While the current word has no `/`, the CLI shall offer each
entry point followed by `/`.

**COMPL-051** While the current word has a `/`, the CLI shall take the text
before its last `/` as a node (`/` when that `/` is the first character), and
offer each child of that node in the merged tree as `<text up to and
including the last />` `<child>`. Children are named with their unit address,
the base's first and then those only the overlay has, each once. They don't end
in `/`, so the shell adds a space (COMPL-013). The next segment needs a typed
`/`. The node is found per COMPL-054.

**COMPL-052** For `add --parent`, while the current word has no `/`, the CLI
shall offer the valid parents of the compatible given as `add`'s first
positional (`add.md` §2) instead of the entry points, each as its label (or
path) followed by `/` and described by its path. After a `/` COMPL-051
applies. Without a first positional it shall offer nothing.

**COMPL-053** If the node before the last `/` names no node, then the CLI
shall offer nothing.

**COMPL-054** The CLI shall find the node of COMPL-051 and COMPL-060 in the
workfile by the path (resolved per GRM-025 to GRM-027), and in the base only
by an absolute path or a bare label (a leading `&` removed). So:

- a label-first path to a node the workfile doesn't have (`spi0/spidev@0`,
  `gpio/dpi-gpio0`) names no node, though `list property`, `list value` and
  `read` find it, and its absolute path works (open issue CO-12);
- `&spi0/` gives the base node's children only, without those the workfile
  adds under it.

(This was `__list.md` INTLIST-012.)

## 8. Properties and values

Where the backend is linux (the noos backend's are COMPL-510 to COMPL-513).

**COMPL-060** The CLI shall complete the property positional of `read`,
`update`, `list property` and `list value` with the names the node has and
could have, as the base and the overlay together have it, in two groups:

- `set`: the node's children, then the properties it has that the binding
  names, then those it has that the binding doesn't name;
- `not set`: the binding's properties the node lacks, in the binding's
  order, then the names the binding's patterns allow (COMPL-063).

When the binding is narrowed by the node's data (`if`/`then`), the narrowed
lists are used. Without a binding there's only the `set` group. The node is
found per COMPL-054, so a label-first path to a node the workfile doesn't
have (`read spi0/spidev@0 <Tab>`) offers nothing (open issue CO-12). A name
the binding lists twice is offered twice (open issue CO-13).

**COMPL-061** The CLI shall describe a property the narrowed binding requires
by `required`.

**COMPL-062** Where a candidate's display text repeats its value with a note,
`<value> (<note>)` or `<value>… (<note>)`, the CLI shall describe it by the
note alone. A display equal to the value gives no description. Any other
display is the description as it is.

**COMPL-063** For each property pattern and child-node pattern of the binding
that starts with `^`, the CLI shall offer the names it allows that the node
doesn't have yet (`channel@1` … `channel@15`, described `child node`), or,
when the pattern allows too many names to list, its stem as a partial
candidate described `<pattern|child node> <regex>` (`fan-`, `child node
^fan-[0-9]+$`). Patterns that don't start with `^` (`-supply$`) give nothing.

**COMPL-064** The CLI shall complete `delete`'s property positional with only
the properties the overlay sets on the node (its fragments' values that
apply), in the `set` group.

**COMPL-065** The CLI shall complete `update`'s third positional with the
values `list value <path> <property>` suggests, each described by its
display text (COMPL-062). For a later positional, it shall offer the rest of
each suggestion whose first tokens are the values typed after the property
(`update adc interrupts 19 <Tab>` offers `IRQ_TYPE_EDGE_FALLING` of `19
IRQ_TYPE_EDGE_FALLING`), each once.

## 9. Other sources

COMPL-070 to COMPL-072 are where the backend is linux (the noos backend's
are COMPL-520 to COMPL-531); COMPL-080 is the front end's, for every backend.

**COMPL-070** Device: the compatibles of the compat index that start with the
current word, in index order.

**COMPL-071** Template: `required` (`interview for the required properties`);
then `example:<N>` for each example of the binding that has the device,
described `SPI`, `I2C` or `binding example`; then `overlay:<name>` for each
overlay that `list overlay` lists for the device, in its order, described
`<fit> (<reason>)`, with ` via <compatible>` for an overlay that adds another
compatible of the binding. `<name>` is the file name, or the path relative to
the Linux tree when two overlays share the file name. Without a first
positional, nothing.

**COMPL-072** Overlay file: the file names of the Linux tree's overlay files
that start with the current word, described by their path relative to the
Linux tree, after the file directive (COMPL-012), so the shell also offers
any file.

**COMPL-080** `config`: the first positional (after `--global`, `--reset` or
not) offers `backend` and the active backend's settings (`02-common.md`
§8.1, COM-131), each described by its description. The value offers, by the setting:

| Setting | Value |
|---|---|
| a path (`linux`, `devicetree`, `workfile`) | file names (COMPL-012), the first value only |
| a list of paths | file names, every value |
| `backend` | the known backends (`linux`, `noos`) |
| one with options (`overlay-syntax`) | the options (`fragment`, `label`) |
| a boolean | `true`, `false` |
| any other (`preprocess-command`, `deploy-*`) | nothing |

After the value the CLI shall offer the options of COMPL-032, and for an
unknown setting nothing.

## 10. `completion [<shell>] [--install | --uninstall]`

**COMPL-100** When the shell (COMPL-103) is `bash`, `fish` or `zsh` and
neither option is given, the CLI shall write that shell's completion script
to standard output, followed by an empty line, and exit with status 0. In
JSON mode it shall write `{ ok: true, message: "<shell> completion script",
severity: "info", script }` instead, `script` being the script without the
empty line (`04-protocol/completion.schema.json`).

**COMPL-101** If `<shell>` is anything else, then the CLI shall report the
input error `Unknown shell: <shell>. Supported: bash, fish, zsh` (COM-031),
and change nothing.

**COMPL-102** *Withdrawn.* (`<shell>` was required; without it commander
reported a missing argument. COMPL-103 now picks the shell.)

**COMPL-103** When `<shell>` is left out, the shell shall be the base name of
the `SHELL` environment variable (`/usr/bin/zsh` → `zsh`). If that isn't
`bash`, `fish` or `zsh`, then the CLI shall write `Cannot tell the shell from
$SHELL (<value>). Name one: bash, fish, zsh` to standard error, `<value>`
being `not set` when `SHELL` is unset, as an input error too (COM-031).

### 10.1 What every stub does

**COMPL-110** On each completion request, the stub shall run `analog-attach
__complete -- <committed words> <current word>`, discarding its standard
error. It uses the `analog-attach` on `PATH`.

**COMPL-111** When the first line is `__ANALOG_ATTACH_COMPLETE_FILES__` or
`__ANALOG_ATTACH_COMPLETE_DIRS__`, the stub shall offer the shell's own file
or directory completion, after the candidates that follow the line, if
any.

**COMPL-112** When the first line is `__ANALOG_ATTACH_COMPLETE_NOSPACE__`, the bash
and zsh stubs shall complete without a trailing space. The fish stub drops
the line (COMPL-140).

**COMPL-113** The stub shall offer each candidate line's value, and show its
description where the shell can.

### 10.2 bash

Enabled with `source <(analog-attach completion bash)`.

**COMPL-120** The bash stub shall split the line up to the cursor
(`COMP_LINE`, `COMP_POINT`) at whitespace only, so `@`, `:` and `=` in
`COMP_WORDBREAKS` don't split a path such as `spi0/adi,ad7124-8@2`. When the
line ends in whitespace, the current word is empty.

**COMPL-121** The bash stub shall drop the group lines and the descriptions.
It shall `%q`-quote a value that contains a space, unless the current word
starts with a quote.

**COMPL-122** When bash's own current word (split at `COMP_WORDBREAKS`) is a
suffix of the stub's current word, the bash stub shall cut the stub's extra
leading text off each value, so bash inserts the value once.

**COMPL-123** The bash stub shall use `_filedir` (from bash-completion) for
files and directories when it exists, else `compgen -f` / `compgen -d`.

### 10.3 zsh

Enabled with `source <(analog-attach completion zsh)`, or installed as
`_analog-attach` in a directory on `$fpath`.

**COMPL-130** The zsh stub shall list each group under its heading in bold,
the ungrouped candidates first, one per line with the description after it.
Each group's candidates keep the engine's order; the ungrouped ones are
sorted by zsh (open issue CO-7). Most sources give no groups (commands, list
kinds, values, parents, templates), so for them the engine's order is lost:
`update adc refin1-supply <Tab>` lists `cam1_reg` before the overlay's `vref`
(`list.md` LIST-072).

**COMPL-131** When the user has no `list-grouped` style for
`:completion:*:*:analog-attach:*`, the zsh stub shall set it to `false`, so
candidates that share a description aren't merged onto one line. A style the
user has set is kept.

**COMPL-132** The zsh stub shall work both sourced (it registers itself with
`compdef`) and autoloaded from `$fpath` (it runs).

**COMPL-133** The zsh stub shall use `_files` for files and `_files -/` for
directories.

### 10.4 fish

Enabled with `analog-attach completion fish | source`, or installed as
`~/.config/fish/completions/analog-attach.fish`.

**COMPL-140** The fish stub shall drop the group lines, offer the
candidates with their descriptions, and turn off fish's own file completion
for `analog-attach` except where a directive asks for it
(`__fish_complete_path`, `__fish_complete_directories`). fish sorts the
candidates itself. The stub drops `__ANALOG_ATTACH_COMPLETE_NOSPACE__` without
acting on it: fish adds no space after a completion that ends in `/`, `-`,
`@`, `,`, `=` or `.`, and adds one otherwise (after `fanx`, for one) (open
issue CO-8).

### 10.5 Installing

**COMPL-150** `--install` and `--uninstall` shall use one file per shell,
under the user's home directory, where the shell loads completions from by
itself:

| Shell | File |
|---|---|
| bash | `$XDG_DATA_HOME/bash-completion/completions/analog-attach` (loaded by the bash-completion package) |
| fish | `$XDG_CONFIG_HOME/fish/completions/analog-attach.fish` |
| zsh | `$XDG_DATA_HOME/zsh/site-functions/_analog-attach` |

`$XDG_DATA_HOME` defaults to `~/.local/share` and `$XDG_CONFIG_HOME` to
`~/.config`, `~` being the home directory; a value that isn't an absolute
path is ignored.

**COMPL-151** With `--install`, the CLI shall create the file's directories
when they don't exist, write the script of COMPL-100 (with its empty line) to
the file, replacing an earlier one, and write `Installed <shell> completion
to <file>` followed by: for bash, `It loads in new shells, through the
bash-completion package.`; for fish, `It loads in new shells.`; for zsh, `Add
its directory to fpath in ~/.zshrc, before compinit, then start a new
shell:` and `  fpath=(<directory> $fpath)`.

**COMPL-152** With `--uninstall`, when the file exists the CLI shall remove
it and write `Removed <file>`, followed for zsh by `Remove its fpath line from
~/.zshrc if you added one.` When it doesn't, the CLI shall write `<shell>
completion is not installed (no <file>)` and change nothing.

**COMPL-153** The CLI shall not edit a shell startup file (`~/.bashrc`,
`~/.zshrc`, …), nor write outside the files of COMPL-150 and their
directories.

**COMPL-154** If both `--install` and `--uninstall` are given, then the CLI
shall report the input error `option '--install' cannot be used with option
'--uninstall'` (COM-031).

**COMPL-155** The CLI shall write the lines of COMPL-151 and COMPL-152 to
standard output and exit with status 0. If the file can't be written or
removed, the error is unhandled (COM-130): standard error, status 1.

**COMPL-156** In JSON mode, `--install` and `--uninstall` shall write `{ ok:
true, message, severity: "info" }` instead, `message` being the lines of
COMPL-151 or COMPL-152 joined with newlines, `not installed` included
(`04-protocol/completion.schema.json`).

## 11. Where the backend is noos

The sources read the workfile and the module repositories. When there is no
workfile, or it doesn't load, the sources that need it offer nothing
(COMPL-005).

### 11.1 Nodes, properties and values

**COMPL-500** Node: the stored nodes of the workfile, in its order, each
described by its `$compatible`, for the node positional of `read`,
`update`, `delete`, `rename`, `list property` and `list value`. A node is
one name (GRM-080): there are no segments and no external nodes.

**COMPL-510** Property: the node's properties the schema doesn't disable, in
order, named without their `$`, those the schema requires described
`required`, for `read`, `update`, `list property` (open issue CO-16) and
`list value`. Nothing for an external node or one the workfile doesn't have.
There are no groups.

**COMPL-511** For `delete`, the property positional shall offer only the
properties that have a value.

**COMPL-512** Value: `update`'s third positional and `list value`'s member
positional shall offer the values `list value <node> <property>` gives
(`03-commands/list.md` LIST-530), without the schemas it could create and
without descriptions: for a union, its members.

**COMPL-513** After a union member, `update`'s fourth positional shall offer
the values of that member; a later positional, nothing. For a property that
isn't a union, the fourth positional offers the values of COMPL-512 again
(open issue CO-17).

### 11.2 Other sources

**COMPL-520** Device: what `list devices` lists (LIST-500), in its order,
without descriptions, for `add` and `list devices`.

**COMPL-521** Source: `import`'s positional is a file name: the file
directive (COMPL-012) and no candidate.

| Option | Source |
|---|---|
| `build --board`, `deploy --board`, `generate --board` | the boards carrying the workfile's chip, or every board when there is no workfile, in the repositories' order (COMPL-530) |
| `deploy --probe` | `openocd`, `jlink` |
| `generate --project-template` | the bundled template sets, sorted, after the directory directive (COMPL-012) |
| `generate --output` | the directory directive only |
| `add --as`, `add --name` | nothing |

**COMPL-530** The option values shall be those of the table.

**COMPL-531** `config` (COMPL-080) shall offer for the noos settings
(`02-common.md` COM-500): `capi-path`, `workfile`, `project-path` file names
(the first value only); `module-paths` file names (every value); `board`
and `platform` the boards and chips the module repositories describe, in
their order (`config.md` CONFIG-510); `probe` `openocd`, `jlink`; a boolean
(`bootstrap`, `interview`, `example`) `true`, `false`; `project-template`,
`project-name`, `build-command` and `deploy-command` nothing (open issue
CO-15).

## 12. Open issues

**CO-1.** *Fixed.* (Only the first value of `update` completed. The later
ones continue the suggestions, COMPL-065.)

**CO-2. Path roots are only the entry points.** Every node-path positional,
including `update`, `move`'s destination and `list property`, offers only the
overlay's fragment targets before the first `/`. A base label the overlay
doesn't target yet (`spi1`, `i2c1`) is never offered, though every command
accepts it. Absolute paths (`/…`) do reach the whole tree.

**CO-3. Nothing completes before an overlay exists.** Node paths, properties,
values, and the children after `add --parent spi0/` all need the overlay
loaded, so a workspace without one completes none of them. Only `add
--parent`'s roots and the device, template and overlay-file sources work.

**CO-4.** *Fixed.* (The hidden `ui` was offered. It is gone, and
COMPL-022 offers the commands the help lists.)

**CO-5.** *Fixed.* (`config <key>` always completed a file name. The value
now completes by the setting, COMPL-080.)

**CO-6.** *Fixed.* (`completion <unknown shell>` exited 0 with no JSON
response. It is an input error now, COMPL-101, and a known shell answers
JSON, COMPL-100.)

**CO-7. zsh sorts the ungrouped candidates.** The stub passes `-V` (keep the
order) only to the `_describe` of a group. The ungrouped candidates, which
are most of them, are sorted: `update adc refin1-supply <Tab>` lists
`cam1_reg`, `cam_dummy_reg`, …, `vref`, where the engine puts the overlay's
`vref` first (`list.md` LIST-072), and the inherited interrupt parent loses
its place too. A fix would be `-V analog-attach` on the ungrouped
`_describe`.

**CO-8. fish ignores `__ANALOG_ATTACH_COMPLETE_NOSPACE__`.** The fish stub removes
the line and lets fish decide, and fish adds a space after a completion that
doesn't end in `/`, `-`, `@`, `,`, `=` or `.`. The partial candidates seen
(`spi0/`, `fan-`) end in one of those, but a stem that ends in a letter
(`fanx`) gets a space, so the user has to delete it before typing on. A fix
would be for the engine to keep every partial stem ending in one of those
characters, since fish's `complete` has no per-candidate way to suppress the
space.

**CO-9.** *Fixed.* (`list` completion counted its positionals from the
wrong word. The route is read from the words that aren't options, COMPL-034.)

**CO-10. Nothing completes a directory name.** `init --linux` was the only
position completed with `__ANALOG_ATTACH_COMPLETE_DIRS__` (COMPL-012); `config
linux` completes a file name like the other paths (COMPL-080).

**CO-11.** *Fixed.* (`completion --install` had no JSON response. It has
one, COMPL-156.)

**CO-12. Node paths miss base nodes under a label.** The base lookup of
COMPL-054 reads `spi0/spidev@0` as one label name, so `read spi0/spidev@0
<Tab>` and `read spi0/spidev@0/<Tab>` complete nothing, while
`/soc/spi@7e204000/spidev@0` works. It strips `&`, so `&spi0/` completes the
base's children only, where every `list` path with `&` is not found
(`list.md` L-1). A fix would be to look the base node up as `read` does
(resolve the label-first path to an absolute one first). (This was
`__list.md` IL-3.)

**CO-13. A property can be offered twice.** `read spi1 <Tab>` (an RPi 4 base)
lists `#address-cells` twice in the `set` group: the narrowed binding names it
twice (`list.md` L-7), and the candidates of COMPL-060 aren't made unique.

**CO-14. A group alone completes no flag.** `list -<Tab>` and `skill
-<Tab>` offer nothing (COMPL-034), though `--help` applies.

**CO-15. `config project-template` offers no template set.** `generate
--project-template <Tab>` offers `capi` and `capi-iio` and directories
(COMPL-530), while the setting offers nothing (COMPL-531).

**CO-16. `list property <node> <Tab>` offers properties that are refused.**
Where the backend is noos, `list property` takes only a node (`list.md`
LIST-522), but the second positional completes the node's properties
(COMPL-510), and accepting one gives the input error.

**CO-17. A second value is offered where one is taken.** `update
testpart_spi_dev mode TEST_SPI_MODE_0 <Tab>` offers `TEST_SPI_MODE_0` again,
though two values are a union's member and its value (`update.md`
UPDATE-501), so a property that isn't a union takes one.

## 13. Examples

```
$ analog-attach __complete -- update ad7124_8 ch
__ANALOG_ATTACH_COMPLETE_GROUP__	set
channel@0
__ANALOG_ATTACH_COMPLETE_GROUP__	not set
channel@1	child node
channel@2	child node
…
channel@15	child node
```

```
$ analog-attach __complete -- add adi,ad7124-8 --parent sp
__ANALOG_ATTACH_COMPLETE_NOSPACE__
spi/	/soc/spi@7e204000
spi1/	/soc/spi@7e215080
…
```

```
$ analog-attach __complete -- update max31790 f
__ANALOG_ATTACH_COMPLETE_NOSPACE__
__ANALOG_ATTACH_COMPLETE_GROUP__	not set
fan-	child node ^fan-[0-9]+$
```

```
$ analog-attach __complete -- config linux ""
__ANALOG_ATTACH_COMPLETE_FILES__
$ analog-attach __complete -- config overlay-syntax ""
fragment
label
```

```
$ analog-attach __complete -- import rpi-dac
__ANALOG_ATTACH_COMPLETE_FILES__
rpi-dacplus-overlay.dts	arch/arm/boot/dts/overlays/rpi-dacplus-overlay.dts
rpi-dacpro-overlay.dts	arch/arm/boot/dts/overlays/rpi-dacpro-overlay.dts
```

Where the backend is noos (a workfile for `testboard` with an
`eval-testpart` added; a tab between the value and its description):

```
$ analog-attach __complete read testpart_spi_dev ''
controller	required
max_speed_hz	required
mode
native_cs
cs_gpio
cs_gpio_num
$ analog-attach __complete update testpart_ip comm_init ''
spi_dev
i2c_dev
$ analog-attach __complete update testpart_ip comm_init spi_dev ''
testpart_spi_dev
$ analog-attach __complete generate --project-template ''
__ANALOG_ATTACH_COMPLETE_DIRS__
capi
capi-iio
$ analog-attach __complete deploy --probe ''
openocd
jlink
```
