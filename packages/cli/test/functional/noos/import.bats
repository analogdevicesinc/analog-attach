# import where the backend is noos.

# bats file_tags=eco:noos

setup() {
	load ../helpers
	new_project noos
}

# `sensor_design <file>`: a valid workfile with the eval board (with_sensor's), moved to <file>,
# so that no workfile is configured any more.
sensor_design() {
	with_sensor
	mv "$PROJECT/workfile.json" "$1"
}

# bats test_tags=req:IMPORT-01, req:IMPORT-05
@test "import copies a workfile to the configured workfile path" {
	sensor_design "$BATS_TEST_TMPDIR/design.json"
	run_json import "$BATS_TEST_TMPDIR/design.json"
	assert_success
	assert_json '.ok' true
	assert_json '.path' "$PROJECT/workfile.json"
	assert_json '.source' "$BATS_TEST_TMPDIR/design.json"
	assert_json '.message' 'Imported a workfile for board otherboard (platform othersoc), 6 nodes; the workfile is valid'
	cmp "$BATS_TEST_TMPDIR/design.json" "$PROJECT/workfile.json"
}

# bats test_tags=req:IMPORT-01
@test "import in human mode says what it copied where" {
	sensor_design "$PROJECT/design.json"
	run aa import design.json
	assert_success
	assert_line --index 0 'Imported a workfile for board otherboard (platform othersoc), 6 nodes; the workfile is valid'
	assert_line --index 1 "  $PROJECT/design.json -> $PROJECT/workfile.json"
}

# bats test_tags=req:IMPORT-05
@test "import creates the workfile's directory and keeps the source's board" {
	new_project noos workfile=designs/now/w.json
	jq -n '{platform: "testsoc", board: "testboard", symbols: {}}' >"$PROJECT/other.json"
	run_json import other.json
	assert_success
	assert_json '.message' 'Imported a workfile for board testboard (platform testsoc), 0 nodes; the workfile is valid'
	cmp "$PROJECT/other.json" "$PROJECT/designs/now/w.json"
	run_json config target
	assert_json '.configs[0].value' otherboard
}

# bats test_tags=req:IMPORT-01
@test "import refuses to overwrite an existing workfile" {
	sensor_design "$PROJECT/design.json"
	aa init >/dev/null
	cp "$PROJECT/workfile.json" "$BATS_TEST_TMPDIR/before.json"
	run_json import design.json
	assert_json '.ok' false
	assert_json '.message' "A workfile already exists at $PROJECT/workfile.json"
	cmp "$BATS_TEST_TMPDIR/before.json" "$PROJECT/workfile.json"
	run aa import design.json
	assert_output --partial "Delete it, or point the 'workfile' setting somewhere else."
}

# bats test_tags=req:IMPORT-01
@test "import refuses the workfile itself and a path with no file" {
	with_sensor
	run_json import workfile.json
	assert_json '.ok' false
	assert_json '.message' "'$PROJECT/workfile.json' is already the workfile"
	rm "$PROJECT/workfile.json"
	run_json import nofile.json
	assert_json '.ok' false
	assert_json '.message' "No workfile at '$PROJECT/nofile.json'"
}

# bats test_tags=req:IMPORT-05
@test "import refuses a file that is not a workfile, writing nothing" {
	echo '{' >"$PROJECT/junk.json"
	run_json import junk.json
	assert_json '.ok' false
	assert_json '.message' "Cannot import '$PROJECT/junk.json': Failed to parse workfile as JSON: $PROJECT/junk.json"
	[ ! -e "$PROJECT/workfile.json" ]
}

# bats test_tags=req:IMPORT-05
@test "import refuses a workfile that does not load with the configured modules" {
	sensor_design "$BATS_TEST_TMPDIR/design.json"
	jq '.symbols.extra = {"$compatible": "nosuchschema"}' "$BATS_TEST_TMPDIR/design.json" >"$PROJECT/bad.json"
	run_json import bad.json
	assert_json '.ok' false
	assert_json '.message | startswith("Cannot import '"'$PROJECT/bad.json'"': Unknown ruleset '"'nosuchschema'"'")' true
	[ ! -e "$PROJECT/workfile.json" ]
}

# bats test_tags=req:IMPORT-05
@test "import refuses a workfile for a chip the modules don't have" {
	jq -n '{platform: "nosuchsoc", symbols: {}}' >"$PROJECT/alien.json"
	run_json import alien.json
	assert_json '.ok' false
	assert_json '.message | startswith("Cannot import '"'$PROJECT/alien.json'"': ")' true
	assert_json '.message | contains("nosuchsoc")' true
	[ ! -e "$PROJECT/workfile.json" ]
}

# bats test_tags=req:IMPORT-05
@test "import of a workfile with problems copies it and says how many are left" {
	aa init >/dev/null
	aa add test_gpio_pin >/dev/null
	mv "$PROJECT/workfile.json" "$PROJECT/half.json"
	run_json import half.json
	assert_success
	assert_json '.ok' true
	assert_json '.message' 'Imported a workfile for board otherboard (platform othersoc), 1 node; 1 problem left - run: analog-attach validate'
	cmp "$PROJECT/half.json" "$PROJECT/workfile.json"
}
