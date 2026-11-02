# init where the backend is noos.

# bats file_tags=eco:noos

# Preconditions: a noos project on attach-no-os-lib's test fixtures (a capi, a platform with
# testboard, otherboard and twobusboard, drivers), target otherboard, no workfile yet.
setup() {
	load ../helpers
	new_project noos
}

# Description: init creates an empty workfile at the path of the workfile setting, making its
# directories.
# Steps:
#   1. Set up the project with workfile=designs/sub/mine.json.
#   2. Init, with --json.
#   3. Check it succeeds (.ok true).
#   4. Check designs/sub/mine.json exists, workfile.json doesn't, and the workfile has no nodes.
# bats test_tags=req:INIT-01, id:N0154
@test "init creates an empty workfile at the path the workfile setting names" {
	new_project noos workfile=designs/sub/mine.json
	run_json init
	assert_success
	assert_json '.ok' true
	[ -f "$PROJECT/designs/sub/mine.json" ]
	[ ! -e "$PROJECT/workfile.json" ]
	run jq -c '.symbols' "$PROJECT/designs/sub/mine.json"
	assert_output '{}'
}

# Description: with a board as target, init writes the board and its chip (platform) into the
# workfile.
# Steps:
#   1. Set up the project with target=testboard.
#   2. Init, with --json, and check it succeeds (.ok true).
#   3. Check the workfile has platform testsoc, board testboard, and no nodes.
# bats test_tags=req:INIT-01, req:INIT-01-CAPI, id:N0155
@test "init makes the workfile for the target board, with the chip it carries" {
	new_project noos target=testboard
	run_json init
	assert_success
	assert_json '.ok' true
	run jq -c '{platform, board, symbols}' "$PROJECT/workfile.json"
	assert_output '{"platform":"testsoc","board":"testboard","symbols":{}}'
}

# Description: with a chip as target, init makes a workfile for that platform and no board.
# Steps:
#   1. Set up the project with target=boardless.
#   2. Init, with --json.
#   3. Check it succeeds, saying it created a workfile for platform boardless.
#   4. Check the workfile has platform boardless and no board key.
# bats test_tags=req:INIT-01-CAPI, id:N0156
@test "init makes a board-less workfile when the target is a chip" {
	new_project noos target=boardless
	run_json init
	assert_success
	assert_json '.message' 'Created a workfile for platform boardless'
	run jq -c '{platform, has_board: has("board")}' "$PROJECT/workfile.json"
	assert_output '{"platform":"boardless","has_board":false}'
}

# Description: init refuses a target that is neither a known board nor a known chip, and lists the
# known ones.
# Steps:
#   1. Set up the project with target=nosuchboard.
#   2. Init, with --json.
#   3. Check it is refused (.ok false), naming the target and listing the boards and chips.
#   4. Check no workfile was made.
# bats test_tags=req:INIT-01-CAPI, id:N0157
@test "init refuses a target that is neither a board nor a chip" {
	new_project noos target=nosuchboard
	run_json init
	assert_json '.ok' false
	assert_json '.message' "Unknown target 'nosuchboard'. It can be a board or a chip: testboard, otherboard, twobusboard, testsoc, othersoc, boardless"
	[ ! -e "$PROJECT/workfile.json" ]
}

# Description: init refuses to replace an existing workfile and leaves it as it was.
# Steps:
#   1. Create a workfile with the eval-testpart board (with_sensor), and keep a copy.
#   2. Init, with --json.
#   3. Check it is refused (.ok false), saying a workfile already exists at its path.
#   4. Check the workfile didn't change.
# bats test_tags=req:INIT-02, id:N0158
@test "init leaves an existing workfile as it is and says so" {
	with_sensor
	cp "$PROJECT/workfile.json" "$BATS_TEST_TMPDIR/before.json"
	run_json init
	assert_json '.ok' false
	assert_json '.message' "A workfile already exists at $PROJECT/workfile.json"
	cmp "$BATS_TEST_TMPDIR/before.json" "$PROJECT/workfile.json"
}

