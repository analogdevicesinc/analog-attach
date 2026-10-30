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
	assert_success
	assert_json '.configs[0].value' openocd
	assert_json '.configs[0].source' default
}

# bats test_tags=req:CONFIG-11
@test "an unknown setting is refused, naming the valid ones" {
	run aa config nosuchkey 1
	assert_failure 2
	assert_output --partial "Unknown config field: nosuchkey"
	assert_output --partial "capi-path"
}

# bats test_tags=req:INIT-01, req:INIT-02
@test "init creates the workfile, then refuses to overwrite it" {
	run_json init
	assert_success
	assert_json '.created' true
	[ -f "$PROJECT/workfile.json" ]
	run_json init
	assert_json '.ok' false
}
