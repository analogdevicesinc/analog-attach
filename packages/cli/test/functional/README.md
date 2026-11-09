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
test/functional/run.sh                              # noos/, linux/ and conformity/ (not e2e/)
test/functional/run.sh noos                         # one folder
test/functional/run.sh conformity                   # the conformity tests
test/functional/run.sh noos/config.bats             # one file
test/functional/run.sh --filter-tags req:CONFIG-04  # the tests of one requirement
test/functional/run.sh --filter-tags eco:linux      # one ecosystem
test/functional/run.sh --filter "reset"             # tests whose name matches
test/functional/run.sh --filter-tags id:N0012       # one test, by its ID
test/functional/run.sh --require-steps              # fail on a test with no description, steps or preconditions
```

Needs: bash, node, git, `jq` and `python3`. bats and its assertion libraries come with
`yarn install` (`bats`, `bats-support`, `bats-assert`, dev dependencies of this package).
Yarn can't run bats itself (it runs a package's bin with node), so `run.sh` calls it with
bash.

The exit status is non-zero when a test fails, when a test names a requirement that doesn't
exist, when a test's ID is missing, malformed, of the other ecosystem or another test's, or
when bats stops before the last test it was to run (a full disk, say: the tests it
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

## The specification and the report

Every run writes two workbooks to `out/` (ignored by git), or to the folder `FUNCTIONAL_OUT`
names (for runs side by side):

- **The test specification** (`test-spec.xlsx`): what is tested, and how. It is the same for
  every run of a commit, and needs no run: `report.py --spec-only --tests test/functional
  --requirements docs/requirements.csv --out <folder>` writes it alone.
- **The test report** (`test-report.xlsx`): how this run went. It names the tests by ID; their
  steps are in the specification, under the same ID.

| File | What |
|---|---|
| `test-spec.xlsx` | **About**: the spec's version (below) and its test counts. **Chapters**: each chapter's tests by kind. **Tests**: one row per test, automated, manual and planned, by chapter: ID, chapter, kind, ecosystem, requirements, name, file, description, preconditions, steps (`1. ...`, one per line). **Coverage**: one row per requirement, with the IDs of its automated, manual and planned tests |
| `test-spec.csv` | The Tests sheet |
| `test-report.xlsx` | **Run**: when (start, end, duration), how (`CI` with the GitHub run's link, workflow, event and who triggered it, or `local` with the git user and host), what (commit, with uncommitted changes or not, branch, CLI and node versions, OS, the command, whether the real CAPI trees and a board were there) and the spec version it ran. **Chapters**: each chapter's tests by status. **Requirements** and **Tests**: the two CSVs below |
| `requirements.csv` | One row per requirement: its status in `linux` and in `noos` (`-` where it doesn't apply), how many tests that ran check it, the IDs of its tests (`Test IDs`, all of them, run or not), and the IDs of those that fail or are known gaps (`Failing/gap IDs`) |
| `tests.csv` | One row per test, by chapter: ID, chapter, kind, file, name, ecosystem, requirements, status, whether it is a known gap, time, and for a manual test the date and tester of its last result; the first line of a failure, or the manual result's notes |
| `summary.md` | The run, the counts, per ecosystem too, and the requirements that fail, are known gaps (with the IDs of the tests concerned), or have no test in any ecosystem they apply to (CI puts it on the run's page) |
| `report.xml` | bats' JUnit output |

The workbooks need `openpyxl`, and `manual-tests.yaml` needs PyYAML (`pip install openpyxl
pyyaml`); without openpyxl only the CSVs are written.

An automated test's status is `pass`, `fail`, `skipped` or `not run` (a filter left it out),
and `gap` for a known gap that fails (tagged `gap`, see Gaps below): a known issue, listed in
its own colour so it isn't forgotten, but not a failure. A known gap that passes is a `pass`,
noted `fixed: drop the gap tag`. A manual test's status is its last recorded result (`pass`,
`fail` or `blocked`), or `manual` when none is recorded; a planned test's is `planned`.

A requirement's status in an ecosystem is the first of `fail`, `gap`, `pass`, `skipped` (or
`blocked`), `manual`, `planned` its tests have, and `not tested` when it has none.

### Chapters

Both workbooks sort the tests into chapters, in the order of a project's life:

setup, config, settings, init, import, list, add, read, update, delete, rename, move,
enable-disable, validate, generate, build, deploy, completion, skill, general; then the
conformity chapters in the same order (`add-conformity`, `read-conformity`, ...); then
`end to end` and `manual`.

A test's chapter comes from its file's name: `noos/add.bats` and `linux/add.bats` share **add**,
`conformity/read.bats` is **read-conformity**, a file under `e2e/` is **end to end**. Two file
names aren't their chapter's: `gen.bats` is **general**, `enable.bats` **enable-disable**
(`CHAPTER_NAMES` in `report.py`). A file whose tests belong elsewhere says so in its file tags,
`# bats file_tags=eco:noos, chapter:deploy`; a manual or planned test with its `chapter` field
(**manual** when left out). A chapter not in the list sorts after the others. The Chapter
column, the **Chapters** sheet of each workbook (the spec's: each chapter's tests by kind; the
report's: by status) and a table in `summary.md` show them.

### The spec's version

`spec-version` holds the specification's number (`0.1`): raise it when the specification is
handed out. The workbooks add, automatically, the last commit that changed a spec source (a
`.bats` file, `manual-tests.yaml`, `spec-version`) with its date, and a fingerprint of the
spec's content (12 hex digits of a SHA-256 of the Tests sheet): `0.1 (5c7d8f1 2026-11-03,
e426d3e043b0)`. Two copies of one number with different content have different fingerprints.

### Manual and planned tests

`manual-tests.yaml` lists the tests that aren't automated:

- **manual**: done by a person, because they need hardware or a look at the screen;
- **planned**: still to be automated. When it is, move it into a `.bats` file **with the same
  ID**, so its history and its requirements stay.

```yaml
- id: N0123                     # next-id.sh noos: one ID sequence with the automated tests
  kind: manual                  # manual or planned
  ecosystem: noos
  requirements: [DEPLOY-02]     # may be []
  title: deploy through a J-Link probe runs the new firmware on the board
  description: deploy --probe jlink flashes the built image, and the board runs it.
  preconditions: a MAX32655FTHR on a J-Link probe, a project built for it.
  steps:
    - Run deploy --probe jlink.
    - Check the board runs the new firmware (its LED blinks at the new rate).
