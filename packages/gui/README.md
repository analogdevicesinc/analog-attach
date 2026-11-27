# @analog-attach/gui

A local GUI for `analog-attach`: a page in the browser that runs the CLI for you. Experimental:
noos (CAPI) and Linux (devicetree overlay) projects.

```sh
analog-attach gui                  # in a project folder: serve the GUI and open the browser
analog-attach gui --port 8080      # on another port
analog-attach gui --server-only    # don't open the browser; the URL is printed
```

- `src/index.html` and `src/core/`: the **core**, shared: the header, the console, and the
  **project setup**, which a folder gets until it has its required settings (the ecosystem, the
  settings it needs, with the CAPI checkouts and module repositories the CLI finds, optional
  settings). Another project is another `analog-attach gui`, started in its folder; in a noos
  project **Project Setup** (the preferences' About) reopens the setup. The header's ⚙ opens the
  preferences; in a Linux project it is one popup with two tabs, **Project** (the project's
  settings) and **Preferences**. Preferences has the core's sections (Appearance, Layout, Files,
  Console, Assistant), then the part's (Linux: Show property types), then About, always last: the
  version (and, in a noos project, Project Setup). Its cards are 8px apart, and the Project tab's
  are too.
- `src/ecosystems/<backend>/`: **one part per ecosystem**, mounted by the core for a project of
  that backend: `noos/` (the workfile, adding devices, the graph, generate & build, settings, and
  the **chat with the assistant**) and `linux/` (no menu: the device tree, the node picked and its
  properties, and a right column of three tabs: the overlay, or the full `.dts` the last build
  wrote, with its validation; the binding of the node open, its YAML read-only; and the chat;
  the column folds to a ribbon on the right edge and back from there, its width dragged at its
  left edge, neither a preference;
  Validate, Build and Deploy in the header, their output in the console; the ⚙'s Project tab:
  the settings, each line its field, then a column each for a path's Browse… (the Linux tree's
  and the base's Change…), Save and Reset, empty where a setting has none, so the buttons line up
  (one name column for the whole tab); **Commands**, the executable variables `AA_BUILD`, `AA_DEPLOY` and
  `AA_PREPROCESS_COMMAND` (what Build Overlay, Deploy and every devicetree read run), each a
  command of one or several lines with Save (Ctrl+Enter) and Restore Default (`config var <NAME>
  --reset`, and for `AA_BUILD` and `AA_DEPLOY` the starter script written when the project
  folder has none, `init --restore`, a warning when it has one, which is kept); the system variables the commands get (read-only), the project's variables (a
  secret's value never shown or stored: Deploy asks for it when the GUI's environment hasn't it,
  keeps it in the page and gives it to that run's environment; a column each for its Save,
  Forget or Add, its Secret and its ✕); Preferences → Linux → Show property types, off by
  default, shows each property's dt-schema type with what its values can be, `uint32 · 0 to 15`,
  not its sizes, `1 item`, `one of 3`, which the CLI's `dt_type` has: `dt-type.mjs`). In the Linux part a
  `&label` in the overlay, and a label where a node is given it (`adc: …`), is a link to its node and a label field (a cell of a grid or a list
  too) has "go to <label>" under it, at its right, its place kept while it is hidden so nothing
  moves as the label is typed, the node opened with "← back to …", one step; a list of labels ends with "＋ Add a <kind>…"
  where the CLI can add one (`can_create`), which adds the node, sets the property to it and
  opens it; a number is shown as the file writes it (`read --json`'s `written`: `0x53` stays
  `0x53`, a negative as typed, `-1`), its field with its other base (hex or decimal) greyed at
  its right edge, and a change sends the field's text as it is.
  Each is its owner's; `src/ecosystems/README.md` is what a part is given and gives back.
- Toasts: the noos part says what happened in a toast. A Linux project has none: a refused change
  is said in red under its field or by its button until the next edit (`mutate`'s `place`, the
  slot `problem_slot` draws), a success says nothing more than the page shows, and what Validate,
  Build and Deploy did is in the console, opened (`show_console()`). The Project tab's content
  is `PROJECT_SECTIONS` (`ecosystems/linux/controller.mjs`): a new section goes there.
- No build step: plain ES modules. Every action is one `analog-attach` command, shown in the
  page's console with what the CLI answered.
