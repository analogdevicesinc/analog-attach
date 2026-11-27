# gui

`analog-attach gui [--port <port>] [--server-only]` opens the GUI for the project in the current
directory: a page in the browser that runs `analog-attach` for the user. It shows the workfile,
adds devices, draws the graph, edits the settings, and generates, builds and deploys. The page and
its server are the `@analog-attach/gui` package (`packages/gui`). **Experimental:** it handles Linux and
noos projects.

## 1. What it does

**GUI-001** The CLI shall serve the GUI's page on 127.0.0.1 only, on `--port` (0: any free
port), and write `analog-attach GUI on <url>  (project: <dir>). Stop it with Ctrl-C.` to
standard error. Without `--port` it serves on 5177, or, when 5177 is taken (another GUI open),
on the first free one of the 20 ports after it, else on any free port: several GUIs can be open
at once.

**GUI-002** Unless `--server-only` is given, the CLI shall open `<url>` in the user's browser
(`xdg-open`, `open` or `explorer`); without an opener, the URL on standard error is the way in.

**GUI-003** Every action of the page shall be one run of the same CLI, in the project folder,
its arguments given as an array (no shell): `/api/run`'s in the server's own process (GUI-011),
`/api/stream`'s and the chat's in a child process (`node <cli.js> <args>`, or `<binary> <args>`
for the standalone binary, `02-common.md` COM-016). The server's API:

| Request | What it does |
|---|---|
| `GET /`, `GET /<file>` | the page, and its files (`core/`, `ecosystems/`); no other file |
| `GET /api/project` | the project folder, whether it has project settings, and its `backend` |
| `POST /api/run { args, env? }` | one CLI run, in the server's process (GUI-011): `{ code, stdout, stderr, json? }`, `json` when stdout is JSON; `env` as GUI-012 |
| `POST /api/stream { args, env? }` | one CLI run, in a child process: its output as it comes, then `\0exit <code>` (build, deploy); `env` as GUI-012 (the Linux part's Deploy gives it the project's secrets) |
| `GET /api/chat` | whether the chat's model can answer: `{ provider, name, available, version?, problem? }` (GUI-009) |
| `POST /api/chat { message, context?, skill? }` | one chat message: the chat's events as they come (a JSON object per line, GUI-009), then `{"type":"gui_done","code":<n>,"stderr":…}`; 409 while another is being answered |
| `POST /api/chat/stop`, `POST /api/chat/reset` | stop the message being answered; forget the project's conversation |
| `GET /api/chat/settings`, `POST /api/chat/settings { provider?, agent?, url?, model?, api_key? }` | the chat's model, as GUI-014 has it: `{ provider, agent, url, model, key_set, providers, agents, file }`, never the API key; a POST keeps what it gives, `""` taking the environment's again; 400 for a provider, an agent or a URL it can't take |
| `GET /api/dialog` | whether there is a native file dialog: `{ available, with? }` (GUI-013) |
| `POST /api/dialog { dir?, extensions?, title?, start? }` | the native file dialog, open until it is closed: `{ path, with }`, or `{ cancelled: true, with }` (GUI-013) |

**GUI-010** The server shall start each child run with the environment variable
`ANALOG_ATTACH_VALIDATE_WORKER` set to its own process id, and its own runs (GUI-011) shall
take that process id as the variable's, so that `validate` keeps one dt-validate running for as
long as the server does (`validate.md` VALIDATE-015).

**GUI-011** Each `/api/run` shall run the CLI in the server's own process: the project folder its
CWD, standard output and standard error kept for the answer, not a terminal (nothing asks). What
a command reads may be kept for the commands after, for as long as it is unchanged
(`02-common.md` COM-097, COM-141), so a run takes no Node start, no module load and no rereading
of what it read before. The runs of a noos project shall go one at a time, in the order they
came, since the no-OS library reads its settings through the process's state; the others may
overlap. Where the environment variable `ANALOG_ATTACH_GUI_SPAWN` is set to a non-empty value
when `gui` starts, each `/api/run` shall be a child process instead, as `/api/stream`'s (to
compare the two).

