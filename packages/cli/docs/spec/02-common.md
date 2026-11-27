# Common behaviour

## 1. Modes and the backend

**COM-010** Where argv contains `--json` before a `--` (GRM-001), the CLI
shall run in JSON mode; otherwise it shall run in human mode.

**COM-011** While in JSON mode, the CLI shall not ask a question.

**COM-012** The CLI shall treat a run as a terminal run when, and only when,
both its standard input and its standard output are terminals. Commands that
ask questions ask them only in a terminal run in human mode, and their
chapter says which.

**COM-013** The CLI shall run every command with the backend that the
`backend` setting names (§8.1): it decides which commands exist besides the
shared ones (GRM-002), which settings there are, and what the commands do.
`config`, `completion`, `--help`, `--version`, `__complete` and the bare run
work with no backend set. Shared text in this specification says "the
backend"; a requirement that holds for one backend only says so ("Where the
backend is linux, …").

**COM-014** If a command other than those of COM-013 runs while `backend` is
unset, then the CLI shall report the input error `No backend is set. Run
'analog-attach' on a terminal, or 'analog-attach config backend <ids>'.`,
`<ids>` being the offered backends (COM-017) joined with `|` (`linux`). If
`backend` names no known backend, then the input error shall be `Unknown
backend: <id>. Known backends: <list>. Run 'analog-attach config backend
<ids>'.`, `<list>` the offered backends joined with `, `.

**COM-017** The CLI shall not offer the noos backend: the backends a project
may pick, the *offered backends*, are the known backends but `noos`, and the
active one. `config backend` shall take only an offered backend, refusing
another as a value outside the setting's options (`config.md` CONFIG-103:
`backend: "noos" is not one of linux — The ecosystem this project targets:
linux`);
the bare run's question (`setup.md` SETUP-020), the GUI's ecosystem step
(`gui.md` GUI-007), completion (`05-completion.md`), the help (GRM-008),
`--help --all` and the messages of COM-014 shall name only those. A project
whose `backend` is already `noos` shall still run with it, and may switch to
`linux`; switched away, it can't switch back. The no-OS backend is out of
use for the foreseeable future; its requirements (*Where the backend is
noos*) are kept for the projects set to it, and for when it is offered
again.

**COM-015** If a shared command is one the backend doesn't provide, then the
CLI shall leave it out of the help and report the input error `<command> is
not supported by the <id> backend`.

**COM-016** The CLI shall read the files it ships (`package.json`, `bundled/`,
`skills/`) from its installation: the package's directory, or, where the CLI
is the standalone binary (`yarn build:binary`), the directory
`<cache>/analog-attach/<version>-<hash>/`, which the first run of a build
writes from the binary and every later run reads. `<cache>` is
`$XDG_CACHE_HOME` when it is an absolute path, else `~/Library/Caches` on
macOS, `%LOCALAPPDATA%` on Windows and `~/.cache` elsewhere; `<hash>` changes
with the files.

## 2. Streams

**COM-020** While in JSON mode, the CLI shall write at most one line to
standard output: one JSON object, the command's response, as its chapter and
`04-protocol/` define it.

**COM-021** The CLI shall write notes and warnings about the command's result
(the parent `add` chose, an address clash, a cache warning, an `import`'s
unresolved targets) to standard error, in both modes, as free text, one or
more lines each. These lines aren't part of the protocol: a client may show
them and must not parse them.

**COM-022** While in human mode, the CLI shall write results and refusals to
standard output, and input errors (§3), notes, warnings (COM-021) and
progress (COM-112) to standard error.

**COM-023** The CLI shall exit only once standard output and standard error
have been written out, so a pipe gets the whole output however long it is
(`list devices`, `list context`). If the reader of either closes it first
(`| head`), then the CLI shall stop without a message, with status 0.

Exceptions:

| Command | Differs from | How | Issue |
|---|---|---|---|
| `config` | COM-040, COM-072 | a problem with a settings file is an input error on standard error with status 2, not a refusal (`config.md` CONFIG-005, CONFIG-102, CONFIG-200); a value it can't take is a refusal (COM-043) | — |

## 3. Input errors

An input error is a malformed command line: what the argument parser rejects
(GRM-004, GRM-013), and the CLI's own checks: GRM-020 to GRM-023, GRM-030,
GRM-060, a required path or property left out (`Missing: path` from
`update`, `enable` and `disable`, `Missing: property name` from `update`;
`update.md` UPDATE-001, `enable-disable.md` ENABLE-001), COM-014 and
COM-015. A value the command line gives that is well formed but can't be
taken is not one: it is refused (COM-043).

**COM-030** When the command line has an input error, the CLI shall do
nothing else: it shall not load the workspace or write a file. Exception:
`read` loads the workspace (COM-070) before it checks its path and property,
so a workspace problem is reported instead of the input error, and the base
is preprocessed (COM-090). (Open issue C-8.)

**COM-031** When the command line has an input error, the CLI shall write the
message to standard error, write nothing to standard output, and exit with
status 2, in both modes.

**COM-032** *Withdrawn.* (Human mode: commander's errors on standard error
with status 1. Every input error now follows COM-031.)

**COM-033** *Withdrawn.* (Human mode: the CLI's own input errors on standard
output with status 0. Every input error now follows COM-031.)

## 4. Refusals

A refusal: the command line is well-formed but the command can't do what it
asks, for example a compatible with no binding, or a parent that doesn't
exist.

**COM-040** While in JSON mode, when a command refuses, the CLI shall respond
`{"ok": false, "message": <why>, "severity": "error", "error_type": <type>}`
(COM-051) and exit with status 0.

**COM-041** While in human mode, when a command refuses, the CLI shall write
the reason to standard output and exit with status 0. (Open issue C-1.)

**COM-042** When a command refuses, the CLI shall leave the workfile and the
settings files as they were. Scratch files under the state directory (§8)
may have been rewritten. Where the backend is linux, exceptions: `config
linux <path>` saves `linux` before it builds the caches and refuses when the
build doesn't happen or fails (`config.md` CONFIG-122, CONFIG-123, CF-6), and
the setup run keeps the settings its steps saved when its cache build fails
(`setup.md` SETUP-030, SETUP-033, SETUP-035).

**COM-043** When a command is given a value it can't take (a setting value
that isn't one of its options, or names no file; a property value that
doesn't parse for its kind or that its definition doesn't allow; a flag's or
positional's value outside its choices, such as `deploy --probe`, a skill
name, a completion shell), the CLI shall refuse (COM-040): status 0, `ok:
false` with the reason under `--json`. The command ran; the value was wrong.
Input errors (§3, status 2) are for a command line that can't be run at all:
an unknown command, flag or setting key, a missing or extra argument.

**COM-140** When a refusal or an input error is about a name that isn't one
of a known set (a setting, a kind, a device type), the message shall name the
closest names of the set: ` Did you mean <a>, <b>?`, at most three, those a
few edits away first (a third of the name's length, at least two: insertions,
deletions, changes, swaps of two neighbours), then, for a name of three
characters or more, those that contain it. With none close, the sentence is
left out.

## 5. Success

**COM-050** While in JSON mode, when a command succeeds, the CLI shall
respond with an object whose `ok` is `true`, and exit with status 0. Its
`severity` is `"info"`, or `"warn"` where the command's chapter says so: the
`delete` preview, a `rename`, `update`, `move` or `import` that warned, and
`list parent` for a compatible with no binding; where the backend is noos,
the `delete` preview and a `build` that left no ELF; `validate`'s is taken
from its findings (`validate.md` VALIDATE-021). The fields sit alongside the
command's own: `read` gives the node or property with them (`read.md`
READ-012). (Exceptions in §2.)

