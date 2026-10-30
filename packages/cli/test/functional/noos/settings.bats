# The settings of noos (SET-*): what each one does.

# bats file_tags=eco:noos

setup() {
	load ../helpers
	new_project noos
}

# `field <key> <jq filter>`: the filter on the `config --json <key>` entry of a setting.
field() {
	aa --json config "$1" | jq -r ".configs[0] | $2"
}

# --- SET-01: the ecosystem -----------------------------------------------------------------

# bats test_tags=req:SET-01
@test "the backend setting selects the ecosystem and is stored with the project" {
	run_json config backend
	assert_json '.configs[0].value' noos
	assert_json '.configs[0].source' local
	assert_json '.configs[0].type.options | join(",")' "linux,noos"
	[ "$(jq -r .backend "$PROJECT/.analog-attach/config.json")" = noos ]
	run aa --help
	assert_output --partial "Backend: noos"
}

# bats test_tags=req:SET-01
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

# bats test_tags=req:SET-01
@test "the backend can't be a user setting" {
	run aa config backend linux --global
	assert_failure 2
	assert_output --partial "backend belongs to the project and can't be in the global settings"
	[ ! -e "$HOME/.config/analog-attach/config.json" ] || [ "$(jq -r '.backend // "none"' "$HOME/.config/analog-attach/config.json")" = none ]
}

# bats test_tags=req:SET-01
@test "switching the backend keeps each ecosystem's settings" {
	aa config backend linux
	run_json config probe
	assert_failure 2
	aa config backend noos
	run_json config target
	assert_json '.configs[0].value' otherboard
}

# --- SET-05: sources -----------------------------------------------------------------------

# bats test_tags=req:SET-05
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

# bats test_tags=req:SET-05
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

# bats test_tags=req:SET-06
@test "a board as the target brings its chip" {
	aa config target testboard
	aa init >/dev/null
	[ "$(jq -r '"\(.board) \(.platform)"' "$PROJECT/workfile.json")" = "testboard testsoc" ]
}

# bats test_tags=req:SET-06
@test "a chip as the target is used without a board" {
	aa config target boardless
	run_json init
	assert_json '.ok' true
	[ "$(jq -r '.platform' "$PROJECT/workfile.json")" = boardless ]
	[ "$(jq -r '.board // "none"' "$PROJECT/workfile.json")" = none ]
}

# bats test_tags=req:SET-06
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

# bats test_tags=req:SET-07
@test "project-name, project-path, project-template and example have their defaults" {
	[ "$(field project-name '"\(.value) \(.source)"')" = "null unset" ]
	[ "$(field project-path '"\(.value) \(.source)"')" = "null unset" ]
	[ "$(field project-template '"\(.value) \(.source)"')" = "capi default" ]
	[ "$(field example '"\(.value) \(.source)"')" = "true default" ]
}

# bats test_tags=req:SET-07
@test "project-name names the generated project" {
	with_sensor
	aa config project-name myproject
	run_json generate
	assert_json '.ok' true
	[ -f "$PROJECT/out/myproject/CMakeLists.txt" ]
}

# bats test_tags=req:SET-07
@test "project-path says where the generated project goes" {
	with_sensor
	aa config project-path "$BATS_TEST_TMPDIR/generated"
	run_json generate
	assert_json '.ok' true
	[ -f "$BATS_TEST_TMPDIR/generated/CMakeLists.txt" ]
	[ ! -e "$PROJECT/out" ]
}

# bats test_tags=req:SET-07
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
	assert_failure 2
	assert_output --partial "Template set 'nosuchset' not found"
	assert_output --partial "Available sets: capi, capi-iio"
}

# bats test_tags=req:SET-07
@test "example is a true/false setting of the generated project" {
	# What it changes in main.c needs a board with a console (a UART), which the fixtures lack.
	[ "$(field example '.type.options | join(",")')" = "true,false" ]
	run_json config example false
	assert_json '.ok' true
	[ "$(field example .value)" = false ]
	run aa config example maybe
	assert_failure 2
	assert_output --partial 'example: "maybe" is not true or false'
}

# --- SET-08: interview ---------------------------------------------------------------------

# bats test_tags=req:SET-08
@test "interview is on by default and asks, on a terminal, for what is left after add" {
	aa config interview --reset >/dev/null
	[ "$(field interview '"\(.value) \(.source)"')" = "true default" ]
	aa init >/dev/null
	tty_run "pick one" $'\x03' -- add testpart
	assert_output --partial "testpart_spi_dev.controller: pick one"
}

# bats test_tags=req:SET-08
@test "with interview off, add asks nothing on a terminal" {
	aa config interview false
	aa init >/dev/null
	tty_run -- add testpart
	assert_success
	refute_output --partial "only you can tell"
	assert_output --partial "testpart_spi_dev.controller"
}

# --- SET-08-CAPI: bootstrap ----------------------------------------------------------------

# bats test_tags=req:SET-08-CAPI
@test "bootstrap is on by default and fills in what leaves no choice" {
	[ "$(field bootstrap '"\(.value) \(.source)"')" = "true default" ]
	with_sensor
	jq -e '.symbols.testpart_spi_dev.max_speed_hz == 1000000 and .symbols.testpart_ip.comm_type == "TESTPART_SPI"' \
		"$PROJECT/workfile.json" >/dev/null
}

# bats test_tags=req:SET-08-CAPI
@test "with bootstrap off, add fills in no values" {
	aa config bootstrap false
	aa init >/dev/null
	run_json add eval-testpart
	assert_json '.ok' true
	jq -e '.symbols | has("testpart_spi_dev") | not' "$PROJECT/workfile.json" >/dev/null
	jq -e '.symbols.testpart_ip | has("comm_type") | not' "$PROJECT/workfile.json" >/dev/null
}

# --- SET-09: own build and deploy ----------------------------------------------------------

# bats test_tags=req:SET-09
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

# bats test_tags=req:SET-09
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

# bats test_tags=req:SET-11, gap
@test "build-dir names the folder build writes to" {
	# Gap: there is no build-dir setting ("Unknown config field: build-dir", exit 2).
	run aa config build-dir "$BATS_TEST_TMPDIR/build-a"
	assert_success
	run_json config build-dir
	assert_json '.configs[0].value' "$BATS_TEST_TMPDIR/build-a"
}

# --- SET-10-CAPI: probe --------------------------------------------------------------------

# bats test_tags=req:SET-10-CAPI
@test "probe is openocd by default, and takes jlink" {
	[ "$(field probe '"\(.value) \(.source)"')" = "openocd default" ]
	[ "$(field probe '.type.options | join(",")')" = "openocd,jlink" ]
	aa config probe jlink
	[ "$(field probe .value)" = jlink ]
	run aa config probe stlink
	assert_failure 2
	assert_output --partial 'probe: "stlink" is not one of openocd | jlink'
}