**GUI-012** Where a `/api/run` or `/api/stream` request has `env`, an object of names to string
values, the server shall add it to the environment of that run only, over the server's own: a
child run's environment, or the in-process run's environment (GUI-011). A name that isn't
`[A-Za-z_][A-Za-z0-9_]*`, a name that starts with `AA_` (any case: the system variables',
`config.md`), or a value that isn't a string shall be refused with status 400 and nothing run. The
server shall not write `env` anywhere: not to its output, a file or the settings, and not into
the run's arguments.

**GUI-013** Unless the user picks the page's own file picker (Preferences → Files; the native one
is the default), Browse… shall open the desktop's dialog, opened by the server, so on the machine it
runs on, with `DISPLAY` or `WAYLAND_DISPLAY` set (Linux). On Linux it is the desktop portal's file
chooser (`org.freedesktop.portal.FileChooser`'s `OpenFile` on the session bus, version 3 or later
for a folder), the server's bus connection held until its `Response`; where there is none, or it
fails, the first of `zenity`, `kdialog`, `yad` on PATH (`kdialog` first where
`XDG_CURRENT_DESKTOP` names KDE). On macOS it is `osascript`'s. `GET /api/dialog`'s `with` names
it: `portal`, or the program.
`POST /api/dialog` gives it the kind of path (`dir`: a folder; else files, `extensions` such as
`.dts` a filter, beside all files), the `title`, and the folder to start in (`start`, `~` and
relative to the project folder; the nearest folder of it that exists), as arguments, never through
a shell or a script's text, and answers once the dialog is closed: the path picked, or that it
was cancelled. A second dialog while one is open shall be refused with status 409, an extension
that isn't `.<name>` and a pick without a dialog with status 400; a page gone closes its dialog.
Where the native dialog can't open, Browse… shall open the page's own, saying why. A new file
is not picked in the native dialog: its name is typed in the field.

**GUI-004** The CLI shall run until it is stopped (Ctrl-C, SIGINT), then write `Stopped the GUI
at <url>` and exit with status 0.

**GUI-005** A `--port` that isn't a port number (an integer from 0 to 65535) shall be the input
error `--port takes a port number (0 to 65535), got <value>`. A `--port` that is taken shall
not move on: the CLI shall write `Port <port> on 127.0.0.1 is in use (another analog-attach
gui?): pick another with --port, or --port 0 for any free one` to standard error and exit with
status 1.

**GUI-008** The API shall answer only the GUI's own page: the server writes a token, random per
run, into the page it serves, and refuses with 403 `not the GUI's page` a call without that
token (`x-aa-token`), whose `Host` isn't the server's (`127.0.0.1:<port>` or
`localhost:<port>`), or whose `Origin`, when given, isn't. Any page the browser opens can send
requests to 127.0.0.1; without this one could change a command such as `AA_PREPROCESS_COMMAND`, then
run it.

**GUI-007** The page shall be a **core**, shared, and one **part per ecosystem**
(`ecosystems/<backend>/`, each its owner's; `ecosystems/README.md`). The core draws the
header, the console and the **Project setup**: the setup run's steps (`setup.md`), one per
screen, each saving a setting with `config <key> <value>` in the project's settings, so the CLI
checks it and a refusal shows in its step with the CLI's message. While a setting is saved, its
step says so (the part may say more: Linux's `linux` and `devicetree` build the binding caches,
which takes a while) and its buttons are off:

1. the ecosystem (`backend`), among the parts of the offered backends (`02-common.md` COM-017,
   the options `config --json` gives `backend`);
2. the settings that ecosystem's part asks for, in order (noos: `capi-path`, `module-paths`,
   `target`; Linux: `linux`, `devicetree`, `workfile`), each from `config <key> --json`. A
   setting with options is a choice among them (a filter when there are more than eight); a path
   offers what the CLI found for it (`config.md` CONFIG-017) and takes another; a list of paths
   is the found ones, checked, and other paths;
