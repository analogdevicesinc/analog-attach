# ui (hidden)

Serves a proof-of-concept browser page for the overlay of the workspace. The
page runs the same commands as the terminal, through a local HTTP API. `ui` is
left out of `--help` (it is still offered by completion, CO-4).

## 1. Synopsis

```
attach-linux ui [--port <number>] [--open]
```

Grammar: rule `ui` in `01-grammar.abnf`.

| Argument | Meaning | Default |
|---|---|---|
| `--port <number>` | The TCP port to listen on. `0` lets the system pick a free one. | `0` |
| `--open` | Open the page in a browser. | off |

## 2. Terms

| Term | Meaning |
|---|---|
| Server | The HTTP server `ui` starts. |
| Token | 48 random hexadecimal characters (24 bytes), new for each run. |
| Page URL | `http://127.0.0.1:<port>/#<token>`. |
| API | The paths under `/api/`. |
| Child run | `attach-linux <command> <args...> --json`, run by the server: the same Node.js and script as `ui`, in the CWD `ui` was started in, with its environment. |

## 3. Resources

`ui` itself loads nothing. Every child run loads what its command needs, so a
workspace that is unconfigured or broken shows up in the page, not at start.

## 4. Starting and stopping

**UI-001** The CLI shall read `--port` as JavaScript's `Number()` reads a
string. If the result isn't an integer from 0 to 65535, then the CLI shall
report the input error `Invalid port: <value>` on standard error and exit with
status 2, in human and JSON mode alike. So an empty value and `0x0` are port
0, `0x50` and ` 80 ` are port 80, and `1e3` is port 1000. (Open issue U-6.)

**UI-002** The CLI shall listen on `127.0.0.1` only, on the given port.

**UI-003** When listening, the CLI shall write `attach-linux UI: <page URL>`
and `Press Ctrl+C to stop.` to standard output, also in JSON mode, and keep
running until it is interrupted.

**UI-004** If the port can't be bound (it is in use, or it is below 1024 and
the user may not bind it), then the CLI shall write the listen error
(`listen EADDRINUSE: address already in use 127.0.0.1:<port>`) to standard
error and exit with status 1 (COM-130).

**UI-005** Where `--open` is given, the CLI shall start `$BROWSER <page URL>`
when `BROWSER` is set and non-empty, else `open` on macOS, `cmd /c start ""` on
Windows, and `xdg-open` elsewhere, detached and with its output discarded. If
the program can't be started, then the CLI shall carry on: the URL is already
printed.

## 5. HTTP

**UI-010** If a request's `Host` header isn't `127.0.0.1` or `localhost`,
optionally with `:<port>`, then the server shall respond 403 with
`{"error":"bad host"}`.

**UI-011** For `GET /`, the server shall respond 200 with the page
(`text/html; charset=utf-8`). The page needs no token.

**UI-012** For any request outside `/api/` other than `GET /`, the server
shall respond 404 with `{"error":"not found"}`.

**UI-013** If a request for a path under `/api/` has no `x-attach-token`
header, or one that isn't the token, then the server shall respond 403 with
`{"error":"bad token"}`, before it looks at the path or the method. So an
unknown API path without the token gets 403, not 404.

**UI-017** When a request with the token is for an API path or method not
listed below, the server shall respond 404 with `{"error":"not found"}`.

**UI-014** Every JSON response of the server shall have
`content-type: application/json` and `cache-control: no-store`.

**UI-015** The server shall run child runs one at a time, in the order the
requests arrive, so two commands never write the overlay at once. (The status
and overlay endpoints run `config-get` as a child run as well.)

**UI-016** If handling a request fails unexpectedly (a child run that can't
start), then the server shall respond 500 with `{"error":"<reason>"}` when it
hasn't started the response yet. `<reason>` is the error as JavaScript prints
it (`Error: …`).

### 5.1 `GET /api/status`

**UI-020** The server shall run `config-get` and respond 200 with an object
whose keys are those of `linux`, `devicetree`, `overlay` and `overlay-syntax`
that have a string value, each with that value. It shall never include the
`deploy-*` fields.

### 5.2 `GET /api/overlay`

**UI-021** The server shall respond 200 with `{"path": <overlay>, "text":
<contents>}`, the configured overlay and its file's text. When no overlay is
configured or its file doesn't exist, `text` is `""` (and `path` is absent
when none is configured).

### 5.3 `POST /api/cmd`

The body is `{"command": <name>, "args": [<string>...]}`.

