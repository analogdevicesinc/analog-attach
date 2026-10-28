# Shell completion

Completion has two parts. The engine, `attach-linux __complete`, gets the words
typed so far and prints the candidates. The stubs that `attach-linux
completion <shell>` prints call the engine on every Tab press and render what
it prints. The engine knows the whole grammar, so the stubs never change when
a command or option is added.

Grammar: `complete` (in a comment of `01-grammar.abnf`) and `completion`. The
engine gets its candidates from the kinds of the hidden `__list` command
(`03-commands/__list.md`), run in-process in JSON mode.

## 1. Terms

| Term | Meaning |
|---|---|
| Words | The elements `__complete` gets (COMPL-001). The last is the *current word*, the word under the cursor, possibly empty. The others are *committed*. |
| Candidate | One completion: a value, and optionally a description. |
| Directive | A line starting with `__ATTACH_COMPLETE_` that tells the stub what to do instead of, or as well as, listing candidates. |
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
lines and directives, and shall not write the cache warning (COM-081).

**COMPL-005** If a source can't load the workspace, or fails in any other way,
then it shall give no candidates. The configuration errors of COM-071 are
still written to standard error. The stubs discard it.

## 3. Output

**COMPL-010** The CLI shall write one line per candidate: `<value>`, or
`<value><TAB><description>` when the candidate has a description.

**COMPL-011** The CLI shall offer only the candidates whose value starts
with the current word (case-sensitive).

**COMPL-012** When a position is to be completed as a file name, the CLI
shall write the single line `__ATTACH_COMPLETE_FILES__`, and as a directory
name the single line `__ATTACH_COMPLETE_DIRS__`, and nothing else.

**COMPL-013** When there is at least one candidate and every candidate's value
ends in `/` or is partial (a stem to type on, COMPL-063), the CLI shall write
`__ATTACH_COMPLETE_NOSPACE__` as the first line. The shell then adds no space
after the completion.

**COMPL-014** The CLI shall write the candidates that have no group first, in
their order. Then, for each group in the order it first appears, it shall
write the line `__ATTACH_COMPLETE_GROUP__<TAB><heading>` followed by the
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
with `-`, the CLI shall offer the command names that don't start with `__`,
in the order the program registers them, each described by its one-line
description.

**COMPL-023** If the command isn't a command of the program, then the CLI
shall offer nothing.

## 5. Words after the command

**COMPL-030** The CLI shall read the committed words after the command as
positionals and options. A word starting with `-` is an option: when the
command has it (long or short form) and it takes a value, the next word is its
value. Every other word is a positional.

**COMPL-031** When the last committed word is an option of the command that
takes a value, the CLI shall complete the current word from that option's
source (§6.2), or offer nothing when it has none.

**COMPL-032** When the current word starts with `-`, the CLI shall offer the
command's long options that aren't among the committed words, then `--help`
(`display help for command`), each described by its help text.

**COMPL-033** Otherwise the CLI shall complete the current word from the
source of the next positional (§6.1). When the command takes no more
positionals with a source, the CLI shall offer the options of COMPL-032.

**COMPL-034** For `list`, the CLI shall complete the first positional from the
list kinds (`devices`, `property`, `value`, `parent`, `overlay`, each with its
summary). It shall complete the positionals after it from that kind's sources
(§6.1), counting from the one after the kind. After an unknown kind it shall
offer nothing. The kind is the first committed word after `list` that doesn't
start with `-`, but the positionals are counted from the word right after
`list`, and a current word equal to the kind completes the kind again (open
issue CO-9):

- `list devices devices<Tab>` offers the kind `devices`, not compatibles;
- `list --json property <Tab>` takes `property` as the node path and offers
  nothing.

## 6. Sources

### 6.1 Positionals

| Command | 1st | 2nd | Later |
|---|---|---|---|
| `add` | device (COMPL-070) | | |
| `import` | overlay file (COMPL-072) | | |
| `read` | node path (§7) | property (COMPL-060) | |
| `update` | node path | property | value (COMPL-065), 3rd only |
| `delete` | node path | property the overlay sets (COMPL-064) | |
| `move` | node path | node path | |
| `rename`, `enable`, `disable` | node path | | |
| `list devices`, `list parent`, `list overlay` | device | | |
| `list property`, `list value` | node path | property | |
| `config` | config field (§8.1 of `02-common.md`) | file name (COMPL-012) | |
| `completion` | `bash`, `fish`, `zsh` | | |

`build`, `validate`, `deploy`, `install-skill`, `uninstall-skill` and `ui`
complete only their options.

### 6.2 Option values

