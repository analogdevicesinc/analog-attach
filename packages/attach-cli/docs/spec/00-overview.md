# attach-linux functional specification

## 1. Scope

This specification describes the observable behaviour of the `attach-linux`
command-line tool: what it accepts on the command line, what it writes to the
workspace, what it prints, on which stream, and with which exit status. It
covers every public command, the hidden commands used by shell completion and
the `ui` page, and the `--json` protocol.

It is descriptive: it states what the tool does at the time of writing, checked
against the source and the built CLI. Where the behaviour looks unintended, the
requirement still states it, and the chapter lists it under *Open issues*.

Out of scope: the internals of attach-lib, the content of the bundled
dt-schema, and anything that isn't observable from outside the process.

## 2. Documents

| File | Contents |
|---|---|
| `00-overview.md` | Scope, conventions, terms |
| `01-grammar.abnf` | The command-line grammar (ABNF, RFC 5234 and RFC 7405) |
| `01-grammar.md` | How to read the grammar; the token rules ABNF can't express |
| `02-common.md` | What every command shares: modes, streams, input errors, refusals, exit status, workspace loading, config fields, the base, the overlay, the binding caches |
| `03-commands/<command>.md` | One chapter per command: `add`, `build`, `delete`, `deploy`, `enable-disable`, `import`, `init`, `install-skill` (with `uninstall-skill`), `list`, `__list`, `move`, `read`, `rename`, `config-get`, `config-set`, `ui`, `update`, `validate` |
| `04-protocol/*.schema.json` | JSON Schema (2020-12) of the `--json` responses. `common` and `config-error` are shared; the others are named after their command (`config` covers `config-get` and `config-set`, `list` covers `list` and `__list`). `move`, `enable` and `disable` respond with `common`. |
| `05-completion.md` | Shell completion: `__complete` and `completion <shell>` |

## 3. Conventions

### 3.1 Normative language

The key words MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT, SHOULD, SHOULD NOT,
RECOMMENDED, NOT RECOMMENDED, MAY and OPTIONAL are to be interpreted as
described in BCP 14 (RFC 2119, RFC 8174) when, and only when, they appear in
all capitals. In EARS statements (3.2) the verb is *shall*, which has the
meaning of MUST.

### 3.2 Requirements

Each behavioural requirement has an identifier and is written in one of the
EARS patterns (Easy Approach to Requirements Syntax):

| Pattern | Form |
|---|---|
| Ubiquitous | The CLI shall *response*. |
| Event-driven | When *trigger*, the CLI shall *response*. |
| State-driven | While *state*, the CLI shall *response*. |
| Unwanted behaviour | If *condition*, then the CLI shall *response*. |
| Optional feature | Where *feature*, the CLI shall *response*. |

Patterns combine (`While …, when …, the CLI shall …`). One requirement states
one testable behaviour.

Identifiers are `<PREFIX>-<NNN>`: `GRM` for the grammar, `COM` for common
behaviour, and the command's name in capitals for a command chapter (`ADD`,
`UPDATE`, …). Numbers come in blocks of ten, mostly one block per section,
and needn't follow the order of the sections (a requirement added later
takes a free number). They are never reused; a removed requirement keeps its
number, marked *withdrawn*.

### 3.3 Open issues

Behaviour that looks unintended is still specified as it is, and listed at
the end of its chapter as an open issue: `<letter(s)>-<n>`, unique within
the chapter (`C-1` in `02-common.md`, `U-1` in `update.md`). Another chapter
cites it with the file: `update.md` U-1.

### 3.4 Messages

Text in `monospace` inside a requirement is the exact output. In it,
`<name>` is a placeholder described next to the requirement, and every other
character is literal. Some messages print angle-bracket text as is (`(list
overlay <compatible> finds them)`); the requirement then says so: "`<compatible>`
is literal". A line is a string followed by a newline.

### 3.5 Paths in JSON

Node paths in JSON responses are arrays of segments without the root: the
node `/soc/spi@7e204000/adc@0` is `["soc", "spi@7e204000", "adc@0"]`, and the
root is `[]`. Two exceptions: the `paths` of a `delete` preview are relative
(`delete.md` D-5), and `validate`'s paths are paths of the tree it validates
(`validate.md` V-1). Suggestions give a node as a string (`display_string`
`/soc/spi@7e204000` in `list parent`).

## 4. Terms

| Term | Meaning |
|---|---|
| CLI | The `attach-linux` process. |
| Workspace | The current working directory (CWD) of the CLI, with its `.attach-linux/` directory. |
| Config | The file `.attach-linux/config.toml` in the workspace. |
| Linux tree | The Linux source tree the `linux` setting names. |
| Base | The devicetree source the `devicetree` setting names, after `preprocess-command`. |
| Overlay, workfile | The `.dtso` file the `overlay` setting names: the only devicetree file the CLI edits. |
| Merged tree | The base with the overlay applied. A node "exists" when the merged tree has it. |
| Binding | The dt-schema YAML in the Linux tree whose `compatible` list has the device's compatible string. |
| Label | A devicetree label (`spi0` in `spi0: spi@7e204000 { … }`) of the base or the overlay. |
| Unit address | The part of a node name after `@`. |
| Terminal run | A run whose standard input and standard output are both terminals (`isatty`). |
| JSON mode | A run with `--json` (COM-010). |
| Human mode | A run without `--json`. |
| Refusal | The command doesn't do what was asked, because of the workspace's state or a value that is valid syntax but unusable. Reported per COM-040. |
| Input error | The command line is malformed. Reported per COM-030. |