**COM-051** While in JSON mode, a refusal (COM-040), a success whose
`severity` is `"warn"` (COM-050) other than `validate`'s, and each finding of
`validate` shall carry `error_type`: one of the fixed list of error types
(GEN-17; the Error types tab of the requirements workbook,
`src/interface/error-types.ts`), the same in every ecosystem, so that
scripts and the UI can tell the cases apart; the message says which case it
is. A success whose `severity` is `"info"` has none. Input errors (§3) don't
carry it yet: they are text on standard error.

**COM-052** Where the backend is linux, the error type shall be the one this
table gives for the case; a success that warned more than once carries the
type of its first warning.

| Case | `error_type` |
|---|---|
| A node, property, parent, overlay, example or template node named that isn't there | `not-found` |
| Several overlays have the name given (`import`, `add --template overlay:`) | `ambiguous` |
| A compatible with no binding (`add`; `list parent`, a warning; `list property` / `list value` on a node without one) | `unknown-device-type` |
| A node of the base devicetree, or the root, that `delete`, `move` or `rename` can't change | `read-only` |
| A node name or label that isn't allowed | `invalid-name` |
| A name or label already taken under the parent, or a `reg` update whose new name is | `name-taken` |
| A value `update` can't build (a value for a flag, an unknown word, a value for a child node) | `invalid-value` |
| A `move` the binding doesn't allow, or into the node itself; an update that would leave an overlay that doesn't parse | `edit-refused` |
| dtc, dt-validate, dt-mk-schema, `AA_PREPROCESS_COMMAND`, `AA_BUILD` or `AA_DEPLOY` (COM-151), noos's `build-command` or `deploy-command` that fails; an example that doesn't compile | `tool-failed` |
| An overlay that doesn't parse after preprocessing | `parse-error` |
| A workfile `init` or `import` can't create or configure | `write-failed` |
| A binding a node's data can't narrow (`list property <path> <property>`) | `definition-error` |
| The `delete` preview | `needs-force` |
| A property `update` writes that the binding doesn't define, or without one | `unchecked` |
| A value, count or interrupt-parent's cell count the binding doesn't allow (`update`, a warning) | `out-of-range` |
| An address clash (`update … reg`, `rename`) | `resource-conflict` |
| An overlay `import` takes for another board | `unresolved` |
| A reference or a fragment target that names no node: in an imported overlay (`import`, a warning), in the overlay `validate` checks (a finding, VALIDATE-029), or in a full devicetree `build` refuses (BUILD-013) | `unresolved` |
| A configuration problem (COM-071) | its first problem's (COM-071) |

`validate`'s findings carry theirs per `validate.md` VALIDATE-029.

## 6. Cancellation

**COM-060** When the user stops a question (Ctrl-C or end of input) before
the command has written anything, the CLI shall write a line saying so to
standard output and exit with status 130. (`add` and the setup run,
`setup.md`, say which of their questions this applies to.)

## 7. Exit status

| Status | When |
|---|---|
| 0 | The command answered: a success, or a refusal (COM-040, COM-041). Also `--help`, `--version` and `__complete`. A configuration error of a command (COM-071, COM-072). |
| 1 | An error the CLI doesn't handle (COM-130), in both modes. |
| 2 | Both modes: an input error (COM-031). `config`: a settings file it can't read or write, in both modes (`config.md`). |
| 130 | A question was stopped before anything was written (COM-060). |

**COM-130** If a command throws an error, then the CLI shall write the
error's message to standard error and exit with status 1, in human and in
JSON mode alike. Standard output has what the command wrote before the
error, if anything: in JSON mode no response. (`skill install` with a
read-only home, an `AA_PREPROCESS_COMMAND` that writes no output.)

A JSON client MUST read `ok` to tell success from refusal. The exit status
only separates "the CLI answered" (0) from "the command line was malformed, or
`config` couldn't read or write a settings file" (2) and "the command failed
without answering" (1). An unusable workspace is a refusal (COM-071, COM-072).

## 8. Workspace loading

The project root is the nearest directory, from the CWD up, that has a
`.analog-attach/` directory (COM-120). It holds the local settings file
`.analog-attach/config.json`, and the backend's state directory
`.analog-attach/<backend>/` (`.analog-attach/linux/`), where the backend keeps
its caches and scratch files. In this specification, *the state directory*
is that directory.

Each command needs some of the resources of the workspace: the settings,
and the backend's own. Where the backend is linux, they are the bindings
(the Linux tree, the installed dt-schema and the caches), the tools (dtc and
dt-schema, §8.4), the base, the workfile, and the scripts `build` and
`deploy` run (§8.6). Its chapter says which. Where the backend is noos, a command reads
its settings as it goes instead (§8.5).

**COM-070** When a command needs workspace resources, the CLI shall check all
of them before doing anything, and collect every problem found across
resources that don't depend on each other.

**COM-071** While in JSON mode, if workspace loading finds problems, then the
CLI shall refuse (COM-040) with status 0: one line on standard output
conforming to `04-protocol/common.schema.json#/$defs/config-refusal`, with
`ok` false, `message` the problems' messages joined by `; `, `severity`
`error`, `error_type` the first problem's, and `errors` and `hints`.

`errors` has one entry per problem (its `field`, `kind`, `error_type`,
`message` and, when it has one, `description`), and `hints` has the distinct
hints of those problems in the order the problems were found, the setup hints
of several fields merged into one (§8.1). A problem's `error_type` is
`missing-setting` for a setting with no value; `workfile-missing` for a
workfile that doesn't exist; `invalid-source` for a `linux` that isn't a Linux
tree; `parse-error` for a base or workfile that doesn't parse; `tool-missing`
for an `AA_PREPROCESS_COMMAND`, dtc or dt-schema not on PATH, a dtc or dt-schema
the CLI doesn't take (COM-118, COM-119), or a script that isn't a file or
isn't executable (COM-150); `tool-failed` for a base whose preprocessing
fails; `cache-missing` for a binding cache missing (§8.4); `not-generated`
for a script that is missing (COM-150); `missing-setting` also for a secret
`deploy` can't get (`deploy.md` DEPLOY-042); and `invalid-setting` for any
other value a setting can't take.

**COM-072** While in human mode, if workspace loading finds exactly one
problem, then the CLI shall write `<message>` (or `<message> — <description>`
when the problem has a description) to standard output. If it finds several,
then the CLI shall write `Configuration errors:` followed by one such line
for each, indented by two spaces. In both cases, when there are hints, the CLI
shall then write an empty line and one line per hint. The exit status is 0.
(Open issue C-1.)

Example, `add` with only `backend` set:

```
Configuration errors:
  Missing config field linux — Path to Linux kernel source tree (setting it builds the binding caches)
  Missing config field devicetree — Path to target base DTS file
  Missing config field workfile — Path to the working DTSO overlay file (workfile)

Run 'analog-attach' on a terminal, or 'analog-attach config linux <path>', 'config devicetree <path>' and 'config workfile <name>', then 'analog-attach init', to set up a workspace.
```

**COM-080** Where the backend is linux, when a command needs the bindings and
their caches exist, the CLI shall use them even when they are out of date.