```

Every field is required, as for an automated test, except `chapter` (see Chapters).

Whoever runs a manual test records how it went in `manual-results.csv`, one row per run:

```csv
ID,Date,Tester,Result,Commit,Notes
N0123,2026-11-03,afpop,pass,5c7d8f1,blinks at 2 Hz
```

Result is `pass`, `fail` or `blocked`. The latest date counts, and a later row on the same day.
Commit is the commit tested, shown in the report next to the notes. A manual result is in the
report and in the requirements' statuses, but doesn't fail a run: `--fail-unless-gap` looks at
the automated tests only.

### Errors

The report prints:
- a warning for each test with no requirement, and a note for each known gap that now passes;
- an error for each requirement ID that `docs/requirements.csv` doesn't have;
- an error for each test ID that is missing, malformed, of the other ecosystem's prefix, or used
  twice, across the `.bats` files and `manual-tests.yaml`;
- an error for each entry of `manual-tests.yaml` or `manual-results.csv` it can't take: an
  unknown field, a missing one, a result for a test that isn't manual, a date not in
  `YYYY-MM-DD`.

Tests with no description, steps or preconditions get one warning with their count
(`report.py --verbose` lists them); with `--require-steps` (to `run.sh` or `report.py`) each is
an error and the run fails.

## In CI

`.github/workflows/run-tests.yml` runs the functional tests in their own job, beside the unit
tests: it builds the CLI (`yarn build:cli`), then runs

```sh
yarn test:functional --jobs 4 --fail-unless-gap --require-steps
```

and, whatever the result, writes `summary.md` to the run's summary and uploads two artifacts:
`functional-test-spec` (`test-spec.xlsx` and its CSV) and `functional-test-report`
(`test-report.xlsx`, the CSVs, the summary and bats' JUnit). With `--fail-unless-gap` the run
fails only on a test that fails and isn't a known gap (or a run that stopped early); without
it, as locally by default, a known gap fails the run too. `--require-steps` also fails it on a
test without its Description, Steps or Preconditions. The tests that need real CAPI trees or a
board skip in CI.

## Writing a test

One `.bats` file per command, in the folder of its ecosystem (`noos/`, `linux/`):

```bash
# Examples: config where the backend is noos.

