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
`<ids>` being the known backends joined with `|` (`linux|noos`). If `backend`
names no known backend, then the input error shall be `Unknown backend: <id>.
Known backends: <list>. Run 'analog-attach config backend <ids>'.`, `<list>`
joined with `, `.

**COM-015** If a shared command is one the backend doesn't provide, then the
CLI shall leave it out of the help and report the input error `<command> is
not supported by the <id> backend`.

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

Exceptions:

| Command | Differs from | How | Issue |
|---|---|---|---|
| `read`, and `update` when it reads | COM-050 | its response is the node or property itself, with no `ok`, `message` or `severity` (`read.md` READ-011, READ-024, READ-035; `update.md` UPDATE-112) | C-7 |
| `validate` | COM-020, COM-050 | its response has no `ok`, `message` or `severity` | `validate.md` V-4 |
| `config` | COM-040, COM-072 | a problem with a settings file, or a value it can't store, is an input error on standard error with status 2, not a refusal (`config.md` CONFIG-102, CONFIG-118) | — |

## 3. Input errors

An input error is a malformed command line: what the argument parser rejects
(GRM-004, GRM-013), and the CLI's own checks: GRM-020 to GRM-023, GRM-030,
GRM-060, a required path or property left out (`Missing: path` from
`update`, `enable` and `disable`, `Missing: property name` from `update`;
`update.md` UPDATE-001, `enable-disable.md` ENABLE-001), a `completion`
shell the CLI doesn't know (`05-completion.md` COMPL-101), COM-014 and
COM-015.

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
`{"ok": false, "message": <why>, "severity": "error"}` and exit with status 0.

**COM-041** While in human mode, when a command refuses, the CLI shall write
the reason to standard output and exit with status 0. (Open issue C-1.)

**COM-042** When a command refuses, the CLI shall leave the workfile and the
settings files as they were. Scratch files under the state directory (§8)
may have been rewritten. Where the backend is linux, exceptions: `config
linux <path>` saves `linux` before it builds the caches and refuses when the
build doesn't happen or fails (`config.md` CONFIG-122, CONFIG-123, CF-6), and
the setup run keeps `linux`, `devicetree` and `workfile` saved when its cache
build fails (`setup.md` SETUP-030, SETUP-033, S-3).

## 5. Success

**COM-050** While in JSON mode, when a command succeeds, the CLI shall
respond with an object whose `ok` is `true`, and exit with status 0. Its
`severity` is `"info"`, or `"warn"` where the command's chapter says so: the
`delete` preview, a `rename`, `update`, `move` or `import` that warned, and
`list parent` for a compatible with no binding; where the backend is noos,
the `delete` preview and a `build` that left no ELF. (Exceptions in §2.)

## 6. Cancellation

**COM-060** When the user stops a question (Ctrl-C or end of input) before
the command has written anything, the CLI shall write a line saying so to
standard output and exit with status 130. (`add` and the setup run,
`setup.md`, say which of their questions this applies to.)

## 7. Exit status

| Status | When |
|---|---|
| 0 | The command answered: a success, or a refusal (COM-040, COM-041). Also `--help`, `--version` and `__complete`. Human mode: a configuration error of a command (COM-072). |
| 1 | An error the CLI doesn't handle (COM-130), in both modes. |
| 2 | Both modes: an input error (COM-031). JSON mode: a configuration error (COM-071). `config`: a settings file it can't read or a value it can't store, in both modes (`config.md`). |
| 130 | A question was stopped before anything was written (COM-060). |

**COM-130** If a command throws an error, then the CLI shall write the
error's message to standard error and exit with status 1, in human and in
JSON mode alike. Standard output has what the command wrote before the
error, if anything: in JSON mode no response. (`skill install` with a
read-only home, a `preprocess-command` that writes no output.)

A JSON client MUST read `ok` to tell success from refusal. The exit status
only separates "the CLI answered" (0) from "the request was malformed or the
workspace unusable" (2) and "the command failed without answering" (1).

## 8. Workspace loading

The project root is the nearest directory, from the CWD up, that has a
`.analog-attach/` directory (COM-120). It holds the local settings file
`.analog-attach/config.json`, and the backend's state directory
`.analog-attach/<backend>/` (`.analog-attach/linux/`), where the backend keeps
its caches and scratch files. In this specification, *the state directory*
is that directory.

Each command needs some of the resources of the workspace: the settings,
and the backend's own. Where the backend is linux, they are the bindings
(the Linux tree and the caches), the bundled tools, the base and the
workfile. Its chapter says which. Where the backend is noos, a command reads
its settings as it goes instead (§8.5).

