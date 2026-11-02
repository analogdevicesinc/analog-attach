# import where the backend is noos.

# bats file_tags=eco:noos

# Preconditions: a noos project on attach-no-os-lib's test fixtures (a capi, a platform with
# testboard, otherboard and twobusboard, drivers), target otherboard, no workfile yet.
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

# Description: import copies a workfile to the configured workfile path and reports the source,
# the destination, and what it holds.
# Steps:
#   1. Make a valid eval-testpart workfile and move it out of the workfile path (design.json).
#   2. Import design.json, with --json.
#   3. Check it succeeds, with the workfile path, the source path, and a message naming the board,
#      platform, 6 nodes and that it is valid.
#   4. Check the workfile is a copy of design.json.
# bats test_tags=req:IMPORT-01, req:IMPORT-05, id:N0145
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

# Description: in human mode, import says what it imported, then the source and destination paths.
# Steps:
#   1. Make a valid eval-testpart workfile and move it to design.json.
#   2. Import design.json, without --json.
#   3. Check it succeeds, the first line describing the workfile, the second the source and
#      destination paths.
# bats test_tags=req:IMPORT-01, id:N0146
@test "import in human mode says what it copied where" {
	sensor_design "$PROJECT/design.json"
	run aa import design.json
	assert_success
	assert_line --index 0 'Imported a workfile for board otherboard (platform othersoc), 6 nodes; the workfile is valid'
	assert_line --index 1 "  $PROJECT/design.json -> $PROJECT/workfile.json"
}

# Description: import makes the workfile's directories, and keeps the source's board without
# changing the target setting.
# Steps:
#   1. Set up the project with workfile=designs/now/w.json.
#   2. Write an empty workfile for testboard (platform testsoc) to other.json.
#   3. Import other.json, with --json.
#   4. Check it succeeds, naming testboard, and designs/now/w.json is a copy of other.json.
#   5. Check the target setting is still otherboard.
# bats test_tags=req:IMPORT-05, id:N0147
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

# Description: import refuses to replace an existing workfile and leaves it as it was.
# Steps:
#   1. Make a valid eval-testpart workfile at design.json, then create a new workfile with init.
#   2. Keep a copy of the workfile.
#   3. Import design.json, with --json.
#   4. Check it is refused (.ok false), saying a workfile already exists, and the workfile didn't
#      change.
#   5. Import again without --json, and check it suggests deleting it or changing the workfile
#      setting.
# bats test_tags=req:IMPORT-01, id:N0148
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

# Description: import refuses the workfile itself as source, and a source path with no file.
# Steps:
#   1. Create a workfile with the eval-testpart board (with_sensor).
#   2. Import workfile.json, with --json, and check it is refused, saying it is already the
#      workfile.
#   3. Remove the workfile, import nofile.json, with --json, and check it is refused, saying
#      there is no workfile at that path.
# bats test_tags=req:IMPORT-01, id:N0149
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

# Description: import refuses a file that isn't valid JSON and writes no workfile.
# Steps:
#   1. Write a broken JSON file, junk.json.
#   2. Import junk.json, with --json.
#   3. Check it is refused (.ok false), saying it cannot import it because it doesn't parse.
#   4. Check no workfile was made.
# bats test_tags=req:IMPORT-05, id:N0150
@test "import refuses a file that is not a workfile, writing nothing" {
	echo '{' >"$PROJECT/junk.json"
	run_json import junk.json
	assert_json '.ok' false
	assert_json '.message' "Cannot import '$PROJECT/junk.json': Failed to parse workfile as JSON: $PROJECT/junk.json"
	[ ! -e "$PROJECT/workfile.json" ]
}

# Description: import refuses a workfile with a node of a schema the configured modules don't
# have, and writes no workfile.
# Steps:
#   1. Make a valid eval-testpart workfile, and add to a copy (bad.json) a node of schema
#      nosuchschema.
#   2. Import bad.json, with --json.
#   3. Check it is refused (.ok false), saying it cannot import it, naming the unknown schema.
#   4. Check no workfile was made.
# bats test_tags=req:IMPORT-05, id:N0151
@test "import refuses a workfile that does not load with the configured modules" {
	sensor_design "$BATS_TEST_TMPDIR/design.json"
	jq '.symbols.extra = {"$compatible": "nosuchschema"}' "$BATS_TEST_TMPDIR/design.json" >"$PROJECT/bad.json"
	run_json import bad.json
	assert_json '.ok' false
	assert_json '.message | startswith("Cannot import '"'$PROJECT/bad.json'"': Unknown ruleset '"'nosuchschema'"'")' true
	[ ! -e "$PROJECT/workfile.json" ]
}

# Description: import refuses a workfile for a platform the configured modules don't have, and
# writes no workfile.
# Steps:
#   1. Write a workfile for platform nosuchsoc to alien.json.
#   2. Import alien.json, with --json.
#   3. Check it is refused (.ok false), saying it cannot import it and naming nosuchsoc.
#   4. Check no workfile was made.
# bats test_tags=req:IMPORT-05, id:N0152
@test "import refuses a workfile for a chip the modules don't have" {
	jq -n '{platform: "nosuchsoc", symbols: {}}' >"$PROJECT/alien.json"
	run_json import alien.json
	assert_json '.ok' false
	assert_json '.message | startswith("Cannot import '"'$PROJECT/alien.json'"': ")' true
	assert_json '.message | contains("nosuchsoc")' true
	[ ! -e "$PROJECT/workfile.json" ]
}

# Description: a workfile with problems is still imported, and the message counts the problems
# left and points to validate.
# Steps:
#   1. Create a workfile with init, add test_gpio_pin, and move it to half.json.
#   2. Import half.json, with --json.
#   3. Check it succeeds, the message saying 1 node, 1 problem left, and to run validate.
#   4. Check the workfile is a copy of half.json.
# bats test_tags=req:IMPORT-05, id:N0153
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
