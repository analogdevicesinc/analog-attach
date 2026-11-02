# The settings of noos (SET-*): what each one does.

# bats file_tags=eco:noos

# Preconditions: a noos project on attach-no-os-lib's test fixtures (a capi, a platform with
# testboard, otherboard and twobusboard, drivers), target otherboard, interview off, no
# workfile yet. field() reads one field of a setting's entry in config --json.
setup() {
	load ../helpers
	new_project noos
}

# `field <key> <jq filter>`: the filter on the `config --json <key>` entry of a setting.
field() {
	aa --json config "$1" | jq -r ".configs[0] | $2"
}

# --- SET-01: the ecosystem -----------------------------------------------------------------

# Description: the backend setting gives the ecosystem, noos here, and is stored in the
# project's settings.
# Steps:
#   1. Run config backend, with --json.
#   2. Check the value is noos, from the local settings, and the options are linux and noos.
#   3. Check the project's settings file stores backend noos.
#   4. Run --help and check it shows the backend, noos.
# bats test_tags=req:SET-01, id:N0210
@test "the backend setting selects the ecosystem and is stored with the project" {
	run_json config backend
	assert_json '.configs[0].value' noos
	assert_json '.configs[0].source' local
	assert_json '.configs[0].type.options | join(",")' "linux,noos"
	[ "$(jq -r .backend "$PROJECT/.analog-attach/config.json")" = noos ]
	run aa --help
	assert_output --partial "Backend: noos"
}

# Description: the backend is set per project, so two projects can use different ecosystems.
# Steps:
#   1. In a second, new project folder, run config backend linux.
#   2. Check config backend, with --json, gives linux there.
#   3. Back in the first project, check config backend, with --json, gives noos.
# bats test_tags=req:SET-01, id:N0211
@test "two projects on one machine can target different ecosystems" {
	mkdir -p "$BATS_TEST_TMPDIR/second"
	cd "$BATS_TEST_TMPDIR/second"
	aa config backend linux
	run_json config backend
	assert_json '.configs[0].value' linux
	cd "$PROJECT"
	run_json config backend
	assert_json '.configs[0].value' noos
}

# Description: the backend can't be set in the global settings.
# Steps:
#   1. Run config backend linux --global.
#   2. Check it is refused (exit 0) with a message saying backend belongs to the project.
#   3. Check the global settings file has no backend, or does not exist.
# bats test_tags=req:SET-01, id:N0212
@test "the backend can't be a user setting" {
	run aa config backend linux --global
	assert_success  # a refused value: the command ran (GEN-09)
	assert_output --partial "backend belongs to the project and can't be in the global settings"
	[ ! -e "$HOME/.config/analog-attach/config.json" ] || [ "$(jq -r '.backend // "none"' "$HOME/.config/analog-attach/config.json")" = none ]
}

# Description: switching the backend away and back keeps the noos settings.
# Steps:
#   1. Run config backend linux.
#   2. Check config probe, with --json, fails with a usage error (exit 2): a noos setting.
#   3. Run config backend noos.
#   4. Check config target, with --json, still gives otherboard.
# bats test_tags=req:SET-01, id:N0213
@test "switching the backend keeps each ecosystem's settings" {
	aa config backend linux
	run_json config probe
	assert_failure 2
	aa config backend noos
	run_json config target
	assert_json '.configs[0].value' otherboard
}

# --- SET-05: sources -----------------------------------------------------------------------

# Description: capi-path is a required path setting, and module-paths an optional list of paths
# that takes several values.
# Steps:
#   1. Check capi-path is required and of type path.
#   2. Check module-paths is not required and of type path_list.
#   3. Run config module-paths with three fixture folders, with --json.
#   4. Check it is accepted, and the settings file and config both hold three paths.
# bats test_tags=req:SET-05, id:N0214
@test "capi-path is a required path, module-paths a path list" {
	[ "$(field capi-path .required)" = true ]
	[ "$(field capi-path .type)" = path ]
	[ "$(field module-paths .required)" = false ]
	[ "$(field module-paths .type)" = path_list ]
	run_json config module-paths "$NOOS_FIXTURES/platform" "$NOOS_FIXTURES/driver-collection" "$NOOS_FIXTURES/adc-drivers"
	assert_json '.ok' true
	[ "$(jq '.noos["module-paths"] | length' "$PROJECT/.analog-attach/config.json")" = 3 ]
	[ "$(field module-paths '.value | length')" = 3 ]
}