**COM-070** When a command needs workspace resources, the CLI shall check all
of them before doing anything, and collect every problem found across
resources that don't depend on each other.

**COM-071** While in JSON mode, if workspace loading finds problems, then the
CLI shall write to standard error one line, a JSON object conforming to
`04-protocol/config-error.schema.json`, write nothing to standard output, and
exit with status 2.

The object's `errors` has one entry per problem, and `hints` has the distinct
hints of those problems in the order the problems were found, the setup hints
of several fields merged into one (§8.1).

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
another dt-schema or has no `generated_at` number. A `validation.stamp.json`
that is missing gives no warning. (Open issue C-9.)

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

A file of the earlier flat format, every key at the top level, is not
converted: its keys are unknown top-level keys (COM-132), and where the
backend is linux its `"linux": "<path>"` is a section that isn't an object
(COM-134).

The front end has one setting, `backend`:

| Key | Kind | Required¹ | Default | Description (as `config` shows it) |
|---|---|---|---|---|
| `backend` | one of the known backends (`linux`, `noos`) | yes | — | `The ecosystem this project targets: linux or noos` |

Where the backend is linux, its settings follow, in the order the CLI writes
them:

| Key | Kind | Required¹ | Default | Description (as `config` shows it) |
|---|---|---|---|---|
| `linux` | path (directory) | yes | — | `Path to Linux kernel source tree (setting it builds the binding caches)` |
| `devicetree` | path (file) | yes | — | `Path to target base DTS file` |
| `workfile` | path (file) | no | — | `Path to the working DTSO overlay file (workfile)` |
| `overlay-syntax` | one of `fragment`, `label` | no | `fragment` | `Output syntax for the overlay file: fragment (default) or label (&spi0 { … })` |
| `preprocess-command` | string | no | `cpp -nostdinc -undef -x assembler-with-cpp -P -I {linux}/include -o {output} {input}` | `C preprocessor command to resolve macros in the base devicetree; {input}/{output}/{linux} are substituted` |
| `deploy-ip` | string | no | — | `IP address or hostname of the remote device to deploy to` |
| `deploy-user` | string | no | — | `SSH username on the remote device` |
| `deploy-password` | string | no | — | `SSH password on the remote device (stored plaintext in the settings file)` |

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
joined with `, `. Unknown keys of the global file's active section are kept
and ignored.

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
comes from. (Open issue C-3: which commands report the problems of COM-121
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
`preprocess-command` with `{input}` the `devicetree` file and `{output}`
`.analog-attach/linux/preprocessed.dts`, and parse the output. The base is never
cached between runs, except that a command that exits 0 without writing
`{output}` leaves the previous run's `preprocessed.dts`, which is then
parsed (with no previous file, COM-130 applies). (Open issue C-10.)

**COM-091** The CLI shall replace every occurrence of `{input}`, `{output}`
and `{linux}` in the command with the value in double quotes, and run the
result with the system shell (`/bin/sh -c`). Other text, braces included, is
passed as written.

**COM-092** Where the command contains `{linux}`, the CLI shall check the
`linux` field (COM-126 to COM-128) as part of loading the base, and use the
Linux tree for it. Where it doesn't, the base doesn't need `linux`.

**COM-093** Before preprocessing, the CLI shall run `<tool> --version`, where
`<tool>` is the command's first word. If that fails to start or exits non-zero,
then loading shall report `preprocess-command: <tool> not found on PATH
(needed to preprocess <devicetree>)`. (Open issue C-4.)

**COM-094** If the command exits non-zero, then loading shall report
`devicetree: preprocessing <devicetree> failed:` followed by a newline and the
command's standard error.

**COM-095** If the output doesn't parse as a devicetree, then loading shall
report `devicetree: <devicetree> does not parse after preprocessing: <error>`.

**COM-096** The CLI shall preprocess the other devicetree sources it reads
with the same command and `{linux}` always set: `import`'s overlay into
`.analog-attach/linux/import.preprocessed.dts`, `add --template overlay:` into
`.analog-attach/linux/overlay-template.preprocessed.dts`, and binding examples
(`add --template example:`, the add fill-in) from `.analog-attach/linux/example.dts`
into `.analog-attach/linux/example.preprocessed.dts`. Those failures are refusals of
the command, not configuration errors.

### 8.3 The workfile

Where the backend is linux, the workfile is the overlay the `workfile`
setting names:

**COM-100** When a command needs the workfile, the CLI shall load the base
first, then read the `workfile` file as written (without preprocessing) and
parse it against the base. An unset field is reported per COM-126 and a
missing file per COM-127.

**COM-101** If the workfile doesn't parse, then loading shall report
`workfile: <file> does not parse: <error>`. A `#include` or any other
preprocessor directive in the workfile makes it unparseable (open issue C-5).

**COM-102** If the base fails to load, then loading shall report the base's
problems and those of COM-126 and COM-127 for `workfile`, but not try to parse
the workfile.

**COM-103** When a command writes the workfile, the CLI shall write the whole
file, printed from the parsed tree: `/dts-v1/;`, `/plugin/;` and the
fragments, indented with tabs. Comments and the original layout are not kept.

**COM-104** Where `overlay-syntax` is `fragment`, the CLI shall print each
fragment as `fragment@<n> { target = <&<label>>; __overlay__ { … }; };`
inside `/ { … };`, or with `target-path = "<path>";` for a target named by
path. Where it is `label`, the CLI shall print each as `&<label> { … };`, or
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

### 8.4 Binding caches and bundled resources

Where the backend is linux:

**COM-110** The CLI shall keep two binding caches under `.analog-attach/linux/`:
`compat-index.json`, an object `{ generated_at, linux, dt_schema, entries }`
whose `entries` map each compatible string to the binding YAML that lists
it; and `validation.json`, the output of `dt-mk-schema -j` over the Linux
tree's bindings, with `validation.stamp.json` `{ generated_at, linux,
dt_schema }` next to it. `generated_at` is in milliseconds since the epoch.
The CLI shall derive `entries` from `validation.json`: the strings of each
Linux tree binding's processed `compatible` property, the bundled
dt-schema's own schemas left out. When several bindings list a string, the
one named after it (`net/snps,dwmac.yaml` for `snps,dwmac`) wins; then one
that names the device (lists it first); then one that has its own `select`
and lists it first (a naming convention such as `arm/qcom-soc.yaml`); then
one that only falls back to it. Among equals, the first by `$id` wins (open
issue C-13).

**COM-111** The CLI shall build the caches only in `config linux <path>`,
`config --reload`, and the setup run (`setup.md`) when they aren't current
(COM-116). Every other command only reads them.

**COM-112** When it builds the caches, the CLI shall compile
`validation.json`, then derive the compat index from it (COM-110), and write
progress to standard error, in both modes: first `Indexing device bindings
and compiling binding schemas...`; then the line `Indexed <n> compatibles from
<m> bindings and compiled binding schemas in <duration>`, `<m>` being the
Linux tree's bindings in `validation.json`, or `Compiling binding schemas
failed`, which on a terminal replaces the first line. `<duration>` is `4.2s`
under 10 seconds, `48s` under a minute, then `1m 12s`.

**COM-113** The CLI shall replace `validation.json` only once `dt-mk-schema`
has succeeded with a non-empty JSON output, and write its stamp, then
`compat-index.json`, after it. A failed build writes neither cache, so the
previous pair stays.

**COM-114** Before a build, the CLI shall check the `linux` field (COM-126 to
COM-128), the bundled dt-schema and the bundled tools (COM-117), and report
their problems as configuration errors without building anything.

**COM-115** When a command needs the bindings and the Linux tree and the
bundled dt-schema are fine, if `compat-index.json` is missing, unreadable or
has no `entries`, or `validation.json` is missing, then loading shall report
for each `{ field: "compat-index" | "validation.json", kind: "missing",
message: "<file> not found or unreadable in <state directory>" }`
with the hint `Run 'analog-attach config --reload' to build the binding
caches.`

**COM-116** The CLI shall treat a cache as current when its stamp exists,
has a numeric `generated_at`, names the configured Linux tree and the bundled
dt-schema (when it names them), and is no older than every file and
directory under the Linux tree's `Documentation/devicetree/bindings/` and
under the bundled dt-schema (`.git` directories skipped). A cache that isn't
current only gets the warning of COM-081, and none when
`validation.stamp.json` is missing (open issue C-9).

**COM-117** The CLI shall find its bundled resources next to its own
installation, under `bundled/linux/`. If `dt-schema/dtschema/schemas` or
`…/meta-schemas` is missing there, then loading shall report `{ field:
"dt-schema", kind: "missing", message: "Bundled dt-schema not found at
<root>" }`. If any of `dtc`, `dt-mk-schema`, `dt-validate` is missing from
its `tools/`, then loading shall report `{ field: "tools", kind: "missing",
message: "Bundled tools not found: <paths>" }`. Both have the hint `The
analog-attach installation is incomplete; rebuild it
(scripts/bundle-dt-schema.sh).`

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

## 9. Open issues

**C-1. Human-mode refusals and configuration errors exit 0.** In human mode
a refusal and a configuration error exit with status 0, and they are written
to standard output. A script can't tell `analog-attach add … && next`
failed, although input errors exit 2 on standard error in both modes
(COM-031). A fix would be: refusals and configuration errors exit 1 and write
to standard error.

**C-2.** *Fixed.* (`--json` with `--help` or `--version` printed nothing.
`analog-attach --json add --help` and `--json --version` now print the help
and the version on standard output with status 0; `analog-attach --json`
alone writes the usage to standard error with status 2, GRM-008.)

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

**C-5. The workfile isn't preprocessed, and comments are lost.** The base
goes through `preprocess-command` but the workfile doesn't (COM-100), so a
workfile with `#include <dt-bindings/…>` or a macro doesn't load. Every write
reprints the file from the tree (COM-103), dropping comments a user added.

**C-7. Read responses aren't CommonResponses.** `read` (READ-011, READ-024,
READ-035 in `read.md`) and `update <path> <property>` when it reads
(`update.md` UPDATE-112) respond with the node or property itself:
`analog-attach --json read spi0 status` gives
`{"kind":"property","key":"status",…}`, with no `ok`, `message` or
`severity`, so a client must tell them from a refusal by shape (COM-050). A
fix would be to wrap them: `{"ok": true, "message": …, "severity": "info",
"node": …}` or `"property": …`.

