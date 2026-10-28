# Common behaviour

## 1. Modes

**COM-010** Where argv contains `--json` (GRM-001), the CLI shall run in JSON
mode; otherwise it shall run in human mode.

**COM-011** While in JSON mode, the CLI shall not ask a question.

**COM-012** The CLI shall treat a run as a terminal run when, and only when,
both its standard input and its standard output are terminals. Commands that
ask questions ask them only in a terminal run in human mode, and their
chapter says which.

## 2. Streams

**COM-020** While in JSON mode, the CLI shall write at most one line to
standard output: one JSON object, the command's response, as its chapter and
`04-protocol/` define it.

**COM-021** While in JSON mode, the CLI shall write notes and warnings about
the command's result to standard error, as free text, one or more lines each.
These lines aren't part of the protocol: a client may show them and must not
parse them.

**COM-022** While in human mode, the CLI shall write results, notes, warnings
and refusals to standard output, and commander's errors (GRM-004), the cache
warning (COM-081) and the cache build's progress (COM-112) to standard error.

Exceptions. Each has an open issue, of its chapter or of this one:

| Command | Differs from | How | Issue |
|---|---|---|---|
| `update` | COM-022 | writes its notes and warnings (address warnings included) to standard error in human mode | `update.md` U-1, `validate.md` V-7 |
| `add` | COM-022 | on a terminal, the values it fills in (pinned, from the example) and the interview's answers are written by `update`'s code, whose warnings go to standard error | `update.md` U-1 |
| `read`, and `update` when it reads | COM-050 | its response is the node or property itself, with no `ok`, `message` or `severity` (`read.md` READ-011, READ-024, READ-035; `update.md` UPDATE-112) | C-7 |
| `validate` | COM-020, COM-050 | its response has no `ok`, `message` or `severity` | `validate.md` V-4 |
| `ui` | COM-020 | writes two text lines under `--json` | `ui.md` U-3 |
| `ui` | COM-022, COM-033 | writes `Invalid port: <value>` to standard error with status 2 in human mode too (`ui.md` UI-001) | C-1 |
| `install-skill`, `uninstall-skill` | COM-020 | ignore `--json` and write text | `install-skill.md` S-2 |
| `completion` | COM-020 | writes the shell script under `--json` | `05-completion.md` CO-6 |
| `completion` | COM-022 | writes `Unknown shell: <shell>. Supported: bash, fish, zsh` to standard error, with status 0 | `05-completion.md` CO-6 |

## 3. Input errors

An input error is a malformed command line: what commander rejects
(GRM-004, GRM-013), and the CLI's own checks: GRM-020 to GRM-023, GRM-030,
GRM-060, a required path or property left out (`Missing: path` from
`update`, `enable` and `disable`, `Missing: property name` from `update`;
`update.md` UPDATE-001, `enable-disable.md` ENABLE-001), a `list` kind's
missing argument (`list.md` LIST-005), and `ui --port` (`ui.md` UI-001). A
`list` kind or a `completion` shell the command doesn't know isn't an input
error: `list` refuses it, `completion` writes a line to standard error
(`01-grammar.md` §2).

**COM-030** When the command line has an input error, the CLI shall do
nothing else: it shall not load the workspace or write a file. Exception:
`read` loads the workspace (COM-070) before it checks its path and property,
so a workspace problem is reported instead of the input error, and the base
is preprocessed (COM-090). (Open issue C-8.)

**COM-031** While in JSON mode, when the command line has an input error, the
CLI shall write the message to standard error, write nothing to standard
output, and exit with status 2.

**COM-032** While in human mode, when commander reports an input error
(GRM-004, GRM-013), the CLI shall write it to standard error and exit with
status 1.

**COM-033** While in human mode, when one of the CLI's own checks reports an
input error (§3), the CLI shall write the message to standard output and exit
with status 0. Exceptions: `ui --port` (`ui.md` UI-001) and `init` (`init.md`
INIT-011, INIT-013) write theirs to standard error with status 2. (Open
issue C-1.)

## 4. Refusals

A refusal: the command line is well-formed but the command can't do what it
asks, for example a compatible with no binding, or a parent that doesn't
exist.

