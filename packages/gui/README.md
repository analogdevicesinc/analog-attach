# @analog-attach/gui

A local GUI for `analog-attach`: a page in the browser that runs the CLI for you. Experimental,
and for noos (CAPI) projects for now.

```sh
analog-attach gui                  # in a project folder: serve the GUI and open the browser
analog-attach gui --port 8080      # on another port
analog-attach gui --server-only    # don't open the browser; the URL is printed
```

- `src/index.html` and `src/core/`: the **core**, shared: the header, the console, and the
  **project setup**, which a folder with no project settings gets once (the ecosystem, the
  settings it needs, with the CAPI checkouts and module repositories the CLI finds, optional
  settings). **New project** starts one in a folder of your choice; **Setup** reopens it.
- `src/ecosystems/<backend>/`: **one part per ecosystem**, mounted by the core for a project of
  that backend: `noos/` (the workfile, adding devices, the graph, generate & build, settings, and
  the **chat with Claude**) and `linux/` (a placeholder). Each is its owner's; `src/ecosystems/README.md` is what a part is
  given and gives back.
- No build step: plain ES modules. Every action is one `analog-attach` command, shown in the
  page's console with what the CLI answered.
- `src/server.mjs`: the server. It serves the page on 127.0.0.1 and runs the CLI for it: one
  run per action, in the project folder, arguments as an array (no shell). Its API answers only
  the GUI's own page: the token it writes into the page, from the GUI's own origin. `start_gui()` is what
  `analog-attach gui` calls (`packages/cli/src/front/gui.ts`). Run from the repository, the CLI
  serves `src/index.html` itself, so an edit shows on a reload; its build copies the page to
  `bundled/gui/` for an installed CLI.

- `src/claude.mjs`: the chat's server side. For each message of the noos part's ✦ Claude panel
  (in the console bar), it runs the user's own Claude Code headless in the project
  (`claude -p ... --permission-mode dontAsk --allowedTools "Bash(analog-attach:*)"`), so Claude
  may run `analog-attach` commands and nothing else, and streams its events to the panel. One
  conversation per project (`--resume`); New chat starts another. It needs Claude Code installed
  and logged in; the `analog-attach-noos` skill makes it much better at the CLI (the panel offers
  to install it). `$ANALOG_ATTACH_CLAUDE` names another `claude` (the tests use a stand-in).

To work on the page against a CLI of your own, without the CLI's `gui` command:

```sh
ANALOG_ATTACH="node $PWD/../cli/dist/cli.js" node src/server.mjs ~/my-project --port 5177
```

The spec of the command is `packages/cli/docs/spec/03-commands/gui.md`.