3. its optional settings, with their values and defaults (noos: `project-name`, `example`,
   `interview`, `bootstrap`; Linux: `overlay-syntax`). Open Project saves them and creates the
   workfile (`init`) when there is none. In a Linux project the step is **Overlay** and, while
   there is no workfile, it has the overlay view's two starts in Open Project's place: **Create
   Overlay** (`init`, the workfile set to `overlay.dtso` in the project folder when it is unset)
   and **Import Overlay** (`import <overlay>`, picked among `list overlay`'s); each saves the
   settings first, and a closed import panel leaves the step as it was. The step is required: it
   is done once the overlay is there;
4. done: the core mounts the ecosystem's part.

A folder with no project settings (no `.analog-attach/config.json`), a required setting unset or
no workfile gets the setup, on its first step not done; otherwise, the page opens on the part of
the project's backend. The Linux part, its overlay gone (deleted, or `workfile` changed), goes back
to the setup's last step: it has no start of its own. **Setup** in the header reopens
it. The header shows the project folder; the GUI keeps it for as long as it runs: another
project is another `analog-attach gui`, started in its folder.

**GUI-009** The page shall have a **chat with an assistant**: a ✦ Assistant
button in the console bar opens a panel where the user writes what to change. Where the backend
is linux, the panel is in the Devices view's right column, in the overlay's place: the column
shows the overlay and its validation, or the chat, swapped by its tabs, and the button brings the
Devices view and the chat. The model that answers is an executable, an agent of the user's
(Claude Code, Codex CLI or Gemini CLI), or a server, any model behind an OpenAI-compatible
endpoint (GUI-014). Any way:

- It may run `analog-attach` commands, and nothing else; the panel shows a refusal as one.
  `analog-attach gui` is refused too (a server it would wait on forever).
- The `analog-attach` it runs is the GUI's own CLI, in a child process in the project folder.
- The page gets the same events from each, a JSON object per line: `turn` (a new reply
  starts), `text` (its text, a piece at a time), `command` and `output` (a command it runs, and
  what it answered: `failed`, `refused`), `result` (`ok`, `error?`, `seconds?`, `cost_usd?`),
  then `gui_done`.
- The panel shows the model's text as it writes it, each command it runs with its output, and
  what it cost when the model says; each command shows in the console too, marked ✦. After each
  command the part reads the project again, so the change shows beside the chat.
- A model that can't answer (its executable not installed, no endpoint or model set up) has the
  panel say why, and a way to Preferences to choose another.
- Stop ends the answer; the panel's New chat forgets the conversation (the next message starts
  another), and is the only way to: Preferences has none. One conversation per project folder,
  kept for as long as the GUI runs.

With **Claude Code** (`claude`, or `$ANALOG_ATTACH_CLAUDE`), the server runs it headless in the
project folder for each message: `claude -p <message> --output-format stream-json --verbose
--include-partial-messages --permission-mode dontAsk --allowedTools "Bash(analog-attach:*)"
--disallowedTools "Bash(analog-attach gui:*)" --append-system-prompt <where it is>`, and
`--resume <session>` for the next messages of the project's conversation. Any other tool is
refused at once (`dontAsk`), never waiting for an approval nobody can give; the `analog-attach`
it runs is a script of that name, first on its PATH, for each of the executables. It uses the
user's Claude Code login.

With **Codex CLI** (`codex`, or `$ANALOG_ATTACH_CODEX`), the server runs `codex exec --json
--color never --skip-git-repo-check --sandbox workspace-write --cd <folder> -c
approval_policy="never" -c developer_instructions=<where it is> -c
sandbox_workspace_write.network_access=true [resume <thread>] -`, the
message on its standard input, `resume` continuing the project's conversation. Codex has no list
of the commands it may run: its sandbox limits it, writing only in the project folder and the
temporary folder, with the network on (`deploy` reaches the board), and with no approvals what
the sandbox refuses fails at once. The system prompt asks it for `analog-attach` commands alone;
Preferences says what the sandbox allows.