**COM-081** Where the backend is linux, when a command needs the bindings and
a cache isn't current (COM-116), the CLI shall write one line to standard
error, `warning: <reason>; run 'analog-attach config --reload' to rebuild
them.`, and go on. `<reason>` is `The binding caches were built for <old>,
not <new>` when a stamp names another Linux tree, else `The binding caches
are older than the bindings`, also when the cause is a stamp that names
another dt-schema directory or version, or has no `generated_at` number. A `validation.stamp.json`
that is missing gives no warning. Where the CLI runs in a process that runs
several commands (`gui.md` GUI-011), the latest modification under the
bindings and the `dtschema` package is looked up at most once every 5 seconds,
so a binding changed in between is warned about up to 5 seconds later.
(Open issue C-9.)

### 8.1 Settings

The settings are in two files: the local `.analog-attach/config.json` under
the project root, and the global `$XDG_CONFIG_HOME/analog-attach/config.json`
(`~/.config/analog-attach/config.json` when `XDG_CONFIG_HOME` is unset, empty
or relative). Each backend's settings are in their own object of a file, its
*section*, named after the backend's id; the front end's `backend` is at the
top level (COM-131):

```json
{
  "backend": "linux",
  "linux": { "linux": "~/linux_rpi", "devicetree": "/home/u/linux_rpi/arch/arm/boot/dts/broadcom/bcm2711-rpi-4-b.dts", "workfile": "/home/u/work/overlay.dtso" },
  "noos": { "capi-path": "~/capi", "board": "max32655fthr", "platform": "max32655", "workfile": "/home/u/work/workfile.json" }
}
```

The keys are kebab-case, and the values strings (a `path_list` is an array
of strings). The *active section* is the section of the backend that
`backend` names. Two backends can have a setting of the same name
(`workfile`): each is its own.

**COM-131** The CLI shall read each settings file as one JSON object whose
top level has `backend` and, for each known backend (`linux`, `noos`), an
object named after its id holding that backend's settings. It shall read the
backend's settings from the active section only. With `backend` unset, or
naming no known backend, no section is active: the settings are `backend`
alone (`config.md` CONFIG-010).

**COM-135** The CLI shall neither read nor check a section other than the
active one, and shall keep it as it is when it writes the file (COM-129).
`config backend <id>` only changes which section is active
(`config.md` CONFIG-112), so switching back finds the settings as they were.

**COM-136** `backend` shall be the project's: only the local file holds it,
so that projects on one machine can target different ecosystems. If the
global file has a top-level `backend`, then reading shall leave it out and
report `{ field: "backend", kind: "invalid", message: "<file>: backend
belongs to the project and can't be in the global settings" }`, with the
setting's description and the hint `Remove it: config --global backend
--reset, then set it in the project.`. The global file's sections are
read as before (COM-124): they are the defaults a project's backend starts
from.

A file of the earlier flat format, every key at the top level, is not
converted: its keys are unknown top-level keys (COM-132), and where the
backend is linux its `"linux": "<path>"` is a section that isn't an object
(COM-134).

The front end has one setting, `backend`:

| Key | Kind | Required¹ | Default | Description (as `config` shows it) |
|---|---|---|---|---|
| `backend` | one of the offered backends (COM-017): `linux`, and `noos` where it is the active one | yes | — | `The ecosystem this project targets: linux` (`linux or noos` where the backend is noos) |

Where the backend is linux, its settings follow, in the order the CLI writes
them:

| Key | Kind | Required¹ | Default | Description (as `config` shows it) |
|---|---|---|---|---|
| `linux` | path (directory) | yes | — | `Path to Linux kernel source tree (setting it builds the binding caches)` |
| `devicetree` | path (file) | yes | — | `Path to target base DTS file` |
| `workfile` | path (file) | no | — | `Path to the working DTSO overlay file (workfile)` |
| `overlay-syntax` | one of `fragment`, `reference` | no | `fragment` | `fragment: fragment@0 { target = <&spi0>; __overlay__ { … }; };  reference: &spi0 { … };` |
| `interview` | `true` or `false` | no | `true` | `On a terminal, ask for the parent of 'add' and for the required properties a new node lacks (true/false)` |
| `output` | one of `overlay`, `devicetree` | no | `overlay` | `What 'build' makes and 'deploy' copies: overlay (default, a .dtbo) or devicetree (the base with the overlay applied, a .dts and its .dtb); the scripts get it as $AA_OUTPUT` |
| `build-dir` | string: a folder, relative to the directory that holds `.analog-attach/` unless absolute (`~` the home directory) | no | `build` | `Folder aa_build.sh writes its output to and aa_deploy.sh takes it from, relative to the project unless absolute; the scripts get it as $AA_BUILD_DIR` |

`build-command`, `deploy-command`, `deploy-ip`, `deploy-user` and
`deploy-password` are gone: `build` and `deploy` run the project's
`AA_BUILD` and `AA_DEPLOY`, and the board is the scripts' variables (§8.6).
`preprocess-command` is gone too: the preprocessor is `AA_PREPROCESS_COMMAND`
(§8.2, COM-158). A file that still has one has an unknown key (COM-133); it
isn't converted.

The section may also have `variables`, the project's variables (COM-154):
not a setting, so `config` doesn't list it with them.

¹ What `config` reports as `required`. Whether a command needs a field is
decided by the resources it needs (COM-070), not by this column.

Where the backend is linux, each field has a hint, printed when it is
missing or invalid (COM-072). For `linux` and `devicetree`, and for a missing
`workfile`, it is the *setup hint* of the field: `Run 'analog-attach' on a
terminal, or <commands><then>, to set up a workspace.`, `<commands>` being
the field's `config` command, `'analog-attach config linux <path>'`,
`'analog-attach config devicetree <path>'` or `'analog-attach config workfile
<name>'`, and `<then>` being `, then 'analog-attach init'` for `workfile` and
empty otherwise. When several fields have a setup hint, they are merged into
one: `<commands>` names each of them in field order, joined by `, ` and a
last ` and `, `analog-attach` written only in the first (`'analog-attach
config linux <path>' and 'config workfile <name>'`), and `<then>` is there
when `workfile` is one of them. So a hint names only the fields that are
unset or wrong. For an invalid `workfile` (its file missing or not parsing)
the hint is `Run 'analog-attach init' to create it, or 'analog-attach config
workfile <name>' to use another.`. The other fields have none.

**COM-500** Where the backend is noos, its settings shall be these, in the
order the CLI writes them and `config` lists them (by category, then within
one):

| Key | Category | Kind | Required¹ | Default | Description (as `config` shows it) |
|---|---|---|---|---|---|
| `capi-path` | Sources | path (directory with a `module.yml`) | yes | — | `Path to the root of the capi repository` |
| `module-paths` | Sources | path_list (directories) | no | — | `Module repositories to load rulesets from (platform backends, driver collections)` |
| `target` | Target | one of the boards, or chips, of the module repositories | yes | — | `What a new workfile is for: a board (which brings its chip), or a chip used without a board` |
| `workfile` | Workfile | path | yes | `workfile.json` | `Workfile the commands act on, relative to the project root unless absolute` |
| `bootstrap` | Workfile | `true` or `false` | no | `true` | `After 'add', fill in every value and node that leaves no room for choice (true/false)` |
| `interview` | Workfile | `true` or `false` | no | `true` | `After 'add', on a terminal, ask for the choices and values bootstrap leaves to you (true/false)` |
| `project-name` | Project | string | no | — | `Name of the generated project (unset: the name of the workfile's directory)` |
| `project-path` | Project | path | no | — | `Directory of the generated project: 'generate' writes it, 'build' and 'deploy' act on it (unset: out/<project-name>)` |
| `project-template` | Project | a template set: a bundled set's name, or a directory | no | `capi` | `Template set used by codegen: a folder name under codegen/templates, or a path to your own template folder` |
| `example` | Project | `true` or `false` | no | `true` | `Have the generated main.c run each part's example (true), or your own app_main() in src/app.c (false)` |
| `build-command` | Build | string | no | — | `Override the 'build' step with this command, run at the base of the project (unset: drive CMake directly)` |
| `deploy-command` | Build | string | no | — | `Override the 'deploy' step with this command, run at the base of the project (unset: build the CMake flash target)` |
| `probe` | Build | one of `openocd`, `jlink` | no | `openocd` | `Debug probe 'deploy' flashes through` |
| `build-dir` | Build | string: a folder, relative to the generated project unless absolute (`~` the home directory) | no | `build` | `Folder 'build' builds the generated project in and 'deploy' flashes from, relative to the project unless absolute` |

