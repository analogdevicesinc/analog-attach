# CLAUDE.md: the front end

Part of `packages/cli/CLAUDE.md` (read that first).

- `src/bin/cli.ts`: `main` with the real process. Ctrl-C outside a prompt aborts the session's
  signal, and the run exits 130.
- `src/front/main.ts`: `main(argv, deps: MainDeps)` is one run. It reads `backend`, loads that
  backend from the registry, opens the settings with its specs, builds the routes and runs the words.
  Everything it touches comes in through `MainDeps` (streams, location, tty, environment, prompter,
  signal, `package_root`, registry, `unlisted`, `long_lived`), so tests and the GUI drive it in-process.
  - `strip_json` takes `--json` out of the words wherever it is (before a `--`).
  - `__complete -- <words>` goes to `complete.ts`.
  - The bare run (no words, no `--json`, on a terminal) goes to `setup.ts`. Off a terminal, or with
    `--quiet` alone, it prints the usage.
  - `help [<command>...]` is `<command>... --help`.
  - `[<command>...] --help --all` goes to `help-all.ts`: every command's help, for every backend
    of `FrontEnd.choices`, as one Markdown document, each page rendered through the same
    application as `--help`.
  - `PROGRAM` is `analog-attach`. `assets_directory(package_root, id)` is `bundled/<id>`.
