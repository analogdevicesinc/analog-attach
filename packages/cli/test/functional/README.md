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

Needs: bash, node, git, `jq` and `python3`. bats and its assertion libraries come with
`yarn install` (`bats`, `bats-support`, `bats-assert`, dev dependencies of this package).
Yarn can't run bats itself (it runs a package's bin with node), so `run.sh` calls it with
bash.

The exit status is non-zero when a test fails, when a test names a requirement that doesn't
exist, or when bats stops before the last test it was to run (a full disk, say: the tests it
didn't get to are missing from its results, as if filtered out).

### The Linux tree

The linux tests run on a real Linux tree: analogdevicesinc/linux at a pinned commit of
`rpi-6.12.y`, with the Raspberry Pi 4 (`bcm2711-rpi-4-b.dts`) as the base devicetree.
`linux-tree.sh` clones it on first use into `packages/cli/linux-adi/` (shallow, blobless and
sparse: the bindings, the `dt-bindings` headers and the arm/arm64 broadcom device trees with
the RPi overlays, about 90 MB in 15 s), then builds its binding caches once with the CLI
(`config linux`) into `packages/cli/linux-adi-caches/`. Both are ignored by git. `run.sh` calls
it before the linux tests; it does nothing when both are there and current, and rebuilds the
caches when the tree or the bundled tools change. Each test copies the caches into its project.

To move to a newer commit, change `COMMIT` in `linux-tree.sh` (the next run clones it again).
`AA_LINUX=<checkout>` uses a tree of your own instead of the clone; the tests expect
`rpi-6.12.y`'s content.

## The report

Every run writes `out/` (ignored by git), or the folder `FUNCTIONAL_OUT` names (for runs side by
side):

| File | What |
|---|---|
| `requirements.csv` | One row per requirement: its status in `linux` and in `noos` (`-` where it doesn't apply), and how many tests check it |
| `tests.csv` | One row per test: file, name, ecosystem, requirements, status, whether it is a known gap, time, the first line of a failure |
| `summary.md` | The counts, per ecosystem too, and the requirements that fail, are known gaps, or have no test in any ecosystem they apply to (CI puts it on the run's page) |
| `report.xlsx` | The two tables as sheets, coloured by status, when `openpyxl` is installed (`pip install openpyxl`) |
| `report.xml` | bats' JUnit output |

A test's status is `pass`, `fail`, `skipped` or `not run` (a filter left it out), and `gap`
for a known gap that fails (tagged `gap`, see Gaps below): a known issue, listed in its own
colour so it isn't forgotten, but not a failure. A known gap that passes is a `pass`, noted
`fixed: drop the gap tag`.

A requirement's status in an ecosystem is `fail` if one of its tests failed, else `gap` if one
is a known gap, else `pass` if one passed, else `skipped`; `not tested` when none of its tests
ran.

The report also prints a warning for each test with no requirement, a note for each known gap
that now passes, and an error for each requirement ID that `docs/requirements.csv` doesn't have.

## In CI

`.github/workflows/run-tests.yml` runs the functional tests in their own job, beside the unit
tests: it builds the CLI (`yarn build:cli`), then runs

```sh
yarn test:functional --jobs 4 --fail-unless-gap
```

and, whatever the result, writes `summary.md` to the run's summary and uploads `out/` as the
`functional-tests-report` artifact (the workbook among it). With `--fail-unless-gap` the run
fails only on a test that fails and isn't a known gap (or a run that stopped early); without it, as locally by default, a
known gap fails the run too. The tests that need real CAPI trees or a board skip in CI.

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
| `new_project linux [key=value...]` | A project with the linux backend on the Linux tree (`$LINUX_TREE`), base `$LINUX_BASE` (the RPi 4), workfile `overlay.dtso` (not created), and the binding caches |
| `$WORKFILE` | The workfile's path, set by `new_project`: `workfile.json` (noos), `overlay.dtso` (linux) |
| `with_overlay` | After `new_project linux`: `init`, an empty overlay at `$WORKFILE` |
| `run_json <words>` | `run aa --json <words>`, stderr kept apart (`$stderr`) so `$output` is the JSON |
| `assert_json <jq filter> <value>` | The filter on `$output` prints the value |
| `need <tool>...` | Skips the test when a tool isn't installed (`need cmake arm-none-eabi-gcc`) |
| `with_sensor` | After `new_project noos`: `init` and `add eval-testpart`, a valid workfile with testpart, testpart_cfg, testpart_ip, eval_testpart, testpart_spi_dev, testpart_cs_gpio |
| `drop_setting <key>...` | Removes settings from the project's section of its backend, as if never set |
| `snapshot`, `assert_unchanged` | The workfile on disk is as it was at `snapshot`: for refusals that must write nothing |
| `tty_run <expect> <keys>... -- <words>` | Runs the CLI on a pseudo-terminal, typing `<keys>` each time the screen shows `<expect>` (`$'\r'` Enter, `$'\x1b[B'` down, `$'\x03'` Ctrl-C); sets `$status` and `$output`; gives up after `TTY_TIMEOUT` seconds (20). For the guided setup and the interview |
| `stored <jq filter>` | The filter on the workfile on disk (`stored '.symbols.testpart_ip.comm_init'`) |
| `real_project` | The project's settings for real CAPI trees (`AA_CAPI_PATH`, `AA_MODULE_PATHS`, `AA_TARGET`), or a skip without them and the toolchain |

From bats and its libraries: `run` (sets `$status`, `$output`, `$lines`), `assert_success`,
`assert_failure [<status>]`, `assert_output [--partial|--regexp] <text>`, `refute_output`,
`assert_line`, `skip "<why>"`. See the docs of
[bats-core](https://bats-core.readthedocs.io/) and
[bats-assert](https://github.com/bats-core/bats-assert).

### Gaps

A test is written to its requirement, not to what the CLI does today. When the CLI doesn't
meet the requirement yet, the test fails: tag it `gap` too, with a comment saying what the
CLI does instead, so the report shows where the code falls short:

```bash
# Gap: a refused value exits 2 on stderr, with no JSON.
# bats test_tags=req:GEN-09, gap
@test "a refused setting value exits 0 with ok false" { ... }
```

`run.sh --filter-tags '!gap'` runs everything else; `--filter-tags gap` only the gaps. Once
the CLI is fixed, drop the tag.

### Tests that need the real trees or a board

Build and deploy can't run on the fixtures (their capi is not a real CAPI). Those tests start
with `real_project` and skip unless these are set:

```sh
AA_CAPI_PATH=~/work/capi \
AA_MODULE_PATHS=~/work/capi-maxim:~/work/capi-noos:~/work/capi-util \
AA_TARGET=max32655fthr \
test/functional/run.sh noos/build.bats
```

They also need cmake, ninja and arm-none-eabi-gcc (and `MAXIM_SDK_PATH` for a Maxim board).
A test that would flash a board skips unless `AA_DEPLOY=1`.

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