- The look is Harmonic's, ADI's design system: its tokens in `src/core/harmonic.css` (taken from
  Harmonic, not edited by hand), the GUI's on them in `src/core/core.css`. Every text uses a
  `--type-*` token (Harmonic's type styles), monospace only for devicetree text and code;
  colours go through the semantic tokens, raw values only in `harmonic.css` (and the shadows of
  `core.css`'s `--elevation-*` tokens). A description (a
  binding's, a setting's) goes through `linkify` (`core/ui.mjs`), so its URLs are links.
- The fonts are bundled in `src/core/fonts/`, each with its OFL licence: no request leaves the
  machine. The server serves `.woff2` as binary; another font type means `server.mjs`'s `TYPES`
  and `BINARY`, then a rebuild of the CLI, which bundles the server into its `dist`.
- `src/server.mjs`: the server. It serves the page on 127.0.0.1 and runs the CLI for it: one
  run per action, in the project folder, arguments as an array (no shell). Given a `runner` (the
  CLI's `in_process_runner`, as `analog-attach gui` gives it), `/api/run` runs the CLI in the
  server's own process, keeping what it read for the next run; otherwise, and for `/api/stream`
  and the chat, each run is a child process of `cli`. `ANALOG_ATTACH_GUI_SPAWN=1 analog-attach
  gui` makes every run a child, to compare. `/api/run` and `/api/stream` take an `env` too:
  variables for that run alone, over the server's (`runner(args, folder, env)`), never logged or
  written; a name that isn't one, or that starts with `AA_`, is refused (spec GUI-012). Beside that it lists folders (the path fields), reads a text file for the page to show (the generated project's files, a Linux binding's YAML), finds the Linux trees near the project for the Linux setup, and opens a path with an app of a fixed list found on PATH (Open With: VS Code, the file manager, …), and, for Browse…, unless Preferences → Files → File picker is Built-in, opens the desktop's own file dialog (`/api/dialog`: on Linux the desktop portal's file chooser, xdg-desktop-portal over the session bus, `src/portal.mjs` and its small D-Bus client `src/dbus.mjs`; without it the first of zenity, kdialog, yad on PATH; osascript on macOS; the page's own picker otherwise, and where none can open). Its API answers only
  the GUI's own page: the token it writes into the page, from the GUI's own origin. `start_gui()` is what
  `analog-attach gui` calls (`packages/cli/src/front/gui.ts`). Run from the repository, the CLI
  serves `src/index.html` itself, so an edit shows on a reload; its build copies the page to
  `bundled/gui/` for an installed CLI.

- `src/assistant.mjs`: the chat's server side. For each message of the ✦ Assistant panel
  (opened from the console bar; in a Linux project, a tab of the right column), a model answers
  by running `analog-attach` commands in the project, and nothing else; the panel gets the same
  events (`turn`, `text`, `command`, `output`, `result`, `gui_done`) whichever answers. One
  conversation per project; the panel's New chat starts another (Preferences has none).
  Preferences → Assistant picks the model and says whether it can answer (spec GUI-014): kept,
  unnamed there, in the user's `~/.config/analog-attach/gui-chat.json`, over the
  environment's `$ANALOG_ATTACH_CHAT_PROVIDER`, `$ANALOG_ATTACH_LLM_URL`, `_MODEL` and
  `_API_KEY`. The model is an executable, an agent of the user's run headless in the project
  folder with the GUI's CLI first on its PATH (`src/agent.mjs`, what they share), or a server:
  - `src/claude.mjs`: the user's own Claude Code (`claude -p ... --permission-mode dontAsk
    --allowedTools "Bash(analog-attach:*)"`, `--resume`).
  - `src/codex.mjs`: Codex CLI (`codex exec --json --sandbox workspace-write -c
    approval_policy="never" ... -`, `resume`). It has no allowlist: the sandbox (writes in the
    project folder; the network on, for deploy) and the system prompt are its limits.
  - `src/gemini.mjs`: Gemini CLI (`gemini --prompt=... --output-format stream-json --policy
    <file>`, `--resume`), its policy allowing `analog-attach` shell commands and skills alone.
  - `src/llm.mjs`, the server: any model behind an OpenAI-compatible Chat Completions endpoint
    (OpenAI, Ollama, LM Studio, llama.cpp, vLLM, OpenRouter, LiteLLM, …). The server runs the
    conversation: the system prompt has the part's skill (its `SKILL.md`), the one tool,
    `analog_attach`, runs `analog-attach <args>` (no shell, `gui` refused), and its answers go
    back to the model until it replies with text. The model needs tool calls; the tests use a
    stand-in endpoint.

  An executable needs its CLI installed and logged in; the part's skill makes it much better at
  the CLI (the panel offers to install it, `skill install --agent <agent>`).
  `$ANALOG_ATTACH_CLAUDE`, `$ANALOG_ATTACH_CODEX` and `$ANALOG_ATTACH_GEMINI` name another command
  (the tests use stand-ins: `test/agents.test.mjs`, which the CLI's `yarn test` runs, and the
  CLI's functional tests).

To work on the page against a CLI of your own, without the CLI's `gui` command:

```sh
ANALOG_ATTACH="node $PWD/../cli/dist/cli.js" node src/start.mjs ~/my-project --port 5177
```

The spec of the command is `packages/cli/docs/spec/03-commands/gui.md`.