**C-8. `read` loads the workspace before checking its arguments.** It calls
the loader first and applies GRM-020 to GRM-023 and GRM-030 after (COM-030).
`analog-attach --json read '&spi0'` in a workspace with nothing configured
writes the configuration errors (exit 2) instead of `Use the bare form:
spi0`, and `analog-attach read 'a b'` preprocesses the base before saying `a
path is one token (join segments with /)`. A fix would be to check the
arguments first, as `update` and `add` do.

**C-9. Some stale caches aren't reported, or are reported wrongly.**
COM-081 is silent when `validation.stamp.json` is missing although the cache
isn't current (the setup run rebuilds it, COM-116), and a stamp naming another
dt-schema says `The binding caches are older than the bindings`. Repro:
remove `.analog-attach/linux/validation.stamp.json` and run `analog-attach list
devices adi`: no warning. A fix would be to warn for a missing stamp too, and
to name the dt-schema when it differs.

**C-10. A preprocessor that writes nothing reuses the previous base.**
The base is parsed from `.analog-attach/linux/preprocessed.dts` without
removing it first (COM-090). With `preprocess-command = "true {input}
{output}"`, a workspace that has a `preprocessed.dts` from an earlier run
parses that old file as the base; one without it fails with the read error
(COM-130). A fix would be to delete the output before running the command and
to report a missing output as `devicetree: preprocessing <devicetree> failed`.