# bats file_tags=eco:noos

# Preconditions: a noos project on attach-no-os-lib's test fixtures, target otherboard, no
# workfile yet.
setup() {
	load ../helpers
	new_project noos
}

# Description: --reset drops a setting the project set, so it is back to its default.
# Steps:
#   1. Set the probe to jlink.
#   2. Reset the probe.
#   3. Check it succeeds, and the probe's source is the default again, not the
#      project's settings.
# bats test_tags=req:CONFIG-04, id:N0042
@test "config --reset returns a setting to its default" {
	aa config probe jlink
	run aa config probe --reset
	assert_success
	run_json config probe
	assert_json '.configs[0].source' default
}
```

- **ID:** `id:N0042` among the tags above `@test` (`id:L0042` in `linux/`): `N` for noos,
  `L` for linux, and 4 digits. Every test has one, and no two tests the same. An ID names
  the test in the reports, the workbook and anything that cites it, so it is **never reused
  or renumbered**: a moved, renamed or rewritten test keeps its ID, a deleted test's ID isn't
  given to another, and a new test takes the next free one, which `next-id.sh noos` (or
  `linux`) prints: the highest ID of that prefix in the `.bats` files, plus one. A test with no
  requirement has the ID alone: `# bats test_tags=id:L0123`.
- **Requirements:** `req:<ID>` among the tags, the IDs of `docs/requirements.csv` (several:
  `req:INIT-01, req:INIT-02, id:N0042`). Every test names at least one. A requirement whose
  Ecosystems is `All` gets a test in both folders.
- **Description, steps, preconditions:** every test has a `# Description:` and `# Steps:`
  comment above its tags, and every file a `# Preconditions:` comment before its first test
  (above `setup()`), which applies to all its tests. They are mandatory: they are what the
  report's `Description`, `Steps` and `Preconditions` columns show to someone who doesn't read
  bash. Without `--require-steps` the report only warns about a missing one; with it (as in
  CI) a missing one is an error and fails the run.
  - A field's text runs on over the plain `# text` comment lines after it, joined with a
    space, up to the next field, the tags line, a blank or non-comment line, or another note
    (one word and a colon, such as `# Gap:`). So other comments can come above them or
    between them, but not inside a field.
  - Steps are numbered, `#   1. text`, one per line; a step that wraps goes on in an indented
    comment line. The report keeps them numbered as written.
  - Only the comments after the previous test belong to a test.
  - Write the description as what the test shows, and the steps as what it does and checks,
    in words: `Add the test_gpio_pin schema, with --json`, not the command line.
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

### Conformity tests

`conformity/` holds the conformity tests: one case run on **both** backends, checking that
they answer alike (GEN-02, GEN-08). One file per command (`conformity/config.bats`, ...),
tagged `eco:all, conformity`; their IDs have their own prefix, `C0001`... (`next-id.sh
conformity`), and the report counts their result for both ecosystems. They run by default,
in CI too, and need the Linux tree like the linux tests.

They compare only what both backends share: the exit status, the shape of the common fields
(keys and their JSON types, from the base types of `src/interface/backend-responses.ts`), and
a few values that must match (`ok`, `severity`, `error_type`), never the message text. A
field only one backend has is fine. They cover the cases that already answer alike; a case
that differs on purpose, or that isn't aligned yet, isn't a conformity test.

