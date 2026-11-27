# Repository Guidelines

## Project Structure
- `packages/cli`: the `analog-attach` CLI. `src/front` parses the command line; `src/backends/linux`
  and `src/backends/noos` implement the commands; `docs/spec` is the specification it follows
  (requirements, grammar, the JSON protocol); `test/functional` the bats tests that check it.
  See `packages/cli/CLAUDE.md`.
- `packages/gui`: the browser GUI `analog-attach gui` serves: plain ES modules, every action an
  `analog-attach` command. See `packages/gui/README.md`.
- `packages/linux-lib`: devicetree parsing, bindings and validation (the `linux` backend).
- `packages/capi-lib`: the CAPI registry, rulesets, wiring and code generation (the `noos` backend).
- `skills/`: the Claude Code skills `analog-attach skill install` installs
  (`analog-attach-linux/`, `analog-attach-noos/`, each folder named after its skill), copied into
  the CLI's package by its build.

## Build, Test, and Development Commands
- `yarn build`: the libraries, then the CLI (which bundles them).
- `yarn test`: the unit tests (vitest) of linux-lib, the CLI and capi-lib.
- `yarn test:functional`: the CLI's functional tests (bats).
- `yarn verify`: build, type-check, test and lint everything (`scripts/verify.sh`).
- `yarn lint`: ESLint over every package; `yarn lint:cli`, `yarn workspace <package> lint` one.

## Coding Style & Naming Conventions
- **Language**: TypeScript with `strict` compiler options; the GUI is plain JavaScript (ES modules).
- **Linting**: ESLint with `@typescript-eslint` and `unicorn`.
- **Names**: snake_case for functions and variables, PascalCase for types, as the code around.
- **Formatting**: tabs, and `;` after type members, everywhere (`eslint.stylistic.mjs`, errors in
  `yarn lint`); avoid large unrelated reformatting.

## Testing Guidelines
- Unit tests sit next to the code (`*.test.ts`) or in the package's `test/`.
- A CLI behaviour the specification describes gets a functional test in
  `packages/cli/test/functional/<backend>/`, tagged with its requirement and test id.

## Commit & Pull Request Guidelines
- **Commits**: `area: what changed` in the present tense (`gui: …`, `cli: …`), signed off
  (`git commit -s`, the DCO in `.dco`).
- **PRs**: a clear description, the testing done, and green `yarn verify` and functional tests.

## Security & Configuration Tips
- Paths and targets are project settings (`analog-attach config`), not code.
- Do not commit secrets, hard-coded IPs or passwords.