# Description: in human mode, init on an existing workfile says it exists and how to proceed, and
# leaves the file as it is, even when the file is not a valid workfile.
# Steps:
#   1. Write a JSON file that isn't a workfile at the workfile path.
#   2. Init, without --json.
#   3. Check the output says a workfile already exists and suggests deleting it or changing the
#      workfile setting.
#   4. Check the file is unchanged.
# bats test_tags=req:INIT-02, id:N0159
@test "init in human mode says the workfile exists and what to do" {
	echo '{"not": "even a workfile"}' >"$PROJECT/workfile.json"
	run aa init
	assert_output --partial "A workfile already exists at $PROJECT/workfile.json."
	assert_output --partial "Delete it, or point the 'workfile' setting somewhere else."
	run cat "$PROJECT/workfile.json"
	assert_output '{"not": "even a workfile"}'
}

# Description: with no target set, init refuses and points to config target and the guided setup.
# Steps:
#   1. Remove the target setting.
#   2. Init, with --json.
#   3. Check it is refused (.ok false), the message naming config target and the guided setup.
#   4. Check no workfile was made.
# bats test_tags=req:INIT-03, id:N0160
@test "init with no target names the setting and points to config and the guided setup" {
	drop_setting target
	run_json init
	assert_json '.ok' false
	assert_json '.message' 'No target configured. Run: analog-attach config target <board or chip>, or analog-attach for the guided setup'
	[ ! -e "$PROJECT/workfile.json" ]
}

# Description: with no target set, init in human mode lists the commands that set one.
# Steps:
#   1. Remove the target setting.
#   2. Init, without --json.
#   3. Check the output says no target is configured and names config target, list context and
#      the guided setup.
# bats test_tags=req:INIT-03, id:N0161
@test "init with no target lists, in human mode, the commands that set it" {
	drop_setting target
	run aa init
	assert_output --partial "No target configured."
	assert_output --partial "analog-attach config target <board>"
	assert_output --partial "analog-attach list context"
	assert_output --partial "the guided setup"
}

# Description: on a terminal, init creates the workfile without asking any question.
# Steps:
#   1. Run init on a pseudo-terminal (script), with no input.
#   2. Check it succeeds, saying it created a workfile for otherboard (platform othersoc).
#   3. Check the output has no question mark, and the workfile exists.
# bats test_tags=req:INIT-04, id:N0162
@test "init on a terminal asks nothing" {
	need script
	run timeout 20 script -qec "node '$CLI_DIR/dist/cli.js' init" /dev/null </dev/null
	assert_success
	assert_output --partial "Created a workfile for board otherboard (platform othersoc)"
	refute_output --partial "?"
	[ -f "$PROJECT/workfile.json" ]
}

# Description: on a terminal with no target set, init stops without asking for one.
# Steps:
#   1. Remove the target setting.
#   2. Run init on a pseudo-terminal (script), with no input and a 20 s timeout.
#   3. Check it didn't time out waiting for input, and the output has no question mark.
#   4. Check no workfile was made.
# bats test_tags=req:INIT-04, id:N0163
@test "init on a terminal with no target refuses without asking" {
	need script
	drop_setting target
	run timeout 20 script -qec "node '$CLI_DIR/dist/cli.js' init" /dev/null </dev/null
	# timeout exits 124 when init waits for an answer.
	[ "$status" -ne 124 ] || fail "init waited for input: $output"
	refute_output --partial "?"
	[ ! -e "$PROJECT/workfile.json" ]
}

# Description: init, with --json, reports the workfile's absolute path and that it was created.
# Steps:
#   1. Set up the project with workfile=w.json.
#   2. Init, with --json.
#   3. Check it succeeds, with .path the absolute path of w.json, .created true, and a message
#      naming the board and platform.
# bats test_tags=req:INIT-05, id:N0164
@test "init reports the absolute path of the workfile and that it created it" {
	new_project noos workfile=w.json
	run_json init
	assert_success
	assert_json '.path' "$PROJECT/w.json"
	assert_json '.created' true
	assert_json '.message' 'Created a workfile for board otherboard (platform othersoc)'
}

# Description: in human mode, init says what it created and then the workfile's path.
# Steps:
#   1. Init, without --json.
#   2. Check it succeeds, the first line naming the board and platform, the second the workfile's
#      path.
# bats test_tags=req:INIT-05, id:N0165
@test "init in human mode writes what it created and where" {
	run aa init
	assert_success
	assert_line --index 0 'Created a workfile for board otherboard (platform othersoc)'
	assert_line --index 1 "  $PROJECT/workfile.json"
}