- `src/front/registry.ts`: `BACKENDS`, one dynamic import per backend, so each is its own chunk and a
  no-OS run never loads linux-lib. `UNLISTED` (`noos`, spec COM-017) names the backends no project
  may pick: they stay registered, built and tested, and a project set to one runs it.
  - The entry points pass it as `MainDeps.unlisted` (`cli.ts`, `test-server.ts`, `in-process.ts`;
    tests leave it out). `open_front` turns it into `FrontEnd.choices`: the registry's ids but the
    unlisted, plus the active one.
  - `choices` is everything that offers a backend: the `backend` setting's options (so `config
    backend noos` is refused as a value outside them), the bare run's question, `config backend`
    completion and examples, `backend_command` / `other_backends` (the hints and the help's
    `Another:` line) and `--help --all`. The GUI's ecosystem step takes the options from `config
    --json`. Loading, the settings sections and `in-process.ts`'s queue still use the whole
    registry.
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
    (`.analog-attach/<id>/`, `state_directory`), `assets_dir`, `style`, `signal`, `long_lived`.
  - `long_lived` (`MainDeps.long_lived`, default false) says the process runs more commands than
    this one: only the GUI's in-process runs set it. A backend may then keep what it read for the
    next run in ways that can't be checked exactly (Linux: parsed bindings, the 5 s bindings walk;
    the validate worker's owner is `process.pid`).
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
  - `open_settings({ files, top, sections, active })`: `top` is `[backend_setting(choices)]`,
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
  - `variables` (`VARIABLES_KEY`): the project's variables, for a backend that runs scripts
    (`Backend.variables`, Linux; `active.variables` gives its reserved prefix, `AA_`). They are in
    the active section of the local file only (`"variables": { "BOARD_IP": "10.0.0.5",
    "BOARD_PASSWORD": { "secret": true } }`): a value is a non-empty string, a secret its name
    alone, never its value. A name is a shell name without the reserved prefix
    (`variable_name_problem`). `variables` in the global file, or an invalid entry, is an error
    and left out. `variables()`, `set_variable`, `reset_variable`; a write keeps the invalid
    entries. `variables()` and `set_variable` are the `SettingsView`'s too, so a backend can set
    one (Linux `init`, a starter's); the session's view is the store itself.
  - The backend's executable variables (`ScriptVariables.executables`, `active.variables
    .executables`; Linux `AA_BUILD`, `AA_DEPLOY`, `AA_PREPROCESS_COMMAND`, each with its
    `default`) sit in the same `variables` object, a command each (a string with more than white
    space, `parse_executable`), only once changed. They are the only names with the reserved
    prefix the store takes, never a secret (`a command, never a secret`), and not in
    `variables()`: `executable(name)` gives one, the stored command else its default
    (`undefined` for any other name). An invalid one is an error (`must be a non-empty string:
    the command it runs`, the hint `… go back to the default: config var <NAME> --reset.`), and
    its default is used.
- `src/front/output.ts`: `print_outcome` / `run_outcome` print an `Outcome` and give its exit status
  (`EXIT_OK`, `EXIT_CRASH`, `EXIT_INPUT_ERROR`, `EXIT_CANCELLED`). Also `big_int_replacer` and
  `capture_stream` for tests.
- `src/front/prompter.ts`: `create_prompter`, on `@inquirer/prompts` (`select`, `confirm`,
  `checkbox`, `search`, `password`, hidden, for a secret variable's value, and a custom `input`
  with Tab completion). Ctrl-C and Ctrl-D throw
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
  | `config var [<NAME> [<value>]] [--reset \| --secret]` | the scripts' variables and the commands (`run_variable`, CONFIG-300 to CONFIG-311): list them (the backend's system variables, then its executable ones, then the project's), show one, set one, remove it (`--reset`; an executable one goes back to its default), or store it as a secret, by name only (`--secret`, refused for an executable one) |

  After a set or reset, the backend's `settings_hooks.changed` runs, and its outcome replaces the
  front end's answer. Without a backend, `config` still knows `backend`. `config var` is there
  only for a backend with `variables` (`ScriptVariables`); it never takes `--global`, and a
  system variable (the reserved prefix, but an executable one's) can't be reset. A
  `VariableEntry` is `system`, `executable` (with `runs` and `default`, `scripts` empty),
  `project` or `secret`; the table shows a command of several lines by its first line and ` …`
  (`one_line`), and the steps as `build, deploy and preprocess` (`and_list`).
- `src/front/skill.ts`: `skill install <name> [--force] [--agent <agent>]` / `skill uninstall
  <name> [--agent <agent>]` (`skill_routes`, `install_skill`, `uninstall_skill`). They copy one of
  `Backend.skills` to the agent's skills folder (`AGENTS`, `skill_directory`: claude, the default,
  `~/.claude/skills/<name>/`; codex `~/.agents/skills/`; gemini `~/.gemini/skills/`; `all` each
  agent installed) (Linux: `analog-attach-linux`, noos: `analog-attach-noos`, each from
  `skills/<name>/`, as the Agent Skills spec has a skill's folder named after it). With no name,
  either lists the backend's skills (`list_skills`). Installing needs the agent on PATH
  (`agent_on_path`, `FrontEnd.agent_installed`).
  - The skills live at the repository root (`skills/`). `packaged_skill(package_root, folder)`
    gives a backend's `source_dir`: the root's copy when the CLI runs from the repository (an
    edit installs with no build), else the package's `skills/<folder>/`, which `yarn build`
    copies in (gitignored) for `yarn pack` and the binary.
- `src/front/gui.ts`: `gui_route`, `analog-attach gui`. It starts `@analog-attach/gui`'s server
  (`start_gui`) with the page's folder, the CLI's own `dist/cli.js` for the child runs (`/api/stream`,
  the chat), and `in_process_runner` for `/api/run`; `$ANALOG_ATTACH_GUI_SPAWN` leaves the runner
  out, so every run is a child (to compare). Spec `gui.md`.
- `src/front/in-process.ts`: `in_process_runner(package_root)`, the GUI's `/api/run` in its own
  process (spec GUI-011). It returns `(words, cwd, environment?)`: `main` with the words, the
  project folder as `location.cwd`, captured streams, no tty, `long_lived: true`. `environment`
  (a secret's value for `deploy`, DEPLOY-040) is merged over `process.env` for that run only:
  `process.env` isn't changed, so the runs that overlap don't see it. A noos project's runs are queued one at a time (capi-lib's
  `use_settings` is module state, and `add` awaits between `install` and the lib); the others
  overlap, so the page's reads don't wait for `validate`. Linux runs may overlap because what
  they write under `process.pid` (the preprocessed base, the cache temporaries) is written and
  renamed with no `await` in between.
- `src/front/setup.ts`: `bare_run`.
  1. With no backend set, it asks which (by `title`, among `FrontEnd.choices`) and saves `backend`.
  2. It runs the backend's `setup`. When the response is `ready`, it runs the backend's `init` and
     ends with that outcome.
  3. If the backend has no `setup`, it lists the required settings that are unset.
- `src/front/testing/fake-backend.ts`: a backend for the front end's own tests.