**UI-030** If the body isn't valid JSON, or is `null` or a JSON number,
string or boolean, then the server shall respond 400 with `{"error":"expected
a JSON object"}`. A JSON array passes this check and gets UI-031's `command
not allowed: undefined`. (Open issue U-7.)

**UI-031** If `command` isn't one of `read`, `list`, `add`, `update`, `delete`,
`enable`, `disable`, `validate`, `init`, then the server shall respond 400 with
`{"error":"command not allowed: <command>"}`, `<command>` being `undefined`
when the body has none. Commands that run configured
programs or point the workspace elsewhere (`config-set`, `build`, `deploy`,
`import`) are left out because any page the browser opens can reach the
server.

**UI-032** If `args` isn't an array of strings, then the server shall respond
400 with `{"error":"args must be a list of strings"}`.

**UI-033** If an element of `args` starts with `-` and isn't an option the
command may take, then the server shall respond 400 with `{"error":"option not
allowed: <element>"}`. The options allowed: `--parent`, `--name` and `--label`
for `add`; `--force` for `delete`; `--overlay` for `init`; none for the
others. (So `--json`, `add --template`, `init --linux` and `--parent=…` are
refused. Open issue U-2.)

**UI-034** The server shall run `<command> <args...>` as a child run, adding
`--quiet` after the arguments of `add`, and respond 200 with `{"code": <exit
status>, "json": <standard output parsed as JSON, or null>, "stdout":
<text>, "stderr": <text>}`, whatever the exit status. (A child run in JSON
mode never asks a question, COM-011. `add` still gets `--quiet`. `update`
doesn't, since there `--quiet` changes what a read prints.)

**UI-035** The server shall kill a child run after 10 minutes. A child run
ended by a signal is reported with `code` 1.

**UI-036** If the body is over 64 KiB, then the server shall close the
connection without a response. (Open issue U-5.)

## 6. The page

**UI-040** The page shall read the token from the URL fragment and send it
with every API request.

**UI-041** On load, the page shall get `/api/status`. While no overlay is
configured, it shall say so (and which of `linux` and `devicetree` is missing,
pointing at `attach-linux init`) and offer *Create workfile* and *Add
device…*. Otherwise it shall read `/` with `read`, show the tree, the selected
node's detail, the overlay's text (`/api/overlay`) and the result of
`validate`.

**UI-042** *Create workfile* shall run `init --overlay overlay`, then `init
--overlay overlay-1`, `overlay-2`, … while the response says `already exists`,
up to `overlay-99`. When one succeeds, the page shall run its start-up again
(UI-041) without reloading itself.

**UI-043** When `read` of a node fails with configuration errors, the page
shall show them with their hints, a *Retry* button, and, when an error is about
the `overlay` field, *Create a new workfile* (UI-042).

**UI-044** The page shall build commands only from what the user picked or
typed: `read <path>` to expand a node, `list property` / `list value` / `read
<path> <prop>` for a property's editor, `update <path> <prop> <value
tokens>` to set it (the input split at whitespace), `enable` / `disable
<path>`, `add <compatible> [--parent …] [--name …] [--label …]` from the add
dialog (fed by `list device` and `list parent`), and `delete <path>`, which,
when the preview has `severity: "warn"` (a node with children), asks for
confirmation and runs `delete <path> --force`.

**UI-045** The page shall log each mutating command it runs as `$ attach-linux
<command> <args>`, or `✗ …` when it failed (exit status not 0, or `ok:
false`), with its message and standard error. `read`, `list` and `validate` are
logged only when they fail or write to standard error.

## 7. Open issues

**U-2. Values that start with `-` are refused.** UI-033 checks every argument,
not only options, so `update adc reg -1` from the page's editor gets `option
not allowed: -1`. The terminal accepts it after `--` (GRM-012), which the
server refuses too.

**U-3. `ui` ignores JSON mode.** It writes its two lines under `--json`
(COM-020).

**U-4. `add --template` isn't available from the page.** The add dialog and
the server allow only `--parent`, `--name` and `--label`.

**U-5. A body over 64 KiB gets no answer.** The body reader destroys the
request (UI-036), which closes the socket, so the 500 the code then tries to
send never arrives: `curl -d @70k.txt …/api/cmd` prints `Empty reply from
server`. A fix would be to stop reading, respond 413 with `{"error":"request
too large"}`, and close the connection after the response.

**U-6. `--port` takes more than port numbers.** `Number()` (UI-001) reads an
empty value as 0, and hexadecimal, exponents and blanks as numbers, so
`--port ''` serves on a random port and `--port 1e3` tries port 1000, which
fails for a normal user (UI-004). The grammar allows digits only. A
fix would be to accept only `^[0-9]+$` before converting.

**U-7. A JSON array body is taken for an object.** UI-030 checks `typeof body
=== "object"`, which an array passes, so `[1]` gets `command not allowed:
undefined` instead of `expected a JSON object`. A fix would be to refuse
arrays in UI-030 too (`Array.isArray`).

## 8. Examples

```
$ attach-linux ui --port 0
attach-linux UI: http://127.0.0.1:37069/#4a92ed9b652fcc92ab08b937b4874b980c850a87d63f4ddb
Press Ctrl+C to stop.
```

```
$ curl -s -H "x-attach-token: <token>" -d '{"command":"read","args":["ad7124_8","reg"]}' http://127.0.0.1:37069/api/cmd
{"code":0,"json":{"kind":"property","key":"reg",…,"value":2,"source":"overlay",…},"stdout":"{…}\n","stderr":""}

$ curl -s -H "x-attach-token: <token>" -d '{"command":"deploy","args":[]}' http://127.0.0.1:37069/api/cmd
{"error":"command not allowed: deploy"}
```