| Option | Source |
|---|---|
| `add --parent` | parent path (COMPL-052) |
| `add --template` | template (COMPL-071) |
| `init --linux` | directory name (COMPL-012) |
| `init --devicetree` | file name (COMPL-012) |

Other options that take a value (`--name`, `--label`, `--overlay`, `--port`)
offer nothing.

## 7. Node paths

Paths are completed one segment at a time, within one word.

**COMPL-050** While the current word has no `/`, the CLI shall offer each
entry point followed by `/`.

**COMPL-051** While the current word has a `/`, the CLI shall take the text
before its last `/` as a node (`/` when that `/` is the first character), and
offer each child of that node in the merged tree as `<text up to and
including the last />` `<child>`. Children are named with their unit address,
the base's first and then those only the overlay has, each once. They don't end
in `/`, so the shell adds a space (COMPL-013). The next segment needs a typed
`/`. The node is found per `__list.md` INTLIST-012: a label-first node the
overlay doesn't have (`spi0/spidev@0/`) gives nothing, and `&spi0/` gives the
base's children only (`__list.md` IL-3).

**COMPL-052** For `add --parent`, while the current word has no `/`, the CLI
shall offer the valid parents of the compatible given as `add`'s first
positional (`add.md` §2) instead of the entry points, each as its label (or
path) followed by `/` and described by its path. After a `/` COMPL-051
applies. Without a first positional it shall offer nothing.

**COMPL-053** If the node before the last `/` names no node, then the CLI
shall offer nothing.

## 8. Properties and values

**COMPL-060** The CLI shall complete the property positional of `read`,
`update`, `list property` and `list value` with the names the node has and
could have, as the base and the overlay together have it, in two groups:

- `set`: the node's children, then the properties it has that the binding
  names, then those it has that the binding doesn't name;
- `not set`: the binding's properties the node lacks, in the binding's
  order, then the names the binding's patterns allow (COMPL-063).

When the binding is narrowed by the node's data (`if`/`then`), the narrowed
lists are used. Without a binding there's only the `set` group. The node is
found per `__list.md` INTLIST-012, so a label-first path to a node the
overlay doesn't have (`read spi0/spidev@0 <Tab>`) offers nothing
(`__list.md` IL-3).

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
display text (COMPL-062).

## 9. Other sources

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
Linux tree.

## 10. `completion <shell>`

**COMPL-100** When `<shell>` is `bash`, `fish` or `zsh`, the CLI shall write
that shell's completion script to standard output, followed by an empty
line, and exit with status 0. The script is the same in JSON mode.

**COMPL-101** If `<shell>` is anything else, then the CLI shall write `Unknown
shell: <shell>. Supported: bash, fish, zsh` to standard error, write nothing
to standard output, and exit with status 0, in human and in JSON mode. It is
neither a refusal (COM-040, COM-041) nor an input error (COM-031). (Open
issue CO-6.)

**COMPL-102** If `<shell>` is missing, then commander reports `error: missing
required argument 'shell'` (GRM-004): on standard error with status 1 in
human mode, status 2 in JSON mode.

### 10.1 What every stub does

**COMPL-110** On each completion request, the stub shall run `attach-linux
__complete -- <committed words> <current word>`, discarding its standard
error. It uses the `attach-linux` on `PATH`.

**COMPL-111** When the first line is `__ATTACH_COMPLETE_FILES__` or
`__ATTACH_COMPLETE_DIRS__`, the stub shall fall back to the shell's own file or
directory completion.

**COMPL-112** When the first line is `__ATTACH_COMPLETE_NOSPACE__`, the bash
and zsh stubs shall complete without a trailing space. The fish stub drops
the line (COMPL-140).

**COMPL-113** The stub shall offer each candidate line's value, and show its
description where the shell can.

### 10.2 bash

Enabled with `source <(attach-linux completion bash)`.

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

Enabled with `source <(attach-linux completion zsh)`, or installed as
`_attach-linux` in a directory on `$fpath`.

**COMPL-130** The zsh stub shall list each group under its heading in bold,
the ungrouped candidates first, one per line with the description after it.
Each group's candidates keep the engine's order; the ungrouped ones are
sorted by zsh (open issue CO-7). Most sources give no groups (commands, list
kinds, values, parents, templates), so for them the engine's order is lost:
`update adc refin1-supply <Tab>` lists `cam1_reg` before the overlay's `vref`
(`list.md` LIST-072).

**COMPL-131** When the user has no `list-grouped` style for
`:completion:*:*:attach-linux:*`, the zsh stub shall set it to `false`, so
candidates that share a description aren't merged onto one line. A style the
user has set is kept.

**COMPL-132** The zsh stub shall work both sourced (it registers itself with
`compdef`) and autoloaded from `$fpath` (it runs).

