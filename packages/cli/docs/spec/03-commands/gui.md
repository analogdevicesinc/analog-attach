# gui

`analog-attach gui [--port <port>] [--server-only]` opens the GUI for the project in the current
directory: a page in the browser that runs `analog-attach` for the user. It shows the workfile,
adds devices, draws the graph, edits the settings, and generates, builds and deploys. The page and
its server are the `@analog-attach/gui` package (`packages/gui`). **Experimental:** it handles noos
projects for now, and is on the `noos-gui` branch only.

## 1. What it does

**GUI-001** The CLI shall serve the GUI's page on 127.0.0.1 only, on `--port` (default 5177; 0:
any free port), and write `analog-attach GUI on <url>  (project: <dir>). Stop it with Ctrl-C.`
to standard error.

**GUI-002** Unless `--server-only` is given, the CLI shall open `<url>` in the user's browser
(`xdg-open`, `open` or `explorer`); without an opener, the URL on standard error is the way in.

**GUI-003** Every action of the page shall be one run of the same CLI (`node <cli.js> <args>`),
in the project folder, its arguments given as an array (no shell). The server's API:

| Request | What it does |
|---|---|
| `GET /`, `GET /<file>` | the page, and its files (`core/`, `ecosystems/`); no other file |
| `GET /api/project`, `POST /api/project { dir, create? }` | the project folder (`POST` changes it; with `create: true` it makes the folder first, for a new project), whether it has project settings, and its `backend` |
| `POST /api/run { args }` | one CLI run: `{ code, stdout, stderr, json? }`, `json` when stdout is JSON |
| `POST /api/stream { args }` | one CLI run, its output as it comes, then `\0exit <code>` (build, deploy) |

**GUI-004** The CLI shall run until it is stopped (Ctrl-C, SIGINT), then write `Stopped the GUI
at <url>` and exit with status 0.

**GUI-005** A `--port` that isn't a port number (an integer from 0 to 65535) shall be the input
error `--port takes a port number (0 to 65535), got <value>`.

**GUI-008** The API shall answer only the GUI's own page: the server writes a token, random per
run, into the page it serves, and refuses with 403 `not the GUI's page` a call without that
token (`x-aa-token`), whose `Host` isn't the server's (`127.0.0.1:<port>` or
`localhost:<port>`), or whose `Origin`, when given, isn't. Any page the browser opens can send
requests to 127.0.0.1; without this one could change a setting such as `build-command`, then
run it.

**GUI-007** The page shall be a **core**, shared, and one **part per ecosystem**
(`ecosystems/<backend>/`, each its owner's; `ecosystems/README.md`). The core draws the
header, the console and the **Project setup**: the setup run's steps (`setup.md`), one per
screen, each saving a setting with `config <key> <value>` in the project's settings, so the CLI
checks it and a refusal shows in its step with the CLI's message:

1. the ecosystem (`backend`), among the parts;
2. the settings that ecosystem's part asks for, in order (noos: `capi-path`, `module-paths`,
   `target`; Linux: `linux`, `devicetree`, `workfile`), each from `config <key> --json`. A
   setting with options is a choice among them (a filter when there are more than eight); a path
   offers what the CLI found for it (`config.md` CONFIG-017) and takes another; a list of paths
   is the found ones, checked, and other paths;
3. its optional settings, with their values and defaults (noos: `project-name`, `example`,
   `interview`, `bootstrap`; Linux: `overlay-syntax`);
4. done: the core mounts the ecosystem's part.

A folder with no project settings (no `.analog-attach/config.json`) gets the setup, once;
otherwise, the page opens on the part of the project's backend. **New project** asks for a
folder, made when it doesn't exist, and opens it on the setup; **Setup** in the header reopens
it. The noos part creates the workfile (`init`) when there is none; the Linux part is a
placeholder for now.

**GUI-006** Where the backend isn't noos, `gui` shall be left out of the help and of completion
(GEN-03); typed, it still runs, and the page says it handles noos projects for now.

## 2. Open issues

**G-1.** *Done* (GUI-007): the project setup. Linux projects go through the same generic steps,
but the rest of the page is noos-only.
**G-2.** The page loads mermaid (the graph) from a CDN; offline, the graph doesn't render.
**G-3.** A window of its own (a desktop app) rather than a browser tab is to be decided.