`<project-name>` in the descriptions is literal. The boards and chips are
those the module repositories of `module-paths` define, scanned on every run
(`config.md` CONFIG-510); the bundled template sets are `capi` and
`capi-iio`. Writing a setting checks more than its kind (`config.md`
CONFIG-500 to CONFIG-505).

**COM-501** Where the backend is noos, `capi-path` shall have the hint `Run
'analog-attach config capi-path <path>', or 'analog-attach' on a terminal for
the guided setup.`, and `target` the hint `Run 'analog-attach config target
<board or chip>' ('analog-attach list context' lists them).`. The other fields have
none.

**COM-120** The CLI shall find the project root by walking up from the CWD
to the nearest directory that has a `.analog-attach/` directory. The walk
shall not check the home directory or the filesystem root unless the CWD is
that directory. When no directory has one, the project root is the CWD. The
CLI shall not read settings from the environment.

**COM-121** If a settings file can't be read, isn't JSON, or isn't a JSON
object, then reading shall report the one error `{ field: "config.json",
kind: "invalid", message: "<file>: not JSON (<parser message>)" }` (or
`<file>: not a JSON object`, or `<file>: <read error>`) with the hint `Fix or
remove <file>.`. `<file>` is the file's path, with the home directory
written `~`. A missing file is no error: its settings are unset.

**COM-122** *Withdrawn.* (An unknown key of the flat local file: `<file>:
unknown key <key>`, the hint naming `backend` and the backend's keys. The
settings are now sectioned: COM-132 for the top level, COM-133 for the
active section.)

**COM-132** If the local file has a top-level key that is neither `backend`
nor a known backend's id, then reading shall report `{ field: <key>, kind:
"unknown", message: "<file>: unknown key <key>" }` with the hint `Remove
unknown keys from <file>; valid top-level keys are backend and the backends'
sections <ids>, each an object of that backend's settings.`, `<ids>` being
the known backends joined with `, ` (`linux, noos`). Unknown top-level keys
of the global file are kept and ignored.