**COM-040** While in JSON mode, when a command refuses, the CLI shall respond
`{"ok": false, "message": <why>, "severity": "error"}` and exit with status 0.

**COM-041** While in human mode, when a command refuses, the CLI shall write
the reason to standard output and exit with status 0. (Open issue C-1.)

**COM-042** When a command refuses, the CLI shall leave the overlay file and
`config.toml` as they were. Scratch files under `.attach-linux/`
(`preprocessed.dts`, `example.dts`, …) may have been rewritten. Exceptions:
`config-set linux` saves `linux` before it builds the caches and refuses when
the build doesn't happen or fails (`config-set.md` CONFIGSET-022,
CONFIGSET-023, CS-3), and `init` keeps `linux` and `devicetree` saved when
its cache build fails (`init.md` INIT-030, INIT-033, I-5).

## 5. Success

**COM-050** While in JSON mode, when a command succeeds, the CLI shall
respond with an object whose `ok` is `true`, and exit with status 0. Its
`severity` is `"info"`, or `"warn"` where the command's chapter says so: the
`delete` preview, a `rename`, `update` or `import` that warned, and `list
parent` for a compatible with no binding. (Exceptions in §2.)

## 6. Cancellation

**COM-060** When the user stops a question (Ctrl-C or end of input) before
the command has written anything, the CLI shall write a line saying so to
standard output and exit with status 130. (`add` and `init` say which of their
questions this applies to.)

## 7. Exit status

| Status | When |
|---|---|
| 0 | Success. Also a refusal (COM-040, COM-041), and in human mode the CLI's own input errors (COM-033). |
| 1 | Human mode: commander rejected the command line (COM-032). Both modes: an error the CLI doesn't handle (COM-130). |
| 2 | JSON mode: input error (COM-031) or configuration error (COM-071). |
| 130 | A question was stopped before anything was written (COM-060). |

Exceptions: `init` reports a missing Linux tree or devicetree, and a
`config.toml` that isn't TOML, on standard error with status 2 in human mode
too (INIT-011, INIT-013), and so does `ui` for a bad `--port` (`ui.md`
UI-001).

**COM-130** If a command throws an error that isn't commander's, then the
CLI shall write the error's message to standard error and exit with status 1,
in human and in JSON mode alike. Standard output has what the command wrote
before the error, if anything: in JSON mode no response. (`install-skill`
with a read-only home, `ui --port` on a port in use, a `preprocess-command`
that writes no output.)

A JSON client MUST read `ok` to tell success from refusal. The exit status
only separates "the CLI answered" (0) from "the request was malformed or the
workspace unusable" (2) and "the command failed without answering" (1).

## 8. Workspace loading

Each command needs some of the resources of the workspace: the settings
in `.attach-linux/config.toml` under the CWD, the bindings (the Linux tree
and the caches), the bundled tools, the base, the overlay. Its chapter says
which.

**COM-070** When a command needs workspace resources, the CLI shall check all
of them before doing anything, and collect every problem found across
resources that don't depend on each other.

**COM-071** While in JSON mode, if workspace loading finds problems, then the
CLI shall write to standard error one line, a JSON object conforming to
`04-protocol/config-error.schema.json`, write nothing to standard output, and
exit with status 2.

The object's `errors` has one entry per problem, and `hints` has the distinct
hints of those problems in the order the problems were found.

**COM-072** While in human mode, if workspace loading finds exactly one
problem, then the CLI shall write `<message>` (or `<message> — <description>`
when the problem has a description) to standard output. If it finds several,
then the CLI shall write `Configuration errors:` followed by one such line
for each, indented by two spaces. In both cases, when there are hints, the CLI
shall then write an empty line and one line per hint. The exit status is 0.
(Open issue C-1.)

Example, `add` with neither `linux` nor `devicetree` set:

```
Configuration errors:
  Missing config field linux — Path to Linux kernel source tree (setting it builds the binding caches)
  Missing config field devicetree — Path to target base DTS file

Run 'attach-linux init' on a terminal, or 'attach-linux init --linux <path> --devicetree <path>', to set up a workspace.
```

