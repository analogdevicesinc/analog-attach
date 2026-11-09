# CLAUDE.md: the front end

Part of `packages/cli/CLAUDE.md` (read that first).

- `src/bin/cli.ts`: `main` with the real process. Ctrl-C outside a prompt aborts the session's
  signal, and the run exits 130.
- `src/front/main.ts`: `main(argv, deps: MainDeps)` is one run. It reads `backend`, loads that
  backend from the registry, opens the settings with its specs, builds the routes and runs the words.
  Everything it touches comes in through `MainDeps` (streams, location, tty, environment, prompter,
  signal, `package_root`, registry), so tests drive it in-process.
  - `strip_json` takes `--json` out of the words wherever it is (before a `--`).
  - `__complete -- <words>` goes to `complete.ts`.
  - The bare run (no words, no `--json`, on a terminal) goes to `setup.ts`. Off a terminal, or with
    `--quiet` alone, it prints the usage.
  - `help [<command>...]` is `<command>... --help`.
  - `PROGRAM` is `analog-attach`. `assets_directory(package_root, id)` is `bundled/<id>`.
- `src/front/registry.ts`: `BACKENDS`, one dynamic import per backend, so each is its own chunk and a
  no-OS run never loads attach-lib.
- `src/front/routes.ts`: the route table, the one place that knows the grammar.
  - `SHARED` / `SHARED_ROUTES` hold the shared commands with the positionals of `01-grammar.abnf`,
    plus the backend's flags merged in.
  - The backend's `extra` commands, then the front end's own (`config`, `skill`, `completion`).
  - `build_routes` makes the table. `build_application` makes the stricli app from it, and
    `complete.ts` uses the same table, so help, parsing and completion can't drift.
  - A shared command the backend leaves out stays routed but hidden. It exits 2 with
    `<route> is not supported by the <id> backend` (`other_backends` names the ones that have it).
    With no backend, every shared command points to `config backend`.
- `src/front/session.ts`: `create_session` builds the `Session`.
  - It carries `program`, `mode` (`text` / `json` / `complete`), `cwd`, `settings`, `state_dir`
    (`.analog-attach/<id>/`, `state_directory`), `assets_dir`, `style`, `signal`.
  - `prompter` is set only on a terminal without `--json` or `--quiet`.
  - `say` writes a result line on stdout, in order with the prompts. It works in text mode only,
    with a prompter, and throws otherwise.
  - `warn` writes a line on stderr in every mode. `progress` (`start_progress`) shows a long step
    on stderr. In `complete` mode, `warn` and `progress` print nothing.
- `src/front/settings-store.ts`: `open_settings` behind `SettingsView`.
  - The files are the project-local `.analog-attach/config.json` (`CONFIG_DIRECTORY`,
    `CONFIG_FILE`, under `find_project_root`) and the global
    `$XDG_CONFIG_HOME/analog-attach/config.json`. Local wins over global, then the spec's default.
  - Each file is a JSON object: `backend` at the top level, and each backend's settings in an
    object named after its id, its section (`{ "backend": "linux", "linux": { … }, "noos": { … }
    }`). Keys are kebab-case; values are strings, except a `path_list`, which is an array.
  - `open_settings({ files, top, sections, active })`: `top` is `[backend_setting(ids)]`,
    `sections` the registry's ids, `active` the backend's `{ id, specs }` (none when no backend is
    set). The store reads and writes only the active section, so each backend keeps its own
    `workfile` and `config backend <id>` only changes which section is used. Local and global
    layer section by section.
  - The parse is strict: a non-object file, a wrong type, a value outside its options, a section
    that isn't an object, or (in the local file) an unknown key is an error. Unknown keys are
    those of neither the top level (`backend`, the section ids) nor the active section; the
    message names a section key `<id>.<key>` (`unknown key linux.foo`). Other sections are kept
    verbatim and never checked. A flat file of the old format fails with these errors (no
    migration).
  - Errors are values: the store always opens and leaves an invalid value out. A file that isn't a
    JSON object is never written over, nor an active section that isn't one written into.
  - `BACKEND_KEY` (`backend`) is the front end's own key (`backend_setting`).
- `src/front/output.ts`: `print_outcome` / `run_outcome` print an `Outcome` and give its exit status
  (`EXIT_OK`, `EXIT_CRASH`, `EXIT_INPUT_ERROR`, `EXIT_CANCELLED`). Also `big_int_replacer` and
  `capture_stream` for tests.
- `src/front/prompter.ts`: `create_prompter`, on `@inquirer/prompts` (`select`, `confirm`,
  `checkbox`, `search`, and a custom `input` with Tab completion). Ctrl-C and Ctrl-D throw
  `PromptCancelled`, which prints with exit 130 when nothing catches it.
- `src/front/complete.ts`: `complete_words` answers `__complete`. It completes command and flag
  names and `config`'s keys and values itself. For a positional it builds the `Slot` (`path`,
  `property`, `value`, `device`, `source`, `flag`, `extra`) and asks `backend.complete`, whose
  `Completion` `completion_lines` renders. Nothing goes to stderr, and a failing source gives no
  candidates.
- `src/front/stubs.ts`: the shell stubs (`completion_script`) and `completion [<shell>] [--install |
  --uninstall]` (`completion_route`, `install_completion`). The stubs only hand the words to
  `analog-attach __complete` and render what it prints.
  - The directives are `__ANALOG_ATTACH_COMPLETE_FILES__` / `DIRS__` / `NOSPACE__` / `GROUP__`. A
    `FILES` or `DIRS` line may be followed by candidates (`Completion.fallback`).
  - zsh lists each group under its heading. The stub sets `list-grouped false` for analog-attach
    unless the user has set it. bash and fish skip the group lines.
- `src/front/config.ts`: `config_route` / `run_config`.

  | Command | Does |
  |---|---|
  | `config [<key>]` | show every setting, or one |
  | `config <key> <value>... [--global]` | set it |
  | `config <key> --reset [--global]` | remove it from the file |
  | `config --reload` | run the backend's `settings_hooks.reload` |

  After a set or reset, the backend's `settings_hooks.changed` runs, and its outcome replaces the
  front end's answer. Without a backend, `config` still knows `backend`.
- `src/front/skill.ts`: `skill install <name> [--force]` / `skill uninstall <name>` (`skill_routes`,
  `install_skill`). They copy one of `Backend.skills` to `~/.claude/skills/<name>/` (Linux:
  `analog-attach-linux` from `skills/linux/`; noos: `analog-attach-noos` from `skills/noos/`).
  Installing needs `claude` on PATH (`claude_on_path`).
- `src/front/setup.ts`: `bare_run`.
  1. With no backend set, it asks which (by `title`) and saves `backend`.
  2. It runs the backend's `setup`. When the response is `ready`, it runs the backend's `init` and
     ends with that outcome.
  3. If the backend has no `setup`, it lists the required settings that are unset.
- `src/front/testing/fake-backend.ts`: a backend for the front end's own tests.
