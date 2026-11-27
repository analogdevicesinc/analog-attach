# Development Guidelines

## Project Structure

- `packages/cli`: the `analog-attach` CLI, its `linux` and `noos` backends, and its specification (`docs/spec`)
- `packages/gui`: the browser GUI that `analog-attach gui` serves (plain ES modules, no build step)
- `packages/linux-lib`: devicetree parsing and binding processing (the `linux` backend)
- `packages/capi-lib`: the CAPI registry, rulesets, wiring and code generation (the `noos` backend,
  which a project can't pick for now: only the Linux side is released)
- `skills/`: the AI agent skills `analog-attach skill install` installs, copied into the CLI by its build
- `skill-evals/`: evaluations of the skills
- `docs/`: the user guide (Sphinx; see [docs/README.md](docs/README.md))

## Requirements

- `yarn v4.5.3` (the `packageManager` of `package.json`)
- `node >= v22` (CI also runs the unit tests on Node 26)
- For the tests, the tools the CLI runs, as the [README](README.md#requirements) lists them:
  `device-tree-compiler` (`dtc`), `cpp`, and dt-schema 2026.9
  (`pipx install dtschema==2026.9`, then `pipx inject dtschema ruamel.yaml.clib`).
- For the functional tests, also `jq`; GNU `parallel` for `--jobs`; Python's `openpyxl` and
  `pyyaml` for the workbooks of the report (its CSVs need neither).

## Getting Started

1. Turn on Yarn (Corepack, shipped with Node, picks the version `package.json` pins):
   ```bash
   corepack enable
   ```

2. Clone the repository and install the dependencies:
   ```bash
   git clone <repo-url>
   yarn install
   ```

## Building

```bash
yarn build                 # linux-lib, capi-lib, then the CLI (which bundles them)
yarn build:linux-lib
yarn build:capi-lib
yarn build:cli
yarn build:binary          # the CLI as a standalone executable (packages/cli/dist-binary/)
```

`yarn workspace @analog-attach/cli dev-link` builds the CLI and links it as
`~/.local/bin/analog-attach`.

Run from the repository, the CLI serves the GUI's `packages/gui/src` itself, so an edit to the page
shows on a reload.

### Clean Build Artifacts

```bash
yarn clean      # Remove built artifacts
yarn clean:all  # Remove artifacts and node_modules
```

## Testing

```bash
yarn test              # unit tests: linux-lib, the CLI, capi-lib
yarn test-clean        # clean, build, then the unit tests
yarn test:functional   # the CLI's functional tests (bats, packages/cli/test/functional)
yarn test:functional --fast  # the same, every CLI call in one test server: for development
yarn verify            # build, type-check, test and lint every package, in order (scripts/verify.sh)
yarn verify:linux      # the same for the Linux side: linux-lib, and the CLI without its noos backend
yarn verify:no-os      # the same for the no-OS side: capi-lib, and the CLI without its linux backend
```

`yarn hooks:install` (once per clone) turns on the repository's git hooks (`scripts/git-hooks/`).
The pre-commit hook runs ESLint on the TypeScript files the commit adds or changes under the
`src/` of `cli`, `linux-lib` and `capi-lib`, each with its package's config; an error stops the
commit (`git commit --no-verify` skips it). That covers the formatting too: `eslint.stylistic.mjs`
holds the repository's formatting rules (`@stylistic/eslint-plugin`), all errors, the same in
every package: tabs, and `;` after the members of an interface or a type literal. All but the
line length (180) fix themselves: `yarn eslint --fix <file>` in the package.

The pre-push hook builds the CLI and runs the functional tests as CI does when a push has a
change under `packages/` (a new branch: compared to `origin/dev`); a failure stops the push. It
runs on the working tree, so it refuses a push of anything but `HEAD`, or with changes under
`packages/` that aren't committed. `git push --no-verify` skips it.

`yarn blame:install` (once per clone) has `git blame` skip the commits in `.git-blame-ignore-revs`,
the reformats; GitHub's blame skips them already.

## Linting

```bash
yarn lint                       # every package
yarn lint:cli
yarn workspace linux-lib lint
yarn workspace capi-lib lint
```