**COM-080** When a command needs the bindings and their caches exist, the CLI
shall use them even when they are out of date.

**COM-081** When a command needs the bindings and a cache isn't current
(COM-116), the CLI shall write one line to standard error, `warning:
<reason>; run 'attach-linux config-get --reload' to rebuild them.`, and go on.
`<reason>` is `The binding caches were built for <old>, not <new>` when a
stamp names another Linux tree, else `The binding caches are older than the
bindings`, also when the cause is a stamp that names another dt-schema or
has no `generated_at` number. A `validation.stamp.json` that is missing
gives no warning. (Open issue C-9.)

### 8.1 Config fields

The settings live in `.attach-linux/config.toml` under the CWD, a TOML table
of string values. The fields, in the order the CLI writes them:

| Key | Kind | Required¹ | Default | Description (as `config-get` shows it) |
|---|---|---|---|---|
| `linux` | path (directory) | yes | — | `Path to Linux kernel source tree (setting it builds the binding caches)` |
| `devicetree` | path (file) | yes | — | `Path to target base DTS file` |
| `overlay` | path (file) | no | — | `Path to the working DTSO overlay file (workfile)` |
| `overlay-syntax` | one of `fragment`, `label` | no | `fragment` | `Output syntax for the overlay file: fragment (default) or label (&spi0 { … })` |
| `preprocess-command` | string | no | `cpp -nostdinc -undef -x assembler-with-cpp -P -I {linux}/include -o {output} {input}` | `C preprocessor command to resolve macros in the base devicetree; {input}/{output}/{linux} are substituted` |
| `deploy-ip` | string | no | — | `IP address or hostname of the remote device to deploy to` |
| `deploy-user` | string | no | — | `SSH username on the remote device` |
| `deploy-password` | string | no | — | `SSH password on the remote device (stored plaintext in config.toml)` |

¹ What `config-get` reports as `required`. Whether a command needs a field is
decided by the resources it needs (COM-070), not by this column.

Each field has a hint, printed when it is missing or invalid (COM-072): for
`linux` and `devicetree`, `Run 'attach-linux init' on a terminal, or
'attach-linux init --linux <path> --devicetree <path>', to set up a
workspace.`; for `overlay`, `Run 'attach-linux init' to create one, or
'config-set overlay <path>'.`; none for the others.

**COM-120** The CLI shall read its settings only from
`.attach-linux/config.toml` under the CWD. It shall not read the environment.
When the file doesn't exist, every field is unset and has its default.

**COM-121** If `config.toml` isn't valid TOML, then loading shall report the
one error `{ field: "config.toml", kind: "invalid", message:
".attach-linux/config.toml: <parser message>" }`, with no description and no
hint. `<parser message>` is several lines, with the offending line quoted.

**COM-122** If `config.toml` has a key that isn't a field, then loading shall
report `{ field: <key>, kind: "unknown", message: ".attach-linux/config.toml:
unknown key <key>" }` with the hint `Remove unknown keys from
.attach-linux/config.toml; valid keys are linux, devicetree, overlay,
overlay-syntax, preprocess-command, deploy-ip, deploy-user, deploy-password.`

**COM-123** If a field's value isn't a string, then loading shall report
`<key>: must be a string`. If it is the empty string, then loading shall
report `<key>: must not be empty`. If `overlay-syntax` isn't one of its
options, then loading shall report `overlay-syntax: "<value>" is not one of
fragment | label`. Each is `kind: "invalid"` and carries the field's
description and hint.

**COM-124** Loading shall report every problem of COM-122 and COM-123 found
in the file, and only them (no resource is checked) when there is any.

**COM-125** The CLI shall resolve a relative path field against the CWD, not
against `.attach-linux/`. Loading doesn't check that the path exists; the
resource that needs it does (COM-127).

**COM-126** If a command needs a resource whose field is unset, then loading
shall report `{ kind: "missing", message: "Missing config field <key>" }` with
the field's description and hint.

**COM-127** If a path field names nothing, then loading shall report
`<key>: <path> does not exist`. If it names a directory where a file is
needed (`devicetree`, `overlay`) or the reverse (`linux`), then loading shall
report `<key>: <path> is not a file` or `<key>: <path> is not a directory`.