With **Gemini CLI** (`gemini`, or `$ANALOG_ATTACH_GEMINI`), the server runs `gemini
--prompt=<where it is, then the message> --output-format stream-json --approval-mode default
--policy <the GUI's policy>`, and `--resume <session>` for the next messages. The policy (a TOML
file of the GUI's, beside the script) allows its shell tool for `analog-attach …` and its skills,
and denies `analog-attach gui` and every other tool; headless, a tool it would ask about is
refused at once. Gemini CLI has no option to add to its system prompt, so where it is goes before
the message.

With an executable, without the part's skill (`analog-attach-noos`, `analog-attach-linux`) for
that agent the panel offers to install it (`skill install --agent <agent>`).

With an **OpenAI-compatible** endpoint, the server runs the conversation itself, through
`POST <url>/chat/completions` (streamed; a server that answers with one JSON is read whole),
with `Authorization: Bearer <key>` when a key is set. The model gets a system prompt (where it
is, how to behave there, and the part's skill, the text of its `SKILL.md`) and one tool,
`analog_attach`, whose `args` are the words of `analog-attach <args>`; the server runs each call
as a CLI run (no shell), answers it with the exit status, stdout and stderr, and asks the model
again, until it replies with text alone, or after 40 rounds. A command still running after 15
minutes is stopped.

**GUI-014** The chat's model (GUI-009) shall be the environment's when the GUI starts, each
setting overridden by what Preferences → Assistant sets: `provider` (`claude`, `codex`,
`gemini` or `openai`, `$ANALOG_ATTACH_CHAT_PROVIDER`; with neither, `openai` when an endpoint is
set, else `claude`), `agent` (the executable Preferences goes back to from the server: the
provider when it is one, else the kept `agent`, else `claude`),
`url` (the endpoint's base URL, http or https, `$ANALOG_ATTACH_LLM_URL`), `model`
(`$ANALOG_ATTACH_LLM_MODEL`) and `api_key` (`$ANALOG_ATTACH_LLM_API_KEY`). What Preferences sets
is kept in the user's `$XDG_CONFIG_HOME/analog-attach/gui-chat.json` (`~/.config/…`), readable by
the user alone (mode 600), never in the project; the API key never goes back to the page.
Preferences shows the choice in two levels: Executable (then which agent) or Server (then its
endpoint, model and API key), under a line that says whether the model can answer (its version,
or why it can't); it doesn't name the settings file or the environment's variables.

**GUI-006** `gui` shall be in the help and in completion for every backend, and with none set.

## 2. Open issues

**G-1.** *Done* (GUI-007): the project setup. Linux projects go through the same generic steps,
but the rest of the page is noos-only.
**G-2.** The page loads mermaid (the graph) from a CDN; offline, the graph doesn't render.
**G-3.** A window of its own (a desktop app) rather than a browser tab is to be decided.
**G-4.** An `/api/run` shares the server's process (GUI-011): a command that never returns holds a
noos project's runs behind it, a crash of the process ends the GUI, and what the runs keep grows
with the bindings they parse (at most 64). The chat's commands run in child processes, which
keep nothing for the page's.
**G-5.** With an OpenAI-compatible model (GUI-009), the conversation is sent whole with each
request, so a long one may outgrow a small model's context: nothing trims or summarises it yet,
and New chat is the way out. A model without tool calls (or one that calls them badly) can only
talk; the panel has no way to tell it apart before it answers.
**G-6.** Codex CLI (GUI-009) is held to `analog-attach` commands by its system prompt alone: its
sandbox keeps its writes in the project folder, but doesn't stop another command there, and its
network is on for `deploy`, so such a command can reach the network too. A command that writes
outside the project folder and the temporary folder fails (the standalone binary's first run of a build, which unpacks
it in `~/.cache`).
