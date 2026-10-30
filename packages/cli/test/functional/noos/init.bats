# init where the backend is noos.

# bats file_tags=eco:noos

setup() {
	load ../helpers
	new_project noos
}

# bats test_tags=req:INIT-01
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

# bats test_tags=req:INIT-01, req:INIT-01-CAPI
@test "init makes the workfile for the target board, with the chip it carries" {
	new_project noos target=testboard
	run_json init
	assert_success
	assert_json '.ok' true
	run jq -c '{platform, board, symbols}' "$PROJECT/workfile.json"
	assert_output '{"platform":"testsoc","board":"testboard","symbols":{}}'
}

# bats test_tags=req:INIT-01-CAPI
@test "init makes a board-less workfile when the target is a chip" {
	new_project noos target=boardless
	run_json init
	assert_success
	assert_json '.message' 'Created a workfile for platform boardless'
	run jq -c '{platform, has_board: has("board")}' "$PROJECT/workfile.json"
	assert_output '{"platform":"boardless","has_board":false}'
}

# bats test_tags=req:INIT-01-CAPI
@test "init refuses a target that is neither a board nor a chip" {
	new_project noos target=nosuchboard
	run_json init
	assert_json '.ok' false
	assert_json '.message' "Unknown target 'nosuchboard'. It can be a board or a chip: testboard, otherboard, twobusboard, testsoc, othersoc, boardless"
	[ ! -e "$PROJECT/workfile.json" ]
}

# bats test_tags=req:INIT-02
@test "init leaves an existing workfile as it is and says so" {
	with_sensor
	cp "$PROJECT/workfile.json" "$BATS_TEST_TMPDIR/before.json"
	run_json init
	assert_json '.ok' false
	assert_json '.message' "A workfile already exists at $PROJECT/workfile.json"
	cmp "$BATS_TEST_TMPDIR/before.json" "$PROJECT/workfile.json"
}

# bats test_tags=req:INIT-02
@test "init in human mode says the workfile exists and what to do" {
	echo '{"not": "even a workfile"}' >"$PROJECT/workfile.json"
	run aa init
	assert_output --partial "A workfile already exists at $PROJECT/workfile.json."
	assert_output --partial "Delete it, or point the 'workfile' setting somewhere else."
	run cat "$PROJECT/workfile.json"
	assert_output '{"not": "even a workfile"}'
}

# bats test_tags=req:INIT-03
@test "init with no target names the setting and points to config and the guided setup" {
	drop_setting target
	run_json init
	assert_json '.ok' false
	assert_json '.message' 'No target configured. Run: analog-attach config target <board or chip>, or analog-attach for the guided setup'
	[ ! -e "$PROJECT/workfile.json" ]
}

# bats test_tags=req:INIT-03
@test "init with no target lists, in human mode, the commands that set it" {
	drop_setting target
	run aa init
	assert_output --partial "No target configured."
	assert_output --partial "analog-attach config target <board>"
	assert_output --partial "analog-attach list context"
	assert_output --partial "the guided setup"
}

# bats test_tags=req:INIT-04
@test "init on a terminal asks nothing" {
	need script
	run timeout 20 script -qec "node '$CLI_DIR/dist/cli.js' init" /dev/null </dev/null
	assert_success
	assert_output --partial "Created a workfile for board otherboard (platform othersoc)"
	refute_output --partial "?"
	[ -f "$PROJECT/workfile.json" ]
}

# bats test_tags=req:INIT-04
@test "init on a terminal with no target refuses without asking" {
	need script
	drop_setting target
	run timeout 20 script -qec "node '$CLI_DIR/dist/cli.js' init" /dev/null </dev/null
	# timeout exits 124 when init waits for an answer.
	[ "$status" -ne 124 ] || fail "init waited for input: $output"
	refute_output --partial "?"
	[ ! -e "$PROJECT/workfile.json" ]
}

# bats test_tags=req:INIT-05
@test "init reports the absolute path of the workfile and that it created it" {
	new_project noos workfile=w.json
	run_json init
	assert_success
	assert_json '.path' "$PROJECT/w.json"
	assert_json '.created' true
	assert_json '.message' 'Created a workfile for board otherboard (platform othersoc)'
}

# bats test_tags=req:INIT-05
@test "init in human mode writes what it created and where" {
	run aa init
	assert_success
	assert_line --index 0 'Created a workfile for board otherboard (platform othersoc)'
	assert_line --index 1 "  $PROJECT/workfile.json"
}