**COM-128** If the `linux` directory has no `Documentation/devicetree/bindings/`,
or no `include/`, then loading shall report `linux: no <dir>/ under <path>
(not a Linux source tree)`, `<dir>` being the first of the two it lacks.

**COM-129** When the CLI writes a setting, it shall rewrite `config.toml`
with the known fields first, in the order of the table, then every other key
the file had, unchanged. It shall create `.attach-linux/` when it doesn't
exist. Paths are written absolute.

### 8.2 The base devicetree

**COM-090** When a command needs the base, the CLI shall, on every run, run
`preprocess-command` with `{input}` the `devicetree` file and `{output}`
`.attach-linux/preprocessed.dts`, and parse the output. The base is never
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
`.attach-linux/import.preprocessed.dts`, `add --template overlay:` into
`.attach-linux/overlay-template.preprocessed.dts`, and binding examples
(`add --template example:`, the add fill-in) from `.attach-linux/example.dts`
into `.attach-linux/example.preprocessed.dts`. Those failures are refusals of
the command, not configuration errors.

### 8.3 The overlay

**COM-100** When a command needs the overlay, the CLI shall load the base
first, then read the `overlay` file as written (without preprocessing) and
parse it against the base. An unset field is reported per COM-126 and a
missing file per COM-127.

**COM-101** If the overlay doesn't parse, then loading shall report
`overlay: <file> does not parse: <error>`. A `#include` or any other
preprocessor directive in the overlay makes it unparseable (open issue C-5).

**COM-102** If the base fails to load, then loading shall report the base's
problems and those of COM-126 and COM-127 for `overlay`, but not try to parse
the overlay.

**COM-103** When a command writes the overlay, the CLI shall write the whole
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