# Description: the boards and chips the target can take come from the module trees of
# module-paths.
# Steps:
#   1. Run config module-paths with the driver collection alone.
#   2. Check config target, with --json, is a plain string: no options, as there is no platform.
#   3. Run config module-paths with the platform and the driver collection.
#   4. Check config target, with --json, now offers testboard.
# bats test_tags=req:SET-05, id:N0215
@test "the module trees of module-paths are what the project can use" {
	aa config module-paths "$NOOS_FIXTURES/driver-collection"
	run_json config target
	# No platform tree: no boards or chips.
	assert_json '.configs[0].type' string
	aa config module-paths "$NOOS_FIXTURES/platform" "$NOOS_FIXTURES/driver-collection"
	run_json config target
	assert_json '.configs[0].type.options | index("testboard") != null' true
}

# --- SET-06: target ------------------------------------------------------------------------

# Description: a board as the target puts the board and its chip in the workfile.
# Steps:
#   1. Run config target testboard.
#   2. Create the workfile with init.
#   3. Check the workfile has board testboard and platform testsoc.
# bats test_tags=req:SET-06, id:N0216
@test "a board as the target brings its chip" {
	aa config target testboard
	aa init >/dev/null
	[ "$(jq -r '"\(.board) \(.platform)"' "$PROJECT/workfile.json")" = "testboard testsoc" ]
}

# Description: a chip as the target makes a workfile on that chip, with no board.
# Steps:
#   1. Run config target boardless.
#   2. Run init, with --json, and check it is accepted.
#   3. Check the workfile has platform boardless and no board.
# bats test_tags=req:SET-06, id:N0217
@test "a chip as the target is used without a board" {
	aa config target boardless
	run_json init
	assert_json '.ok' true
	[ "$(jq -r '.platform' "$PROJECT/workfile.json")" = boardless ]
	[ "$(jq -r '.board // "none"' "$PROJECT/workfile.json")" = none ]
}

# Description: there is no board or platform setting; target is the one setting for both.
# Steps:
#   1. Run config board testboard and check it fails with a usage error (exit 2), unknown field.
#   2. Run config platform testsoc and check it fails with a usage error (exit 2), unknown field.
#   3. Check config target, with --json, offers the three boards and the three chips.
# bats test_tags=req:SET-06, id:N0218
@test "target is the one setting: there is no board or platform setting" {
	run aa config board testboard
	assert_failure 2
	assert_output --partial "Unknown config field: board"
	run aa config platform testsoc
	assert_failure 2
	assert_output --partial "Unknown config field: platform"
	run_json config target
	assert_json '.configs[0].type.options | join(",")' "testboard,otherboard,twobusboard,testsoc,othersoc,boardless"
}

# --- SET-07: the generated project ---------------------------------------------------------

# Description: the settings of the generated project start at their defaults: project-name and
# project-path unset, project-template capi, example true.
# Steps:
#   1. Check project-name and project-path have no value and are unset.
#   2. Check project-template is capi, by default.
#   3. Check example is true, by default.
# bats test_tags=req:SET-07, id:N0219
@test "project-name, project-path, project-template and example have their defaults" {
	[ "$(field project-name '"\(.value) \(.source)"')" = "null unset" ]
	[ "$(field project-path '"\(.value) \(.source)"')" = "null unset" ]
	[ "$(field project-template '"\(.value) \(.source)"')" = "capi default" ]
	[ "$(field example '"\(.value) \(.source)"')" = "true default" ]
}

# Description: project-name gives the folder name of the generated project.
# Steps:
#   1. Create a workfile with the eval-testpart board added.
#   2. Run config project-name myproject.
#   3. Run generate, with --json, and check it is accepted.
#   4. Check the project is in out/myproject (its CMakeLists.txt).
# bats test_tags=req:SET-07, id:N0220
@test "project-name names the generated project" {
	with_sensor
	aa config project-name myproject
	run_json generate
	assert_json '.ok' true
	[ -f "$PROJECT/out/myproject/CMakeLists.txt" ]
}

