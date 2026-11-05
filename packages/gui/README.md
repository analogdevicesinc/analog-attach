# @analog-attach/gui

A local GUI for `analog-attach`: a page in the browser that runs the CLI for you. Experimental,
and for noos (CAPI) projects for now.

```sh
analog-attach gui                  # in a project folder: serve the GUI and open the browser
analog-attach gui --port 8080      # on another port
analog-attach gui --server-only    # don't open the browser; the URL is printed
```

- `src/index.html`: the whole page (no build step). Every action is one `analog-attach` command,
  shown in the page's console with what the CLI answered.
- `src/server.mjs`: the server. It serves the page on 127.0.0.1 and runs the CLI for it: one
  run per action, in the project folder, arguments as an array (no shell). `start_gui()` is what
  `analog-attach gui` calls (`packages/cli/src/front/gui.ts`); the CLI's build copies the page to
  its `bundled/gui/`.

To work on the page against a CLI of your own, without the CLI's `gui` command:

```sh
ANALOG_ATTACH="node $PWD/../cli/dist/cli.js" node src/server.mjs ~/my-project --port 5177
```

The spec of the command is `packages/cli/docs/spec/03-commands/gui.md`.