**COM-133** If the local file's active section has a key that isn't one of
the backend's settings, then reading shall report `{ field: "<id>.<key>",
kind: "unknown", message: "<file>: unknown key <id>.<key>" }` with the hint
`Remove unknown keys from <file>; valid keys in <id> are <keys>.`, `<id>`
being the backend's id and `<keys>` its keys in the order of the tables,
joined with `, `, then `variables` where the backend is linux (COM-154).
Unknown keys of the global file's active section are kept and ignored.

**COM-134** If a known backend's id at the top level of either file names
something that isn't a JSON object, then reading shall report `{ field: <id>,
kind: "invalid", message: "<file>: <id>: must be an object" }` with the hint
`Make <id> an object in <file>; valid top-level keys are …` worded as in
COM-132, whether or not the section is active. The CLI shall not write into
an active section that isn't an object (`config.md` CONFIG-102,
CONFIG-200); the top level, `backend`, can still be written.

**COM-123** If a value isn't a string, then reading shall report `<file>:
<name>: must be a string`. If it is the empty string, `<file>: <name>: must
not be empty`. If a setting with options has another value, `<file>:
<name>: "<value>" is not one of <a> | <b>`. If a global path is relative,
`<file>: <name>: "<value>" is relative; a global path must be absolute or
start with ~`. `<name>` is `backend` at the top level, and `<id>.<key>` for a
key of the active section (`linux.devicetree`); the error's `field` is
`<name>`. Each is `kind: "invalid"` and carries the field's description and
hint. The invalid value is left out: the setting has the next layer's value,
or none.

**COM-124** The effective value of a setting shall be the local file's, else
the global file's, else the default, the files layered section by section: a
backend's setting is the local file's in its section, else the global file's
in its section. The source of a value (`config.md` CONFIG-012) is the file it
comes from. A default may follow another setting's effective value. (Open issue C-3: which commands report the problems of COM-121
to COM-123 and COM-132 to COM-134.)

**COM-125** The CLI shall resolve a relative path of the local file, in any
section, against the project root, and a path of either file that starts
with `~` against the home directory. Reading doesn't check that the path
exists; the resource that needs it does (COM-127).

**COM-126** If a command needs a resource whose field is unset, then loading
shall report `{ kind: "missing", message: "Missing config field <key>" }` with
the field's description and hint.

**COM-127** Where the backend is linux, if a path field names nothing, then
loading shall report `<key>: <path> does not exist`. If it names a directory
where a file is needed (`devicetree`, `workfile`) or the reverse (`linux`),
then loading shall report `<key>: <path> is not a file` or `<key>: <path> is
not a directory`.

**COM-128** Where the backend is linux, if the `linux` directory has no
`Documentation/devicetree/bindings/`, or no `include/`, then loading shall
report `linux: no <dir>/ under <path> (not a Linux source tree)`, `<dir>`
being the first of the two it lacks.

**COM-129** When the CLI writes a setting, it shall rewrite that one file
(the local one, or the global one with `--global`) as a JSON object indented
by two spaces, `backend` at its top level and a backend's setting in the
active section. The top level has `backend` first, then the sections in the
order of the known backends (`linux`, `noos`), then every other key the file
had, unchanged. The active section has the backend's settings in the order
of the tables, then every other key it had, unchanged; a section left empty
is removed. The other sections are written as they were (COM-135). It shall
create the file's directory when it doesn't exist. A path that starts with
`~` is written as typed; any other local path absolute (resolved against the
CWD), and a global path as typed. It shall not write over a file of COM-121,
nor into an active section of COM-134.

### 8.2 The base devicetree

Where the backend is linux:

**COM-090** When a command needs the base, the CLI shall, on every run, run
`AA_PREPROCESS_COMMAND` (COM-158) with `$AA_PREPROCESS_INPUT` the `devicetree` file and
`$AA_PREPROCESS_OUTPUT` a file of the run's own in `.analog-attach/linux/`
(`preprocessed.<process id>.dts`), then rename the output to
`.analog-attach/linux/preprocessed.dts` and parse it. The base is never cached
between runs, except that a process running several commands keeps the output
(COM-097). (Open issue C-10.)

**COM-091** The CLI shall run the command with the system shell (`/bin/sh
-c`), as written, in the CWD, with the environment of COM-152 for
`preprocess`: the files of COM-090 are `$AA_PREPROCESS_INPUT` and
`$AA_PREPROCESS_OUTPUT`, and the Linux tree `$AA_LINUX`. Its default is

```sh
cpp -nostdinc -undef -x assembler-with-cpp -P -I "$AA_LINUX/include" -o "$AA_PREPROCESS_OUTPUT" "$AA_PREPROCESS_INPUT"
```

The command may be several lines, a script of its own.

**COM-092** Where the command contains `AA_LINUX`, the CLI shall check the
`linux` field (COM-126 to COM-128) as part of loading the base, and use the
Linux tree for it. Where it doesn't, the base doesn't need `linux`.

**COM-093** Before preprocessing, the CLI shall run `<tool> --version`, where
`<tool>` is the command's first word, when the command is one line whose
first word is a program's name or path (letters, digits and `_ . / + -`,
not a shell word such as `set`, `cd`, `exec`, `env`, `if` or `{`). If that
fails to start or exits non-zero, then loading shall report
`AA_PREPROCESS_COMMAND: <tool> not found on PATH (needed to preprocess
<devicetree>)`, with `field` `AA_PREPROCESS_COMMAND`, the variable's
description and `error_type` `tool-missing`. Its hint is `Install cpp:
'<command>'.` when the tool is `cpp` (the default), `<command>` being `sudo
apt install cpp` for debian or ubuntu, `sudo dnf install cpp` for fedora,
rhel or centos, `sudo pacman -S gcc` for arch, `sudo zypper install cpp`
for suse or opensuse (by `/etc/os-release`, as COM-118) and `xcode-select
--install` on macOS, elsewhere `Install cpp, the C preprocessor, with your
package manager.`; for another tool it is `Install <tool>, or set
AA_PREPROCESS_COMMAND to another command ('config var AA_PREPROCESS_COMMAND
<command>').`. A command of several lines, or that starts otherwise (a
variable, an assignment, a shell word), is run unchecked. No version is
checked. (Open issue C-4.)

**COM-094** If the command exits non-zero, then loading shall report
`devicetree: preprocessing <devicetree> failed:` followed by a newline and the
command's standard error.

**COM-095** If the output doesn't parse as a devicetree, then loading shall
report `devicetree: <devicetree> does not parse after preprocessing: <error>`.

**COM-096** The CLI shall preprocess the other devicetree sources it reads
with the same command and `$AA_LINUX` always set: `import`'s overlay into
`.analog-attach/linux/import.preprocessed.dts`, `add --template overlay:` into
`.analog-attach/linux/overlay-template.preprocessed.dts`, `build`'s full devicetree
(where `output` is `devicetree`, build.md BUILD-014) into
`.analog-attach/linux/build.preprocessed.dts`, and binding examples
(`add --template example:`, the add fill-in) from `.analog-attach/linux/example.dts`
into `.analog-attach/linux/example.preprocessed.dts`. Those failures are refusals of
the command, not configuration errors.

**COM-097** Where the CLI runs in a process that runs several commands (the
GUI's, `gui.md` GUI-011) and `AA_PREPROCESS_COMMAND` is its default, when a
command needs the base and the process has preprocessed it before, with the
same Linux tree, the CLI shall parse that output again instead of running the
command, while `preprocessed.dts` is there and the files it was made from are
unchanged (the same size and modification time). Those are the `devicetree`
file and the files its `#include` and `/include/` lines name, from it down,
found as the default command finds them: a `"…"` one in the folder of the file
that includes it, then in the Linux tree's `include/` (where the file beside
must then still be absent), a `<…>` one in `include/`. Where that can't be told
(an include by a macro, `#include_next`, one found in neither place), or where
`AA_PREPROCESS_COMMAND` is another, the command shall run on every run. The tree
is parsed afresh on every run. The `<tool> --version` check of COM-093
shall run once per tool file (its path, size and modification time) and
`PATH`.

### 8.3 The workfile

Where the backend is linux, the workfile is the overlay the `workfile`
setting names:

**COM-100** When a command needs the workfile, the CLI shall load the base
first, then read the `workfile` file as written (without preprocessing) and
parse it against the base. An unset field is reported per COM-126 and a
missing file per COM-127. The workfile is the CLI's: `init` makes it and the
commands write it (COM-103). Unlike the base, it holds no preprocessor
directives (`#include`, `#define`), no macros (`IRQ_TYPE_EDGE_FALLING`) and no
comments: a directive or a macro makes it unparseable (COM-101), and a
comment is dropped on the next write. A hand-edited workfile that doesn't
parse is the user's to fix.

**COM-101** If the workfile doesn't parse, then loading shall report
`workfile: <file> does not parse: <error>`, `<error>` naming what it stopped
at and where, as `'<text>' (line <n>, column <n>)`. Example:
`workfile: overlay.dtso does not parse: Failed to parse overlay: Preprocessor
directives aren't supported: '#include' (line 3, column 1)`.

**COM-102** If the base fails to load, then loading shall report the base's
problems and those of COM-126 and COM-127 for `workfile`, but not try to parse
the workfile.

**COM-103** When a command writes the workfile, the CLI shall write the whole
file, printed from the parsed tree: `/dts-v1/;`, `/plugin/;` and the
fragments, indented with tabs. Comments and the original layout are not kept
(COM-100).

**COM-104** Where `overlay-syntax` is `fragment`, the CLI shall print each
fragment as `fragment@<n> { target = <&<label>>; __overlay__ { … }; };`
inside `/ { … };`, or with `target-path = "<path>";` for a target named by
path. Where it is `reference`, the CLI shall print each as `&<label> { … };`, or
`&{<path>} { … };`, at the top level. The syntax applies to the whole file on
every write, whatever syntax the file was in.

Example, the same overlay in both syntaxes:

```
/ {                                      &spi0 {
	fragment@0 {                             	status = "okay";
		target = <&spi0>;                    };
		__overlay__ {                        &{/} {
			status = "okay";                 	foo {
		};                                   	};
	};                                       };
	fragment@1 {
		target-path = "/";
		__overlay__ {
			foo {
			};
		};
	};
};
```

### 8.4 Binding caches and tools

Where the backend is linux:

**COM-110** The CLI shall keep two binding caches under `.analog-attach/linux/`:
`compat-index.json`, an object `{ generated_at, linux, dt_schema,
dt_schema_version, entries }` whose `entries` map each compatible string to
the binding YAML that lists it; and, in `validation-cache/`, `validation.json`,
the output of `dt-mk-schema -j` over the Linux tree's bindings, with
`validation.stamp.json` `{ generated_at, linux, dt_schema, dt_schema_version
}` next to it. `generated_at` is in milliseconds since the epoch; `dt_schema`
is the directory that holds the installed `dtschema` package and
`dt_schema_version` its version (COM-119). The CLI shall derive `entries`
from `validation.json`: the strings of each Linux tree binding's processed
`compatible` property, dt-schema's own schemas left out. When several bindings list a string, the
one named after it (`net/snps,dwmac.yaml` for `snps,dwmac`) wins; then one
that names the device (lists it first); then one that has its own `select`
and lists it first (a naming convention such as `arm/qcom-soc.yaml`); then
one that only falls back to it. Among equals, the first by `$id` wins (open
issue C-13).

**COM-111** The CLI shall build the caches only in `config linux <path>`,
`config --reload`, and the setup run (`setup.md`) when they aren't current
(COM-116). Every other command only reads them, and writes in
`validation-cache/` only the parts of `validation.json` that VALIDATE-014 and
COM-138 derive from it.

**COM-112** When it builds the caches, the CLI shall compile
`validation.json`, then derive the compat index from it (COM-110), and write
progress to standard error, in both modes: first `Indexing device bindings
and compiling binding schemas...`; then the line `Indexed <n> compatibles from
<m> bindings and compiled binding schemas in <duration>`, `<m>` being the
Linux tree's bindings in `validation.json`, or `Compiling binding schemas
failed`, which on a terminal replaces the first line. `<duration>` is `4.2s`
under 10 seconds, `48s` under a minute, then `1m 12s`.

**COM-113** The CLI shall replace `validation.json` only once `dt-mk-schema`
has succeeded with a non-empty JSON output, remove everything else in
`validation-cache/` but its stamp (the subsets of validate.md VALIDATE-014, the
binding subset of COM-138 and the prepared schemas of COM-139), and write its stamp, then `compat-index.json`,
after it. A failed build writes
neither cache, so the previous pair stays.

**COM-114** Before a build, the CLI shall check the `linux` field (COM-126 to
COM-128) and the installed dt-schema (COM-119), and report their problems as
configuration errors without building anything.

**COM-115** When a command needs the bindings and the Linux tree and the
installed dt-schema are fine, if `compat-index.json` is missing, unreadable or
has no `entries`, or `validation.json` is missing, then loading shall report
for each `{ field: "compat-index" | "validation.json", kind: "missing",
message: "<file> not found or unreadable in <directory>" }`, `<directory>`
being `.analog-attach/linux` for the compat index and its `validation-cache`
for `validation.json`,
with the hint `Run 'analog-attach config --reload' to build the binding
caches.`

**COM-116** The CLI shall treat a cache as current when its stamp exists,
has a numeric `generated_at`, names the configured Linux tree and the
installed dt-schema's directory and version (when it names them), and is no
older than every file and directory under the Linux tree's
`Documentation/devicetree/bindings/` and under the installed `dtschema`
package (`.git` directories skipped). A cache that isn't
current only gets the warning of COM-081, and none when
`validation.stamp.json` is missing (open issue C-9).

**COM-117** *Withdrawn.* (dt-schema, dtc and dt-validate were bundled with
the installation, under `bundled/linux/`, and a missing one was an
incomplete installation. The CLI now runs the ones installed on the system,
COM-118 and COM-119, and ships none.)

**COM-118** The CLI shall run the `dtc` it finds on PATH, on every run that
needs the tools. If there is none, then loading shall report `{ field: "dtc",
kind: "missing", error_type: "tool-missing", message: "dtc not found on PATH"
}` with the hint `Install dtc: '<command>'.`. If `dtc --version` gives a
version older than 1.6.0, then loading shall report `{ field: "dtc", kind:
"invalid", error_type: "tool-missing", message: "dtc <version> is too old;
analog-attach needs 1.6.0 or later" }` with the hint `Install dtc 1.6.0 or
later: '<command>'.`; a version it doesn't print readably is taken.
`<command>` is `sudo apt install device-tree-compiler` where
`/etc/os-release`'s `ID` or `ID_LIKE` names debian or ubuntu, `sudo dnf
install dtc` for fedora, rhel or centos, `sudo pacman -S dtc` for arch, `sudo
zypper install dtc` for suse or opensuse, and `brew install dtc` on macOS;
elsewhere the hint is `Install dtc, the devicetree compiler, with your
package manager.` (`Install dtc 1.6.0 or later, …` when it is too old).

**COM-119** The CLI shall take dt-schema 2026.9 alone, found through the
`dt-mk-schema` on PATH, on every run that needs the bindings or the tools:
the Python that the script's first line names (`#!<path>`, `#!/usr/bin/env
<name>` looked up on PATH, or pip's `#!/bin/sh` line followed by `'''exec'
<path>`) gives the directory that holds its `dtschema` package and its
version, without importing it. The binding parser reads the schemas of that
package. The CLI shall run `dt-mk-schema` as that Python on
`dt-mk-schema.py` of its installation (`bundled/linux/`), which gives the
same output faster, or as the `dt-mk-schema` found when the installation has
no such file, and the `dt-validate` it finds on PATH. Loading shall report
these problems, with `field` `dt-schema` and `error_type` `tool-missing`:

| Problem | `kind` | `message` |
|---|---|---|
| no `dt-mk-schema` on PATH | `missing` | `dt-mk-schema not found on PATH` |
| no Python named on its first line | `invalid` | `Can't tell which Python runs <dt-mk-schema>` |
| the Python has no `dtschema` package | `missing` | `<python> (which runs <dt-mk-schema>) can't load the dtschema package` |
| another version | `invalid` | `dt-schema <version> is installed (<directory>); analog-attach needs 2026.9` |
| no `dt-validate` on PATH | `missing` | `dt-validate not found on PATH` |

Their hint is `Install dt-schema 2026.9: 'pipx install dtschema==2026.9',
then 'pipx inject dtschema ruamel.yaml.clib'.`, followed before the period
by ` (and 'pipx ensurepath' when pipx's bin directory isn't on PATH)` when
`dt-mk-schema` or `dt-validate` isn't on PATH. For another version it is
`Install dt-schema 2026.9 in its place: 'pipx install --force
dtschema==2026.9', then 'pipx inject dtschema ruamel.yaml.clib'.`. The tools'
problems come in the order dtc, dt-schema (`dt-mk-schema`), dt-validate.

**COM-137** When a command needs the bindings and `.analog-attach/linux/`
holds a `validation.json` (where an earlier version kept it), the CLI shall
move it, and `validation.stamp.json` when there is one, into
`validation-cache/`, unless that holds its own, which stays and the old ones
are removed, and remove `.analog-attach/linux/validation-subsets/`, before it
looks for the caches (COM-115). A file it can't move stays where it is.

**COM-138** When a command reads the bindings, the binding parser shall get
the binding subset of `validation.json` in its place: its `generated-types`,
its `generated-pattern-types`, the schemas with `select: true` (the ones
dt-validate applies to every node), and what isn't a schema (`version`), in
`validation.json`'s order. The CLI shall keep it in
`validation-cache/binding-subset-<key>.json`, `<key>` naming `validation.json`'s
size and modification time, write it the first time a command needs it, and
then remove the binding subsets of another key. When there is none (it can't
be written, or `validation.json` can't be read), the parser gets
`validation.json`. What a binding gives is the same either way.

**COM-139** When a command parses a binding, the binding parser shall take the
prepared schemas (the property types, and the definitions of the
`select: true` schemas, dereferenced and fixed up: what every binding is
parsed with) from `validation-cache/prepared-schemas-<key>.json` when it is
there and readable, and otherwise build them and write them there, then
remove the prepared schemas of another key. `<key>` names `validation.json`'s
size and modification time, the Linux tree, the installed dt-schema's root
and version, and the CLI's own program file, so a new build of the CLI
doesn't read what an earlier one wrote. When there's no `validation.json`, or
the file can't be written, the parser builds them. What a binding gives is
the same either way.

**COM-141** Where the CLI runs in a process that runs several commands (the
GUI's, `gui.md` GUI-011), it shall keep for the commands after:
- the dt-schema COM-119 found, for the same `PATH` and `PYTHONPATH`, while
  `dt-mk-schema`, its Python and the `dtschema` package keep their size and
  modification time;
- each binding it parsed, by binding file and controller, at most 64 (the
  ones used last), while the binding file, the file the parser reads in place
  of `validation.json` (COM-138) and `validation.json` keep theirs and the
  latest modification under the bindings and the `dtschema` package (looked up
  as COM-081 says) is the same, so a change to a file a binding's `$ref` names
  is seen within 5 seconds;
- the compat index and the prepared schemas (COM-139) it read, while their
  files keep theirs.

What a command answers is the same as on a run of its own.

### 8.5 The no-OS workspace

Where the backend is noos:

**COM-510** The CLI shall keep no state directory and no caches: a command
writes nothing under `.analog-attach/` (the settings files are the front
end's, COM-129). The chips, boards, schemas and drivers are read from
`capi-path` and `module-paths` on every run.

**COM-511** A command shall not load the workspace per COM-070 to COM-072.
It shall read the settings and files it needs as it goes, and report the
first problem as a refusal (COM-040, COM-041), in both modes with status 0.
(Open issue C-12.)

**COM-512** When a command needs the workfile, the CLI shall resolve
`workfile` (a directory names the `workfile.json` inside it), then refuse
with the first of these that applies:

| Problem | Message |
|---|---|
| No file at the path | `No workfile at '<path>'. Create one with 'analog-attach init', or point the 'workfile' setting elsewhere.` |
| The file isn't a workfile | the parser's message, e.g. `Failed to parse workfile as JSON: <path>` |
| `capi-path` unset | `Setting "capi-path" is not configured. Run: analog-attach config capi-path <value>` |
| The workfile's `platform` is no chip of the module repositories | `Unknown chip '<platform>'. Configured platforms support: <chips>`, `<chips>` the chips of the module repositories, sorted, joined with `, ` (empty with no `module-paths`: `read.md` R-6) |
| A node names a schema no module defines | `Unknown ruleset '<schema>': no module in the configured roots defines it` |

`<path>` is absolute. A setting another command needs and finds unset is
refused the same way: `Setting "<key>" is not configured. Run: analog-attach
config <key> <value>`.

**COM-513** The workfile shall be a JSON object `{ "platform", "board",
"symbols" }`: the target chip, the board when there is one, and the stored
nodes by name, each an object with its schema as `$compatible`, the names
of the properties bootstrap filled as `$auto`, and its values. When a
command writes the workfile, the CLI shall write the whole object, indented
by two spaces. A union's value is written `{ "<member>": <value> }`, a
reference as the name of the node it names.

**COM-514** The CLI shall write the output of the tools it runs (`build`,
`deploy`, a `build-command` or `deploy-command`) to standard error, in both
modes, after a progress line; standard output has only the result
(`build.md` BUILD-511, `deploy.md` DEPLOY-511).

### 8.6 Scripts and variables

Where the backend is linux, `build` and `deploy` run commands of the
project's: the *executable variables* `AA_BUILD` and `AA_DEPLOY` (COM-158),
`./aa_build.sh` and `./aa_deploy.sh` by default, the scripts in the project root.
`init` writes those starters (`init.md` INIT-100), and they are the user's to
edit from then on (the `build.sh` and `deploy.sh` of earlier releases aren't
run: a project renames them, or sets `AA_BUILD` and `AA_DEPLOY` to them); `config var AA_BUILD <command>` runs another command
instead. The third executable variable, `AA_PREPROCESS_COMMAND`, is the
preprocessor of every devicetree read (§8.2). A command gets what it needs in
its environment: the *system variables* the CLI computes, all named `AA_…`,
and the *project variables* `config var` sets (`config.md` §9), among them
the *secrets*, stored by name only. When `init` writes a starter, it also
sets the project variables that starter uses and the project doesn't have
(`init.md` INIT-107 to INIT-110).

**COM-150** Where the backend is linux, when a command needs its script and
`AA_BUILD` (for `build`) or `AA_DEPLOY` (for `deploy`) is its default,
loading shall check that the project root has the file: missing, the
problem `{ "field": "<script>", "kind": "missing", "error_type":
"not-generated", "message": "<script> not found in <project root>" }` with
the hint `Run 'analog-attach init --restore <command>' to write the starter
<script>, or set <variable> to another command ('analog-attach config var
<variable> <command>').`; a directory or other non-file there, `{ "kind":
"invalid", "error_type": "tool-missing", "message": "<path> is not a file"
}` with the hint `Move it away, then run 'analog-attach init --restore
<command>'.`; not executable by the user, `{ "kind": "invalid",
"error_type": "tool-missing", "message": "<path> is not executable" }` with
the hint `Run 'chmod +x <path>'.`. `<script>` is `aa_build.sh` or `aa_deploy.sh`,
`<command>` `build` or `deploy`, `<variable>` `AA_BUILD` or `AA_DEPLOY`.
Where the variable is another command, nothing is checked before it runs.
The CLI shall never write a script that is missing on its own: only `init`
and `init --restore` do.

**COM-151** The CLI shall run `AA_BUILD` or `AA_DEPLOY` as written with the
system shell (`sh -c`), with no arguments, in the project root, with the
environment of COM-152; the default runs the script itself (its `#!` line
chooses the interpreter). Each line it writes, to standard output or
standard error, goes to standard error as it comes, in both modes, after the
progress line of the command (as COM-514): standard output has only the
result. The CLI keeps the lines of its standard error for the refusal of a
failure (`build.md` BUILD-031, `deploy.md` DEPLOY-031). Ctrl-C stops it.

**COM-152** The environment of an executable variable's command shall be,
each later one replacing an earlier of the same name: the environment the
CLI runs in, without the variables whose names begin with `AA_` and, but for
`deploy`, without the secrets' names; then the system variables the step
gets (COM-156) that have a value; then the project's plain variables; then,
for `deploy`, the secrets with the values `deploy` got (`deploy.md`
DEPLOY-040, DEPLOY-041). The executable variables are in no command's
environment.

**COM-153** The system variables shall be these, in this order (`config`
lists them so); a path is absolute:

| Name | Value | Steps |
|---|---|---|
| `AA_PROJECT` | The project root, where `AA_BUILD` and `AA_DEPLOY` run | build, deploy, preprocess |
| `AA_OUTPUT` | The `output` setting: `overlay` or `devicetree` | build, deploy |
| `AA_BUILD_DIR` | The `build-dir` setting, resolved (`build.md` §2, *Build folder*) | build, deploy |
| `AA_DTSO` | The `workfile` setting | build, deploy |
| `AA_DTBO` | Where `output` is `overlay`: the output file (`build.md` §2) | build, deploy |
| `AA_DTS` | Where `output` is `devicetree`: the full devicetree, preprocessed, that `build` writes before it runs `AA_BUILD`, `.analog-attach/linux/build.preprocessed.dts` (`build.md` BUILD-014) | build |
| `AA_DTB` | Where `output` is `devicetree`: the output file | build, deploy |
| `AA_DTC` | The dtc on PATH, 1.6.0 or later (COM-118); none when there is none | build |
| `AA_LINUX` | The `linux` setting | build, deploy, preprocess |
| `AA_PREPROCESS_INPUT` | The file `AA_PREPROCESS_COMMAND` preprocesses (COM-090, COM-096), set for each run of it | preprocess |
| `AA_PREPROCESS_OUTPUT` | The file it writes, in `.analog-attach/linux/`, set for each run of it | preprocess |

A variable whose setting is unset, or that is for the other `output`, has
no value: the command doesn't get it, and `config` shows it `(not set)`, as
it shows `AA_PREPROCESS_INPUT` and `AA_PREPROCESS_OUTPUT`. The CLI doesn't
check that its path exists.

**COM-154** The project variables shall be stored in the local settings
file only, in the active section's `variables`: an object whose keys are the
names and whose values are each a string that isn't empty (a plain
variable, or an executable variable's command) or `{ "secret": true }` (a secret), in the order `config var`
wrote them:

```json
{ "backend": "linux", "linux": { "workfile": "overlay.dtso",
  "variables": { "BOARD_IP": "192.168.2.10", "BOARD_USER": "analog", "BOARD_PASSWORD": { "secret": true } } } }
```

A name shall be letters, digits and `_`, not starting with a digit, and not
starting with `AA_` in any case, the system variables' prefix, unless it is
an executable variable's (COM-158). An executable variable is there only
while it isn't its default, as a string (`"AA_BUILD": "make overlay"`).

**COM-155** If the local file's `variables` isn't an object, then reading
shall report `<file>: linux.variables: must be an object of variables`; if
an entry has a name COM-154 doesn't take or another value,
`<file>: linux.variables.<name>: <problem>` (`must be a non-empty string, or
{ "secret": true } for a secret` for the value), with the hint `Fix it in
<file>, or remove it: config var <name> --reset.`; if an executable
variable's value isn't a string with more than white space, `<file>:
linux.variables.<name>: must be a non-empty string: the command it runs`,
with the hint `Fix it in <file>, or go back to the default: config var
<name> --reset.`, and the default is used. If the global file's
active section has `variables`, then reading shall report `<file>:
linux.variables belongs to the project and can't be in the global
settings`, with the hint `Remove linux.variables from <file>, then set the
variables in the project (config var).`. Each is `kind: "invalid"`, as
COM-123; an invalid entry is left out, and the others are read. Where the
backend is noos, `variables` is an unknown key (COM-133).

**COM-156** `AA_BUILD` shall get the system variables of COM-153 marked
`build` and the project's plain variables; `AA_DEPLOY` those marked
`deploy`, the plain variables and the secrets; `AA_PREPROCESS_COMMAND` those
marked `preprocess` and the plain variables. No secret shall reach `AA_BUILD`
or `AA_PREPROCESS_COMMAND`, not even one the environment the CLI runs in has.

**COM-157** The CLI shall write no secret's value: not to a settings file
or any other, not in a response, not on standard output or standard error,
and it shall never put one on a command line. A secret's value comes from
the environment `deploy` runs in, or is typed, hidden, on a terminal
(`deploy.md` DEPLOY-040 to DEPLOY-043), and goes to `AA_DEPLOY` in its
environment only. A command that writes it out is the command's doing.

**COM-158** The executable variables shall be these three, each a shell
command the CLI runs (`sh -c`), with a default the CLI knows:

| Name | Default | Step | Description (as `config var` shows it) |
|---|---|---|---|
| `AA_BUILD` | `./aa_build.sh` | build | `The command build runs, in the project root: by default the project's aa_build.sh` |
| `AA_DEPLOY` | `./aa_deploy.sh` | deploy | `The command deploy runs, in the project root: by default the project's aa_deploy.sh` |
| `AA_PREPROCESS_COMMAND` | the `cpp` command of COM-091 | preprocess | `The C preprocessor command run on each devicetree read: it preprocesses $AA_PREPROCESS_INPUT into $AA_PREPROCESS_OUTPUT` |

A value may be several lines. It is stored in the local file's `variables`
(COM-154) once `config var` sets it, and removed by `config var <name>
--reset`, which brings the default back (`config.md` CONFIG-311). An
executable variable is never a secret. They are the only names with the
`AA_` prefix `config var` sets or resets. The executable variables are
the project's: the global file can't have them (COM-155).

## 9. Open issues

**C-1. Human-mode refusals and configuration errors exit 0.** In human mode
a refusal and a configuration error exit with status 0, and they are written
to standard output. A script can't tell `analog-attach add … && next`
failed, although input errors exit 2 on standard error in both modes
(COM-031). A fix would be: refusals and configuration errors exit 1 and write
to standard error.

**C-3. Only `config` reports the problems of the settings files.** `config`
shows the problems of COM-121 to COM-123 and COM-132 to COM-134 (`config.md`
CONFIG-005, CONFIG-102). Every
other command reads the files and goes on without a word: an unknown key is
ignored, an invalid value is left out (COM-123), so `devicetree = 5` is
reported as `Missing config field devicetree`, and a local file that isn't
JSON gives `No backend is set` (COM-014) instead of the parse error; so
does an old flat file whose `linux` isn't an object (COM-134), as `Missing
config field linux`. A fix would be to report the files' problems as
configuration errors (COM-071, COM-072) in every command that loads the
workspace.

**C-4. The preprocessor check is `<tool> --version`.** A tool that exists but
has no `--version`, or exits non-zero for it (`false`, some wrappers), is
reported as `not found on PATH` (COM-093).

**C-8. `read` loads the workspace before checking its arguments.** It calls
the loader first and applies GRM-020 to GRM-023 and GRM-030 after (COM-030).
`analog-attach --json read '&spi0'` in a workspace with nothing configured
gives the configuration refusal (COM-071, status 0) instead of the input error
`Use the bare form: spi0` (status 2), and `analog-attach read 'a b'`
preprocesses the base before saying `a path is one token (join segments with
/)`. A fix would be to check the arguments first, as `update` and `add` do.

**C-9. Some stale caches aren't reported, or are reported wrongly.**
COM-081 is silent when `validation.stamp.json` is missing although the cache
isn't current (the setup run rebuilds it, COM-116), and a stamp naming another
dt-schema says `The binding caches are older than the bindings`. Repro:
remove `.analog-attach/linux/validation-cache/validation.stamp.json` and run
`analog-attach list devices adi`: no warning. A fix would be to warn for a missing stamp too, and
to name the dt-schema when it differs.

**C-10. A preprocessor that writes nothing is an unhandled error.** With
`AA_PREPROCESS_COMMAND` set to `true`, the command exits 0 without writing
`$AA_PREPROCESS_OUTPUT`, and every command that needs the base fails with the
read error (`ENOENT: no such file or directory, open
'…/preprocessed.<process id>.dts'`, COM-130, status 1). A fix would be to report a
missing output as `devicetree: preprocessing <devicetree> failed`, a
configuration error.

**C-11. A configuration error is an input error under `config` and a refusal
under the other commands.** A command's configuration errors are a refusal on
standard output with status 0 (COM-071, COM-072), while `config` writes a
settings file it can't read to standard error with status 2: as a
`config-error` object when it shows the settings (`config.md` CONFIG-005), and
as text, even under `--json`, when it sets or resets one (CONFIG-102,
CONFIG-200). A value it can't take is a refusal, as elsewhere (COM-043).

**C-12. No-OS configuration problems come one at a time.** Where the backend
is noos, an unset `capi-path`, a missing workfile or an unknown chip is a
refusal (COM-511), as a Linux configuration error is (COM-071, COM-072), but
only the first problem is reported, and without `errors`, `hints` or the
field's hint. `analog-attach --json read` with only `backend` and `capi-path`
set gives `{"ok":false,"message":"No workfile at '…/workfile.json'.
…","severity":"error","error_type":"workfile-missing"}`. A fix would be to load the no-OS settings and
workfile through the workspace loader, as the Linux backend does.

**C-13. A generic fallback can map to an arbitrary binding.** A compatible
that many bindings only fall back to goes to the first of them by `$id`
(COM-110) when no binding is named after it (`simple-mfd`; `arm,primecell`,
whose binding is `arm/primecell.yaml`) or when its own binding names it only
in its `select` (`snps,dw-pcie`). A device that two bindings both name
(`nxp,se97b`: `eeprom/at24.yaml` and `hwmon/jedec,jc42.yaml`) gets the
first.