# Description: project-path gives the folder the generated project is written to.
# Steps:
#   1. Create a workfile with the eval-testpart board added.
#   2. Run config project-path with a folder of the test.
#   3. Run generate, with --json, and check it is accepted.
#   4. Check the project is in that folder and there is no out folder.
# bats test_tags=req:SET-07, id:N0221
@test "project-path says where the generated project goes" {
	with_sensor
	aa config project-path "$BATS_TEST_TMPDIR/generated"
	run_json generate
	assert_json '.ok' true
	[ -f "$BATS_TEST_TMPDIR/generated/CMakeLists.txt" ]
	[ ! -e "$PROJECT/out" ]
}

# Description: project-template selects the template set generate uses, and refuses a set that
# does not exist.
# Steps:
#   1. Create a workfile with the eval-testpart board added.
#   2. Run generate, with --json, and check it uses the capi templates.
#   3. Run config project-template capi-iio, then generate, with --json.
#   4. Check it is refused (.ok false): capi-iio serves IIO devices only.
#   5. Run config project-template nosuchset and check it is refused (exit 0), saying the set
#      is not found and naming the sets available.
# bats test_tags=req:SET-07, id:N0222
@test "project-template chooses the template set" {
	with_sensor
	run_json generate
	assert_output --partial "templates: capi,"
	aa config project-template capi-iio
	run_json generate
	# The fixture's sensor is no IIO device: capi-iio, being the set used, refuses it.
	assert_json '.ok' false
	assert_output --partial "The capi-iio template set serves IIO devices"
	run aa config project-template nosuchset
	assert_success  # a refused value: the command ran (GEN-09)
	assert_output --partial "Template set 'nosuchset' not found"
	assert_output --partial "Available sets: capi, capi-iio"
}

# Description: example is a true/false setting, and refuses other values.
# Steps:
#   1. Check the options of example are true and false.
#   2. Run config example false, with --json, and check it is accepted and stored.
#   3. Run config example maybe and check it is refused (exit 0), saying it is not true or false.
# bats test_tags=req:SET-07, id:N0223
@test "example is a true/false setting of the generated project" {
	# What it changes in main.c needs a board with a console (a UART), which the fixtures lack.
	[ "$(field example '.type.options | join(",")')" = "true,false" ]
	run_json config example false
	assert_json '.ok' true
	[ "$(field example .value)" = false ]
	run aa config example maybe
	assert_success  # a refused value: the command ran (GEN-09)
	assert_output --partial 'example: "maybe" is not true or false'
}

# --- SET-08: interview ---------------------------------------------------------------------

# Description: interview is on by default, and add then asks, on a terminal, for values left to
# choose.
# Steps:
#   1. Reset interview and check it is true, by default.
#   2. Create the workfile with init.
#   3. Run add testpart on a terminal, and press Ctrl-C at the first question.
#   4. Check it asked to pick testpart_spi_dev.controller.
# bats test_tags=req:SET-08, id:N0224
@test "interview is on by default and asks, on a terminal, for what is left after add" {
	aa config interview --reset >/dev/null
	[ "$(field interview '"\(.value) \(.source)"')" = "true default" ]
	aa init >/dev/null
	tty_run "pick one" $'\x03' -- add testpart
	assert_output --partial "testpart_spi_dev.controller: pick one"
}

# Description: with interview off, add on a terminal asks nothing and finishes.
# Steps:
#   1. Run config interview false.
#   2. Create the workfile with init.
#   3. Run add testpart on a terminal, typing nothing.
#   4. Check it succeeds, with no question, and names testpart_spi_dev.controller as left to do.
# bats test_tags=req:SET-08, id:N0225
@test "with interview off, add asks nothing on a terminal" {
	aa config interview false
	aa init >/dev/null
	tty_run -- add testpart
	assert_success
	refute_output --partial "only you can tell"
	assert_output --partial "testpart_spi_dev.controller"
}

# --- SET-08-CAPI: bootstrap ----------------------------------------------------------------

# Description: bootstrap is on by default, and add then fills in values that have only one choice.
# Steps:
#   1. Check bootstrap is true, by default.
#   2. Create a workfile with the eval-testpart board added.
#   3. Check the workfile has max_speed_hz 1000000 on testpart_spi_dev and comm_type
#      TESTPART_SPI on testpart_ip.
# bats test_tags=req:SET-08-CAPI, id:N0226
@test "bootstrap is on by default and fills in what leaves no choice" {
	[ "$(field bootstrap '"\(.value) \(.source)"')" = "true default" ]
	with_sensor
	jq -e '.symbols.testpart_spi_dev.max_speed_hz == 1000000 and .symbols.testpart_ip.comm_type == "TESTPART_SPI"' \
		"$PROJECT/workfile.json" >/dev/null
}

