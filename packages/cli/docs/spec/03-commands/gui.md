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
| `GET /` | the page |
| `GET /api/project`, `POST /api/project { dir }` | the project folder (`POST` changes it), whether it has project settings, and its `backend` |
| `POST /api/run { args }` | one CLI run: `{ code, stdout, stderr, json? }`, `json` when stdout is JSON |
| `POST /api/stream { args }` | one CLI run, its output as it comes, then `\0exit <code>` (build, deploy) |

**GUI-004** The CLI shall run until it is stopped (Ctrl-C, SIGINT), then write `Stopped the GUI
at <url>` and exit with status 0.

**GUI-005** A `--port` that isn't a port number (an integer from 0 to 65535) shall be the input
error `--port takes a port number (0 to 65535), got <value>`.

**GUI-006** Where the backend isn't noos, `gui` shall be left out of the help and of completion
(GEN-03); typed, it still runs, and the page says it handles noos projects for now.

## 2. Open issues

**G-1.** A wizard for a new project (the ecosystem, then its first settings) is still to come.
**G-2.** The page loads mermaid (the graph) from a CDN; offline, the graph doesn't render.
**G-3.** A window of its own (a desktop app) rather than a browser tab is to be decided.