```bash
setup() {
	load ../helpers
	conformity_projects             # $NOOS_PROJECT and $LINUX_PROJECT, no workfile yet
}

@test "an unknown device type is refused the same way on both backends" {
	on noos init                    # a step before the case, in one backend's project
	on linux init
	conform add nosuchdevice -- add adi,nosuchdevice    # noos words -- linux words, with --json
	assert_same_status 0
	assert_same '{ok, severity}' '{"ok":false,"severity":"error"}'
	assert_same '.message | type' '"string"'
}
```

| Helper | What it does |
|---|---|
| `conformity_projects` | A noos project (fixtures) and a linux one (Linux tree), side by side, no workfile |
| `with_conformity_devices` | After `conformity_projects`: `init` on both, and a device on each: noos `test_gpio_pin` as `pin` (property `number`), linux `adi,adxl345` under i2c1, label `adxl345` (property `reg`) |
| `on noos\|linux <words>` | Runs the CLI in that backend's project, for the steps before the case; a failure fails the test |
| `conform <noos words> -- <linux words>` | Runs the case on each backend, with `--json`; sets `$noos_status`, `$noos_output`, `$linux_status`, `$linux_output` |
| `assert_same_status [<status>]` | Both exited the same (and with that status) |
| `assert_same <jq filter> [<value>]` | The filter gives the same on both results (and that value); `shape` in the filter turns a value into its JSON types |

### End-to-end tests

`e2e/` holds the end-to-end tests: one user's story through many commands, on the real trees,
checked against a workfile fixture. They have the `e2e` tag (in the spec, kind `e2e`), an ID
like any test, a description and steps, and no requirement for now. `run.sh` runs only
`noos/` and `linux/` by default, so they don't run in CI: run them by name.

```sh
AA_CAPI_PATH=~/aurel/capi \
AA_MODULE_PATHS=~/aurel/capi-maxim:~/aurel/capi-noos:~/aurel/capi-util \
test/functional/run.sh e2e
```

They skip without the trees and the toolchain (`real_project`). The first one,
`e2e/noos-adxl355-max32655fthr.bats` (N0279), takes an ADXL355 eval board on a MAX32655FTHR from
an empty project to a built image:
- list devices, add, validate, read, list value, update, rename;
- the workfile compared with `e2e/fixtures/adxl355-max32655fthr.workfile.json`;
- generate and build, and deploy through a stand-in `deploy-command`, or on the board with
  `AA_DEPLOY=1`;
- then the fixture imported in a new project, generated and built again.

The Linux ones, `e2e/linux-<part>-rpi4.bats` (L0360 to L0364), take a part on the Raspberry Pi
4 base of the Linux tree (`linux-tree.sh`, which `run.sh e2e` prepares) from an empty overlay to
a deployed `.dtbo`, each by another road:

| File | Part | Road |
|---|---|---|
| `linux-adxl345-rpi4.bats` | ADXL345 on i2c1 | the binding's example, its unresolved `interrupt-parent` fixed |
| `linux-adxl367-rpi4.bats` | ADXL367 on spi0 | the required template, moved to spidev0's chip select, spidev0 disabled |
| `linux-ad5593r-rpi4.bats` | AD5593R on i2c1 | channel child nodes, one renamed to another channel |
| `linux-ad7124-8-rpi4.bats` | AD7124-8 on spi1 | a `fixed-clock` the overlay adds, decimal channel numbers, a property deleted |
| `linux-ad4130-rpi4.bats` | AD4130 on spi0 | the tree's `rpi-ad4130` overlay, a channel deleted and one added |

Each story then compares the overlay with `e2e/fixtures/<part>-rpi4.dtso`, builds it, deploys it
through a stand-in `deploy-command` (or to the Raspberry Pi of `AA_DEPLOY_IP`, with
`AA_DEPLOY_USER` and `AA_DEPLOY_PASSWORD`, which it reboots), and imports the fixture in a new
project, which must validate and build the same `.dtbo`. Their common steps are in
`e2e/linux-helpers.bash`. They need only the Linux tree:

```sh
test/functional/run.sh e2e/linux-ad4130-rpi4.bats
```

When the definitions change on purpose (a new default, a renamed node), `AA_E2E_UPDATE=1`
rewrites the fixture from the run. Review its diff before committing it: it is what the test
checks against.

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