# Description: with bootstrap off, add fills in no values.
# Steps:
#   1. Run config bootstrap false.
#   2. Create the workfile with init.
#   3. Add eval-testpart, with --json, and check it is accepted.
#   4. Check the workfile has no testpart_spi_dev values and no comm_type on testpart_ip.
# bats test_tags=req:SET-08-CAPI, id:N0227
@test "with bootstrap off, add fills in no values" {
	aa config bootstrap false
	aa init >/dev/null
	run_json add eval-testpart
	assert_json '.ok' true
	jq -e '.symbols | has("testpart_spi_dev") | not' "$PROJECT/workfile.json" >/dev/null
	jq -e '.symbols.testpart_ip | has("comm_type") | not' "$PROJECT/workfile.json" >/dev/null
}

# --- SET-09: own build and deploy ----------------------------------------------------------

# Description: build-command runs in place of the default build step.
# Steps:
#   1. Create a workfile with the eval-testpart board added, and generate.
#   2. Run config build-command with a command that writes a file.
#   3. Run build, with --json, and check it succeeds.
#   4. Check the file was written in the generated project, and there is no build folder.
# bats test_tags=req:SET-09, id:N0228
@test "build-command replaces the build step" {
	with_sensor
	aa generate >/dev/null
	aa config build-command 'echo mine > built-by-me.txt'
	run_json build
	assert_success
	assert_json '.ok' true
	[ "$(cat "$PROJECT/out/project/built-by-me.txt")" = mine ]
	[ ! -e "$PROJECT/out/project/build" ]
}

# Description: deploy-command runs in place of the default deploy step.
# Steps:
#   1. Create a workfile with the eval-testpart board added, and generate.
#   2. Run config deploy-command with a command that writes a file, and config build-command
#      true.
#   3. Run deploy, with --json, and check it succeeds.
#   4. Check the file was written in the generated project.
# bats test_tags=req:SET-09, id:N0229
@test "deploy-command replaces the deploy step" {
	with_sensor
	aa generate >/dev/null
	aa config deploy-command 'echo mine > deployed-by-me.txt'
	# Never built here: a build step of the user's own too, so deploy doesn't look for the image.
	aa config build-command true >/dev/null
	run_json deploy
	assert_success
	assert_json '.ok' true
	[ "$(cat "$PROJECT/out/project/deployed-by-me.txt")" = mine ]
}

# --- SET-11: build folder ------------------------------------------------------------------

# Description: build-dir is build by default, and takes another folder.
# Steps:
#   1. Run config build-dir, with --json.
#   2. Check the value is build, by default.
#   3. Run config build-dir with a folder of the test, and check it succeeds.
#   4. Check config build-dir, with --json, now gives that folder.
# bats test_tags=req:SET-11, id:N0230
@test "build-dir names the folder build writes to, build by default" {
	run_json config build-dir
	assert_json '.configs[0].value' build
	assert_json '.configs[0].source' default
	run aa config build-dir "$BATS_TEST_TMPDIR/build-a"
	assert_success
	run_json config build-dir
	assert_json '.configs[0].value' "$BATS_TEST_TMPDIR/build-a"
}

# --- SET-10-CAPI: probe --------------------------------------------------------------------

# Description: probe is openocd by default, takes jlink, and refuses other probes.
# Steps:
#   1. Check probe is openocd, by default, with the options openocd and jlink.
#   2. Run config probe jlink and check it is stored.
#   3. Run config probe stlink and check it is refused (exit 0), naming the options.
# bats test_tags=req:SET-10-CAPI, id:N0231
@test "probe is openocd by default, and takes jlink" {
	[ "$(field probe '"\(.value) \(.source)"')" = "openocd default" ]
	[ "$(field probe '.type.options | join(",")')" = "openocd,jlink" ]
	aa config probe jlink
	[ "$(field probe .value)" = jlink ]
	run aa config probe stlink
	assert_success  # a refused value: the command ran (GEN-09)
	assert_output --partial 'probe: "stlink" is not one of openocd | jlink'
}