**COM-110** The CLI shall keep two binding caches under `.attach-linux/`:
`compat-index.json`, an object `{ generated_at, linux, dt_schema, entries }`
whose `entries` map each compatible string to the binding YAML that lists
it; and `validation.json`, the output of `dt-mk-schema -j` over the Linux
tree's bindings, with `validation.stamp.json` `{ generated_at, linux,
dt_schema }` next to it. `generated_at` is in milliseconds since the epoch.

**COM-111** The CLI shall build the caches only in `config-set linux`,
`config-get --reload`, and `init` when they aren't current (COM-116). Every
other command only reads them.

**COM-112** When it builds the caches, the CLI shall build both at once and
write progress to standard error, in both modes: first `Indexing device
bindings and compiling binding schemas...`; while standard error is a
terminal, ` <done>/<total>` after it, rewritten in place as bindings are
indexed; then the line `Indexed <n> compatibles from <m> bindings and compiled
binding schemas in <duration>`, or `Compiling binding schemas failed`, which
on a terminal replaces the first line. `<duration>` is `4.2s` under 10
seconds, `48s` under a minute, then `1m 12s`.

**COM-113** The CLI shall write `compat-index.json` even when compiling the
schemas fails. It shall replace `validation.json` only once `dt-mk-schema`
has succeeded with a non-empty output, so a failed build leaves the previous
file, and write the stamp after it.

**COM-114** Before a build, the CLI shall check the `linux` field (COM-126 to
COM-128), the bundled dt-schema and the bundled tools (COM-117), and report
their problems as configuration errors without building anything.

**COM-115** When a command needs the bindings and the Linux tree and the
bundled dt-schema are fine, if `compat-index.json` is missing, unreadable or
has no `entries`, or `validation.json` is missing, then loading shall report
for each `{ field: "compat-index" | "validation.json", kind: "missing",
message: "<file> not found or unreadable in <.attach-linux directory>" }`
with the hint `Run 'attach-linux config-get --reload' to build the binding
caches.`

**COM-116** The CLI shall treat a cache as current when its stamp exists,
has a numeric `generated_at`, names the configured Linux tree and the bundled
dt-schema (when it names them), and is no older than every file and
directory under the Linux tree's `Documentation/devicetree/bindings/` and
under the bundled dt-schema (`.git` directories skipped). A cache that isn't
current only gets the warning of COM-081, and none when
`validation.stamp.json` is missing (open issue C-9).

**COM-117** The CLI shall find its bundled resources next to its own
installation. If `bundled/dt-schema/dtschema/schemas` or `…/meta-schemas` is
missing, then loading shall report `{ field: "dt-schema", kind: "missing",
message: "Bundled dt-schema not found at <root>" }`. If any of `dtc`,
`dt-mk-schema`, `dt-validate` is missing from `bundled/tools/`, then loading
shall report `{ field: "tools", kind: "missing", message: "Bundled tools not
found: <paths>" }`. Both have the hint `The attach-linux installation is
incomplete; rebuild it (scripts/bundle-dt-schema.sh).`

## 9. Open issues

**C-1. Human-mode failures exit 0.** In human mode a refusal, a
configuration error and the CLI's own input errors exit with status 0, and
they are written to standard output. A script can't tell `attach-linux add …
&& next` failed. Commander's own input errors exit with status 1. `init` and
`ui --port` differ again: their input errors go to standard error with
status 2 (COM-033). A fix would be: refusals and configuration errors exit 1,
input errors exit 2, and all of them write to standard error.

**C-2. `--json` with `--help` or `--version` prints nothing.** `attach-linux
--json add --help` and `attach-linux --json --version` write nothing and exit
with status 2, because JSON mode discards commander's standard output.
`attach-linux --json` with no command writes the usage to standard error and
exits with status 2.

**C-3. One bad key blocks the whole workspace.** Loading is strict
(COM-122 to COM-124), so an unknown key left by an older version, or a typo,
stops every command, `config-get` included, until it is removed by hand.
`config-set` still writes (it only refuses a TOML syntax error), but it keeps
the unknown key (COM-129). `init` can't fix it either (INIT open issue I-1).

**C-4. The preprocessor check is `<tool> --version`.** A tool that exists but
has no `--version`, or exits non-zero for it (`false`, some wrappers), is
reported as `not found on PATH` (COM-093).

**C-5. The overlay isn't preprocessed, and comments are lost.** The base
goes through `preprocess-command` but the overlay doesn't (COM-100), so a
workfile with `#include <dt-bindings/…>` or a macro doesn't load. Every write
reprints the file from the tree (COM-103), dropping comments a user added.

**C-7. Read responses aren't CommonResponses.** `read` (READ-011, READ-024,
READ-035 in `read.md`) and `update <path> <property>` when it reads
(`update.md` UPDATE-112) respond with the node or property itself:
`attach-linux --json read spi0 status` gives
`{"kind":"property","key":"status",…}`, with no `ok`, `message` or
`severity`, so a client must tell them from a refusal by shape (COM-050). A
fix would be to wrap them: `{"ok": true, "message": …, "severity": "info",
"node": …}` or `"property": …`.

**C-8. `read` loads the workspace before checking its arguments.** It calls
the loader first and applies GRM-020 to GRM-023 and GRM-030 after (COM-030).
`attach-linux --json read '&spi0'` in a workspace with no config writes the
configuration errors (exit 2) instead of `Use the bare form: spi0`, and
`attach-linux read 'a b'` preprocesses the base before saying `a path is one
token (join segments with /)`. A fix would be to check the arguments first,
as `update` and `add` do.

**C-9. Some stale caches aren't reported, or are reported wrongly.**
COM-081 is silent when `validation.stamp.json` is missing although the cache
isn't current (`init` rebuilds it, COM-116), and a stamp naming another
dt-schema says `The binding caches are older than the bindings`. Repro:
remove `.attach-linux/validation.stamp.json` and run `attach-linux list
devices adi`: no warning. A fix would be to warn for a missing stamp too, and
to name the dt-schema when it differs.

**C-10. A preprocessor that writes nothing reuses the previous base.**
`parse_base` reads `.attach-linux/preprocessed.dts` without removing it
first (COM-090). With `preprocess-command = "true {input} {output}"`, a
workspace that has a `preprocessed.dts` from an earlier run parses that old
file as the base; one without it fails with the read error (COM-130). A fix
would be to delete the output before running the command and to report a
missing output as `devicetree: preprocessing <devicetree> failed`.
