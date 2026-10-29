# analog-attach functional specification

## 1. Scope

This specification describes the observable behaviour of the `analog-attach`
command-line tool: what it accepts on the command line, what it writes to the
project, what it prints, on which stream, and with which exit status. It
covers every public command, the hidden command used by shell completion, and
the `--json` protocol.

`analog-attach` is a front end with backends, one per ecosystem: `linux`
(Linux device tree overlays) and `noos` (no-OS projects). The project's
`backend` setting picks one (`02-common.md` COM-013). The front end owns the
command line, the settings files, `config`, `completion`, `skill`, the bare
run and shell completion; the backend owns what the other commands do, its
settings and its state directory. Shared text says "the backend"; a
requirement that holds for one backend says so ("Where the backend is linux,
…"). The chapter of a shared command describes the Linux backend in its
numbered sections, and the no-OS backend in its section *Where the backend
is noos*; a requirement of the Linux sections holds where the backend is
linux unless it says otherwise.

It is descriptive: it states what the tool does at the time of writing, checked
against the source and the built CLI. Where the behaviour looks unintended, the
requirement still states it, and the chapter lists it under *Open issues*.

Out of scope: the internals of the backends and of attach-lib, the content of
the bundled dt-schema, and anything that isn't observable from outside the
process.

## 2. Documents

| File | Contents |
|---|---|
| `00-overview.md` | Scope, conventions, terms |
| `01-grammar.abnf` | The command-line grammar (ABNF, RFC 5234 and RFC 7405) |
| `01-grammar.md` | How to read the grammar; the token rules ABNF can't express |
| `02-common.md` | What every command shares: modes, the backend, streams, input errors, refusals, exit status, settings, workspace loading; for the Linux backend the base, the workfile and the binding caches |
| `03-commands/<command>.md` | One chapter per command. Front end: `config`, `skill`, `setup` (the bare `analog-attach`). Shared, the Linux backend first, then the no-OS backend: `add`, `build`, `delete`, `deploy`, `import`, `init`, `list`, `read`, `rename`, `update`, `validate`. The Linux backend's own: `enable-disable`, `move`, and `list parent`, `list overlay` in `list.md`. The no-OS backend's own: `generate`, and `list context` in `list.md`. Withdrawn: `__list`, `ui` |
| `04-protocol/*.schema.json` | JSON Schema (2020-12) of the `--json` responses (§2.1) |
| `05-completion.md` | Shell completion: `__complete` and `completion [<shell>] [--install \| --uninstall]` |

### 2.1 Protocol schemas

Each schema is named after its command, spaces as `-`: `add.schema.json`,
`list-devices.schema.json`, `list-parent.schema.json`. `enable` and `disable`
share `enable-disable.schema.json`. `common.schema.json` has the shared
shapes and `config-error.schema.json` the configuration errors written to
standard error (`02-common.md` COM-071).

A shared command's schema follows `src/interface/backend-responses.ts`:

- `$defs/base` is the shared response, open to more fields;
- `$defs/linux` is the Linux backend's response: the base with its own
  fields (`allOf`, closed with `unevaluatedProperties: false`), or a refusal.
  A field the Linux backend keeps for one release only is marked
  `deprecated`;
- `$defs/noos` is the no-OS backend's response, built the same way;
- the root is `anyOf` the backends' definitions.

A client that knows its backend validates against that backend's
definition: `read.schema.json#/$defs/linux`. A shared command that only one
backend implements has only that backend's definition next to `base`:
`list-context.schema.json` has `$defs/noos`, since the linux backend answers
that `list context` is not supported (COM-015). The schemas of a backend's
own commands (`move`, `enable-disable`, `list-parent`, `list-overlay`;
`generate`) and of the front end's (`config`, `completion`, `skill`) have no
`base` and are validated at the root.

`src/contract.test.ts` runs each command in a fixture workspace and
validates its `--json` output this way: a shared command's against
`$defs/<backend>` and the root, the others' against their own schema, and a
configuration error on standard error against `config-error.schema.json`.

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
| CLI | The `analog-attach` process. |
| Backend | The ecosystem the project's `backend` setting names: `linux` or `noos` (`02-common.md` COM-013). |
| Project root | The nearest directory, from the CWD up, with a `.analog-attach/` directory; the CWD when there is none (COM-120). |
| Settings files | The local `.analog-attach/config.json` under the project root and the global `$XDG_CONFIG_HOME/analog-attach/config.json` (`02-common.md` §8.1). |
| State directory | `.analog-attach/<backend>/` under the project root (`.analog-attach/linux/`): the backend's caches and scratch files. |
| Workspace | The project root with its settings and state directory. |
| Linux tree | Where the backend is linux: the Linux source tree the `linux` setting names. |
| Base | Where the backend is linux: the devicetree source the `devicetree` setting names, after `preprocess-command`. |
| Workfile | The file the `workfile` setting names: the only project file the backend edits. Where the backend is linux, the overlay (`.dtso`); "the overlay" in the Linux chapters means it. Where the backend is noos, a JSON file: the target (`platform`, `board`) and the nodes. |
| Merged tree | The base with the workfile applied. A node "exists" when the merged tree has it. |
| Binding | The dt-schema YAML in the Linux tree whose `compatible` list has the device's compatible string. |
| capi | Where the backend is noos: the CAPI checkout the `capi-path` setting names; its `module.yml` names it a module. |
| Module repository | Where the backend is noos: a directory with a `module.yml` that the `module-paths` setting names: a platform backend (chips and boards) or a driver collection. |
| Schema | Where the backend is noos: a ruleset of capi or a module, named by its key (`test_spi_device`): the properties of one kind of node. `add` takes a schema, a driver or an eval board (`list devices`). |
| Driver | Where the backend is noos: a part's driver, from a driver collection. It implements one or more interfaces, each a schema (`add --as`). |
| Eval board | Where the backend is noos: a driver's evaluation-board preset, listed as `eval-<part>`. |
| Node | Where the backend is noos: an instance of a schema, named by a C identifier (its symbol). A stored node is in the workfile (`origin` `internal`); an external node is a board or driver resource the workfile only names (a BSP config, the handle wrapping it, an ops table; `origin` `external`). |
| Union | Where the backend is noos: a property that takes one of several members, each with its own value (`comm_init` is `spi_dev` or `i2c_dev`). |
| Project | Where the backend is noos: the directory `generate` writes and `build` and `deploy` act on (`project-path`, else `out/<project-name>`). |
| Label | A devicetree label (`spi0` in `spi0: spi@7e204000 { … }`) of the base or the workfile. |
| Unit address | The part of a node name after `@`. |
| Terminal run | A run whose standard input and standard output are both terminals (`isatty`). |
| JSON mode | A run with `--json` (COM-010). |
| Human mode | A run without `--json`. |
| Refusal | The command doesn't do what was asked, because of the workspace's state or a value that is valid syntax but unusable. Reported per COM-040. |
| Input error | The command line is malformed. Reported per COM-031. |
