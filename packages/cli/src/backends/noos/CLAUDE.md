# CLAUDE.md: the no-OS backend

Part of `packages/cli/CLAUDE.md` (read that first).

`src/backends/noos/index.ts`:
- the shared commands, including `list context`;
- the extra `generate`;
- `setup`, `complete`, `noos_settings_hooks`;
- the skill `analog-attach-noos`.

attach-no-os-lib does the domain work (registry, workfile, bootstrap, codegen). The backend adapts
it to the interface.

- **Settings injection** (`settings.ts`): `SETTINGS` is the lib's `SETTINGS_DEFAULTS` as
  `SettingSpec`s, by the lib's categories:
  - sources: `capi-path`, `module-paths`;
  - target: `target` (a board, or a chip with no board);
  - workfile: `workfile`;
  - project: `project-name`, `project-path`, `project-template`;
  - build: `build-command`, `deploy-command`, `probe`, and `bootstrap`, `interview`, `example`.

  The lib reads settings and templates through module state. `install(session)` points it at the
  session before every call (`use_settings(session.settings)`, which sees the `noos` section, and
  `use_templates_root(<assets_dir>/templates)` when that exists). `noos_settings_hooks` gives
  `check` (`capi-path` / `module-paths` must be module checkouts; `target` must name a board or a
  chip, `resolve_target`) and `options` (for `target`, the boards then the chips; the template sets).
- **Workfile** (`commands/shared.ts`): `load_context` loads the workfile and registry,
  `save_workfile` writes it back. `get_project_path` gives `project-path`, else
  `out/<project-name>` under the project root.
- **Bootstrap** (`commands/bootstrap_run.ts`): after `add`, `update` and `delete` change the
  workfile, `run_bootstrap` fills what can be derived when the `bootstrap` setting is on.
  `describe_bootstrap` / `still_needed` say what it did and what is left.
- **Interview** (`commands/interview.ts`): `run_interview` runs after `add` on a terminal (a
  prompter, and the `interview` setting on). It asks one thing at a time:
  - a choice bootstrap stopped at, then a required value nothing could fill;
  - after each answer it runs bootstrap again and saves the workfile, so Ctrl-C keeps what was
    answered;
  - an answer goes through `update`'s parser and `set_value`.
- **Setup** (`commands/setup.ts`): `capi-path`, the module repositories next to it, the board, then
  the workfile. Each answer is written through the same checks `config` makes. The response is
  `ready` when the user wants the workfile, and the front end then runs `init`.
- **generate** (`commands/generate.ts`, an `ExtraCommand`, `generate.schema.json`) renders the
  workfile into the project with the template set. Its flags `--output`, `--project-template` and
  `--board` override the settings for one run.
- **build / deploy** (`commands/build.ts`, `commands/deploy.ts`, `build/cmake_build.ts`): with
  `build-command` / `deploy-command` set, the command runs in the project (`run_shell`, from
  `src/backends/shell.ts`). Otherwise
  the backend does a CMake preset build (`plan_build`, `preflight`, `cmake --preset <board>`,
  `cmake --build build`, `--target flash` for deploy). The tool's output goes through
  `session.progress` on stderr, so stdout keeps only the result.
- **Protocol** (`protocol/responses.ts`, `protocol/convert.ts`): the workfile's flat symbol table as
  the shared tree. Nodes sit under the root; a union value is a `[member, value]` tuple.
- `complete.ts` reads the workfile straight off disk on every Tab and never prints.
- Tests use `testing/fixture.ts`, which points at attach-no-os-lib's fixtures (a capi checkout, two
  platforms, a driver collection).