**COMPL-133** The zsh stub shall use `_files` for files and `_files -/` for
directories.

### 10.4 fish

Enabled with `attach-linux completion fish | source`, or installed as
`~/.config/fish/completions/attach-linux.fish`.

**COMPL-140** The fish stub shall drop the group lines, offer the
candidates with their descriptions, and turn off fish's own file completion
for `attach-linux` except where a directive asks for it
(`__fish_complete_path`, `__fish_complete_directories`). fish sorts the
candidates itself. The stub drops `__ATTACH_COMPLETE_NOSPACE__` without
acting on it: fish adds no space after a completion that ends in `/`, `-`,
`@`, `,`, `=` or `.`, and adds one otherwise (after `fanx`, for one) (open
issue CO-8).

## 11. Open issues

**CO-1. Only the first value of `update` completes.** For a fourth positional
and later, the engine passes the values typed so far as part of the path,
which then names no node, so nothing is offered: `update adc interrupts 17
<Tab>` gives no flags.

**CO-2. Path roots are only the entry points.** Every node-path positional,
including `update`, `move`'s destination and `list property`, offers only the
overlay's fragment targets before the first `/`. A base label the overlay
doesn't target yet (`spi1`, `i2c1`) is never offered, though every command
accepts it. Absolute paths (`/…`) do reach the whole tree.

**CO-3. Nothing completes before an overlay exists.** Node paths, properties,
values, and the children after `add --parent spi0/` all need the overlay
loaded, so a workspace without one completes none of them. Only `add
--parent`'s roots and the device, template and overlay-file sources work.

**CO-4. The hidden `ui` is offered.** COMPL-022 leaves out only names that
start with `__`, so `ui` is listed (first) with the public commands, though
`--help` hides it.

**CO-5. `config <key>` always completes a file name.** The value of
`overlay-syntax` (`fragment`, `label`) and of the `deploy-*` fields complete as
file names too.

**CO-6. `completion <unknown shell>` exits 0.** See C-1 in `02-common.md`.
It also writes the message to standard error, where every other human-mode
refusal goes to standard output (COM-022), and in JSON mode it gives no JSON
response at all (COMPL-101). For a known shell, JSON mode writes the script
rather than a JSON response. A fix would be to treat an unknown shell as an
input error (COM-031, COM-033), as commander does for a missing one
(COMPL-102).

**CO-7. zsh sorts the ungrouped candidates.** The stub passes `-V` (keep the
order) only to the `_describe` of a group. The ungrouped candidates, which
are most of them, are sorted: `update adc refin1-supply <Tab>` lists
`cam1_reg`, `cam_dummy_reg`, …, `vref`, where the engine puts the overlay's
`vref` first (`list.md` LIST-072), and the inherited interrupt parent loses
its place too. A fix would be `-V attach-linux` on the ungrouped
`_describe`.

**CO-8. fish ignores `__ATTACH_COMPLETE_NOSPACE__`.** The fish stub removes
the line and lets fish decide, and fish adds a space after a completion that
doesn't end in `/`, `-`, `@`, `,`, `=` or `.`. The partial candidates seen
(`spi0/`, `fan-`) end in one of those, but a stem that ends in a letter
(`fanx`) gets a space, so the user has to delete it before typing on. A fix
would be for the engine to keep every partial stem ending in one of those
characters, since fish's `complete` has no per-candidate way to suppress the
space.

**CO-9. `list` completion counts its positionals from the wrong word.** The
engine finds the kind as the first word after `list` that doesn't start with
`-`, but counts the kind's positionals from the word right after `list`, and
completes the kind again when the current word equals it. `list --json
property <Tab>` offers nothing (the kind is read as the node path), and `list
devices devices<Tab>` offers the kind `devices`. A fix would be to count from
the kind's own index and to drop the `prefix === subkind` test in
`src/commands/completion/complete.ts`.

## 12. Examples

```
$ attach-linux __complete -- update ad7124_8 ch
__ATTACH_COMPLETE_GROUP__	set
channel@0
__ATTACH_COMPLETE_GROUP__	not set
channel@1	child node
channel@2	child node
…
channel@15	child node
```

```
$ attach-linux __complete -- add adi,ad7124-8 --parent sp
__ATTACH_COMPLETE_NOSPACE__
spi/	/soc/spi@7e204000
spi1/	/soc/spi@7e215080
…
```

```
$ attach-linux __complete -- update max31790 f
__ATTACH_COMPLETE_NOSPACE__
__ATTACH_COMPLETE_GROUP__	not set
fan-	child node ^fan-[0-9]+$
```

```
$ attach-linux __complete -- init --linux ""
__ATTACH_COMPLETE_DIRS__
```