**C-11. A configuration error is an input error under one command and a
refusal under another.** In human mode, a command's configuration errors are
written to standard output with status 0 (COM-072), while `config` writes its
own (a settings file it can't read, a value it can't store) to standard error
with status 2. In JSON mode the first are a `config-error` object on standard
error and the second are text there, also with status 2
(`config.md` CONFIG-118).

**C-12. No-OS configuration problems are refusals.** Where the backend is
noos, an unset `capi-path`, a missing workfile or an unknown chip is a
refusal with status 0 (COM-511), not a configuration error (COM-071,
COM-072): under `--json` it is `{"ok": false, …}` on standard output rather
than a `config-error` object on standard error with status 2, one problem at
a time and without the field's hint. `analog-attach --json read` with only
`backend` and `capi-path` set gives `{"ok":false,"message":"No workfile at
'…/workfile.json'. …","severity":"error"}`, status 0. A fix would be to load
the no-OS settings and workfile through the workspace loader, as the Linux
backend does.

**C-13. A generic fallback can map to an arbitrary binding.** A compatible
that many bindings only fall back to goes to the first of them by `$id`
(COM-110) when no binding is named after it (`simple-mfd`; `arm,primecell`,
whose binding is `arm/primecell.yaml`) or when its own binding names it only
in its `select` (`snps,dw-pcie`). A device that two bindings both name
(`nxp,se97b`: `eeprom/at24.yaml` and `hwmon/jedec,jc42.yaml`) gets the
first.
