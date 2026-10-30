# Functional tests

Black-box tests of `analog-attach`: each runs the built CLI from bash, as a user would, and
names the requirements it checks. A run writes a report of which requirements passed, in
which ecosystem.

They complement the vitest tests under `src/`, which run the CLI in-process: these go
through the real binary, the real exit statuses and the real settings files.

## Running them

```sh
yarn workspace @analog-attach/cli build   # the tests run dist/cli.js
yarn test:functional                      # from the repo root: every test, then the report
```

`test/functional/run.sh` takes the same arguments as `bats`, plus files or folders relative
to this folder:

```sh
test/functional/run.sh                              # every test
test/functional/run.sh noos                         # one folder
test/functional/run.sh noos/config.bats             # one file
test/functional/run.sh --filter-tags req:CONFIG-04  # the tests of one requirement
test/functional/run.sh --filter-tags eco:linux      # one ecosystem
test/functional/run.sh --filter "reset"             # tests whose name matches
```

Needs: bash, node, `jq` and `python3`. bats and its assertion libraries come with
`yarn install` (`bats`, `bats-support`, `bats-assert`, dev dependencies of this package).
Yarn can't run bats itself (it runs a package's bin with node), so `run.sh` calls it with
bash.

The exit status is non-zero when a test fails, or when a test names a requirement that
doesn't exist.

## The report

Every run writes `out/` (ignored by git):

| File | What |
|---|---|
| `requirements.csv` | One row per requirement: its status in `linux` and in `noos` (`pass`, `fail`, `skipped`, `not tested`; `-` where it doesn't apply), and how many tests check it |
| `tests.csv` | One row per test: file, name, ecosystem, requirements, status, time, the first line of a failure |
| `report.xlsx` | Both, as sheets, coloured by status, when `openpyxl` is installed (`pip install openpyxl`) |
| `report.xml` | bats' JUnit output, for CI |

A requirement's status in an ecosystem is `fail` if any of its tests failed, else `pass` if
any passed, else `skipped`. A test that a filter left out counts as `not run`, and the
requirements only it checks as `not tested`.

The report also prints a warning for each test with no requirement, and an error for each
requirement ID that `docs/requirements.csv` doesn't have.

## Writing a test

One `.bats` file per command, in the folder of its ecosystem (`noos/`, `linux/`):

```bash
# Examples: config where the backend is noos.

# bats file_tags=eco:noos

setup() {
	load ../helpers
	new_project noos
}

# bats test_tags=req:CONFIG-04
@test "config --reset returns a setting to its default" {
	aa config probe jlink
	run aa config probe --reset
	assert_success
	run_json config probe
	assert_json '.configs[0].source' default
}
```

- **Requirements:** `# bats test_tags=req:<ID>` on the line above `@test`, the IDs of
  `docs/requirements.csv` (several: `req:INIT-01, req:INIT-02`). Every test names at least
  one. A requirement whose Ecosystems is `All` gets a test in both folders.
- **Ecosystem:** `# bats file_tags=eco:noos` (or `eco:linux`) once per file. Without it the
  folder name is used.
- **Isolation:** `helpers.bash` gives each test its own `$HOME` (so its own global settings)
  and project directory `$PROJECT`, the current directory. Nothing outside it is read.

### helpers.bash

| Helper | Does |
|---|---|
| `aa <words>` | Runs the built CLI |
| `new_project noos [key=value...]` | A project with the noos backend on attach-no-os-lib's test fixtures (a capi, a platform with `testboard`, `otherboard`, `twobusboard`, drivers); target `otherboard`. `key=value` changes a setting: `new_project noos target=testboard` |
| `new_project linux [key=value...]` | A project with the linux backend and no Linux tree |
| `run_json <words>` | `run aa --json <words>`, stderr kept apart (`$stderr`) so `$output` is the JSON |
| `assert_json <jq filter> <value>` | The filter on `$output` prints the value |
| `need <tool>...` | Skips the test when a tool isn't installed (`need cmake arm-none-eabi-gcc`) |

From bats and its libraries: `run` (sets `$status`, `$output`, `$lines`), `assert_success`,
`assert_failure [<status>]`, `assert_output [--partial|--regexp] <text>`, `refute_output`,
`assert_line`, `skip "<why>"`. See the docs of
[bats-core](https://bats-core.readthedocs.io/) and
[bats-assert](https://github.com/bats-core/bats-assert).

### Tips

- Check the JSON for values (`run_json` + `assert_json`), the text for what a user reads.
- A step a test needs but doesn't check can run bare: `aa config probe jlink`.
- Tests that need the toolchain or a board start with `need ...` or `skip`, so the suite
  runs anywhere.
- Name a test by the behaviour, as the requirement says it: the report lists the names.

## The requirements

`docs/requirements.csv` is the CLI specification's requirements, one row per requirement
(`ID`, `Command`, `Name`, `Requirement`, `Ecosystems`, `Basis`, …). It is generated with the
spec's workbook (`cli-spec.xlsx`, by `make_cli_spec.py`, which writes `cli-spec.csv`): copy
that file here when the spec changes, in the same change as the tests it affects.
